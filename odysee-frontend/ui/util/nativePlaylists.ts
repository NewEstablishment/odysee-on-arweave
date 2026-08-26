import {
  boundedText,
  field,
  hasControlCharacters,
  hasUnsafeControlCharacters,
  integer,
  isNativeMessageId,
  normalizeMessageId,
  optionalString,
} from './nativeMessageFields.ts';

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

export type NativePlaylist = {
  schema: string;
  type: string;
  profile_id: string;
  profile_name?: string;
  title: string;
  description?: string;
  thumbnail_url?: string;
  tags: Array<string>;
  languages: Array<string>;
  items: Array<string>;
  item_count: number;
  created_at: number;
  updated_at: number;
  signature_scope: string;
  message_id: string;
  owner: string;
  [key: string]: any;
};

/** Normalize an independently addressable playlist snapshot. */
export function normalizeNativePlaylist(source: any): NativePlaylist | null {
  const itemsJson = field(source, 'items-json', 'items_json');
  const items = stringArray(itemsJson === undefined ? field(source, 'items') : parseJsonArray(itemsJson));
  const tags = serializedStringArray(field(source, 'tags-json', 'tags_json', 'tags'));
  const languages = serializedStringArray(field(source, 'languages-json', 'languages_json', 'languages'));
  if (!items || !tags || !languages) return null;

  const createdAt = integer(field(source, 'created-at', 'created_at'), 0);
  const updatedAt = integer(field(source, 'updated-at', 'updated_at'), createdAt);
  const state = optionalString(field(source, 'state'));
  const operation = optionalString(field(source, 'operation'));
  if (state === 'deleted' || operation === 'delete') return null;

  const normalized = {
    ...source,
    schema: String(field(source, 'schema') || ''),
    type: String(field(source, 'type') || ''),
    profile_id: String(field(source, 'profile-id', 'profile_id') || ''),
    profile_name: optionalString(field(source, 'profile-name', 'profile_name')),
    title: String(field(source, 'title') || ''),
    description: optionalString(field(source, 'description')),
    thumbnail_url: optionalString(field(source, 'thumbnail-url', 'thumbnail_url')),
    tags,
    languages,
    items,
    item_count: integer(field(source, 'item-count', 'item_count'), -1),
    created_at: createdAt,
    updated_at: updatedAt,
    signature_scope: String(field(source, 'signature-scope', 'signature_scope') || ''),
    message_id: normalizeMessageId(field(source, 'message-id', 'message_id', 'hyperbeam_message_id')),
    owner: String(field(source, 'hyperbeam-owner', 'hyperbeam_owner', 'owner') || ''),
  } as NativePlaylist;

  return isValidNativePlaylist(normalized) ? normalized : null;
}
export function isValidNativePlaylist(playlist: NativePlaylist): boolean {
  return Boolean(
    playlist.schema === NATIVE_PLAYLIST_SCHEMA &&
    playlist.type === NATIVE_PLAYLIST_TYPE &&
    playlist.signature_scope === NATIVE_PLAYLIST_SIGNATURE_SCOPE &&
    isNativeMessageId(playlist.owner) &&
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
    isNativeMessageId(playlist.message_id)
  );
}

/** Return each verified immutable snapshot once, newest first. */
export function immutableNativePlaylists(playlists: Array<NativePlaylist>): Array<NativePlaylist> {
  const byMessageId = new Map<string, NativePlaylist>();
  playlists.filter(isValidNativePlaylist).forEach((playlist) => {
    if (!byMessageId.has(playlist.message_id)) byMessageId.set(playlist.message_id, playlist);
  });
  return Array.from(byMessageId.values()).sort(comparePlaylistSnapshots);
}

// The collection boundary lists immutable snapshots without a mutable head.
export const activeNativePlaylists = immutableNativePlaylists;

export function validNativePlaylistItem(item: string): boolean {
  return isNativeMessageId(item) || /^[0-9a-fA-F]{64}:\d+$/.test(item);
}

export function nativePlaylistItemsJson(items: Array<string>): string {
  if (!validPlaylistItems(items)) throw new Error('Playlist contains an invalid immutable item locator');
  return JSON.stringify(items);
}

function comparePlaylistSnapshots(left: NativePlaylist, right: NativePlaylist): number {
  const updatedDifference = right.updated_at - left.updated_at;
  if (updatedDifference) return updatedDifference;
  return left.message_id.localeCompare(right.message_id);
}

function validPlaylistItems(items: Array<string>): boolean {
  if (items.length > NATIVE_PLAYLIST_MAX_ITEMS || new Set(items).size !== items.length) return false;
  if (items.some((item) => !validNativePlaylistItem(item))) return false;
  return new TextEncoder().encode(JSON.stringify(items)).length <= MAX_ITEMS_JSON_BYTES;
}

function validStringList(values: Array<string>, maxItems: number, maxLength: number): boolean {
  return values.length <= maxItems && values.every((value) => boundedText(value, maxLength));
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
