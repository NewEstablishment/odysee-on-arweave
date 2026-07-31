import { HYPERBEAM_BASE_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { SORT_BY } from 'constants/comment';
import { X_LBRY_AUTH_TOKEN } from 'constants/token';
import Lbry from 'lbry';
import { Lbryio } from 'lbryinc';
import { pushHyperbeamDebug } from 'util/hyperbeamDebug';
import { isServedFromManifest } from 'util/manifest-prefix';
import { isHyperbeamUploadClaim } from 'util/claim';
import { buildURI, parseURI } from 'util/lbryURI';
import { toHex } from 'util/hex';
import {
  collapseNativeCommentRevisions,
  isNextNativeCommentRevision,
  nativeCommentSignatureData,
} from 'util/nativeCommentRevisions';
import {
  hasNativeCommentControlAuthority,
  isNativeCommentControlEnabled,
  legacyBlockControlsToImport,
  latestNativeCommentControls,
  NATIVE_COMMENT_CONTROL_SCHEMA,
  NATIVE_COMMENT_CONTROL_SIGNATURE_SCOPE,
  NATIVE_COMMENT_CONTROL_TYPE,
  nativeCommentControlSignatureData,
  normalizeNativeCommentControl,
  projectNativeCommentControlState,
  type NativeCommentControl,
} from 'util/nativeCommentControls';
import { getAuthToken } from 'util/saved-passwords';
import { hyperbeamImmutableIdFromUri, hyperbeamImmutableUri, hyperbeamImmutableWebPath } from 'util/hyperbeam-route';

const HYPERBEAM_TIMEOUT_MS = 15000;
const HYPERBEAM_READ_CACHE_MS = 30 * 1000;
const HYPERBEAM_FAILED_READ_CACHE_MS = 10 * 1000;
const LBRY_CLAIM_ID_RE = /^[0-9a-f]{40}$/i;
const NATIVE_COMMENT_QUERY_CACHE_MS = HYPERBEAM_READ_CACHE_MS;
const NATIVE_COMMENT_TARGET_OWNER_CACHE_MS = 30 * 1000;
const NATIVE_COMMENT_READ_CONCURRENCY = 4;
const CLAIM_ID_BATCH_SIZE = 50;
const SEARCH_HYDRATION_CONCURRENCY = 4;
const SEARCH_REQUEST_ATTEMPTS = 3;
const SEARCH_REQUEST_RETRY_MS = 250;
const SEARCH_REQUEST_TIMEOUT_MS = 5000;
const HYPERBEAM_PUBLIC_STORE_BATCH_LIMIT = 100;
const HYPERBEAM_STORE_LINK_DEPTH = 3;
const HYPERBEAM_EAGER_STORE_LINK_FIELDS = new Set(['value', 'source', 'thumbnail']);
const HYPERBEAM_AUTH_DEVICE_PROXY_BASE = '/$/api/hyperbeam-auth-device/v1';
const HYPERBEAM_PUBLIC_DEVICE_PROXY_BASE = '/$/api/hyperbeam-public-device/v1';
const HYPERBEAM_PUBLIC_STORE_BATCH_PROXY = '/$/api/hyperbeam-public-store/v1/read-batch';
const CLAIM_DEVICE = '~odysee-claim@1.0';
const ACCOUNT_DEVICE = '~odysee-account@1.0';
const COMMENT_DEVICE = '~odysee-comment@1.0';
const REACTION_DEVICE = '~odysee-reaction@1.0';
const FILE_DEVICE = '~odysee-file@1.0';
const FILE_REACTION_DEVICE = '~odysee-file-reaction@1.0';
const SUBSCRIPTION_DEVICE = ACCOUNT_DEVICE;
const CHANNEL_DEVICE = '~odysee-channel@1.0';
const STREAM_DEVICE = '~odysee-stream@1.0';
const SEARCH_DEVICE = '~search@1.0';
const QUERY_DEVICE = '~query@1.0';
const CACHE_DEVICE = '~cache@1.0';
const UPLOAD_DEVICE = '~odysee-upload@1.0';
const HYPERBEAM_MESSAGE_WRITE_PROXY = '/$/api/hyperbeam-upload/v1/write';
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
const nativeCommentQueryCache = new Map<string, { expiresAt: number; promise: Promise<Array<any>> }>();
const nativeCommentSignatureCache = new Map<string, Promise<boolean>>();
const nativeCommentControlQueryCache = new Map<
  string,
  { expiresAt: number; promise: Promise<Array<NativeCommentControl>> }
>();
const nativeCommentControlSignatureCache = new Map<string, Promise<boolean>>();
const nativeCommentTargetOwnerCache = new Map<string, { expiresAt: number; promise: Promise<string | null> }>();
let lastNativeCommentControlTimestamp = 0;
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
  `${COMMENT_DEVICE}/super-list`,
]);

export async function fetchHyperbeamResolve(params: any): Promise<any | null> {
  const urls = urlsFromResolveParams(params);
  if (!urls.length) return null;

  // Immutable-id routes (out_<txid>_<nout> / 43-char ids) and every other uri
  // shape resolve through the per-uri chain (store GET first, wrapper-store
  // law); channel claim-id uris batch through the store claim-id path.
  const immutableUris = urls.filter((uri) => immutableRouteIdFromUri(uri));
  const mutableUris = urls.filter((uri) => !immutableRouteIdFromUri(uri));
  const { channelUris, resolveUris: plainUris } = splitClaimIdChannelUris(mutableUris);
  const channelEntries =
    channelUris.length > 1 ? await fetchClaimIdChannelEntries(channelUris) : await fetchResolveEntries(channelUris);
  const immutableEntries = await fetchImmutableResolveEntries(
    immutableUris,
    isObject(params?.immutable_signing_channel_ids) ? params.immutable_signing_channel_ids : {}
  );
  const resolveEntries = await fetchResolveEntries(plainUris);

  return Object.fromEntries([...channelEntries, ...immutableEntries, ...resolveEntries].filter(([, claim]) => claim));
}

