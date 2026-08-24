import { HYPERBEAM_BASE_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { SORT_BY } from 'constants/comment';
import { pushHyperbeamDebug } from 'util/hyperbeamDebug';
import { allowHyperbeamCompatibilityReads } from 'util/hyperbeamMode';
import { resolveHyperbeamNodeBase } from 'util/hyperbeamNode';
import { isServedFromManifest } from 'util/manifest-prefix';
import { isHyperbeamUploadClaim } from 'util/claim';
import { buildURI, parseURI } from 'util/lbryURI';
import {
  collapseNativeCommentRevisions,
  isNextNativeCommentRevision,
  nativeCommentBody,
} from 'util/nativeCommentRevisions';
import {
  isNativeMessageId,
  nativeMessageVersionRef,
  verifyNativeMessage,
  type VerifiedNativeMessage,
} from 'util/nativeMessageVerification';
import {
  NATIVE_REACTION_SCHEMA,
  NATIVE_REACTION_SIGNATURE_SCOPE,
  NATIVE_REACTION_TYPE,
  nativeReactionToggleRemoves,
  normalizeNativeReaction,
  projectNativeReactions,
  validNativeReactionTarget,
  type NativeReaction,
  type NativeReactionKind,
  type NativeReactionSubject,
} from 'util/nativeReactions';
import {
  NATIVE_PLAYLIST_SCHEMA,
  NATIVE_PLAYLIST_SIGNATURE_SCOPE,
  NATIVE_PLAYLIST_TYPE,
  activeNativePlaylists,
  nativePlaylistItemsJson,
  normalizeNativePlaylist,
  type NativePlaylist,
} from 'util/nativePlaylists';
import {
  NATIVE_PLAYLIST_REFERENCE_TYPE,
  REFERENCE_DEVICE,
  nativePlaylistReferenceInitMessage,
  nativePlaylistReferenceSetMessage,
  normalizeNativePlaylistReference,
  projectNativePlaylistReference,
  type NativePlaylistReference,
} from 'util/nativePlaylistReferences';
import {
  NATIVE_SUBSCRIPTION_SCHEMA,
  NATIVE_SUBSCRIPTION_SIGNATURE_SCOPE,
  NATIVE_SUBSCRIPTION_TYPE,
  activeNativeSubscriptions,
  collapseNativeSubscriptionStates,
  isNextNativeSubscriptionRevision,
  nativeSubscriptionChannelRef,
  nativeSubscriptionNotificationsDisabled,
  nativeSubscriptionRef,
  normalizeNativeSubscription,
  type NativeSubscription,
  type NativeSubscriptionOperation,
} from 'util/nativeSubscriptions';
import { getHyperbeamAccount } from 'util/hyperbeamAccount';
import {
  hasNativeCommentControlAuthority,
  hasNativeCommentControlCommitterAuthority,
  latestNativeCommentControls,
  NATIVE_COMMENT_CONTROL_SCHEMA,
  NATIVE_COMMENT_CONTROL_SIGNATURE_SCOPE,
  NATIVE_COMMENT_CONTROL_TYPE,
  normalizeNativeCommentControl,
  projectNativeCommentControlState,
  type NativeCommentControl,
} from 'util/nativeCommentControls';
import { FF_MAX_CHARS_IN_COMMENT } from 'constants/form-field';

const HYPERBEAM_TIMEOUT_MS = 15000;
const HYPERBEAM_READ_CACHE_MS = 30 * 1000;
const NATIVE_COMMENT_QUERY_CACHE_MS = HYPERBEAM_READ_CACHE_MS;
const NATIVE_COMMENT_TARGET_OWNER_CACHE_MS = 30 * 1000;
const NATIVE_COMMENT_READ_CONCURRENCY = 4;
const QUERY_DEVICE = '~query@1.0';
const CACHE_DEVICE = '~cache@1.0';
const SEARCH_DEVICE = '~search@1.0';
const SEARCH_MAX_LIMIT = 100;
const HYPERBEAM_PUBLIC_DEVICE_PROXY_BASE = '/$/api/hyperbeam-public-device/v1';
const NATIVE_UPLOAD_SCHEMA = 'odysee-upload@1.0';
// Scope the auth-hook commit flag to stage 0 (the posted message). A global
// `!` also commits resolver stages, producing multiple locators for one
// semantic write and nondeterministic discovery.
const HYPERBEAM_NATIVE_WRITE_PATH = 'id?0.%21=true&committers=all';
const storeReadCache = new Map<string, { expiresAt: number; promise: Promise<any | null> }>();
const nativeCommentQueryCache = new Map<string, { expiresAt: number; promise: Promise<Array<any>> }>();
const nativeCommentControlQueryCache = new Map<
  string,
  { expiresAt: number; promise: Promise<Array<NativeCommentControl>> }
>();
const nativeReactionQueryCache = new Map<string, { expiresAt: number; promise: Promise<Array<NativeReaction>> }>();
const recentNativeReactionWrites = new Map<string, Map<string, NativeReaction>>();
const nativePlaylistQueryCache = new Map<string, { expiresAt: number; promise: Promise<Array<NativePlaylist>> }>();
const nativePlaylistReferenceQueryCache = new Map<
  string,
  { expiresAt: number; promise: Promise<Array<NativePlaylistReference>> }
>();
const nativeSubscriptionQueryCache = new Map<
  string,
  { expiresAt: number; promise: Promise<Array<NativeSubscription>> }
>();
const nativeCommentTargetOwnerCache = new Map<string, { expiresAt: number; promise: Promise<string | null> }>();
let activeAccountOwnerCache: { accountId: string; expiresAt: number; promise: Promise<string | null> } | undefined;

export async function fetchHyperbeamResolve(params: any): Promise<any | null> {
  const urls = urlsFromResolveParams(params);
  if (!urls.length) return null;
  const immutableSigningChannelIds = isObject(params?.immutable_signing_channel_ids)
    ? params.immutable_signing_channel_ids
    : {};

  // Every uri resolves through read-only store GETs against the node:
  // immutable-id routes (out_<txid>_<nout> / 43-char ids) read the message
  // store directly, channel uris read the channel evidence route, and the
  // rest read the claim evidence route with a claim-id fallback.
  const entries = await Promise.all(
    urls.map(
      async (uri): Promise<[string, any]> => [
        uri,
        await resolveStoreClaimForUri(uri, immutableSigningChannelIds[uri]).catch(() => null),
      ]
    )
  );
  return Object.fromEntries(entries.filter(([, claim]) => claim));
}

async function resolveStoreClaimForUri(uri: string, immutableSigningChannelId?: string): Promise<any | null> {
  const immutableId = immutableRouteIdFromUri(uri);
  const immutableClaim = await fetchHyperbeamImmutableResolve(uri, immutableSigningChannelId).catch(() => null);
  if (immutableClaim) return immutableClaim;

  // Immutable routes are exact identities. A miss must not be reinterpreted as
  // a mutable LBRY name, which creates invalid `lbry://immutable_*` lookups and
  // leaves the corresponding tile in a permanent loading state.
  if (immutableId) return null;

  if (isChannelUri(uri)) return fetchStoreChannelClaimForUri(uri);

  const storeClaim = await fetchStoreClaimForUri(uri);
  if (storeClaim) return storeClaim;

  const claimId = claimIdFromUri(uri);
  const byId = claimId && isClaimId(claimId) ? await fetchStoreClaimById(claimId) : null;
  if (byId) return byId;

  // Native uploads live in the match-index, not the legacy `odysee/claim`
  // namespace. Resolve a bare `lbry://<name>` for one by looking its upload
  // record up by name, then reuse the immutable-id route to build the claim.
  return fetchUploadClaimByName(uri).catch(() => null);
}

// Bridge a bare `lbry://<name>` to a native upload: the upload's index record
// (`odysee-upload@1.0`) is the name -> record-id link, and the record-id
// resolves through the immutable-id route.
async function fetchUploadClaimByName(uri: string): Promise<any | null> {
  let name;
  try {
    const parsed = parseURI(uri);
    name = parsed.streamName || parsed.claimName;
  } catch {}
  if (!name) return null;

  const request = nativeQueryRequest({ schema: NATIVE_UPLOAD_SCHEMA, name });
  const recordId = uniquePaths(queryPaths(await fetchPublicQueryJson(request))).find(Boolean);
  if (!recordId) return null;

  return resolveImmutableClaimById(recordId);
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
    cover?: { url?: string };
  };
  [key: string]: any;
};

type DecodedClaimMetadata = {
  signedChannelId?: string;
  value?: Record<string, any>;
};

export async function fetchHyperbeamCommentList(params: CommentListParams): Promise<CommentListResponse | null> {
  return paginateNativeComments(params, await fetchNativeCommentSource(params));
}

export async function fetchHyperbeamCommentById(params: CommentByIdParams): Promise<CommentByIdResponse | null> {
  const native = await fetchNativeCommentById(params.comment_id);
  if (!native) return null;
  const ancestors = params.with_ancestors ? await fetchNativeCommentAncestors(native) : [];
  return { item: native, items: [native], ancestors };
}

