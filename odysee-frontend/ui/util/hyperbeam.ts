import { HYPERBEAM_BASE_URL, LBRY_API_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { callHyperbeamComment } from 'services/hyperbeamUserState';
import { isHyperbeamEnabled } from 'util/hyperbeamMode';

const HYPERBEAM_TIMEOUT_MS = 15000;
const HYPERBEAM_READ_CACHE_MS = 30 * 1000;
const CLAIM_DEVICE = '~odysee-claim@1.0';
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
  'authtoken',
  'includeismyoutput',
  'includepurchasereceipt',
  'ismyinput',
  'ismyoutput',
  'purchasereceipt',
  'refreshtoken',
]);
const deviceReadCache = new Map<string, { expiresAt: number; promise: Promise<any | null> }>();

function hyperbeamCommentDebug(message: string, data?: any) {
  if (typeof window === 'undefined' || window.localStorage?.getItem('odysee:comment-debug') !== '1') return;
  console.info('[odysee-comment]', message, data);
}

function debugError(error: any) {
  return error instanceof Error ? { name: error.name, message: error.message } : error;
}

export async function fetchHyperbeamResolve(params: any): Promise<any | null> {
  const urls = urlsFromResolveParams(params);
  if (!urls.length) return null;

  const { channelUris, resolveUris } = splitClaimIdChannelUris(urls);
  const channelEntries =
    channelUris.length > 1 ? await fetchClaimIdChannelEntries(channelUris) : await fetchResolveEntries(channelUris);
  const resolveEntries = await fetchResolveEntries(resolveUris);

  return Object.fromEntries([...channelEntries, ...resolveEntries].filter(([, claim]) => claim));
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

async function fetchClaimIdChannelEntries(urls: Array<string>): Promise<Array<[string, any]>> {
  const uriByClaimId = new Map<string, string>();
  urls.forEach((uri) => {
    const claimId = claimIdFromChannelUri(uri);
    if (claimId) uriByClaimId.set(claimId.toLowerCase(), uri);
  });

  const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/search`, {
    claim_ids: Array.from(uriByClaimId.keys()),
  });
  const search = sdkSearchFromHyperbeam(responsePayload(response));
  const items = Array.isArray(search?.items) ? search.items : [];

  return items
    .map((item: any): [string, any] | null => {
      const claim = sdkClaimFromHyperbeam(item);
      const claimId = value(claim, 'claim_id', 'claim-id');
      const uri = claimId && uriByClaimId.get(String(claimId).toLowerCase());
      return uri ? [uri, claim] : null;
    })
    .filter(Boolean) as Array<[string, any]>;
}

export async function fetchHyperbeamGet(params: any): Promise<any | null> {
  const uri = params?.uri || params?.url;
  if (!uri) return null;

  const response = await fetchDeviceJson(`${STREAM_DEVICE}/playback`, {
    uri,
    mode: 'hyperbeam',
    media_base_url: hyperbeamBaseUrl(),
  });
  return playbackPayloadFromHyperbeam(responsePayload(response));
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
  let publicError;
  hyperbeamCommentDebug('list:hyperbeam:start', {
    claim_id: params.claim_id,
    parent_id: params.parent_id,
    page: params.page,
    page_size: params.page_size,
  });
  const [publicResult, localResult] = await Promise.all([
    fetchDeviceJson(`${COMMENT_DEVICE}/list`, params)
      .then(responsePayload)
      .catch((error) => {
        publicError = error;
        return null;
      }),
    fetchHyperbeamLocalCommentList(params),
  ]);
  const publicList = commentListFromHyperbeam(publicResult, params);
  const localList = commentListFromHyperbeam(localResult, params);
  const merged = mergeCommentLists(publicList, localList);
  hyperbeamCommentDebug('list:hyperbeam:done', {
    publicItems: publicList?.items.length || 0,
    localItems: localList?.items.length || 0,
    mergedItems: merged?.items.length || 0,
    publicError: publicError ? debugError(publicError) : undefined,
  });

  if (merged) return merged;
  if (publicError && isHyperbeamEnabled()) throw publicError;
  return null;
}

function commentListFromHyperbeam(result: any, params: CommentListParams): CommentListResponse | null {
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
  const local = commentByIdFromHyperbeam(await fetchHyperbeamLocalCommentById(params));
  if (local) return local;

  const response = await fetchDeviceJson(`${COMMENT_DEVICE}/by-id`, params);
  return commentByIdFromHyperbeam(responsePayload(response));
}

function commentByIdFromHyperbeam(result: any): CommentByIdResponse | null {
  const comment = result && (result.comment || result.item || result.items);
  const item = Array.isArray(comment) ? comment[0] : comment;
  if (!item) return null;

  return {
    item: commentFromHyperbeam(item),
    items: [commentFromHyperbeam(item)],
    ancestors: Array.isArray(result.ancestors) ? result.ancestors.map(commentFromHyperbeam) : [],
  };
}

async function fetchHyperbeamLocalCommentList(params: CommentListParams): Promise<any | null> {
  try {
    const result = await callHyperbeamComment('comment.List', params);
    hyperbeamCommentDebug('list:local:success', {
      claim_id: params.claim_id,
      items: Array.isArray(result?.items) ? result.items.length : undefined,
      total_items: result?.total_items,
    });
    return result;
  } catch (error) {
    hyperbeamCommentDebug('list:local:failed', debugError(error));
    return null;
  }
}

async function fetchHyperbeamLocalCommentById(params: CommentByIdParams): Promise<any | null> {
  try {
    return await callHyperbeamComment('comment.ByID', params);
  } catch (error) {
    hyperbeamCommentDebug('by-id:local:failed', debugError(error));
    return null;
  }
}

function mergeCommentLists(publicList: CommentListResponse | null, localList: CommentListResponse | null) {
  if (!publicList) return localList;
  if (!localList || !localList.items.length) return publicList;

  const publicIds = new Set(publicList.items.map((comment) => comment.comment_id).filter(Boolean));
  const localOnlyItems = localList.items.filter((comment) => comment.comment_id && !publicIds.has(comment.comment_id));
  if (!localOnlyItems.length) return publicList;

  return {
    ...publicList,
    items: [...localOnlyItems, ...publicList.items],
    total_items: publicList.total_items + localOnlyItems.length,
    total_filtered_items: publicList.total_filtered_items + localOnlyItems.length,
    total_pages: Math.max(
      publicList.total_pages,
      totalPages(publicList.total_items + localOnlyItems.length, publicList.page_size)
    ),
  };
}

function totalPages(totalItems: number, pageSize: number) {
  return Math.max(1, Math.ceil(totalItems / Math.max(1, pageSize || 1)));
}

export async function fetchHyperbeamReactionList(params: ReactionListParams): Promise<ReactionListResponse | null> {
  const response = await fetchDeviceJson(`${REACTION_DEVICE}/list`, params);
  const result = responsePayload(response);
  const myReactions = value(result, 'my_reactions', 'my-reactions');
  const othersReactions = value(result, 'others_reactions', 'others-reactions');

  return isObject(myReactions) && isObject(othersReactions)
    ? { my_reactions: myReactions, others_reactions: othersReactions }
    : null;
}

export async function fetchHyperbeamFileReactionList(params: { claim_ids: string }): Promise<any | null> {
  const response = await fetchDeviceJson(`${FILE_REACTION_DEVICE}/list`, params);
  const result = responsePayload(response);
  const myReactions = value(result, 'my_reactions', 'my-reactions');
  const othersReactions = value(result, 'others_reactions', 'others-reactions');

  return isObject(myReactions) && isObject(othersReactions)
    ? { my_reactions: myReactions, others_reactions: othersReactions }
    : null;
}

export async function fetchHyperbeamViewCount(claimIdCsv: string): Promise<Array<number> | null> {
  const response = await fetchDeviceJson(`${FILE_DEVICE}/view-count`, {
    claim_id: claimIdCsv,
    odysee_api_url: LBRY_API_URL,
  });
  const result = responsePayload(response);
  const counts = Array.isArray(result) ? result : value(result, 'counts', 'view-counts');

  return Array.isArray(counts) ? counts : null;
}

export async function fetchHyperbeamSubCount(claimIdCsv: string): Promise<Array<number> | null> {
  const response = await fetchDeviceJson(
    `${SUBSCRIPTION_DEVICE}/sub-count`,
    compactParams({
      claim_id: claimIdCsv,
      odysee_api_url: LBRY_API_URL,
    })
  );
  const result = responsePayload(response);
  const counts = Array.isArray(result) ? result : value(result, 'counts', 'sub-counts');

  return Array.isArray(counts) ? counts : null;
}

export async function fetchHyperbeamClaimSearch(params: ClaimSearchOptions): Promise<ClaimSearchResponse | null> {
  const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/search`, params);
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
    const params = stripPrivateParams(compactParams(body));

    const response = await fetch(buildDeviceUrl(baseUrl, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
    });
    const text = await response.text();
    const json = parseDeviceJson(text);

    if (!response.ok) {
      if (isHyperbeamEnabled()) throw new Error(`HyperBEAM ${path} failed with ${response.status}`);
      return null;
    }
    return json;
  } catch (error) {
    if (isHyperbeamEnabled()) throw error;
    return null;
  }
}

