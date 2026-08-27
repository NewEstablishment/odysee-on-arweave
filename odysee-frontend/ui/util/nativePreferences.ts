export const NATIVE_PREFERENCE_SCHEMA = 'odysee-preferences@1.0';
export const NATIVE_PREFERENCE_TYPE = 'preferences';
export const NATIVE_PREFERENCE_SIGNATURE_SCOPE = 'native-preferences-v1';
export const NATIVE_PREFERENCE_REFERENCE_TYPE = 'odysee-preferences';
export const NATIVE_PREFERENCE_REFERENCE_DEVICE = 'reference@1.0';
export const NATIVE_PREFERENCE_ALGORITHM = 'aes-256-gcm';
export const NATIVE_PREFERENCE_KEY_VERSION = 1;
export const NATIVE_PREFERENCE_MAX_PLAINTEXT_BYTES = 256 * 1024;

const NATIVE_PREFERENCE_KEYS = new Set(['shared', 'local', 'enable-sync']);
const SHARED_STATE_FIELDS = new Set([
  'settings',
  'tags',
  'app_welcome_version',
  'sharing_3P',
  'lastViewedAnnouncement',
]);

export type NativePreferenceSnapshot = {
  schema: string;
  type: string;
  algorithm: string;
  key_version: number;
  encrypted_for: string;
  iv: string;
  ciphertext: string;
  tag: string;
  updated_at: number;
  signature_scope: string;
  message_id: string;
  owner: string;
};

export type NativePreferenceReference = {
  device: string;
  reference_type: string;
  preference_owner: string;
  reference_id: string;
  reference_value: string;
  timestamp: number;
  message_id: string;
  owner: string;
  is_init: boolean;
};

export type NativePreferenceEnvelope = {
  algorithm: string;
  key_version: number;
  owner: string;
  iv: string;
  ciphertext: string;
  tag: string;
};

export type NativePreferenceMap = Record<string, any>;

export type NativePreferenceState = {
  reference: NativePreferenceReference;
  snapshot: NativePreferenceSnapshot;
  preferences: NativePreferenceMap;
};

export function latestNativePreferenceState(
  discovered: NativePreferenceState | null,
  locallyVerified: NativePreferenceState | null
): NativePreferenceState | null {
  if (!discovered) return locallyVerified;
  if (!locallyVerified) return discovered;
  return locallyVerified.reference.timestamp > discovered.reference.timestamp ? locallyVerified : discovered;
}

export function normalizeNativePreferenceSnapshot(source: any): NativePreferenceSnapshot | null {
  const snapshot: NativePreferenceSnapshot = {
    schema: String(field(source, 'schema') || ''),
    type: String(field(source, 'type') || ''),
    algorithm: String(field(source, 'algorithm') || ''),
    key_version: integer(field(source, 'key-version', 'key_version'), -1),
    encrypted_for: String(field(source, 'encrypted-for', 'encrypted_for') || ''),
    iv: String(field(source, 'iv') || ''),
    ciphertext: String(field(source, 'ciphertext') || ''),
    tag: String(field(source, 'tag') || ''),
    updated_at: integer(field(source, 'updated-at', 'updated_at'), -1),
    signature_scope: String(field(source, 'signature-scope', 'signature_scope') || ''),
    message_id: String(field(source, 'message-id', 'message_id', 'hyperbeam_message_id') || '').replace(/^\/+/, ''),
    owner: String(field(source, 'hyperbeam-owner', 'hyperbeam_owner', 'owner') || ''),
  };

  if (
    snapshot.schema !== NATIVE_PREFERENCE_SCHEMA ||
    snapshot.type !== NATIVE_PREFERENCE_TYPE ||
    snapshot.algorithm !== NATIVE_PREFERENCE_ALGORITHM ||
    snapshot.key_version !== NATIVE_PREFERENCE_KEY_VERSION ||
    snapshot.signature_scope !== NATIVE_PREFERENCE_SIGNATURE_SCOPE ||
    !isNativeMessageId(snapshot.encrypted_for) ||
    snapshot.encrypted_for !== snapshot.owner ||
    !isNativeMessageId(snapshot.message_id) ||
    !isNativeMessageId(snapshot.owner) ||
    snapshot.updated_at < 0 ||
    !encodedBytes(snapshot.iv, 12, 12) ||
    !encodedBytes(snapshot.tag, 16, 16) ||
    !encodedBytes(snapshot.ciphertext, 1, NATIVE_PREFERENCE_MAX_PLAINTEXT_BYTES)
  ) {
    return null;
  }

  return snapshot;
}

