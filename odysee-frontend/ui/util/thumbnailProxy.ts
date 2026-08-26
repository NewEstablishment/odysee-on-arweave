export function directImageUrl(source: string, trustedBases: Array<string> = []): string | null {
  const value = String(source || '').trim();
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

  return isPrivateHostname(candidate.hostname) ? candidate.toString() : null;
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
