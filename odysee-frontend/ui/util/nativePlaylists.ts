export const NATIVE_PLAYLIST_SCHEMA = 'odysee-playlist@1.0';
export const NATIVE_PLAYLIST_TYPE = 'playlist';
export const NATIVE_PLAYLIST_SIGNATURE_SCOPE = 'native-playlist-v1';

export const NATIVE_PLAYLIST_MAX_ITEMS = 1000;
export const NATIVE_PLAYLIST_MAX_TITLE_LENGTH = 200;
export const NATIVE_PLAYLIST_MAX_DESCRIPTION_LENGTH = 5000;

const MAX_ITEMS_JSON_BYTES = 256 * 1024;
const MAX_THUMBNAIL_LENGTH = 4096;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 100;
const MAX_LANGUAGES = 20;
const MAX_LANGUAGE_LENGTH = 32;

export type NativePlaylistState = 'active' | 'deleted';
export type NativePlaylistOperation = 'create' | 'update' | 'delete';

export type NativePlaylist = {
  schema: string;
  type: string;
  playlist_ref: string;
  profile_id: string;
  profile_name?: string;
  title: string;
  description?: string;
  thumbnail_url?: string;
  tags: Array<string>;
  languages: Array<string>;
  items: Array<string>;
  item_count: number;
  state: NativePlaylistState;
  operation: NativePlaylistOperation;
  revision: number;
  version_ref: string;
  revision_of?: string;
  previous_version?: string;
  created_at: number;
  updated_at: number;
  signature_scope: string;
  message_id: string;
  owner: string;
  [key: string]: any;
};

export function normalizeNativePlaylist(source: any): NativePlaylist | null {
  const itemsJson = field(source, 'items-json', 'items_json');
  const items = stringArray(itemsJson === undefined ? field(source, 'items') : parseJsonArray(itemsJson));
  const tags = serializedStringArray(field(source, 'tags-json', 'tags_json', 'tags'));
  const languages = serializedStringArray(field(source, 'languages-json', 'languages_json', 'languages'));
  if (!items || !tags || !languages) return null;

  const normalized = {
    ...source,
    schema: String(field(source, 'schema') || ''),
    type: String(field(source, 'type') || ''),
    playlist_ref: String(field(source, 'playlist-ref', 'playlist_ref') || ''),
    profile_id: String(field(source, 'profile-id', 'profile_id') || ''),
    profile_name: optionalString(field(source, 'profile-name', 'profile_name')),
    title: String(field(source, 'title') || ''),
    description: optionalString(field(source, 'description')),
    thumbnail_url: optionalString(field(source, 'thumbnail-url', 'thumbnail_url')),
    tags,
    languages,
    items,
    item_count: integer(field(source, 'item-count', 'item_count'), -1),
    state: String(field(source, 'state') || ''),
    operation: String(field(source, 'operation') || ''),
    revision: integer(field(source, 'revision'), -1),
    version_ref: String(field(source, 'version-ref', 'version_ref') || ''),
    revision_of: optionalString(field(source, 'revision-of', 'revision_of')),
    previous_version: optionalString(field(source, 'previous-version', 'previous_version')),
    created_at: integer(field(source, 'created-at', 'created_at'), 0),
    updated_at: integer(field(source, 'updated-at', 'updated_at'), 0),
    signature_scope: String(field(source, 'signature-scope', 'signature_scope') || ''),
    message_id: String(field(source, 'message-id', 'message_id', 'hyperbeam_message_id') || '').replace(/^\/+/, ''),
    owner: String(field(source, 'hyperbeam-owner', 'hyperbeam_owner', 'owner') || ''),
  } as NativePlaylist;

  return isValidNativePlaylist(normalized) ? normalized : null;
}

