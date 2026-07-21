type ManifestWindow = Window & { __ODYSEE_MANIFEST_PREFIX__?: string };

const MANIFEST_PREFIX_REGEX = /^\/[A-Za-z0-9_-]{43}$/;
const injectedPrefix = typeof window === 'undefined' ? '' : (window as ManifestWindow).__ODYSEE_MANIFEST_PREFIX__ || '';
const detectedPrefix = MANIFEST_PREFIX_REGEX.test(injectedPrefix) ? injectedPrefix : '';

export function manifestPrefix(): string {
  return detectedPrefix;
}

export function isServedFromManifest(): boolean {
  return Boolean(detectedPrefix);
}

export function manifestAssetPath(assetPath: string): string {
  return `${detectedPrefix}/${assetPath.replace(/^\/+/, '')}`;
}
