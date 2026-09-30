// Product metadata only. Image ownership is not upload/profile authority.
export type NativeThumbnail = { thumbnail_id?: string; thumbnail_url?: string };
const IMAGE_ID = /^[A-Za-z0-9_-]{43}$/;

// Both representations form one field: a later URL/clear must not inherit an
// earlier ID, and a later ID must not inherit an earlier remote URL.
export function readNativeThumbnail(payload: Record<string, any>): NativeThumbnail | null {
  const id = payload['thumbnail-id'] ?? payload.thumbnail_id;
  const url = payload['thumbnail-url'] ?? payload.thumbnail_url;
  if (id === undefined && url === undefined) return {};
  if (id !== undefined && (typeof id !== 'string' || (id !== '' && !IMAGE_ID.test(id)))) return null;
  if (url !== undefined && typeof url !== 'string') return null;
  if (id && url) return null;
  return { thumbnail_id: id || '', thumbnail_url: url || '' };
}

export function nativeThumbnailForWrite(metadata: NativeThumbnail, nodeBase: string): NativeThumbnail {
  const parsed = readNativeThumbnail(metadata);
  if (!parsed) throw new Error('Invalid or conflicting thumbnail reference.');
  if (parsed.thumbnail_id || !parsed.thumbnail_url) return parsed;
  const base = nodeBase.replace(/\/+$/, '');
  const prefix = `${base}/`;
  // Only our exact configured-node URL shape is convertible. Never guess from
  // an arbitrary remote URL's last segment, query, fragment or credential URL.
  if (base && parsed.thumbnail_url.startsWith(prefix)) {
    const id = parsed.thumbnail_url.slice(prefix.length);
    if (IMAGE_ID.test(id)) return { thumbnail_id: id, thumbnail_url: '' };
  }
  return parsed;
}

export function nativeThumbnailUrl(metadata: NativeThumbnail, nodeBase: string): string {
  const parsed = readNativeThumbnail(metadata);
  if (!parsed) return '';
  return parsed.thumbnail_id ? `${nodeBase.replace(/\/+$/, '')}/${parsed.thumbnail_id}` : parsed.thumbnail_url || '';
}
