import { HYPERBEAM_BASE_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { X_LBRY_AUTH_TOKEN } from 'constants/token';
import Lbry from 'lbry';
import { Lbryio } from 'lbryinc';
import { pushHyperbeamDebug } from 'util/hyperbeamDebug';
import { isHyperbeamEnabled } from 'util/hyperbeamMode';
import { parseURI } from 'util/lbryURI';
import { getAuthToken } from 'util/saved-passwords';

const HYPERBEAM_TIMEOUT_MS = 15000;
const HYPERBEAM_READ_CACHE_MS = 30 * 1000;
const HYPERBEAM_FAILED_READ_CACHE_MS = 10 * 1000;
const HYPERBEAM_AUTH_DEVICE_PROXY_BASE = '/$/api/hyperbeam-auth-device/v1';
const CLAIM_DEVICE = '~odysee-claim@1.0';
const ACCOUNT_DEVICE = '~odysee-account@1.0';
const COMMENT_DEVICE = '~odysee-comment@1.0';
const REACTION_DEVICE = '~odysee-reaction@1.0';
const FILE_DEVICE = '~odysee-file@1.0';
const FILE_REACTION_DEVICE = '~odysee-file-reaction@1.0';
const SUBSCRIPTION_DEVICE = '~odysee-subscription@1.0';
const CHANNEL_DEVICE = '~odysee-channel@1.0';
const STREAM_DEVICE = '~odysee-stream@1.0';
const PRIVATE_PARAM_KEYS = new Set([
  'accesstoken',
  'authorization',
  'auth-token',
  'auth_token',
  'authtoken',
  'includeismyoutput',
  'includepurchasereceipt',
  'ismyinput',
  'ismyoutput',
  'purchasereceipt',
  'refreshtoken',
  'x-lbry-auth-token',
  'x-odysee-auth-token',
]);
const NORMALIZED_PRIVATE_PARAM_KEYS = new Set(
  Array.from(PRIVATE_PARAM_KEYS).map((key) => key.replace(/[-_]/g, '').toLowerCase())
);
const SAME_ORIGIN_COOKIE_AUTH = '__same_origin_cookie_auth__';
const deviceReadCache = new Map<string, { expiresAt: number; promise: Promise<any | null> }>();
let localAuthTokenPromise: Promise<string | null> | null = null;
const tracedAuthSources = new Set<string>();
const AUTH_REQUIRED_DEVICE_PATHS = new Set([
  `${FILE_DEVICE}/view-count`,
  `${FILE_REACTION_DEVICE}/list`,
  `${SUBSCRIPTION_DEVICE}/sub-count`,
  `${ACCOUNT_DEVICE}/preference-get`,
  `${ACCOUNT_DEVICE}/preference-set`,
  `${ACCOUNT_DEVICE}/settings-get`,
  `${ACCOUNT_DEVICE}/settings-set`,
  `${ACCOUNT_DEVICE}/settings-clear`,
  `${COMMENT_DEVICE}/create`,
  `${COMMENT_DEVICE}/edit`,
  `${COMMENT_DEVICE}/pin`,
  `${COMMENT_DEVICE}/abandon`,
  `${COMMENT_DEVICE}/reaction-react`,
  `${COMMENT_DEVICE}/setting-get`,
  `${COMMENT_DEVICE}/setting-list`,
  `${COMMENT_DEVICE}/setting-update`,
  `${COMMENT_DEVICE}/setting-block-word`,
  `${COMMENT_DEVICE}/setting-unblock-word`,
  `${COMMENT_DEVICE}/setting-list-blocked-words`,
  `${COMMENT_DEVICE}/moderation-block`,
  `${COMMENT_DEVICE}/moderation-unblock`,
  `${COMMENT_DEVICE}/moderation-block-list`,
  `${COMMENT_DEVICE}/moderation-add-delegate`,
  `${COMMENT_DEVICE}/moderation-remove-delegate`,
  `${COMMENT_DEVICE}/moderation-list-delegates`,
  `${COMMENT_DEVICE}/moderation-am-i`,
]);

export async function fetchHyperbeamResolve(params: any): Promise<any | null> {
  const urls = urlsFromResolveParams(params);
  if (!urls.length) return null;

  const { batchedUris, resolveUris } = splitBatchedResolveUris(urls);
  const batchedEntries = batchedUris.length ? await fetchBatchedResolveEntries(batchedUris) : [];
  const resolveEntries = await fetchResolveEntries(resolveUris);

  return Object.fromEntries([...batchedEntries, ...resolveEntries].filter(([, claim]) => claim));
}

async function fetchResolveEntries(urls: Array<string>): Promise<Array<[string, any]>> {
  return Promise.all(
    urls.map(async (uri): Promise<[string, any]> => {
      const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/resolve`, { uri });
      const result = responsePayload(response);
      return [uri, sdkClaimFromHyperbeam(result?.[uri] || result)];
    })
  );
}

async function fetchBatchedResolveEntries(urls: Array<string>): Promise<Array<[string, any]>> {
  const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/resolve`, { urls });
  const result = responsePayload(response);

  return urls.map((uri): [string, any] => [uri, sdkClaimFromHyperbeam(result?.[uri] || result)]);
}

export async function fetchHyperbeamGet(params: any): Promise<any | null> {
  const uri = params?.uri || params?.url;
  if (!uri) return null;

  const response = await fetchDeviceJson(`${STREAM_DEVICE}/playback`, { uri });
  return playbackPayloadFromHyperbeam(responsePayload(response));
}

export async function fetchHyperbeamAccountSdk(method: string, params: Record<string, any>): Promise<any | null> {
  const key = method.replace(/_/g, '-');
  const response = await fetchDeviceJson(`${ACCOUNT_DEVICE}/${key}`, params || {});
  const result = responsePayload(response);
  return result || null;
}

type HyperbeamChannel = {
  claim_id?: string;
  name?: string;
  permanent_url?: string;
  canonical_url?: string;
  short_url?: string;
  value?: {
    title?: string;
    description?: string;
    thumbnail?: { url?: string };
  };
  [key: string]: any;
};

export async function fetchHyperbeamCommentList(params: CommentListParams): Promise<CommentListResponse | null> {
  const response = await fetchDeviceJson(`${COMMENT_DEVICE}/list`, params);
  const result = responsePayload(response);
  const comments = result && (result.comments || result.items);
  if (!Array.isArray(comments)) return null;

  return {
    items: comments.map(commentFromHyperbeam),
    page: toNumber(result.page, params.page || 1),
    page_size: toNumber(value(result, 'page-size', 'page_size'), params.page_size || comments.length),
    total_items: toNumber(value(result, 'total-items', 'total_items'), comments.length),
    total_filtered_items: toNumber(value(result, 'total-filtered-items', 'total_filtered_items'), comments.length),
    total_pages: toNumber(value(result, 'total-pages', 'total_pages'), 1),
    has_hidden_comments: Boolean(result['has-hidden-comments']),
  };
}

export async function fetchHyperbeamCommentById(params: CommentByIdParams): Promise<CommentByIdResponse | null> {
  const response = await fetchDeviceJson(`${COMMENT_DEVICE}/by-id`, params);
  const result = responsePayload(response);
  const comment = result && (result.comment || result.item || result.items);
  const item = Array.isArray(comment) ? comment[0] : comment;
  if (!item) return null;

  return {
    item: commentFromHyperbeam(item),
    items: [commentFromHyperbeam(item)],
    ancestors: Array.isArray(result.ancestors) ? result.ancestors.map(commentFromHyperbeam) : [],
  };
}

export async function fetchHyperbeamCommentCreate(params: CommentCreateParams): Promise<CommentCreateResponse | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/create`, params);
}

export async function fetchHyperbeamCommentEdit(params: CommentEditParams): Promise<CommentEditResponse | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/edit`, params);
}

export async function fetchHyperbeamCommentPin(params: CommentPinParams): Promise<CommentPinResponse | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/pin`, params);
}

export async function fetchHyperbeamCommentAbandon(
  params: CommentAbandonParams
): Promise<CommentAbandonResponse | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/abandon`, params);
}