async function fetchResolveEntries(urls: Array<string>): Promise<Array<[string, any]>> {
  return Promise.all(
    urls.map(async (uri): Promise<[string, any]> => {
      const immutableClaim = await fetchHyperbeamImmutableResolve(uri).catch(() => null);
      if (immutableClaim) return [uri, immutableClaim];

      const locatedClaim = await fetchHyperbeamLocatedClaim(uri).catch(() => null);
      if (locatedClaim) return [uri, locatedClaim];

      // Sam's ruling (2026-07-17): name-to-claim resolution must be a device,
      // not a store read — a uri is not a verifiable content-derived ID.
      const getResponse = await fetchCachedStoreJsonOrNull(
        `${CLAIM_DEVICE}/resolve?url=${encodeURIComponent(uri)}`
      ).catch(() => null);
      const getEntry = claimFromUriKeyedResult(responsePayload(getResponse), uri);
      const getClaim = getEntry && sdkClaimFromHyperbeam(getEntry);
      if (getClaim && getClaim.claim_id) return [uri, await immutableClaimForResolvedUri(uri, getClaim)];

      const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/resolve`, { uri }).catch(() => null);
      const deviceEntry = claimFromUriKeyedResult(responsePayload(response), uri);
      const claim = deviceEntry && sdkClaimFromHyperbeam(deviceEntry);
      if (claim && claim.claim_id) return [uri, await immutableClaimForResolvedUri(uri, claim)];

      return [uri, await fetchHyperbeamUploadResolve(uri).catch(() => null)];
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
    uri ? { uri, media_base_url: hyperbeamBaseUrl() } : { id }
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

// Uniform comment anchor (2026-07-29 direction): legacy videos anchor on
// their claim id; native content anchors on its immutable id. Comments are
// created against this anchor and looked up by it.
export function commentAnchorForClaim(claim: any): string | undefined {
  if (!claim) return undefined;
  const claimId = String(claim.claim_id || '');
  if (LBRY_CLAIM_ID_RE.test(claimId)) return claimId;
  const hyperbeam = claim.hyperbeam || {};
  return (
    value(hyperbeam, 'immutable-id', 'immutable_id', 'record-id', 'record_id', 'data-id', 'data_id') ||
    claimId ||
    undefined
  );
}

export async function fetchHyperbeamCommentList(params: CommentListParams): Promise<CommentListResponse | null> {
  const [nativeResult, legacyResult] = await Promise.allSettled([
    fetchNativeCommentSource(params),
    fetchLegacyCommentSource(params),
  ]);
  const native = nativeResult.status === 'fulfilled' ? nativeResult.value : null;
  const legacy = legacyResult.status === 'fulfilled' ? legacyResult.value : null;

  if (!native && !legacy) {
    const error =
      nativeResult.status === 'rejected'
        ? nativeResult.reason
        : legacyResult.status === 'rejected'
          ? legacyResult.reason
          : new Error('No comment source returned a valid response');
    throw error instanceof Error ? error : new Error(String(error));
  }

  return mergeCommentSources(params, native, legacy);
}

type ClaimPageOptions = { commentsPageSize?: number; commentsSortBy?: number };

export function fetchHyperbeamClaimPage(claimId: string, options: ClaimPageOptions = {}): Promise<any | null> {
  if (!LBRY_CLAIM_ID_RE.test(String(claimId || ''))) return Promise.resolve(null);

  const query = new URLSearchParams();
  if (options.commentsPageSize) query.set('comments-page-size', String(options.commentsPageSize));
  if (options.commentsSortBy !== undefined && options.commentsSortBy !== null) {
    query.set('comments-sort-by', String(options.commentsSortBy));
  }
  const queryString = query.toString();
  const key = `${claimPageCachePrefix(claimId)}${queryString}`;
  const now = Date.now();
  const cached = deviceReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchHyperbeamClaimStoreId({ claim_id: claimId })
    .then((id) =>
      id
        ? fetchStoreJsonOrNull(
            `${encodeDataPath(id)}/${CLAIM_DEVICE}/page?claim-id=${encodeURIComponent(claimId)}${
              queryString ? `&${queryString}` : ''
            }`
          )
        : null
    )
    .then((response) => {
      const page = messagePayload(response);
      return page && value(page, 'claim-id', 'claim_id') ? page : null;
    })
    .catch((error) => {
      deviceReadCache.delete(key);
      throw error;
    });
  deviceReadCache.set(key, { expiresAt: now + HYPERBEAM_READ_CACHE_MS, promise });
  return promise;
}

function claimPageCachePrefix(claimId: string): string {
  return `claim-page:${String(claimId || '').toLowerCase()}:`;
}

export function invalidateHyperbeamClaimPage(claimId: string | null | undefined) {
  if (!claimId) return;
  const prefix = claimPageCachePrefix(String(claimId));
  Array.from(deviceReadCache.keys()).forEach((key) => {
    if (key.startsWith(prefix)) deviceReadCache.delete(key);
  });
}

// Never initiates a page fetch of its own.
async function cachedClaimPageSection(claimId: string, sectionKey: string): Promise<any | null> {
  const prefix = claimPageCachePrefix(claimId);
  const now = Date.now();

  for (const [key, cached] of deviceReadCache.entries()) {
    if (!key.startsWith(prefix) || cached.expiresAt <= now) continue;
    const page = await cached.promise.catch(() => null);
    const section = page && value(page, sectionKey);
    if (section) return section;
  }
  return null;
}

export async function fetchHyperbeamCommentById(params: CommentByIdParams): Promise<CommentByIdResponse | null> {
  const native = await fetchNativeCommentById(params.comment_id);
  if (native) {
    const ancestors = params.with_ancestors ? await fetchNativeCommentAncestors(native) : [];
    return { item: native, items: [native], ancestors };
  }

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

export async function fetchHyperbeamCommentSuperList(params: SuperListParams): Promise<SuperListResponse | null> {
  return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/super-list`, params);
}

export async function fetchHyperbeamCommentCreate(params: CommentCreateParams): Promise<CommentCreateResponse | null> {
  if (params.dry_run) return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/create`, params);

  await requireNativeCommentAuthorAllowed(params.claim_id, params.channel_id);
  const message = await signNativeCommentMessage(nativeCommentMessage(params));
  const commentId = await writeNativeMessage(message, 'comment');
  clearNativeCommentCaches();
  const comment = await fetchNativeCommentVersionById(commentId);
  if (!comment) throw new Error('HyperBEAM native comment failed channel signature verification');
  return comment;
}

async function writeNativeMessage(message: Record<string, any>, label: string): Promise<string> {
  const response = await fetch(HYPERBEAM_MESSAGE_WRITE_PROXY, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(message),
    signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
  });
  const result = await responseJsonWithHeaders(response);
  if (!response.ok) throw new Error(`HyperBEAM native ${label} write failed with ${response.status}`);

  const commentId = nativeWriteId(result);
  if (!commentId) throw new Error(`HyperBEAM native ${label} write did not return an ID`);
  return commentId;
}

type CommentSource = {
  items: Array<any>;
  totalItems: number;
  totalFilteredItems: number;
  hasHiddenComments: boolean;
};

async function fetchNativeCommentSource(params: CommentListParams): Promise<CommentSource> {
  const selectors = nativeCommentSelectors(params);
  if (!selectors) return { items: [], totalItems: 0, totalFilteredItems: 0, hasHiddenComments: false };

  const comments = await fetchNativeCommentCollection(selectors);
  const projected = await projectNativeCommentCollection(comments);
  const visibleComments = projected.items.filter((comment) => !comment.removed && !comment.hidden && !comment.blocked);
  const childCounts = nativeCommentChildCounts(visibleComments);
  const items = projected.items
    .filter((comment) => nativeCommentMatchesParams(comment, params))
    .map((comment) => ({
      ...comment,
      replies: Math.max(toNumber(comment.replies, 0), childCounts.get(String(comment.comment_id)) || 0),
    }));

  return {
    items,
    totalItems: params.claim_id && !params.parent_id && !params.author_claim_id ? visibleComments.length : items.length,
    totalFilteredItems: items.length,
    hasHiddenComments: projected.hasHiddenComments,
  };
}

async function fetchNativeCommentCollection(selectors: Record<string, any>): Promise<Array<any>> {
  return collapseNativeCommentRevisions(await fetchNativeCommentVersions(selectors));
}

async function fetchNativeCommentVersions(selectors: Record<string, any>): Promise<Array<any>> {
  const request = nativeQueryRequest(selectors);
  const key = stableJson(request);
  return cachedNativeQuery(nativeCommentQueryCache, key, async () => {
    const paths = uniquePaths(queryPaths(await fetchPublicQueryJson(request)));
    const comments = await resolveNativeCommentPaths(paths);
    return comments.filter((comment) => nativeCommentMatchesSelectors(comment, selectors));
  });
}

async function resolveNativeCommentPaths(paths: Array<string>): Promise<Array<any>> {
  const comments = Array.from({ length: paths.length });
  let cursor = 0;
  const workers = Array.from({ length: Math.min(paths.length, NATIVE_COMMENT_READ_CONCURRENCY) }, async () => {
    while (cursor < paths.length) {
      const index = cursor++;
      comments[index] = await fetchNativeCommentVersionById(paths[index]);
    }
  });
  await Promise.all(workers);
  return comments.filter(Boolean);
}

function nativeCommentChildCounts(comments: Array<any>): Map<string, number> {
  const counts = new Map<string, number>();
  comments.forEach((comment) => {
    const parentId = String(comment?.parent_id || 'root');
    if (parentId !== 'root') counts.set(parentId, (counts.get(parentId) || 0) + 1);
  });
  return counts;
}

function nativeCommentMatchesParams(comment: any, params: CommentListParams): boolean {
  if (params.claim_id && String(comment?.parent_id || 'root') !== String(params.parent_id || 'root')) return false;
  if (params.author_claim_id && String(comment?.channel_id || '') !== String(params.author_claim_id)) return false;
  const isHidden = Boolean(comment?.removed || comment?.hidden || comment?.blocked);
  if (params.hidden) return isHidden;
  if (params.visible === false) return isHidden;
  return !isHidden;
}

function nativeCommentMatchesSelectors(comment: any, selectors: Record<string, any>): boolean {
  const fields: Record<string, any> = {
    schema: comment?.schema,
    type: comment?.type,
    // Comments may anchor on an immutable id (`target`) or a legacy claim
    // id; accept whichever anchor the message actually carries.
    target: comment?.target || comment?.claim_id,
    state: comment?.state,
    author: comment?.channel_id,
    parent: comment?.parent_id || 'root',
    'revision-of': comment?.revision_of,
  };
  return Object.entries(selectors).every(([key, expected]) => fields[key] === expected);
}

// The composed page section is only served when its page-size matches the
// request; a node composing with other parameters falls through to /comments.
async function legacyCommentSourceFromGetPath(params: CommentListParams): Promise<CommentSource | null> {
  const claimId = String((params as any).claim_id || '');
  if (!LBRY_CLAIM_ID_RE.test(claimId) || (params as any).is_protected) return null;

  const sortBy = (params as any).sort_by;
  const isDefaultTopLevel =
    (params.page || 1) === 1 &&
    !(params as any).parent_id &&
    (params as any).top_level !== false &&
    sortBy !== undefined &&
    sortBy !== null;
  if (!isDefaultTopLevel) return null;

  const page = await fetchHyperbeamClaimPage(claimId, {
    commentsPageSize: params.page_size,
    commentsSortBy: sortBy,
  }).catch(() => null);
  const section = page && value(page, 'comments');
  if (!section) return null;
  const sectionPageSize = toNumber(value(section, 'page-size', 'page_size'), 0);
  if (params.page_size && sectionPageSize !== params.page_size) return null;

  const comments = section.comments || section.items;
  if (!Array.isArray(comments)) return null;

  const totalItems = toNumber(value(section, 'total-items', 'total_items'), comments.length);
  return {
    items: comments.map(commentFromHyperbeam),
    totalItems,
    totalFilteredItems: toNumber(value(section, 'total-filtered-items', 'total_filtered_items'), totalItems),
    hasHiddenComments: Boolean(value(section, 'has-hidden-comments', 'has_hidden_comments')),
  };
}

async function fetchLegacyCommentSource(params: CommentListParams): Promise<CommentSource | null> {
  const getPathSource = await legacyCommentSourceFromGetPath(params).catch(() => null);
  if (getPathSource) return getPathSource;

  const page = positiveInteger(params.page, 1);
  const pageSize = positiveInteger(params.page_size, 10);
  const response = await fetchDeviceJson(`${COMMENT_DEVICE}/list`, {
    ...params,
    page: 1,
    page_size: page * pageSize,
  });
  const result = responsePayload(response);
  const comments = result && (result.comments || result.items);
  if (!Array.isArray(comments)) return null;

  return {
    items: comments.map(commentFromHyperbeam),
    totalItems: toNumber(value(result, 'total-items', 'total_items'), comments.length),
    totalFilteredItems: toNumber(
      value(result, 'total-filtered-items', 'total_filtered_items'),
      toNumber(value(result, 'total-items', 'total_items'), comments.length)
    ),
    hasHiddenComments: Boolean(value(result, 'has-hidden-comments', 'has_hidden_comments')),
  };
}

function mergeCommentSources(
  params: CommentListParams,
  native: CommentSource | null,
  legacy: CommentSource | null
): CommentListResponse {
  const page = positiveInteger(params.page, 1);
  const pageSize = positiveInteger(params.page_size, 10);
  const nativeItems = native?.items || [];
  const items = dedupeComments([...nativeItems, ...(legacy?.items || [])]);
  if (nativeItems.length) items.sort(commentComparator(params.sort_by));
  const start = (page - 1) * pageSize;
  const totalItems = (native?.totalItems || 0) + (legacy?.totalItems || 0);
  const totalFilteredItems = (native?.totalFilteredItems || 0) + (legacy?.totalFilteredItems || 0);

  return {
    items: items.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total_items: totalItems,
    total_filtered_items: totalFilteredItems,
    total_pages: totalFilteredItems ? Math.ceil(totalFilteredItems / pageSize) : 0,
    has_hidden_comments: Boolean(native?.hasHiddenComments || legacy?.hasHiddenComments),
  };
}

function nativeCommentSelectors(params: CommentListParams): Record<string, any> | null {
  // The loading switch: match on the caller's anchor -- the claim id when
  // the resolved content carries one, otherwise its immutable id.
  const target = (params as any).target || params.claim_id;
  if (target) {
    return {
      schema: 'odysee-comment@1.0',
      type: 'comment',
      target,
      state: 'active',
    };
  }

  if (params.author_claim_id) {
    return {
      schema: 'odysee-comment@1.0',
      type: 'comment',
      author: params.author_claim_id,
      state: 'active',
    };
  }

  return null;
}

function nativeCommentMessage(params: CommentCreateParams): Record<string, any> {
  const comment = params.comment || params.body;
  if (!comment) throw new Error('Native comment text is required');

  return compactParams({
    schema: 'odysee-comment@1.0',
    type: 'comment',
    // Uniform anchor: callers pass the content's immutable id as `target`
    // when it has one; legacy videos stay anchored on the claim id.
    target: params.target || params.claim_id,
    parent: params.parent_id || 'root',
    state: 'active',
    author: params.channel_id,
    comment,
    'claim-id': params.claim_id,
    'parent-id': params.parent_id,
    'channel-id': params.channel_id,
    'channel-name': params.channel_name,
    'channel-signature': params.signature,
    'signing-ts': params.signing_ts,
    timestamp: Math.floor(Date.now() / 1000),
    'support-amount': params.amount || params.support_amount,
    'support-tx-id': params.support_tx_id,
    sticker: params.sticker,
    'mentioned-channels': params.mentioned_channels,
    'is-protected': params.is_protected,
    replies: 0,
    'is-pinned': false,
  });
}

function nativeCommentRevisionMessage(root: any, current: any, params: CommentEditParams): Record<string, any> {
  const comment = params.comment || params.body;
  if (!comment) throw new Error('Native comment revision text is required');

  const updatedAt = Math.floor(Date.now() / 1000);
  return compactParams({
    schema: 'odysee-comment@1.0',
    type: 'comment',
    target: root.target || root.claim_id,
    parent: root.parent_id || 'root',
    state: 'active',
    author: root.channel_id,
    comment,
    'claim-id': root.claim_id,
    'parent-id': root.parent_id,
    'channel-id': root.channel_id,
    'channel-name': root.channel_name,
    'channel-signature': params.signature,
    'signing-ts': params.signing_ts,
    timestamp: root.timestamp,
    'updated-at': updatedAt,
    'revision-of': root.comment_id,
    'previous-version': current.hyperbeam_message_id || current.comment_id,
    revision: toNumber(current.revision, 0) + 1,
    'revision-timestamp': Date.now(),
    operation: 'edit',
    'support-amount': root.support_amount,
    'support-tx-id': root.support_tx_id,
    sticker: root.sticker,
    'mentioned-channels': root.mentioned_channels,
    'is-protected': root.is_protected,
    replies: root.replies,
    'is-pinned': root.is_pinned,
  });
}

async function signNativeCommentMessage(message: Record<string, any>): Promise<Record<string, any>> {
  const scopedMessage = { ...message, 'signature-scope': 'native-comment-v1' };
  const signed = await Lbry.channel_sign({
    channel_id: value(scopedMessage, 'channel-id', 'channel_id', 'author'),
    hexdata: toHex(nativeCommentSignatureData(scopedMessage)),
  });
  if (!signed?.signature || !signed?.signing_ts) throw new Error('Unable to sign native comment message');
  return {
    ...scopedMessage,
    'channel-signature': signed.signature,
    'signing-ts': signed.signing_ts,
  };
}

async function fetchNativeCommentById(id: string): Promise<any | null> {
  const comment = await fetchNativeCommentByIdRaw(id);
  if (!comment) return null;
  const projected = await projectNativeCommentCollection([comment]);
  const item = projected.items[0];
  return item && !item.removed && !item.hidden && !item.blocked ? item : null;
}

async function fetchNativeCommentByIdRaw(id: string): Promise<any | null> {
  const direct = await fetchNativeCommentVersionById(id);
  if (!direct) return null;

  const rootId = direct.revision_of || direct.comment_id;
  const comments = await fetchNativeCommentCollection({
    schema: 'odysee-comment@1.0',
    type: 'comment',
    target: direct.target || direct.claim_id,
    state: 'active',
  });
  return comments.find((comment) => comment.comment_id === rootId) || direct;
}

async function fetchNativeCommentVersionById(id: string): Promise<any | null> {
  if (!id) return null;
  const normalizedId = id.replace(/^\/+/, '');
  const result = await fetchCachedStoreJsonOrNull(
    `${CACHE_DEVICE}/read?read=${encodeURIComponent(normalizedId)}`,
    false
  );
  const payload = storePayload(result);
  const message = {
    ...payload,
    'message-id': normalizedId,
    'comment-id': value(payload, 'comment-id', 'comment_id') || normalizedId,
  };
  if (!isNativeComment(message)) return null;
  const comment = commentFromHyperbeam(message);
  if (!(await verifyNativeCommentSignature(comment))) return null;
  return {
    ...comment,
    hyperbeam_owner: comment.channel_id,
    hyperbeam_signature_verification: 'valid',
  };
}

async function verifyNativeCommentSignature(comment: any): Promise<boolean> {
  const messageId = String(comment?.hyperbeam_message_id || '');
  if (!messageId) return false;

  const cached = nativeCommentSignatureCache.get(messageId);
  if (cached) return cached;

  const promise = fetchPublicDeviceResponse(`${COMMENT_DEVICE}/verify-signature`, {
    'channel-id': comment.channel_id,
    'channel-name': comment.channel_name,
    data: nativeCommentSignatureData(comment),
    signature: comment.signature,
    'signing-ts': comment.signing_ts,
  })
    .then((result) => toBoolean(value(result, 'is-valid', 'is_valid')))
    .catch(() => {
      nativeCommentSignatureCache.delete(messageId);
      return false;
    });
  nativeCommentSignatureCache.set(messageId, promise);
  if (nativeCommentSignatureCache.size > 2000) {
    const oldest = nativeCommentSignatureCache.keys().next().value;
    if (oldest && oldest !== messageId) nativeCommentSignatureCache.delete(oldest);
  }
  return promise;
}

type NativeCommentControlState = {
  owner: string | null;
  controls: Map<string, NativeCommentControl>;
};

async function projectNativeCommentCollection(
  comments: Array<any>
): Promise<{ items: Array<any>; hasHiddenComments: boolean }> {
  const groups = new Map<string, Array<any>>();
  comments.forEach((comment) => {
    const target = String(comment?.target || comment?.claim_id || '');
    if (!target) return;
    const group = groups.get(target) || [];
    group.push(comment);
    groups.set(target, group);
  });

  const states = new Map<string, NativeCommentControlState>();
  await Promise.all(
    Array.from(groups.entries()).map(async ([target, targetComments]) => {
      states.set(target, await fetchNativeCommentControlState(target, targetComments));
    })
  );

  let hasHiddenComments = false;
  const items = comments.map((comment) => {
    const state = states.get(String(comment?.target || comment?.claim_id || ''));
    const controls = state?.controls || new Map<string, NativeCommentControl>();
    const projection = projectNativeCommentControlState(comment, state?.owner || null, controls);
    if (projection.removed || projection.hidden || projection.blocked) hasHiddenComments = true;
    return {
      ...comment,
      ...projection,
      native_owner_id: state?.owner || undefined,
    };
  });

  return { items, hasHiddenComments };
}

async function fetchNativeCommentControlState(
  target: string,
  comments: Array<any>
): Promise<NativeCommentControlState> {
  const owner = await nativeCommentTargetOwner(target);
  if (!owner) return { owner, controls: new Map() };

  const authors = new Set(comments.map((comment) => String(comment?.channel_id || '')).filter(Boolean));
  const controls = (
    await fetchNativeCommentControls({
      schema: NATIVE_COMMENT_CONTROL_SCHEMA,
      type: NATIVE_COMMENT_CONTROL_TYPE,
      owner,
    })
  ).filter(
    (control) =>
      control.target === target ||
      (control.control === 'block' &&
        control.target === owner &&
        Boolean(control.subject && authors.has(control.subject)))
  );
  const byId = new Map<string, NativeCommentControl>();
  controls.forEach((control) => {
    if (control.hyperbeam_message_id) byId.set(control.hyperbeam_message_id, control);
  });
  const authorized = (
    await Promise.all(
      Array.from(byId.values()).map(async (control) =>
        (await authorizeNativeCommentControl(control, target, owner, comments)) ? control : null
      )
    )
  ).filter(Boolean);
  return { owner, controls: latestNativeCommentControls(authorized) };
}

async function fetchNativeBlockControls(owner: string, subjects?: Array<string>): Promise<Array<NativeCommentControl>> {
  const selectors = {
    schema: NATIVE_COMMENT_CONTROL_SCHEMA,
    type: NATIVE_COMMENT_CONTROL_TYPE,
    target: owner,
    control: 'block',
  };
  if (!subjects) return fetchNativeCommentControls(selectors);
  const controls = await Promise.all(subjects.map((subject) => fetchNativeCommentControls({ ...selectors, subject })));
  return controls.flat();
}

async function fetchNativeCommentControls(selectors: Record<string, any>): Promise<Array<NativeCommentControl>> {
  const request = nativeQueryRequest(selectors);
  const key = stableJson(request);
  return cachedNativeQuery(nativeCommentControlQueryCache, key, async () => {
    const paths = uniquePaths(queryPaths(await fetchPublicQueryJson(request)));
    const controls = await resolveNativeCommentControlPaths(paths);
    return controls.filter((control) => nativeCommentControlMatchesSelectors(control, selectors));
  });
}

function nativeCommentControlMatchesSelectors(control: NativeCommentControl, selectors: Record<string, any>): boolean {
  return Object.entries(selectors).every(
    ([key, expected]) => control[key.replace(/-([a-z])/g, (_, char) => `_${char}`)] === expected
  );
}

function uniquePaths(paths: Array<string>): Array<string> {
  return Array.from(new Set(paths.map((path) => path.replace(/^\/+/, '')).filter(Boolean)));
}

function nativeQueryRequest(selectors: Record<string, any>): Record<string, any> {
  return {
    ...selectors,
    only: [...Object.keys(selectors), 'accept'],
    return: 'paths',
    'cache-control': ['no-store', 'no-cache'],
  };
}

function cachedNativeQuery<T>(
  cache: Map<string, { expiresAt: number; promise: Promise<T> }>,
  key: string,
  load: () => Promise<T>
): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  let promise: Promise<T>;
  promise = load()
    .then((result) => {
      const current = cache.get(key);
      if (current?.promise === promise) current.expiresAt = Date.now() + NATIVE_COMMENT_QUERY_CACHE_MS;
      return result;
    })
    .catch((error) => {
      if (cache.get(key)?.promise === promise) cache.delete(key);
      throw error;
    });
  cache.set(key, { expiresAt: Number.POSITIVE_INFINITY, promise });
  return promise;
}

async function resolveNativeCommentControlPaths(paths: Array<string>): Promise<Array<NativeCommentControl>> {
  const controls = Array.from({ length: paths.length });
  let cursor = 0;
  const workers = Array.from({ length: Math.min(paths.length, NATIVE_COMMENT_READ_CONCURRENCY) }, async () => {
    while (cursor < paths.length) {
      const index = cursor++;
      controls[index] = await fetchNativeCommentControlById(paths[index]);
    }
  });
  await Promise.all(workers);
  return controls.filter(Boolean);
}

async function fetchNativeCommentControlById(id: string): Promise<NativeCommentControl | null> {
  if (!id) return null;
  const normalizedId = id.replace(/^\/+/, '');
  const result = await fetchCachedStoreJsonOrNull(
    `${CACHE_DEVICE}/read?read=${encodeURIComponent(normalizedId)}`,
    false
  );
  const payload = storePayload(result);
  const control = normalizeNativeCommentControl({ ...payload, 'message-id': normalizedId });
  if (!isNativeCommentControl(control) || !(await verifyNativeCommentControlSignature(control))) return null;
  return control;
}

function isNativeCommentControl(control: NativeCommentControl): boolean {
  return Boolean(
    control.schema === NATIVE_COMMENT_CONTROL_SCHEMA &&
    control.type === NATIVE_COMMENT_CONTROL_TYPE &&
    control.signature_scope === NATIVE_COMMENT_CONTROL_SIGNATURE_SCOPE &&
    control.control &&
    control.action &&
    control.target &&
    control.owner &&
    control.actor &&
    control.actor_name &&
    control.event_timestamp &&
    control.signature &&
    control.signing_ts &&
    control.hyperbeam_message_id
  );
}

async function verifyNativeCommentControlSignature(control: NativeCommentControl): Promise<boolean> {
  const id = String(control.hyperbeam_message_id || '');
  if (!id) return false;
  const cached = nativeCommentControlSignatureCache.get(id);
  if (cached) return cached;

  const promise = fetchPublicDeviceResponse(`${COMMENT_DEVICE}/verify-signature`, {
    'channel-id': control.actor,
    'channel-name': control.actor_name,
    data: nativeCommentControlSignatureData(control),
    signature: control.signature,
    'signing-ts': control.signing_ts,
  })
    .then((result) => toBoolean(value(result, 'is-valid', 'is_valid')))
    .catch(() => {
      nativeCommentControlSignatureCache.delete(id);
      return false;
    });
  nativeCommentControlSignatureCache.set(id, promise);
  if (nativeCommentControlSignatureCache.size > 2000) {
    const oldest = nativeCommentControlSignatureCache.keys().next().value;
    if (oldest && oldest !== id) nativeCommentControlSignatureCache.delete(oldest);
  }
  return promise;
}

async function authorizeNativeCommentControl(
  control: NativeCommentControl,
  target: string,
  owner: string | null,
  comments: Array<any>
): Promise<boolean> {
  if (!(await verifyNativeCommentControlSignature(control))) return false;
  const comment = comments.find((item) => String(item?.comment_id || '') === String(control.comment_id || ''));
  return hasNativeCommentControlAuthority(control, { target, owner, comment });
}

async function nativeCommentTargetOwner(target: string): Promise<string | null> {
  const now = Date.now();
  const cached = nativeCommentTargetOwnerCache.get(target);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = fetchHyperbeamClaimsByIds([target])
    .then((claims) => nativeClaimOwnerId(claims.find((claim) => claim?.claim_id === target) || claims[0]))
    .then((owner) => {
      if (!owner) nativeCommentTargetOwnerCache.delete(target);
      return owner;
    })
    .catch((error) => {
      nativeCommentTargetOwnerCache.delete(target);
      throw error;
    });
  nativeCommentTargetOwnerCache.set(target, {
    expiresAt: now + NATIVE_COMMENT_TARGET_OWNER_CACHE_MS,
    promise,
  });
  return promise;
}

function nativeClaimOwnerId(claim: any): string | null {
  if (!claim) return null;
  if (value(claim, 'value_type', 'value-type') === 'channel')
    return String(value(claim, 'claim_id', 'claim-id') || '') || null;
  const owner =
    value(claim.signing_channel, 'claim_id', 'claim-id', 'id') ||
    value(claim, 'channel_claim_id', 'channel-claim-id', 'signing_channel_id', 'signing-channel-id') ||
    value(claim.hyperbeam, 'channel_id', 'channel-id');
  return owner ? String(owner) : null;
}

function nativeCommentControlMessage(params: {
  control: string;
  action: string;
  authority: string;
  target: string;
  owner: string;
  actor: string;
  actorName: string;
  sourceSystem?: string;
  commentId?: string;
  subject?: string;
  subjectName?: string;
  expiresAt?: number;
}): Record<string, any> {
  return compactParams({
    schema: NATIVE_COMMENT_CONTROL_SCHEMA,
    type: NATIVE_COMMENT_CONTROL_TYPE,
    control: params.control,
    action: params.action,
    authority: params.authority,
    target: params.target,
    owner: params.owner,
    actor: params.actor,
    'actor-name': params.actorName,
    'channel-id': params.actor,
    'channel-name': params.actorName,
    'source-system': params.sourceSystem,
    'comment-id': params.commentId,
    subject: params.subject,
    'subject-name': params.subjectName,
    'event-timestamp': nextNativeCommentControlTimestamp(),
    'expires-at': params.expiresAt,
    'signature-scope': NATIVE_COMMENT_CONTROL_SIGNATURE_SCOPE,
  });
}

async function signNativeCommentControlMessage(message: Record<string, any>): Promise<Record<string, any>> {
  const signed = await Lbry.channel_sign({
    channel_id: value(message, 'actor', 'channel-id'),
    hexdata: toHex(nativeCommentControlSignatureData(message)),
  });
  if (!signed?.signature || !signed?.signing_ts) throw new Error('Unable to sign native comment control');
  return { ...message, 'channel-signature': signed.signature, 'signing-ts': signed.signing_ts };
}

async function writeNativeCommentControl(message: Record<string, any>, label: string): Promise<string> {
  const id = await writeNativeMessage(await signNativeCommentControlMessage(message), label);
  clearNativeCommentCaches();
  return id;
}

function nextNativeCommentControlTimestamp(): number {
  lastNativeCommentControlTimestamp = Math.max(Date.now(), lastNativeCommentControlTimestamp + 1);
  return lastNativeCommentControlTimestamp;
}

function clearNativeCommentCaches() {
  nativeCommentQueryCache.clear();
  nativeCommentControlQueryCache.clear();
  nativeCommentTargetOwnerCache.clear();
}

async function requireNativeCommentAuthorAllowed(target: string, author: string) {
  const owner = await nativeCommentTargetOwner(target);
  if (!owner) return;
  const controls = latestNativeCommentControls(
    (
      await Promise.all(
        (
          await fetchNativeBlockControls(owner, [author])
        ).map(async (control) => ((await authorizeNativeCommentControl(control, target, owner, [])) ? control : null))
      )
    ).filter(Boolean)
  );
  if (isNativeCommentControlEnabled(controls.get(`block:${owner}:${author}`))) {
    throw new Error('This channel is blocked from commenting on the creator channel');
  }
}

function nativeCommentId(message: any): string | undefined {
  const direct = value(message, 'comment-id', 'comment_id');
  if (typeof direct === 'string' && direct) return direct;

  const commitments = value(message, 'commitments');
  if (isObject(commitments)) {
    for (const [id, commitment] of Object.entries(commitments)) {
      if (value(commitment, 'type') !== 'hmac-sha256') continue;
      const signature = value(commitment, 'signature');
      return normalizeMessageId(typeof signature === 'string' ? signature : id);
    }
  }

  const signatureInput = String(value(message, 'signature-input') || '');
  const hmacInput = signatureInput.split(/,\s+(?=[^=,\s]+=\()/).find((part) => part.includes('alg="hmac-sha256"'));
  const label = hmacInput?.match(/^([^=]+)=/)?.[1];
  if (!label) return undefined;

  const signature = String(value(message, 'signature') || '');
  const match = signature.match(new RegExp(`(?:^|,\\s*)${escapeRegExp(label)}=:([^:]+):`));
  return match?.[1] ? normalizeMessageId(match[1]) : undefined;
}

function normalizeMessageId(id: string): string {
  return id.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchNativeCommentAncestors(comment: any): Promise<Array<any>> {
  const ancestors = [];
  const seen = new Set<string>();
  let parentId = comment.parent_id;

  while (parentId && parentId !== 'root' && !seen.has(parentId) && ancestors.length < 100) {
    seen.add(parentId);
    const parent = await fetchNativeCommentById(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = parent.parent_id;
  }

  return ancestors;
}

function isNativeComment(message: any): boolean {
  return Boolean(
    message &&
    value(message, 'device') !== 'cacheviz@1.0' &&
    String(value(message, 'method') || '').toUpperCase() !== 'GET' &&
    message.type === 'comment' &&
    message.schema === 'odysee-comment@1.0' &&
    typeof value(message, 'comment', 'body', 'text') === 'string' &&
    typeof value(message, 'target', 'claim-id', 'claim_id') === 'string' &&
    typeof value(message, 'channel-id', 'channel_id', 'author') === 'string' &&
    Boolean(commentChannelUrl(message)) &&
    Boolean(nativeCommentId(message))
  );
}

async function fetchPublicQueryJson(body: Record<string, any>): Promise<any> {
  try {
    return await fetchPublicDeviceJson(`${QUERY_DEVICE}/only`, body);
  } catch (error) {
    const status = Number(error?.status);
    const responseBody = String(error?.responseBody || '');
    if (status === 404 || (status === 500 && responseBody.includes('not_found'))) return [];
    throw error;
  }
}

async function fetchPublicDeviceJson(path: string, body: Record<string, any>): Promise<any> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) throw new Error('HyperBEAM node is not configured');
  const response = await fetch(buildDeviceUrl(baseUrl, path), {
    method: 'POST',
    credentials: hyperbeamFetchCredentials(baseUrl),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HyperBEAM ${path} failed with ${response.status}`);
    Object.assign(error, { status: response.status, responseBody: text });
    throw error;
  }
  return parseDeviceJson(text);
}