export async function fetchHyperbeamCommentCreate(params: CommentCreateParams): Promise<CommentCreateResponse | null> {
  if (!(await activeHyperbeamAccountOwner())) {
    throw new Error('Sign up or log in with the HyperBEAM account before commenting');
  }
  const message = nativeCommentMessage(params);
  if (params.dry_run) {
    return commentFromHyperbeam({
      ...message,
      'message-id': 'dry-run',
      'commitment-verification': 'not-written',
    });
  }
  const commentId = await writeNativeMessage(message, 'comment');
  clearNativeCommentCaches();
  const comment = await fetchNativeCommentVersionById(commentId);
  if (!comment) throw new Error('HyperBEAM native comment failed commitment verification');
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

export async function recoverHyperbeamAccountProfile(): Promise<{ name: string; id: string } | null> {
  const probeId = await writeNativeMessage(
    {
      schema: 'odysee-session@1.0',
      type: 'session',
      action: 'login',
      timestamp: Date.now(),
    },
    'session probe'
  );
  const owner = await fetchNativeMessageCommitter(probeId);
  if (!owner) throw new Error('The HyperBEAM session could not be verified.');

  const paths = uniquePaths(
    queryPaths(
      await fetchPublicQueryJson(
        nativeQueryRequest({
          type: 'channel',
        })
      )
    )
  );

  let cursor = 0;
  let account: { name: string; id: string } | null = null;
  const workers = Array.from({ length: Math.min(paths.length, NATIVE_COMMENT_READ_CONCURRENCY) }, async () => {
    while (!account && cursor < paths.length) {
      const id = paths[cursor++];
      const verified = await fetchVerifiedNativeMessage(id);
      const name = value(verified?.payload || {}, 'name');
      if (
        verified?.owner === owner &&
        value(verified.payload, 'type') === 'channel' &&
        typeof name === 'string' &&
        name.trim()
      ) {
        account = { id, name: name.trim() };
      }
    }
  });
  await Promise.all(workers);
  return account;
}

export type NativePlaylistWriteParams = {
  title: string;
  description?: string;
  thumbnail_url?: string;
  tags?: Array<string>;
  languages?: Array<string>;
  items: Array<string>;
  reference_id?: string;
};

export async function fetchHyperbeamPlaylistListMine(
  options: CollectionListOptions = {}
): Promise<CollectionListResponse> {
  const account = getHyperbeamAccount();
  const owner = await activeHyperbeamAccountOwner();
  const page = Math.max(1, toNumber(options.page, 1));
  const pageSize = Math.max(1, Math.min(100, toNumber(options.page_size, 50)));
  if (!account || !owner) return emptyCollectionList(page, pageSize);

  const snapshots = activeNativePlaylists(
    await fetchNativePlaylistCollection({
      schema: NATIVE_PLAYLIST_SCHEMA,
      type: NATIVE_PLAYLIST_TYPE,
      'profile-id': account.id,
    })
  ).filter((playlist) => playlist.owner === owner);
  const references = // `device` is a system key the node's match index does not index, so it
    // cannot be a query selector; normalizeNativePlaylistReference verifies
    // the device on every fetched candidate instead.
    (
      await fetchNativePlaylistReferenceCollection({
        'reference-type': NATIVE_PLAYLIST_REFERENCE_TYPE,
        'profile-id': account.id,
      })
    ).filter((reference) => reference.is_init && reference.owner === owner);
  const referenced = (
    await Promise.all(references.map((reference) => fetchNativePlaylistForReference(reference).catch(() => null)))
  ).filter(Boolean) as Array<{
    reference: NativePlaylistReference;
    playlist: NativePlaylist;
    snapshotIds: Array<string>;
  }>;
  const referencedSnapshotIds = new Set(referenced.flatMap(({ snapshotIds }) => snapshotIds));
  const items = referenced
    .map(({ reference, playlist }) => nativePlaylistClaim(playlist, true, reference.reference_id))
    .concat(
      snapshots
        .filter((playlist) => !referencedSnapshotIds.has(playlist.message_id))
        .map((playlist) => nativePlaylistClaim(playlist, true))
    )
    .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total_items: items.length,
    total_pages: items.length ? Math.ceil(items.length / pageSize) : 0,
  };
}

export async function fetchHyperbeamPlaylistById(messageId: string): Promise<Claim | null> {
  if (!isNativeMessageId(messageId)) return null;
  const reference = await fetchNativePlaylistReferenceById(messageId);
  if (reference) {
    const resolved = await fetchNativePlaylistForReference(reference);
    if (!resolved) return null;
    const viewerOwner = await activeHyperbeamAccountOwner();
    return nativePlaylistClaim(
      resolved.playlist,
      viewerOwner === resolved.reference.owner,
      resolved.reference.reference_id
    );
  }
  const playlist = await fetchNativePlaylistById(messageId);
  if (!playlist) return null;
  const viewerOwner = await activeHyperbeamAccountOwner();
  return nativePlaylistClaim(playlist, viewerOwner === playlist.owner);
}

export async function fetchHyperbeamPlaylistPublish(params: NativePlaylistWriteParams): Promise<Claim> {
  const account = getHyperbeamAccount();
  const owner = await activeHyperbeamAccountOwner();
  if (!account || !owner) throw new Error('Sign up or log in with the HyperBEAM account before publishing');

  let reference: NativePlaylistReference | null = null;
  let currentPlaylist: NativePlaylist | null = null;
  if (params.reference_id) {
    if (!isNativeMessageId(params.reference_id)) throw new Error('Playlist reference ID is invalid');
    const current = await fetchNativePlaylistReferenceById(params.reference_id);
    if (!current || current.owner !== owner || current.profile_id !== account.id) {
      throw new Error('Playlist reference failed commitment or ownership verification');
    }
    const resolved = await fetchNativePlaylistForReference(current);
    if (!resolved) throw new Error('Playlist reference does not resolve to a verified snapshot');
    reference = resolved.reference;
    currentPlaylist = resolved.playlist;
  }

  const timestamp = Math.max(Date.now(), (reference?.timestamp || 0) + 1);
  const message = nativePlaylistMessage({
    ...params,
    profileId: account.id,
    profileName: account.name,
    createdAt: currentPlaylist?.created_at || timestamp,
    updatedAt: timestamp,
  });
  validateNativePlaylistWrite(message, owner);

  const messageId = await writeNativeMessage(message, 'playlist');
  nativePlaylistQueryCache.clear();
  const written = await fetchNativePlaylistById(messageId);
  if (!written || written.owner !== owner || written.message_id !== messageId) {
    throw new Error('HyperBEAM native playlist failed commitment or ownership verification');
  }

  const referenceMessage = reference
    ? nativePlaylistReferenceSetMessage({
        profileId: account.id,
        profileName: account.name,
        referenceId: reference.reference_id,
        snapshotId: messageId,
        timestamp,
      })
    : nativePlaylistReferenceInitMessage({
        profileId: account.id,
        profileName: account.name,
        snapshotId: messageId,
        timestamp,
      });
  const referenceMessageId = await writeNativeMessage(referenceMessage, 'playlist reference');
  nativePlaylistReferenceQueryCache.clear();
  const verifiedReference = await fetchNativePlaylistReferenceMessageById(referenceMessageId);
  const referenceId = reference?.reference_id || referenceMessageId;
  if (
    !verifiedReference ||
    verifiedReference.owner !== owner ||
    verifiedReference.profile_id !== account.id ||
    verifiedReference.reference_id !== referenceId ||
    verifiedReference.reference_value !== messageId ||
    verifiedReference.timestamp !== timestamp ||
    verifiedReference.is_init === Boolean(reference)
  ) {
    throw new Error('HyperBEAM playlist reference failed commitment or ownership verification');
  }
  return nativePlaylistClaim(written, true, referenceId);
}

async function fetchNativePlaylistReferenceCollection(
  selectors: Record<string, any>
): Promise<Array<NativePlaylistReference>> {
  const request = nativeQueryRequest(selectors);
  const key = stableJson(request);
  return cachedNativeQuery(nativePlaylistReferenceQueryCache, key, async () => {
    const paths = uniquePaths(queryPaths(await fetchPublicQueryJson(request)));
    const references = await Promise.all(paths.map(fetchNativePlaylistReferenceMessageById));
    return references.filter((reference): reference is NativePlaylistReference => {
      if (!reference) return false;
      return Object.entries(selectors).every(([selector, expected]) => {
        const fieldName = selector.replace(/-([a-z])/g, (_, character) => `_${character}`);
        return reference[fieldName] === expected;
      });
    });
  });
}

async function fetchNativePlaylistReferenceMessageById(id: string): Promise<NativePlaylistReference | null> {
  if (!isNativeMessageId(id)) return null;
  const normalizedId = id.replace(/^\/+/, '');
  const result = await fetchCachedImmutableJsonOrNull(normalizedId);
  const verified = await fetchVerifiedNativeMessage(normalizedId, storePayload(result));
  if (!verified) return null;
  return normalizeNativePlaylistReference({
    ...verified.payload,
    'message-id': normalizedId,
    'hyperbeam-owner': verified.owner,
  });
}

async function fetchNativePlaylistReferenceById(referenceId: string): Promise<NativePlaylistReference | null> {
  const reference = await fetchNativePlaylistReferenceMessageById(referenceId);
  return reference?.is_init && reference.reference_id === referenceId ? reference : null;
}

async function fetchNativePlaylistForReference(
  init: NativePlaylistReference
): Promise<{ reference: NativePlaylistReference; playlist: NativePlaylist; snapshotIds: Array<string> } | null> {
  if (!init.is_init) return null;
  // `device` stays out of the selectors (unindexed system key); the device is
  // verified per candidate during normalization.
  const candidates = await fetchNativePlaylistReferenceCollection({
    'reference-type': NATIVE_PLAYLIST_REFERENCE_TYPE,
    'reference-id': init.reference_id,
  });
  const reference = projectNativePlaylistReference(init, candidates);
  const playlist = await fetchNativePlaylistById(reference.reference_value);
  if (
    !playlist ||
    playlist.owner !== init.owner ||
    playlist.profile_id !== init.profile_id ||
    (init.profile_name && playlist.profile_name !== init.profile_name)
  ) {
    return null;
  }
  const snapshotIds = [
    init.reference_value,
    ...candidates
      .filter(
        (candidate) =>
          candidate.reference_id === init.reference_id &&
          candidate.owner === init.owner &&
          candidate.profile_id === init.profile_id
      )
      .map((candidate) => candidate.reference_value),
  ];
  return { reference, playlist, snapshotIds: Array.from(new Set(snapshotIds)) };
}

async function fetchNativePlaylistCollection(selectors: Record<string, any>): Promise<Array<NativePlaylist>> {
  const request = nativeQueryRequest(selectors);
  const key = stableJson(request);
  return cachedNativeQuery(nativePlaylistQueryCache, key, async () => {
    const paths = uniquePaths(queryPaths(await fetchPublicQueryJson(request)));
    const playlists = await resolveNativePlaylistPaths(paths);
    return playlists.filter((playlist) =>
      Object.entries(selectors).every(([selector, expected]) => {
        const fieldName = selector.replace(/-([a-z])/g, (_, character) => `_${character}`);
        return playlist[fieldName] === expected;
      })
    );
  });
}

async function resolveNativePlaylistPaths(paths: Array<string>): Promise<Array<NativePlaylist>> {
  const playlists: Array<NativePlaylist | null> = Array.from({ length: paths.length }, () => null);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(paths.length, NATIVE_COMMENT_READ_CONCURRENCY) }, async () => {
    while (cursor < paths.length) {
      const index = cursor++;
      playlists[index] = await fetchNativePlaylistById(paths[index]);
    }
  });
  await Promise.all(workers);
  return playlists.filter((playlist): playlist is NativePlaylist => Boolean(playlist));
}

async function fetchNativePlaylistById(id: string): Promise<NativePlaylist | null> {
  if (!isNativeMessageId(id)) return null;
  const normalizedId = id.replace(/^\/+/, '');
  const result = await fetchCachedImmutableJsonOrNull(normalizedId);
  const verified = await fetchVerifiedNativeMessage(normalizedId, storePayload(result));
  if (!verified) return null;
  const playlist = normalizeNativePlaylist({
    ...verified.payload,
    'message-id': normalizedId,
    'hyperbeam-owner': verified.owner,
  });
  if (!playlist) return null;
  const profile = await verifiedNativePlaylistProfile(playlist);
  return profile ? { ...playlist, profile_name: profile.name } : null;
}