function fetchCachedDeviceJson(path: string, body: Record<string, any>): Promise<any | null> {
  const key = `${path}:${stableJson(stripPrivateParams(compactParams(body)))}`;
  const now = Date.now();
  const cached = deviceReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchDeviceJson(path, body).catch((error) => {
    deviceReadCache.delete(key);
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
      .filter(([key]) => !PRIVATE_PARAM_KEYS.has(key.replace(/[-_]/g, '').toLowerCase()))
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

function parseDeviceJson(text: string): any {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { body: text };
  }
}

function commentChannelUrl(comment: any): string | undefined {
  const existing = value(comment, 'channel-url', 'channel_url');
  if (existing) return existing;

  const channelName = value(comment, 'channel-name', 'channel_name');
  const channelId = value(comment, 'channel-id', 'channel_id');
  if (!channelName || !channelId) return undefined;

  const normalizedName = String(channelName).startsWith('@') ? String(channelName) : `@${channelName}`;
  return `lbry://${normalizedName}#${channelId}`;
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
    channel_url: commentChannelUrl(comment),
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
  return response.result || response;
}

function urlsFromResolveParams(params: any): Array<string> {
  const source = params?.urls || params?.uris || params?.url || params?.uri;
  if (Array.isArray(source)) return source.filter(Boolean);
  return source ? [source] : [];
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
