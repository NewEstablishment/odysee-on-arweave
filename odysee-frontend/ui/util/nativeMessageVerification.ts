export type NativeMessagePayload = Record<string, any>;

export type VerifiedNativeMessage<T extends NativeMessagePayload = NativeMessagePayload> = {
  messageId: string;
  payload: T;
  owner: string;
  committers: Array<string>;
};

export type NativeMessageVerificationDependencies<T extends NativeMessagePayload = NativeMessagePayload> = {
  loadPayload: (messageId: string) => Promise<T | null>;
  verifyCommitment: (messageId: string) => Promise<boolean>;
  loadCommitter: (messageId: string) => Promise<string | null>;
};

export async function verifyNativeMessage<T extends NativeMessagePayload = NativeMessagePayload>(
  messageId: string,
  dependencies: NativeMessageVerificationDependencies<T>,
  knownPayload?: T | null
): Promise<VerifiedNativeMessage<T> | null> {
  const normalizedId = String(messageId || '').replace(/^\/+/, '');
  if (!isNativeMessageId(normalizedId)) return null;

  try {
    const [payload, verified, rawCommitter] = await Promise.all([
      knownPayload || dependencies.loadPayload(normalizedId),
      dependencies.verifyCommitment(normalizedId),
      dependencies.loadCommitter(normalizedId),
    ]);
    const owner = normalizeCommitter(rawCommitter);
    if (!payload || verified !== true || !owner) return null;

    return {
      messageId: normalizedId,
      payload,
      owner,
      committers: [owner],
    };
  } catch (_error) {
    return null;
  }
}

export function isNativeMessageId(messageId: any): boolean {
  return /^[0-9A-Za-z_-]{41,128}$/.test(String(messageId || ''));
}

export function nativeMessageVersionRef(): string {
  const cryptoObject = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  if (cryptoObject?.getRandomValues) {
    const bytes = cryptoObject.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure randomness is unavailable for the native message version reference.');
}

function normalizeCommitter(committer: any): string {
  const normalized = String(committer || '')
    .replace(/^"|"$/g, '')
    .trim();
  return normalized && normalized.length <= 1024 ? normalized : '';
}
