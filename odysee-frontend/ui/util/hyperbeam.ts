import { HYPERBEAM_BASE_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { X_LBRY_AUTH_TOKEN } from 'constants/token';
import Lbry from 'lbry';
import { Lbryio } from 'lbryinc';
import { pushHyperbeamDebug } from 'util/hyperbeamDebug';
import { isHyperbeamEnabled } from 'util/hyperbeamMode';
import { isHyperbeamUploadClaim } from 'util/claim';
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
  `${ACCOUNT_DEVICE}/user-exists`,
  `${ACCOUNT_DEVICE}/user-new`,
  `${ACCOUNT_DEVICE}/user-signin`,
  `${ACCOUNT_DEVICE}/user-me`,
  `${ACCOUNT_DEVICE}/user-email-resend-token`,
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

  const uploadEntries = await fetchHyperbeamUploadResolveEntries(urls);
  const uploadResolvedUris = new Set(uploadEntries.map(([uri]) => uri));
  const unresolvedUrls = urls.filter((uri) => !uploadResolvedUris.has(uri));
  const { batchedUris, resolveUris } = splitBatchedResolveUris(unresolvedUrls);
  const batchedEntries = batchedUris.length ? await fetchBatchedResolveEntries(batchedUris) : [];
  const resolveEntries = await fetchResolveEntries(resolveUris);

  return Object.fromEntries([...uploadEntries, ...batchedEntries, ...resolveEntries].filter(([, claim]) => claim));
}

