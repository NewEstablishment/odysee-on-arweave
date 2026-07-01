import { HYPERBEAM_BASE_URL, LBRY_API_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { callHyperbeamComment } from 'services/hyperbeamUserState';
import { allowHyperbeamCompatibilityReads, isHyperbeamDeviceEnabled, isHyperbeamEnabled } from 'util/hyperbeamMode';

const HYPERBEAM_TIMEOUT_MS = 15000;
const HYPERBEAM_READ_CACHE_MS = 30 * 1000;
const CLAIM_DEVICE = '~odysee-claim@1.0';
const COMMENT_DEVICE = '~odysee-comment@1.0';
const ODYSEE_DEVICE = '~odysee@1.0';
const INDEX_DEVICE = '~odysee-index@1.0';
const UPLOAD_DEVICE = '~odysee-upload@1.0';
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
      const storeClaim = await fetchCachedStoreJsonOrNull(storePath('odysee/claim', uri)).then(responsePayload);
      if (storeClaim) return [uri, sdkClaimFromHyperbeam(storeClaim)];

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
  const storeEntries = await Promise.all(
    Array.from(uriByClaimId.entries()).map(async ([claimId, uri]): Promise<[string, any] | null> => {
      const storeClaim = await fetchCachedStoreJsonOrNull(storePath('odysee/claim-id', claimId)).then(responsePayload);
      return storeClaim ? [uri, sdkClaimFromHyperbeam(storeClaim)] : null;
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

  const fallbackEntries = items
    .map((item: any): [string, any] | null => {
      const claim = sdkClaimFromHyperbeam(item);
      const claimId = value(claim, 'claim_id', 'claim-id');
      const uri = claimId && uriByClaimId.get(String(claimId).toLowerCase());
      return uri ? [uri, claim] : null;
    })
    .filter(Boolean) as Array<[string, any]>;

  return [...resolvedEntries, ...fallbackEntries];
}

export async function fetchHyperbeamGet(params: any): Promise<any | null> {
  const uri = params?.uri || params?.url;
  if (!uri) return null;

  const storeStream = await fetchStoreJsonOrNull(storePath('odysee/stream', uri)).then(responsePayload);
  const storePayload = playbackPayloadFromHyperbeam(storeStream);
  if (storePayload) return storePayload;

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
  const immutableIds = paramValues(params, 'immutable_ids', 'immutable-ids', 'immutable_id', 'immutable-id');
  if (immutableIds.length) return fetchHyperbeamImmutableList(immutableIds, params);

  const localParams = localUploadSearchParams(params);
  const [response, localUploads] = await Promise.all([
    fetchCachedDeviceJson(`${CLAIM_DEVICE}/search`, params),
    localParams ? fetchHyperbeamUploadList(localParams).catch(() => null) : Promise.resolve(null),
  ]);
  const result = sdkSearchFromHyperbeam(responsePayload(response));
  const publicResult = Array.isArray(result?.items) ? result : null;

  return mergeClaimSearchResults(publicResult, localUploads, params);
}

export async function fetchHyperbeamUploadList(params: ClaimSearchOptions = {}): Promise<ClaimSearchResponse | null> {
  const response =
    (await fetchDeviceJson(`${INDEX_DEVICE}/list`, params).catch(() => null)) ||
    (await fetchDeviceJson(`${UPLOAD_DEVICE}/list`, params));
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
        const result = await fetchCachedImmutableJsonOrNull(id).then(responsePayload);
        return immutableClaimFromHyperbeam(result, id);
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

async function fetchImmutableJsonOrNull(id: string): Promise<any | null> {
  const source = await fetchStoreJsonOrNull(`${ODYSEE_DEVICE}/source?id=${encodeURIComponent(id)}&view=json`);
  if (source) return source;

  return fetchStoreJsonOrNull(encodeDataPath(id));
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

function localUploadSearchParams(params: ClaimSearchOptions): ClaimSearchOptions | null {
  const hasTarget =
    paramValues(params, 'channel_ids', 'channel-ids', 'channel_id', 'channel-id').length > 0 ||
    paramValues(params, 'claim_ids', 'claim-ids', 'claim_id', 'claim-id', 'txid').length > 0 ||
    paramValues(params, 'name', 'claim-name', 'claim_name').length > 0 ||
    paramValues(params, 'uri', 'uris', 'url', 'urls').length > 0;

  return hasTarget ? params : null;
}

function mergeClaimSearchResults(
  publicResult: ClaimSearchResponse | null,
  localResult: ClaimSearchResponse | null,
  params: ClaimSearchOptions
): ClaimSearchResponse | null {
  if (!publicResult) return localResult;
  if (!localResult || !localResult.items.length) return publicResult;

  const publicItems = Array.isArray(publicResult.items) ? publicResult.items : [];
  const localOnlyItems = localResult.items.filter((claim) => !publicItems.some((item) => sameClaim(item, claim)));
  if (!localOnlyItems.length) return publicResult;

  const items = [...localOnlyItems, ...publicItems];
  const publicTotal = toNumber(publicResult.total_items, publicItems.length);
  const totalItems = publicTotal + localOnlyItems.length;
  const pageSize = toNumber(publicResult.page_size, params.page_size || items.length || 1);

  return {
    ...publicResult,
    items,
    page: toNumber(publicResult.page, params.page || 1),
    page_size: pageSize,
    total_items: totalItems,
    total_pages: Math.max(toNumber(publicResult.total_pages, 1), totalPages(totalItems, pageSize)),
  };
}

function uploadClaimFromHyperbeam(item: any): any {
  const claim = sdkClaimFromHyperbeam(item);
  if (!claim) return claim;

  const hyperbeam = claim.hyperbeam || {};
  const claimValue = claim.value || {};
  const source = claimValue.source || {};
  const dataId = value(hyperbeam, 'data-id', 'data_id') || value(source, 'sd_hash', 'sd-hash', 'source');
  const recordId = value(hyperbeam, 'record-id', 'record_id') || claim.claim_id;
  const explicitMediaUrl = absoluteHyperbeamUrl(claim.streaming_url || claim.download_url || source.url);
  const mediaUrl =
    explicitMediaUrl ||
    (dataId ? `${hyperbeamBaseUrl()}/${encodeDataPath(String(dataId))}` : '') ||
    (recordId ? `${hyperbeamBaseUrl()}/${UPLOAD_DEVICE}/media?id=${encodeURIComponent(recordId)}` : '');
  const releaseTime = value(claimValue, 'release_time', 'release-time') || claim.timestamp;

  return {
    ...claim,
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

function immutableClaimFromHyperbeam(result: any, immutableId: string): any | null {
  const payload = storePayload(result);
  if (!payload) return null;

  const claim = sdkClaimFromHyperbeam(payload) || payload;
  const existingValue = isObject(value(claim, 'value')) ? value(claim, 'value') : {};
  const payloadSource = isObject(value(payload, 'source')) ? value(payload, 'source') : {};
  const valueSource = isObject(value(existingValue, 'source')) ? value(existingValue, 'source') : {};
  const sourceClaimId = value(payload, 'claim_id', 'claim-id') || value(claim, 'claim_id', 'claim-id');
  const txid = value(payload, 'txid');
  const nout = value(payload, 'nout');
  const device = value(payload, 'device');
  const outpoint =
    typeof txid === 'string' && (typeof nout === 'number' || typeof nout === 'string') ? `${txid}:${nout}` : null;
  const storeId = immutableId || outpoint || value(payload, 'id') || sourceClaimId;
  if (!storeId) return null;

  const rawName = value(payload, 'claim-name', 'claim_name', 'name') || value(claim, 'name');
  const name = safeClaimName(rawName || `store-${String(storeId).slice(0, 8)}`);
  const title = value(existingValue, 'title') || value(payload, 'title') || rawName || name;
  const description = value(existingValue, 'description') || value(payload, 'description') || '';
  const sdHash =
    value(payload, 'sd_hash', 'sd-hash') ||
    value(payloadSource, 'sd_hash', 'sd-hash') ||
    value(valueSource, 'sd_hash', 'sd-hash');
  const mediaType =
    value(payload, 'media_type', 'media-type', 'content-type') ||
    value(payloadSource, 'media_type', 'media-type') ||
    value(valueSource, 'media_type', 'media-type') ||
    (device === 'lbry-stream@1.0' && sdHash ? 'video/mp4' : undefined);
  const explicitMediaUrl = absoluteHyperbeamUrl(
    value(payload, 'streaming_url', 'streaming-url', 'download_url', 'download-url') ||
      value(payloadSource, 'url') ||
      value(valueSource, 'url')
  );
  const directMediaUrl =
    !String(storeId).includes(':') && isMediaContentType(mediaType) ? `${hyperbeamBaseUrl()}/${encodeDataPath(storeId)}` : '';
  const mediaUrl =
    explicitMediaUrl ||
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
    claimUrl(name, sourceClaimId);
  const permanentUrl =
    value(claim, 'permanent_url', 'permanent-url') ||
    value(payload, 'permanent_url', 'permanent-url') ||
    claimUrl(name, sourceClaimId);
  const valueType =
    value(claim, 'value_type', 'value-type') ||
    value(payload, 'value_type', 'value-type') ||
    (device === 'lbry-channel@1.0' || device === 'odysee-channel@1.0' ? 'channel' : 'stream');
  const sourceName =
    value(payloadSource, 'name') ||
    value(valueSource, 'name') ||
    value(payload, 'filename') ||
    (mediaType === 'video/mp4' ? `${name}.mp4` : undefined);

  return compactParams({
    ...claim,
    claim_id: String(storeId),
    name,
    canonical_url: canonicalUrl,
    permanent_url: permanentUrl,
    short_url: value(claim, 'short_url', 'short-url') || permanentUrl,
    value_type: valueType,
    timestamp: value(claim, 'timestamp') || value(payload, 'timestamp', 'release_time', 'release-time'),
    confirmations: toNumber(value(claim, 'confirmations'), 1),
    is_my_output: value(claim, 'is_my_output', 'is-my-output'),
    streaming_url: mediaUrl || value(claim, 'streaming_url', 'streaming-url'),
    download_url: mediaUrl || value(claim, 'download_url', 'download-url'),
    value: compactParams({
      ...existingValue,
      title,
      description,
      thumbnail: thumbnailObject(value(existingValue, 'thumbnail') || value(payload, 'thumbnail'), mediaUrl, mediaType),
      stream_type: value(existingValue, 'stream_type', 'stream-type') || streamTypeFromMediaType(mediaType),
      source: compactParams({
        ...payloadSource,
        ...valueSource,
        sd_hash: sdHash,
        media_type: mediaType,
        name: sourceName,
        size: value(payloadSource, 'size') || value(valueSource, 'size') || value(payload, 'byte-size', 'source-size'),
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

function sameClaim(a: any, b: any): boolean {
  const aId = value(a, 'claim_id', 'claim-id');
  const bId = value(b, 'claim_id', 'claim-id');
  const aImmutableId = value(a?.hyperbeam, 'immutable_id', 'immutable-id');
  const bImmutableId = value(b?.hyperbeam, 'immutable_id', 'immutable-id');
  return Boolean((aImmutableId && bImmutableId && aImmutableId === bImmutableId) || (aId && bId && aId === bId));
}

async function fetchDeviceJson(path: string, body: Record<string, any>): Promise<any | null> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) {
    if (isHyperbeamEnabled()) throw new Error('HyperBEAM node is not configured');
    return null;
  }
  const device = deviceFromPath(path);
  if (device && !isHyperbeamDeviceEnabled(device)) return null;

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

async function fetchStoreJsonOrNull(path: string): Promise<any | null> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) return null;
  if (!allowHyperbeamCompatibilityReads() && isCompatibilityStorePath(path)) return null;

  try {
    const response = await fetch(buildDeviceUrl(baseUrl, path), {
      headers: { accept: 'application/json' },
      signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseDeviceJson(await response.text());
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

function hyperbeamBaseUrl(): string {
  return String(HYPERBEAM_BASE_URL || ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
}

function buildDeviceUrl(baseUrl: string, path: string): string {
  return `${baseUrl}/${path}`;
}

function storePath(prefix: string, value: string): string {
  return `${prefix}/${encodeURIComponent(value)}`;
}

function deviceFromPath(path: string): string {
  return String(path || '').split('/')[0];
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

function storePayload(result: any): any {
  const payload = responsePayload(result);
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

function safeClaimName(name: any): string {
  const cleaned = String(name || '')
    .replace(/^lbry:\/\//, '')
    .replace(/[ =&#:$@%?;/\\\n"<>%{}|^~[\]`]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || 'store-object';
}

function claimUrl(name: string, claimId: any): string {
  const suffix = typeof claimId === 'string' && /^[0-9a-f]{1,40}$/i.test(claimId) ? `#${claimId}` : '';
  return `lbry://${name}${suffix}`;
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
  const value = thumbnail || (mediaUrl && typeof mediaType === 'string' && mediaType.startsWith('image/') ? mediaUrl : null);
  if (typeof value === 'string') return { url: value };
  return isObject(value) ? value : undefined;
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
  const mediaUrl = hyperbeamMediaUrlFromPayload(payload);

  return {
    ...payload,
    streaming_url: mediaUrl || payload.streaming_url,
    download_url: mediaUrl || payload.download_url,
  };
}

function hyperbeamMediaUrlFromPayload(payload: any): string {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl || !payload) return '';

  const sdHash = value(payload, 'sd_hash', 'sd-hash');
  if (sdHash) return `${baseUrl}/${ODYSEE_DEVICE}/media?sd-hash=${encodeURIComponent(String(sdHash))}`;
  if (!allowHyperbeamCompatibilityReads()) return '';

  const streamStorePath = value(payload, 'stream-store-path', 'stream_store_path');
  if (typeof streamStorePath === 'string') {
    if (streamStorePath.startsWith('odysee/stream-id/')) {
      return `${baseUrl}/odysee/media/stream-id/${encodeURIComponent(streamStorePath.slice('odysee/stream-id/'.length))}`;
    }
    if (streamStorePath.startsWith('odysee/stream/')) {
      return `${baseUrl}/odysee/media/stream/${encodeURIComponent(streamStorePath.slice('odysee/stream/'.length))}`;
    }
  }

  const claimId = value(payload, 'claim_id', 'claim-id');
  if (claimId) return `${baseUrl}/odysee/media/stream-id/${encodeURIComponent(String(claimId))}`;
  return '';
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
