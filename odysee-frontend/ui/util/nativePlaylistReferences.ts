export const REFERENCE_DEVICE = 'reference@1.0';
export const NATIVE_PLAYLIST_REFERENCE_TYPE = 'odysee-playlist';

export type NativePlaylistReference = {
  device: string;
  reference_type: string;
  profile_id: string;
  profile_name?: string;
  reference_id: string;
  reference_value: string;
  timestamp: number;
  message_id: string;
  owner: string;
  is_init: boolean;
};

/**
 * Normalize the Odysee fields carried by a canonical reference@1.0 init or
 * set. Authority is always derived from the exact verified commitment; the
 * profile and reference-type fields exist only for discovery and display.
 */
export function normalizeNativePlaylistReference(source: any): NativePlaylistReference | null {
  const explicitReferenceId = optionalString(field(source, 'reference-id', 'reference_id'));
  const messageId = String(field(source, 'message-id', 'message_id', 'hyperbeam_message_id') || '').replace(/^\/+/, '');
  const owner = String(field(source, 'hyperbeam-owner', 'hyperbeam_owner', 'owner') || '');
  const authority = optionalString(field(source, 'authority'));
  const normalized: NativePlaylistReference = {
    device: String(field(source, 'device') || ''),
    reference_type: String(field(source, 'reference-type', 'reference_type') || ''),
    profile_id: String(field(source, 'profile-id', 'profile_id') || ''),
    profile_name: optionalString(field(source, 'profile-name', 'profile_name')),
    reference_id: explicitReferenceId || messageId,
    reference_value: String(field(source, 'reference-value', 'reference_value') || '').replace(/^\/+/, ''),
    timestamp: integer(field(source, 'timestamp'), -1),
    message_id: messageId,
    owner,
    is_init: !explicitReferenceId,
  };

  if (
    normalized.device !== REFERENCE_DEVICE ||
    normalized.reference_type !== NATIVE_PLAYLIST_REFERENCE_TYPE ||
    !isNativeMessageId(normalized.profile_id) ||
    !isNativeMessageId(normalized.reference_id) ||
    !isNativeMessageId(normalized.reference_value) ||
    !isNativeMessageId(normalized.message_id) ||
    !isNativeMessageId(normalized.owner) ||
    normalized.timestamp < 0 ||
    (normalized.profile_name && !boundedText(normalized.profile_name, 200)) ||
    (authority && authority !== normalized.owner) ||
    (normalized.is_init && normalized.reference_id !== normalized.message_id)
  ) {
    return null;
  }

  return normalized;
}

export function nativePlaylistReferenceInitMessage(params: {
  profileId: string;
  profileName?: string;
  snapshotId: string;
  timestamp: number;
}): Record<string, any> {
  return compact({
    device: REFERENCE_DEVICE,
    'reference-type': NATIVE_PLAYLIST_REFERENCE_TYPE,
    'profile-id': params.profileId,
    'profile-name': params.profileName,
    'reference-value': params.snapshotId,
    timestamp: params.timestamp,
  });
}

export function nativePlaylistReferenceSetMessage(params: {
  profileId: string;
  profileName?: string;
  referenceId: string;
  snapshotId: string;
  timestamp: number;
}): Record<string, any> {
  return compact({
    device: REFERENCE_DEVICE,
    'reference-type': NATIVE_PLAYLIST_REFERENCE_TYPE,
    'profile-id': params.profileId,
    'profile-name': params.profileName,
    'reference-id': params.referenceId,
    'reference-value': params.snapshotId,
    timestamp: params.timestamp,
  });
}

/**
 * Project the locally discoverable view of a reference. The canonical device
 * resolves data-layer ordering itself. Local query results do not expose that
 * ordering, so conflicting equal-timestamp sets fail closed instead of
 * guessing which one arrived first.
 */
export function projectNativePlaylistReference(
  init: NativePlaylistReference,
  candidates: Array<NativePlaylistReference>
): NativePlaylistReference {
  if (!init.is_init) return init;

  const byTimestamp = new Map<number, Array<NativePlaylistReference>>();
  candidates.forEach((candidate) => {
    if (
      candidate.is_init ||
      candidate.reference_id !== init.reference_id ||
      candidate.owner !== init.owner ||
      candidate.profile_id !== init.profile_id ||
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

export function isNativeMessageId(messageId: any): boolean {
  return /^[0-9A-Za-z_-]{43}$/.test(String(messageId || ''));
}

function field(source: any, ...keys: Array<string>): any {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
  }
}

function optionalString(source: any): string | undefined {
  return typeof source === 'string' && source ? source : undefined;
}

function integer(source: any, fallback: number): number {
  const parsed = Math.floor(Number(source));
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function boundedText(value: string, maxLength: number): boolean {
  return (
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

function compact(source: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null));
}
