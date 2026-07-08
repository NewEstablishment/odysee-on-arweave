// Client/TEE-side importer: decrypt an Odysee wallet-sync payload (an encrypted
// wallet file), extract the channel signing key, and convert it to the JWK that
// HyperBEAM's ~secret@1.0 imports. The node never sees the password — only the
// resulting JWK. Verified against lbry-sdk's own better_aes_encrypt output.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

// Mirror of lbry-sdk better_aes_decrypt (crypt.py): base64 -> `s:N:r:p:` prefix
// -> scrypt(password, salt=IV, N,r,p) -> AES-256-CBC -> PKCS7 unpad -> zlib? No:
// pack() zlib-compresses BEFORE encrypt, so decrypt output is zlib-compressed.
export function decryptWalletFile(password, encryptedB64) {
  const data = Buffer.from(encryptedB64.toString(), 'base64');
  const parts = []; let i = 0, start = 0;
  while (parts.length < 4) { if (data[i] === 0x3a) { parts.push(data.subarray(start, i)); start = i + 1; } i++; }
  const [, N, r, p] = parts.map((b) => parseInt(b.toString(), 10) || b.toString());
  const rest = data.subarray(start);
  const iv = rest.subarray(0, 16), ct = rest.subarray(16);
  const key = crypto.scryptSync(Buffer.from(password), iv, 32, { N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * Number(N) * Number(r) * 2 });
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

export function extractChannelKeys(password, encryptedB64) {
  const wallet = JSON.parse(decryptWalletFile(password, encryptedB64).toString());
  const out = [];
  for (const acct of wallet.accounts || []) for (const pem of Object.values(acct.certificates || {})) out.push(pem);
  return out;
}
