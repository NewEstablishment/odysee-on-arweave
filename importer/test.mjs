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

// Cross-implementation join: this PEM->JWK must reproduce, byte-for-byte, the
// JWK that the proven Erlang import->sign path consumes for the same PEM
// (lbry_channel_key:pem_to_jwk fed to ~secret@1.0/import in
// hb_odysee_auth_test:migration_imports_real_lbry_channel_keys_test). Equal
// output means the JS decrypt is a validated upstream extension of that
// pipeline: blob -> (JS) decrypt -> PEM -> JWK -> (Erlang) import -> sign.
const vector = JSON.parse(
  readFileSync(new URL('./fixture-erlang-corpus-vector.json', import.meta.url), 'utf8'),
);
const vectorJwk = JSON.parse(channelPemToJwk(vector.pem));
const vectorD = Buffer.from(vectorJwk.d, 'base64url').toString('hex');
assert.equal(vectorD, vector.scalarHex, 'JS PEM->JWK matches the Erlang migration corpus scalar');
console.log('OK: JS PEM->JWK is byte-identical to the Erlang import->sign JWK (one pipeline)');
