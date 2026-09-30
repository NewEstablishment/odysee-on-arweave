import assert from 'node:assert/strict';
import { nativePlaylistDeletionMessage, playlistDeletionSnapshot } from '../../ui/util/nativePlaylistDeletion.ts';

import {
  NATIVE_PLAYLIST_REFERENCE_TYPE,
  REFERENCE_DEVICE,
  nativePlaylistReferenceInitMessage,
  nativePlaylistReferenceSetMessage,
  normalizeNativePlaylistReference,
  projectNativePlaylistReference,
} from '../../ui/util/nativePlaylistReferences.ts';

const owner = id('o');
const profileId = id('p');
const firstSnapshot = id('a');
const secondSnapshot = id('b');
const thirdSnapshot = id('c');

const initMessage = nativePlaylistReferenceInitMessage({
  profileId,
  profileName: 'Playlist owner',
  owner,
  snapshotId: firstSnapshot,
  timestamp: 100,
});
assert.deepEqual(initMessage, {
  device: REFERENCE_DEVICE,
  'reference-type': NATIVE_PLAYLIST_REFERENCE_TYPE,
  'profile-id': profileId,
  'profile-name': 'Playlist owner',
  'playlist-owner': owner,
  'reference-value': firstSnapshot,
  timestamp: 100,
});
assert.equal(initMessage['reference-id'], undefined, 'an init identifies itself and must not claim a reference ID');

const init = reference(initMessage, { messageId: id('r'), owner });
const update = reference(
  nativePlaylistReferenceSetMessage({
    profileId,
    profileName: 'Playlist owner',
    owner,
    referenceId: init.reference_id,
    snapshotId: secondSnapshot,
    timestamp: 101,
  }),
  { messageId: id('s'), owner }
);
assert.equal(projectNativePlaylistReference(init, [update]).reference_value, secondSnapshot);

const foreign = reference(
  nativePlaylistReferenceSetMessage({
    profileId,
    owner: id('x'),
    referenceId: init.reference_id,
    snapshotId: thirdSnapshot,
    timestamp: 999,
  }),
  { messageId: id('f'), owner: id('x') }
);
assert.equal(projectNativePlaylistReference(init, [update, foreign]).reference_value, secondSnapshot);

const stale = reference(
  nativePlaylistReferenceSetMessage({
    profileId,
    owner,
    referenceId: init.reference_id,
    snapshotId: thirdSnapshot,
    timestamp: 100,
  }),
  { messageId: id('t'), owner }
);
assert.equal(projectNativePlaylistReference(init, [stale]).reference_value, firstSnapshot);

const conflictingA = reference(
  nativePlaylistReferenceSetMessage({
    profileId,
    owner,
    referenceId: init.reference_id,
    snapshotId: secondSnapshot,
    timestamp: 102,
  }),
  { messageId: id('u'), owner }
);
const conflictingB = reference(
  nativePlaylistReferenceSetMessage({
    profileId,
    owner,
    referenceId: init.reference_id,
    snapshotId: thirdSnapshot,
    timestamp: 102,
  }),
  { messageId: id('v'), owner }
);
assert.equal(
  projectNativePlaylistReference(init, [conflictingA, conflictingB]).reference_value,
  firstSnapshot,
  'local reads fail closed when equal-timestamp data-layer ordering is unavailable'
);

assert.equal(
  normalizeNativePlaylistReference({ ...init, authority: id('z') }),
  null,
  'the Odysee cookie flow does not accept a claimed foreign authority'
);
assert.equal(
  normalizeNativePlaylistReference({ ...update, 'reference-value': 'not-an-id', reference_value: undefined }),
  null
);

console.log('native playlist reference tests passed');

const deletionId = id('D');
const deletionPayload = nativePlaylistDeletionMessage(update, 103);
const deletion = reference(
  nativePlaylistReferenceSetMessage({
    profileId,
    owner,
    referenceId: init.reference_id,
    snapshotId: deletionId,
    timestamp: 103,
    deleted: true,
    previousReference: update.message_id,
  }),
  { messageId: id('X'), owner }
);
assert.ok(playlistDeletionSnapshot(deletionPayload, deletionId, owner, init, deletion));
assert.equal(playlistDeletionSnapshot(deletionPayload, deletionId, id('z'), init, deletion), null);
assert.equal(
  playlistDeletionSnapshot({ ...deletionPayload, 'reference-id': id('z') }, deletionId, owner, init, deletion),
  null
);
assert.equal(
  playlistDeletionSnapshot({ ...deletionPayload, 'deleted-at': 102 }, deletionId, owner, init, deletion),
  null
);
assert.equal(deletionPayload.title, undefined, 'private metadata is not copied to the tombstone');
assert.equal(deletionPayload['items-json'], undefined);
assert.equal(projectNativePlaylistReference(init, [update, deletion]).playlist_state, 'deleted');
assert.equal(
  projectNativePlaylistReference(init, [update, { ...update, message_id: id('0') }, deletion]).playlist_state,
  'deleted',
  'equivalent predecessor commitment aliases do not invalidate deletion'
);
assert.equal(
  projectNativePlaylistReference(init, [update, { ...deletion, owner: id('z') }]).message_id,
  update.message_id
);
assert.equal(
  projectNativePlaylistReference(init, [update, { ...deletion, timestamp: 99 }]).message_id,
  update.message_id
);
assert.equal(
  projectNativePlaylistReference(init, [update, { ...deletion, previous_reference: init.message_id }]).message_id,
  update.message_id,
  'stale predecessor cannot delete a newer head'
);
assert.equal(
  projectNativePlaylistReference(init, [update, deletion, { ...update, timestamp: 200 }]).playlist_state,
  'deleted',
  'later saves cannot resurrect a deleted reference'
);
assert.equal(
  projectNativePlaylistReference(init, [update, deletion, { ...update, timestamp: 103 }]).message_id,
  update.message_id,
  'tied delete and save fail closed'
);

function reference(message, { messageId, owner: messageOwner }) {
  const normalized = normalizeNativePlaylistReference({
    ...message,
    'message-id': messageId,
    'hyperbeam-owner': messageOwner,
  });
  assert.ok(normalized);
  return normalized;
}

function id(character) {
  return character.repeat(43);
}
