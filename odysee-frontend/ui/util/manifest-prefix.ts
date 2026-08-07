// When the static build is served from a HyperBEAM node via the Arweave
// path-manifest device, the app lives under /<ManifestID>/... where the ID is
// a 43-character base64url transaction ID that cannot be known at build time.
// Keep the regex in sync with the inline <base> bootstrap script in index.html.
type ManifestWindow = Window & { __ODYSEE_MANIFEST_PREFIX__?: string };

const MANIFEST_ID_REGEX = /^\/([A-Za-z0-9_-]{43})(?=\/|$)/;

const injectedPrefix = typeof window === 'undefined' ? '' : (window as ManifestWindow).__ODYSEE_MANIFEST_PREFIX__ || '';
const detectedPrefix = /^\/[A-Za-z0-9_-]{43}$/.test(injectedPrefix)
  ? injectedPrefix
  : typeof window === 'undefined'
    ? ''
    : window.location.pathname.match(MANIFEST_ID_REGEX)?.[0] || '';

// Returns '/<ManifestID>' when served from a path manifest, otherwise ''.
export function manifestPrefix(): string {
  return detectedPrefix;
}

export function isServedFromManifest(): boolean {
  return detectedPrefix !== '';
}

export function manifestAssetPath(assetPath: string): string {
  return `${detectedPrefix}/${assetPath.replace(/^\/+/, '')}`;
}
