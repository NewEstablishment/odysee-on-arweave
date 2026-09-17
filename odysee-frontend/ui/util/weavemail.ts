// WeaveMail 1.0 envelope primitives, vendored from the shared client in
// permaweb/PermawebOS-Browser (src/api/mail/weavemailAdapter.ts @ 7fbe8b95,
// PR #61). Same envelope, same key model as weavemail@1.0: the recipient is an
// Arweave wallet. Encrypt to its public modulus `n`; decrypt with its JWK
// keyfile. Nothing here generates or stores keys.
import { withRsaPrimes } from './rsaJwk.ts';

export const WEAVEMAIL_FORMAT = 'weavemail@1.0';

const GCM_TAG_BYTES = 16;
const RSA_OAEP = { name: 'RSA-OAEP', hash: 'SHA-256' };

export type WeavemailEnvelope = {
  ciphertext: string;
  encrypted_key: string;
  encrypted_iv: string;
  encrypted_tag: string;
};

export type WalletKeyfile = JsonWebKey & { n: string };

export function publicEncryptionJwk(n: string): JsonWebKey {
  return { kty: 'RSA', e: 'AQAB', n, alg: 'RSA-OAEP-256', ext: true };
}

export function privateDecryptionJwk(keyfile: JsonWebKey): JsonWebKey {
  const { alg: _alg, key_ops: _keyOps, use: _use, ...rsaKey } = keyfile;
  return { ...rsaKey, alg: 'RSA-OAEP-256', ext: true };
}

export function importRecipientPublicKey(n: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', publicEncryptionJwk(n), RSA_OAEP, false, ['encrypt']);
}

export function importWalletPrivateKey(keyfile: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', privateDecryptionJwk(withRsaPrimes(keyfile)), RSA_OAEP, false, ['decrypt']);
}

export async function encryptWeavemailEnvelope(
  plaintext: string,
  recipientN: string,
  maxPlaintextBytes: number
): Promise<WeavemailEnvelope> {
  const plaintextBytes = new TextEncoder().encode(plaintext);
  if (!plaintextBytes.length || plaintextBytes.length > maxPlaintextBytes) {
    throw new Error('WeaveMail plaintext is empty or exceeds the allowed size');
  }
  const recipientPublicKey = await importRecipientPublicKey(recipientN);
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintextBytes));
  const exportedAesKey = new Uint8Array(await crypto.subtle.exportKey('raw', aesKey));
  const encryptedKey = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      recipientPublicKey,
      new TextEncoder().encode(bytesToBase64Url(exportedAesKey))
    )
  );
  return {
    ciphertext: bytesToBase64Url(sealed.slice(0, -GCM_TAG_BYTES)),
    encrypted_key: bytesToBase64Url(encryptedKey),
    encrypted_iv: bytesToBase64Url(iv),
    encrypted_tag: bytesToBase64Url(sealed.slice(-GCM_TAG_BYTES)),
  };
}

export async function decryptWeavemailEnvelope(
  source: WeavemailEnvelope,
  keyfile: JsonWebKey,
  maxPlaintextBytes: number
): Promise<string> {
  const envelope = normalizeWeavemailEnvelope(source, maxPlaintextBytes);
  if (!envelope) throw new Error('Private playlist WeaveMail envelope is invalid');
  try {
    const privateKey = await importWalletPrivateKey(keyfile);
    const encodedAesKey = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, base64UrlToBytes(envelope.encrypted_key))
    );
    const aesKeyBytes = base64UrlToBytes(new TextDecoder('utf-8', { fatal: true }).decode(encodedAesKey));
    if (aesKeyBytes.length !== 32) throw new Error('Invalid WeaveMail content key');
    const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM', length: 256 }, false, [
      'decrypt',
    ]);
    const ciphertext = base64UrlToBytes(envelope.ciphertext);
    const tag = base64UrlToBytes(envelope.encrypted_tag);
    const sealed = new Uint8Array(ciphertext.length + tag.length);
    sealed.set(ciphertext);
    sealed.set(tag, ciphertext.length);
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(envelope.encrypted_iv) }, aesKey, sealed)
    );
    if (!plaintext.length || plaintext.length > maxPlaintextBytes) throw new Error('Invalid WeaveMail plaintext size');
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch {
    throw new Error('Private playlist ciphertext failed authentication');
  }
}

export function normalizeWeavemailEnvelope(source: any, maxCiphertextBytes: number): WeavemailEnvelope | null {
  const envelope = {
    ciphertext: String(value(source, 'ciphertext', 'data') || ''),
    encrypted_key: String(value(source, 'encrypted-key', 'encrypted_key') || ''),
    encrypted_iv: String(value(source, 'encrypted-iv', 'encrypted_iv') || ''),
    encrypted_tag: String(value(source, 'encrypted-tag', 'encrypted_tag') || ''),
  };
  return encodedBytes(envelope.ciphertext, 1, maxCiphertextBytes) &&
    encodedBytes(envelope.encrypted_key, 256, 1024) &&
    encodedBytes(envelope.encrypted_iv, 12, 12) &&
    encodedBytes(envelope.encrypted_tag, GCM_TAG_BYTES, GCM_TAG_BYTES)
    ? envelope
    : null;
}

export function encodedBytes(value: string, minimum: number, maximum: number): boolean {
  try {
    const decoded = base64UrlToBytes(value);
    return decoded.length >= minimum && decoded.length <= maximum;
  } catch {
    return false;
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!value || !/^[0-9A-Za-z_-]+$/.test(value)) throw new Error('Invalid base64url value');
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function value(source: any, ...keys: Array<string>) {
  for (const key of keys) {
    const candidate = source?.[key];
    if (candidate !== undefined && candidate !== null) return candidate;
  }
  return undefined;
}
