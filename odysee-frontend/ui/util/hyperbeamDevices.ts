import { ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { isHyperbeamDeviceEnabled, isHyperbeamEnabled } from 'util/hyperbeamMode';

export const HYPERBEAM_DEVICE = {
  odysee: '~odysee@1.0',
  claim: '~odysee-claim@1.0',
  channel: '~odysee-channel@1.0',
  comment: '~odysee-comment@1.0',
  file: '~odysee-file@1.0',
  fileReaction: '~odysee-file-reaction@1.0',
  internalApis: '~odysee-internal-apis@1.0',
  legacyAuth: '~odysee-legacy-auth@1.0',
  livestream: '~odysee-livestream@1.0',
  productEvents: '~odysee-product-events@1.0',
  reaction: '~odysee-reaction@1.0',
  search: '~odysee-search@1.0',
  stream: '~odysee-stream@1.0',
  streamDescriptor: '~odysee-stream-descriptor@1.0',
  subscription: '~odysee-subscription@1.0',
  uploadDemo: '~odysee-upload-demo@1.0',
};

export function hyperbeamNodeBase() {
  return String(ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
}

export function hyperbeamDeviceBase(device: string) {
  const base = hyperbeamNodeBase();
  return base && isHyperbeamDeviceEnabled(device) ? `${base}/${device}` : '';
}

export function hyperbeamDeviceUrl(device: string, key: string, params: Record<string, string>) {
  const base = hyperbeamDeviceBase(device);
  if (!base) return '';

  const query = Object.entries(params)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('&');
  return `${base}/${key}${query ? `?${query}` : ''}`;
}

export function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function hyperbeamDevicePostJson(
  device: string,
  key: string,
  body: Record<string, any>,
  headers: Record<string, string> = {}
) {
  const base = hyperbeamDeviceBase(device);
  if (!base) return null;

  return fetch(`${base}/${key}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export function hyperbeamDevicePostParams64(
  device: string,
  key: string,
  value: any,
  headers: Record<string, string> = {},
  paramName = 'params64'
) {
  return hyperbeamDevicePostJson(device, key, { [paramName]: base64Url(JSON.stringify(value || {})) }, headers);
}

export function hyperbeamSdkPostParams64(
  method: string,
  value: any,
  headers: Record<string, string> = {},
  paramName = 'params64'
) {
  const base = hyperbeamDeviceBase(HYPERBEAM_DEVICE.odysee);
  if (!base) return null;

  const params = paramName === 'urls64' ? { urls: value } : value || {};
  const params64 = base64Url(JSON.stringify(params));

  return fetch(`${base}/sdk?sdk-method=${encodeURIComponent(method)}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ params64 }),
  });
}

export function isHyperbeamMethodEnabled(method: string) {
  void method;
  return isHyperbeamEnabled();
}

export function hyperbeamMethodDevice(method: string) {
  void method;
  return HYPERBEAM_DEVICE.odysee;
}