async function fetchResolveEntries(urls: Array<string>): Promise<Array<[string, any]>> {
  return Promise.all(
    urls.map(async (uri): Promise<[string, any]> => {
      const claimId = claimIdFromUri(uri);
      if (claimId) {
        try {
          const result = responsePayload(await fetchCacheJson(cacheReadPath(claimId)));
          const claim = sdkClaimFromHyperbeam(cacheReadClaim(result), claimId);
          if (claim) return [uri, claim];
        } catch (_e) {}
      }

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

async function fetchHyperbeamUploadResolveEntries(urls: Array<string>): Promise<Array<[string, any]>> {
  const streamClaimIds = urls.map(streamClaimIdFromUri).filter(Boolean);
  const directClaims = streamClaimIds.length ? await fetchHyperbeamUploadClaimsForIds(streamClaimIds) : [];
  const directClaimsById = new Map(directClaims.map((claim) => [claim.claim_id, claim]));
  const entries: Array<[string, any]> = [];
  const unresolvedUris: Array<string> = [];

  urls.forEach((uri) => {
    const claimId = streamClaimIdFromUri(uri);
    const claim = claimId ? directClaimsById.get(claimId) : null;
    if (claim) {
      entries.push([uri, sdkClaimFromHyperbeam(claim)]);
    } else {
      unresolvedUris.push(uri);
    }
  });

  if (!unresolvedUris.length) return entries;

  const uploads = await fetchHyperbeamUploadClaims({});
  unresolvedUris.forEach((uri) => {
    const claim = uploads.find((item) => uploadClaimMatchesUri(item, uri));
    if (claim) entries.push([uri, sdkClaimFromHyperbeam(claim)]);
  });

  return entries;
}

export async function fetchHyperbeamGet(params: any): Promise<any | null> {
  const uri = params?.uri || params?.url;
  const id = params?.id || params?.outpoint || params?.immutable_id || params?.immutableId;
  if (!uri && !id) return null;

  const response = await fetchDeviceJson(`${STREAM_DEVICE}/playback`, id ? { id } : { uri });
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

export async function fetchHyperbeamClaimSearch(params: ClaimSearchOptions): Promise<ClaimSearchResponse | null> {
  const storeResult = await fetchHyperbeamChannelClaimSearch(params);
  if (storeResult) return storeResult;

  const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/search`, params);
  const result = sdkSearchFromHyperbeam(responsePayload(response));
  const items = result && result.items;

  return Array.isArray(items) ? result : null;
}

async function fetchHyperbeamChannelClaimSearch(params: ClaimSearchOptions): Promise<ClaimSearchResponse | null> {
  const channelIds = stringList((params as any).channel_ids || (params as any).channelIds);
  if (!channelIds.length) return null;
  if (hasHyperbeamChannelSearchConstraints(params)) return null;

  try {
    const page = toNumber((params as any).page, 1);
    const pageSize = toNumber((params as any).page_size || (params as any)['page-size'], 20);
    const uploadClaims = await fetchHyperbeamUploadClaimsForChannels(channelIds);
    let storeIds = (
      await Promise.all(
        channelIds.map(async (channelId) => {
          const result = responsePayload(
            await fetchCacheJson(cacheListPath(`${channelId}/claim-outputs`, { page, page_size: pageSize }))
          );
          return Array.isArray(result?.items) ? result.items : [];
        })
      )
    ).flat();
    if (!storeIds.length) {
      storeIds = (
        await Promise.all(
          channelIds.map(async (channelId) => {
            const result = responsePayload(
              await fetchCacheJson(cacheListPath(`${channelId}/claims`, { page, page_size: pageSize }))
            );
            return Array.isArray(result?.items) ? result.items : [];
          })
        )
      ).flat();
    }

    if (!storeIds.length && !uploadClaims.length) {
      return {
        items: [],
        page,
        page_size: pageSize,
        total_items: 0,
        total_pages: 0,
      } as any;
    }

    const storeItems = (
      await Promise.all(
        storeIds.slice(0, pageSize).map(async (storeId) => {
          const result = responsePayload(await fetchCacheJson(cacheReadPath(storeId)));
          return sdkClaimFromHyperbeam(cacheReadClaim(result));
        })
      )
    ).filter(Boolean);
    const existingIds = new Set(storeItems.map((claim) => claim.claim_id));
    const items = [...uploadClaims.filter((claim) => !existingIds.has(claim.claim_id)), ...storeItems].slice(
      0,
      pageSize
    );
    const totalItems = storeIds.length + uploadClaims.filter((claim) => !existingIds.has(claim.claim_id)).length;

    return {
      items,
      page,
      page_size: pageSize,
      total_items: totalItems,
      total_pages: Math.max(1, Math.ceil(totalItems / pageSize)),
    } as any;
  } catch (_e) {
    return null;
  }
}

function hasHyperbeamChannelSearchConstraints(params: ClaimSearchOptions): boolean {
  return Boolean(
    (params as any).any_tags ||
    (params as any).all_tags ||
    (params as any).not_tags ||
    (params as any).release_time ||
    (params as any).releaseTime
  );
}

async function fetchHyperbeamUploadClaimsForChannels(channelIds: Array<string>): Promise<Array<Claim>> {
  return fetchHyperbeamUploadClaims({ channel_ids: channelIds }, { 'x-odysee-channel-ids': channelIds.join(',') });
}

async function fetchHyperbeamUploadClaimsForIds(claimIds: Array<string>): Promise<Array<Claim>> {
  const ids = claimIds.filter(Boolean);
  if (!ids.length) return [];

  const directClaims = await Promise.all(ids.map((id) => fetchHyperbeamImmutableClaim(id)));
  const resolvedClaims = directClaims.flat();
  const resolvedIds = new Set(resolvedClaims.map((claim) => claim?.claim_id).filter(Boolean));
  const unresolvedIds = ids.filter((id) => !resolvedIds.has(id));
  if (!unresolvedIds.length) return resolvedClaims;

  const indexedClaims = await fetchHyperbeamUploadClaims(
    { claim_ids: unresolvedIds },
    { 'x-odysee-claim-ids': unresolvedIds.join(',') }
  );
  return [...resolvedClaims, ...indexedClaims];
}

async function fetchHyperbeamImmutableClaim(claimId: string): Promise<Array<Claim>> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) return [];

  try {
    const url = `${baseUrl}/${encodeURIComponent(claimId)}`;
    const requestHeaders = {
      accept: 'application/json',
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
    const claimPayload = responsePayload(json);
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
    needsSigningChannel ? fetchHyperbeamImmutableSubmessage(baseUrl, claimId, 'signing_channel') : Promise.resolve(null),
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
  const expandedValue = claimValue ? { ...claimValue, ...(source ? { source } : {}), ...(thumbnail ? { thumbnail } : {}) } : null;

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
  const uploadItems = claimIds.length ? await fetchHyperbeamUploadClaimsForIds(claimIds) : [];
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

  const result = await fetchDeviceJson(`${CHANNEL_DEVICE}/channel`, { channel: claim.signing_channel || claim });
  return result ? channelFromHyperbeam(result) : null;
}

export async function fetchHyperbeamStreamVerification(
  claim: Claim | null | undefined,
  uri: string
): Promise<any | null> {
  if (!claim || isHyperbeamUploadClaim(claim)) return null;

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

function buildCacheUrl(baseUrl: string, path: string): string {
  if (path.startsWith('/')) return `${baseUrl}${path}`;
  return `${baseUrl}/~cache@1.0/${path}`;
}

async function fetchCacheJson(path: string): Promise<any | null> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) {
    if (isHyperbeamEnabled()) throw new Error('HyperBEAM node is not configured');
    return null;
  }

  const response = await fetch(buildCacheUrl(baseUrl, path), {
    method: 'GET',
    credentials: hyperbeamFetchCredentials(baseUrl),
    headers: { Accept: 'application/json' },
    signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    if (isHyperbeamEnabled()) throw new Error(`HyperBEAM ${path} failed with ${response.status}`);
    return null;
  }

  return await response.json();
}

function cacheReadPath(id: string): string {
  return `/${String(id)
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
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

function streamClaimIdFromUri(uri: string): string | null {
  try {
    const parsed = parseURI(String(uri));
    return parsed.streamClaimId ? String(parsed.streamClaimId) : null;
  } catch (_e) {
    return null;
  }
}

function uploadClaimMatchesUri(claim: any, uri: string): boolean {
  if (!claim) return false;

  const variants = [
    claim.canonical_url,
    claim.permanent_url,
    claim.short_url,
    uriWithClaimId(claim.canonical_url, claim.claim_id),
    uriWithClaimId(claim.permanent_url, claim.claim_id),
    uriWithClaimId(claim.short_url, claim.claim_id),
    uriWithoutStreamClaimId(claim.canonical_url),
    uriWithoutStreamClaimId(claim.permanent_url),
    uriWithoutStreamClaimId(claim.short_url),
  ];

  return variants.filter(Boolean).some((variant) => variant === uri);
}

function uriWithClaimId(uri: any, claimId: any): string | null {
  if (!uri || !claimId) return null;
  const text = String(uri);
  const hashIndex = text.lastIndexOf('#');
  return hashIndex === -1 ? `${text}#${claimId}` : `${text.slice(0, hashIndex)}#${claimId}`;
}

function uriWithoutStreamClaimId(uri: any): string | null {
  if (!uri) return null;

  try {
    const parsed = parseURI(String(uri));
    if (!parsed.streamClaimId) return String(uri);
    const suffix = `#${parsed.streamClaimId}`;
    return String(uri).endsWith(suffix) ? String(uri).slice(0, -suffix.length) : String(uri);
  } catch (_e) {
    return null;
  }
}

function sdkClaimFromHyperbeam(result: any, requestedClaimId?: string): any {
  if (!result) return null;
  const claim = responsePayload(result.claim || result);
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

  return {
    ...claim,
    claim_id: claimId,
    immutable_id: nativeUpload ? claimId : value(claim, 'immutable_id', 'immutable-id') || claimId,
    txid: nativeUpload ? claimId : txid,
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
    value_type: value(claim, 'value_type', 'value-type') || claim.value_type,
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

function timeoutSignal(ms: number): AbortSignal | undefined {
  const timeout = typeof AbortSignal !== 'undefined' && (AbortSignal as any).timeout;
  return typeof timeout === 'function' ? timeout(ms) : undefined;
}