async function fetchPublicDeviceResponse(path: string, body: Record<string, any>): Promise<any> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) throw new Error('HyperBEAM node is not configured');
  const response = await fetch(buildDeviceUrl(baseUrl, path), {
    method: 'POST',
    credentials: hyperbeamFetchCredentials(baseUrl),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HyperBEAM ${path} failed with ${response.status}`);
  return parseStoreResponse(response);
}

function queryPaths(response: any): Array<string> {
  const payload = queryPayload(response);
  if (Array.isArray(payload)) return payload.map(String).filter(Boolean);
  const paths = value(payload, 'paths', 'items');
  if (Array.isArray(paths)) return paths.map(String).filter(Boolean);
  if (!isObject(payload)) return [];

  return Object.keys(payload)
    .filter((key) => /^[1-9]\d*$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => String(payload[key]))
    .filter(Boolean);
}

function queryPayload(response: any): any {
  let payload = responsePayload(response);
  if (isObject(payload) && payload['ao-result'] === 'body' && payload.body !== undefined) {
    payload = payload.body;
  }
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function nativeWriteId(result: any): string {
  const payload = responsePayload(result);
  const id =
    value(result, 'message-id', 'path', 'id', 'read-path', 'read_path', 'url', 'body') ||
    value(payload, 'message-id', 'path', 'id', 'read-path', 'read_path', 'url', 'body') ||
    (typeof payload === 'string' ? payload : '');
  return typeof id === 'string' ? id.replace(/^\/+/, '') : '';
}

function responseJsonWithHeaders(response: Response): Promise<any> {
  return response.text().then((text) => {
    const parsed = parseDeviceJson(text);
    const result = isObject(parsed) ? parsed : { body: parsed };
    ['message-id', 'id', 'path', 'read-path', 'url'].forEach((name) => {
      const header = response.headers.get(name);
      if (header) result[name] = header;
    });
    return result;
  });
}

function dedupeComments(comments: Array<any>): Array<any> {
  const seen = new Set<string>();
  return comments.filter((comment) => {
    const id = String(comment?.comment_id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function commentComparator(sortBy?: number | null): (left: any, right: any) => number {
  return (left, right) => {
    if (sortBy === SORT_BY.NEWEST && Boolean(left.is_pinned) !== Boolean(right.is_pinned)) {
      return left.is_pinned ? -1 : 1;
    }
    if (sortBy === SORT_BY.OLDEST) {
      return commentTimestamp(left) - commentTimestamp(right) || commentIdOrder(left, right);
    }
    if (sortBy === SORT_BY.POPULARITY || sortBy === SORT_BY.CONTROVERSY) {
      const scoreDifference = commentScore(right, sortBy) - commentScore(left, sortBy);
      if (scoreDifference) return scoreDifference;
    }
    return commentTimestamp(right) - commentTimestamp(left) || commentIdOrder(left, right);
  };
}

function commentScore(comment: any, sortBy: number): number {
  const replies = toNumber(comment?.replies, 0);
  return sortBy === SORT_BY.POPULARITY ? replies + toNumber(comment?.support_amount, 0) : replies;
}

function commentTimestamp(comment: any): number {
  return toNumber(comment?.timestamp || comment?.updated_at, 0);
}

function commentIdOrder(left: any, right: any): number {
  return String(left?.comment_id || '').localeCompare(String(right?.comment_id || ''));
}

function positiveInteger(source: any, fallback: number): number {
  const parsed = Math.floor(Number(source));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function fetchHyperbeamCommentEdit(params: CommentEditParams): Promise<CommentEditResponse | null> {
  const current = await fetchNativeCommentByIdRaw(params.comment_id);
  if (!current) return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/edit`, params);

  const rootId = current.revision_of || current.comment_id;
  const root = current.revision_of ? await fetchNativeCommentVersionById(rootId) : current;
  if (!root) throw new Error('HyperBEAM native comment root is unavailable');
  if (!params.channel_id || params.channel_id !== root.channel_id) {
    throw new Error('HyperBEAM native comment must be edited by its original channel');
  }

  const message = await signNativeCommentMessage(nativeCommentRevisionMessage(root, current, params));
  const revisionId = await writeNativeMessage(message, 'comment revision');
  clearNativeCommentCaches();
  const revision = await fetchNativeCommentVersionById(revisionId);
  if (!revision || !isNextNativeCommentRevision(root, current, revision)) {
    throw new Error('HyperBEAM native comment revision failed ownership or chain validation');
  }
  return revision;
}