export function nativePreferenceSnapshotMessage(
  envelope: NativePreferenceEnvelope,
  timestamp: number
): Record<string, any> {
  if (
    envelope.algorithm !== NATIVE_PREFERENCE_ALGORITHM ||
    envelope.key_version !== NATIVE_PREFERENCE_KEY_VERSION ||
    !isNativeMessageId(envelope.owner) ||
    !encodedBytes(envelope.iv, 12, 12) ||
    !encodedBytes(envelope.tag, 16, 16) ||
    !encodedBytes(envelope.ciphertext, 1, NATIVE_PREFERENCE_MAX_PLAINTEXT_BYTES) ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0
  ) {
    throw new Error('Native preference encryption envelope is invalid');
  }

  return {
    schema: NATIVE_PREFERENCE_SCHEMA,
    type: NATIVE_PREFERENCE_TYPE,
    algorithm: envelope.algorithm,
    'key-version': envelope.key_version,
    'encrypted-for': envelope.owner,
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
    tag: envelope.tag,
    'updated-at': timestamp,
    'signature-scope': NATIVE_PREFERENCE_SIGNATURE_SCOPE,
  };
}

export function normalizeNativePreferenceReference(source: any): NativePreferenceReference | null {
  const explicitReferenceId = optionalString(field(source, 'reference-id', 'reference_id'));
  const messageId = String(field(source, 'message-id', 'message_id', 'hyperbeam_message_id') || '').replace(/^\/+/, '');
  const owner = String(field(source, 'hyperbeam-owner', 'hyperbeam_owner', 'owner') || '');
  const preferenceOwner = String(field(source, 'preference-owner', 'preference_owner') || '');
  const authority = optionalString(field(source, 'authority'));
  const reference: NativePreferenceReference = {
    device: String(field(source, 'device') || ''),
    reference_type: String(field(source, 'reference-type', 'reference_type') || ''),
    preference_owner: preferenceOwner,
    reference_id: explicitReferenceId || messageId,
    reference_value: String(field(source, 'reference-value', 'reference_value') || '').replace(/^\/+/, ''),
    timestamp: integer(field(source, 'timestamp'), -1),
    message_id: messageId,
    owner,
    is_init: !explicitReferenceId,
  };

  if (
    reference.device !== NATIVE_PREFERENCE_REFERENCE_DEVICE ||
    reference.reference_type !== NATIVE_PREFERENCE_REFERENCE_TYPE ||
    !isNativeMessageId(reference.preference_owner) ||
    reference.preference_owner !== reference.owner ||
    !isNativeMessageId(reference.reference_id) ||
    !isNativeMessageId(reference.reference_value) ||
    !isNativeMessageId(reference.message_id) ||
    !isNativeMessageId(reference.owner) ||
    reference.timestamp < 0 ||
    (authority && authority !== reference.owner) ||
    (reference.is_init && reference.reference_id !== reference.message_id)
  ) {
    return null;
  }

  return reference;
}

export function nativePreferenceReferenceInitMessage(
  snapshotId: string,
  timestamp: number,
  owner: string
): Record<string, any> {
  assertReferenceFields(snapshotId, timestamp, owner);
  return {
    device: NATIVE_PREFERENCE_REFERENCE_DEVICE,
    'reference-type': NATIVE_PREFERENCE_REFERENCE_TYPE,
    'preference-owner': owner,
    'reference-value': snapshotId,
    timestamp,
  };
}

export function nativePreferenceReferenceSetMessage(
  referenceId: string,
  snapshotId: string,
  timestamp: number,
  owner: string
): Record<string, any> {
  if (!isNativeMessageId(referenceId)) throw new Error('Native preference reference ID is invalid');
  return {
    ...nativePreferenceReferenceInitMessage(snapshotId, timestamp, owner),
    'reference-id': referenceId,
  };
}

export function canonicalNativePreferenceReference(
  references: Array<NativePreferenceReference>,
  owner: string
): NativePreferenceReference | null {
  return (
    references
      .filter((reference) => reference.is_init && reference.owner === owner)
      .sort((left, right) => left.timestamp - right.timestamp || left.message_id.localeCompare(right.message_id))[0] ||
    null
  );
}

