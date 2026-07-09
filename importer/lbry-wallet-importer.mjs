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

// Mirror of lbry-sdk better_aes_decrypt (crypt.py): base64 -> `s:N:r:p:` prefix
// -> scrypt(password, salt=IV, N,r,p) -> AES-256-CBC -> PKCS7 unpad -> zlib? No:
// pack() zlib-compresses BEFORE encrypt, so decrypt output is zlib-compressed.
export function decryptWalletFile(password, encryptedB64) {
  const data = Buffer.from(encryptedB64.toString(), 'base64');
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
  // Wallet.pack zlib-compresses before encrypting; the raw encryption primitive
  // does not. Inflate only when the plaintext is zlib-framed (0x78 magic).
  return plain[0] === 0x78 ? zlib.inflateSync(plain) : plain;
}

// PKCS8 secp256k1 PEM -> HyperBEAM secp256k1 JWK ({kty:EC, crv:secp256k1, x,y,d}).
export function channelPemToJwk(pem) {
  const key = crypto.createPrivateKey({ key: pem, format: 'pem' });
  const jwk = key.export({ format: 'jwk' });          // {kty:'EC',crv:'secp256k1',x,y,d}
  return JSON.stringify({ kty: 'EC', crv: 'secp256k1', x: jwk.x, y: jwk.y, d: jwk.d });
}

// Returns the channel signing keys as PEM strings. A wallet with no channels
// legitimately yields []; anything present that is not a PEM string (wrong
// shape, numeric/object cert value) is rejected rather than passed downstream
// to surface as an opaque failure later.
export function extractChannelKeys(password, encryptedB64) {
  const wallet = JSON.parse(decryptWalletFile(password, encryptedB64).toString());
  const accounts = Array.isArray(wallet.accounts) ? wallet.accounts : [];
  const out = [];
  for (const acct of accounts) {
    const certs = acct && typeof acct.certificates === 'object' && acct.certificates
      ? acct.certificates : {};
    for (const pem of Object.values(certs)) {
      if (typeof pem !== 'string' || !pem.includes('-----BEGIN')) {
        throw new Error('malformed certificate entry: expected a PEM string');
      }
      out.push(pem);
    }
  }
  return out;
}