export function isValidNativePlaylist(playlist: NativePlaylist): boolean {
  const rootIsValid =
    !playlist.revision_of &&
    !playlist.previous_version &&
    playlist.revision === 0 &&
    playlist.operation === 'create' &&
    playlist.state === 'active';
  const revisionIsValid =
    playlist.revision > 0 &&
    playlist.revision_of === playlist.playlist_ref &&
    validReference(playlist.previous_version || '') &&
    ((playlist.operation === 'update' && playlist.state === 'active') ||
      (playlist.operation === 'delete' && playlist.state === 'deleted'));

  return Boolean(
    playlist.schema === NATIVE_PLAYLIST_SCHEMA &&
    playlist.type === NATIVE_PLAYLIST_TYPE &&
    playlist.signature_scope === NATIVE_PLAYLIST_SIGNATURE_SCOPE &&
    validPlaylistRef(playlist.playlist_ref, playlist.owner) &&
    validReference(playlist.version_ref) &&
    isNativeMessageId(playlist.profile_id) &&
    (!playlist.profile_name || boundedText(playlist.profile_name, 200)) &&
    boundedText(playlist.title, NATIVE_PLAYLIST_MAX_TITLE_LENGTH) &&
    boundedOptionalText(playlist.description, NATIVE_PLAYLIST_MAX_DESCRIPTION_LENGTH, true) &&
    validThumbnailUrl(playlist.thumbnail_url) &&
    validStringList(playlist.tags, MAX_TAGS, MAX_TAG_LENGTH) &&
    validStringList(playlist.languages, MAX_LANGUAGES, MAX_LANGUAGE_LENGTH) &&
    validPlaylistItems(playlist.items) &&
    playlist.item_count === playlist.items.length &&
    playlist.created_at > 0 &&
    playlist.updated_at >= playlist.created_at &&
    isNativeMessageId(playlist.message_id) &&
    (rootIsValid || revisionIsValid)
  );
}

export function isNextNativePlaylistRevision(
  root: NativePlaylist,
  current: NativePlaylist,
  candidate: NativePlaylist
): boolean {
  return Boolean(
    !root.revision_of &&
    current.state === 'active' &&
    candidate.owner === root.owner &&
    candidate.playlist_ref === root.playlist_ref &&
    candidate.revision_of === root.playlist_ref &&
    candidate.previous_version === current.version_ref &&
    candidate.revision === current.revision + 1 &&
    candidate.profile_id === root.profile_id &&
    candidate.created_at === root.created_at &&
    candidate.updated_at >= current.updated_at
  );
}

export function collapseNativePlaylistStates(playlists: Array<NativePlaylist>): Array<NativePlaylist> {
  const valid = playlists.filter(isValidNativePlaylist);
  const conflictingRefs = conflictingPlaylistRefs(valid);
  const unique = uniqueSemanticVersions(valid);
  const byPlaylistRef = new Map<string, Array<NativePlaylist>>();

  unique.forEach((playlist) => {
    const versions = byPlaylistRef.get(playlist.playlist_ref) || [];
    versions.push(playlist);
    byPlaylistRef.set(playlist.playlist_ref, versions);
  });

  const current: Array<NativePlaylist> = [];
  byPlaylistRef.forEach((versions) => {
    if (conflictingRefs.has(versions[0].playlist_ref)) return;
    const roots = versions.filter((playlist) => !playlist.revision_of);
    if (roots.length !== 1) return;
    current.push(
      latestRevision(
        roots[0],
        versions.filter((playlist) => Boolean(playlist.revision_of))
      )
    );
  });

  return current.sort(comparePlaylistHeads);
}

export function activeNativePlaylists(playlists: Array<NativePlaylist>): Array<NativePlaylist> {
  return collapseNativePlaylistStates(playlists).filter((playlist) => playlist.state === 'active');
}

export function nativePlaylistOwner(playlistRef: string): string | null {
  const separator = playlistRef.indexOf('.');
  if (separator <= 0) return null;
  const owner = playlistRef.slice(0, separator);
  return isNativeMessageId(owner) ? owner : null;
}

export function validNativePlaylistItem(item: string): boolean {
  return isNativeMessageId(item) || /^[0-9a-fA-F]{64}:\d+$/.test(item);
}

export function nativePlaylistItemsJson(items: Array<string>): string {
  if (!validPlaylistItems(items)) throw new Error('Playlist contains an invalid immutable item locator');
  return JSON.stringify(items);
}

function latestRevision(root: NativePlaylist, revisions: Array<NativePlaylist>): NativePlaylist {
  let current = root;
  while (true) {
    const candidates = revisions.filter((candidate) => isNextNativePlaylistRevision(root, current, candidate));
    if (!candidates.length) return current;
    if (candidates.length > 1) return current;
    current = candidates[0];
  }
}

