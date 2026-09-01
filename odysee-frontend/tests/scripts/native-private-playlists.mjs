import assert from 'node:assert/strict';
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';

import {
  NATIVE_PRIVATE_PLAYLIST_ENCRYPTION_FORMAT,
  NATIVE_PRIVATE_PLAYLIST_PAYLOAD_SCHEMA,
  NATIVE_PRIVATE_PLAYLIST_PURPOSE,
  NATIVE_PRIVATE_PLAYLIST_SCHEMA,
  NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES,
  nativePrivatePlaylistPlaintext,
  nativePrivatePlaylistSnapshotMessage,
  normalizeNativePrivatePlaylistEnvelope,
  normalizeNativePrivatePlaylistSnapshot,
  parseNativePrivatePlaylistPlaintext,
} from '../../ui/util/nativePrivatePlaylists.ts';
import { NATIVE_PLAYLIST_SIGNATURE_SCOPE } from '../../ui/util/nativePlaylists.ts';
import {
  decryptWeavemailEnvelope,
  encryptWeavemailEnvelope,
  generateBrowserWeavemailKeyPair,
} from '../../ui/util/weavemailClient.ts';

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

const browserKey = await generateBrowserWeavemailKeyPair();
assert.equal(browserKey.privateKey.extractable, false);
const sealed = await encryptWeavemailEnvelope(plaintext, browserKey, NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES);
assert.equal(
  await decryptWeavemailEnvelope(sealed, browserKey, NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES),
  plaintext,
  'the browser client must round-trip the WeaveMail-compatible envelope without a device call'
);

const interoperabilityPair = await crypto.subtle.generateKey(
  {
    name: 'RSA-OAEP',
    modulusLength: 4096,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['encrypt', 'decrypt']
);
const interoperabilityKey = {
  publicKey: interoperabilityPair.publicKey,
  privateKey: interoperabilityPair.privateKey,
  keyId: id('k'),
};
const publicKey = createPublicKey({
  key: await crypto.subtle.exportKey('jwk', interoperabilityPair.publicKey),
  format: 'jwk',
});
const privateKey = createPrivateKey({
  key: await crypto.subtle.exportKey('jwk', interoperabilityPair.privateKey),
  format: 'jwk',
});
const browserEnvelope = await encryptWeavemailEnvelope(
  plaintext,
  interoperabilityKey,
  NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES
);
const browserContentKey = Buffer.from(
  privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(browserEnvelope.encrypted_key, 'base64url')
  ).toString(),
  'base64url'
);
const nodeDecipher = createDecipheriv(
  'aes-256-gcm',
  browserContentKey,
  Buffer.from(browserEnvelope.encrypted_iv, 'base64url')
);
nodeDecipher.setAuthTag(Buffer.from(browserEnvelope.encrypted_tag, 'base64url'));
assert.equal(
  Buffer.concat([
    nodeDecipher.update(Buffer.from(browserEnvelope.ciphertext, 'base64url')),
    nodeDecipher.final(),
  ]).toString(),
  plaintext,
  'the browser envelope must open with the independent WeaveMail RSA/AES primitives'
);

const nodeContentKey = randomBytes(32);
const nodeIv = randomBytes(12);
const nodeCipher = createCipheriv('aes-256-gcm', nodeContentKey, nodeIv);
const nodeCiphertext = Buffer.concat([nodeCipher.update(plaintext), nodeCipher.final()]);
const nodeEnvelope = {
  ciphertext: nodeCiphertext.toString('base64url'),
  encrypted_key: publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(nodeContentKey.toString('base64url'))
  ).toString('base64url'),
  encrypted_iv: nodeIv.toString('base64url'),
  encrypted_tag: nodeCipher.getAuthTag().toString('base64url'),
  recipient_key_id: interoperabilityKey.keyId,
};
assert.equal(
  await decryptWeavemailEnvelope(nodeEnvelope, interoperabilityKey, NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES),
  plaintext,
  'the browser client must open an independently generated WeaveMail envelope'
);

const envelope = normalizeNativePrivatePlaylistEnvelope({
  ...sealed,
  'encryption-format': NATIVE_PRIVATE_PLAYLIST_ENCRYPTION_FORMAT,
  purpose: NATIVE_PRIVATE_PLAYLIST_PURPOSE,
  owner,
});
assert.ok(envelope);

const committedMessage = nativePrivatePlaylistSnapshotMessage(envelope);
const committedJson = JSON.stringify(committedMessage);
assert.equal(committedMessage.schema, NATIVE_PRIVATE_PLAYLIST_SCHEMA);
assert.equal(committedMessage['recipient-key-id'], browserKey.keyId);
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

const wrongKey = await generateBrowserWeavemailKeyPair();
await assert.rejects(
  decryptWeavemailEnvelope(
    { ...sealed, recipient_key_id: wrongKey.keyId },
    wrongKey,
    NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES
  ),
  /failed authentication/,
  'another browser key must not decrypt the envelope'
);
await assert.rejects(
  decryptWeavemailEnvelope(
    { ...sealed, ciphertext: tamper(sealed.ciphertext) },
    browserKey,
    NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES
  ),
  /failed authentication/,
  'modified ciphertext must fail authentication'
);

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

console.log('native browser-only private playlist envelope tests passed');

function tamper(value) {
  return `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`;
}

function id(character) {
  return character.repeat(43);
}
