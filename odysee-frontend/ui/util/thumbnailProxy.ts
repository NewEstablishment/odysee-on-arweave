const THUMBNAIL_PROXY_HOST = 'thumbnails.odycdn.com';

export function unwrapThumbnailProxyUrl(source: string): string | null {
  const value = String(source || '').trim();
  const marker = '/plain/';

  try {
    const url = new URL(value);
    const markerIndex = value.indexOf(marker);
    if (url.hostname !== THUMBNAIL_PROXY_HOST || markerIndex === -1) return null;

    const innerUrl = value.slice(markerIndex + marker.length);
    return /^https?:\/\//i.test(innerUrl) ? innerUrl : null;
  } catch {
    return null;
  }
}

export function directImageUrl(source: string, trustedBases: Array<string> = [], allowRemote = false): string | null {
  const rawValue = String(source || '').trim();
  const value = (allowRemote && unwrapThumbnailProxyUrl(rawValue)) || rawValue;
  if (!value) return null;
  if (value.startsWith('/') || value.startsWith('data:') || value.startsWith('blob:')) return value;

  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(candidate.protocol)) return value;

  for (const base of trustedBases) {
    try {
      const trusted = new URL(base);
      if (trusted.host === candidate.host) {
        candidate.protocol = trusted.protocol;
        return candidate.toString();
      }
    } catch {}
  }

  if (isPrivateHostname(candidate.hostname)) return candidate.toString();
  if (!allowRemote) return null;
  if (candidate.protocol === 'http:') candidate.protocol = 'https:';
  return candidate.toString();
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;

  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}