function uniqueSemanticVersions(playlists: Array<NativePlaylist>): Array<NativePlaylist> {
  const byVersion = new Map<string, NativePlaylist>();
  playlists.forEach((playlist) => {
    const identity = `${playlist.owner}\u0000${playlist.playlist_ref}\u0000${playlist.version_ref}`;
    const existing = byVersion.get(identity);
    if (!existing || playlist.message_id.localeCompare(existing.message_id) < 0) byVersion.set(identity, playlist);
  });
  return Array.from(byVersion.values());
}

function conflictingPlaylistRefs(playlists: Array<NativePlaylist>): Set<string> {
  const semanticByVersion = new Map<string, string>();
  const conflicts = new Set<string>();
  playlists.forEach((playlist) => {
    const identity = `${playlist.owner}\u0000${playlist.playlist_ref}\u0000${playlist.version_ref}`;
    const semantic = JSON.stringify({
      profile_id: playlist.profile_id,
      profile_name: playlist.profile_name,
      title: playlist.title,
      description: playlist.description,
      thumbnail_url: playlist.thumbnail_url,
      tags: playlist.tags,
      languages: playlist.languages,
      items: playlist.items,
      state: playlist.state,
      operation: playlist.operation,
      revision: playlist.revision,
      revision_of: playlist.revision_of,
      previous_version: playlist.previous_version,
      created_at: playlist.created_at,
      updated_at: playlist.updated_at,
    });
    const existing = semanticByVersion.get(identity);
    if (existing !== undefined && existing !== semantic) conflicts.add(playlist.playlist_ref);
    semanticByVersion.set(identity, semantic);
  });
  return conflicts;
}

function comparePlaylistHeads(left: NativePlaylist, right: NativePlaylist): number {
  const updatedDifference = right.updated_at - left.updated_at;
  if (updatedDifference) return updatedDifference;
  return left.playlist_ref.localeCompare(right.playlist_ref);
}

function validPlaylistRef(playlistRef: string, owner: string): boolean {
  const prefix = nativePlaylistOwner(playlistRef);
  if (!prefix || prefix !== owner) return false;
  const suffix = playlistRef.slice(prefix.length + 1);
  return /^[0-9A-Za-z_-]{16,64}$/.test(suffix) && playlistRef.length <= 193;
}

function validPlaylistItems(items: Array<string>): boolean {
  if (items.length > NATIVE_PLAYLIST_MAX_ITEMS || new Set(items).size !== items.length) return false;
  if (items.some((item) => !validNativePlaylistItem(item))) return false;
  return new TextEncoder().encode(JSON.stringify(items)).length <= MAX_ITEMS_JSON_BYTES;
}

function validStringList(values: Array<string>, maxItems: number, maxLength: number): boolean {
  return values.length <= maxItems && values.every((value) => boundedText(value, maxLength));
}

function boundedText(value: string, maxLength: number): boolean {
  return value.trim().length > 0 && value.length <= maxLength && !hasControlCharacters(value);
}

function boundedOptionalText(value: string | undefined, maxLength: number, allowFormatting = false): boolean {
  return (
    value === undefined ||
    (value.length <= maxLength && !(allowFormatting ? hasUnsafeControlCharacters(value) : hasControlCharacters(value)))
  );
}

function validThumbnailUrl(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (!boundedOptionalText(value, MAX_THUMBNAIL_LENGTH) || !value) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validReference(reference: string): boolean {
  return reference.length >= 16 && reference.length <= 193 && !hasControlCharacters(reference);
}

function hasControlCharacters(source: string): boolean {
  return Array.from(source).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function hasUnsafeControlCharacters(source: string): boolean {
  return Array.from(source).some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
}

function serializedStringArray(source: any): Array<string> | null {
  return stringArray(typeof source === 'string' ? parseJsonArray(source) : source || []);
}

function parseJsonArray(source: any): any {
  if (typeof source !== 'string' || source.length > MAX_ITEMS_JSON_BYTES) return null;
  try {
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringArray(source: any): Array<string> | null {
  return Array.isArray(source) && source.every((value) => typeof value === 'string') ? source : null;
}

function field(source: any, ...keys: Array<string>): any {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
  }
}

function optionalString(source: any): string | undefined {
  return typeof source === 'string' && source ? source : undefined;
}

function integer(source: any, fallback: number): number {
  const parsed = Math.floor(Number(source));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isNativeMessageId(messageId: any): boolean {
  return /^[0-9A-Za-z_-]{41,128}$/.test(String(messageId || ''));
}
