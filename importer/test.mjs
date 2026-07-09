// Verifies decrypt -> extract channel key -> PEM->JWK against a real
// lbry-sdk-encrypted wallet file (empty-password cohort). Run: node test.mjs
import { extractChannelKeys, channelPemToJwk } from './lbry-wallet-importer.mjs';
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
const enc = readFileSync(new URL('./fixture-wallet-empty-pw.b64', import.meta.url));
const known = readFileSync(new URL('./fixture-channel-scalar.hex', import.meta.url), 'utf8').trim();
const pems = extractChannelKeys('', enc);
assert.equal(pems.length, 1, 'one channel key');
const jwk = JSON.parse(channelPemToJwk(pems[0]));
const d = Buffer.from(jwk.d, 'base64url').toString('hex');
assert.equal(d, known, 'migrated scalar equals original LBRY channel key');
console.log('OK: blob -> decrypt -> PEM -> JWK preserves the channel key byte-for-byte');

// Cross-implementation join: this PEM->JWK must reproduce, field-for-field, the
// FULL JWK that the proven Erlang import->sign path consumes for the same PEM.
// `erlangJwk` is the verbatim `lbry_channel_key:pem_to_jwk` output captured from
// the Erlang module. The SAME field values are pinned on the Erlang side by
// hb_lbry_channel_key_test:pem_to_jwk_matches_shared_vector_test, so if either
// implementation's encoding drifts, one of the two suites goes red rather than
// both silently agreeing with a stale fixture. Comparing every field (not just
// the private scalar) is what makes "the JS decrypt is a drop-in upstream of the
// Erlang import->sign" a measured fact rather than an assumption:
// blob -> (JS) decrypt -> PEM -> JWK == (Erlang) JWK -> import -> sign.
// (JSON key ORDER differs between the two emitters, so compare parsed fields,
// not the raw string.)
const vector = JSON.parse(
  readFileSync(new URL('./fixture-erlang-corpus-vector.json', import.meta.url), 'utf8'),
);
const vectorJwk = JSON.parse(channelPemToJwk(vector.pem));
for (const field of ['kty', 'crv', 'x', 'y', 'd']) {
  assert.equal(vectorJwk[field], vector.erlangJwk[field],
    `JS JWK.${field} must equal the Erlang import->sign JWK.${field}`);
}
const vectorD = Buffer.from(vectorJwk.d, 'base64url').toString('hex');
assert.equal(vectorD, vector.scalarHex, 'JS JWK.d decodes to the corpus scalar');
console.log('OK: JS PEM->JWK matches the Erlang import->sign JWK field-for-field (one pipeline)');

// A non-secp256k1 (here P-256) key must be REJECTED, not relabeled as
// secp256k1 carrying the wrong curve's coordinates (which would derive a
// garbage identity downstream).
const p256Pem =
  '-----BEGIN PRIVATE KEY-----\n' +
  'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgJ1PD+DNe3z+2yn/j\n' +
  'oGuZdqtyhb5FE6J3HDXxv4/KNhyhRANCAARtzBQS07Y4Ah8HoY9FYlvbdw1QckRV\n' +
  'X9StvtdoznD2dZOgPIl5sBf/wWyAGgSGme/C9tZPRKc9VqM8z+T/2e99\n' +
  '-----END PRIVATE KEY-----\n';
assert.throws(() => channelPemToJwk(p256Pem), /not a secp256k1/,
  'a P-256 key must be rejected, not mislabeled secp256k1');
console.log('OK: non-secp256k1 key rejected (no wrong-curve mislabeling)');