export async function fetchHyperbeamReactionReact(params: ReactionReactParams): Promise<ReactionReactResponse | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/reaction-react`, params);
}

export async function fetchHyperbeamSettingGet(params: SettingsParams): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/setting-get`, params);
}

export async function fetchHyperbeamSettingList(params: SettingsParams): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/setting-list`, params);
}

export async function fetchHyperbeamSettingUpdate(params: UpdateSettingsParams): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/setting-update`, params);
}

export async function fetchHyperbeamSettingBlockWord(params: BlockWordParams): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/setting-block-word`, params);
}

export async function fetchHyperbeamSettingUnblockWord(params: BlockWordParams): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/setting-unblock-word`, params);
}

export async function fetchHyperbeamSettingListBlockedWords(params: SettingsParams): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/setting-list-blocked-words`, params);
}

export async function fetchHyperbeamModerationBlock(params: ModerationBlockParams): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/moderation-block`, params);
}

export async function fetchHyperbeamModerationUnblock(params: ModerationBlockParams): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/moderation-unblock`, params);
}

export async function fetchHyperbeamModerationBlockList(params: BlockedListArgs): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/moderation-block-list`, params);
}

export async function fetchHyperbeamModerationAddDelegate(params: ModerationAddDelegateParams): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/moderation-add-delegate`, params);
}

export async function fetchHyperbeamModerationRemoveDelegate(
  params: ModerationRemoveDelegateParams
): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/moderation-remove-delegate`, params);
}

