export const WEAVEMAIL_FORMAT = 'weavemail@1.0';

const KEY_DATABASE = 'odysee-browser-private-keys';
const KEY_DATABASE_VERSION = 1;
const KEY_STORE = 'weavemail-keys';
const RSA_MODULUS_BITS = 4096;
const GCM_TAG_BYTES = 16;

export type WeavemailEnvelope = {
  ciphertext: string;
  encrypted_key: string;
  encrypted_iv: string;
  encrypted_tag: string;
};

export type BrowserWeavemailEnvelope = WeavemailEnvelope & {
  recipient_key_id: string;
};

export type BrowserWeavemailKeyPair = {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  keyId: string;
};

type StoredBrowserKey = BrowserWeavemailKeyPair & {
  owner: string;
  createdAt: number;
};

let databasePromise: Promise<IDBDatabase> | undefined;
const keyCreationByOwner = new Map<string, Promise<StoredBrowserKey>>();

export async function encryptWithBrowserWeavemail(
  plaintext: string,
  owner: string,
  maxPlaintextBytes: number
): Promise<BrowserWeavemailEnvelope> {
  const key = await browserKeyForOwner(owner, true);
  return encryptWeavemailEnvelope(plaintext, key, maxPlaintextBytes);
}

export async function decryptWithBrowserWeavemail(
  envelope: BrowserWeavemailEnvelope,
  owner: string,
  maxPlaintextBytes: number
): Promise<string> {
  const key = await browserKeyForOwner(owner, false);
  if (key.keyId !== envelope.recipient_key_id) {
    throw new Error('This private playlist was encrypted with another browser key');
  }
  return decryptWeavemailEnvelope(envelope, key, maxPlaintextBytes);
}

export async function generateBrowserWeavemailKeyPair(): Promise<BrowserWeavemailKeyPair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: RSA_MODULUS_BITS,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    false,
    ['encrypt', 'decrypt']
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  if (!publicJwk.n) throw new Error('The browser did not produce a WeaveMail RSA public key');
  const keyId = bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', ownedArrayBuffer(base64UrlToBytes(publicJwk.n))))
  );
  return { publicKey: pair.publicKey, privateKey: pair.privateKey, keyId };
}

export async function encryptWeavemailEnvelope(
  plaintext: string,
  key: BrowserWeavemailKeyPair,
  maxPlaintextBytes: number
): Promise<BrowserWeavemailEnvelope> {
  const plaintextBytes = new TextEncoder().encode(plaintext);
  if (!plaintextBytes.length || plaintextBytes.length > maxPlaintextBytes) {
    throw new Error('WeaveMail plaintext is empty or exceeds the allowed size');
  }

  const aesKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey('raw', ownedArrayBuffer(aesKeyBytes), { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ownedArrayBuffer(iv), tagLength: GCM_TAG_BYTES * 8 },
      aesKey,
      ownedArrayBuffer(plaintextBytes)
    )
  );
  const ciphertext = sealed.slice(0, -GCM_TAG_BYTES);
  const tag = sealed.slice(-GCM_TAG_BYTES);
  const encodedAesKey = new TextEncoder().encode(bytesToBase64Url(aesKeyBytes));
  const encryptedKey = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key.publicKey, ownedArrayBuffer(encodedAesKey))
  );

  return {
    ciphertext: bytesToBase64Url(ciphertext),
    encrypted_key: bytesToBase64Url(encryptedKey),
    encrypted_iv: bytesToBase64Url(iv),
    encrypted_tag: bytesToBase64Url(tag),
    recipient_key_id: key.keyId,
  };
}

