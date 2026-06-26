import { X_LBRY_AUTH_TOKEN } from 'constants/token';
import { getAuthToken } from 'util/saved-passwords';
import { HYPERBEAM_DEVICE, hyperbeamDeviceBase, hyperbeamDevicePostParams64 } from 'util/hyperbeamDevices';

export function canCallHyperbeamSync() {
  return Boolean(hyperbeamDeviceBase(HYPERBEAM_DEVICE.sync));
}

export async function getHyperbeamSyncSnapshot() {
  const base = hyperbeamDeviceBase(HYPERBEAM_DEVICE.sync);
  if (!base) return null;

  const response = await fetch(`${base}/snapshot`, {
    headers: { accept: 'application/json' },
  });
  const json = await responseJson(response);
  if (!response.ok) throw new Error(errorMessage(json, response.status));

  return resultPayload(json);
}

export async function pullHyperbeamSync(node: string, token?: string | null) {
  if (!canCallHyperbeamSync()) return null;

  const authToken = token || getAuthToken();
  if (!authToken) throw new Error('HyperBEAM sync pull requires an Odysee auth token.');

  const request = hyperbeamDevicePostParams64(HYPERBEAM_DEVICE.sync, 'pull&!', { node }, authHeaders(authToken));
  if (!request) return null;

  const response = await request;
  const json = await responseJson(response);
  if (!response.ok) throw new Error(errorMessage(json, response.status));

  return resultPayload(json);
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
    `HyperBEAM sync failed with ${status}`
  );
}
