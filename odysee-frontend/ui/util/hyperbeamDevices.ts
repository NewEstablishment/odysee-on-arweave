import { ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { isHyperbeamDeviceEnabled, isHyperbeamFullMode } from 'util/hyperbeamMode';

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
  sync: '~odysee-sync@1.0',
  upload: '~odysee-upload@1.0',
  userState: '~odysee-user-state@1.0',
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
  const { path, fields } = hyperbeamKeyFields(key);

  return fetch(`${base}/${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ ...fields, ...body }),
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

function hyperbeamKeyFields(key: string) {
  const [path, ...parts] = key.split('&');
  const fields = parts.reduce<Record<string, any>>((acc, part) => {
    if (!part) return acc;

    const equals = part.indexOf('=');
    const name = decodeURIComponent(equals === -1 ? part : part.slice(0, equals));
    const value = equals === -1 ? true : decodeURIComponent(part.slice(equals + 1));
    acc[name] = value;
    return acc;
  }, {});

  return { path, fields };
}

export function hyperbeamSdkPostParams64(
  method: string,
  value: any,
  headers: Record<string, string> = {},
  paramName = 'params64'
) {
  return hyperbeamDevicePostParams64(
    HYPERBEAM_DEVICE.userState,
    'call&!',
    {
      kind: 'sdk',
      method,
      params: value || {},
    },
    headers,
    paramName
  );
}

const HYPERBEAM_ROUTED_METHODS = new Set([
  'resolve',
  'claim_search',
  'get',
  'stream_list',
  'blob_list',
  'channel_sign',
  'comment_list',
  'comment_by_id',
  'comment_get_channel_from_comment_id',
  'collection_create',
  'collection_list',
  'collection_update',
  'preference_get',
  'preference_set',
  'reaction_list',
  'settings_clear',
  'settings_get',
  'settings_set',
  'setting_get',
  'setting_list',
  'sync_apply',
  'sync_hash',
  'commentron',
]);

export function isHyperbeamMethodEnabled(method: string) {
  return isHyperbeamFullMode() && HYPERBEAM_ROUTED_METHODS.has(method);
}

export function hyperbeamMethodDevice(method: string) {
  if (
    method === 'channel_sign' ||
    method === 'collection_create' ||
    method === 'collection_list' ||
    method === 'collection_update' ||
    method === 'preference_get' ||
    method === 'preference_set' ||
    method === 'settings_clear' ||
    method === 'settings_get' ||
    method === 'settings_set' ||
    method === 'sync_apply' ||
    method === 'sync_hash'
  ) {
    return HYPERBEAM_DEVICE.userState;
  }

  return HYPERBEAM_DEVICE.claim;
}