async function verifiedNativePlaylistProfile(playlist: NativePlaylist): Promise<{ name: string } | null> {
  const verified = await fetchVerifiedNativeMessage(playlist.profile_id);
  const name = value(verified?.payload || {}, 'name');
  if (
    !verified ||
    verified.owner !== playlist.owner ||
    value(verified.payload, 'type') !== 'channel' ||
    typeof name !== 'string' ||
    !name.trim() ||
    (playlist.profile_name && playlist.profile_name !== name)
  ) {
    return null;
  }
  return { name };
}

function nativePlaylistMessage(
  params: NativePlaylistWriteParams & {
    profileId: string;
    profileName?: string;
    createdAt: number;
    updatedAt: number;
  }
): Record<string, any> {
  const tags = (params.tags || []).map(String);
  const languages = (params.languages || []).map(String);
  return compactParams({
    schema: NATIVE_PLAYLIST_SCHEMA,
    type: NATIVE_PLAYLIST_TYPE,
    'profile-id': params.profileId,
    'profile-name': params.profileName,
    title: params.title,
    description: params.description,
    'thumbnail-url': params.thumbnail_url,
    'tags-json': JSON.stringify(tags),
    'languages-json': JSON.stringify(languages),
    'items-json': nativePlaylistItemsJson(params.items),
    'item-count': params.items.length,
    'created-at': params.createdAt,
    'updated-at': params.updatedAt,
    'signature-scope': NATIVE_PLAYLIST_SIGNATURE_SCOPE,
  });
}

function validateNativePlaylistWrite(message: Record<string, any>, owner: string) {
  const candidate = normalizeNativePlaylist({
    ...message,
    'message-id': 'v'.repeat(43),
    'hyperbeam-owner': owner,
  });
  if (!candidate) throw new Error('Native playlist fields are invalid or exceed their limits');
}

function nativePlaylistClaim(playlist: NativePlaylist, isMine: boolean, referenceId?: string): Claim {
  const timestamp = Math.floor(playlist.updated_at / 1000);
  const creationTimestamp = Math.floor(playlist.created_at / 1000);
  const publicId = referenceId || playlist.message_id;
  const permanentUrl = `/$/playlist/${encodeURIComponent(publicId)}`;
  return {
    claim_id: publicId,
    name: playlist.title,
    normalized_name: playlist.title.toLowerCase(),
    permanent_url: permanentUrl,
    canonical_url: permanentUrl,
    short_url: permanentUrl,
    type: 'claim',
    value_type: 'collection',
    value: {
      title: playlist.title,
      description: playlist.description,
      thumbnail: playlist.thumbnail_url ? { url: playlist.thumbnail_url } : undefined,
      tags: playlist.tags,
      languages: playlist.languages,
      claims: playlist.items,
    },
    meta: { creation_timestamp: creationTimestamp },
    timestamp,
    confirmations: 1,
    is_my_output: isMine,
    hyperbeam: {
      schema: playlist.schema,
      message_id: playlist.message_id,
      reference_id: referenceId,
      owner: playlist.owner,
      profile_id: playlist.profile_id,
      profile_name: playlist.profile_name,
    },
  } as unknown as Claim;
}

function emptyCollectionList(page: number, pageSize: number): CollectionListResponse {
  return { items: [], page, page_size: pageSize, total_items: 0, total_pages: 0 };
}

export type NativeSubscriptionWriteParams = {
  channelName: string;
  uri: string;
  notificationsDisabled?: boolean;
};

export async function fetchHyperbeamSubscriptions(): Promise<Array<Subscription>> {
  const account = getHyperbeamAccount();
  const owner = await activeHyperbeamAccountOwner();
  if (!account || !owner) return [];

  const subscriptions = activeNativeSubscriptions(
    await fetchNativeSubscriptionCollection({
      schema: NATIVE_SUBSCRIPTION_SCHEMA,
      type: NATIVE_SUBSCRIPTION_TYPE,
      'profile-id': account.id,
    })
  ).filter((subscription) => subscription.owner === owner);
  return subscriptions.map(nativeSubscriptionForRedux);
}

export async function fetchHyperbeamSubscriptionUpdate(
  params: NativeSubscriptionWriteParams,
  unfollow = false
): Promise<Array<Subscription>> {
  const account = getHyperbeamAccount();
  const owner = await activeHyperbeamAccountOwner();
  if (!account || !owner) throw new Error('Create or log in to a HyperBEAM account before following channels');

  const target = nativeSubscriptionTarget(params);
  const subscriptionRef = nativeSubscriptionRef(owner, target.channelRef);
  const current = await fetchNativeSubscriptionHead(subscriptionRef);
  const notificationsDisabled = nativeSubscriptionNotificationsDisabled(params.notificationsDisabled);

  if (unfollow && (!current || current.state === 'removed')) return fetchHyperbeamSubscriptions();
  if (
    !unfollow &&
    current?.state === 'active' &&
    current.channel_uri === target.channelUri &&
    current.channel_name === target.channelName &&
    current.notifications_disabled === notificationsDisabled
  ) {
    return fetchHyperbeamSubscriptions();
  }

  const timestamp = Date.now();
  const operation: NativeSubscriptionOperation = unfollow
    ? 'unfollow'
    : current?.state === 'active'
      ? 'update'
      : 'follow';
  const message = nativeSubscriptionMessage({
    subscriptionRef,
    channelRef: target.channelRef,
    channelUri: target.channelUri,
    channelName: target.channelName,
    profileId: account.id,
    profileName: account.name,
    notificationsDisabled,
    state: unfollow ? 'removed' : 'active',
    operation,
    origin: current?.origin || 'native',
    importedAt: current?.imported_at,
    revision: current ? current.revision + 1 : 0,
    revisionOf: current ? subscriptionRef : undefined,
    previousVersion: current?.version_ref,
    versionRef: nativeMessageVersionRef(),
    createdAt: current?.created_at || timestamp,
    updatedAt: timestamp,
  });
  validateNativeSubscriptionWrite(message, owner);

  const messageId = await writeNativeMessage(message, `channel ${operation}`);
  nativeSubscriptionQueryCache.clear();
  const written = await fetchNativeSubscriptionById(messageId);
  const validWrite = current
    ? written &&
      isNextNativeSubscriptionRevision(
        current.revision_of ? await subscriptionRoot(current) : current,
        current,
        written
      )
    : written && !written.revision_of && written.subscription_ref === subscriptionRef;
  if (!written || !validWrite || written.owner !== owner) {
    throw new Error('HyperBEAM subscription update failed commitment or ownership verification');
  }

  return fetchHyperbeamSubscriptions();
}

async function subscriptionRoot(current: NativeSubscription): Promise<NativeSubscription> {
  const versions = await fetchNativeSubscriptionCollection({
    schema: NATIVE_SUBSCRIPTION_SCHEMA,
    type: NATIVE_SUBSCRIPTION_TYPE,
    'subscription-ref': current.subscription_ref,
  });
  const root = versions.find(
    (subscription) => subscription.subscription_ref === current.subscription_ref && !subscription.revision_of
  );
  if (!root) throw new Error('HyperBEAM subscription root is unavailable');
  return root;
}

async function fetchNativeSubscriptionHead(subscriptionRef: string): Promise<NativeSubscription | null> {
  const current = collapseNativeSubscriptionStates(
    await fetchNativeSubscriptionCollection({
      schema: NATIVE_SUBSCRIPTION_SCHEMA,
      type: NATIVE_SUBSCRIPTION_TYPE,
      'subscription-ref': subscriptionRef,
    })
  );
  return current.find((subscription) => subscription.subscription_ref === subscriptionRef) || null;
}

async function fetchNativeSubscriptionCollection(selectors: Record<string, any>): Promise<Array<NativeSubscription>> {
  const request = nativeQueryRequest(selectors);
  const key = stableJson(request);
  return cachedNativeQuery(nativeSubscriptionQueryCache, key, async () => {
    const paths = uniquePaths(queryPaths(await fetchPublicQueryJson(request)));
    const subscriptions = await resolveNativeSubscriptionPaths(paths);
    return subscriptions.filter((subscription) =>
      Object.entries(selectors).every(([selector, expected]) => {
        const fieldName = selector.replace(/-([a-z])/g, (_, character) => `_${character}`);
        return subscription[fieldName] === expected;
      })
    );
  });
}

async function resolveNativeSubscriptionPaths(paths: Array<string>): Promise<Array<NativeSubscription>> {
  const subscriptions: Array<NativeSubscription | null> = Array.from({ length: paths.length }, () => null);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(paths.length, NATIVE_COMMENT_READ_CONCURRENCY) }, async () => {
    while (cursor < paths.length) {
      const index = cursor++;
      subscriptions[index] = await fetchNativeSubscriptionById(paths[index]);
    }
  });
  await Promise.all(workers);
  return subscriptions.filter((subscription): subscription is NativeSubscription => Boolean(subscription));
}

async function fetchNativeSubscriptionById(id: string): Promise<NativeSubscription | null> {
  if (!isNativeMessageId(id)) return null;
  const normalizedId = id.replace(/^\/+/, '');
  const result = await fetchCachedImmutableJsonOrNull(normalizedId);
  const verified = await fetchVerifiedNativeMessage(normalizedId, storePayload(result));
  if (!verified) return null;
  const subscription = normalizeNativeSubscription({
    ...verified.payload,
    'message-id': normalizedId,
    'hyperbeam-owner': verified.owner,
  });
  if (!subscription) return null;
  const profile = await verifiedNativeSubscriptionProfile(subscription);
  return profile ? { ...subscription, profile_name: profile.name } : null;
}

async function verifiedNativeSubscriptionProfile(subscription: NativeSubscription): Promise<{ name: string } | null> {
  const verified = await fetchVerifiedNativeMessage(subscription.profile_id);
  const name = value(verified?.payload || {}, 'name');
  if (
    !verified ||
    verified.owner !== subscription.owner ||
    value(verified.payload, 'type') !== 'channel' ||
    typeof name !== 'string' ||
    !name.trim() ||
    (subscription.profile_name && subscription.profile_name !== name)
  ) {
    return null;
  }
  return { name };
}

function nativeSubscriptionTarget(params: NativeSubscriptionWriteParams): {
  channelRef: string;
  channelUri: string;
  channelName: string;
} {
  const channelUri = String(params.uri || '').trim();
  const channelName = String(params.channelName || '').trim();
  let channelClaimId;
  try {
    ({ channelClaimId } = parseURI(channelUri));
  } catch {}
  if (!channelClaimId) throw new Error('Following requires a permanent channel URI with a full channel ID');
  return {
    channelRef: nativeSubscriptionChannelRef(channelClaimId),
    channelUri,
    channelName,
  };
}

