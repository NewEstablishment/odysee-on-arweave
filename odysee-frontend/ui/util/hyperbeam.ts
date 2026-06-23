import { HYPERBEAM_BASE_URL, LBRY_API_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';
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

export async function fetchHyperbeamResolve(params: any): Promise<any | null> {
  const urls = urlsFromResolveParams(params);
  if (!urls.length) return null;

  const entries = await Promise.all(
    urls.map(async (uri) => {
      const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/resolve`, { uri });
      const result = responsePayload(response);
      return [uri, sdkClaimFromHyperbeam(result?.[uri] || result)];
    })
  );

  return Object.fromEntries(entries.filter(([, claim]) => claim));
}

export async function fetchHyperbeamGet(params: any): Promise<any | null> {
  const uri = params?.uri || params?.url;
  if (!uri) return null;

  const response = await fetchDeviceJson(`${STREAM_DEVICE}/playback`, { uri });
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
  return response.result || response;
}

function urlsFromResolveParams(params: any): Array<string> {
  const source = params?.urls || params?.uris || params?.url || params?.uri;
  if (Array.isArray(source)) return source.filter(Boolean);
  return source ? [source] : [];
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
