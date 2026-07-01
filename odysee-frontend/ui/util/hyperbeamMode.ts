import { HYPERBEAM_ALLOW_COMPATIBILITY_READS, ODYSEE_HYPERBEAM_NODE_API } from 'config';

export const HYPERBEAM_MODE_STORAGE_KEY = 'odysee-hyperbeam-mode';

export const HYPERBEAM_MODES = {
  original: 'original',
  hyperbeam: 'hyperbeam',
} as const;

export type HyperbeamMode = (typeof HYPERBEAM_MODES)[keyof typeof HYPERBEAM_MODES];

const CANONICAL_NATIVE_DEVICES = new Set([
  '~odysee-claim@1.0',
  '~odysee-channel@1.0',
  '~odysee-comment@1.0',
  '~odysee-file@1.0',
  '~odysee-file-reaction@1.0',
  '~odysee-reaction@1.0',
  '~odysee-stream@1.0',
  '~odysee-subscription@1.0',
]);
const CANONICAL_NATIVE_SOURCE_DEVICES = new Set(['~odysee@1.0']);
const CANONICAL_WRITE_DEVICES = new Set([
  '~cache@1.0',
  '~odysee-index@1.0',
  '~odysee-upload@1.0',
  '~odysee-user-state@1.0',
]);

export function getHyperbeamMode(): HyperbeamMode {
  if (!ODYSEE_HYPERBEAM_NODE_API) return HYPERBEAM_MODES.original;
  if (typeof window === 'undefined') return HYPERBEAM_MODES.hyperbeam;

  const value = window.localStorage.getItem(HYPERBEAM_MODE_STORAGE_KEY);
  if (value === 'hybrid') return HYPERBEAM_MODES.hyperbeam;
  if (value === HYPERBEAM_MODES.original || value === HYPERBEAM_MODES.hyperbeam) {
    return value;
  }

  return HYPERBEAM_MODES.hyperbeam;
}

export function setHyperbeamMode(mode: HyperbeamMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(HYPERBEAM_MODE_STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent('odysee-hyperbeam-mode-change', { detail: mode }));
}

export function isHyperbeamEnabled() {
  return Boolean(ODYSEE_HYPERBEAM_NODE_API) && getHyperbeamMode() !== HYPERBEAM_MODES.original;
}

export function isHyperbeamFullMode() {
  return Boolean(ODYSEE_HYPERBEAM_NODE_API) && getHyperbeamMode() === HYPERBEAM_MODES.hyperbeam;
}

export function allowHyperbeamCompatibilityReads() {
  return HYPERBEAM_ALLOW_COMPATIBILITY_READS !== false;
}

export function isHyperbeamPublicReadDevice(device: string) {
  return allowHyperbeamCompatibilityReads() && CANONICAL_NATIVE_DEVICES.has(device);
}

export function isHyperbeamDeviceEnabled(device: string) {
  if (!isHyperbeamEnabled()) return false;
  return (
    CANONICAL_NATIVE_SOURCE_DEVICES.has(device) ||
    isHyperbeamPublicReadDevice(device) ||
    CANONICAL_WRITE_DEVICES.has(device)
  );
}

export function shouldSendHyperbeamAuthHeaders() {
  return false;
}

export function shouldAllowOriginalNetworkFallback() {
  return !isHyperbeamEnabled();
}