export async function fetchHyperbeamModerationListDelegates(
  params: ModerationListDelegatesParams
): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/moderation-list-delegates`, params);
}

export async function fetchHyperbeamModerationAmI(params: ModerationAmIParams): Promise<any | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/moderation-am-i`, params);
}

async function fetchHyperbeamCommentron(path: string, params: Record<string, any>): Promise<any | null> {
  const response = await fetchDeviceJson(path, params);
  const result = responsePayload(response);
  return result || null;
}

export async function fetchHyperbeamReactionList(params: ReactionListParams): Promise<ReactionListResponse | null> {
  const response = await fetchDeviceJson(`${REACTION_DEVICE}/list`, params);
  return reactionListFromHyperbeam(responsePayload(response));
}

export async function fetchHyperbeamFileReactionList(params: { claim_ids: string }): Promise<any | null> {
  const response = await fetchDeviceJson(`${FILE_REACTION_DEVICE}/list`, params);
  return reactionListFromHyperbeam(responsePayload(response));
}

export async function fetchHyperbeamViewCount(claimIdCsv: string): Promise<Array<number> | null> {
  const response = await fetchDeviceJson(`${FILE_DEVICE}/view-count`, {
    claim_id: claimIdCsv,
  });
  const result = responsePayload(response);
  const counts = countArray(result, 'view-counts') || countArray(response, 'view-counts');

  return Array.isArray(counts) ? counts : null;
}

export async function fetchHyperbeamSubCount(claimIdCsv: string): Promise<Array<number> | null> {
  const response = await fetchDeviceJson(
    `${SUBSCRIPTION_DEVICE}/sub-count`,
    compactParams({
      claim_id: claimIdCsv,
    })
  );
  const result = responsePayload(response);
  const counts = countArray(result, 'sub-counts') || countArray(response, 'sub-counts');

  return Array.isArray(counts) ? counts : null;
}

export async function fetchHyperbeamClaimSearch(params: ClaimSearchOptions): Promise<ClaimSearchResponse | null> {
  const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/search`, params);
  const result = sdkSearchFromHyperbeam(responsePayload(response));
  const items = result && result.items;

  return Array.isArray(items) ? result : null;
}

export async function fetchHyperbeamResolveClaimIds(params: ClaimSearchOptions): Promise<ClaimSearchResponse | null> {
  const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/resolve`, params);
  const result = sdkSearchFromHyperbeam(responsePayload(response));
  const items = result && result.items;

  return Array.isArray(items) ? result : null;
}

export async function fetchHyperbeamVerifyClaimSignature(
  params: VerifyClaimSignatureParams
): Promise<VerifyClaimSignatureResponse | null> {
  const response = await fetchDeviceJson(`${COMMENT_DEVICE}/verify-claim-signature`, params);
  const result = responsePayload(response);
  const isValid = value(result, 'is-valid', 'is_valid');

  return typeof isValid === 'boolean' ? { is_valid: isValid } : null;
}

export async function fetchHyperbeamChannel(claim: Claim | null | undefined): Promise<HyperbeamChannel | null> {
  if (!claim) return null;

  const result = await fetchDeviceJson(`${CHANNEL_DEVICE}/channel`, { channel: claim.signing_channel || claim });
  return result ? channelFromHyperbeam(result) : null;
}

