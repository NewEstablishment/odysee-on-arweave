import { isNativeMessageId, type NativePlaylistReference } from './nativePlaylistReferences.ts';
import type { NativePlaylist } from './nativePlaylists.ts';

export const NATIVE_PLAYLIST_DELETION_SCHEMA = 'odysee-playlist-deletion@1.0';

// Public terminal marker contains no private title, items or encryption material.
export function nativePlaylistDeletionMessage(reference: NativePlaylistReference, timestamp: number) {
  return {
    schema: NATIVE_PLAYLIST_DELETION_SCHEMA,
    type: 'playlist-deletion',
    'reference-id': reference.reference_id,
    'previous-reference': reference.message_id,
    'profile-id': reference.profile_id,
    state: 'deleted',
    'deleted-at': timestamp,
  };
}

// Call only with an exact-verified payload/committer and an authorized reference.
export function playlistDeletionSnapshot(
  payload: Record<string, any>,
  messageId: string,
  owner: string,
  init: NativePlaylistReference,
  reference: NativePlaylistReference
): NativePlaylist | null {
  if (
    reference.playlist_state !== 'deleted' ||
    reference.is_init ||
    reference.owner !== init.owner ||
    owner !== init.owner ||
    reference.profile_id !== init.profile_id ||
    reference.reference_id !== init.reference_id ||
    reference.timestamp <= init.timestamp ||
    reference.reference_value !== messageId ||
    !isNativeMessageId(messageId) ||
    payload.schema !== NATIVE_PLAYLIST_DELETION_SCHEMA ||
    payload.type !== 'playlist-deletion' ||
    payload.state !== 'deleted' ||
    payload['reference-id'] !== init.reference_id ||
    payload['profile-id'] !== init.profile_id ||
    payload['previous-reference'] !== reference.previous_reference ||
    !Number.isSafeInteger(Number(payload['deleted-at'])) ||
    Number(payload['deleted-at']) !== reference.timestamp
  )
    return null;
  return {
    schema: NATIVE_PLAYLIST_DELETION_SCHEMA,
    type: 'playlist-deletion',
    profile_id: init.profile_id,
    profile_name: init.profile_name,
    title: 'Playlist deleted',
    tags: [],
    languages: [],
    items: [],
    item_count: 0,
    created_at: init.timestamp,
    updated_at: reference.timestamp,
    signature_scope: 'native-playlist-deletion-v1',
    message_id: messageId,
    owner,
    state: 'deleted',
  };
}
