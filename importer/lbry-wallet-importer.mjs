// Client/TEE-side importer: decrypt an Odysee wallet-sync payload (an encrypted
// wallet file), extract the channel signing key, and convert it to the JWK that
// HyperBEAM's ~secret@1.0 imports. The node never sees the password — only the
// resulting JWK. Verified against lbry-sdk's own better_aes_encrypt output.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

// Fixed scrypt cost lbry-sdk's better_aes_encrypt always emits (crypt.py). The
// header carries these too, but we never trust the header's values for cost.
// maxmem sized for N=8192/r=16 (128*N*r ~= 16 MiB) with headroom.
const LBRY_SCRYPT = { N: 8192, r: 16, p: 1, maxmem: 64 * 1024 * 1024 };

// Upper bound on a decrypted/inflated wallet-sync payload. Real wallets are
// well under this; it caps the zlib-bomb blast radius on untrusted input.
const MAX_WALLET_BYTES = 32 * 1024 * 1024;

// Mirror of lbry-sdk better_aes_decrypt (crypt.py): base64 -> `s:N:r:p:` prefix
// -> scrypt(password, salt=IV, N,r,p) -> AES-256-CBC -> PKCS7 unpad -> zlib? No:
// pack() zlib-compresses BEFORE encrypt, so decrypt output is zlib-compressed.
export function decryptWalletFile(password, encryptedB64) {
  const b64 = encryptedB64.toString();
  // Bound the untrusted input before allocating: a base64 blob decodes to ~3/4
  // its length, so cap the encoded size so neither the decode nor the raw
  // plaintext can exceed MAX_WALLET_BYTES (the inflate path is capped
  // separately). Real wallet-sync payloads are orders of magnitude smaller.
  if (b64.length > Math.ceil((MAX_WALLET_BYTES * 4) / 3) + 64) {
    throw new Error('wallet-sync blob exceeds maximum size');
  }
  const data = Buffer.from(b64, 'base64');
  const parts = []; let i = 0, start = 0;
  // Header is `s:N:r:p:` before the IV+ciphertext; scan only that far. A blob
  // with fewer than 4 colons is not a wallet-sync payload -- reject it rather
  // than scan past the buffer.
  while (parts.length < 4 && i < data.length) {
    if (data[i] === 0x3a) { parts.push(data.subarray(start, i)); start = i + 1; }
    i++;
  }
  if (parts.length < 4) throw new Error('not a wallet-sync blob: missing s:N:r:p: header');
  const [scheme, N, r, p] = parts.map((b) => b.toString());
  if (scheme !== 's') throw new Error(`unsupported wallet-sync scheme: ${scheme}`);
  // The scrypt cost parameters come from the UNTRUSTED header. lbry-sdk's
  // better_aes_encrypt always emits the fixed cost N=8192/r=16/p=1, so pin to
  // exactly that: a malicious blob cannot otherwise force arbitrary CPU/memory
  // (e.g. N=2^24 is ~40s of scrypt) before the decrypt even fails. maxmem is a
  // constant sized for those params, never derived from the header.
  if (N !== String(LBRY_SCRYPT.N) || r !== String(LBRY_SCRYPT.r) || p !== String(LBRY_SCRYPT.p)) {
    throw new Error(`unexpected scrypt cost s:${N}:${r}:${p}: (expected s:8192:16:1:)`);
  }
  const rest = data.subarray(start);
  const iv = rest.subarray(0, 16), ct = rest.subarray(16);
  const key = crypto.scryptSync(Buffer.from(password), iv, 32,
    { N: LBRY_SCRYPT.N, r: LBRY_SCRYPT.r, p: LBRY_SCRYPT.p, maxmem: LBRY_SCRYPT.maxmem });
  const dec = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const plain = Buffer.concat([dec.update(ct), dec.final()]);
  if (plain.length > MAX_WALLET_BYTES) throw new Error('wallet-sync payload exceeds maximum size');
  // Wallet.pack zlib-compresses before encrypting; the raw encryption primitive
  // does not. Inflate only when the plaintext is zlib-framed (0x78 magic), and
  // cap the output: the attacker controls this ciphertext, so an uncapped
  // inflateSync is a memory-exhaustion bomb (a small blob can inflate to GBs).
  return plain[0] === 0x78
    ? zlib.inflateSync(plain, { maxOutputLength: MAX_WALLET_BYTES })
    : plain;
}

// PKCS8 secp256k1 PEM -> HyperBEAM secp256k1 JWK ({kty:EC, crv:secp256k1, x,y,d}).
// Reject any other curve rather than relabel its coordinates as secp256k1: an
// LBRY channel key is always secp256k1, and a mislabeled JWK would derive a
// wrong/garbage identity downstream instead of failing here.
export function channelPemToJwk(pem) {
  const key = crypto.createPrivateKey({ key: pem, format: 'pem' });
  const jwk = key.export({ format: 'jwk' });          // {kty:'EC',crv,x,y,d}
  if (jwk.kty !== 'EC' || jwk.crv !== 'secp256k1') {
    throw new Error(`not a secp256k1 channel key: kty=${jwk.kty} crv=${jwk.crv}`);
  }
  return JSON.stringify({ kty: 'EC', crv: 'secp256k1', x: jwk.x, y: jwk.y, d: jwk.d });
}

const isPlainObject = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

// Returns the channel signing keys as PEM strings. Only a STRUCTURALLY VALID
// wallet with an empty certificate map yields []; a malformed shape (wallet not
// an object, `accounts` not an array, an account not an object, `certificates`
// not a plain map, or a cert value that is not a PEM string) is rejected rather
// than silently treated as "no channels" or passed downstream to fail opaquely.
export function extractChannelKeys(password, encryptedB64) {
  const wallet = JSON.parse(decryptWalletFile(password, encryptedB64).toString());
  if (!isPlainObject(wallet)) throw new Error('malformed wallet: expected an object');
  if (wallet.accounts !== undefined && !Array.isArray(wallet.accounts)) {
    throw new Error('malformed wallet: `accounts` must be an array');
  }
  const out = [];
  for (const acct of wallet.accounts || []) {
    if (!isPlainObject(acct)) throw new Error('malformed wallet: account must be an object');
    if (acct.certificates === undefined) continue;
    if (!isPlainObject(acct.certificates)) {
      throw new Error('malformed wallet: `certificates` must be an object map');
    }
    for (const pem of Object.values(acct.certificates)) {
      if (typeof pem !== 'string' || !pem.includes('-----BEGIN')) {
        throw new Error('malformed certificate entry: expected a PEM string');
      }
      out.push(pem);
    }
  }
  return out;
}