export async function fetchHyperbeamCommentPin(params: CommentPinParams): Promise<CommentPinResponse | null> {
  const comment = await fetchNativeCommentByIdRaw(params.comment_id);
  if (!comment) return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/pin`, params);
  const owner = await nativeCommentTargetOwner(comment.claim_id);
  if (!owner || params.channel_id !== owner) throw new Error('Only the content owner can pin this native comment');
  if (comment.parent_id) throw new Error('Only top-level native comments can be pinned');

  await writeNativeCommentControl(
    nativeCommentControlMessage({
      control: 'pin',
      action: params.remove ? 'unpinned' : 'pinned',
      authority: 'owner',
      target: comment.target || comment.claim_id,
      owner,
      actor: params.channel_id,
      actorName: params.channel_name,
      commentId: comment.comment_id,
    }),
    params.remove ? 'comment unpin' : 'comment pin'
  );
  return { items: { ...comment, is_pinned: !params.remove } } as unknown as CommentPinResponse;
}

export async function fetchHyperbeamCommentAbandon(
  params: CommentAbandonParams
): Promise<CommentAbandonResponse | null> {
  const comment = await fetchNativeCommentByIdRaw(params.comment_id);
  if (!comment) return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/abandon`, params);
  const actor = params.channel_id || params.mod_channel_id;
  const actorName = params.channel_name || params.mod_channel_name;
  const owner = await nativeCommentTargetOwner(comment.claim_id);
  const authority = actor === comment.channel_id ? 'author' : actor && actor === owner ? 'owner' : null;
  if (!actor || !actorName || !owner || !authority) {
    throw new Error('Native comment can only be removed by its author or content owner');
  }

  await writeNativeCommentControl(
    nativeCommentControlMessage({
      control: 'visibility',
      action: 'hidden',
      authority,
      target: comment.target || comment.claim_id,
      owner,
      actor,
      actorName,
      commentId: comment.comment_id,
    }),
    authority === 'author' ? 'comment deletion' : 'comment hide'
  );
  return { abandoned: true, claim_id: comment.claim_id };
}

