import { ODYSEE_HYPERBEAM_LEGACY_AUTH_DEMO_TOKEN, ODYSEE_HYPERBEAM_LEGACY_AUTH_TRUST } from 'config';
import { X_LBRY_AUTH_TOKEN } from 'constants/token';
import { getAuthToken } from 'util/saved-passwords';
import { HYPERBEAM_DEVICE, hyperbeamNodeBase } from 'util/hyperbeamDevices';
import { pushHyperbeamDebug, sanitizeHyperbeamDebugValue } from 'util/hyperbeamDebug';

export type LegacyAuthTrust = {
  allowed: boolean;
  mode: string;
  node: string;
  label: string;
  reason: string;
};

export type LegacyAuthDemoResult = {
  trust: LegacyAuthTrust;
  identity?: any;
  signedRequest?: any;
};

export function hyperbeamLegacyAuthTrust(): LegacyAuthTrust {
  const node = hyperbeamNodeBase();
  const mode = String(ODYSEE_HYPERBEAM_LEGACY_AUTH_TRUST || 'local-demo').toLowerCase();

  if (!node) {
    return {
      allowed: false,
      mode,
      node,
      label: 'No HyperBEAM node',
      reason: 'ODYSEE_HYPERBEAM_NODE_API is not configured.',
    };
  }

  if (mode === 'off' || mode === 'disabled' || mode === 'false') {
    return {
      allowed: false,
      mode,
      node,
      label: 'Legacy auth forwarding disabled',
      reason: 'Set ODYSEE_HYPERBEAM_LEGACY_AUTH_TRUST=local-demo for localhost or tee-attested for a measured node.',
    };
  }

  if (mode === 'local-demo' || mode === 'local') {
    const local = isLocalNode(node);
    return {
      allowed: local,
      mode,
      node,
      label: local ? 'Local demo node' : 'Remote node blocked',
      reason: local
        ? 'Bearer auth is allowed only because this HyperBEAM node is local and explicitly in demo mode.'
        : 'Local-demo auth forwarding refuses to send bearer auth to a non-local HyperBEAM node.',
    };
  }

  if (mode === 'tee-attested' || mode === 'tee' || mode === 'trusted') {
    return {
      allowed: true,
      mode,
      node,
      label: mode === 'trusted' ? 'Trusted node configured' : 'TEE/trusted node configured',
      reason:
        mode === 'trusted'
          ? 'Bearer auth is allowed by explicit trusted-node configuration.'
          : 'Bearer auth is allowed by explicit TEE/trusted-node configuration. Real attestation verification still belongs in the production path.',
    };
  }

  return {
    allowed: false,
    mode,
    node,
    label: 'Unknown trust mode',
    reason: `Unknown ODYSEE_HYPERBEAM_LEGACY_AUTH_TRUST value: ${mode}`,
  };
}

export async function runHyperbeamLegacyAuthDemo(authToken?: string): Promise<LegacyAuthDemoResult> {
  const trust = hyperbeamLegacyAuthTrust();
  const resolvedAuthToken = legacyAuthToken(authToken);
  if (!trust.allowed) {
    const result = { trust };
    pushHyperbeamDebug('legacy auth blocked', result, 'warn');
    throw Object.assign(new Error(trust.reason), { result });
  }

  if (!resolvedAuthToken) {
    const result = { trust };
    pushHyperbeamDebug('legacy auth missing token', result, 'warn');
    throw Object.assign(new Error('No legacy auth_token is available in this browser session.'), { result });
  }

  const identity = await fetchLegacyAuthJson('identify', resolvedAuthToken);
  const signedRequest = await fetchSignedCommitments(resolvedAuthToken);
  const result = sanitizeHyperbeamDebugValue({
    trust,
    identity,
    signedRequest,
  }) as LegacyAuthDemoResult;

  pushHyperbeamDebug('legacy auth demo', result, 'ok');
  return result;
}

export function installHyperbeamLegacyAuthDemoGlobal() {
  if (typeof window === 'undefined') return;
  (window as any).odyseeHyperbeamLegacyAuthDemo = (authToken?: string) => runHyperbeamLegacyAuthDemo(authToken);
}

function legacyAuthToken(authToken?: string) {
  return authToken || String(ODYSEE_HYPERBEAM_LEGACY_AUTH_DEMO_TOKEN || '') || getAuthToken();
}

async function fetchLegacyAuthJson(path: string, authToken: string) {
  const response = await fetch(`${hyperbeamNodeBase()}/${HYPERBEAM_DEVICE.legacyAuth}/${path}`, {
    method: 'GET',
    credentials: hyperbeamFetchCredentials(),
    headers: legacyAuthHeaders(authToken),
  });
  return parseJsonResponse(response, `legacy-auth/${path}`);
}

async function fetchSignedCommitments(authToken: string) {
  const body = `odysee-legacy-auth-demo-${Date.now()}`;
  const response = await fetch(`${hyperbeamNodeBase()}/commitments?!&body=${encodeURIComponent(body)}`, {
    method: 'GET',
    credentials: hyperbeamFetchCredentials(),
    headers: legacyAuthHeaders(authToken),
  });
  const json = await parseJsonResponse(response, 'commitments');
  const commitments = commitmentValues(json);
  return {
    body,
    commitmentCount: commitments.length,
    committers: commitments.map((commitment) => commitment.committer).filter(Boolean),
    devices: [...new Set(commitments.map((commitment) => commitment['commitment-device']).filter(Boolean))],
    raw: json,
  };
}

function legacyAuthHeaders(authToken: string) {
  return {
    Accept: 'application/json',
    [X_LBRY_AUTH_TOKEN]: authToken,
  };
}

function hyperbeamFetchCredentials(): RequestCredentials {
  if (typeof window === 'undefined') return 'omit';

  try {
    return new URL(hyperbeamNodeBase()).origin === window.location.origin ? 'include' : 'omit';
  } catch (_error) {
    return 'omit';
  }
}

async function parseJsonResponse(response: Response, label: string) {
  const text = await response.text();
  const body = text ? safeJson(text) : null;

  if (!response.ok) {
    throw Object.assign(new Error(`${label} failed with ${response.status}`), {
      response,
      body: sanitizeHyperbeamDebugValue(body || text),
    });
  }

  return body;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

function commitmentValues(value: any): Array<Record<string, any>> {
  const candidates = value?.commitments || value?.body?.commitments || value;
  if (!candidates || typeof candidates !== 'object' || Array.isArray(candidates)) return [];

  return Object.values(candidates).filter(
    (item: any) => item && typeof item === 'object' && (item.committer || item['commitment-device'])
  ) as Array<Record<string, any>>;
}

function isLocalNode(node: string) {
  try {
    const host = new URL(node).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch (_error) {
    return false;
  }
}
