import { HYPERBEAM_BASE_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { isHyperbeamDeviceEnabled } from 'util/hyperbeamRouting';
import { getAuthToken } from 'util/saved-passwords';
import { isServedFromManifest } from 'util/manifest-prefix';
import { resolveHyperbeamNodeBase } from 'util/hyperbeamNode';

export const HYPERBEAM_DEVICE = {
  account: '~odysee-account@1.0',
  analytics: '~analytics@1.0',
  cache: '~cache@1.0',
  claim: '~odysee-claim@1.0',
  channel: '~odysee-channel@1.0',
  comment: '~odysee-comment@1.0',
  file: '~odysee-file@1.0',
  fileReaction: '~odysee-file-reaction@1.0',
  preference: '~odysee-preference@1.0',
  reaction: '~odysee-reaction@1.0',
  query: '~query@1.0',
  search: '~search@1.0',
  stream: '~odysee-stream@1.0',
  streamDescriptor: '~odysee-stream-descriptor@1.0',
  upload: '~odysee-upload@1.0',
};

export function hyperbeamNodeBase() {
  return resolveHyperbeamNodeBase({
    manifestOrigin: typeof window !== 'undefined' && isServedFromManifest() ? window.location.origin : '',
    baseUrl: HYPERBEAM_BASE_URL,
    nodeApi: ODYSEE_HYPERBEAM_NODE_API,
  });
}

export function hyperbeamNodeEnabled() {
  return Boolean(hyperbeamNodeBase());
}

// On a HyperBEAM node the write API is a cookie-authed commit, not the legacy
// verified-email account. Uploads work without that account, so treat the node
// being present as upload being available. Scoped to the upload path only; do
// NOT fold this into the app-wide verified-email gate.
export function hyperbeamUploadEnabled() {
  return hyperbeamNodeEnabled();
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
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...authTokenHeader(),
      ...headers,
    },
    body: JSON.stringify({ ...fields, ...body }),
  });
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
  'comment_abandon',
  'comment_create',
  'comment_edit',
  'comment_pin',
  'comment_get_channel_from_comment_id',
  'moderation_add_delegate',
  'moderation_am_i',
  'moderation_block',
  'moderation_block_list',
  'moderation_list_delegates',
  'moderation_remove_delegate',
  'moderation_unblock',
  'preference_get',
  'preference_set',
  'reaction_list',
  'reaction_react',
  'setting_block_word',
  'setting_get',
  'setting_list',
  'setting_list_blocked_words',
  'setting_unblock_word',
  'setting_update',
  'settings_get',
  'settings_set',
  'settings_clear',
  'commentron',
]);

export function isHyperbeamMethodEnabled(method: string) {
  return HYPERBEAM_ROUTED_METHODS.has(method);
}

export function hyperbeamMethodDevice(method: string) {
  if (['preference_get', 'preference_set'].includes(method)) {
    return HYPERBEAM_DEVICE.preference;
  }
  if (['settings_get', 'settings_set', 'settings_clear'].includes(method)) {
    return HYPERBEAM_DEVICE.account;
  }
  if (
    method.startsWith('comment_') ||
    method.startsWith('reaction_') ||
    method.startsWith('setting_') ||
    method.startsWith('moderation_')
  ) {
    return HYPERBEAM_DEVICE.comment;
  }
  return HYPERBEAM_DEVICE.claim;
}