export async function fetchHyperbeamReactionReact(params: ReactionReactParams): Promise<ReactionReactResponse | null> {
  if (params.type !== 'creator_like') return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/reaction-react`, params);
  const ids = stringList(params.comment_ids);
  const comments = await Promise.all(ids.map(fetchNativeCommentByIdRaw));
  const native = comments.filter(Boolean);
  if (!native.length) return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/reaction-react`, params);

  const legacyIds = ids.filter((_, index) => !comments[index]);
  await Promise.all(
    native.map(async (comment) => {
      const owner = await nativeCommentTargetOwner(comment.claim_id);
      if (!owner || params.channel_id !== owner) {
        throw new Error('Only the content owner can add a creator heart to this native comment');
      }
      await writeNativeCommentControl(
        nativeCommentControlMessage({
          control: 'creator-like',
          action: params.remove ? 'unliked' : 'liked',
          authority: 'owner',
          target: comment.claim_id,
          owner,
          actor: params.channel_id,
          actorName: params.channel_name,
          commentId: comment.comment_id,
        }),
        params.remove ? 'creator heart removal' : 'creator heart'
      );
    })
  );
  if (legacyIds.length) {
    return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/reaction-react`, {
      ...params,
      comment_ids: legacyIds.join(','),
    });
  }
  return { success: true };
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
  return writeNativeAndLegacyBlockControl(params, false);
}

export async function fetchHyperbeamModerationUnblock(params: ModerationBlockParams): Promise<any | null> {
  return writeNativeAndLegacyBlockControl(params, true);
}

export async function fetchHyperbeamModerationBlockList(params: BlockedListArgs): Promise<any | null> {
  const { native_sync: nativeSync, ...requestParams } = params as BlockedListArgs & { native_sync?: boolean };
  const owner = requestParams.mod_channel_id || requestParams.channel_id;
  const ownerName = requestParams.mod_channel_name || requestParams.channel_name;
  if (nativeSync === false) {
    return fetchHyperbeamCommentron(`${COMMENT_DEVICE}/moderation-block-list`, requestParams);
  }
  const [legacyResult, nativeResult] = await Promise.allSettled([
    fetchHyperbeamCommentron(`${COMMENT_DEVICE}/moderation-block-list`, requestParams),
    owner ? nativeBlockedList(owner) : Promise.resolve([]),
  ]);
  const legacy = legacyResult.status === 'fulfilled' ? legacyResult.value : null;
  let native = nativeResult.status === 'fulfilled' ? nativeResult.value : [];
  if (!legacy && nativeResult.status === 'rejected') throw nativeResult.reason;

  if (legacy && owner && ownerName && nativeResult.status === 'fulfilled') {
    const imported = await importLegacyBlockControls(owner, ownerName, legacy.blocked_channels, native);
    if (imported) native = await nativeBlockedList(owner);
  }

  const byChannel = new Map<string, any>();
  const nativeStates = new Map(native.map((entry) => [entry.blocked_channel_id, entry]));
  (legacy?.blocked_channels || []).forEach((entry) => {
    if (!nativeStates.has(entry.blocked_channel_id)) byChannel.set(entry.blocked_channel_id, entry);
  });
  native.filter((entry) => entry.blocked).forEach((entry) => byChannel.set(entry.blocked_channel_id, entry));
  return {
    ...legacy,
    blocked_channels: Array.from(byChannel.values()),
    globally_blocked_channels: legacy?.globally_blocked_channels || [],
    delegated_blocked_channels: legacy?.delegated_blocked_channels || [],
  };
}

async function importLegacyBlockControls(
  owner: string,
  ownerName: string,
  legacyChannels: any,
  nativeStates: Array<any>
): Promise<boolean> {
  if (!Array.isArray(legacyChannels) || !legacyChannels.length) return false;
  const candidates = legacyBlockControlsToImport(legacyChannels, nativeStates);
  if (!candidates.length) return false;

  for (const entry of candidates) {
    await writeNativeCommentControl(
      nativeCommentControlMessage({
        control: 'block',
        action: 'blocked',
        authority: 'owner',
        target: owner,
        owner,
        actor: owner,
        actorName: ownerName,
        sourceSystem: 'legacy-commentron',
        subject: entry.subject,
        subjectName: entry.subject_name,
        expiresAt: entry.expires_at,
      }),
      'legacy channel block import'
    );
  }
  return true;
}

async function writeNativeAndLegacyBlockControl(params: ModerationBlockParams, unblock: boolean): Promise<any> {
  const legacy = fetchHyperbeamCommentron(
    `${COMMENT_DEVICE}/${unblock ? 'moderation-unblock' : 'moderation-block'}`,
    params
  );
  const actor = params.mod_channel_id || params.channel_id;
  const actorName = params.mod_channel_name || params.channel_name;
  const owner = params.creator_channel_id || actor;
  const subject = unblock ? params.un_blocked_channel_id : params.blocked_channel_id;
  const subjectName = unblock ? params.un_blocked_channel_name : params.blocked_channel_name;
  const native =
    actor && actorName && owner === actor && subject && subjectName && !params.block_all && !params.global_un_block
      ? writeNativeCommentControl(
          nativeCommentControlMessage({
            control: 'block',
            action: unblock ? 'unblocked' : 'blocked',
            authority: 'owner',
            target: owner,
            owner,
            actor,
            actorName,
            subject,
            subjectName,
            expiresAt:
              !unblock && params.time_out && params.time_out > 0
                ? Math.floor(Date.now() / 1000) + params.time_out
                : undefined,
          }),
          unblock ? 'channel unblock' : 'channel block'
        ).then((id) => ({ success: true, id }))
      : Promise.resolve(null);
  const [legacyResult, nativeResult] = await Promise.allSettled([legacy, native]);
  if (legacyResult.status === 'fulfilled' && legacyResult.value) return legacyResult.value;
  if (nativeResult.status === 'fulfilled' && nativeResult.value) return nativeResult.value;
  if (legacyResult.status === 'rejected') throw legacyResult.reason;
  if (nativeResult.status === 'rejected') throw nativeResult.reason;
  return null;
}

async function nativeBlockedList(owner: string): Promise<Array<any>> {
  const controls = await fetchNativeBlockControls(owner);
  const authorized = (
    await Promise.all(
      controls.map(async (control) =>
        (await authorizeNativeCommentControl(control, owner, owner, [])) ? control : null
      )
    )
  ).filter(Boolean);
  return Array.from(latestNativeCommentControls(authorized).values())
    .filter((control) => control.control === 'block' && control.subject)
    .map((control) => {
      const blockedAt = Math.floor(Number(control.event_timestamp || 0) / 1000);
      const expiresAt = Number(control.expires_at || 0);
      return compactParams({
        blocked_channel_id: control.subject,
        blocked_channel_name: value(control, 'subject-name', 'subject_name'),
        blocked_at: blockedAt,
        banned_for: expiresAt ? Math.max(0, expiresAt - blockedAt) : undefined,
        ban_remaining: expiresAt ? Math.max(0, expiresAt - Math.floor(Date.now() / 1000)) : undefined,
        blocked: isNativeCommentControlEnabled(control),
      });
    });
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
  const ids = stringList(params.comment_ids);
  const nativeResult = await Promise.allSettled([nativeCreatorHeartReactions(ids, params.channel_id)]).then(
    ([result]) => result
  );
  const native = nativeResult.status === 'fulfilled' ? nativeResult.value : null;
  const nativeIds = new Set(native?.native_ids || []);
  const legacyIds = ids.filter((id) => !nativeIds.has(id));
  const legacyResult = legacyIds.length
    ? await Promise.allSettled([
        fetchDeviceJson(`${REACTION_DEVICE}/list`, { ...params, comment_ids: legacyIds.join(',') }).then((response) =>
          reactionListFromHyperbeam(responsePayload(response))
        ),
      ]).then(([result]) => result)
    : ({ status: 'fulfilled', value: null } as PromiseFulfilledResult<null>);
  const legacy = legacyResult.status === 'fulfilled' ? legacyResult.value : null;
  if (!legacy && !native) {
    const error =
      legacyResult.status === 'rejected'
        ? legacyResult.reason
        : nativeResult.status === 'rejected'
          ? nativeResult.reason
          : null;
    if (error) throw error;
    return null;
  }
  return {
    my_reactions: mergeReactionMaps(legacy?.my_reactions, native?.my_reactions),
    others_reactions: mergeReactionMaps(legacy?.others_reactions, native?.others_reactions),
  };
}

async function nativeCreatorHeartReactions(
  ids: Array<string>,
  viewerChannelId?: string
): Promise<(ReactionListResponse & { native_ids: Array<string> }) | null> {
  const comments = (await Promise.all(ids.map(fetchNativeCommentByIdRaw))).filter(Boolean);
  if (!comments.length) return null;
  const projected = await projectNativeCommentCollection(comments);
  const myReactions: Record<string, any> = {};
  const othersReactions: Record<string, any> = {};
  projected.items.forEach((comment) => {
    if (!comment.creator_liked) return;
    const destination = viewerChannelId && viewerChannelId === comment.native_owner_id ? myReactions : othersReactions;
    destination[comment.comment_id] = { creator_like: 1 };
  });
  return {
    my_reactions: myReactions,
    others_reactions: othersReactions,
    native_ids: comments.map((comment) => comment.comment_id),
  };
}

function mergeReactionMaps(left: any, right: any): Record<string, any> {
  const result: Record<string, any> = {};
  const keys = new Set([...Object.keys(isObject(left) ? left : {}), ...Object.keys(isObject(right) ? right : {})]);
  keys.forEach((key) => {
    result[key] = {
      ...(isObject(left?.[key]) ? left[key] : {}),
      ...(isObject(right?.[key]) ? right[key] : {}),
    };
  });
  return result;
}

export async function fetchHyperbeamFileReactionList(params: { claim_ids: string }): Promise<any | null> {
  const claimIds = String(params.claim_ids || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (claimIds.length === 1) {
    const section = await cachedClaimPageSection(claimIds[0], 'reactions');
    const fromPage = section && reactionListFromHyperbeam(section);
    if (fromPage) return fromPage;
  }

  const response = await fetchDeviceJson(`${FILE_REACTION_DEVICE}/list`, params);
  return reactionListFromHyperbeam(responsePayload(response));
}

export async function fetchHyperbeamViewCount(claimIdCsv: string): Promise<Array<number> | null> {
  const claimIds = claimIdCsv
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (claimIds.some((id) => !/^[0-9a-f]{40}$/i.test(id))) return null;

  if (claimIds.length === 1) {
    const section = await cachedClaimPageSection(claimIds[0], 'view-count');
    const fromPage = section && (countArray(section, 'view-counts') || countArray(section, 'counts'));
    if (Array.isArray(fromPage)) return fromPage;
  }

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
  let result: any = null;
  let searchError: unknown = null;
  const targetedSearch = isTargetedClaimSearch(params);

  if (targetedSearch) {
    const claimResult = await fetchDeviceJson(`${CLAIM_DEVICE}/search`, params)
      .then(responsePayload)
      .then(sdkSearchFromHyperbeam)
      .catch(() => null);
    if (isChannelTargetedClaimSearch(params)) {
      result = claimResult;
    } else {
      const uploadResult = await fetchHyperbeamUploadList(params).catch(() => null);
      result = mergeClaimSearchResults(claimResult, uploadResult, params);
    }
  } else {
    try {
      result = await fetchHyperbeamSearchIds(params);
    } catch (error) {
      searchError = error;
    }

    if (!Array.isArray(result?.items)) {
      throw searchError || new Error('HyperBEAM search returned no items array');
    }
  }

  const items = result?.items;
  if (!Array.isArray(items)) return null;

  if (isChannelTargetedClaimSearch(params)) {
    return {
      ...result,
      items,
    };
  }

  const resolvedItems = await hydrateSearchItems(items, targetedSearch ? items : undefined);
  return {
    ...result,
    items: resolvedItems,
  };
}

export async function fetchHyperbeamSearchIds(params: ClaimSearchOptions): Promise<ClaimSearchResponse | null> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < SEARCH_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchPublicProxiedDeviceJson(
        `${SEARCH_DEVICE}/query`,
        genericSearchRequest(params),
        SEARCH_REQUEST_TIMEOUT_MS
      );
      const result = sdkSearchFromHyperbeam(
        await resolveLinkedSearchIds(responsePayload(response), SEARCH_REQUEST_TIMEOUT_MS)
      );
      if (Array.isArray(result?.items)) return result;
      throw new Error('HyperBEAM search returned no items array');
    } catch (error) {
      lastError = error;
      // A 4xx is deterministic (unsupported path, bad query) -- retrying just
      // multiplies dead requests on every list mount.
      const status = (error as any)?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) break;
      if (attempt + 1 < SEARCH_REQUEST_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, SEARCH_REQUEST_RETRY_MS * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error('HyperBEAM search failed');
}

async function resolveLinkedSearchIds(result: any, timeoutMs = HYPERBEAM_TIMEOUT_MS): Promise<any> {
  if (!result || Array.isArray(result.ids)) return result;
  const link = value(result, 'ids+link', 'ids-link');
  if (typeof link !== 'string' || !link) return result;

  const linked = responsePayload(await fetchPublicProxiedDeviceJson(`${CACHE_DEVICE}/read`, { read: link }, timeoutMs));
  const ids = indexedValues(linked);
  return ids.length ? { ...result, ids } : result;
}

function indexedValues(source: any): Array<any> {
  if (!isObject(source)) return [];
  return Object.keys(source)
    .filter((key) => /^[1-9]\d*$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => source[key]);
}

function genericSearchRequest(params: ClaimSearchOptions): Record<string, any> {
  const size = Math.max(1, Math.min(100, toNumber(value(params, 'limit', 'size', 'page_size', 'page-size'), 20)));
  const explicitOffset = value(params, 'offset', 'from');
  const page = Math.max(1, toNumber(value(params, 'page'), 1));
  const offset = Math.max(0, toNumber(explicitOffset, (page - 1) * size));
  const filters = ['state = "active"', 'is_public = 1', 'bid_state != "Expired"', 'bid_state != "Spent"'];
  const claimTypes = [
    ...new Set(
      paramValues(params, 'claim_type', 'claim-type', 'claimType').flatMap((type) => {
        if (type === 'file') return ['stream'];
        if (type === 'file,channel') return ['stream', 'channel'];
        return [type];
      })
    ),
  ].filter(Boolean);
  if (claimTypes.length === 1) filters.push(`claim_type = ${JSON.stringify(claimTypes[0])}`);
  if (claimTypes.length > 1) {
    filters.push(`claim_type IN [${claimTypes.map((type) => JSON.stringify(type)).join(', ')}]`);
  }

  const mediaTypes = ['audio', 'video', 'image', 'text', 'application'].filter((type) =>
    searchFlag(value(params, type))
  );
  if (claimTypes.length === 1 && claimTypes[0] === 'stream' && mediaTypes.length === 1) {
    filters.push(`media_type = ${JSON.stringify(mediaTypes[0])}`);
  } else if (claimTypes.length === 1 && claimTypes[0] === 'stream' && mediaTypes.length > 1) {
    filters.push(`media_type IN [${mediaTypes.map((type) => JSON.stringify(type)).join(', ')}]`);
  }

  if (!searchFlag(value(params, 'nsfw'))) filters.push('nsfw = 0');
  if (searchFlag(value(params, 'free_only', 'free-only'))) filters.push('fee = 0');

  const languages = paramValues(params, 'language');
  if (languages.length === 1) filters.push(`language = ${JSON.stringify(languages[0])}`);
  if (languages.length > 1) {
    filters.push(`language IN [${languages.map((language) => JSON.stringify(language)).join(', ')}]`);
  }

  const minDuration = finiteSearchNumber(value(params, 'min_duration', 'min-duration'));
  const maxDuration = finiteSearchNumber(value(params, 'max_duration', 'max-duration'));
  if (minDuration !== null) filters.push(`duration >= ${minDuration}`);
  if (maxDuration !== null) filters.push(`duration <= ${maxDuration}`);

  const timeFloor = searchTimeFloor(String(value(params, 'time_filter', 'time-filter') || ''));
  if (timeFloor) filters.push(`release_time >= ${timeFloor}`);

  const sort = genericSearchSort(value(params, 'sort', 'sort_by', 'sort-by', 'order_by', 'order-by'));
  return compactParams({
    q: String(value(params, 'q', 's', 'query') || ''),
    limit: size,
    offset,
    filter: filters.join(' AND '),
    sort,
  });
}

function genericSearchSort(raw: any): Array<string> | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) return undefined;
  const field = String(first);
  if (field.startsWith('^')) return [`${field.slice(1)}:asc`];
  if (field.startsWith('-')) return [`${field.slice(1)}:desc`];
  return [`${field}:desc`];
}

function searchFlag(raw: any): boolean {
  return raw === true || raw === 1 || raw === '1' || raw === 'true';
}

function finiteSearchNumber(raw: any): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function searchTimeFloor(filter: string): number | null {
  const ages: Record<string, number> = {
    lasthour: 60 * 60,
    today: 24 * 60 * 60,
    thisweek: 7 * 24 * 60 * 60,
    thismonth: 31 * 24 * 60 * 60,
    thisyear: 366 * 24 * 60 * 60,
  };
  const age = ages[filter];
  return age ? Math.floor(Date.now() / 1000) - age : null;
}

function isTargetedClaimSearch(params: ClaimSearchOptions): boolean {
  return Boolean(
    paramValues(params, 'channel_ids', 'channel-ids', 'channel_id', 'channel-id').length ||
    paramValues(params, 'claim_ids', 'claim-ids', 'claim_id', 'claim-id', 'txid').length ||
    paramValues(params, 'name', 'claim-name', 'claim_name').length ||
    paramValues(params, 'uri', 'uris', 'url', 'urls').length
  );
}

function isChannelTargetedClaimSearch(params: ClaimSearchOptions): boolean {
  return Boolean(paramValues(params, 'channel_ids', 'channel-ids', 'channel_id', 'channel-id').length);
}

function mergeClaimSearchResults(
  publicResult: ClaimSearchResponse | null,
  localResult: ClaimSearchResponse | null,
  params: ClaimSearchOptions
): ClaimSearchResponse | null {
  if (!publicResult) return localResult;
  if (!localResult?.items?.length) return publicResult;

  const publicItems = Array.isArray(publicResult.items) ? publicResult.items : [];
  const publicIds = new Set(publicItems.map(claimSearchIdentity).filter(Boolean));
  const localOnlyItems = localResult.items.filter((claim) => !publicIds.has(claimSearchIdentity(claim)));
  if (!localOnlyItems.length) return publicResult;

  const pageSize = toNumber(
    publicResult.page_size,
    params.page_size || publicItems.length + localOnlyItems.length || 1
  );
  const items = sortMergedClaimSearchItems([...publicItems, ...localOnlyItems], params).slice(0, pageSize);
  const totalItems = toNumber(publicResult.total_items, publicItems.length) + localOnlyItems.length;

  return {
    ...publicResult,
    items,
    page: toNumber(publicResult.page, params.page || 1),
    page_size: pageSize,
    total_items: totalItems,
    total_pages: Math.max(toNumber(publicResult.total_pages, 1), totalPages(totalItems, pageSize)),
  };
}

function claimSearchIdentity(claim: any): string {
  return String(
    value(claim, 'immutable_id', 'immutable-id', 'outpoint') ||
      value(claim?.hyperbeam, 'immutable_id', 'immutable-id', 'record_id', 'record-id') ||
      value(claim, 'claim_id', 'claim-id') ||
      ''
  );
}

function sortMergedClaimSearchItems(items: Array<any>, params: ClaimSearchOptions): Array<any> {
  const orderBy = paramValues(params, 'order_by', 'order-by')[0];
  if (!orderBy || orderBy.replace(/^\^/, '') !== 'release_time') return items;

  const direction = orderBy.startsWith('^') ? 1 : -1;
  return items.sort((left, right) => direction * (claimReleaseTime(left) - claimReleaseTime(right)));
}

function claimReleaseTime(claim: any): number {
  return toNumber(
    value(claim?.value, 'release_time', 'release-time') ||
      value(claim, 'release_time', 'release-time', 'timestamp') ||
      value(claim?.meta, 'creation_timestamp', 'creation-timestamp'),
    0
  );
}

async function hydrateSearchItems(items: Array<any>, knownEnrichments?: Array<any>): Promise<Array<any>> {
  const ids = items.map(searchHitId).filter(Boolean).map(String);
  if (!ids.length) return items;

  const uniqueIds = [...new Set(ids)];
  const claimsById: Record<string, any> = {};
  const batchResults = await fetchImmutableBatchJsonOrNull(uniqueIds).catch(() => new Map<string, any>());
  const loaded = uniqueIds
    .map((id) => {
      const result = batchResults.get(id);
      const decodedClaim = result ? decodeClaimMetadata(storePayload(result)) : null;
      const claim = result ? immutableClaimFromHyperbeam(result, id, null, decodedClaim) : null;
      return result && claim ? { id, result, decodedClaim, claim } : null;
    })
    .filter(Boolean);
  const claimIds = Array.from(
    new Set(loaded.map(({ claim }) => value(claim, 'claim_id', 'claim-id')).filter(isClaimId))
  );
  const enrichmentResponse =
    !knownEnrichments && claimIds.length
      ? await fetchCachedPublicProxiedDeviceJson(`${CLAIM_DEVICE}/search`, {
          claim_ids: claimIds,
          page_size: claimIds.length,
        }).catch(() => null)
      : null;
  const enrichmentItems = knownEnrichments || sdkSearchFromHyperbeam(responsePayload(enrichmentResponse))?.items;
  const enrichmentsByClaimId = new Map<string, any>();
  if (Array.isArray(enrichmentItems)) {
    enrichmentItems.forEach((item) => {
      const claim = sdkClaimFromHyperbeam(item) || item;
      const claimId = value(claim, 'claim_id', 'claim-id');
      if (isClaimId(claimId)) enrichmentsByClaimId.set(claimId.toLowerCase(), claim);
    });
  }
  loaded.forEach(({ id, result, decodedClaim, claim: baseClaim }) => {
    const claimId = value(baseClaim, 'claim_id', 'claim-id');
    const enrichment = isClaimId(claimId) ? enrichmentsByClaimId.get(claimId.toLowerCase()) : null;
    const signingChannel = value(enrichment, 'signing_channel');
    const immutableClaim = immutableClaimFromHyperbeam(result, id, signingChannel, decodedClaim);
    const claim = immutableClaim ? mergeSearchClaimEnrichment(immutableClaim, enrichment) : null;
    if (!claim) return;
    claimsById[id] = claim;
    searchClaimIds(claim).forEach((claimId) => {
      claimsById[claimId] = claim;
    });
  });

  return items.flatMap((item) => {
    const id = String(searchHitId(item) || '');
    const claim = claimsById[id];
    if (claim) return [claim];
    return item && typeof item === 'object' ? [item] : [];
  });
}

function mergeSearchClaimEnrichment(immutableClaim: any, enrichment: any): any {
  if (!enrichment || typeof enrichment !== 'object') return immutableClaim;

  return {
    ...enrichment,
    ...immutableClaim,
    timestamp: value(enrichment, 'timestamp') || value(immutableClaim, 'timestamp'),
    meta: value(enrichment, 'meta') || value(immutableClaim, 'meta'),
    signing_channel: value(enrichment, 'signing_channel') || value(immutableClaim, 'signing_channel'),
    is_channel_signature_valid:
      value(enrichment, 'is_channel_signature_valid', 'is-channel-signature-valid') ??
      value(immutableClaim, 'is_channel_signature_valid', 'is-channel-signature-valid'),
    value: {
      ...(isObject(value(immutableClaim, 'value')) ? value(immutableClaim, 'value') : {}),
      ...(isObject(value(enrichment, 'value')) ? value(enrichment, 'value') : {}),
      source: {
        ...(isObject(value(immutableClaim?.value, 'source')) ? value(immutableClaim.value, 'source') : {}),
        ...(isObject(value(enrichment?.value, 'source')) ? value(enrichment.value, 'source') : {}),
      },
    },
    hyperbeam: immutableClaim.hyperbeam,
  };
}

function searchHitId(item: any) {
  if (typeof item === 'string') return item;
  return value(
    item,
    'immutable_id',
    'immutable-id',
    'record_id',
    'record-id',
    'legacy_outpoint',
    'legacy-outpoint',
    'outpoint',
    'doc_id',
    'doc-id',
    'claim_id',
    'claim-id',
    'id'
  );
}

async function mapWithConcurrency<T, R>(
  items: Array<T>,
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<Array<R>> {
  const results = Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function searchClaimIds(claim: any): Array<string> {
  const txid = value(claim, 'txid', 'tx-id');
  const nout = value(claim, 'nout', 'n-out');
  const hyperbeam = value(claim, 'hyperbeam') || {};
  return [
    value(claim, 'claim_id', 'claim-id'),
    value(claim, 'immutable_id', 'immutable-id'),
    value(claim, 'outpoint'),
    txid !== undefined && nout !== undefined ? `${txid}:${nout}` : null,
    value(hyperbeam, 'immutable_id', 'immutable-id'),
    value(hyperbeam, 'record_id', 'record-id'),
    value(hyperbeam, 'upload_id', 'upload-id'),
    value(hyperbeam, 'data_id', 'data-id'),
  ]
    .filter(Boolean)
    .map(String);
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

  const directClaims = (
    await mapWithConcurrency(unresolvedIds, SEARCH_HYDRATION_CONCURRENCY, (id) => fetchHyperbeamImmutableClaim(id))
  ).flat();
  return [...uploadClaims, ...directClaims];
}

async function fetchHyperbeamUploadClaimsForIds(claimIds: Array<string>): Promise<Array<Claim>> {
  const ids = claimIds.filter(Boolean);
  if (!ids.length) return [];

  const indexedClaims = await fetchHyperbeamUploadClaims({ claim_ids: ids }, { 'x-odysee-claim-ids': ids.join(',') });
  const resolvedIds = new Set(indexedClaims.map((claim) => claim?.claim_id).filter(Boolean));
  const unresolvedIds = ids.filter((id) => !resolvedIds.has(id));
  if (!unresolvedIds.length) return indexedClaims;

  const directClaims = await mapWithConcurrency(unresolvedIds, SEARCH_HYDRATION_CONCURRENCY, (id) =>
    fetchHyperbeamImmutableClaim(id)
  );
  return [...indexedClaims, ...directClaims.flat()];
}

async function fetchHyperbeamImmutableClaim(claimId: string): Promise<Array<Claim>> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) return [];

  try {
    const storeId =
      isOutpointId(claimId) || isStandaloneImmutableId(claimId)
        ? claimId
        : await fetchHyperbeamClaimStoreId({ claim_id: claimId });
    if (!storeId) return [];
    const url = `${baseUrl}/${encodeDataPath(storeId)}`;
    const requestHeaders = {
      accept: 'application/json',
      'accept-bundle': 'true',
    };
    const callId = `immutable-read-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const immutablePath = `/${storeId}`;
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
    const expandedClaim = await expandHyperbeamImmutableClaim(baseUrl, storeId, cacheReadClaim(claimPayload));
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

    const sourceClaim = expandedClaim || cacheReadClaim(claimPayload);
    const decodedClaim = decodeClaimMetadata(storePayload(sourceClaim));
    const signingChannel = decodedClaim?.signedChannelId
      ? await fetchCachedImmutableChannelJsonOrNull(decodedClaim.signedChannelId)
          .then(responsePayload)
          .catch(() => null)
      : null;
    const claim = immutableClaimFromHyperbeam(sourceClaim, storeId, signingChannel, decodedClaim);
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
  const legacyIds = claimIds.filter((claimId) => LBRY_CLAIM_ID_RE.test(claimId));
  const uploadIds = claimIds.filter((claimId) => !LBRY_CLAIM_ID_RE.test(claimId));
  const legacyItems = (await Promise.all(legacyIds.map((claimId) => fetchHyperbeamImmutableClaim(claimId)))).flat();
  const uploadItems = uploadIds.length ? await fetchHyperbeamUploadClaimsForIds(uploadIds) : [];
  const existingIds = new Set(legacyItems.map((claim) => claim?.claim_id).filter(Boolean));
  const mergedItems = [...uploadItems.filter((claim) => !existingIds.has(claim.claim_id)), ...legacyItems];
  if (!mergedItems.length) return null;

  return {
    items: mergedItems,
    page: 1,
    page_size: mergedItems.length,
    total_items: mergedItems.length,
    total_pages: 1,
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

async function fetchDeviceJson(
  path: string,
  body: Record<string, any>,
  timeoutMs = HYPERBEAM_TIMEOUT_MS
): Promise<any | null> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) throw new Error('HyperBEAM node is not configured');

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
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authTokenHeader(authToken),
      },
      body: JSON.stringify(params),
      signal: timeoutSignal(timeoutMs),
    });

    if (!response.ok) {
      throw hyperbeamDeviceError(path, response.status);
    }
    return await response.json();
  } catch (error) {
    throw hyperbeamDeviceFetchError(path, error);
  }
}

