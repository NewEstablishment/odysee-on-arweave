import { field, isNativeMessageId, normalizeMessageId } from './nativeMessageFields.ts';
import {
  NATIVE_PLAYLIST_SCHEMA,
  NATIVE_PLAYLIST_SIGNATURE_SCOPE,
  NATIVE_PLAYLIST_TYPE,
  normalizeNativePlaylist,
  type NativePlaylist,
} from './nativePlaylists.ts';
import { normalizeWeavemailEnvelope, WEAVEMAIL_FORMAT, type WeavemailEnvelope } from './weavemail.ts';

export const NATIVE_PRIVATE_PLAYLIST_SCHEMA = 'odysee-private-playlist@1.0';
export const NATIVE_PRIVATE_PLAYLIST_TYPE = 'private-playlist';
export const NATIVE_PRIVATE_PLAYLIST_SIGNATURE_SCOPE = 'native-private-playlist-v1';
export const NATIVE_PRIVATE_PLAYLIST_PAYLOAD_SCHEMA = 'odysee-private-playlist-payload@1.0';
export const NATIVE_PRIVATE_PLAYLIST_PAYLOAD_SIGNATURE_SCOPE = 'native-private-playlist-payload-v1';
export const NATIVE_PRIVATE_PLAYLIST_PURPOSE = 'playlist';
export const NATIVE_PRIVATE_PLAYLIST_ENCRYPTION_FORMAT = WEAVEMAIL_FORMAT;
export const NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES = 256 * 1024;

export type NativePrivatePlaylistEnvelope = WeavemailEnvelope & {
  encryption_format: string;
  purpose: string;
  owner: string;
};

export type NativePrivatePlaylistSnapshot = NativePrivatePlaylistEnvelope & {
  schema: string;
  type: string;
  encrypted_for: string;
  signature_scope: string;
  message_id: string;
};

export function normalizeNativePrivatePlaylistEnvelope(source: any): NativePrivatePlaylistEnvelope | null {
  const weavemail = normalizeWeavemailEnvelope(source, NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES);
  if (!weavemail) return null;
  const envelope: NativePrivatePlaylistEnvelope = {
    ...weavemail,
    encryption_format: String(field(source, 'encryption-format', 'encryption_format') || ''),
    purpose: String(field(source, 'purpose') || ''),
    owner: String(field(source, 'hyperbeam-owner', 'hyperbeam_owner', 'owner', 'encrypted-for', 'encrypted_for') || ''),
  };

  return validEnvelope(envelope) ? envelope : null;
}

export function normalizeNativePrivatePlaylistSnapshot(source: any): NativePrivatePlaylistSnapshot | null {
  const envelope = normalizeNativePrivatePlaylistEnvelope(source);
  if (!envelope) return null;
  const snapshot: NativePrivatePlaylistSnapshot = {
    ...envelope,
    schema: String(field(source, 'schema') || ''),
    type: String(field(source, 'type') || ''),
    encrypted_for: String(field(source, 'encrypted-for', 'encrypted_for') || ''),
    signature_scope: String(field(source, 'signature-scope', 'signature_scope') || ''),
    message_id: normalizeMessageId(field(source, 'message-id', 'message_id', 'hyperbeam_message_id')),
  };

  if (
    snapshot.schema !== NATIVE_PRIVATE_PLAYLIST_SCHEMA ||
    snapshot.type !== NATIVE_PRIVATE_PLAYLIST_TYPE ||
    snapshot.signature_scope !== NATIVE_PRIVATE_PLAYLIST_SIGNATURE_SCOPE ||
    snapshot.encrypted_for !== snapshot.owner ||
    !isNativeMessageId(snapshot.message_id)
  ) {
    return null;
  }
  return snapshot;
}

export function nativePrivatePlaylistSnapshotMessage(envelope: NativePrivatePlaylistEnvelope): Record<string, any> {
  if (!validEnvelope(envelope)) throw new Error('Private playlist encryption envelope is invalid');
  return {
    schema: NATIVE_PRIVATE_PLAYLIST_SCHEMA,
    type: NATIVE_PRIVATE_PLAYLIST_TYPE,
    purpose: NATIVE_PRIVATE_PLAYLIST_PURPOSE,
    'encryption-format': envelope.encryption_format,
    'encrypted-for': envelope.owner,
    ciphertext: envelope.ciphertext,
    'encrypted-key': envelope.encrypted_key,
    'encrypted-iv': envelope.encrypted_iv,
    'encrypted-tag': envelope.encrypted_tag,
    'signature-scope': NATIVE_PRIVATE_PLAYLIST_SIGNATURE_SCOPE,
  };
}

export function nativePrivatePlaylistPlaintext(publicMessage: Record<string, any>): string {
  const payload = {
    ...publicMessage,
    schema: NATIVE_PRIVATE_PLAYLIST_PAYLOAD_SCHEMA,
    type: NATIVE_PRIVATE_PLAYLIST_TYPE,
    'signature-scope': NATIVE_PRIVATE_PLAYLIST_PAYLOAD_SIGNATURE_SCOPE,
  };
  const plaintext = JSON.stringify(payload);
  if (new TextEncoder().encode(plaintext).length > NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES) {
    throw new Error('Private playlist exceeds the encrypted payload limit');
  }
  return plaintext;
}

export function parseNativePrivatePlaylistPlaintext(
  plaintext: any,
  snapshot: NativePrivatePlaylistSnapshot
): NativePlaylist | null {
  if (typeof plaintext !== 'string') return null;
  if (new TextEncoder().encode(plaintext).length > NATIVE_PRIVATE_PLAYLIST_MAX_PLAINTEXT_BYTES) return null;
  try {
    const payload = JSON.parse(plaintext);
    if (
      !payload ||
      Array.isArray(payload) ||
      payload.schema !== NATIVE_PRIVATE_PLAYLIST_PAYLOAD_SCHEMA ||
      payload.type !== NATIVE_PRIVATE_PLAYLIST_TYPE ||
      field(payload, 'signature-scope', 'signature_scope') !== NATIVE_PRIVATE_PLAYLIST_PAYLOAD_SIGNATURE_SCOPE
    ) {
      return null;
    }
    const playlist = normalizeNativePlaylist({
      ...payload,
      schema: NATIVE_PLAYLIST_SCHEMA,
      type: NATIVE_PLAYLIST_TYPE,
      'signature-scope': NATIVE_PLAYLIST_SIGNATURE_SCOPE,
      'message-id': snapshot.message_id,
      'hyperbeam-owner': snapshot.owner,
    });
    return playlist
      ? {
          ...playlist,
          visibility: 'private',
          storage_schema: snapshot.schema,
        }
      : null;
  } catch {
    return null;
  }
}

function validEnvelope(envelope: NativePrivatePlaylistEnvelope): boolean {
  return Boolean(
    envelope.encryption_format === NATIVE_PRIVATE_PLAYLIST_ENCRYPTION_FORMAT &&
    envelope.purpose === NATIVE_PRIVATE_PLAYLIST_PURPOSE &&
    isNativeMessageId(envelope.owner)
  );
}
