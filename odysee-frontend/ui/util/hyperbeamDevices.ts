import { ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { isHyperbeamDeviceEnabled, isHyperbeamFullMode } from 'util/hyperbeamMode';
import { getAuthToken } from 'util/saved-passwords';

export const HYPERBEAM_DEVICE = {
  claim: '~odysee-claim@1.0',
  channel: '~odysee-channel@1.0',
  comment: '~odysee-comment@1.0',
  file: '~odysee-file@1.0',
  fileReaction: '~odysee-file-reaction@1.0',
  productEvents: '~odysee-product-events@1.0',
  reaction: '~odysee-reaction@1.0',
  stream: '~odysee-stream@1.0',
  streamDescriptor: '~odysee-stream-descriptor@1.0',
  subscription: '~odysee-subscription@1.0',
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
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...authTokenHeader(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function authTokenHeader(): Record<string, string> {
  const token = getAuthToken();
  return token ? { 'x-odysee-auth-token': token } : {};
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
  void method;
  void value;
  void headers;
  void paramName;
  return null;
}

const HYPERBEAM_ROUTED_METHODS = new Set([
  'resolve',
  'claim_search',
  'get',
  'stream_list',
  'blob_list',
  'comment_list',
  'comment_by_id',
  'comment_get_channel_from_comment_id',
  'reaction_list',
  'setting_get',
  'setting_list',
  'commentron',
]);

export function isHyperbeamMethodEnabled(method: string) {
  return isHyperbeamFullMode() && HYPERBEAM_ROUTED_METHODS.has(method);
}

export function hyperbeamMethodDevice(method: string) {
  void method;
  return HYPERBEAM_DEVICE.claim;
}