function nativeSubscriptionMessage(params: {
  subscriptionRef: string;
  channelRef: string;
  channelUri: string;
  channelName: string;
  profileId: string;
  profileName: string;
  notificationsDisabled: boolean;
  state: 'active' | 'removed';
  operation: NativeSubscriptionOperation;
  origin: 'native' | 'legacy-import';
  importedAt?: number;
  revision: number;
  revisionOf?: string;
  previousVersion?: string;
  versionRef: string;
  createdAt: number;
  updatedAt: number;
}): Record<string, any> {
  return compactParams({
    schema: NATIVE_SUBSCRIPTION_SCHEMA,
    type: NATIVE_SUBSCRIPTION_TYPE,
    'subscription-ref': params.subscriptionRef,
    'channel-ref': params.channelRef,
    'channel-uri': params.channelUri,
    'channel-name': params.channelName,
    'profile-id': params.profileId,
    'profile-name': params.profileName,
    'notifications-disabled': params.notificationsDisabled,
    state: params.state,
    operation: params.operation,
    'source-system': params.origin,
    'imported-at': params.importedAt,
    revision: params.revision,
    'version-ref': params.versionRef,
    'revision-of': params.revisionOf,
    'previous-version': params.previousVersion,
    'created-at': params.createdAt,
    'updated-at': params.updatedAt,
    'signature-scope': NATIVE_SUBSCRIPTION_SIGNATURE_SCOPE,
  });
}

function validateNativeSubscriptionWrite(message: Record<string, any>, owner: string) {
  const candidate = normalizeNativeSubscription({
    ...message,
    'message-id': 's'.repeat(43),
    'hyperbeam-owner': owner,
  });
  if (!candidate) throw new Error('Native subscription fields are invalid or exceed their limits');
}

function nativeSubscriptionForRedux(subscription: NativeSubscription): Subscription {
  return {
    uri: subscription.channel_uri,
    channelName: subscription.channel_name,
    notificationsDisabled: subscription.notifications_disabled,
  };
}

type NativeFileReactionParams = {
  target: string;
  reaction: NativeReactionKind;
};

export async function fetchHyperbeamFileReactionList(claimIds: string | Array<string>): Promise<ReactionListResponse> {
  return nativeReactionList(stringList(claimIds), 'content');
}

export async function fetchHyperbeamFileReactionReact(
  params: NativeFileReactionParams
): Promise<ReactionReactResponse> {
  return writeNativeReaction({ ...params, subject: 'content', toggle: true });
}

async function nativeReactionList(
  targets: Array<string>,
  subject: NativeReactionSubject
): Promise<ReactionListResponse> {
  const validTargets = Array.from(new Set(targets.filter(validNativeReactionTarget)));
  const [collections, viewerOwner] = await Promise.all([
    Promise.all(validTargets.map((target) => fetchNativeReactionCollection(target, subject))),
    activeHyperbeamAccountOwner(),
  ]);
  const projected = projectNativeReactions(collections.flat(), viewerOwner);
  return reactionListResponse(validTargets, projected.my_reactions, projected.others_reactions);
}

async function writeNativeReaction(params: {
  target: string;
  subject: NativeReactionSubject;
  reaction: NativeReactionKind;
  remove?: boolean;
  toggle?: boolean;
}): Promise<ReactionReactResponse> {
  if (!validNativeReactionTarget(params.target)) throw new Error('A valid native reaction target is required');
  if (params.reaction !== 'like' && params.reaction !== 'dislike') {
    throw new Error('This native reaction type is not implemented');
  }

  const [owner, existing] = await Promise.all([
    activeHyperbeamAccountOwner(),
    fetchNativeReactionCollection(params.target, params.subject),
  ]);
  if (!owner) throw new Error('Sign up or log in with the HyperBEAM account before reacting');

  const current = projectNativeReactions(existing, owner).current.find((reaction) => reaction.owner === owner);
  const shouldRemove = Boolean(
    params.remove || (params.toggle && nativeReactionToggleRemoves(current, params.reaction))
  );
  if (shouldRemove && (!current || current.state !== 'active' || current.reaction !== params.reaction)) {
    return { success: true, ...(await nativeReactionList([params.target], params.subject)) };
  }

  const profile = getHyperbeamAccount();
  const eventTimestamp = Date.now();
  const operation = shouldRemove ? 'remove' : 'set';
  const message = compactParams({
    schema: NATIVE_REACTION_SCHEMA,
    type: NATIVE_REACTION_TYPE,
    'reaction-ref': current?.reaction_ref || nativeMessageVersionRef(),
    target: params.target,
    subject: params.subject,
    reaction: params.reaction,
    state: shouldRemove ? 'removed' : 'active',
    operation,
    revision: current ? current.revision + 1 : 0,
    'version-ref': nativeMessageVersionRef(),
    'revision-of': current ? current.reaction_ref : undefined,
    'previous-version': current?.version_ref,
    'event-timestamp': eventTimestamp,
    author: profile?.id,
    'profile-id': profile?.id,
    'profile-name': profile?.name,
    'signature-scope': NATIVE_REACTION_SIGNATURE_SCOPE,
  });
  const messageId = await writeNativeMessage(message, `${params.subject} reaction`);
  nativeReactionQueryCache.clear();
  const written = await fetchNativeReactionById(messageId);
  if (!written || written.owner !== owner) {
    throw new Error('HyperBEAM native reaction failed commitment or ownership verification');
  }
  rememberNativeReactionWrite(written);

  // The committed message is already exact-read and verified above. Project
  // it immediately instead of requiring the match index to expose it in the
  // same event-loop turn. Query remains discovery only, never authority.
  const projected = projectNativeReactions(mergeNativeReactionEvents(existing, [written]), owner);

  return {
    success: true,
    'message-id': messageId,
    ...reactionListResponse([params.target], projected.my_reactions, projected.others_reactions),
  };
}

async function fetchNativeReactionCollection(
  target: string,
  subject: NativeReactionSubject
): Promise<Array<NativeReaction>> {
  const selectors = {
    schema: NATIVE_REACTION_SCHEMA,
    type: NATIVE_REACTION_TYPE,
    target,
    subject,
  };
  const request = nativeQueryRequest(selectors);
  const key = stableJson(request);
  const discovered = await cachedNativeQuery(nativeReactionQueryCache, key, async () => {
    const paths = uniquePaths(queryPaths(await fetchPublicQueryJson(request)));
    const reactions = await resolveNativeReactionPaths(paths);
    return reactions.filter(
      (reaction) =>
        reaction.schema === selectors.schema &&
        reaction.type === selectors.type &&
        reaction.target === target &&
        reaction.subject === subject
    );
  });
  return mergeNativeReactionEvents(discovered, recentNativeReactionWritesFor(target, subject));
}

function nativeReactionCollectionKey(target: string, subject: NativeReactionSubject): string {
  return `${subject}\u0000${target}`;
}

function recentNativeReactionWritesFor(target: string, subject: NativeReactionSubject): Array<NativeReaction> {
  return Array.from(recentNativeReactionWrites.get(nativeReactionCollectionKey(target, subject))?.values() || []);
}

function rememberNativeReactionWrite(reaction: NativeReaction): void {
  const key = nativeReactionCollectionKey(reaction.target, reaction.subject);
  const recent = recentNativeReactionWrites.get(key) || new Map<string, NativeReaction>();
  recent.set(reaction.message_id, reaction);
  while (recent.size > 100) recent.delete(recent.keys().next().value);
  recentNativeReactionWrites.set(key, recent);
}

function mergeNativeReactionEvents(
  discovered: Array<NativeReaction>,
  recent: Array<NativeReaction>
): Array<NativeReaction> {
  const byId = new Map<string, NativeReaction>();
  [...discovered, ...recent].forEach((reaction) => byId.set(reaction.message_id, reaction));
  return Array.from(byId.values());
}

async function resolveNativeReactionPaths(paths: Array<string>): Promise<Array<NativeReaction>> {
  const reactions: Array<NativeReaction | null> = Array.from({ length: paths.length }, () => null);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(paths.length, NATIVE_COMMENT_READ_CONCURRENCY) }, async () => {
    while (cursor < paths.length) {
      const index = cursor++;
      reactions[index] = await fetchNativeReactionById(paths[index]);
    }
  });
  await Promise.all(workers);
  return reactions.filter((reaction): reaction is NativeReaction => Boolean(reaction));
}

async function fetchNativeReactionById(id: string): Promise<NativeReaction | null> {
  if (!isNativeMessageId(id)) return null;
  const normalizedId = id.replace(/^\/+/, '');
  const result = await fetchCachedImmutableJsonOrNull(normalizedId);
  const verified = await fetchVerifiedNativeMessage(normalizedId, storePayload(result));
  if (!verified) return null;
  return normalizeNativeReaction({
    ...verified.payload,
    'message-id': normalizedId,
    'hyperbeam-owner': verified.owner,
  });
}

function reactionListResponse(
  targets: Array<string>,
  myReactions: ReactionListResponse['my_reactions'],
  othersReactions: ReactionListResponse['others_reactions']
): ReactionListResponse {
  const my = { ...myReactions };
  const others = { ...othersReactions };
  targets.forEach((target) => {
    my[target] ||= { like: 0, dislike: 0 };
    others[target] ||= { like: 0, dislike: 0 };
  });
  return { my_reactions: my, others_reactions: others };
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
    'comment-ref': comment?.comment_ref,
    'claim-id': comment?.claim_id,
    state: comment?.state,
    author: comment?.hyperbeam_profile_id || comment?.channel_id,
    parent: comment?.parent_id || 'root',
    'revision-of': comment?.revision_of,
  };
  return Object.entries(selectors).every(([key, expected]) => fields[key] === expected);
}

function paginateNativeComments(params: CommentListParams, native: CommentSource): CommentListResponse {
  const page = positiveInteger(params.page, 1);
  const pageSize = positiveInteger(params.page_size, 10);
  const items = dedupeComments(native.items).sort(commentComparator(params.sort_by));
  const start = (page - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total_items: native.totalItems,
    total_filtered_items: native.totalFilteredItems,
    total_pages: native.totalFilteredItems ? Math.ceil(native.totalFilteredItems / pageSize) : 0,
    has_hidden_comments: native.hasHiddenComments,
  };
}

function nativeCommentSelectors(params: CommentListParams): Record<string, any> | null {
  if (params.claim_id) {
    return {
      schema: 'odysee-comment@1.0',
      type: 'comment',
      'claim-id': params.claim_id,
    };
  }

  if (params.author_claim_id) {
    return {
      schema: 'odysee-comment@1.0',
      type: 'comment',
      author: params.author_claim_id,
    };
  }

  return null;
}

