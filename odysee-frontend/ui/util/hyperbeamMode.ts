import { ODYSEE_HYPERBEAM_MODE, ODYSEE_HYPERBEAM_NODE_API } from 'config';

export const HYPERBEAM_MODE_STORAGE_KEY = 'odysee-hyperbeam-mode';

export const HYPERBEAM_MODES = {
  original: 'original',
  hyperbeam: 'hyperbeam',
} as const;

export type HyperbeamMode = (typeof HYPERBEAM_MODES)[keyof typeof HYPERBEAM_MODES];

const HYPERBEAM_DEVICE_IDS = new Set([
  '~odysee@1.0',
  '~odysee-channel@1.0',
  '~odysee-claim@1.0',
  '~odysee-comment@1.0',
  '~odysee-file-reaction@1.0',
  '~odysee-file@1.0',
  '~odysee-legacy-auth@1.0',
  '~odysee-reaction@1.0',
  '~odysee-search@1.0',
  '~odysee-stream-descriptor@1.0',
  '~odysee-stream@1.0',
  '~odysee-subscription@1.0',
  '~odysee-upload-demo@1.0',
]);

export function getHyperbeamMode(): HyperbeamMode {
  if (!ODYSEE_HYPERBEAM_NODE_API) return HYPERBEAM_MODES.original;
  const configuredMode = validHyperbeamMode(ODYSEE_HYPERBEAM_MODE);
  if (configuredMode) return configuredMode;
  if (typeof window === 'undefined') return HYPERBEAM_MODES.hyperbeam;

  const value = window.localStorage.getItem(HYPERBEAM_MODE_STORAGE_KEY);
  const storedMode = validHyperbeamMode(value);
  if (storedMode) return storedMode;

  return HYPERBEAM_MODES.hyperbeam;
}

function validHyperbeamMode(value: unknown): HyperbeamMode | undefined {
  if (value === HYPERBEAM_MODES.original) return HYPERBEAM_MODES.original;
  if (value === HYPERBEAM_MODES.hyperbeam || value === 'hybrid' || value === 'demo' || value === 'local-demo') {
    return HYPERBEAM_MODES.hyperbeam;
  }
}

export function setHyperbeamMode(mode: HyperbeamMode) {
  if (typeof window === 'undefined') return;
  const normalizedMode = validHyperbeamMode(mode) || HYPERBEAM_MODES.hyperbeam;
  window.localStorage.setItem(HYPERBEAM_MODE_STORAGE_KEY, normalizedMode);
  window.dispatchEvent(new CustomEvent('odysee-hyperbeam-mode-change', { detail: normalizedMode }));
}

export function isHyperbeamEnabled() {
  return Boolean(ODYSEE_HYPERBEAM_NODE_API) && getHyperbeamMode() !== HYPERBEAM_MODES.original;
}

export function isHyperbeamFullMode() {
  return isHyperbeamEnabled();
}

export function isHyperbeamPublicReadDevice(device: string) {
  return HYPERBEAM_DEVICE_IDS.has(device);
}

export function isHyperbeamDeviceEnabled(device: string) {
  if (!isHyperbeamEnabled()) return false;
  return isHyperbeamPublicReadDevice(device);
}

export function shouldSendHyperbeamAuthHeaders() {
  return isHyperbeamEnabled();
}

export function shouldAllowOriginalNetworkFallback() {
  return !isHyperbeamEnabled();
}
