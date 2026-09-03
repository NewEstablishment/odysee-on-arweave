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
import { decryptWeavemailEnvelope, encryptWeavemailEnvelope } from '../../ui/util/weavemail.ts';
import { withRsaPrimes } from '../../ui/util/rsaJwk.ts';

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

// An Arweave-shaped wallet keyfile (RSA-4096 JWK) plays the hosted owner wallet.
const wallet = await walletKeyfile();
const sealed = await encryptWeavemailEnvelope(plaintext, wallet.n, NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES);
assert.equal(
  await decryptWeavemailEnvelope(sealed, wallet, NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES),
  plaintext,
  'the wallet keyfile must round-trip the WeaveMail envelope without a device call'
);

// HyperBEAM exports hosted wallets without CRT parameters; the client recovers them.
const { p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...minimalWallet } = wallet;
assert.equal(
  await decryptWeavemailEnvelope(sealed, minimalWallet, NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES),
  plaintext,
  'a node-exported (n, e, d) keyfile must decrypt after prime recovery'
);

// The node pads exported JWK members with leading zero octets (e in particular),
// which WebCrypto rejects; the client must re-encode them minimally.
const paddedWallet = { ...minimalWallet, e: padded(minimalWallet.e), d: padded(minimalWallet.d) };
assert.equal(
  await decryptWeavemailEnvelope(sealed, paddedWallet, NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES),
  plaintext,
  'a keyfile exported with leading-zero JWK members must still decrypt'
);
for (const [member, encoded] of Object.entries(withRsaPrimes(paddedWallet))) {
  if (typeof encoded !== 'string' || member === 'kty') continue;
  assert.notEqual(
    Buffer.from(encoded, 'base64url')[0],
    0,
    `withRsaPrimes must strip the leading zero octet from "${member}" (Chrome WebCrypto rejects it)`
  );
}

// Interoperability with independent RSA-OAEP/AES-GCM primitives in both directions.
const publicKey = createPublicKey({ key: { kty: 'RSA', n: wallet.n, e: wallet.e }, format: 'jwk' });
const privateKey = createPrivateKey({ key: wallet, format: 'jwk' });
const contentKey = Buffer.from(
  privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(sealed.encrypted_key, 'base64url')
  ).toString(),
  'base64url'
);
const nodeDecipher = createDecipheriv('aes-256-gcm', contentKey, Buffer.from(sealed.encrypted_iv, 'base64url'));
nodeDecipher.setAuthTag(Buffer.from(sealed.encrypted_tag, 'base64url'));
assert.equal(
  Buffer.concat([nodeDecipher.update(Buffer.from(sealed.ciphertext, 'base64url')), nodeDecipher.final()]).toString(),
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
};
assert.equal(
  await decryptWeavemailEnvelope(nodeEnvelope, wallet, NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES),
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
assert.equal(committedMessage['encrypted-for'], owner);
assert.equal(committedJson.includes(secretTitle), false, 'the committed snapshot must not reveal the title');
assert.equal(committedJson.includes(secretItem), false, 'the committed snapshot must not reveal an item ID');
assert.equal(committedJson.includes(profileId), false, 'the committed snapshot must not reveal the profile ID');
assert.equal(committedJson.includes(wallet.d), false, 'the committed snapshot must not carry the wallet');

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

await assert.rejects(
  decryptWeavemailEnvelope(sealed, await walletKeyfile(), NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES),
  /failed authentication/,
  'another wallet must not decrypt the envelope'
);
await assert.rejects(
  decryptWeavemailEnvelope(
    { ...sealed, ciphertext: tamper(sealed.ciphertext) },
    wallet,
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

console.log('native wallet-keyed private playlist envelope tests passed');

async function walletKeyfile() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt']
  );
  const { alg: _alg, key_ops: _keyOps, ext: _ext, ...keyfile } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return keyfile;
}

function padded(value) {
  return Buffer.concat([Buffer.from([0]), Buffer.from(value, 'base64url')]).toString('base64url');
}

function tamper(value) {
  return `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`;
}

function id(character) {
  return character.repeat(43);
}