function nativeCommentMessage(params: CommentCreateParams): Record<string, any> {
  const comment = nativeCommentText(params.comment || params.body);
  const target = String(params.target || params.claim_id || '');
  if (!target) throw new Error('Native comment target is required');
  const profile = getHyperbeamAccount();
  if (!profile || !isNativeMessageId(profile.id) || !profile.name.trim()) {
    throw new Error('A valid HyperBEAM account is required to comment');
  }

  return compactParams({
    schema: 'odysee-comment@1.0',
    type: 'comment',
    'comment-ref': nativeMessageVersionRef(),
    target,
    parent: params.parent_id || target,
    state: 'active',
    author: profile?.id,
    body: comment,
    'claim-id': target,
    'parent-id': params.parent_id,
    'profile-id': profile?.id,
    'profile-name': profile?.name,
    'version-ref': nativeMessageVersionRef(),
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

function nativeCommentRevisionMessage(
  root: any,
  current: any,
  params: CommentEditParams,
  operation: 'edit' | 'delete' = 'edit'
): Record<string, any> {
  const comment = operation === 'delete' ? '' : nativeCommentText(params.comment || params.body);
  const updatedAt = Math.floor(Date.now() / 1000);
  return compactParams({
    schema: 'odysee-comment@1.0',
    type: 'comment',
    'comment-ref': root.comment_ref || root.comment_id,
    target: root.claim_id,
    parent: root.parent_id || root.claim_id,
    state: operation === 'delete' ? 'deleted' : 'active',
    author: root.hyperbeam_profile_id,
    body: comment,
    'claim-id': root.claim_id,
    'parent-id': root.parent_id,
    'profile-id': root.hyperbeam_profile_id,
    'profile-name': root.channel_name,
    timestamp: root.timestamp,
    'updated-at': updatedAt,
    'revision-of': root.comment_id,
    'previous-version': current.version_ref || current.hyperbeam_message_id || current.comment_id,
    'version-ref': nativeMessageVersionRef(),
    revision: toNumber(current.revision, 0) + 1,
    'revision-timestamp': Date.now(),
    operation,
    'support-amount': root.support_amount,
    'support-tx-id': root.support_tx_id,
    sticker: root.sticker,
    'mentioned-channels': root.mentioned_channels,
    'is-protected': root.is_protected,
    replies: root.replies,
    'is-pinned': root.is_pinned,
  });
}

function nativeCommentText(raw: any): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Native comment text is required');
  if (raw.length > FF_MAX_CHARS_IN_COMMENT) {
    throw new Error(`Native comments cannot exceed ${FF_MAX_CHARS_IN_COMMENT} characters`);
  }
  return raw;
}

async function fetchNativeCommentById(id: string): Promise<any | null> {
  const comment = await fetchNativeCommentByIdRaw(id);
  if (!comment) return null;
  const projected = await projectNativeCommentCollection([comment]);
  const item = projected.items[0];
  return item && !item.removed && !item.hidden && !item.blocked ? item : null;
}

async function fetchNativeCommentByIdRaw(id: string): Promise<any | null> {
  let direct = await fetchNativeCommentVersionById(id);
  if (!direct) {
    const byReference = await fetchNativeCommentCollection({
      schema: 'odysee-comment@1.0',
      type: 'comment',
      'comment-ref': id,
    });
    direct = byReference.find((comment) => comment.comment_id === id) || null;
  }
  if (!direct) return null;

  const rootId = direct.revision_of || direct.comment_id;
  const comments = await fetchNativeCommentCollection({
    schema: 'odysee-comment@1.0',
    type: 'comment',
    'claim-id': direct.claim_id,
  });
  return comments.find((comment) => comment.comment_id === rootId) || direct;
}

async function fetchNativeCommentRoot(rootId: string): Promise<any | null> {
  const direct = await fetchNativeCommentVersionById(rootId);
  if (direct && !direct.revision_of) return direct;

  const versions = await fetchNativeCommentVersions({
    schema: 'odysee-comment@1.0',
    type: 'comment',
    'comment-ref': rootId,
  });
  return versions.find((comment) => comment.comment_id === rootId && !comment.revision_of) || null;
}

async function fetchNativeCommentVersionById(id: string): Promise<any | null> {
  if (!isNativeMessageId(id)) return null;
  const normalizedId = id.replace(/^\/+/, '');
  const result = await fetchCachedImmutableJsonOrNull(normalizedId);
  const verified = await fetchVerifiedNativeMessage(normalizedId, storePayload(result));
  const payload = verified?.payload;
  if (!payload || !verified) return null;
  const profile = await verifiedNativeCommentProfile(payload, verified.owner);
  const message = {
    ...payload,
    'message-id': normalizedId,
    'comment-id': value(payload, 'comment-id', 'comment_id') || normalizedId,
    'verified-profile-id': profile?.id,
    'verified-profile-name': profile?.name,
  };
  if (!isNativeComment(message)) return null;
  const comment = commentFromHyperbeam(message);
  const activeOwner = await activeHyperbeamAccountOwner();
  return {
    ...comment,
    hyperbeam_owner: verified.owner,
    hyperbeam_committers: verified.committers,
    hyperbeam_commitment_verification: 'verified',
    is_my_comment: Boolean(activeOwner && activeOwner === verified.owner),
  };
}

async function verifiedNativeCommentProfile(payload: any, owner: string): Promise<{ id: string; name: string } | null> {
  const profileId = value(payload, 'profile-id', 'profile_id', 'author');
  const profileName = value(payload, 'profile-name', 'profile_name');
  if (!isNativeMessageId(profileId) || typeof profileName !== 'string' || !profileName.trim()) return null;

  const verified = await fetchVerifiedNativeMessage(String(profileId));
  const storedName = value(verified?.payload || {}, 'name');
  if (
    !verified ||
    verified.owner !== owner ||
    value(verified.payload, 'type') !== 'channel' ||
    typeof storedName !== 'string' ||
    storedName !== profileName
  ) {
    return null;
  }
  return { id: String(profileId), name: storedName };
}

async function activeHyperbeamAccountOwner(): Promise<string | null> {
  const account = getHyperbeamAccount();
  if (!account || !isNativeMessageId(account.id)) return null;
  if (activeAccountOwnerCache?.accountId === account.id && activeAccountOwnerCache.expiresAt > Date.now()) {
    return activeAccountOwnerCache.promise;
  }

  const promise = fetchVerifiedNativeMessage(account.id).then((verified) => {
    if (
      !verified ||
      value(verified.payload, 'type') !== 'channel' ||
      value(verified.payload, 'name') !== account.name
    ) {
      return null;
    }
    return verified.owner;
  });
  activeAccountOwnerCache = {
    accountId: account.id,
    expiresAt: Date.now() + HYPERBEAM_READ_CACHE_MS,
    promise,
  };
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
    const deleted = comment.state === 'deleted' || comment.operation === 'delete';
    if (deleted || projection.removed || projection.hidden || projection.blocked) hasHiddenComments = true;
    return {
      ...comment,
      ...projection,
      removed: deleted || projection.removed,
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
    only: Object.keys(selectors),
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
  if (!isNativeMessageId(id)) return null;
  const normalizedId = id.replace(/^\/+/, '');
  const result = await fetchCachedImmutableJsonOrNull(normalizedId);
  const verified = await fetchVerifiedNativeMessage(normalizedId, storePayload(result));
  if (!verified) return null;
  const control = normalizeNativeCommentControl({
    ...verified.payload,
    'message-id': normalizedId,
    hyperbeam_owner: verified.owner,
    hyperbeam_committers: verified.committers,
    hyperbeam_commitment_verification: 'verified',
  });
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
    control.hyperbeam_message_id &&
    control.hyperbeam_owner &&
    control.hyperbeam_commitment_verification === 'verified'
  );
}

async function authorizeNativeCommentControl(
  control: NativeCommentControl,
  target: string,
  owner: string | null,
  comments: Array<any>
): Promise<boolean> {
  const comment = comments.find((item) => String(item?.comment_id || '') === String(control.comment_id || ''));
  return (
    hasNativeCommentControlAuthority(control, { target, owner, comment }) &&
    hasNativeCommentControlCommitterAuthority(control, { targetOwner: owner, comment })
  );
}

async function nativeCommentTargetOwner(target: string): Promise<string | null> {
  if (!isNativeMessageId(target)) return null;
  const now = Date.now();
  const cached = nativeCommentTargetOwnerCache.get(target);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = fetchVerifiedNativeMessage(target)
    .then((verified) => verified?.owner || null)
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
    'control-ref': nativeMessageVersionRef(),
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
    'event-timestamp': Date.now(),
    'expires-at': params.expiresAt,
    'signature-scope': NATIVE_COMMENT_CONTROL_SIGNATURE_SCOPE,
  });
}

async function writeNativeCommentControl(message: Record<string, any>, label: string): Promise<string> {
  const id = await writeNativeMessage(message, label);
  clearNativeCommentCaches();
  if (!(await fetchNativeCommentControlById(id))) {
    throw new Error(`HyperBEAM native ${label} failed commitment verification`);
  }
  return id;
}

function clearNativeCommentCaches() {
  nativeCommentQueryCache.clear();
  nativeCommentControlQueryCache.clear();
  nativeCommentTargetOwnerCache.clear();
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
    nativeCommentBody(message) !== undefined &&
    typeof value(message, 'target', 'claim-id', 'claim_id') === 'string' &&
    Boolean(nativeCommentId(message))
  );
}

