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

// An in-app path as a URL the browser can open directly. Under a path
// manifest the app is hash-routed beneath /<ManifestID>, so a bare app
// path (`/$/id/...`) would leave the manifest and 404 on the node.
export function appHref(appPath: string): string {
  if (!detectedPrefix) return appPath;
  const path = appPath.startsWith('/') ? appPath : `/${appPath}`;
  return `${detectedPrefix}/#${path}`;
}

export function manifestAssetPath(assetPath: string): string {
  return `${detectedPrefix}/${assetPath.replace(/^\/+/, '')}`;
}