export async function fetchHyperbeamStreamVerification(
  claim: Claim | null | undefined,
  uri: string
): Promise<any | null> {
  const result = await fetchDeviceJson(`${STREAM_DEVICE}/verified-stream`, compactParams({ claim, url: uri }));
  return responsePayload(result);
}

async function fetchDeviceJson(path: string, body: Record<string, any>): Promise<any | null> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) {
    if (isHyperbeamEnabled()) throw new Error('HyperBEAM node is not configured');
    return null;
  }

  try {
    if (AUTH_REQUIRED_DEVICE_PATHS.has(path)) {
      const authToken = await getOdyseeAuthToken(path);
      traceAuthDeviceRequest(path, authToken);
      traceAuthRequestBody(path, stripPrivateParams(compactParams(body)), authToken);
      return await fetchAuthDeviceJson(path, stripPrivateParams(compactParams(body)), authToken);
    }

    const authToken = await getOdyseeAuthToken(path);
    const params = withAuthParams(stripPrivateParams(compactParams(body)), authToken);
    traceAuthDeviceRequest(path, authToken);
    traceAuthRequestBody(path, params, authToken);

    const response = await fetch(buildDeviceUrl(baseUrl, path), {
      method: 'POST',
      credentials: hyperbeamFetchCredentials(baseUrl),
      headers: {
        'Content-Type': 'application/json',
        ...authTokenHeader(authToken),
      },
      body: JSON.stringify(params),
      signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      if (isHyperbeamEnabled()) throw new Error(`HyperBEAM ${path} failed with ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    if (isHyperbeamEnabled()) throw error;
    return null;
  }
}

async function fetchAuthDeviceJson(
  path: string,
  body: Record<string, any>,
  authToken: string | null
): Promise<any | null> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const devicePath = `/${path}`;
  const device = path.split('/')[0];
  const url = `${HYPERBEAM_AUTH_DEVICE_PROXY_BASE}/${path}`;

  pushHyperbeamDebug(
    'request',
    {
      method: 'POST',
      devicePath,
      device,
      deviceLayer: 'native-device',
      sourceLayer: 'native-device:auth',
      authRequired: true,
      requestKey: requestKeyForAuthDevice(path, body),
      url,
    },
    'info'
  );

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authTokenHeader(authToken),
    },
    body: JSON.stringify(body),
    signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
  });
  const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
  const responseText = await response.text();
  const contentType = response.headers.get('content-type') || '';

  pushHyperbeamDebug(
    'response',
    {
      status: response.status,
      ok: response.ok,
      devicePath,
      device,
      deviceLayer: 'native-device',
      sourceLayer: 'native-device:auth',
      authRequired: true,
      requestKey: requestKeyForAuthDevice(path, body),
      contentType,
      elapsedMs,
      response: parseJsonString(responseText) || undefined,
    },
    response.ok ? 'ok' : 'error'
  );

  if (!response.ok) {
    if (isHyperbeamEnabled()) throw new Error(`HyperBEAM ${path} failed with ${response.status}`);
    return null;
  }

  return parseJsonString(responseText);
}

function requestKeyForAuthDevice(path: string, body: Record<string, any>) {
  const claimId = body.claim_id || body.claim_ids || body['claim-id'] || body['claim-ids'];
  return claimId ? `claim:${claimId}` : `${path}:${stableJson(body).slice(0, 180)}`;
}

function authTokenHeader(token: string | null): Record<string, string> {
  return token && token !== SAME_ORIGIN_COOKIE_AUTH ? { 'x-odysee-auth-token': token } : {};
}

function withAuthParams(params: Record<string, any>, token: string | null): Record<string, any> {
  return token && token !== SAME_ORIGIN_COOKIE_AUTH ? { ...params, auth_token: token } : params;
}

async function getOdyseeAuthToken(path?: string): Promise<string | null> {
  if (path && AUTH_REQUIRED_DEVICE_PATHS.has(path)) {
    const localAuthToken = await getLocalAuthToken();
    traceAuthSource(path, 'same-origin-cookie', localAuthToken);
    if (localAuthToken) return localAuthToken;
  }

  const apiHeaders = Lbry.getApiRequestHeaders && Lbry.getApiRequestHeaders();
  const apiHeaderToken = apiHeaders && (apiHeaders[X_LBRY_AUTH_TOKEN] || apiHeaders[X_LBRY_AUTH_TOKEN.toLowerCase()]);
  traceAuthSource(path, 'lbry-header', apiHeaderToken);
  if (apiHeaderToken) return String(apiHeaderToken);

  const cookieToken = getAuthToken();
  traceAuthSource(path, 'document-cookie', cookieToken);
  if (cookieToken) return cookieToken;

  try {
    const state = typeof window !== 'undefined' && window.store ? window.store.getState() : undefined;
    const stateToken = state?.auth?.authToken;
    traceAuthSource(path, 'redux-auth', stateToken);
    if (stateToken) return stateToken;
  } catch (_e) {
    // Fall through to the normal lbryinc override.
  }

  try {
    const lbryioToken = await Lbryio.getAuthToken();
    traceAuthSource(path, 'lbryio', lbryioToken);
    if (lbryioToken) return lbryioToken;
  } catch (_e) {
    // Fall through to the same-origin probe.
  }

  const localAuthToken = await getLocalAuthToken();
  traceAuthSource(path, 'same-origin-cookie', localAuthToken);
  if (localAuthToken) return localAuthToken;

  return null;
}

async function getLocalAuthToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (!localAuthTokenPromise) {
    localAuthTokenPromise = fetch('/$/api/auth-token/v1/get', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => (result?.auth_cookie_present ? SAME_ORIGIN_COOKIE_AUTH : null))
      .catch(() => null)
      .finally(() => {
        window.setTimeout(() => {
          localAuthTokenPromise = null;
        }, 10000);
      });
  }

  return localAuthTokenPromise;
}

function traceAuthDeviceRequest(path: string, token: string | null) {
  if (!AUTH_REQUIRED_DEVICE_PATHS.has(path)) return;

  const traceKey = `${path}:${token ? 'present' : 'missing'}`;
  if (tracedAuthSources.has(traceKey)) return;
  tracedAuthSources.add(traceKey);

  pushHyperbeamDebug(
    'auth token',
    {
      authRequired: true,
      authPresent: Boolean(token),
      devicePath: `/${path}`,
      device: path.split('/')[0],
      deviceLayer: 'native-device',
      sourceLayer: 'native-device:auth',
    },
    token ? 'ok' : 'warn'
  );
}

function traceAuthRequestBody(path: string, params: Record<string, any>, token: string | null) {
  if (!AUTH_REQUIRED_DEVICE_PATHS.has(path)) return;

  const bodyKeys = Object.keys(params).sort().join(',');
  const traceKey = `${path}:body:${token ? 'present' : 'missing'}:${bodyKeys}`;
  if (tracedAuthSources.has(traceKey)) return;
  tracedAuthSources.add(traceKey);

  pushHyperbeamDebug(
    'auth request',
    {
      authRequired: true,
      authPresent: Boolean(token),
      authTransport: token === SAME_ORIGIN_COOKIE_AUTH ? 'server-cookie' : token ? 'server-body' : 'missing',
      hasVisibleAuthParam: Boolean(params.auth_token),
      bodyKeys: Object.keys(params).sort(),
      devicePath: `/${path}`,
      device: path.split('/')[0],
      deviceLayer: 'native-device',
      sourceLayer: 'native-device:auth',
    },
    token ? 'ok' : 'warn'
  );
}

function traceAuthSource(path: string | undefined, source: string, token: any) {
  if (!path || !AUTH_REQUIRED_DEVICE_PATHS.has(path)) return;

  const traceKey = `${path}:${source}:${token ? 'present' : 'missing'}`;
  if (tracedAuthSources.has(traceKey)) return;
  tracedAuthSources.add(traceKey);

  pushHyperbeamDebug(
    'auth source',
    {
      authRequired: true,
      authPresent: Boolean(token),
      authSource: source,
      devicePath: `/${path}`,
      device: path.split('/')[0],
      deviceLayer: 'native-device',
      sourceLayer: 'native-device:auth',
    },
    token ? 'ok' : 'warn'
  );
}

function fetchCachedDeviceJson(path: string, body: Record<string, any>): Promise<any | null> {
  const key = `${path}:${stableJson(stripPrivateParams(compactParams(body)))}`;
  const now = Date.now();
  const cached = deviceReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchDeviceJson(path, body).catch((error) => {
    const failed = Promise.reject(error);
    failed.catch(() => {});
    deviceReadCache.set(key, { expiresAt: Date.now() + HYPERBEAM_FAILED_READ_CACHE_MS, promise: failed });
    throw error;
  });
  deviceReadCache.set(key, { expiresAt: now + HYPERBEAM_READ_CACHE_MS, promise });
  return promise;
}

function hyperbeamBaseUrl(): string {
  return String(HYPERBEAM_BASE_URL || ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
}

function buildDeviceUrl(baseUrl: string, path: string): string {
  return `${baseUrl}/${path}`;
}

function hyperbeamFetchCredentials(baseUrl: string): RequestCredentials {
  if (typeof window === 'undefined') return 'include';

  try {
    return new URL(baseUrl, window.location.href).origin === window.location.origin ? 'include' : 'omit';
  } catch (_e) {
    return 'omit';
  }
}

function compactParams(params: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(params).filter(([key, value]) => key !== 'no_auth' && value !== undefined && value !== null)
  );
}

function stripPrivateParams(source: any): any {
  if (!source || typeof source !== 'object') return source;

  if (Array.isArray(source)) return source.map(stripPrivateParams);

  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !NORMALIZED_PRIVATE_PARAM_KEYS.has(key.replace(/[-_]/g, '').toLowerCase()))
      .map(([key, value]) => [key, stripPrivateParams(value)])
  );
}

function stableJson(value: any): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
}

function commentFromHyperbeam(comment: any): any {
  return compactParams({
    ...comment.source,
    comment_id: value(comment, 'comment-id', 'comment_id', 'id'),
    comment: value(comment, 'comment', 'body', 'text'),
    claim_id: value(comment, 'claim-id', 'claim_id'),
    parent_id: value(comment, 'parent-id', 'parent_id'),
    channel_id: value(comment, 'channel-id', 'channel_id'),
    channel_name: value(comment, 'channel-name', 'channel_name'),
    channel_url: value(comment, 'channel-url', 'channel_url'),
    timestamp: value(comment, 'timestamp', 'created_at'),
    updated_at: value(comment, 'updated-at', 'updated_at'),
    signature: value(comment, 'signature'),
    signing_ts: value(comment, 'signing-ts', 'signing_ts'),
    is_pinned: value(comment, 'is-pinned', 'is_pinned'),
    replies: value(comment, 'replies'),
    support_amount: value(comment, 'support-amount', 'support_amount'),
    support_tx_id: value(comment, 'support-tx-id', 'support_tx_id'),
    sticker: value(comment, 'sticker'),
    mentioned_channels: value(comment, 'mentioned-channels', 'mentioned_channels'),
    removed: value(comment, 'removed'),
    hidden: value(comment, 'hidden'),
    blocked: value(comment, 'blocked'),
    hyperbeam_signature_verification: value(comment, 'signature-verification'),
  });
}

function responsePayload(response: any): any {
  if (!response) return null;
  const body = parseJsonString(response.body);
  const payload = body || response;

  if (payload && payload.jsonrpc && payload.result !== undefined) return payload.result;
  if (payload && payload.success === true && payload.data !== undefined) return payload.data;
  if (payload && payload.result !== undefined) return payload.result;
  if (payload && payload.data !== undefined) return payload.data;

  return payload;
}

function countArray(source: any, countKey: string): Array<number> | null {
  if (Array.isArray(source)) return source;
  if (typeof source === 'number') return [source];

  const counts = value(source, 'counts', countKey);
  if (Array.isArray(counts)) return counts;
  if (typeof counts === 'number') return [counts];

  const result = value(source, 'result');
  if (Array.isArray(result)) return result;
  if (typeof result === 'number') return [result];

  return null;
}

function reactionListFromHyperbeam(result: any): any | null {
  const myReactions = value(result, 'my_reactions', 'my-reactions');
  const othersReactions = value(result, 'others_reactions', 'others-reactions');
  const my = isObject(myReactions) ? myReactions : {};
  const others = isObject(othersReactions) ? othersReactions : {};

  return Object.keys(my).length || Object.keys(others).length ? { my_reactions: my, others_reactions: others } : null;
}

function parseJsonString(value: any): any {
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value);
  } catch (_e) {
    return null;
  }
}

function urlsFromResolveParams(params: any): Array<string> {
  const source = params?.urls || params?.uris || params?.url || params?.uri;
  if (Array.isArray(source)) return source.filter(Boolean);
  return source ? [source] : [];
}

function splitBatchedResolveUris(urls: Array<string>): { batchedUris: Array<string>; resolveUris: Array<string> } {
  return urls.reduce(
    (groups, uri) => {
      groups[claimIdFromUri(uri) ? 'batchedUris' : 'resolveUris'].push(uri);
      return groups;
    },
    { batchedUris: [], resolveUris: [] } as { batchedUris: Array<string>; resolveUris: Array<string> }
  );
}

function claimIdFromUri(uri: string): string | null {
  try {
    const parsed = parseURI(String(uri));
    const claimId = parsed.streamClaimId || parsed.channelClaimId;
    return claimId ? String(claimId) : null;
  } catch (_e) {
    return null;
  }
}

function sdkClaimFromHyperbeam(result: any): any {
  if (!result) return null;
  const claim = result.claim || result;
  const claimId = value(claim, 'claim_id', 'claim-id');
  if (!claim || !claimId) return claim;

  return {
    ...claim,
    claim_id: claimId,
    name: value(claim, 'name', 'claim-name') || claim.name,
    canonical_url: value(claim, 'canonical_url', 'canonical-url') || claim.canonical_url,
    permanent_url: value(claim, 'permanent_url', 'permanent-url') || claim.permanent_url,
    short_url: value(claim, 'short_url', 'short-url') || claim.short_url,
    value_type: value(claim, 'value_type', 'value-type') || claim.value_type,
  };
}

function sdkSearchFromHyperbeam(result: any): any {
  if (!result) return null;
  const sdkResult = result.result && Array.isArray(result.result.items) ? result.result : result;

  return {
    ...sdkResult,
    page_size: value(sdkResult, 'page_size', 'page-size') || value(result, 'page_size', 'page-size'),
    total_items: value(sdkResult, 'total_items', 'total-items') || value(result, 'total_items', 'total-items'),
    total_pages: value(sdkResult, 'total_pages', 'total-pages') || value(result, 'total_pages', 'total-pages'),
  };
}

function playbackPayloadFromHyperbeam(result: any): any {
  if (!result) return null;
  const body = value(result, 'body');
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {}
  }

  return {
    ...result,
    streaming_url: value(result, 'streaming_url', 'streaming-url') || result.streaming_url,
    download_url: value(result, 'download_url', 'download-url') || result.download_url,
    sd_hash: value(result, 'sd_hash', 'sd-hash') || result.sd_hash,
    media_type: value(result, 'media_type', 'media-type') || result.media_type,
    claim_id: value(result, 'claim_id', 'claim-id') || result.claim_id,
    claim_name: value(result, 'claim_name', 'claim-name') || result.claim_name,
  };
}

function channelFromHyperbeam(channel: any): HyperbeamChannel {
  const channelValue = channel.value || {};
  const thumbnail = value(channel, 'thumbnail') || channelValue.thumbnail;

  return compactParams({
    ...channel.source,
    claim_id: value(channel, 'claim-id', 'claim_id'),
    name: value(channel, 'claim-name', 'claim_name', 'name'),
    permanent_url: value(channel, 'permanent-url', 'permanent_url'),
    canonical_url: value(channel, 'canonical-url', 'canonical_url'),
    short_url: value(channel, 'short-url', 'short_url'),
    value: compactParams({
      ...channelValue,
      title: value(channel, 'title') || channelValue.title,
      description: value(channel, 'description') || channelValue.description,
      thumbnail: typeof thumbnail === 'string' ? { url: thumbnail } : thumbnail,
    }),
    hyperbeam_signature_valid: value(channel, 'signature-valid'),
  });
}

function value(source: any, ...keys: string[]): any {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) return source[key];
  }
}

function isObject(source: any): boolean {
  return Boolean(source) && typeof source === 'object' && !Array.isArray(source);
}

function toNumber(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  const timeout = typeof AbortSignal !== 'undefined' && (AbortSignal as any).timeout;
  return typeof timeout === 'function' ? timeout(ms) : undefined;
}