async function fetchPublicQueryJson(body: Record<string, any>): Promise<any> {
  try {
    return await fetchPublicDeviceJson(`${QUERY_DEVICE}/only`, body);
  } catch (error) {
    const status = Number(error?.status);
    const responseBody = String(error?.responseBody || '');
    // No-match responses vary by node build: stock nodes 500 with a
    // `not_found` case_clause, patched nodes 404, and the bare-atom
    // `not_found` store result surfaces as a 400 whose body is "not-found".
    if (
      status === 404 ||
      (status === 400 && responseBody.includes('not-found')) ||
      (status === 500 && responseBody.includes('not_found'))
    ) {
      return [];
    }
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
  if (!current) throw new Error('HyperBEAM native comment is unavailable');

  const rootId = current.revision_of || current.comment_id;
  const root = current.revision_of ? await fetchNativeCommentRoot(rootId) : current;
  if (!root) throw new Error('HyperBEAM native comment root is unavailable');
  if (current.state === 'deleted') throw new Error('A deleted native comment cannot be edited');
  if ((await activeHyperbeamAccountOwner()) !== root.hyperbeam_owner) {
    throw new Error('HyperBEAM native comment must be edited by its original cookie identity');
  }

  const message = nativeCommentRevisionMessage(root, current, params);
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
  if (!comment) throw new Error('HyperBEAM native comment is unavailable');
  const owner = await nativeCommentTargetOwner(comment.claim_id);
  const activeOwner = await activeHyperbeamAccountOwner();
  if (!owner || activeOwner !== owner) throw new Error('Only the content owner can pin this native comment');
  if (comment.parent_id) throw new Error('Only top-level native comments can be pinned');
  const account = getHyperbeamAccount();

  await writeNativeCommentControl(
    nativeCommentControlMessage({
      control: 'pin',
      action: params.remove ? 'unpinned' : 'pinned',
      authority: 'owner',
      target: comment.claim_id,
      owner,
      actor: owner,
      actorName: account?.name || owner,
      commentId: comment.comment_id,
    }),
    params.remove ? 'comment unpin' : 'comment pin'
  );
  return { items: { ...comment, is_pinned: !params.remove } } as unknown as CommentPinResponse;
}

export async function fetchHyperbeamCommentAbandon(
  params: CommentAbandonParams
): Promise<CommentAbandonResponse | null> {
  const current = await fetchNativeCommentByIdRaw(params.comment_id);
  if (!current) throw new Error('HyperBEAM native comment is unavailable');
  const rootId = current.revision_of || current.comment_id;
  const root = current.revision_of ? await fetchNativeCommentRoot(rootId) : current;
  if (!root) throw new Error('HyperBEAM native comment root is unavailable');
  if (current.state === 'deleted') throw new Error('HyperBEAM native comment is already deleted');
  if ((await activeHyperbeamAccountOwner()) !== root.hyperbeam_owner) {
    throw new Error('HyperBEAM native comment must be deleted by its original cookie identity');
  }

  const message = nativeCommentRevisionMessage(root, current, { comment_id: rootId }, 'delete');
  const revisionId = await writeNativeMessage(message, 'comment deletion');
  clearNativeCommentCaches();
  const revision = await fetchNativeCommentVersionById(revisionId);
  if (!revision || !isNextNativeCommentRevision(root, current, revision)) {
    throw new Error('HyperBEAM native comment deletion failed ownership or chain validation');
  }
  return { abandoned: true, claim_id: root.claim_id };
}

export async function fetchHyperbeamReactionReact(params: ReactionReactParams): Promise<ReactionReactResponse | null> {
  const ids = stringList(params.comment_ids);
  const comments = await Promise.all(ids.map(fetchNativeCommentByIdRaw));
  const native = comments.filter(Boolean);
  if (!native.length) throw new Error('No native comments were found for this reaction');

  const legacyIds = ids.filter((_, index) => !comments[index]);
  if (legacyIds.length) throw new Error('Reactions can only target native comments');
  if (params.type === 'like' || params.type === 'dislike') {
    const results = await Promise.all(
      native.map((comment) =>
        writeNativeReaction({
          target: comment.comment_id,
          subject: 'comment',
          reaction: params.type as NativeReactionKind,
          remove: params.remove,
        })
      )
    );
    return { success: true, items: results };
  }
  if (params.type !== 'creator_like') throw new Error('This native reaction type is not implemented');

  const activeOwner = await activeHyperbeamAccountOwner();
  const account = getHyperbeamAccount();
  if (!activeOwner || !account) throw new Error('A HyperBEAM account is required for a creator heart');
  await Promise.all(
    native.map(async (comment) => {
      const owner = await nativeCommentTargetOwner(comment.claim_id);
      if (!owner || activeOwner !== owner) {
        throw new Error('Only the content owner can add a creator heart to this native comment');
      }
      await writeNativeCommentControl(
        nativeCommentControlMessage({
          control: 'creator-like',
          action: params.remove ? 'unliked' : 'liked',
          authority: 'owner',
          target: comment.claim_id,
          owner,
          actor: activeOwner,
          actorName: account.name,
          commentId: comment.comment_id,
        }),
        params.remove ? 'creator heart removal' : 'creator heart'
      );
    })
  );
  return { success: true };
}

export async function fetchHyperbeamSettingGet(_params: SettingsParams): Promise<any | null> {
  return nativeCommentSettings();
}

export async function fetchHyperbeamSettingList(_params: SettingsParams): Promise<any | null> {
  return nativeCommentSettings();
}

export async function fetchHyperbeamSettingUpdate(_params: UpdateSettingsParams): Promise<any | null> {
  throw new Error('Native comment settings updates are not implemented');
}

export async function fetchHyperbeamSettingBlockWord(_params: BlockWordParams): Promise<any | null> {
  throw new Error('Native blocked-word settings are not implemented');
}

export async function fetchHyperbeamSettingUnblockWord(_params: BlockWordParams): Promise<any | null> {
  throw new Error('Native blocked-word settings are not implemented');
}

export async function fetchHyperbeamSettingListBlockedWords(_params: SettingsParams): Promise<any | null> {
  return { blocked_words: [] };
}

function nativeCommentSettings(): Record<string, any> {
  return {
    comments_enabled: true,
    comments_members_only: false,
    livestream_chat_members_only: false,
    min_tip_amount_comment: 0,
    min_tip_amount_super_chat: 0,
    min_usdc_tip_amount_comment: 0,
    min_usdc_tip_amount_super_chat: 0,
  };
}

export async function fetchHyperbeamModerationBlock(_params: ModerationBlockParams): Promise<any | null> {
  throw new Error('Native comment channel blocking is not implemented');
}

export async function fetchHyperbeamModerationUnblock(_params: ModerationBlockParams): Promise<any | null> {
  throw new Error('Native comment channel blocking is not implemented');
}

export async function fetchHyperbeamModerationBlockList(_params: BlockedListArgs): Promise<any | null> {
  return {
    blocked_channels: [],
    globally_blocked_channels: [],
    delegated_blocked_channels: [],
  };
}

export async function fetchHyperbeamModerationAddDelegate(_params: ModerationAddDelegateParams): Promise<any | null> {
  throw new Error('Native comment delegates are not implemented');
}

export async function fetchHyperbeamModerationRemoveDelegate(
  _params: ModerationRemoveDelegateParams
): Promise<any | null> {
  throw new Error('Native comment delegates are not implemented');
}

export async function fetchHyperbeamModerationListDelegates(
  _params: ModerationListDelegatesParams
): Promise<any | null> {
  return { moderators: [] };
}

export async function fetchHyperbeamModerationAmI(_params: ModerationAmIParams): Promise<any | null> {
  return { is_moderator: false, is_admin: false };
}

export async function fetchHyperbeamReactionList(params: ReactionListParams): Promise<ReactionListResponse | null> {
  const ids = stringList(params.comment_ids);
  const [basic, viewerOwner] = await Promise.all([nativeReactionList(ids, 'comment'), activeHyperbeamAccountOwner()]);
  const native = await nativeCreatorHeartReactions(ids, viewerOwner || undefined);
  return {
    my_reactions: mergeReactionCounts(basic.my_reactions, native?.my_reactions),
    others_reactions: mergeReactionCounts(basic.others_reactions, native?.others_reactions),
  };
}

async function nativeCreatorHeartReactions(
  ids: Array<string>,
  viewerOwner?: string
): Promise<(ReactionListResponse & { native_ids: Array<string> }) | null> {
  const comments = (await Promise.all(ids.map(fetchNativeCommentByIdRaw))).filter(Boolean);
  if (!comments.length) return null;
  const projected = await projectNativeCommentCollection(comments);
  const myReactions: Record<string, any> = {};
  const othersReactions: Record<string, any> = {};
  projected.items.forEach((comment) => {
    if (!comment.creator_liked) return;
    const destination = viewerOwner && viewerOwner === comment.native_owner_id ? myReactions : othersReactions;
    destination[comment.comment_id] = { creator_like: 1 };
  });
  return {
    my_reactions: myReactions,
    others_reactions: othersReactions,
    native_ids: comments.map((comment) => comment.comment_id),
  };
}

function mergeReactionCounts(left: any = {}, right: any = {}): Record<string, any> {
  const merged: Record<string, any> = {};
  new Set([...Object.keys(left), ...Object.keys(right)]).forEach((target) => {
    const names = new Set([...Object.keys(left[target] || {}), ...Object.keys(right[target] || {})]);
    merged[target] = {};
    names.forEach((name) => {
      merged[target][name] = toNumber(left[target]?.[name], 0) + toNumber(right[target]?.[name], 0);
    });
  });
  return merged;
}

// The store has no general claim-search surface: targeted claim-id lookups
// resolve through the claim-id/immutable store routes, everything else
// degrades to an empty result set (fuzzy search goes through `~search@1.0`
// at the Redux layer).
export async function fetchHyperbeamSearch(params: ClaimSearchOptions): Promise<ClaimSearchResponse | null> {
  const claimIds = paramValues(params, 'claim_ids', 'claim-ids', 'claim_id', 'claim-id');
  if (claimIds.length) return fetchHyperbeamResolveClaimIds({ ...params, claim_ids: claimIds });

  const channelIds = paramValues(params, 'channel_ids', 'channel-ids', 'channel_id', 'channel-id');
  if (channelIds.length) return fetchHyperbeamSourceClaimSearch({ ...params, channel_ids: channelIds });

  const pageSize = toNumber(params.page_size, 20);
  return {
    items: [],
    page: toNumber(params.page, 1),
    page_size: pageSize,
    total_items: 0,
    total_pages: 0,
  };
}

export async function fetchSearchIds(query: string, limit: number): Promise<Array<string>> {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];
  const response = await fetchSearchDeviceJson(`${SEARCH_DEVICE}/query`, {
    q: trimmed,
    limit: Math.max(1, Math.min(SEARCH_MAX_LIMIT, toNumber(limit, 20))),
  });
  const ids = await searchResultIds(responsePayload(response));
  return ids.map(String).filter(Boolean);
}

async function searchResultIds(result: any): Promise<Array<any>> {
  if (Array.isArray(result)) return result.map(searchHitId).filter(Boolean);
  if (!isObject(result)) return [];
  if (Array.isArray(result.ids)) return result.ids;
  const inline = searchIndexedValues(result.ids);
  if (inline.length) return inline;
  const rootIndexed = searchIndexedValues(result);
  if (rootIndexed.length) return rootIndexed.map(searchHitId).filter(Boolean);
  const link = value(result, 'ids+link', 'ids-link');
  if (typeof link !== 'string' || !link) return [];
  const linked = responsePayload(await fetchSearchDeviceJson(`${CACHE_DEVICE}/read`, { read: link }));
  const linkedIds = Array.isArray(linked) ? linked : searchIndexedValues(linked);
  return linkedIds.map(searchHitId).filter(Boolean);
}

function searchHitId(hit: any): string | null {
  if (typeof hit === 'string') return hit;
  if (!isObject(hit)) return null;
  const id = value(hit, 'message+link', 'message-link', 'message', 'id');
  return typeof id === 'string' && id ? id : null;
}

