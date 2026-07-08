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
