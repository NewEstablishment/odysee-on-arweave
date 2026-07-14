import { HYPERBEAM_BASE_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { X_LBRY_AUTH_TOKEN } from 'constants/token';
import Lbry from 'lbry';
import { Lbryio } from 'lbryinc';
import { pushHyperbeamDebug } from 'util/hyperbeamDebug';
import { allowHyperbeamCompatibilityReads, isHyperbeamEnabled } from 'util/hyperbeamMode';
import { isHyperbeamUploadClaim } from 'util/claim';
import { parseURI } from 'util/lbryURI';
import { getAuthToken } from 'util/saved-passwords';

const HYPERBEAM_TIMEOUT_MS = 15000;
const HYPERBEAM_READ_CACHE_MS = 30 * 1000;
const HYPERBEAM_FAILED_READ_CACHE_MS = 10 * 1000;
const LBRY_CLAIM_ID_RE = /^[0-9a-f]{40}$/i;
const HYPERBEAM_AUTH_DEVICE_PROXY_BASE = '/$/api/hyperbeam-auth-device/v1';
const CLAIM_DEVICE = '~odysee-claim@1.0';
const ACCOUNT_DEVICE = '~odysee-account@1.0';
const COMMENT_DEVICE = '~odysee-comment@1.0';
const REACTION_DEVICE = '~odysee-reaction@1.0';
const FILE_DEVICE = '~odysee-file@1.0';
const FILE_REACTION_DEVICE = '~odysee-file-reaction@1.0';
const SUBSCRIPTION_DEVICE = ACCOUNT_DEVICE;
const CHANNEL_DEVICE = '~odysee-channel@1.0';
const STREAM_DEVICE = '~odysee-stream@1.0';
const SEARCH_DEVICE = '~odysee-search@1.0';
const UPLOAD_DEVICE = '~odysee-upload@1.0';
const COMMENTRON_FAILURE = 'Failed to fetch (comments.odysee.tv)';
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
const PRESERVE_PRIVATE_DEVICE_PATHS = new Set([`${ACCOUNT_DEVICE}/user-new`]);
const AUTH_REQUIRED_DEVICE_PATHS = new Set([
  `${ACCOUNT_DEVICE}/user-exists`,
  `${ACCOUNT_DEVICE}/user-new`,
  `${ACCOUNT_DEVICE}/user-signin`,
  `${ACCOUNT_DEVICE}/user-me`,
  `${ACCOUNT_DEVICE}/user-email-resend-token`,
  `${ACCOUNT_DEVICE}/user-email-confirm`,
  `${ACCOUNT_DEVICE}/account-status`,
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

  // Immutable-id routes (out_<txid>_<nout> / 43-char ids) resolve through the
  // per-uri chain (bare store GET first); channel claim-id uris batch through
  // the store claim-id path; the rest keep master's batched device resolve,
  // falling back to the per-uri chain for anything the batch does not return.
  const immutableUris = urls.filter((uri) => immutableRouteIdFromUri(uri));
  const mutableUris = urls.filter((uri) => !immutableRouteIdFromUri(uri));
  const { channelUris, resolveUris: plainUris } = splitClaimIdChannelUris(mutableUris);
  const channelEntries =
    channelUris.length > 1 ? await fetchClaimIdChannelEntries(channelUris) : await fetchResolveEntries(channelUris);
  const { batchedUris, resolveUris } = splitBatchedResolveUris(plainUris);
  const batchedResults = batchedUris.length
    ? await fetchBatchedResolveEntries(batchedUris).catch(() => batchedUris.map((uri): [string, any] => [uri, null]))
    : [];
  const batchedEntries = batchedResults.filter(([, claim]) => claim);
  const unresolvedBatchedUris = batchedResults.filter(([, claim]) => !claim).map(([uri]) => uri);
  const resolveEntries = await fetchResolveEntries([...immutableUris, ...resolveUris, ...unresolvedBatchedUris]);

  return Object.fromEntries([...channelEntries, ...batchedEntries, ...resolveEntries].filter(([, claim]) => claim));
}

async function fetchResolveEntries(urls: Array<string>): Promise<Array<[string, any]>> {
  return Promise.all(
    urls.map(async (uri): Promise<[string, any]> => {
      const immutableClaim = await fetchHyperbeamImmutableResolve(uri).catch(() => null);
      if (immutableClaim) return [uri, immutableClaim];

      const claimId = fullClaimIdFromUri(uri);
      if (claimId) {
        try {
          const result = messagePayload(await fetchCacheJson(cacheReadPath(`odysee/claim-id/${claimId}`), true));
          const claim = sdkClaimFromHyperbeam(cacheReadClaim(result), claimId);
          if (claim) return [uri, await immutableClaimForResolvedUri(uri, claim)];
        } catch (_e) {}
      }

      const storeClaim = await fetchCachedStoreJsonOrNull(storePath('odysee/claim', uri))
        .then(responsePayload)
        .catch(() => null);
      if (storeClaim) {
        const claim = sdkClaimFromHyperbeam(storeClaim);
        if (claim) return [uri, await immutableClaimForResolvedUri(uri, claim)];
      }

      const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/resolve`, { uri }).catch(() => null);
      const result = responsePayload(response);
      const claim = sdkClaimFromHyperbeam(result?.[uri] || result);
      if (claim) return [uri, await immutableClaimForResolvedUri(uri, claim)];

      return [uri, await fetchHyperbeamUploadResolve(uri).catch(() => null)];
    })
  );
}

async function fetchBatchedResolveEntries(urls: Array<string>): Promise<Array<[string, any]>> {
  const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/resolve`, { urls });
  const result = responsePayload(response);

  return Promise.all(
    urls.map(async (uri): Promise<[string, any]> => {
      const claim = sdkClaimFromHyperbeam(result?.[uri] || result);
      return [uri, claim ? await immutableClaimForResolvedUri(uri, claim) : null];
    })
  );
}

export async function fetchHyperbeamGet(params: any): Promise<any | null> {
  const uri = params?.uri || params?.url;
  const id = params?.id || params?.outpoint || params?.immutable_id || params?.immutableId;
  if (!uri && !id) return null;

  if (uri) {
    const immutablePayload = playbackPayloadFromUploadClaim(
      await fetchHyperbeamImmutableResolve(uri).catch(() => null)
    );
    if (immutablePayload) return immutablePayload;

    const uploadPayload = playbackPayloadFromUploadClaim(await fetchHyperbeamUploadResolve(uri).catch(() => null));
    if (uploadPayload) return uploadPayload;
  }

  const response = await fetchDeviceJson(
    `${STREAM_DEVICE}/playback`,
    uri ? { uri, mode: 'hyperbeam', media_base_url: hyperbeamBaseUrl() } : { id }
  );
  return playbackPayloadFromHyperbeam(responsePayload(response));
}

export async function fetchHyperbeamAccountSdk(method: string, params: Record<string, any>): Promise<any | null> {
  const key = method.replace(/_/g, '-');
  const response = await fetchDeviceJson(`${ACCOUNT_DEVICE}/${key}`, params || {});
  const result = responsePayload(response);
  return result || null;
}

export async function fetchHyperbeamAccountApi(action: string, params: Record<string, any> = {}): Promise<any | null> {
  const response = await fetchDeviceJson(`${ACCOUNT_DEVICE}/${action}`, params || {});
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

type DecodedClaimMetadata = {
  signedChannelId?: string;
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
  const claimIds = claimIdCsv
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (claimIds.some((id) => !/^[0-9a-f]{40}$/i.test(id))) return null;

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

export async function fetchHyperbeamSearch(params: ClaimSearchOptions): Promise<ClaimSearchResponse | null> {
  try {
    const response = await fetchDeviceJson(`${SEARCH_DEVICE}/query`, params);
    const result = sdkSearchFromHyperbeam(responsePayload(response));
    const items = result && result.items;

    if (!Array.isArray(items)) return null;

    const resolvedItems = await hydrateNativeSearchItems(items);
    return {
      ...result,
      items: resolvedItems,
    };
  } catch (error) {
    void error;
    return null;
  }
}

async function hydrateNativeSearchItems(items: Array<any>): Promise<Array<any>> {
  const nativeIds = items.filter(isNativeSearchHit).map(searchHitId).filter(Boolean).map(String);
  if (!nativeIds.length) return items;

  const nativeClaims = await fetchHyperbeamUploadClaimsForIds([...new Set(nativeIds)]);
  if (!nativeClaims.length) return items;

  const nativeById: Record<string, any> = {};
  nativeClaims.forEach((claim) => {
    if (claim?.claim_id) nativeById[claim.claim_id] = claim;
  });

  return items.map((item) => {
    const id = String(searchHitId(item) || '');
    return nativeById[id] || item;
  });
}

function searchHitId(item: any) {
  return value(
    item,
    'claim_id',
    'claim-id',
    'immutable_id',
    'immutable-id',
    'doc_id',
    'doc-id',
    'search_id',
    'search-id'
  );
}

function isNativeSearchHit(item: any): boolean {
  return Boolean(
    item &&
    (value(item, 'source_system', 'source-system') === 'hyperbeam-native' ||
      value(item, 'hyperbeam') ||
      value(item, 'hyperbeam_upload', 'hyperbeam-upload'))
  );
}

export async function fetchHyperbeamClaimsByIds(ids: Array<string>): Promise<Array<Claim>> {
  const requestedIds = ids.filter(Boolean);
  const uploadClaims = await fetchHyperbeamUploadClaims(
    { claim_ids: requestedIds },
    { 'x-odysee-claim-ids': requestedIds.join(',') }
  );
  const resolvedIds = new Set(uploadClaims.map((claim) => claim?.claim_id).filter(Boolean));
  const unresolvedIds = requestedIds.filter((id) => !resolvedIds.has(id));
  if (!unresolvedIds.length) return uploadClaims;

  const directClaims = (await Promise.all(unresolvedIds.map((id) => fetchHyperbeamImmutableClaim(id)))).flat();
  return [...uploadClaims, ...directClaims];
}

async function fetchHyperbeamUploadClaimsForIds(claimIds: Array<string>): Promise<Array<Claim>> {
  const ids = claimIds.filter(Boolean);
  if (!ids.length) return [];

  const indexedClaims = await fetchHyperbeamUploadClaims({ claim_ids: ids }, { 'x-odysee-claim-ids': ids.join(',') });
  const resolvedIds = new Set(indexedClaims.map((claim) => claim?.claim_id).filter(Boolean));
  const unresolvedIds = ids.filter((id) => !resolvedIds.has(id));
  if (!unresolvedIds.length) return indexedClaims;

  const directClaims = await Promise.all(unresolvedIds.map((id) => fetchHyperbeamImmutableClaim(id)));
  return [...indexedClaims, ...directClaims.flat()];
}

async function fetchHyperbeamImmutableClaim(claimId: string): Promise<Array<Claim>> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) return [];

  try {
    const url = `${baseUrl}/${encodeURIComponent(claimId)}`;
    const requestHeaders = {
      accept: 'application/json',
      'accept-bundle': 'true',
    };
    const callId = `immutable-read-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const immutablePath = `/${claimId}`;
    pushHyperbeamDebug(
      'request',
      {
        ...debugPageContext(),
        callId,
        method: 'GET',
        url,
        urlParts: urlParts(url),
        devicePath: immutablePath,
        deviceLayer: 'store',
        sourceLayer: 'store',
        nativeSource: 'store',
        requestHeaders,
        requestKey: `claim:${claimId}`,
      },
      'info'
    );
    const response = await fetch(url, {
      method: 'GET',
      credentials: hyperbeamFetchCredentials(baseUrl),
      headers: requestHeaders,
      signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
    });
    const json = await response.json().catch(() => null);
    const claimPayload = messagePayload(json);
    const expandedClaim = await expandHyperbeamImmutableClaim(baseUrl, claimId, cacheReadClaim(claimPayload));
    pushHyperbeamDebug(
      'response',
      {
        ...debugPageContext(),
        callId,
        method: 'GET',
        status: response.status,
        ok: response.ok,
        url,
        urlParts: urlParts(url),
        devicePath: immutablePath,
        deviceLayer: 'store',
        sourceLayer: 'store',
        nativeSource: 'store',
        requestHeaders,
        responseHeaders: debugResponseHeaders(response),
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        requestKey: `claim:${claimId}`,
        claimKeys: uploadListClaimKeys(json) || claimId,
        body: expandedClaim || json,
      },
      response.ok ? 'ok' : 'error'
    );
    if (!response.ok || !json) return [];

    const claim = sdkClaimFromHyperbeam(expandedClaim || cacheReadClaim(claimPayload), claimId);
    return claim?.claim_id ? [claim] : [];
  } catch {
    return [];
  }
}

async function expandHyperbeamImmutableClaim(baseUrl: string, claimId: string, claim: any) {
  if (!claim || typeof claim !== 'object') return claim;
  const needsHyperbeam = !claim.hyperbeam && Boolean(value(claim, 'hyperbeam+link', 'hyperbeam-link'));
  const needsValue = !claim.value && Boolean(value(claim, 'value+link', 'value-link'));
  const needsMeta = !claim.meta && Boolean(value(claim, 'meta+link', 'meta-link'));
  const needsSigningChannel =
    !claim.signing_channel && Boolean(value(claim, 'signing_channel+link', 'signing-channel+link'));
  const existingValue = claim.value;
  const needsSource = Boolean(
    existingValue &&
    !existingValue.source &&
    (value(existingValue, 'source+link', 'source-link') || value(claim, 'value+link', 'value-link'))
  );
  const needsThumbnail = Boolean(
    existingValue &&
    !existingValue.thumbnail &&
    (value(existingValue, 'thumbnail+link', 'thumbnail-link') || value(claim, 'value+link', 'value-link'))
  );
  if (!needsHyperbeam && !needsValue && !needsMeta && !needsSigningChannel && !needsSource && !needsThumbnail)
    return claim;

  const [hyperbeam, claimValue0, meta, signingChannel0] = await Promise.all([
    needsHyperbeam ? fetchHyperbeamImmutableSubmessage(baseUrl, claimId, 'hyperbeam') : Promise.resolve(null),
    needsValue ? fetchHyperbeamImmutableSubmessage(baseUrl, claimId, 'value') : Promise.resolve(null),
    needsMeta ? fetchHyperbeamImmutableSubmessage(baseUrl, claimId, 'meta') : Promise.resolve(null),
    needsSigningChannel
      ? fetchHyperbeamImmutableSubmessage(baseUrl, claimId, 'signing_channel')
      : Promise.resolve(null),
  ]);
  const claimValue = claimValue0 || existingValue;
  const signingChannel = signingChannel0 ? await expandHyperbeamLinkedChannel(baseUrl, claimId, signingChannel0) : null;
  const source =
    claimValue && !claimValue.source && value(claimValue, 'source+link', 'source-link')
      ? await fetchHyperbeamImmutableSubmessage(baseUrl, claimId, 'value/source')
      : null;
  const thumbnail =
    claimValue && !claimValue.thumbnail && value(claimValue, 'thumbnail+link', 'thumbnail-link')
      ? await fetchHyperbeamImmutableSubmessage(baseUrl, claimId, 'value/thumbnail')
      : null;
  const expandedValue = claimValue
    ? { ...claimValue, ...(source ? { source } : {}), ...(thumbnail ? { thumbnail } : {}) }
    : null;

  return {
    ...claim,
    ...(hyperbeam ? { hyperbeam } : {}),
    ...(meta ? { meta } : {}),
    ...(signingChannel ? { signing_channel: signingChannel } : {}),
    ...(expandedValue ? { value: expandedValue } : {}),
  };
}

async function expandHyperbeamLinkedChannel(baseUrl: string, claimId: string, channel: any) {
  if (!channel || typeof channel !== 'object') return channel;
  if (channel.value || !value(channel, 'value+link', 'value-link')) return channel;

  const channelValue = await fetchHyperbeamImmutableSubmessage(baseUrl, claimId, 'signing_channel/value');
  return channelValue ? { ...channel, value: channelValue } : channel;
}

async function fetchHyperbeamImmutableSubmessage(baseUrl: string, claimId: string, path: string) {
  try {
    const response = await fetch(`${baseUrl}/${encodeURIComponent(claimId)}/${path}`, {
      method: 'GET',
      credentials: hyperbeamFetchCredentials(baseUrl),
      headers: { accept: 'application/json' },
      signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return responsePayload(await response.json().catch(() => null));
  } catch {
    return null;
  }
}

async function fetchHyperbeamUploadClaims(body: Record<string, any>, headers: Record<string, string> = {}) {
  try {
    const url = '/$/api/hyperbeam-upload/v1/list';
    const requestHeaders = {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
    };
    const callId = `upload-list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    pushHyperbeamDebug(
      'request',
      {
        ...debugPageContext(),
        callId,
        method: 'POST',
        url,
        devicePath: url,
        deviceLayer: 'browser-resource',
        sourceLayer: 'browser-resource',
        nativeSource: 'upload-index',
        requestHeaders,
        requestBody: body,
        requestKey: uploadListLifecycleKey(body),
      },
      'info'
    );
    const response = await fetch('/$/api/hyperbeam-upload/v1/list', {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    pushHyperbeamDebug(
      'response',
      {
        ...debugPageContext(),
        callId,
        method: 'POST',
        status: response.status,
        ok: response.ok,
        url,
        devicePath: url,
        deviceLayer: 'browser-resource',
        sourceLayer: 'browser-resource',
        nativeSource: 'upload-index',
        requestHeaders,
        requestBody: body,
        responseHeaders: debugResponseHeaders(response),
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        requestKey: uploadListLifecycleKey(body),
        claimKeys: uploadListClaimKeys(json),
        body: json,
      },
      response.ok ? 'ok' : 'error'
    );
    if (!response.ok || !json) return [];

    const result = responsePayload(json);
    return Array.isArray(result?.items) ? result.items.filter((claim) => claim?.value_type === 'stream') : [];
  } catch {
    return [];
  }
}

function uploadListLifecycleKey(requestBody: Record<string, any>) {
  if (Array.isArray(requestBody.claim_ids) && requestBody.claim_ids.length)
    return `claim:${requestBody.claim_ids.join(',')}`;
  if (requestBody.claim_id) return `claim:${requestBody.claim_id}`;
  if (Array.isArray(requestBody.channel_ids) && requestBody.channel_ids.length)
    return `channels:${requestBody.channel_ids.join(',')}`;
  return 'upload-index:list';
}

function uploadListClaimKeys(responseBody: any) {
  const result = responsePayload(responseBody);
  const claimIds = result?.items?.map((item: any) => item?.claim_id).filter(Boolean);
  return Array.isArray(claimIds) ? claimIds.join(',') : undefined;
}

function debugPageContext() {
  if (typeof window === 'undefined') return {};
  return {
    pageUrl: window.location.href,
    pagePath: `${window.location.pathname}${window.location.search}${window.location.hash}`,
  };
}

function urlParts(url: string) {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : undefined);
    return {
      origin: parsed.origin,
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams.entries()),
    };
  } catch {
    return { path: url };
  }
}

function debugResponseHeaders(response: Response) {
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  if (Object.keys(responseHeaders).length === 0) {
    responseHeaders['capture-note'] = 'No response headers are exposed to frontend JavaScript for this response.';
  }
  return responseHeaders;
}

export async function fetchHyperbeamResolveClaimIds(params: ClaimSearchOptions): Promise<ClaimSearchResponse | null> {
  const claimIds = stringList((params as any).claim_ids || (params as any).claimIds);
  const uploadIds = claimIds.filter((claimId) => !LBRY_CLAIM_ID_RE.test(claimId));
  const uploadItems = uploadIds.length ? await fetchHyperbeamUploadClaimsForIds(uploadIds) : [];
  let result: any = null;

  try {
    const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/resolve`, params);
    result = sdkSearchFromHyperbeam(responsePayload(response));
  } catch (_e) {
    result = null;
  }

  const items = Array.isArray(result?.items) ? result.items : [];
  const existingIds = new Set(items.map((claim) => claim?.claim_id).filter(Boolean));
  const mergedItems = [...uploadItems.filter((claim) => !existingIds.has(claim.claim_id)), ...items];

  if (!mergedItems.length && !Array.isArray(result?.items)) return null;

  return {
    ...result,
    items: mergedItems,
    page: result?.page || 1,
    page_size: result?.page_size || mergedItems.length,
    total_items: Math.max(result?.total_items || 0, mergedItems.length),
    total_pages: Math.max(result?.total_pages || 0, mergedItems.length ? 1 : 0),
  };
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
  if (!claim || isHyperbeamUploadClaim(claim)) return null;

  // The single `GET /<id>` resolve already carries the full signing channel;
  // normalizing it locally saves a channel-device round trip.
  const signingChannel: any = claim.signing_channel;
  if (signingChannel && signingChannel.claim_id && signingChannel.value) {
    return channelFromHyperbeam(signingChannel);
  }

  const result = await fetchDeviceJson(`${CHANNEL_DEVICE}/channel`, { channel: signingChannel || claim });
  return result ? channelFromHyperbeam(result) : null;
}

export async function fetchHyperbeamStreamVerification(
  claim: Claim | null | undefined,
  uri: string
): Promise<any | null> {
  if (!claim || isHyperbeamUploadClaim(claim)) return null;

  const immutableId = immutableReadIdFromClaim(claim);
  const result = await fetchDeviceJson(
    `${STREAM_DEVICE}/verified-stream`,
    immutableId ? { id: immutableId } : compactParams({ claim, url: uri })
  );
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
      const params = deviceRequestParams(path, body);
      traceAuthDeviceRequest(path, authToken);
      traceAuthRequestBody(path, params, authToken);
      return await fetchAuthDeviceJson(path, params, authToken);
    }

    const authToken = await getOdyseeAuthToken(path);
    const params = withAuthParams(deviceRequestParams(path, body), authToken);
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
      if (isHyperbeamEnabled()) throw hyperbeamDeviceError(path, response.status);
      return null;
    }
    return await response.json();
  } catch (error) {
    if (isHyperbeamEnabled()) throw hyperbeamDeviceFetchError(path, error);
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

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...authTokenHeader(authToken),
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (isHyperbeamEnabled()) throw hyperbeamDeviceFetchError(path, error);
    return null;
  }
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
    if (isHyperbeamEnabled()) throw hyperbeamDeviceError(path, response.status);
    return null;
  }

  return parseJsonString(responseText);
}

function requestKeyForAuthDevice(path: string, body: Record<string, any>) {
  const claimId = body.claim_id || body.claim_ids || body['claim-id'] || body['claim-ids'];
  return claimId ? `claim:${claimId}` : `${path}:${stableJson(body).slice(0, 180)}`;
}

function hyperbeamDeviceError(path: string, status: number) {
  if (isCommentronDevicePath(path) && status >= 500) return new TypeError(COMMENTRON_FAILURE);
  return new Error(`HyperBEAM ${path} failed with ${status}`);
}

function hyperbeamDeviceFetchError(path: string, error: any) {
  if (isCommentronDevicePath(path) && isFetchTimeoutOrNetworkError(error)) return new TypeError(COMMENTRON_FAILURE);
  return error;
}

function isFetchTimeoutOrNetworkError(error: any) {
  const name = String(error?.name || '');
  const message = String(error?.message || error || '');
  return (
    name === 'TimeoutError' || name === 'AbortError' || message === 'Failed to fetch' || message === 'signal timed out'
  );
}

function isCommentronDevicePath(path: string) {
  return path.startsWith(`${COMMENT_DEVICE}/`) || path.startsWith(`${REACTION_DEVICE}/`);
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

function buildCacheUrl(baseUrl: string, path: string): string {
  if (path.startsWith('/')) return `${baseUrl}${path}`;
  return `${baseUrl}/~cache@1.0/${path}`;
}

function fetchCacheJson(path: string, acceptBundle: boolean = false): Promise<any | null> {
  const key = `cache:${path}:${String(acceptBundle)}`;
  const now = Date.now();
  const cached = deviceReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchCacheJsonUncached(path, acceptBundle).catch((error) => {
    const failed = Promise.reject(error);
    failed.catch(() => {});
    deviceReadCache.set(key, { expiresAt: Date.now() + HYPERBEAM_FAILED_READ_CACHE_MS, promise: failed });
    throw error;
  });
  deviceReadCache.set(key, { expiresAt: now + HYPERBEAM_READ_CACHE_MS, promise });
  return promise;
}

async function fetchCacheJsonUncached(path: string, acceptBundle: boolean): Promise<any | null> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) {
    if (isHyperbeamEnabled()) throw new Error('HyperBEAM node is not configured');
    return null;
  }

  const response = await fetch(buildCacheUrl(baseUrl, path), {
    method: 'GET',
    credentials: hyperbeamFetchCredentials(baseUrl),
    headers: {
      Accept: 'application/json',
      ...(acceptBundle ? { 'Accept-Bundle': 'true' } : {}),
    },
    signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    if (isHyperbeamEnabled()) throw new Error(`HyperBEAM ${path} failed with ${response.status}`);
    return null;
  }

  return await response.json();
}

function cacheReadPath(id: string): string {
  return `read?read=${encodeURIComponent(String(id).replace(/^\/+/, ''))}`;
}

function cacheListPath(path: string, params: Record<string, any> = {}): string {
  const urlParams = new URLSearchParams({ list: String(path).replace(/^\//, '') });
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') urlParams.set(key, String(value));
  });
  return `list?${urlParams.toString()}`;
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

function deviceRequestParams(path: string, body: Record<string, any>): Record<string, any> {
  const params = compactParams(body);
  return PRESERVE_PRIVATE_DEVICE_PATHS.has(path) ? params : stripPrivateParams(params);
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

function messagePayload(response: any): any {
  if (!response) return null;
  if (
    isObject(response) &&
    (value(response, 'device') ||
      value(response, 'claim-id', 'claim_id') ||
      value(response, 'claim+link', 'claim-link') ||
      value(response, 'value+link', 'value-link'))
  ) {
    return response;
  }
  return responsePayload(response);
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
      const batched = claimIdFromUri(uri) && !fullClaimIdFromUri(uri);
      groups[batched ? 'batchedUris' : 'resolveUris'].push(uri);
      return groups;
    },
    { batchedUris: [], resolveUris: [] } as { batchedUris: Array<string>; resolveUris: Array<string> }
  );
}

const FULL_CLAIM_ID_REGEX = /^[0-9a-f]{40}$/i;

function fullClaimIdFromUri(uri: string): string | null {
  const claimId = claimIdFromUri(uri);
  return claimId && FULL_CLAIM_ID_REGEX.test(claimId) ? claimId : null;
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

async function immutableClaimForResolvedUri(uri: string, claim: any): Promise<any> {
  const immutableId = immutableReadIdFromClaim(claim);
  if (!immutableId || !isOutpointId(immutableId)) return claim;

  const result = await fetchCachedImmutableJsonOrNull(immutableId).catch(() => null);
  const payload = storePayload(result);
  if (!payload) return claim;

  const decodedClaim = decodeClaimMetadata(payload);
  let name: string | undefined;
  try {
    const parsed = parseURI(uri);
    name = parsed.streamName || parsed.claimName;
  } catch {}

  const immutableClaim = immutableClaimFromHyperbeam(result, immutableId, claim.signing_channel, decodedClaim, name);
  if (!immutableClaim) return claim;

  // The resolved claim is authoritative for the mutable lbry identity (claim id
  // + claim urls); the store message keys are CORS-hidden header fields in the
  // browser, so the immutable claim may only know the outpoint id.
  const resolvedClaimId = String(claim.claim_id || '');
  const legacyIdentity = FULL_CLAIM_ID_REGEX.test(resolvedClaimId)
    ? {
        claim_id: resolvedClaimId,
        canonical_url: claim.canonical_url || immutableClaim.canonical_url,
        permanent_url: claim.permanent_url || immutableClaim.permanent_url,
        short_url: claim.short_url || immutableClaim.short_url,
        hyperbeam: compactParams({
          ...immutableClaim.hyperbeam,
          'source-claim-id': value(immutableClaim.hyperbeam, 'source-claim-id') || resolvedClaimId,
        }),
      }
    : {};

  return {
    ...claim,
    ...immutableClaim,
    ...legacyIdentity,
    signing_channel: immutableClaim.signing_channel || claim.signing_channel,
    value: {
      ...claim.value,
      ...immutableClaim.value,
      source: {
        ...claim.value?.source,
        ...immutableClaim.value?.source,
      },
    },
  };
}

function immutableReadIdFromClaim(claim: any): string | null {
  const explicit =
    value(claim, 'outpoint', 'immutable_id', 'immutable-id') || value(claim?.hyperbeam, 'immutable_id', 'immutable-id');
  if (explicit && (isOutpointId(explicit) || isStandaloneImmutableId(explicit))) return String(explicit);

  const txid = value(claim, 'txid');
  const nout = value(claim, 'nout');
  return typeof txid === 'string' && (typeof nout === 'number' || typeof nout === 'string') ? `${txid}:${nout}` : null;
}

function uriWithClaimId(uri: any, claimId: any): string | null {
  if (!uri || !claimId) return null;
  const text = String(uri);
  const hashIndex = text.lastIndexOf('#');
  return hashIndex === -1 ? `${text}#${claimId}` : `${text.slice(0, hashIndex)}#${claimId}`;
}

function sdkClaimFromHyperbeam(result: any, requestedClaimId?: string): any {
  if (!result) return null;
  const claim = messagePayload(result.claim || result);
  const nativeUpload = Boolean(
    value(claim, 'hyperbeam') ||
    value(claim, 'hyperbeam+link', 'hyperbeam-link') ||
    value(claim, 'hyperbeam_upload', 'hyperbeam-upload')
  );
  const claimId = nativeUpload && requestedClaimId ? requestedClaimId : value(claim, 'claim_id', 'claim-id');
  if (!claim || !claimId) return claim;
  const txid = value(claim, 'txid', 'tx-id');
  const nout = value(claim, 'nout', 'n-out');
  const outpoint = nativeUpload ? null : claimOutpoint(txid, nout);
  const hyperbeam = value(claim, 'hyperbeam') || {};
  const mediaId = value(hyperbeam, 'media_id', 'media-id', 'mediaId') || value(claim, 'claim_id', 'claim-id');
  const valueType = value(claim, 'value_type', 'value-type') || claim.value_type;
  const meta = normalizeHyperbeamClaimMeta(value(claim, 'meta'));

  return {
    ...claim,
    claim_id: claimId,
    immutable_id: nativeUpload ? claimId : value(claim, 'immutable_id', 'immutable-id') || claimId,
    txid: nativeUpload ? claimId : txid,
    ...(nativeUpload
      ? {
          hyperbeam: {
            ...hyperbeam,
            upload_id: claimId,
            media_id: mediaId,
            read_path: value(hyperbeam, 'read_path', 'read-path') || (mediaId ? `/${mediaId}` : undefined),
          },
        }
      : {}),
    ...(outpoint
      ? {
          outpoint,
          immutable_id: outpoint,
          immutable_store_path:
            value(claim, 'claim-output-store-path', 'claim-proof-store-path') || `odysee/claim-output/${txid}/${nout}`,
        }
      : {}),
    name: value(claim, 'name', 'claim-name') || claim.name,
    ...(nativeUpload
      ? {
          streaming_url: `/$/api/hyperbeam-upload/v1/read/${encodeURIComponent(claimId)}`,
          download_url: `/$/api/hyperbeam-upload/v1/read/${encodeURIComponent(claimId)}`,
        }
      : {}),
    canonical_url: nativeUpload
      ? uriWithClaimId(value(claim, 'canonical_url', 'canonical-url') || claim.canonical_url, claimId)
      : value(claim, 'canonical_url', 'canonical-url') || claim.canonical_url,
    permanent_url: nativeUpload
      ? uriWithClaimId(value(claim, 'permanent_url', 'permanent-url') || claim.permanent_url, claimId)
      : value(claim, 'permanent_url', 'permanent-url') || claim.permanent_url,
    short_url: nativeUpload
      ? uriWithClaimId(value(claim, 'short_url', 'short-url') || claim.short_url, claimId)
      : value(claim, 'short_url', 'short-url') || claim.short_url,
    value_type: valueType,
    meta,
    signing_channel: claim.signing_channel
      ? normalizeHyperbeamChannelClaim(claim.signing_channel)
      : claim.signing_channel,
  };
}

function normalizeHyperbeamChannelClaim(channel: any): any {
  return {
    ...channel,
    type: channel.type || 'claim',
    value_type: value(channel, 'value_type', 'value-type') || 'channel',
    meta: normalizeHyperbeamClaimMeta(value(channel, 'meta')),
  };
}

function normalizeHyperbeamClaimMeta(meta: any = {}): any {
  return {
    activation_height: meta.activation_height ?? meta['activation-height'] ?? 0,
    claims_in_channel: meta.claims_in_channel ?? meta['claims-in-channel'] ?? 0,
    creation_height: meta.creation_height ?? meta['creation-height'] ?? 0,
    creation_timestamp: meta.creation_timestamp ?? meta['creation-timestamp'] ?? 0,
    effective_amount: meta.effective_amount ?? meta['effective-amount'] ?? '0',
    expiration_height: meta.expiration_height ?? meta['expiration-height'] ?? 0,
    is_controlling: meta.is_controlling ?? meta['is-controlling'] ?? true,
    reposted: meta.reposted ?? 0,
    support_amount: meta.support_amount ?? meta['support-amount'] ?? '0',
    ...meta,
  };
}

function claimOutpoint(txid: any, nout: any): string | null {
  if (!txid && txid !== 0) return null;
  if (nout === undefined || nout === null || nout === '') return null;
  return `${txid}:${nout}`;
}

function cacheReadClaim(result: any): any {
  if (Array.isArray(result?.items) && result.items.length) return result.items[0];
  if (Array.isArray(result?.claims) && result.claims.length) return result.claims[0];
  return result;
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
      return playbackPayloadFromHyperbeam(JSON.parse(body));
    } catch {}
  }

  const payload = {
    ...result,
    streaming_url: value(result, 'streaming_url', 'streaming-url') || result.streaming_url,
    download_url: value(result, 'download_url', 'download-url') || result.download_url,
    sd_hash: value(result, 'sd_hash', 'sd-hash') || result.sd_hash,
    media_type:
      value(result, 'media_type', 'media-type') ||
      result.media_type ||
      (value(result, 'device') === 'lbry-stream@1.0' && value(result, 'sd_hash', 'sd-hash') ? 'video/mp4' : undefined),
    claim_id: value(result, 'claim_id', 'claim-id') || result.claim_id,
    claim_name: value(result, 'claim_name', 'claim-name') || result.claim_name,
  };
  // The stream device returns ready-to-use node media URLs; only fall back to
  // reconstructing one when the payload does not carry them.
  const mediaUrl = payload.streaming_url || payload.download_url ? '' : hyperbeamMediaUrlFromPayload(payload);

  return {
    ...payload,
    streaming_url: payload.streaming_url || mediaUrl,
    download_url: payload.download_url || mediaUrl,
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

function stringList(source: any): Array<string> {
  if (Array.isArray(source)) return source.map(String).filter(Boolean);
  return source ? [String(source)] : [];
}

function isObject(source: any): boolean {
  return Boolean(source) && typeof source === 'object' && !Array.isArray(source);
}

function toNumber(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// --- Generic-path upload/read-by-id support (ported from bhavyagor/auth-upload) ---

async function fetchHyperbeamImmutableResolve(uri: string): Promise<any | null> {
  const immutableId = immutableRouteIdFromUri(uri);
  if (!immutableId) return null;

  const result = await fetchCachedImmutableJsonOrNull(immutableId);
  const decodedClaim = decodeClaimMetadata(storePayload(result));
  const signingChannel = decodedClaim?.signedChannelId
    ? await fetchCachedImmutableChannelJsonOrNull(decodedClaim.signedChannelId).catch(() => null)
    : null;
  const parsed = parseURI(uri);
  const name = parsed.streamName || parsed.claimName;
  const claim = immutableClaimFromHyperbeam(result, immutableId, signingChannel, decodedClaim, name);
  if (!claim) return null;

  return !name || claim.name === name ? claim : null;
}

async function fetchHyperbeamUploadResolve(uri: string): Promise<any | null> {
  let parsed;
  try {
    parsed = parseURI(uri);
  } catch {
    return null;
  }

  const claimId = parsed.channelName ? parsed.streamClaimId : parsed.streamClaimId || parsed.claimId;
  const name = parsed.streamName || (parsed.channelName ? undefined : parsed.claimName);
  if (!claimId && !name) return null;

  const result = await fetchHyperbeamUploadList(
    compactParams({
      claim_ids: claimId ? [claimId] : undefined,
      name,
      page_size: 1,
    })
  ).catch(() => null);

  return Array.isArray(result?.items) ? result.items[0] || null : null;
}

async function fetchClaimIdChannelEntries(urls: Array<string>): Promise<Array<[string, any]>> {
  const uriByClaimId = new Map<string, string>();
  urls.forEach((uri) => {
    const claimId = claimIdFromChannelUri(uri);
    if (claimId) uriByClaimId.set(claimId.toLowerCase(), uri);
  });
  const storeEntries = await Promise.all(
    Array.from(uriByClaimId.entries()).map(async ([claimId, uri]): Promise<[string, any] | null> => {
      const storeClaim = await fetchCachedStoreJsonOrNull(storePath('odysee/claim-id', claimId)).then(responsePayload);
      const claim = storeClaim ? sdkClaimFromHyperbeam(storeClaim) : null;
      return claim ? [uri, await immutableClaimForResolvedUri(uri, claim)] : null;
    })
  );
  const resolvedEntries = storeEntries.filter(Boolean);
  const resolvedUris = new Set(resolvedEntries.map(([uri]) => uri));
  const unresolvedClaimIds = Array.from(uriByClaimId.entries())
    .filter(([, uri]) => !resolvedUris.has(uri))
    .map(([claimId]) => claimId);
  if (!unresolvedClaimIds.length) return resolvedEntries;

  const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/search`, {
    claim_ids: unresolvedClaimIds,
  });
  const search = sdkSearchFromHyperbeam(responsePayload(response));
  const items = Array.isArray(search?.items) ? search.items : [];

  const fallbackEntries = (
    await Promise.all(
      items.map(async (item: any): Promise<[string, any] | null> => {
        const claim = sdkClaimFromHyperbeam(item);
        const claimId = value(claim, 'claim_id', 'claim-id');
        const uri = claimId && uriByClaimId.get(String(claimId).toLowerCase());
        return uri ? [uri, await immutableClaimForResolvedUri(uri, claim)] : null;
      })
    )
  ).filter(Boolean) as Array<[string, any]>;

  return [...resolvedEntries, ...fallbackEntries];
}

export async function fetchHyperbeamUploadList(params: ClaimSearchOptions = {}): Promise<ClaimSearchResponse | null> {
  const response = await fetchDeviceJson(`${UPLOAD_DEVICE}/list`, params);
  const result = sdkSearchFromHyperbeam(responsePayload(response));
  const sourceItems = result && result.items;
  if (!Array.isArray(sourceItems)) return null;

  const items = sourceItems.map(uploadClaimFromHyperbeam).filter((claim) => claimMatchesSearchParams(claim, params));
  const pageSize = toNumber(value(result, 'page_size', 'page-size'), params.page_size || items.length || 1);
  const totalItems = toNumber(value(result, 'total_items', 'total-items'), items.length);

  return {
    ...result,
    items,
    page: toNumber(result.page, params.page || 1),
    page_size: pageSize,
    total_items: Math.max(totalItems, items.length),
    total_pages: toNumber(
      value(result, 'total_pages', 'total-pages'),
      totalPages(Math.max(totalItems, items.length), pageSize)
    ),
  };
}

async function fetchHyperbeamImmutableList(
  immutableIds: Array<string>,
  params: ClaimSearchOptions
): Promise<ClaimSearchResponse> {
  const uniqueIds = Array.from(new Set(immutableIds));
  const claims = (
    await Promise.all(
      uniqueIds.map(async (id) => {
        const result = await fetchCachedImmutableJsonOrNull(id);
        const decodedClaim = decodeClaimMetadata(storePayload(result));
        const signingChannel = decodedClaim?.signedChannelId
          ? await fetchCachedImmutableChannelJsonOrNull(decodedClaim.signedChannelId).catch(() => null)
          : null;
        return immutableClaimFromHyperbeam(result, id, signingChannel, decodedClaim);
      })
    )
  ).filter(Boolean);
  const filtered = claims.filter((claim) => claimMatchesSearchParams(claim, params));
  const page = toNumber(params.page, 1);
  const pageSize = toNumber(params.page_size, filtered.length || uniqueIds.length || 1);
  const start = Math.max(0, page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items,
    page,
    page_size: pageSize,
    total_items: filtered.length,
    total_pages: totalPages(filtered.length, pageSize),
  };
}

function fetchCachedImmutableJsonOrNull(id: string): Promise<any | null> {
  const key = `immutable:${id}`;
  const now = Date.now();
  const cached = deviceReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchImmutableJsonOrNull(id).catch((error) => {
    deviceReadCache.delete(key);
    throw error;
  });
  deviceReadCache.set(key, { expiresAt: now + HYPERBEAM_READ_CACHE_MS, promise });
  return promise;
}

function uploadClaimFromHyperbeam(item: any): any {
  const claim = sdkClaimFromHyperbeam(item);
  if (!claim) return claim;

  const hyperbeam = claim.hyperbeam || {};
  const claimValue = claim.value || {};
  const source = claimValue.source || {};
  const dataId = value(hyperbeam, 'data-id', 'data_id') || value(source, 'sd_hash', 'sd-hash', 'source');
  const recordId = value(hyperbeam, 'record-id', 'record_id') || claim.claim_id;
  const routeId = recordId || dataId || claim.claim_id;
  const routeUrl = routeId ? `lbry://${routeId}` : claimUrl(claim.name, routeId);
  const explicitMediaUrl = absoluteHyperbeamUrl(claim.streaming_url || claim.download_url || source.url);
  const mediaUrl =
    normalizedUploadMediaUrl(explicitMediaUrl, recordId) ||
    (recordId ? `${hyperbeamBaseUrl()}/${encodeDataPath(String(recordId))}` : '') ||
    (dataId ? `${hyperbeamBaseUrl()}/${encodeDataPath(String(dataId))}` : '');
  const releaseTime = value(claimValue, 'release_time', 'release-time') || claim.timestamp;

  return {
    ...claim,
    canonical_url: routeUrl,
    permanent_url: routeUrl,
    short_url: routeUrl,
    confirmations: Number(claim.confirmations) > 0 ? claim.confirmations : 1,
    is_my_output: claim.is_my_output !== undefined ? claim.is_my_output : true,
    streaming_url: claim.streaming_url || mediaUrl,
    download_url: claim.download_url || mediaUrl,
    value: {
      ...claimValue,
      release_time: releaseTime,
      source: {
        ...source,
        url: source.url || mediaUrl,
      },
    },
  };
}

function playbackPayloadFromUploadClaim(claim: any): any | null {
  if (!claim) return null;

  const source = claim.value?.source || {};
  const hyperbeam = claim.hyperbeam || {};
  const dataId = value(hyperbeam, 'data-id', 'data_id') || value(source, 'sd_hash', 'sd-hash', 'source');
  const recordId = value(hyperbeam, 'record-id', 'record_id') || value(claim, 'claim_id', 'claim-id');
  const explicitMediaUrl = absoluteHyperbeamUrl(claim.streaming_url || claim.download_url || source.url);
  const mediaUrl =
    normalizedUploadMediaUrl(explicitMediaUrl, recordId) ||
    (recordId ? `${hyperbeamBaseUrl()}/${encodeDataPath(String(recordId))}` : '') ||
    (dataId ? `${hyperbeamBaseUrl()}/${encodeDataPath(String(dataId))}` : '');
  if (!mediaUrl) return null;

  return {
    streaming_url: mediaUrl,
    download_url: mediaUrl,
    media_type: value(source, 'media_type', 'media-type') || 'application/octet-stream',
    source_size: value(source, 'size', 'byte-size', 'byte_size'),
    claim_id: value(claim, 'claim_id', 'claim-id'),
    claim_name: claim.name,
    file_name: source.name,
    sd_hash: dataId,
  };
}

function immutableClaimFromHyperbeam(
  result: any,
  immutableId: string,
  channelResult?: any,
  decodedClaim?: DecodedClaimMetadata | null,
  fallbackName?: string
): any | null {
  const payload = storePayload(result);
  if (!payload) return null;

  const immutableOutpoint = outpointParts(immutableId);
  const claimMetadata = decodedClaim || decodeClaimMetadata(payload);
  // Metadata now comes from the node-decoded `value` (existingValue below);
  // these remain only as empty fallbacks for pre-normalization responses.
  const decodedValue: Record<string, any> = {};
  const decodedSource: Record<string, any> = {};
  const channelPayload = storePayload(channelResult);
  const channelClaim = sdkClaimFromHyperbeam(channelPayload) || channelPayload;
  const claim = sdkClaimFromHyperbeam(payload) || payload;
  const existingValue = isObject(value(claim, 'value')) ? value(claim, 'value') : {};
  const payloadSource = isObject(value(payload, 'source')) ? value(payload, 'source') : {};
  const valueSource = isObject(value(existingValue, 'source')) ? value(existingValue, 'source') : {};
  const sourceClaimId =
    value(payload, 'claim_id', 'claim-id') ||
    value(claim, 'claim_id', 'claim-id') ||
    claimIdFromSignatureInput(value(payload, 'signature-input'));
  const txid = value(payload, 'txid') || immutableOutpoint?.txid;
  const nout = value(payload, 'nout') || immutableOutpoint?.nout;
  const device = value(payload, 'device');
  const outpoint =
    typeof txid === 'string' && (typeof nout === 'number' || typeof nout === 'string') ? `${txid}:${nout}` : null;
  const storeId = immutableId || outpoint || value(payload, 'id') || sourceClaimId;
  if (!storeId) return null;
  const frontendClaimId = sourceClaimId || String(storeId);
  const routeClaimId = webSafeImmutableId(storeId);

  const decodedTitle = value(decodedValue, 'title');
  const rawName =
    fallbackName ||
    value(payload, 'claim-name', 'claim_name', 'name') ||
    value(claim, 'name') ||
    slugFromText(decodedTitle);
  const name = safeClaimName(rawName || `store-${String(storeId).slice(0, 8)}`);
  const title = value(existingValue, 'title') || value(payload, 'title') || decodedTitle || rawName || name;
  const description =
    value(existingValue, 'description') || value(payload, 'description') || value(decodedValue, 'description') || '';
  const sdHash =
    value(payload, 'sd_hash', 'sd-hash') ||
    value(payloadSource, 'sd_hash', 'sd-hash') ||
    value(valueSource, 'sd_hash', 'sd-hash') ||
    value(decodedSource, 'sd_hash', 'sd-hash');
  const payloadContentType = value(payload, 'content-type');
  const mediaType =
    value(payload, 'media_type', 'media-type') ||
    value(payloadSource, 'media_type', 'media-type') ||
    value(valueSource, 'media_type', 'media-type') ||
    value(decodedSource, 'media_type', 'media-type') ||
    (isMediaContentType(payloadContentType) ? payloadContentType : undefined) ||
    (device === 'lbry-stream@1.0' && sdHash ? 'video/mp4' : undefined);
  const explicitMediaUrl = absoluteHyperbeamUrl(
    value(payload, 'streaming_url', 'streaming-url', 'download_url', 'download-url') ||
      value(payloadSource, 'url') ||
      value(valueSource, 'url')
  );
  const directMediaUrl =
    !String(storeId).includes(':') && isMediaContentType(mediaType)
      ? `${hyperbeamBaseUrl()}/${encodeDataPath(storeId)}`
      : '';
  const claimMediaUrl =
    name && isClaimId(sourceClaimId)
      ? `${hyperbeamBaseUrl()}/${STREAM_DEVICE}/media?claim-name=${encodeURIComponent(name)}&claim-id=${encodeURIComponent(String(sourceClaimId))}`
      : '';
  const mediaUrl =
    explicitMediaUrl ||
    claimMediaUrl ||
    hyperbeamMediaUrlFromPayload({
      ...payload,
      sd_hash: sdHash,
      'sd-hash': sdHash,
      media_type: mediaType,
      'media-type': mediaType,
    }) ||
    directMediaUrl;
  const canonicalUrl =
    value(claim, 'canonical_url', 'canonical-url') ||
    value(payload, 'canonical_url', 'canonical-url') ||
    claimUrl(name, routeClaimId);
  const permanentUrl =
    value(claim, 'permanent_url', 'permanent-url') ||
    value(payload, 'permanent_url', 'permanent-url') ||
    claimUrl(name, routeClaimId);
  const valueType =
    value(claim, 'value_type', 'value-type') ||
    value(payload, 'value_type', 'value-type') ||
    (device === 'lbry-channel@1.0' || device === 'odysee-channel@1.0' ? 'channel' : 'stream');
  const sourceName =
    value(payloadSource, 'name') ||
    value(valueSource, 'name') ||
    value(decodedSource, 'name') ||
    value(payload, 'filename') ||
    (mediaType === 'video/mp4' ? `${name}.mp4` : undefined);
  const signingChannel =
    channelClaim && value(channelClaim, 'claim_id', 'claim-id') === claimMetadata?.signedChannelId
      ? channelClaim
      : undefined;

  return compactParams({
    ...claim,
    claim_id: frontendClaimId,
    txid,
    nout,
    name,
    canonical_url: canonicalUrl,
    permanent_url: permanentUrl,
    short_url: value(claim, 'short_url', 'short-url') || permanentUrl,
    value_type: valueType,
    timestamp: value(claim, 'timestamp') || value(payload, 'timestamp', 'release_time', 'release-time'),
    confirmations: toNumber(value(claim, 'confirmations'), 1),
    is_my_output: value(claim, 'is_my_output', 'is-my-output'),
    is_channel_signature_valid: signingChannel
      ? true
      : value(claim, 'is_channel_signature_valid', 'is-channel-signature-valid'),
    signing_channel: signingChannel || value(claim, 'signing_channel', 'signing-channel'),
    streaming_url: mediaUrl || value(claim, 'streaming_url', 'streaming-url'),
    download_url: mediaUrl || value(claim, 'download_url', 'download-url'),
    value: compactParams({
      ...existingValue,
      title,
      description,
      thumbnail: thumbnailObject(
        value(existingValue, 'thumbnail') || value(payload, 'thumbnail') || value(decodedValue, 'thumbnail'),
        mediaUrl,
        mediaType
      ),
      stream_type:
        value(existingValue, 'stream_type', 'stream-type') ||
        value(decodedValue, 'stream_type', 'stream-type') ||
        streamTypeFromMediaType(mediaType),
      tags: value(existingValue, 'tags') || value(decodedValue, 'tags'),
      license: value(existingValue, 'license') || value(decodedValue, 'license'),
      release_time:
        value(existingValue, 'release_time', 'release-time') || value(decodedValue, 'release_time', 'release-time'),
      video: value(existingValue, 'video') || value(decodedValue, 'video'),
      source: compactParams({
        ...payloadSource,
        ...valueSource,
        sd_hash: sdHash,
        media_type: mediaType,
        name: sourceName,
        size:
          value(payloadSource, 'size') ||
          value(valueSource, 'size') ||
          value(decodedSource, 'size') ||
          value(payload, 'byte-size', 'source-size'),
        hash: value(payloadSource, 'hash') || value(valueSource, 'hash') || value(decodedSource, 'hash'),
        url: mediaUrl || value(payloadSource, 'url') || value(valueSource, 'url'),
      }),
    }),
    hyperbeam: compactParams({
      ...(isObject(value(claim, 'hyperbeam')) ? value(claim, 'hyperbeam') : {}),
      immutable_id: String(storeId),
      'immutable-id': String(storeId),
      'store-path': `/${encodeDataPath(String(storeId))}`,
      'source-claim-id': sourceClaimId,
      txid,
      nout,
      device,
    }),
  });
}

function claimMatchesSearchParams(claim: any, params: ClaimSearchOptions): boolean {
  return (
    claimTypeMatches(claim, params) &&
    claimIdsMatch(claim, params) &&
    claimNameMatches(claim, params) &&
    claimChannelMatches(claim, params) &&
    claimTagsMatch(claim, params)
  );
}

function claimTypeMatches(claim: any, params: ClaimSearchOptions): boolean {
  const types = paramValues(params, 'claim_type', 'claim-type', 'type');
  return types.length === 0 || types.includes(claim.value_type);
}

function claimIdsMatch(claim: any, params: ClaimSearchOptions): boolean {
  const ids = paramValues(params, 'claim_ids', 'claim-ids', 'claim_id', 'claim-id', 'txid');
  const immutableIds = paramValues(params, 'immutable_ids', 'immutable-ids', 'immutable_id', 'immutable-id');
  const immutableId = value(claim.hyperbeam, 'immutable_id', 'immutable-id');
  return (
    (ids.length === 0 || ids.includes(claim.claim_id) || ids.includes(immutableId)) &&
    (immutableIds.length === 0 || immutableIds.includes(immutableId) || immutableIds.includes(claim.claim_id))
  );
}

function claimNameMatches(claim: any, params: ClaimSearchOptions): boolean {
  const names = paramValues(params, 'name', 'claim-name', 'claim_name');
  return names.length === 0 || names.includes(claim.name);
}

function claimChannelMatches(claim: any, params: ClaimSearchOptions): boolean {
  const channelIds = paramValues(params, 'channel_ids', 'channel-ids', 'channel_id', 'channel-id');
  const channelId = value(claim.signing_channel, 'claim_id', 'claim-id', 'id');
  return channelIds.length === 0 || channelIds.includes(channelId);
}

function claimTagsMatch(claim: any, params: ClaimSearchOptions): boolean {
  const tags = paramValues(claim.value || {}, 'tags');
  const anyTags = paramValues(params, 'any_tags', 'any-tags');
  const notTags = paramValues(params, 'not_tags', 'not-tags');
  return (
    (anyTags.length === 0 || anyTags.some((tag) => tags.includes(tag))) && !notTags.some((tag) => tags.includes(tag))
  );
}

function paramValues(source: any, ...keys: string[]): Array<string> {
  const raw = value(source, ...keys);
  if (raw === undefined || raw === null || raw === '') return [];
  if (Array.isArray(raw)) return raw.flatMap((item) => paramValues({ item }, 'item'));
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function totalPages(totalItems: number, pageSize: number) {
  return Math.max(1, Math.ceil(totalItems / Math.max(1, pageSize || 1)));
}

async function fetchStoreJsonOrNull(path: string, preferJson: boolean = true): Promise<any | null> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) return null;
  if (!allowHyperbeamCompatibilityReads() && isCompatibilityStorePath(path)) return null;

  try {
    const response = await fetch(buildDeviceUrl(baseUrl, path), {
      headers: preferJson ? { accept: 'application/json' } : undefined,
      signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseStoreResponse(response);
  } catch {
    return null;
  }
}

function fetchCachedStoreJsonOrNull(path: string): Promise<any | null> {
  const key = `store:${path}`;
  const now = Date.now();
  const cached = deviceReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchStoreJsonOrNull(path).catch((error) => {
    deviceReadCache.delete(key);
    throw error;
  });
  deviceReadCache.set(key, { expiresAt: now + HYPERBEAM_READ_CACHE_MS, promise });
  return promise;
}

function storePath(prefix: string, value: string): string {
  return `${prefix}/${encodeURIComponent(value)}`;
}

function isCompatibilityStorePath(path: string): boolean {
  return [
    'odysee/claim/',
    'odysee/claim-id/',
    'odysee/stream/',
    'odysee/stream-id/',
    'odysee/channel/',
    'odysee/channel-id/',
    'odysee/comment/',
    'odysee/comment-id/',
    'odysee/comment-reaction/',
    'odysee/file-view-count/',
    'odysee/file-reaction/',
    'odysee/subscription-count/',
    'odysee/media/stream/',
    'odysee/media/stream-id/',
  ].some((prefix) => path.startsWith(prefix));
}

function encodeDataPath(id: string): string {
  return id
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function absoluteHyperbeamUrl(url: any): string {
  if (typeof url !== 'string' || !url) return '';
  if (/^https?:\/\//.test(url)) return url;
  const baseUrl = hyperbeamBaseUrl();
  return baseUrl && url.startsWith('/') ? `${baseUrl}${url}` : url;
}

function normalizedUploadMediaUrl(url: string, recordId: any): string {
  if (!url || !recordId || !url.includes('/~odysee-upload@1.0/')) return url || '';
  return `${hyperbeamBaseUrl()}/${encodeDataPath(String(recordId))}`;
}

function parseDeviceJson(text: string): any {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { body: text };
  }
}

async function parseStoreResponse(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return parseDeviceJson(await response.text());

  const body = new Uint8Array(await response.arrayBuffer());
  const headers = responseHeadersObject(response);
  if (contentType.includes('multipart/form-data')) {
    return {
      ...headers,
      ...parseMultipartBytes(body, contentType),
    };
  }

  return {
    ...headers,
    body: new TextDecoder().decode(body),
  };
}

function responseHeadersObject(response: Response): Record<string, any> {
  const headers: Record<string, any> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function parseMultipartBytes(body: Uint8Array, contentType: string): Record<string, any> {
  const boundary = contentType.match(/boundary="?([^";]+)"?/i)?.[1];
  if (!boundary) return { body: new TextDecoder().decode(body) };

  const text = bytesToBinaryString(body);
  const result: Record<string, any> = {};
  for (const segment of text.split(`--${boundary}`)) {
    // Sub-message parts (e.g. `value`, `value/source`) are header-only and have
    // no `\r\n\r\n` body separator; blob parts (`claim`, `raw-transaction`) do.
    const separator = segment.indexOf('\r\n\r\n');
    const rawHeaders = separator === -1 ? segment : segment.slice(0, separator);
    const name = rawHeaders.match(/name="([^"]+)"/i)?.[1];
    if (!name || isBundleHousekeepingPart(name)) continue;

    const path = name.split('/').filter(Boolean);
    const fields = parsePartHeaderFields(rawHeaders);
    if (Object.keys(fields).length > 0) {
      // Scalar fields live in the part headers; reconstruct the nested object.
      Object.assign(ensureNestedObject(result, path), fields);
    } else if (separator !== -1) {
      // A binary blob part: keep its body.
      const partBody = segment.slice(separator + 4).replace(/\r\n$/, '');
      setNestedValue(result, path, latin1ToHex(partBody));
    }
  }

  return arrayifyNumericMaps(result);
}

function isBundleHousekeepingPart(name: string): boolean {
  const segments = name.split('/');
  return segments.includes('commitments') || segments[segments.length - 1] === 'committed';
}

function parsePartHeaderFields(rawHeaders: string): Record<string, any> {
  const types = parseAoTypes(rawHeaders);
  const fields: Record<string, any> = {};
  for (const line of rawHeaders.split(/\r\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim().toLowerCase();
    const raw = line.slice(separator + 1).trim();
    if (!key || BUNDLE_META_HEADERS.has(key)) continue;

    // Header values are latin1 slices of the raw bytes; text fields must be
    // re-decoded as UTF-8 (e.g. accented titles) rather than left as mojibake.
    fields[key] = types[key] === 'integer' ? Number(raw) : latin1ToUtf8(raw);
  }
  return fields;
}

function latin1ToUtf8(value: string): string {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
  return new TextDecoder().decode(bytes);
}

function parseAoTypes(rawHeaders: string): Record<string, string> {
  const line = rawHeaders.match(/ao-types:\s*([^\r\n]+)/i)?.[1];
  if (!line) return {};

  const types: Record<string, string> = {};
  for (const match of line.matchAll(/([a-z0-9_-]+)\s*=\s*"([^"]+)"/gi)) {
    types[match[1].toLowerCase()] = match[2];
  }
  return types;
}

function ensureNestedObject(root: Record<string, any>, path: Array<string>): Record<string, any> {
  let current = root;
  for (const key of path) {
    if (typeof current[key] !== 'object' || current[key] === null) current[key] = {};
    current = current[key];
  }
  return current;
}

function setNestedValue(root: Record<string, any>, path: Array<string>, value: any): void {
  if (!path.length) return;
  const leaf = path[path.length - 1];
  ensureNestedObject(root, path.slice(0, -1))[leaf] = value;
}

function arrayifyNumericMaps(value: any): any {
  if (!isObject(value)) return value;

  const keys = Object.keys(value);
  const isSequential = keys.length > 0 && keys.every((key, index) => key === String(index + 1));
  if (isSequential) return keys.map((key) => arrayifyNumericMaps(value[key]));

  const result: Record<string, any> = {};
  for (const key of keys) result[key] = arrayifyNumericMaps(value[key]);
  return result;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let result = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    result += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return result;
}

function latin1ToHex(value: string): string {
  let hex = '';
  for (let index = 0; index < value.length; index += 1) {
    hex += (value.charCodeAt(index) & 0xff).toString(16).padStart(2, '0');
  }
  return hex;
}

function storePayload(result: any): any {
  const payload = messagePayload(result);
  if (!payload) return null;
  if (typeof payload === 'string') return { body: payload };

  const body = value(payload, 'body');
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return isObject(parsed) ? { ...payload, ...parsed } : payload;
    } catch {}
  }

  return payload;
}

function decodeClaimMetadata(payload: any): DecodedClaimMetadata | null {
  const claimHex = value(payload, 'claim', 'claim-value-hex', 'claim_value_hex');
  const bytes = hexToBytes(claimHex);
  if (!bytes) return null;

  try {
    return { signedChannelId: claimEnvelope(bytes).signedChannelId };
  } catch {
    return null;
  }
}

function claimEnvelope(bytes: Uint8Array): { message: Uint8Array; signedChannelId?: string } {
  if (bytes[0] === 0 && bytes.length > 1) {
    return { message: bytes.slice(1) };
  }

  if (bytes[0] === 1 && bytes.length > 85) {
    return {
      signedChannelId: bytesToHex(Array.from(bytes.slice(1, 21)).reverse()),
      message: bytes.slice(85),
    };
  }

  return { message: bytes };
}

function hexToBytes(value: any): Uint8Array | null {
  if (
    isObject(value) &&
    value['$ao-type'] === 'binary' &&
    typeof value.base64url === 'string' &&
    typeof atob === 'function'
  ) {
    try {
      const base64 = value.base64url
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(value.base64url.length / 4) * 4, '=');
      const decoded = atob(base64);
      return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    } catch {
      return null;
    }
  }
  if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(value: Uint8Array | Array<number>): string {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function safeClaimName(name: any): string {
  const cleaned = String(name || '')
    .replace(/^lbry:\/\//, '')
    .replace(/[ =&#:$@%?;/\\\n"<>%{}|^~[\]`]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || 'store-object';
}

function slugFromText(text: any): string | undefined {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  return safeClaimName(text).toLowerCase();
}

function claimUrl(name: string, claimId: any): string {
  const suffix = typeof claimId === 'string' && isRouteClaimModifier(claimId) ? `#${claimId}` : '';
  return `lbry://${name}${suffix}`;
}

function isOutpointId(id: any): boolean {
  return /^[0-9a-f]{64}:[0-9]+$/i.test(String(id || ''));
}

function isStandaloneImmutableId(id: any): boolean {
  return /^[0-9A-Za-z_-]{41,128}$/.test(String(id || ''));
}

function isClaimId(id: any): boolean {
  return /^[0-9a-f]{40}$/i.test(String(id || ''));
}

function claimIdFromSignatureInput(input: any): string | undefined {
  const match = String(input || '').match(/claim-id="([0-9a-f]{40})"/i);
  return match?.[1];
}

function outpointParts(id: any): { txid: string; nout: number } | null {
  const match = String(id || '').match(/^([0-9a-f]{64}):([0-9]+)$/i);
  return match ? { txid: match[1], nout: Number(match[2]) } : null;
}

function webSafeImmutableId(id: any): string {
  const value = String(id || '');
  const outpoint = value.match(/^([0-9a-f]{64}):([0-9]+)$/i);
  return outpoint ? `out_${outpoint[1]}_${outpoint[2]}` : value;
}

function immutableRouteIdFromUri(uri: string): string | null {
  let parsed;
  try {
    parsed = parseURI(uri);
  } catch {
    return null;
  }

  const modifier = parsed.channelName ? parsed.streamClaimId : parsed.streamClaimId || parsed.claimId;
  if (typeof modifier !== 'string') {
    const name = parsed.streamName || (parsed.channelName ? undefined : parsed.claimName);
    return isStandaloneImmutableId(name) ? String(name) : null;
  }

  const outpoint = modifier.match(/^out_([0-9a-f]{64})_([0-9]+)$/i);
  return outpoint ? `${outpoint[1]}:${outpoint[2]}` : null;
}

function isRouteClaimModifier(claimId: string) {
  return /^[0-9a-f]{1,40}$/i.test(claimId) || /^[0-9A-Za-z_-]{41,128}$/.test(claimId);
}

function isMediaContentType(contentType: any): boolean {
  return typeof contentType === 'string' && /^(video|audio|image)\//i.test(contentType);
}

function streamTypeFromMediaType(mediaType: any): string | undefined {
  if (typeof mediaType !== 'string') return undefined;
  if (mediaType.startsWith('video/')) return 'video';
  if (mediaType.startsWith('audio/')) return 'audio';
  if (mediaType.startsWith('image/')) return 'image';
}

function thumbnailObject(thumbnail: any, mediaUrl: string, mediaType: any): any {
  const value =
    thumbnail || (mediaUrl && typeof mediaType === 'string' && mediaType.startsWith('image/') ? mediaUrl : null);
  if (typeof value === 'string') return { url: value };
  return isObject(value) ? value : undefined;
}

function splitClaimIdChannelUris(urls: Array<string>): { channelUris: Array<string>; resolveUris: Array<string> } {
  return urls.reduce(
    (groups, uri) => {
      groups[claimIdFromChannelUri(uri) ? 'channelUris' : 'resolveUris'].push(uri);
      return groups;
    },
    { channelUris: [], resolveUris: [] } as { channelUris: Array<string>; resolveUris: Array<string> }
  );
}

function claimIdFromChannelUri(uri: string): string | null {
  const match = String(uri).match(/^lbry:\/\/@[^/]+#([0-9a-f]{40})$/i);
  return match ? match[1] : null;
}

function hyperbeamMediaUrlFromPayload(payload: any): string {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl || !payload) return '';
  if (!allowHyperbeamCompatibilityReads()) return '';

  const txid = value(payload, 'txid');
  const nout = value(payload, 'nout');
  const outpoint = value(payload, 'outpoint') || (txid != null && nout != null ? `${txid}:${nout}` : '');
  if (outpoint) {
    return `${baseUrl}/${STREAM_DEVICE}/media?id=${encodeURIComponent(String(outpoint))}`;
  }

  const claimId = value(payload, 'claim_id', 'claim-id');
  if (claimId) {
    const claimName = value(payload, 'claim_name', 'claim-name');
    const nameParam = claimName ? `&claim-name=${encodeURIComponent(String(claimName))}` : '';
    return `${baseUrl}/${STREAM_DEVICE}/media?claim-id=${encodeURIComponent(String(claimId))}${nameParam}`;
  }

  return '';
}

const BUNDLE_META_HEADERS = new Set([
  'content-disposition',
  'content-type',
  'ao-types',
  'content-digest',
  'signature',
  'signature-input',
]);

// The branch's `~odysee@1.0/source` device does not exist on master; bare
// `GET /<id>` store fall-through (with node-side cache warming) serves both
// legacy outpoints and native immutable ids.
async function fetchImmutableJsonOrNull(id: string): Promise<any | null> {
  if (!isOutpointId(id) && !isStandaloneImmutableId(id)) return null;
  // `accept-bundle` inlines the node-decoded native `value` sub-message so the
  // client reads `claim.value.*` the same way for legacy and native content.
  return fetchStoreJsonOrNull(`${encodeDataPath(id)}?accept-bundle=true`, false);
}

function fetchCachedImmutableChannelJsonOrNull(id: string): Promise<any | null> {
  const key = `immutable-channel:${id}`;
  const now = Date.now();
  const cached = deviceReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (
    isOutpointId(id) || isStandaloneImmutableId(id)
      ? fetchStoreJsonOrNull(`${encodeDataPath(id)}?accept-bundle=true`, false)
      : fetchStoreJsonOrNull(storePath('odysee/claim-id', id))
  ).catch((error) => {
    deviceReadCache.delete(key);
    throw error;
  });
  deviceReadCache.set(key, { expiresAt: now + HYPERBEAM_READ_CACHE_MS, promise });
  return promise;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  const timeout = typeof AbortSignal !== 'undefined' && (AbortSignal as any).timeout;
  return typeof timeout === 'function' ? timeout(ms) : undefined;
}