export function projectNativePreferenceReference(
  init: NativePreferenceReference,
  candidates: Array<NativePreferenceReference>
): NativePreferenceReference {
  if (!init.is_init) return init;

  const byTimestamp = new Map<number, Array<NativePreferenceReference>>();
  candidates.forEach((candidate) => {
    if (
      candidate.is_init ||
      candidate.reference_id !== init.reference_id ||
      candidate.owner !== init.owner ||
      candidate.timestamp <= init.timestamp
    ) {
      return;
    }
    const group = byTimestamp.get(candidate.timestamp) || [];
    group.push(candidate);
    byTimestamp.set(candidate.timestamp, group);
  });

  let head = init;
  Array.from(byTimestamp.keys())
    .sort((left, right) => left - right)
    .forEach((timestamp) => {
      if (timestamp <= head.timestamp) return;
      const group = byTimestamp.get(timestamp) || [];
      const values = new Set(group.map((candidate) => candidate.reference_value));
      if (values.size !== 1) return;
      const next = group.slice().sort((left, right) => left.message_id.localeCompare(right.message_id))[0];
      if (next) head = next;
    });
  return head;
}

export function normalizeNativePreferenceKey(key: any): string {
  const normalized = String(key || '');
  if (!NATIVE_PREFERENCE_KEYS.has(normalized)) throw new Error(`Unsupported native preference key: ${normalized}`);
  return normalized;
}

export function normalizeNativePreferenceValue(key: string, value: any): any {
  const normalizedKey = normalizeNativePreferenceKey(key);
  if (normalizedKey === 'enable-sync') {
    if (typeof value !== 'boolean') throw new Error('The enable-sync preference must be boolean');
    return value;
  }

  const parsed = typeof value === 'string' ? parseJson(value) : value;
  if (!isRecord(parsed) || parsed.version !== '0.1' || parsed.type !== 'object' || !isRecord(parsed.value)) {
    throw new Error(`${normalizedKey} preferences must use the shared-state 0.1 object format`);
  }

  const sanitizedValue: Record<string, any> = {};
  SHARED_STATE_FIELDS.forEach((fieldName) => {
    if (Object.prototype.hasOwnProperty.call(parsed.value, fieldName)) {
      sanitizedValue[fieldName] = cloneJson(parsed.value[fieldName]);
    }
  });
  const normalized = { type: 'object', version: '0.1', value: sanitizedValue };
  assertBoundedJson(normalized);
  return normalized;
}

export function nativePreferencePlaintext(preferences: NativePreferenceMap): string {
  const normalized: NativePreferenceMap = {};
  Object.entries(preferences || {}).forEach(([key, value]) => {
    normalized[normalizeNativePreferenceKey(key)] = normalizeNativePreferenceValue(key, value);
  });
  return boundedJson(normalized);
}

export function parseNativePreferencePlaintext(plaintext: any): NativePreferenceMap | null {
  const parsed = parseJson(String(plaintext || ''));
  if (!isRecord(parsed)) return null;
  try {
    const normalized: NativePreferenceMap = {};
    Object.entries(parsed).forEach(([key, value]) => {
      normalized[normalizeNativePreferenceKey(key)] = normalizeNativePreferenceValue(key, value);
    });
    return normalized;
  } catch (_error) {
    return null;
  }
}

function boundedJson(value: any): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') throw new Error('Preference value must be JSON-compatible');
  if (new TextEncoder().encode(serialized).length > NATIVE_PREFERENCE_MAX_PLAINTEXT_BYTES) {
    throw new Error('Native preferences exceed the 256 KiB limit');
  }
  return serialized;
}

function assertBoundedJson(value: any) {
  boundedJson(value);
}

function cloneJson(value: any): any {
  const serialized = boundedJson(value);
  const cloned = parseJson(serialized);
  if (cloned === undefined) throw new Error('Preference value must be JSON-compatible');
  return cloned;
}

function parseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return undefined;
  }
}

function encodedBytes(value: string, minBytes: number, maxBytes: number): boolean {
  if (!/^[0-9A-Za-z_-]+$/.test(value)) return false;
  if (value.length % 4 === 1) return false;
  const byteLength = Math.floor((value.length * 3) / 4);
  return byteLength >= minBytes && byteLength <= maxBytes;
}

function assertReferenceFields(snapshotId: string, timestamp: number, owner: string) {
  if (
    !isNativeMessageId(snapshotId) ||
    !isNativeMessageId(owner) ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0
  ) {
    throw new Error('Native preference reference fields are invalid');
  }
}

function isRecord(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNativeMessageId(messageId: any): boolean {
  return /^[0-9A-Za-z_-]{43}$/.test(String(messageId || ''));
}

function field(source: any, ...keys: Array<string>): any {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
  }
}

function optionalString(value: any): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function integer(value: any, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}