async function fetchSearchDeviceJson(path: string, body: Record<string, any>): Promise<any> {
  if (isServedFromManifest()) return fetchPublicDeviceJson(path, body);
  const response = await fetch(`${HYPERBEAM_PUBLIC_DEVICE_PROXY_BASE}/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
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

function searchIndexedValues(source: any): Array<any> {
  if (!isObject(source)) return [];
  return Object.keys(source)
    .filter((key) => /^[1-9]\d*$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => source[key]);
}

async function fetchHyperbeamSourceClaimSearch(params: ClaimSearchOptions): Promise<ClaimSearchResponse> {
  const page = Math.max(1, toNumber(params.page, 1));
  const pageSize = Math.max(1, toNumber(params.page_size, 20));
  const query = sourceClaimQuery({ ...params, page, page_size: pageSize });
  const response = await fetchStoreJsonOrNull(storePath('odysee/source-claims', JSON.stringify(query)));
  const locators = paramValues(response, 'locators');
  const claims = (
    await Promise.all(locators.map((locator) => resolveImmutableClaimById(locator).catch(() => null)))
  ).filter(Boolean) as Array<Claim>;

  const hasNextPage = locators.length === pageSize;
  const discoveredItems = (page - 1) * pageSize + claims.length;
  return {
    items: claims,
    page,
    page_size: pageSize,
    total_items: discoveredItems + (hasNextPage ? 1 : 0),
    total_pages: hasNextPage ? page + 1 : page,
  };
}

function sourceClaimQuery(params: ClaimSearchOptions): Record<string, any> {
  const supportedKeys = [
    'channel_ids',
    'claim_ids',
    'not_channel_ids',
    'claim_type',
    'any_tags',
    'order_by',
    'any_languages',
    'page',
    'page_size',
    'limit_claims_per_channel',
    'duration',
    'timestamp',
    'release_time',
    'exclude_shorts',
  ];

  return Object.fromEntries(
    supportedKeys
      .map((key) => [key, value(params, key, key.replaceAll('_', '-'))])
      .filter(([, item]) => item !== undefined && item !== null && item !== '')
  );
}

// List the node's native uploads as claims, for the "your uploads" page. The
// match-index holds every `odysee-upload@1.0' record; each record-id resolves
// to a claim through the immutable-id route.
export async function fetchHyperbeamUploads(params: any): Promise<any | null> {
  const page = toNumber(params?.page, 1);
  const pageSize = toNumber(params?.page_size, 20);
  const claimType = paramValues(params, 'claim_type', 'claim-type');
  if (claimType.length && !claimType.includes('stream')) {
    return { items: [], page, page_size: pageSize, total_items: 0, total_pages: 0 };
  }

  const request = nativeQueryRequest({ schema: NATIVE_UPLOAD_SCHEMA });
  const recordIds = uniquePaths(queryPaths(await fetchPublicQueryJson(request)));
  const claims = (await Promise.all(recordIds.map((id) => resolveImmutableClaimById(id).catch(() => null)))).filter(
    Boolean
  );

  const start = (page - 1) * pageSize;
  return {
    items: claims.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total_items: claims.length,
    total_pages: Math.max(1, Math.ceil(claims.length / pageSize)),
  };
}

export async function fetchHyperbeamClaimsByIds(ids: Array<string>): Promise<Array<Claim>> {
  const claims = await Promise.all(ids.filter(Boolean).map(fetchStoreClaimByAnyId));
  return claims.flat().filter(Boolean);
}

async function fetchStoreClaimByAnyId(id: string): Promise<Array<Claim>> {
  if (isNativeMessageId(id)) {
    const playlist = await fetchHyperbeamPlaylistById(id).catch(() => null);
    if (playlist) return [playlist];
  }
  if (isClaimId(id)) {
    const claim = await fetchStoreClaimById(id).catch(() => null);
    return claim ? [claim] : [];
  }
  if (!isOutpointId(id) && !isStandaloneImmutableId(id)) return [];
  const claims = await fetchHyperbeamImmutableClaim(id);
  if (claims.length) return claims;
  // Native upload records serve their media bytes at `GET /<id>` with the
  // claim fields in headers, so the JSON-body read above yields nothing.
  // Fall back to the headers-aware immutable-route builder.
  const nativeClaim = await resolveImmutableClaimById(id).catch(() => null);
  return nativeClaim ? [nativeClaim] : [];
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
  const needsCover = Boolean(
    existingValue &&
    !existingValue.cover &&
    (value(existingValue, 'cover+link', 'cover-link') || value(claim, 'value+link', 'value-link'))
  );
  if (
    !needsHyperbeam &&
    !needsValue &&
    !needsMeta &&
    !needsSigningChannel &&
    !needsSource &&
    !needsThumbnail &&
    !needsCover
  )
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
  const cover =
    claimValue && !claimValue.cover && value(claimValue, 'cover+link', 'cover-link')
      ? await fetchHyperbeamImmutableSubmessage(baseUrl, claimId, 'value/cover')
      : null;
  const expandedValue = claimValue
    ? {
        ...claimValue,
        ...(source ? { source } : {}),
        ...(thumbnail ? { thumbnail } : {}),
        ...(cover ? { cover } : {}),
      }
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
  _params: VerifyClaimSignatureParams
): Promise<VerifyClaimSignatureResponse | null> {
  return { is_valid: false };
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
  return resolveHyperbeamNodeBase({
    manifestOrigin: typeof window !== 'undefined' && isServedFromManifest() ? window.location.origin : '',
    baseUrl: HYPERBEAM_BASE_URL,
    nodeApi: ODYSEE_HYPERBEAM_NODE_API,
  });
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
  const target = value(comment, 'target', 'claim-id', 'claim_id');
  const rawParentId = value(comment, 'parent-id', 'parent_id', 'parent');
  const parentId = rawParentId === target ? undefined : rawParentId;
  const profileId = value(comment, 'verified-profile-id', 'verified_profile_id');
  const profileName = value(comment, 'verified-profile-name', 'verified_profile_name');
  const channelId = profileId || value(comment, 'channel-id', 'channel_id');
  const channelName = profileName || value(comment, 'channel-name', 'channel_name');
  const channelUrl = commentChannelUrl(comment);
  const commentRef = value(comment, 'comment-ref', 'comment_ref');
  const revisionOf = value(comment, 'revision-of', 'revision_of');
  const revision = value(comment, 'revision');
  const revisionTimestamp = value(comment, 'revision-timestamp', 'revision_timestamp');
  const operation = value(comment, 'operation');
  const state = value(comment, 'state');
  const body = nativeCommentBody(comment);
  return compactParams({
    ...comment.source,
    schema: value(comment, 'schema'),
    type: value(comment, 'type'),
    comment_id: revisionOf || commentRef || value(comment, 'comment-id', 'comment_id', 'id'),
    comment_ref: commentRef,
    hyperbeam_message_id: value(comment, 'message-id', 'message_id', 'comment-id', 'comment_id', 'id'),
    revision_of: revisionOf,
    previous_version: value(comment, 'previous-version', 'previous_version'),
    version_ref: value(comment, 'version-ref', 'version_ref'),
    revision: revision === undefined || revision === null ? undefined : toNumber(revision, 0),
    revision_timestamp:
      revisionTimestamp === undefined || revisionTimestamp === null ? undefined : toNumber(revisionTimestamp, 0),
    operation,
    state,
    // Normalize an omitted zero-length tombstone body back to the authored
    // empty string. This keeps transport encoding details out of revision
    // validation and projection.
    comment: body,
    claim_id: target,
    parent_id: parentId === 'root' ? undefined : parentId,
    channel_id: channelId,
    channel_name: channelName,
    channel_url: channelUrl,
    hyperbeam_profile_id: profileId,
    timestamp: toNumber(value(comment, 'timestamp', 'created_at'), 0),
    updated_at: value(comment, 'updated-at', 'updated_at'),
    signature: value(comment, 'channel-signature'),
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
  // Evidence messages carry the raw claim protobuf hex under `claim`; only a
  // nested claim *object* is a claim to map, a string is source bytes.
  const claim = responsePayload(isObject(result.claim) ? result.claim : result);
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
  const claimsInChannel = meta.claims_in_channel ?? meta['claims-in-channel'];
  return {
    activation_height: meta.activation_height ?? meta['activation-height'] ?? 0,
    ...(claimsInChannel !== undefined ? { claims_in_channel: claimsInChannel } : {}),
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
  const cover = value(channel, 'cover') || channelValue.cover;
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
      cover: typeof cover === 'string' ? { url: cover } : cover,
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
  const values = Array.isArray(source) ? source : source ? [source] : [];
  return values
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
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

async function fetchHyperbeamImmutableResolve(uri: string, immutableSigningChannelId?: string): Promise<any | null> {
  const immutableId = immutableRouteIdFromUri(uri);
  if (!immutableId) return null;

  // A token route (lbry://out_.../immutable_...) has no real claim name to
  // compare against; only enforce the name when the uri carries one.
  let name;
  try {
    const parsed = parseURI(uri);
    name = parsed.streamName || parsed.claimName;
  } catch {}
  if (name && immutableIdFromRouteToken(String(name))) name = undefined;
  return resolveImmutableClaimById(immutableId, name, immutableSigningChannelId);
}

// Read a record by its immutable/store id and build a claim. Shared by the
// immutable-id route and the upload name bridge.
async function resolveImmutableClaimById(
  immutableId: string,
  name?: string,
  immutableSigningChannelId?: string
): Promise<any | null> {
  const result = await fetchCachedImmutableJsonOrNull(immutableId).then(responsePayload);
  const decodedClaim = decodeClaimMetadata(storePayload(result));
  const signingChannelId = immutableSigningChannelId || decodedClaim?.signedChannelId;
  const signingChannel = signingChannelId
    ? await fetchCachedImmutableChannelJsonOrNull(signingChannelId)
        .then(responsePayload)
        .catch(() => null)
    : null;
  const claim = immutableClaimFromHyperbeam(result, immutableId, signingChannel, decodedClaim, name, signingChannelId);
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

export async function fetchVerifiedNativeMessage<T extends Record<string, any> = Record<string, any>>(
  messageId: string,
  knownPayload?: T | null
): Promise<VerifiedNativeMessage<T> | null> {
  return verifyNativeMessage<T>(
    messageId,
    {
      loadPayload: async (id) => storePayload(await fetchImmutableJsonOrNull(id)) as T | null,
      verifyCommitment: fetchNativeMessageCommitmentVerification,
      loadCommitter: fetchNativeMessageCommitter,
    },
    knownPayload
  );
}

async function fetchNativeMessageCommitmentVerification(messageId: string): Promise<boolean> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) return false;

  try {
    const encodedId = encodeURIComponent(messageId);
    const response = await fetch(`${baseUrl}/${encodedId}/verify?commitment-ids=${encodedId}`, {
      method: 'GET',
      credentials: hyperbeamFetchCredentials(baseUrl),
      headers: { accept: 'application/json' },
      signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const parsed = parseDeviceJson(await response.text());
    const result = isObject(parsed) ? value(parsed, 'body', 'result', 'value') : parsed;
    return (
      result === true ||
      String(result || '')
        .trim()
        .toLowerCase() === 'true'
    );
  } catch {
    return false;
  }
}

async function fetchNativeMessageCommitter(messageId: string): Promise<string | null> {
  const baseUrl = hyperbeamBaseUrl();
  if (!baseUrl) return null;

  try {
    const encodedId = encodeURIComponent(messageId);
    // Bind authority to the exact verified commitment named by the query
    // path. `/<id>/committers/1` is shorter, but byte-identical messages may
    // be co-signed and share a stored content group; selecting the first
    // group committer could then attribute a record to the wrong owner.
    const response = await fetch(`${baseUrl}/${encodedId}/commitments/${encodedId}/committer`, {
      method: 'GET',
      credentials: hyperbeamFetchCredentials(baseUrl),
      headers: { accept: 'application/json' },
      signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await response.text();
    const parsed = parseDeviceJson(text);
    const committer =
      (isObject(parsed) && value(parsed, 'committer', 'owner', 'body')) || (typeof parsed === 'string' ? parsed : text);
    const normalized = String(committer || '')
      .replace(/^"|"$/g, '')
      .trim();
    return normalized && normalized.length <= 1024 ? normalized : null;
  } catch {
    return null;
  }
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
  fallbackName?: string,
  immutableSigningChannelId?: string
): any | null {
  const payload = storePayload(result);
  if (!payload) return null;

  const immutableOutpoint = outpointParts(immutableId);
  const claimMetadata = decodedClaim || decodeClaimMetadata(payload);
  const decodedValue: Record<string, any> = claimMetadata?.value || {};
  const decodedSource: Record<string, any> = isObject(decodedValue.source) ? decodedValue.source : {};
  const channelPayload = storePayload(channelResult);
  const channelClaim0 = channelPayload
    ? normalizeHyperbeamChannelClaim(sdkClaimFromHyperbeam(channelPayload) || channelPayload)
    : null;
  const channelImmutableId =
    immutableSigningChannelId || value(channelClaim0, 'immutable_id', 'immutable-id', 'outpoint');
  const channelImmutableUri = immutableUri(channelImmutableId);
  const channelClaim =
    channelClaim0 && channelImmutableId
      ? {
          ...channelClaim0,
          immutable_id: channelImmutableId,
          canonical_url: channelImmutableUri || channelClaim0.canonical_url,
          permanent_url: channelImmutableUri || channelClaim0.permanent_url,
          short_url: channelImmutableUri || channelClaim0.short_url,
          hyperbeam: {
            ...(isObject(channelClaim0.hyperbeam) ? channelClaim0.hyperbeam : {}),
            immutable_id: channelImmutableId,
            'immutable-id': channelImmutableId,
          },
        }
      : channelClaim0;
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
  const isChannelEvidence = Boolean(
    value(payload, 'channel-id', 'channel_id') || value(payload, 'public-key', 'public_key')
  );
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
  const immutableCanonicalUrl = immutableUri(storeId);
  const canonicalUrl =
    immutableCanonicalUrl ||
    value(claim, 'canonical_url', 'canonical-url') ||
    value(payload, 'canonical_url', 'canonical-url') ||
    claimUrl(name, routeClaimId);
  const permanentUrl =
    immutableCanonicalUrl ||
    value(claim, 'permanent_url', 'permanent-url') ||
    value(payload, 'permanent_url', 'permanent-url') ||
    claimUrl(name, routeClaimId);
  const valueType =
    value(claim, 'value_type', 'value-type') ||
    value(payload, 'value_type', 'value-type') ||
    (isChannelEvidence || device === 'lbry-channel@1.0' || device === 'odysee-channel@1.0' ? 'channel' : 'stream');
  const sourceName =
    value(payloadSource, 'name') ||
    value(valueSource, 'name') ||
    value(decodedSource, 'name') ||
    value(payload, 'filename') ||
    (mediaType === 'video/mp4' ? `${name}.mp4` : undefined);
  const signingChannel =
    channelClaim &&
    (!claimMetadata?.signedChannelId || value(channelClaim, 'claim_id', 'claim-id') === claimMetadata.signedChannelId)
      ? channelClaim
      : undefined;

  return compactParams({
    ...claim,
    claim_id: frontendClaimId,
    immutable_id: String(storeId),
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
      cover: thumbnailObject(
        value(existingValue, 'cover') || value(payload, 'cover') || value(decodedValue, 'cover'),
        '',
        undefined
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

  // JSON is preferred for browser hydration because cross-origin credentialed
  // requests cannot rely on wildcard-exposed custom response headers. The
  // node response still includes the evidence bytes and commitments. Native
  // multipart remains available to callers that explicitly request it.
  const url = `${buildDeviceUrl(baseUrl, path)}${path.includes('?') ? '&' : '?'}accept-bundle=true`;
  try {
    const response = await fetch(url, {
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
    if (!name) {
      // Flat messages with a scalar root body (comments are the important
      // example) encode it as an unnamed `content-disposition: inline` part.
      // Dropping this part makes the message verify but strips its content on
      // a cold read, so a newly-created comment disappears after refresh.
      if (separator !== -1 && /content-disposition:\s*inline/i.test(rawHeaders)) {
        const partBody = segment.slice(separator + 4).replace(/\r\n$/, '');
        result.body = latin1ToUtf8(partBody);
      }
      continue;
    }
    if (isBundleHousekeepingPart(name)) continue;

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
  const envelopeChannelId = isObject(envelope)
    ? value(envelope, 'channel-id', 'channel_id', 'signing-channel-id', 'signing_channel_id')
    : undefined;

  const claimHex = value(payload, 'claim', 'claim-envelope', 'claim_envelope', 'claim-value-hex', 'claim_value_hex');
  const bytes = hexToBytes(claimHex) || base64UrlToBytes(claimHex);
  if (!bytes) return isClaimId(envelopeChannelId) ? { signedChannelId: String(envelopeChannelId) } : null;

  try {
    const decodedEnvelope = claimEnvelope(bytes);
    return {
      signedChannelId:
        decodedEnvelope.signedChannelId || (isClaimId(envelopeChannelId) ? String(envelopeChannelId) : undefined),
      value: decodeLegacyChannelMetadata(decodedEnvelope.message),
    };
  } catch {
    return null;
  }
}

function decodeLegacyChannelMetadata(claim: Uint8Array): Record<string, any> | undefined {
  const channel = protoLengthField(claim, 2);
  if (!channel) return undefined;

  const title = protoStringField(claim, 8);
  const description = protoStringField(claim, 9);
  const thumbnail = protoImageField(claim, 10);
  const cover = protoImageField(channel, 4);
  return compactParams({
    title,
    description,
    thumbnail: thumbnail ? { url: thumbnail } : undefined,
    cover: cover ? { url: cover } : undefined,
  });
}

function protoImageField(message: Uint8Array, fieldNumber: number): string | undefined {
  const image = protoLengthField(message, fieldNumber);
  return image ? protoStringField(image, 5) || protoStringField(image, 1) : undefined;
}

function protoStringField(message: Uint8Array, fieldNumber: number): string | undefined {
  const bytes = protoLengthField(message, fieldNumber);
  return bytes ? new TextDecoder().decode(bytes) : undefined;
}

function protoLengthField(message: Uint8Array, fieldNumber: number): Uint8Array | undefined {
  let offset = 0;
  while (offset < message.length) {
    const key = readProtoVarint(message, offset);
    if (!key) return undefined;
    offset = key.offset;
    const number = key.value >>> 3;
    const wireType = key.value & 7;
    if (wireType === 0) {
      const item = readProtoVarint(message, offset);
      if (!item) return undefined;
      offset = item.offset;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 2) {
      const size = readProtoVarint(message, offset);
      if (!size || size.offset + size.value > message.length) return undefined;
      const bytes = message.slice(size.offset, size.offset + size.value);
      if (number === fieldNumber) return bytes;
      offset = size.offset + size.value;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      return undefined;
    }
  }
  return undefined;
}

function readProtoVarint(message: Uint8Array, start: number): { value: number; offset: number } | undefined {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < message.length && shift < 35) {
    const byte = message[offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
  }
  return undefined;
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

function base64UrlToBytes(value: any): Uint8Array | null {
  if (typeof value !== 'string' || !/^[0-9A-Za-z_-]+$/.test(value)) return null;
  try {
    const padded = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const decoded = atob(padded);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
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

function immutableUri(id: any): string | undefined {
  const text = String(id || '');
  const outpoint = text.match(/^([0-9a-f]{64}):([0-9]+)$/i);
  if (outpoint) return `lbry://out_${outpoint[1]}_${outpoint[2]}`;
  return isStandaloneImmutableId(text) ? `lbry://immutable_${text}` : undefined;
}

function immutableRouteIdFromUri(uri: string): string | null {
  // The /$/id/ web routes put the immutable token in name position
  // (lbry://out_<txid>_<nout>, lbry://immutable_<id>); accept those before
  // parseURI, which only models the token as a claim-id modifier.
  const nameToken = immutableIdFromRouteToken(
    String(uri)
      .replace(/^lbry:\/\//, '')
      .split('/')
      .pop() || ''
  );
  if (nameToken) return nameToken;

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

function immutableIdFromRouteToken(token: string): string | null {
  const outpoint = token.match(/^out_([0-9a-f]{64})_([0-9]+)$/i);
  if (outpoint) return `${outpoint[1]}:${outpoint[2]}`;
  const immutable = token.match(/^immutable_([0-9A-Za-z_-]{41,128})$/);
  if (immutable) return immutable[1];
  return null;
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
    const stream = await fetchStoreJsonOrNull(storePath('odysee/stream-id', id));
    if (stream) return stream;
    return fetchStoreJsonOrNull(storePath('odysee/outpoint', id));
  }
  if (!isStandaloneImmutableId(id)) return null;
  return fetchStoreJsonOrNull(encodeDataPath(id));
}

function fetchCachedImmutableChannelJsonOrNull(id: string): Promise<any | null> {
  const key = `immutable-channel:${id}`;
  const now = Date.now();
  const cached = storeReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (
    isOutpointId(id) || isStandaloneImmutableId(id)
      ? fetchStoreJsonOrNull(encodeDataPath(id))
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
