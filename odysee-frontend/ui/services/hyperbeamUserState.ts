import { X_LBRY_AUTH_TOKEN } from 'constants/token';
import { getAuthToken } from 'util/saved-passwords';
import { HYPERBEAM_DEVICE, base64Url, hyperbeamDeviceBase, hyperbeamDevicePostParams64 } from 'util/hyperbeamDevices';

const HYPERBEAM_LBRYIO_METHODS = new Set([
  'membership/content',
  'membership/clear',
  'membership_content/modify',
  'membership_perk/list',
  'membership_v2/check',
  'membership_v2/create',
  'membership_v2/list',
  'membership_v2/status_set',
  'membership_v2/subscribers',
  'membership_v2/update',
  'membership_v2/member_content/modify',
  'membership_v2/member_content/resolve',
  'membership_v2/subscription/list',
]);

export function canCallHyperbeamUserState() {
  return Boolean(hyperbeamDeviceBase(HYPERBEAM_DEVICE.userState));
}

export function canCallHyperbeamLbryio(resource: string, action: string) {
  return canCallHyperbeamUserState() && HYPERBEAM_LBRYIO_METHODS.has(`${resource}/${action}`);
}

export function callHyperbeamSdk(method: string, params: any, token?: string | null): Promise<any | null> {
  return callHyperbeamUserState({ kind: 'sdk', method, params }, token);
}

export function callHyperbeamComment(method: string, params: any, token?: string | null): Promise<any | null> {
  return callHyperbeamUserState({ kind: 'comment', method, params }, token);
}

export function callHyperbeamLbryio(
  resource: string,
  action: string,
  params: any,
  token?: string | null
): Promise<any | null> {
  if (!canCallHyperbeamLbryio(resource, action)) return Promise.resolve(null);
  return callHyperbeamUserState({ kind: 'lbryio', resource, action, params }, token);
}

async function callHyperbeamUserState(payload: Record<string, any>, token?: string | null): Promise<any | null> {
  if (!canCallHyperbeamUserState()) return null;

  const authToken = token || getAuthToken();
  if (!authToken) throw new Error('HyperBEAM authenticated state requires an Odysee auth token.');

  const response = await proxiedUserStateCall(payload, authToken);
  const json = await responseJson(response);
  if (!response.ok) throw new Error(errorMessage(json, response.status));

  return resultPayload(json);
}

async function proxiedUserStateCall(payload: Record<string, any>, authToken: string): Promise<Response> {
  const proxyResponse = await fetch(`/$/api/hyperbeam-auth-device/v1/${HYPERBEAM_DEVICE.userState}/call`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...authHeaders(authToken),
    },
    body: JSON.stringify({
      '!': true,
      params64: base64Url(JSON.stringify(payload || {})),
    }),
  });

  const contentType = proxyResponse.headers.get('content-type') || '';
  if (proxyResponse.status !== 404 && !contentType.includes('text/html')) return proxyResponse;

  const direct = hyperbeamDevicePostParams64(HYPERBEAM_DEVICE.userState, 'call&!', payload, authHeaders(authToken));
  if (!direct) throw new Error('HyperBEAM user-state device is not configured.');
  return direct;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    [X_LBRY_AUTH_TOKEN]: token,
  };
}

function resultPayload(json: any) {
  const parsed = parseBody(json);
  if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'result')) return parsed.result;
  if (json && Object.prototype.hasOwnProperty.call(json, 'result')) return json.result;
  return parsed || json;
}

function parseBody(json: any) {
  if (typeof json?.body !== 'string') return null;

  try {
    return JSON.parse(json.body);
  } catch {
    return null;
  }
}

function responseJson(response: Response) {
  return response.text().then((text) => {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text };
    }
  });
}

function errorMessage(json: any, status: number) {
  const parsed = parseBody(json);
  return (
    parsed?.body ||
    parsed?.details ||
    json?.body ||
    json?.details ||
    json?.error ||
    `HyperBEAM state failed with ${status}`
  );
}