async function fetchPublicProxiedDeviceJson(
  path: string,
  body: Record<string, any>,
  timeoutMs: number
): Promise<any | null> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const devicePath = `/${path}`;
  const device = path.split('/')[0];
  const url = `${HYPERBEAM_PUBLIC_DEVICE_PROXY_BASE}/${path}`;
  const requestKey = `${path}:${stableJson(body).slice(0, 180)}`;

  pushHyperbeamDebug(
    'request',
    {
      method: 'POST',
      devicePath,
      device,
      deviceLayer: 'native-device',
      sourceLayer: 'native-device',
      requestKey,
      requestBody: body,
      url,
    },
    'info'
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(timeoutMs),
    });
  } catch (error) {
    pushHyperbeamDebug(
      'request failed',
      {
        method: 'POST',
        devicePath,
        device,
        deviceLayer: 'native-device',
        sourceLayer: 'native-device',
        requestKey,
        url,
        elapsedMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
        error: String(error?.message || error),
      },
      'error'
    );
    throw hyperbeamDeviceFetchError(path, error);
  }

  const responseText = await response.text();
  const responseBody = parseJsonString(responseText);
  const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);

  pushHyperbeamDebug(
    'response',
    {
      status: response.status,
      ok: response.ok,
      devicePath,
      device,
      deviceLayer: 'native-device',
      sourceLayer: 'native-device',
      requestKey,
      url,
      elapsedMs,
      contentType: response.headers.get('content-type') || '',
      response: responseBody || undefined,
    },
    response.ok ? 'ok' : 'error'
  );

  if (!response.ok) throw hyperbeamDeviceError(path, response.status);
  return responseBody;
}