export async function decryptWeavemailEnvelope(
  source: BrowserWeavemailEnvelope,
  key: BrowserWeavemailKeyPair,
  maxPlaintextBytes: number
): Promise<string> {
  const envelope = normalizeWeavemailEnvelope(source, maxPlaintextBytes);
  if (!envelope || source.recipient_key_id !== key.keyId) {
    throw new Error('Private playlist WeaveMail envelope is invalid');
  }

  try {
    const encodedAesKey = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        key.privateKey,
        ownedArrayBuffer(base64UrlToBytes(envelope.encrypted_key))
      )
    );
    const aesKeyBytes = base64UrlToBytes(new TextDecoder('utf-8', { fatal: true }).decode(encodedAesKey));
    if (aesKeyBytes.length !== 32) throw new Error('Invalid WeaveMail content key');
    const aesKey = await crypto.subtle.importKey('raw', ownedArrayBuffer(aesKeyBytes), { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);
    const ciphertext = base64UrlToBytes(envelope.ciphertext);
    const tag = base64UrlToBytes(envelope.encrypted_tag);
    const sealed = new Uint8Array(ciphertext.length + tag.length);
    sealed.set(ciphertext);
    sealed.set(tag, ciphertext.length);
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: ownedArrayBuffer(base64UrlToBytes(envelope.encrypted_iv)),
          tagLength: GCM_TAG_BYTES * 8,
        },
        aesKey,
        ownedArrayBuffer(sealed)
      )
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

async function browserKeyForOwner(owner: string, create: boolean): Promise<StoredBrowserKey> {
  if (!/^[0-9A-Za-z_-]{43}$/.test(owner)) throw new Error('Private playlist owner is invalid');
  const existing = await readBrowserKey(owner);
  if (existing) return existing;
  if (!create) {
    throw new Error('This browser does not have the private key for this playlist');
  }

  const pending = keyCreationByOwner.get(owner);
  if (pending) return pending;
  const creation = createBrowserKey(owner).finally(() => keyCreationByOwner.delete(owner));
  keyCreationByOwner.set(owner, creation);
  return creation;
}

async function createBrowserKey(owner: string): Promise<StoredBrowserKey> {
  const existing = await readBrowserKey(owner);
  if (existing) return existing;
  const generated = await generateBrowserWeavemailKeyPair();
  const stored: StoredBrowserKey = { ...generated, owner, createdAt: Date.now() };
  try {
    await addBrowserKey(stored);
    return stored;
  } catch (error: any) {
    if (error?.name !== 'ConstraintError' && error?.name !== 'AbortError') throw error;
    const winner = await readBrowserKey(owner);
    if (!winner) throw error;
    return winner;
  }
}

async function readBrowserKey(owner: string): Promise<StoredBrowserKey | null> {
  const database = await browserKeyDatabase();
  const transaction = database.transaction(KEY_STORE, 'readonly');
  const result = await requestResult<StoredBrowserKey | undefined>(transaction.objectStore(KEY_STORE).get(owner));
  return validStoredKey(result, owner) ? result : null;
}

async function addBrowserKey(key: StoredBrowserKey): Promise<void> {
  const database = await browserKeyDatabase();
  const transaction = database.transaction(KEY_STORE, 'readwrite');
  transaction.objectStore(KEY_STORE).add(key);
  await transactionComplete(transaction);
}

function browserKeyDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('Browser private-key storage is unavailable');
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DATABASE, KEY_DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) {
        request.result.createObjectStore(KEY_STORE, { keyPath: 'owner' });
      }
    });
    request.addEventListener('error', () =>
      reject(request.error || new Error('Unable to open browser private-key storage'))
    );
    request.addEventListener('success', () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = undefined;
      };
      resolve(request.result);
    });
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error || new Error('Browser private-key read failed')));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () =>
      reject(transaction.error || new Error('Browser private-key write failed'))
    );
    transaction.addEventListener('abort', () =>
      reject(transaction.error || new DOMException('Browser private-key write aborted', 'AbortError'))
    );
  });
}

function validStoredKey(key: StoredBrowserKey | undefined, owner: string): key is StoredBrowserKey {
  return Boolean(
    key &&
    key.owner === owner &&
    /^[0-9A-Za-z_-]{43}$/.test(key.keyId) &&
    key.publicKey?.algorithm?.name === 'RSA-OAEP' &&
    key.privateKey?.algorithm?.name === 'RSA-OAEP' &&
    key.publicKey.usages.includes('encrypt') &&
    key.privateKey.usages.includes('decrypt') &&
    key.privateKey.extractable === false
  );
}

function base64UrlToBytes(value: string): Uint8Array {
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

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function value(source: any, ...keys: Array<string>) {
  for (const key of keys) {
    const candidate = source?.[key];
    if (candidate !== undefined && candidate !== null) return candidate;
  }
  return undefined;
}
