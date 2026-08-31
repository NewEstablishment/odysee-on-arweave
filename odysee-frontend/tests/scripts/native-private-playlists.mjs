import assert from 'node:assert/strict';

import {
  NATIVE_PRIVATE_PLAYLIST_ALGORITHM,
  NATIVE_PRIVATE_PLAYLIST_KEY_VERSION,
  NATIVE_PRIVATE_PLAYLIST_PAYLOAD_SCHEMA,
  NATIVE_PRIVATE_PLAYLIST_PURPOSE,
  NATIVE_PRIVATE_PLAYLIST_SCHEMA,
  nativePrivatePlaylistPlaintext,
  nativePrivatePlaylistSnapshotMessage,
  normalizeNativePrivatePlaylistEnvelope,
  normalizeNativePrivatePlaylistSnapshot,
  parseNativePrivatePlaylistPlaintext,
} from '../../ui/util/nativePrivatePlaylists.ts';
import { NATIVE_PLAYLIST_SIGNATURE_SCOPE } from '../../ui/util/nativePlaylists.ts';

const owner = id('o');
const profileId = id('p');
const snapshotId = id('s');
const secretTitle = 'Encrypted road trip';
const secretItem = id('i');
const publicShape = {
  schema: 'odysee-playlist@1.0',
  type: 'playlist',
  'profile-id': profileId,
  'profile-name': 'Private owner',
  title: secretTitle,
  description: 'Only the owner should see this.',
  'thumbnail-url': 'https://example.com/private.jpg',
  'tags-json': JSON.stringify(['private']),
  'languages-json': JSON.stringify(['en']),
  'items-json': JSON.stringify([secretItem]),
  'item-count': 1,
  'created-at': 100,
  'updated-at': 101,
  'signature-scope': NATIVE_PLAYLIST_SIGNATURE_SCOPE,
};
const plaintext = nativePrivatePlaylistPlaintext(publicShape);
const parsedPayload = JSON.parse(plaintext);
assert.equal(parsedPayload.schema, NATIVE_PRIVATE_PLAYLIST_PAYLOAD_SCHEMA);

const envelope = normalizeNativePrivatePlaylistEnvelope({
  algorithm: NATIVE_PRIVATE_PLAYLIST_ALGORITHM,
  'key-version': NATIVE_PRIVATE_PLAYLIST_KEY_VERSION,
  purpose: NATIVE_PRIVATE_PLAYLIST_PURPOSE,
  owner,
  iv: encoded(12, 1),
  ciphertext: encoded(plaintext.length, 2),
  tag: encoded(16, 3),
});
assert.ok(envelope);

const committedMessage = nativePrivatePlaylistSnapshotMessage(envelope);
const committedJson = JSON.stringify(committedMessage);
assert.equal(committedMessage.schema, NATIVE_PRIVATE_PLAYLIST_SCHEMA);
assert.equal(committedJson.includes(secretTitle), false, 'the committed snapshot must not reveal the title');
assert.equal(committedJson.includes(secretItem), false, 'the committed snapshot must not reveal an item ID');
assert.equal(committedJson.includes(profileId), false, 'the committed snapshot must not reveal the profile ID');

const snapshot = normalizeNativePrivatePlaylistSnapshot({
  ...committedMessage,
  'message-id': snapshotId,
  'hyperbeam-owner': owner,
});
assert.ok(snapshot);
const playlist = parseNativePrivatePlaylistPlaintext(plaintext, snapshot);
assert.ok(playlist);
assert.equal(playlist.title, secretTitle);
assert.deepEqual(playlist.items, [secretItem]);
assert.equal(playlist.owner, owner);
assert.equal(playlist.visibility, 'private');
assert.equal(playlist.storage_schema, NATIVE_PRIVATE_PLAYLIST_SCHEMA);

assert.equal(
  normalizeNativePrivatePlaylistSnapshot({
    ...committedMessage,
    'message-id': snapshotId,
    'hyperbeam-owner': id('x'),
  }),
  null,
  'the encrypted-for owner must match the verified message committer'
);
assert.equal(
  parseNativePrivatePlaylistPlaintext(plaintext.slice(0, -1), snapshot),
  null,
  'malformed plaintext fails closed'
);
assert.equal(
  parseNativePrivatePlaylistPlaintext(JSON.stringify({ ...parsedPayload, schema: 'wrong-schema' }), snapshot),
  null,
  'a cross-domain plaintext payload fails closed'
);

console.log('native private playlist envelope tests passed');

function encoded(length, byte) {
  return Buffer.alloc(length, byte).toString('base64url');
}

function id(character) {
  return character.repeat(43);
}
