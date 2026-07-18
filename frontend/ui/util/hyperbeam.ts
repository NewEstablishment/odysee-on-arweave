import { COMMENT_SERVER_API, HYPERBEAM_BASE_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { SORT_BY } from 'constants/comment';
import Lbry from 'lbry';
import { pushHyperbeamDebug } from 'util/hyperbeamDebug';
import { allowHyperbeamCompatibilityReads } from 'util/hyperbeamMode';
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

const HYPERBEAM_TIMEOUT_MS = 15000;
const HYPERBEAM_READ_CACHE_MS = 30 * 1000;
const NATIVE_COMMENT_QUERY_CACHE_MS = HYPERBEAM_READ_CACHE_MS;
const NATIVE_COMMENT_TARGET_OWNER_CACHE_MS = 30 * 1000;
const NATIVE_COMMENT_READ_CONCURRENCY = 4;
const QUERY_DEVICE = '~query@1.0';
const CACHE_DEVICE = '~cache@1.0';
// Native writes POST straight to the node; `!` is the auth-hook commit flag,
// so the node's configured auth hook decides whether the write is committed.
// The commit flag signs the request via the node's auth hook; committers=all
// makes /id resolve to the signed ID (the bare id key recalculates the
// unsigned ID over uncommitted keys too, which nothing registers).
const HYPERBEAM_NATIVE_WRITE_PATH = 'id?!=true&committers=all';
const COMMENTRON_FAILURE = 'Failed to fetch (comments.odysee.tv)';
const storeReadCache = new Map<string, { expiresAt: number; promise: Promise<any | null> }>();
const nativeCommentQueryCache = new Map<string, { expiresAt: number; promise: Promise<Array<any>> }>();
const nativeCommentControlQueryCache = new Map<
  string,
  { expiresAt: number; promise: Promise<Array<NativeCommentControl>> }
>();
const nativeCommentTargetOwnerCache = new Map<string, { expiresAt: number; promise: Promise<string | null> }>();
let lastNativeCommentControlTimestamp = 0;

export async function fetchHyperbeamResolve(params: any): Promise<any | null> {
  const urls = urlsFromResolveParams(params);
  if (!urls.length) return null;

  // Every uri resolves through read-only store GETs against the node:
  // immutable-id routes (out_<txid>_<nout> / 43-char ids) read the message
  // store directly, channel uris read the channel evidence route, and the
  // rest read the claim evidence route with a claim-id fallback.
  const entries = await Promise.all(
    urls.map(async (uri): Promise<[string, any]> => [uri, await resolveStoreClaimForUri(uri).catch(() => null)])
  );
  return Object.fromEntries(entries.filter(([, claim]) => claim));
}

async function resolveStoreClaimForUri(uri: string): Promise<any | null> {
  const immutableClaim = await fetchHyperbeamImmutableResolve(uri).catch(() => null);
  if (immutableClaim) return immutableClaim;

  if (isChannelUri(uri)) return fetchStoreChannelClaimForUri(uri);

  const storeClaim = await fetchStoreClaimForUri(uri);
  if (storeClaim) return storeClaim;

  const claimId = claimIdFromUri(uri);
  return claimId && isClaimId(claimId) ? fetchStoreClaimById(claimId) : null;
}

async function fetchStoreClaimForUri(uri: string): Promise<any | null> {
  const result = await fetchCachedStoreJsonOrNull(storePath('odysee/claim', uri)).catch(() => null);
  return storeClaimEntry(result);
}

async function fetchStoreClaimById(claimId: string): Promise<any | null> {
  const result = await fetchCachedStoreJsonOrNull(storePath('odysee/claim-id', claimId)).catch(() => null);
  return storeClaimEntry(result);
}

async function fetchStoreChannelClaimForUri(uri: string): Promise<any | null> {
  const claimId = claimIdFromChannelUri(uri);
  const result = await fetchCachedStoreJsonOrNull(storePath('odysee/channel', claimId || uri)).catch(() => null);
  return storeClaimFromHyperbeam(storePayload(result));
}

// A claim evidence message names its signing channel inside the raw
// claim-envelope; enrich the claim with the channel evidence message so the
// UI can render channel name/title/thumbnail without a device round-trip.
async function storeClaimEntry(result: any): Promise<any | null> {
  const payload = storePayload(result);
  if (!payload) return null;

  const decoded = decodeClaimMetadata(payload);
  const channelResult = decoded?.signedChannelId
    ? await fetchCachedStoreJsonOrNull(storePath('odysee/channel', decoded.signedChannelId)).catch(() => null)
    : null;
  return storeClaimFromHyperbeam(payload, storePayload(channelResult));
}

function isChannelUri(uri: string): boolean {
  try {
    const parsed = parseURI(uri);
    return Boolean(parsed.channelName && !parsed.streamName);
  } catch {
    return false;
  }
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
  }

  const evidence = uri
    ? await fetchStoreStreamEvidenceForUri(uri)
    : await fetchStoreStreamEvidenceForOutpoint(String(id));
  const payload = playbackPayloadFromStoreStream(evidence);
  if (payload) return payload;

  // The stream evidence route can lag behind the claim route; fall back to
  // the resolved claim's outpoint/sd-hash media URL.
  const claim = uri ? await resolveStoreClaimForUri(uri).catch(() => null) : null;
  return playbackPayloadFromStoreStream(claim ? { ...claim, 'sd-hash': claim.value?.source?.sd_hash } : null);
}