function fetchCachedPublicProxiedDeviceJson(path: string, body: Record<string, any>): Promise<any | null> {
  const key = `public-proxy:${path}:${stableJson(stripPrivateParams(compactParams(body)))}`;
  const now = Date.now();
  const cached = deviceReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchPublicProxiedDeviceJson(path, body, HYPERBEAM_TIMEOUT_MS).catch((error) => {
    deviceReadCache.delete(key);
    throw error;
  });
  deviceReadCache.set(key, { expiresAt: now + HYPERBEAM_READ_CACHE_MS, promise });
  return promise;
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
    throw hyperbeamDeviceFetchError(path, error);
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
    throw hyperbeamDeviceError(path, response.status);
  }

  return parseJsonString(responseText);
}

function requestKeyForAuthDevice(path: string, body: Record<string, any>) {
  const claimId = body.claim_id || body.claim_ids || body['claim-id'] || body['claim-ids'];
  return claimId ? `claim:${claimId}` : `${path}:${stableJson(body).slice(0, 180)}`;
}

function hyperbeamDeviceError(path: string, status: number) {
  if (isCommentronDevicePath(path) && status >= 500) return new TypeError(COMMENTRON_FAILURE);
  const error: any = new Error(`HyperBEAM ${path} failed with ${status}`);
  error.status = status;
  return error;
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
  const configured = String(HYPERBEAM_BASE_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  if (isServedFromManifest()) return window.location.origin;
  return String(ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
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
  const parentId = value(comment, 'parent-id', 'parent_id', 'parent');
  const channelId = value(comment, 'channel-id', 'channel_id', 'author');
  const channelName = value(comment, 'channel-name', 'channel_name');
  const channelUrl = commentChannelUrl(comment);
  const revisionOf = value(comment, 'revision-of', 'revision_of');
  const revision = value(comment, 'revision');
  const revisionTimestamp = value(comment, 'revision-timestamp', 'revision_timestamp');
  return compactParams({
    ...comment.source,
    schema: value(comment, 'schema'),
    type: value(comment, 'type'),
    comment_id: revisionOf || value(comment, 'comment-id', 'comment_id', 'id'),
    hyperbeam_message_id: value(comment, 'message-id', 'message_id', 'comment-id', 'comment_id', 'id'),
    revision_of: revisionOf,
    previous_version: value(comment, 'previous-version', 'previous_version'),
    revision: revision === undefined || revision === null ? undefined : toNumber(revision, 0),
    revision_timestamp:
      revisionTimestamp === undefined || revisionTimestamp === null ? undefined : toNumber(revisionTimestamp, 0),
    operation: value(comment, 'operation'),
    state: value(comment, 'state'),
    comment: value(comment, 'comment', 'body', 'text'),
    claim_id: value(comment, 'claim-id', 'claim_id', 'target'),
    target: value(comment, 'target'),
    parent_id: parentId === 'root' ? undefined : parentId,
    channel_id: channelId,
    channel_name: channelName,
    channel_url: channelUrl,
    timestamp: toNumber(value(comment, 'timestamp', 'created_at'), 0),
    updated_at: value(comment, 'updated-at', 'updated_at'),
    signature: value(comment, 'channel-signature', 'signature'),
    signing_ts: value(comment, 'signing-ts', 'signing_ts'),
    signature_scope: value(comment, 'signature-scope', 'signature_scope'),
    is_pinned: toBoolean(value(comment, 'is-pinned', 'is_pinned')),
    replies: toNumber(value(comment, 'replies'), 0),
    support_amount: value(comment, 'support-amount', 'support_amount'),
    support_tx_id: value(comment, 'support-tx-id', 'support_tx_id'),
    sticker: toBoolean(value(comment, 'sticker')),
    mentioned_channels: value(comment, 'mentioned-channels', 'mentioned_channels'),
    is_protected: toBoolean(value(comment, 'is-protected', 'is_protected')),
    removed: toBoolean(value(comment, 'removed')),
    hidden: toBoolean(value(comment, 'hidden')),
    blocked: toBoolean(value(comment, 'blocked')),
    hyperbeam_signature_verification: value(comment, 'signature-verification'),
  });
}

function commentChannelUrl(comment: any): string | undefined {
  const existing = value(comment, 'channel-url', 'channel_url');
  if (validChannelUrl(existing)) return existing;

  const channelName = value(comment, 'channel-name', 'channel_name');
  const channelId = value(comment, 'channel-id', 'channel_id', 'author');
  if (typeof channelName !== 'string' || !channelName.trim() || typeof channelId !== 'string' || !channelId.trim()) {
    return undefined;
  }

  const url = buildURI({ channelName: channelName.trim(), channelClaimId: channelId.trim() }, true);
  return validChannelUrl(url) ? url : undefined;
}

function validChannelUrl(url: any): url is string {
  if (typeof url !== 'string' || !url) return false;
  try {
    return Boolean(parseURI(url).channelName);
  } catch {
    return false;
  }
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

function fullClaimIdFromUri(uri: string): string | null {
  const claimId = claimIdFromUri(uri);
  return claimId && LBRY_CLAIM_ID_RE.test(claimId) ? claimId : null;
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

  // The immutable claim may only know the outpoint id (store message keys can
  // be CORS-hidden header fields in the browser).
  const resolvedClaimId = String(claim.claim_id || '');
  const legacyIdentity = LBRY_CLAIM_ID_RE.test(resolvedClaimId)
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
    // The immutable reconstruction fabricates fallbacks (title=claim-name,
    // empty meta) that must not shadow the resolved values.
    value: {
      ...immutableClaim.value,
      ...compactParams(claim.value || {}),
      source: {
        ...immutableClaim.value?.source,
        ...compactParams(claim.value?.source || {}),
      },
    },
    meta: {
      ...immutableClaim.meta,
      ...compactParams(claim.meta || {}),
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
  // `result.claim` may hold raw protobuf bytes rather than an SDK claim map.
  const nestedClaim = messagePayload(result.claim);
  const claim =
    isObject(nestedClaim) && value(nestedClaim, 'claim_id', 'claim-id') ? nestedClaim : messagePayload(result);
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
  const name = value(claim, 'name', 'claim-name') || claim.name;
  const device = value(claim, 'device');
  const valueType =
    value(claim, 'value_type', 'value-type') ||
    claim.value_type ||
    (device === 'lbry-channel@1.0' || device === 'odysee-channel@1.0' ? 'channel' : undefined);
  const canonicalUrl =
    value(claim, 'canonical_url', 'canonical-url') ||
    claim.canonical_url ||
    (name && claimId ? claimUrl(String(name), String(claimId)) : undefined);
  const permanentUrl =
    value(claim, 'permanent_url', 'permanent-url') ||
    claim.permanent_url ||
    (name && claimId ? claimUrl(String(name), String(claimId)) : undefined);
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
    name,
    ...(nativeUpload
      ? {
          streaming_url: `/$/api/hyperbeam-upload/v1/read/${encodeURIComponent(claimId)}`,
          download_url: `/$/api/hyperbeam-upload/v1/read/${encodeURIComponent(claimId)}`,
        }
      : {}),
    canonical_url: nativeUpload ? uriWithClaimId(canonicalUrl, claimId) : canonicalUrl,
    permanent_url: nativeUpload ? uriWithClaimId(permanentUrl, claimId) : permanentUrl,
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
  const sdkResult =
    result.result && (Array.isArray(result.result.items) || Array.isArray(result.result.ids)) ? result.result : result;
  const items = Array.isArray(sdkResult.items)
    ? sdkResult.items
    : Array.isArray(sdkResult.ids)
      ? sdkResult.ids
      : undefined;
  const pageSize =
    value(sdkResult, 'page_size', 'page-size', 'limit') ?? value(result, 'page_size', 'page-size', 'limit');
  const offset = toNumber(value(sdkResult, 'offset') ?? value(result, 'offset'), 0);
  const totalItems =
    value(sdkResult, 'total_items', 'total-items', 'total') ??
    value(result, 'total_items', 'total-items', 'total') ??
    items?.length ??
    0;

  return {
    ...sdkResult,
    items,
    page: value(sdkResult, 'page') ?? (pageSize ? Math.floor(offset / pageSize) + 1 : 1),
    page_size: pageSize,
    total_items: totalItems,
    total_pages:
      value(sdkResult, 'total_pages', 'total-pages') ??
      value(result, 'total_pages', 'total-pages') ??
      totalPages(toNumber(totalItems, items?.length || 0), pageSize || 20),
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

function toBoolean(value: any): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return Boolean(value);
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
  return immutableClaimFromHyperbeam(result, immutableId, signingChannel, decodedClaim);
}

async function fetchImmutableResolveEntries(
  urls: Array<string>,
  signingChannelIds: Record<string, string> = {}
): Promise<Array<[string, any]>> {
  const immutableIds = urls.map(immutableRouteIdFromUri).filter((id): id is string => Boolean(id));
  const channelIds = immutableIds.map((id) => signingChannelIds[id]).filter((id): id is string => Boolean(id));
  const batchResults = await fetchImmutableBatchJsonOrNull([...immutableIds, ...channelIds]).catch(
    () => new Map<string, any>()
  );
  const decodedClaims = new Map<string, DecodedClaimMetadata | null>();
  immutableIds.forEach((immutableId) => {
    decodedClaims.set(immutableId, decodeClaimMetadata(storePayload(batchResults.get(immutableId))));
  });
  const unresolvedChannelClaimIds = Array.from(
    new Set(
      immutableIds
        .filter((immutableId) => !signingChannelIds[immutableId])
        .map((immutableId) => decodedClaims.get(immutableId)?.signedChannelId)
        .filter((id): id is string => Boolean(id))
    )
  );
  const fallbackChannels = await fetchImmutableSigningChannels(unresolvedChannelClaimIds).catch(
    () => new Map<string, any>()
  );
  return Promise.all(
    urls.map(async (uri): Promise<[string, any]> => {
      const immutableId = immutableRouteIdFromUri(uri);
      if (!immutableId) return [uri, null];

      const result =
        batchResults.get(immutableId) || (await fetchCachedImmutableJsonOrNull(immutableId).catch(() => null));
      const decodedClaim = decodedClaims.get(immutableId) || decodeClaimMetadata(storePayload(result));
      const channelId = signingChannelIds[immutableId];
      const signingChannel =
        (channelId ? batchResults.get(channelId) : null) ||
        (decodedClaim?.signedChannelId ? fallbackChannels.get(decodedClaim.signedChannelId.toLowerCase()) : null);
      return [uri, result ? immutableClaimFromHyperbeam(result, immutableId, signingChannel, decodedClaim) : null];
    })
  );
}

async function fetchImmutableSigningChannels(channelIds: Array<string>): Promise<Map<string, any>> {
  const channelsById = new Map<string, any>();
  if (!channelIds.length) return channelsById;

  const response = await fetchCachedPublicProxiedDeviceJson(`${CLAIM_DEVICE}/search`, {
    claim_ids: channelIds,
    page_size: channelIds.length,
  }).catch(() => null);
  const search = sdkSearchFromHyperbeam(responsePayload(response));
  const items = Array.isArray(search?.items) ? search.items : [];
  const storeIdByChannelId = new Map<string, string>();

  items.forEach((item: any) => {
    const claim = sdkClaimFromHyperbeam(item);
    const claimId = value(claim, 'claim_id', 'claim-id');
    if (!claimId) return;

    const channelId = String(claimId).toLowerCase();
    if (value(claim, 'value_type', 'value-type') === 'channel' && isObject(value(claim, 'value'))) {
      channelsById.set(channelId, claim);
      deviceReadCache.set(`immutable-channel:${channelId}`, {
        expiresAt: Date.now() + HYPERBEAM_READ_CACHE_MS,
        promise: Promise.resolve(claim),
      });
      return;
    }

    const storeId = immutableReadIdFromClaim(claim);
    if (storeId) storeIdByChannelId.set(channelId, storeId);
  });

  const storeResults = await fetchImmutableBatchJsonOrNull(Array.from(new Set(storeIdByChannelId.values()))).catch(
    () => new Map<string, any>()
  );

  storeIdByChannelId.forEach((storeId, channelId) => {
    const result = storeResults.get(storeId);
    if (result) {
      channelsById.set(channelId, result);
      deviceReadCache.set(`immutable-channel:${channelId}`, {
        expiresAt: Date.now() + HYPERBEAM_READ_CACHE_MS,
        promise: Promise.resolve(result),
      });
    }
  });

  const unresolvedChannelIds = channelIds.filter((channelId) => !channelsById.has(channelId.toLowerCase()));
  await Promise.all(
    unresolvedChannelIds.map(async (channelId) => {
      const result = await fetchCachedImmutableChannelJsonOrNull(channelId).catch(() => null);
      if (result) channelsById.set(channelId.toLowerCase(), result);
    })
  );

  return channelsById;
}

async function fetchHyperbeamLocatedClaim(uri: string): Promise<any | null> {
  const claimId = fullClaimIdFromUri(uri);
  const storeId = await fetchHyperbeamClaimStoreId(claimId ? { claim_id: claimId } : { uri });
  if (!storeId) return null;

  const result = await fetchCachedImmutableJsonOrNull(storeId);
  const decodedClaim = decodeClaimMetadata(storePayload(result));
  const signingChannel = decodedClaim?.signedChannelId
    ? await fetchCachedImmutableChannelJsonOrNull(decodedClaim.signedChannelId).catch(() => null)
    : null;
  let name: string | undefined;
  try {
    const parsed = parseURI(uri);
    name = parsed.streamName || parsed.claimName;
  } catch {}
  const claim = immutableClaimFromHyperbeam(result, storeId, signingChannel, decodedClaim, name);
  if (!claim) return null;

  return claimId && claim.claim_id !== claimId
    ? {
        ...claim,
        claim_id: claimId,
        hyperbeam: compactParams({
          ...claim.hyperbeam,
          'source-claim-id': claimId,
        }),
      }
    : claim;
}

async function fetchHyperbeamClaimStoreId(params: Record<string, any>): Promise<string | null> {
  const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/get-id`, params);
  const result = responsePayload(response);
  const id = value(result, 'id', 'immutable-id', 'immutable_id', 'outpoint');
  return isOutpointId(id) ? String(id) : null;
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

  // Batch-first: one search call per chunk instead of a device-path chain per
  // uri. Channels never navigate by immutable uri, so they skip the per-claim
  // immutable store read entirely.
  const entriesByUri = new Map<string, any>();
  const claimIds = Array.from(uriByClaimId.keys());
  await Promise.all(
    chunkIds(claimIds, CLAIM_ID_BATCH_SIZE).map(async (chunk) => {
      const response = await fetchCachedDeviceJson(`${CLAIM_DEVICE}/search`, { claim_ids: chunk }).catch(() => null);
      const search = sdkSearchFromHyperbeam(responsePayload(response));
      const items = Array.isArray(search?.items) ? search.items : [];
      await Promise.all(
        items.map(async (item: any) => {
          const claim = sdkClaimFromHyperbeam(item);
          const claimId = value(claim, 'claim_id', 'claim-id');
          const uri = claimId && uriByClaimId.get(String(claimId).toLowerCase());
          if (!uri) return;
          entriesByUri.set(
            uri,
            claim.value_type === 'channel' ? claim : await immutableClaimForResolvedUri(uri, claim)
          );
        })
      );
    })
  );

  // Per-uri device-path resolution only for ids the batch could not return.
  const missingUris = Array.from(uriByClaimId.values()).filter((uri) => !entriesByUri.has(uri));
  await Promise.all(
    missingUris.map(async (uri) => {
      const claim = await fetchHyperbeamLocatedClaim(uri).catch(() => null);
      if (claim) entriesByUri.set(uri, claim);
    })
  );

  return Array.from(entriesByUri.entries());
}

function chunkIds(ids: Array<string>, size: number): Array<Array<string>> {
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
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

async function fetchImmutableBatchJsonOrNull(ids: Array<string>): Promise<Map<string, any>> {
  const uniqueIds = Array.from(new Set(ids.filter((id) => isOutpointId(id) || isStandaloneImmutableId(id))));
  const results = new Map<string, any>();
  const uncachedIds: Array<string> = [];

  await Promise.all(
    uniqueIds.map(async (id) => {
      const cached = deviceReadCache.get(`immutable:${id}`);
      if (cached && cached.expiresAt > Date.now()) {
        const result = await cached.promise.catch(() => null);
        if (result) {
          results.set(id, result);
        } else {
          deviceReadCache.delete(`immutable:${id}`);
          uncachedIds.push(id);
        }
      } else {
        uncachedIds.push(id);
      }
    })
  );

  if (uncachedIds.length) {
    const batchResults = await fetchPublicStoreBatchResults(uncachedIds);
    batchResults.forEach((result, id) => results.set(id, result));
  }

  const expandedResults = await expandHyperbeamStoreLinks(results);
  const expiresAt = Date.now() + HYPERBEAM_READ_CACHE_MS;
  expandedResults.forEach((result, id) => {
    deviceReadCache.set(`immutable:${id}`, { expiresAt, promise: Promise.resolve(result) });
  });
  return expandedResults;
}

async function fetchPublicStoreBatchResults(ids: Array<string>): Promise<Map<string, any>> {
  const uniqueIds = Array.from(new Set(ids.filter(isPublicStoreBatchId)));
  const chunks: Array<Array<string>> = [];
  for (let index = 0; index < uniqueIds.length; index += HYPERBEAM_PUBLIC_STORE_BATCH_LIMIT) {
    chunks.push(uniqueIds.slice(index, index + HYPERBEAM_PUBLIC_STORE_BATCH_LIMIT));
  }

  const payloads = await Promise.all(
    chunks.map(async (chunk) => {
      const response = await fetch(HYPERBEAM_PUBLIC_STORE_BATCH_PROXY, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ids: chunk }),
        signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HyperBEAM store batch failed with ${response.status}`);
      return response.json();
    })
  );

  const results = new Map<string, any>();
  payloads.forEach((payload) => {
    const batchResults = isObject(payload?.results) ? payload.results : {};
    Object.entries(batchResults).forEach(([id, result]) => {
      if (result) results.set(id, result);
    });
  });
  return results;
}

async function expandHyperbeamStoreLinks(results: Map<string, any>): Promise<Map<string, any>> {
  for (let depth = 0; depth < HYPERBEAM_STORE_LINK_DEPTH; depth += 1) {
    const references: Array<{ owner: Record<string, any>; field: string; id: string }> = [];
    const seen = new WeakSet<object>();
    results.forEach((result) => collectHyperbeamStoreLinks(result, references, seen));
    if (!references.length) break;

    const linkedResults = await fetchPublicStoreBatchResults(references.map(({ id }) => id)).catch(
      () => new Map<string, any>()
    );
    if (!linkedResults.size) break;
    references.forEach(({ owner, field, id }) => {
      const linked = linkedResults.get(id);
      if (linked) owner[field] = linked;
    });
  }
  return results;
}

function collectHyperbeamStoreLinks(
  source: any,
  references: Array<{ owner: Record<string, any>; field: string; id: string }>,
  seen: WeakSet<object>
) {
  if (!source || typeof source !== 'object' || seen.has(source)) return;
  seen.add(source);

  if (Array.isArray(source)) {
    source.forEach((item) => collectHyperbeamStoreLinks(item, references, seen));
    return;
  }

  Object.entries(source).forEach(([key, entry]) => {
    const field = linkedStoreField(key);
    if (field && source[field] === undefined && isPublicStoreBatchId(entry)) {
      references.push({ owner: source, field, id: entry });
      return;
    }
    collectHyperbeamStoreLinks(entry, references, seen);
  });
}

function linkedStoreField(key: string): string | null {
  if (key.endsWith('+link') || key.endsWith('-link')) {
    const field = key.slice(0, -5);
    return HYPERBEAM_EAGER_STORE_LINK_FIELDS.has(field) ? field : null;
  }
  return null;
}

function isPublicStoreBatchId(id: any): id is string {
  return typeof id === 'string' && (isOutpointId(id) || /^[A-Za-z0-9_-]{43}$/.test(id));
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
  const claimCandidate = sdkClaimFromHyperbeam(payload) || payload;
  const claim = isObject(claimCandidate) ? claimCandidate : {};
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
    hyperbeamMediaUrlFromPayload({
      ...payload,
      sd_hash: sdHash,
      'sd-hash': sdHash,
      media_type: mediaType,
      'media-type': mediaType,
    }) ||
    directMediaUrl ||
    claimMediaUrl;
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
    (device === 'lbry-channel@1.0' || device === 'odysee-channel@1.0' || String(rawName || '').startsWith('@')
      ? 'channel'
      : 'stream');
  const sourceName =
    value(payloadSource, 'name') ||
    value(valueSource, 'name') ||
    value(decodedSource, 'name') ||
    value(payload, 'filename') ||
    (mediaType === 'video/mp4' ? `${name}.mp4` : undefined);
  const channelClaimId = String(value(channelClaim, 'claim_id', 'claim-id') || '').toLowerCase();
  const signedChannelId = String(claimMetadata?.signedChannelId || '').toLowerCase();
  const signingChannel =
    channelClaim && channelClaimId && (!signedChannelId || channelClaimId === signedChannelId)
      ? normalizeHyperbeamChannelClaim(channelClaim)
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
      'immutable-uri': hyperbeamImmutableUri(String(storeId)),
      'immutable-path': hyperbeamImmutableWebPath(String(storeId)),
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

function fetchCachedStoreJsonOrNull(path: string, preferJson: boolean = true): Promise<any | null> {
  const key = `store:${preferJson ? 'json' : 'native'}:${path}`;
  const now = Date.now();
  const cached = deviceReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchStoreJsonOrNull(path, preferJson).catch((error) => {
    deviceReadCache.delete(key);
    throw error;
  });
  deviceReadCache.set(key, { expiresAt: now + HYPERBEAM_READ_CACHE_MS, promise });
  return promise;
}

function claimFromUriKeyedResult(result: any, uri: string): any | null {
  if (!result || typeof result !== 'object') return null;
  if (value(result, 'claim_id', 'claim-id')) return result;

  const exact = result[uri] || result[String(uri).replace(/#/g, ':')];
  if (exact && typeof exact === 'object') return exact;

  const values = Object.values(result).filter((entry) => entry && typeof entry === 'object');
  if (values.length === 1 && value(values[0], 'claim_id', 'claim-id')) return values[0];
  return null;
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
  if (contentType.includes('application/json')) {
    const headers = responseHeadersObject(response);
    const parsed = parseDeviceJson(await response.text());
    return isObject(parsed) ? { ...headers, ...parsed } : { ...headers, body: parsed };
  }

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
    headers[key] = decodeHeaderUtf8(value);
  });
  const types = parseAoTypesValue(headers['ao-types']);
  for (const [key, type] of Object.entries(types)) {
    if (key !== '.' && headers[key] !== undefined) headers[key] = decodeAoTypedValue(type, headers[key]);
  }
  return headers;
}

// Fetch exposes response headers as Latin-1. Flat store messages can carry
// UTF-8 field bytes in those headers, so recover valid UTF-8 without changing
// ordinary ASCII or malformed values.
function decodeHeaderUtf8(value: string): string {
  if (!/[\x80-\xff]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
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
    fields[key] = decodeAoTypedValue(types[key], latin1ToUtf8(raw));
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
  return parseAoTypesValue(line);
}

function parseAoTypesValue(value: any): Record<string, string> {
  if (typeof value !== 'string' || !value) return {};

  const types: Record<string, string> = {};
  for (const match of value.matchAll(/([a-z0-9_.-]+)\s*=\s*"([^"]+)"/gi)) {
    types[match[1].toLowerCase()] = match[2];
  }
  return types;
}

function decodeAoTypedValue(type: string | undefined, value: any): any {
  if (type === 'integer' || type === 'float') return Number(value);
  if (type !== 'atom') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'undefined') return null;
  return value;
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
  const bytes = encodedClaimBytes(claimHex);
  if (!bytes) return null;

  try {
    return { signedChannelId: claimEnvelope(bytes).signedChannelId };
  } catch {
    return null;
  }
}

function encodedClaimBytes(value: any): Uint8Array | null {
  const hex = hexToBytes(value);
  if (hex) return hex;
  if (typeof value !== 'string' || !/^[0-9a-z_-]+$/i.test(value)) return null;

  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
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
  const immutableId = hyperbeamImmutableIdFromUri(uri);
  if (immutableId) return immutableId;

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
  if (outpoint) return `${outpoint[1]}:${outpoint[2]}`;
  return isStandaloneImmutableId(modifier) ? String(modifier) : null;
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
      : fetchHyperbeamClaimStoreId({ claim_id: id }).then((storeId) =>
          storeId ? fetchStoreJsonOrNull(`${encodeDataPath(storeId)}?accept-bundle=true`, false) : null
        )
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