export async function fetchStoreStreamEvidenceForUri(uri: string): Promise<any | null> {
  const result = await fetchCachedStoreJsonOrNull(storePath('odysee/stream', uri)).catch(() => null);
  return storePayload(result);
}

async function fetchStoreStreamEvidenceForOutpoint(outpoint: string): Promise<any | null> {
  if (!isOutpointId(outpoint)) return null;
  const result = await fetchCachedStoreJsonOrNull(storePath('odysee/stream-id', outpoint)).catch(() => null);
  return storePayload(result);
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

export async function fetchHyperbeamCommentById(params: CommentByIdParams): Promise<CommentByIdResponse | null> {
  const native = await fetchNativeCommentById(params.comment_id);
  if (native) {
    const ancestors = params.with_ancestors ? await fetchNativeCommentAncestors(native) : [];
    return { item: native, items: [native], ancestors };
  }

  const result = await fetchLegacyCommentron('comment.ByID', params);
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
  if (params.dry_run) return fetchLegacyCommentron('comment.Create', params);

  await requireNativeCommentAuthorAllowed(params.claim_id, params.channel_id);
  const message = await signNativeCommentMessage(nativeCommentMessage(params));
  const commentId = await writeNativeMessage(message, 'comment');
  clearNativeCommentCaches();
  const comment = await fetchNativeCommentVersionById(commentId);
  if (!comment) throw new Error('HyperBEAM native comment failed channel signature verification');
  return comment;
}

async function writeNativeMessage(message: Record<string, any>, label: string): Promise<string> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) throw new Error('HyperBEAM node is not configured');

  const response = await fetch(`${baseUrl}/${HYPERBEAM_NATIVE_WRITE_PATH}`, {
    method: 'POST',
    credentials: hyperbeamFetchCredentials(baseUrl),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...authTokenHeader(),
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

function authTokenHeader(): Record<string, string> {
  const token = getAuthToken();
  return token ? { 'x-odysee-auth-token': token } : {};
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
    'claim-id': comment?.claim_id,
    state: comment?.state,
    author: comment?.channel_id,
    parent: comment?.parent_id || 'root',
    'revision-of': comment?.revision_of,
  };
  return Object.entries(selectors).every(([key, expected]) => fields[key] === expected);
}

async function fetchLegacyCommentSource(params: CommentListParams): Promise<CommentSource | null> {
  const page = positiveInteger(params.page, 1);
  const pageSize = positiveInteger(params.page_size, 10);
  const result = await fetchLegacyCommentron('comment.List', {
    ...params,
    page: 1,
    page_size: page * pageSize,
  });
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
  if (params.claim_id) {
    return {
      schema: 'odysee-comment@1.0',
      type: 'comment',
      'claim-id': params.claim_id,
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
    'claim-id': direct.claim_id,
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
  if (!hasNativeCommentSignature(comment)) return null;
  return {
    ...comment,
    hyperbeam_owner: comment.channel_id,
    hyperbeam_signature_verification: 'unverified',
  };
}

// The store node exposes no channel-signature verification surface, so
// native reads accept structurally complete signed messages; the node's
// auth hook gates what gets committed in the first place.
function hasNativeCommentSignature(comment: any): boolean {
  return Boolean(comment?.channel_id && comment?.channel_name && comment?.signature && comment?.signing_ts);
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
    const target = String(comment?.claim_id || '');
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
    const state = states.get(String(comment?.claim_id || ''));
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
    'target-id': owner,
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
  return Object.entries(selectors).every(([key, expected]) => {
    const field = key === 'target-id' ? 'target' : key.replace(/-([a-z])/g, (_, char) => `_${char}`);
    return control[field] === expected;
  });
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
  if (!isNativeCommentControl(control)) return null;
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

async function authorizeNativeCommentControl(
  control: NativeCommentControl,
  target: string,
  owner: string | null,
  comments: Array<any>
): Promise<boolean> {
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
    'target-id': params.target,
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
  if (!current) return fetchLegacyCommentron('comment.Edit', params);

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
  if (!comment) return fetchLegacyCommentron('comment.Pin', params);
  const owner = await nativeCommentTargetOwner(comment.claim_id);
  if (!owner || params.channel_id !== owner) throw new Error('Only the content owner can pin this native comment');
  if (comment.parent_id) throw new Error('Only top-level native comments can be pinned');

  await writeNativeCommentControl(
    nativeCommentControlMessage({
      control: 'pin',
      action: params.remove ? 'unpinned' : 'pinned',
      authority: 'owner',
      target: comment.claim_id,
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
  if (!comment) return fetchLegacyCommentron('comment.Abandon', params);
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
      target: comment.claim_id,
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
  if (params.type !== 'creator_like') return fetchLegacyCommentron('reaction.React', params);
  const ids = stringList(params.comment_ids);
  const comments = await Promise.all(ids.map(fetchNativeCommentByIdRaw));
  const native = comments.filter(Boolean);
  if (!native.length) return fetchLegacyCommentron('reaction.React', params);

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
    return fetchLegacyCommentron('reaction.React', {
      ...params,
      comment_ids: legacyIds.join(','),
    });
  }
  return { success: true };
}

export async function fetchHyperbeamSettingGet(params: SettingsParams): Promise<any | null> {
  return fetchLegacyCommentron('setting.Get', params);
}

export async function fetchHyperbeamSettingList(params: SettingsParams): Promise<any | null> {
  return fetchLegacyCommentron('setting.List', params);
}

export async function fetchHyperbeamSettingUpdate(params: UpdateSettingsParams): Promise<any | null> {
  return fetchLegacyCommentron('setting.Update', params);
}

export async function fetchHyperbeamSettingBlockWord(params: BlockWordParams): Promise<any | null> {
  return fetchLegacyCommentron('setting.BlockWord', params);
}

export async function fetchHyperbeamSettingUnblockWord(params: BlockWordParams): Promise<any | null> {
  return fetchLegacyCommentron('setting.UnBlockWord', params);
}

export async function fetchHyperbeamSettingListBlockedWords(params: SettingsParams): Promise<any | null> {
  return fetchLegacyCommentron('setting.ListBlockedWords', params);
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
    return fetchLegacyCommentron('moderation.BlockedList', requestParams);
  }
  const [legacyResult, nativeResult] = await Promise.allSettled([
    fetchLegacyCommentron('moderation.BlockedList', requestParams),
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
  const legacy = fetchLegacyCommentron(unblock ? 'moderation.UnBlock' : 'moderation.Block', params);
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
  return fetchLegacyCommentron('moderation.AddDelegate', params);
}

export async function fetchHyperbeamModerationRemoveDelegate(
  params: ModerationRemoveDelegateParams
): Promise<any | null> {
  return fetchLegacyCommentron('moderation.RemoveDelegate', params);
}

export async function fetchHyperbeamModerationListDelegates(
  params: ModerationListDelegatesParams
): Promise<any | null> {
  return fetchLegacyCommentron('moderation.ListDelegates', params);
}

export async function fetchHyperbeamModerationAmI(params: ModerationAmIParams): Promise<any | null> {
  return fetchLegacyCommentron('moderation.AmI', params);
}

// Legacy Commentron reads/writes go straight from the browser to the public
// comment server; failures surface as the standard Commentron fetch error so
// merge paths degrade to native-only.
async function fetchLegacyCommentron(method: string, params: Record<string, any>): Promise<any | null> {
  if (!COMMENT_SERVER_API) return null;

  let response;
  try {
    response = await fetch(`${COMMENT_SERVER_API}?m=${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: compactParams(params) }),
      signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
    });
  } catch (error) {
    throw isFetchTimeoutOrNetworkError(error) ? new TypeError(COMMENTRON_FAILURE) : error;
  }
  if (!response.ok && response.status >= 500) throw new TypeError(COMMENTRON_FAILURE);

  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Commentron ${method} failed with ${response.status}`);
  if (json?.error) throw new Error(json.error.message || String(json.error));
  return json?.result ?? null;
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
        fetchLegacyCommentron('reaction.List', { ...params, comment_ids: legacyIds.join(',') }).then(
          reactionListFromHyperbeam
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

// The store has no general claim-search surface: targeted claim-id lookups
// resolve through the claim-id/immutable store routes, everything else
// degrades to an empty result set (fuzzy search goes direct to lighthouse
// at the redux layer).
export async function fetchHyperbeamSearch(params: ClaimSearchOptions): Promise<ClaimSearchResponse | null> {
  const claimIds = paramValues(params, 'claim_ids', 'claim-ids', 'claim_id', 'claim-id');
  if (claimIds.length) return fetchHyperbeamResolveClaimIds({ ...params, claim_ids: claimIds });

  const pageSize = toNumber(params.page_size, 20);
  return {
    items: [],
    page: toNumber(params.page, 1),
    page_size: pageSize,
    total_items: 0,
    total_pages: 0,
  };
}

export async function fetchHyperbeamClaimsByIds(ids: Array<string>): Promise<Array<Claim>> {
  const claims = await Promise.all(ids.filter(Boolean).map(fetchStoreClaimByAnyId));
  return claims.flat().filter(Boolean);
}

async function fetchStoreClaimByAnyId(id: string): Promise<Array<Claim>> {
  if (isClaimId(id)) {
    const claim = await fetchStoreClaimById(id).catch(() => null);
    return claim ? [claim] : [];
  }
  if (!isOutpointId(id) && !isStandaloneImmutableId(id)) return [];
  return fetchHyperbeamImmutableClaim(id);
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
        claimKeys: claimId,
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
  const items = (await Promise.all(claimIds.map(fetchStoreClaimByAnyId))).flat().filter(Boolean);

  return {
    items,
    page: toNumber((params as any).page, 1),
    page_size: toNumber((params as any).page_size, items.length || claimIds.length || 1),
    total_items: items.length,
    total_pages: items.length ? 1 : 0,
  };
}

export async function fetchHyperbeamVerifyClaimSignature(
  params: VerifyClaimSignatureParams
): Promise<VerifyClaimSignatureResponse | null> {
  const result = await fetchLegacyCommentron('verify.ClaimSignature', params);
  const isValid = value(result, 'is-valid', 'is_valid');

  return typeof isValid === 'boolean' ? { is_valid: isValid } : null;
}

export async function fetchHyperbeamChannel(claim: Claim | null | undefined): Promise<HyperbeamChannel | null> {
  if (!claim || isHyperbeamUploadClaim(claim)) return null;

  const channelClaim = claim.signing_channel || (claim.value_type === 'channel' ? claim : null);
  const channelId = value(channelClaim || {}, 'claim_id', 'claim-id');
  const target = isClaimId(channelId) ? String(channelId) : value(channelClaim || {}, 'permanent_url', 'canonical_url');
  if (!target) return null;

  const result = await fetchCachedStoreJsonOrNull(storePath('odysee/channel', String(target))).catch(() => null);
  const payload = storePayload(result);
  return payload ? channelFromHyperbeam(payload) : null;
}

export async function fetchHyperbeamStreamVerification(
  claim: Claim | null | undefined,
  uri: string
): Promise<any | null> {
  if (!claim || isHyperbeamUploadClaim(claim)) return null;

  const outpoint = claimOutpoint(claim.txid, claim.nout);
  return outpoint ? fetchStoreStreamEvidenceForOutpoint(outpoint) : fetchStoreStreamEvidenceForUri(uri);
}

function isFetchTimeoutOrNetworkError(error: any) {
  const name = String(error?.name || '');
  const message = String(error?.message || error || '');
  return (
    name === 'TimeoutError' || name === 'AbortError' || message === 'Failed to fetch' || message === 'signal timed out'
  );
}

function hyperbeamBaseUrl(): string {
  const configured = String(HYPERBEAM_BASE_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  // Served from a HyperBEAM node via the Arweave path manifest: the node that
  // serves the app is the node to talk to, so default to same-origin. The
  // HYPERBEAM_BASE_URL config override above still wins when set.
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

function claimIdFromUri(uri: string): string | null {
  try {
    const parsed = parseURI(String(uri));
    const claimId = parsed.streamClaimId || parsed.channelClaimId;
    return claimId ? String(claimId) : null;
  } catch (_e) {
    return null;
  }
}

function uriWithClaimId(uri: any, claimId: any): string | null {
  if (!uri || !claimId) return null;
  const text = String(uri);
  const hashIndex = text.lastIndexOf('#');
  return hashIndex === -1 ? `${text}#${claimId}` : `${text.slice(0, hashIndex)}#${claimId}`;
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
          streaming_url: `${hyperbeamBaseUrl()}/${encodeDataPath(String(claimId))}`,
          download_url: `${hyperbeamBaseUrl()}/${encodeDataPath(String(claimId))}`,
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

// Maps a store claim/channel evidence message (hyphenated wire keys:
// claim-id, claim-name, txid, nout, sd-hash, value, public-key...) onto the
// SDK claim shape the UI expects.
function storeClaimFromHyperbeam(payload: any, channelPayload?: any, fallbackName?: string): any | null {
  if (!payload) return null;
  const claimId = value(payload, 'claim-id', 'claim_id');
  if (!isClaimId(claimId)) return null;

  const name = value(payload, 'claim-name', 'claim_name', 'name') || fallbackName;
  const txid = value(payload, 'txid');
  const nout = value(payload, 'nout');
  const outpoint = claimOutpoint(txid, nout);
  const claimValue = isObject(value(payload, 'value')) ? value(payload, 'value') : {};
  const source = isObject(value(claimValue, 'source')) ? value(claimValue, 'source') : {};
  const sdHash = value(payload, 'sd-hash', 'sd_hash') || value(source, 'sd_hash', 'sd-hash');
  const mediaType = value(source, 'media_type', 'media-type');
  const isChannel = Boolean(value(payload, 'public-key', 'public_key')) || String(name || '').startsWith('@');
  const signingChannel = !isChannel && channelPayload ? storeClaimFromHyperbeam(channelPayload) : undefined;
  const mediaUrl = !isChannel ? hyperbeamMediaUrl(outpoint, sdHash) : '';
  const url = name ? claimUrl(String(name), String(claimId)) : undefined;
  const thumbnail = value(claimValue, 'thumbnail');

  return compactParams({
    address: value(payload, 'address'),
    amount: value(payload, 'amount'),
    claim_id: String(claimId),
    claim_op: value(payload, 'claim-op', 'claim_op'),
    name,
    txid,
    nout,
    ...(outpoint ? { outpoint, immutable_id: outpoint, immutable_store_path: `odysee/outpoint/${outpoint}` } : {}),
    type: 'claim',
    value_type: value(payload, 'value-type', 'value_type') || (isChannel ? 'channel' : 'stream'),
    canonical_url: value(payload, 'canonical-url', 'canonical_url') || url,
    permanent_url: value(payload, 'permanent-url', 'permanent_url') || url,
    short_url: value(payload, 'short-url', 'short_url') || url,
    height: value(payload, 'height'),
    timestamp: value(payload, 'timestamp'),
    confirmations: toNumber(value(payload, 'confirmations'), 1),
    meta: normalizeHyperbeamClaimMeta(isObject(value(payload, 'meta')) ? value(payload, 'meta') : {}),
    is_channel_signature_valid: signingChannel ? true : undefined,
    signing_channel: signingChannel,
    ...(mediaUrl ? { streaming_url: mediaUrl, download_url: mediaUrl } : {}),
    value: compactParams({
      ...claimValue,
      title: value(claimValue, 'title'),
      description: value(claimValue, 'description'),
      thumbnail: typeof thumbnail === 'string' ? { url: thumbnail } : thumbnail,
      tags: value(claimValue, 'tags'),
      release_time: value(claimValue, 'release_time', 'release-time'),
      stream_type:
        value(claimValue, 'stream_type', 'stream-type') ||
        streamTypeFromMediaType(mediaType) ||
        (value(claimValue, 'video') ? 'video' : value(claimValue, 'audio') ? 'audio' : undefined),
      ...(sdHash || Object.keys(source).length
        ? {
            source: compactParams({
              ...source,
              sd_hash: sdHash,
              media_type: mediaType,
              size: value(source, 'size', 'byte-size', 'byte_size'),
            }),
          }
        : {}),
    }),
  });
}

function playbackPayloadFromStoreStream(payload: any): any | null {
  if (!payload) return null;
  const claimValue = isObject(value(payload, 'value')) ? value(payload, 'value') : {};
  const source = isObject(value(claimValue, 'source')) ? value(claimValue, 'source') : {};
  const txid = value(payload, 'txid');
  const nout = value(payload, 'nout');
  const outpoint = value(payload, 'outpoint') || claimOutpoint(txid, nout);
  const sdHash = value(payload, 'sd-hash', 'sd_hash') || value(source, 'sd_hash', 'sd-hash');
  const mediaUrl = hyperbeamMediaUrl(outpoint, sdHash);
  if (!mediaUrl) return null;

  return compactParams({
    streaming_url: mediaUrl,
    download_url: mediaUrl,
    media_type: value(source, 'media_type', 'media-type') || (sdHash ? 'video/mp4' : undefined),
    source_size: value(source, 'size', 'byte-size', 'byte_size'),
    sd_hash: sdHash,
    claim_id: value(payload, 'claim-id', 'claim_id'),
    claim_name: value(payload, 'claim-name', 'claim_name', 'name'),
    file_name: value(source, 'name'),
    txid,
    nout,
  });
}

function channelFromHyperbeam(channel: any): HyperbeamChannel {
  const channelValue = channel.value || {};
  const thumbnail = value(channel, 'thumbnail') || channelValue.thumbnail;
  const claimId = value(channel, 'claim-id', 'claim_id');
  const name = value(channel, 'claim-name', 'claim_name', 'name');
  const fallbackUrl = name && claimId ? claimUrl(String(name), String(claimId)) : undefined;

  return compactParams({
    ...channel.source,
    claim_id: claimId,
    name,
    permanent_url: value(channel, 'permanent-url', 'permanent_url') || fallbackUrl,
    canonical_url: value(channel, 'canonical-url', 'canonical_url') || fallbackUrl,
    short_url: value(channel, 'short-url', 'short_url') || fallbackUrl,
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

  const result = await fetchCachedImmutableJsonOrNull(immutableId).then(responsePayload);
  const decodedClaim = decodeClaimMetadata(storePayload(result));
  const signingChannel = decodedClaim?.signedChannelId
    ? await fetchCachedImmutableChannelJsonOrNull(decodedClaim.signedChannelId)
        .then(responsePayload)
        .catch(() => null)
    : null;
  const parsed = parseURI(uri);
  const name = parsed.streamName || parsed.claimName;
  const claim = immutableClaimFromHyperbeam(result, immutableId, signingChannel, decodedClaim, name);
  if (!claim) return null;

  return !name || claim.name === name ? claim : null;
}

function fetchCachedImmutableJsonOrNull(id: string): Promise<any | null> {
  const key = `immutable:${id}`;
  const now = Date.now();
  const cached = storeReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchImmutableJsonOrNull(id).catch((error) => {
    storeReadCache.delete(key);
    throw error;
  });
  storeReadCache.set(key, { expiresAt: now + HYPERBEAM_READ_CACHE_MS, promise });
  return promise;
}

function playbackPayloadFromUploadClaim(claim: any): any | null {
  if (!claim) return null;

  const source = claim.value?.source || {};
  const hyperbeam = claim.hyperbeam || {};
  const dataId = value(hyperbeam, 'data-id', 'data_id') || value(source, 'sd_hash', 'sd-hash', 'source');
  const recordId = value(hyperbeam, 'record-id', 'record_id') || value(claim, 'claim_id', 'claim-id');
  const explicitMediaUrl = absoluteHyperbeamUrl(claim.streaming_url || claim.download_url || source.url);
  const mediaUrl =
    explicitMediaUrl ||
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
  const mediaUrl = explicitMediaUrl || hyperbeamMediaUrl(outpoint, sdHash) || directMediaUrl;
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

function paramValues(source: any, ...keys: string[]): Array<string> {
  const raw = value(source, ...keys);
  if (raw === undefined || raw === null || raw === '') return [];
  if (Array.isArray(raw)) return raw.flatMap((item) => paramValues({ item }, 'item'));
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function fetchStoreJsonOrNull(path: string, preferJson: boolean = true): Promise<any | null> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) return null;
  if (!allowHyperbeamCompatibilityReads() && isCompatibilityStorePath(path)) return null;

  // Store reads consume the node's native HTTPSig encoding: the JSON codec
  // cannot represent the evidence messages' raw binary fields, and only the
  // native encoding carries the commitment information verifiably on the
  // wire. `accept-bundle` inlines nested maps as multipart parts.
  const url = `${buildDeviceUrl(baseUrl, path)}${path.includes('?') ? '&' : '?'}accept-bundle=true`;
  try {
    const response = await fetch(url, {
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
  const cached = storeReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchStoreJsonOrNull(path, preferJson).catch((error) => {
    storeReadCache.delete(key);
    throw error;
  });
  storeReadCache.set(key, { expiresAt: now + HYPERBEAM_READ_CACHE_MS, promise });
  return promise;
}

// Stock HyperBEAM does not resolve bare store paths; arbitrary store paths
// are served by the cache device (`~cache@1.0/read?read=<path>`), the same
// shape hb_store_remote_node uses. Every odysee/* read builds its request
// path here, so a node-side bare-path surface would be a one-line change.
export function hyperbeamStoreReadPath(path: string): string {
  return `${CACHE_DEVICE}/read?read=${encodeURIComponent(path)}`;
}

function storePath(prefix: string, value: string): string {
  return hyperbeamStoreReadPath(`${prefix}/${value}`);
}

function isCompatibilityStorePath(path: string): boolean {
  const readPrefix = `${CACHE_DEVICE}/read?read=`;
  const targetPath = path.startsWith(readPrefix) ? decodeURIComponent(path.slice(readPrefix.length)) : path;
  return [
    'odysee/claim/',
    'odysee/claim-id/',
    'odysee/channel/',
    'odysee/stream/',
    'odysee/stream-id/',
    'odysee/outpoint/',
    'odysee/transaction/',
    'odysee/descriptor/',
    'odysee/blob/',
    'odysee/media/stream-id/',
    'odysee/media/sd-hash/',
  ].some((prefix) => targetPath.startsWith(prefix));
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

// Browsers decode response headers as latin-1, but flat store messages
// carry UTF-8 field values in headers; reinterpret when the bytes are
// valid UTF-8.
function decodeHeaderUtf8(value: string): string {
  if (!/[\x80-\xff]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
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

function decodeClaimMetadata(payload: any): DecodedClaimMetadata | null {
  // Signing info can arrive as a decoded claim-envelope sub-map or as the
  // raw claim bytes (hex) whose envelope names the signing channel.
  const envelope = value(payload, 'claim-envelope', 'claim_envelope');
  if (isObject(envelope)) {
    const signedChannelId = value(envelope, 'channel-id', 'channel_id', 'signing-channel-id', 'signing_channel_id');
    if (isClaimId(signedChannelId)) return { signedChannelId: String(signedChannelId) };
  }

  const claimHex = value(payload, 'claim', 'claim-envelope', 'claim_envelope', 'claim-value-hex', 'claim_value_hex');
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

function claimIdFromChannelUri(uri: string): string | null {
  const match = String(uri).match(/^lbry:\/\/@[^/]+#([0-9a-f]{40})$/i);
  return match ? match[1] : null;
}

// Decrypted media bytes are served by the store's media routes (plain
// GET-able cache-read URLs, usable directly as a video src); prefer the
// immutable outpoint route, falling back to the stream descriptor hash.
function hyperbeamMediaUrl(outpoint: any, sdHash: any): string {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl || !allowHyperbeamCompatibilityReads()) return '';

  if (isOutpointId(outpoint)) return `${baseUrl}/${storePath('odysee/media/stream-id', String(outpoint))}`;
  if (typeof sdHash === 'string' && /^[0-9a-f]{96}$/i.test(sdHash)) {
    return `${baseUrl}/${storePath('odysee/media/sd-hash', sdHash)}`;
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

// Legacy outpoints read the store's immutable stream/outpoint routes; native
// immutable ids read the bare message store. `accept-bundle` inlines the
// node-decoded native `value` sub-message so the client reads `claim.value.*`
// the same way for legacy and native content.
async function fetchImmutableJsonOrNull(id: string): Promise<any | null> {
  if (isOutpointId(id)) {
    const stream = await fetchStoreJsonOrNull(storePath('odysee/stream-id', id), false);
    if (stream) return stream;
    return fetchStoreJsonOrNull(storePath('odysee/outpoint', id), false);
  }
  if (!isStandaloneImmutableId(id)) return null;
  return fetchStoreJsonOrNull(`${encodeDataPath(id)}?accept-bundle=true`, false);
}

function fetchCachedImmutableChannelJsonOrNull(id: string): Promise<any | null> {
  const key = `immutable-channel:${id}`;
  const now = Date.now();
  const cached = storeReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (
    isOutpointId(id) || isStandaloneImmutableId(id)
      ? fetchStoreJsonOrNull(`${encodeDataPath(id)}?accept-bundle=true`, false)
      : fetchStoreJsonOrNull(storePath('odysee/channel', id))
  ).catch((error) => {
    storeReadCache.delete(key);
    throw error;
  });
  storeReadCache.set(key, { expiresAt: now + HYPERBEAM_READ_CACHE_MS, promise });
  return promise;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  const timeout = typeof AbortSignal !== 'undefined' && (AbortSignal as any).timeout;
  return typeof timeout === 'function' ? timeout(ms) : undefined;
}
