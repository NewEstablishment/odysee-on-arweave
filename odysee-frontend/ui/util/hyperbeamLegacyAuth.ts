import { ODYSEE_HYPERBEAM_LEGACY_AUTH_DEMO_TOKEN, ODYSEE_HYPERBEAM_LEGACY_AUTH_TRUST } from 'config';
import { X_LBRY_AUTH_TOKEN } from 'constants/token';
import { getAuthToken } from 'util/saved-passwords';
import { base64Url, HYPERBEAM_DEVICE, hyperbeamDevicePostParams64, hyperbeamNodeBase } from 'util/hyperbeamDevices';
import { pushHyperbeamDebug, sanitizeHyperbeamDebugValue } from 'util/hyperbeamDebug';
import { isHyperbeamEnabled } from 'util/hyperbeamMode';

const LEGACY_AUTH_TOKEN_SESSION_KEY = 'odysee-hyperbeam-legacy-auth-demo-token';

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

export type LegacyAuthUploadDemoInput = {
  authToken?: string;
  channelId?: string;
  legacyClaimIds?: Array<string>;
  file?: File | Blob | null;
  filename?: string;
  contentType?: string;
  channelName?: string;
  claimName?: string;
  title?: string;
  description?: string;
  tags?: Array<string> | string;
  thumbnailUrl?: string;
};

export type LegacyAuthUploadDemoResult = {
  trust: LegacyAuthTrust;
  upload: any;
  channel?: any;
  readback: {
    ok: boolean;
    bytes: number;
    sha256: string;
    contentType: string;
    preview?: string;
  };
};

export type LegacyAuthUploadPublishResult = {
  trust: LegacyAuthTrust;
  upload: any;
  claim: any;
};

export type HyperbeamCallDemoResult = {
  trust: LegacyAuthTrust;
  auth: any;
  ownedChannels: Array<any>;
  selectedChannel: any;
  legacyClaims: Array<any>;
  upload: any;
  channel: any;
  nativeClaim: any;
  searchBoundary: any;
  recsysBoundary: any;
  readback: {
    ok: boolean;
    bytes: number;
    sha256: string;
    contentType: string;
    preview?: string;
  };
  checks: Record<string, boolean>;
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

export function shouldUseHyperbeamUploadDemo() {
  return isHyperbeamEnabled() && hyperbeamLegacyAuthTrust().allowed && hasHyperbeamLegacyAuthToken();
}

export function rememberHyperbeamLegacyAuthDemoToken(authToken?: string) {
  if (typeof window === 'undefined') return;
  const token = normalizeLegacyAuthToken(authToken);
  if (token) {
    window.sessionStorage.setItem(LEGACY_AUTH_TOKEN_SESSION_KEY, token);
  } else {
    window.sessionStorage.removeItem(LEGACY_AUTH_TOKEN_SESSION_KEY);
  }
}

export function hasHyperbeamLegacyAuthToken() {
  return Boolean(sessionLegacyAuthToken() || String(ODYSEE_HYPERBEAM_LEGACY_AUTH_DEMO_TOKEN || '') || getAuthToken());
}

export function hyperbeamLegacyAuthDemoToken() {
  return legacyAuthToken();
}

export function hyperbeamLegacyAuthDemoHeaders() {
  const trust = hyperbeamLegacyAuthTrust();
  const authToken = legacyAuthToken();
  return trust.allowed && authToken ? { [X_LBRY_AUTH_TOKEN]: authToken, 'X-Odysee-Demo-Auth-Token': authToken } : {};
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

export async function runHyperbeamLegacyAuthUploadDemo(
  input: LegacyAuthUploadDemoInput = {}
): Promise<LegacyAuthUploadDemoResult> {
  const { trust, resolvedAuthToken, upload } = await uploadWithLegacyAuth(input);
  const readback = await fetchUploadReadback(upload['upload-id'] || upload.id);
  const channel = input.channelId
    ? await fetchUploadChannel(input.channelId, input.legacyClaimIds || [], resolvedAuthToken)
    : undefined;
  const result = sanitizeHyperbeamDebugValue({
    trust,
    upload,
    channel,
    readback,
  }) as LegacyAuthUploadDemoResult;

  pushHyperbeamDebug('legacy auth upload demo', result, readback.ok ? 'ok' : 'error');
  return result;
}

export async function publishHyperbeamUploadDemo(
  input: LegacyAuthUploadDemoInput = {}
): Promise<LegacyAuthUploadPublishResult> {
  const { trust, upload } = await uploadWithLegacyAuth(input);
  const result = sanitizeHyperbeamDebugValue({
    trust,
    upload,
    claim: hyperbeamUploadClaim(upload, input),
  }) as LegacyAuthUploadPublishResult;

  pushHyperbeamDebug('legacy auth upload publish', result, 'ok');
  return result;
}

export async function runHyperbeamCallDemo(input: LegacyAuthUploadDemoInput = {}): Promise<HyperbeamCallDemoResult> {
  const trust = hyperbeamLegacyAuthTrust();
  const resolvedAuthToken = legacyAuthToken(input.authToken);
  if (!trust.allowed) {
    const result = { trust };
    pushHyperbeamDebug('tomorrow call demo blocked', result, 'warn');
    throw Object.assign(new Error(trust.reason), { result });
  }

  if (!resolvedAuthToken) {
    const result = { trust };
    pushHyperbeamDebug('tomorrow call demo missing token', result, 'warn');
    throw Object.assign(new Error('No legacy auth_token is available for the call demo.'), { result });
  }

  const auth = await runHyperbeamLegacyAuthDemo(resolvedAuthToken);
  const ownedChannelsResult = await fetchOwnedChannels(resolvedAuthToken);
  const ownedChannels = resultItems(ownedChannelsResult);
  const { selectedChannel, legacyClaims } = await selectDemoChannel(ownedChannels);
  const channelId = input.channelId || selectedChannel?.claim_id;
  const channelName = input.channelName || selectedChannel?.name || '@hyperbeam-demo';
  const legacyClaimIds = legacyClaims.map((claim) => claim.claim_id).filter(Boolean);
  const uploadFile = input.file || defaultUploadBlob();
  const upload = await fetchUploadDemo(await uploadFile.arrayBuffer(), {
    authToken: resolvedAuthToken,
    channelId,
    channelName,
    claimName: input.claimName || `native-demo-${Date.now()}`,
    contentType: input.contentType || uploadFile.type || 'text/plain',
    description: input.description || 'Stored directly as a native HyperBEAM upload with Odysee metadata.',
    filename: input.filename || uploadFilename(uploadFile) || 'hyperbeam-call-demo.txt',
    tags: input.tags || 'hyperbeam,native,demo',
    thumbnailUrl: input.thumbnailUrl || 'https://odysee.com/public/cast/logo.png',
    title: input.title || 'Native HyperBEAM demo upload',
  });
  const uploadId = upload['upload-id'] || upload.id;
  const readback = await fetchUploadReadback(uploadId);
  const channel = await fetchUploadChannel(channelId, legacyClaimIds, resolvedAuthToken);
  const nativeClaim = await fetchNativeUploadClaim(uploadId);
  const searchBoundary = await fetchSearchBoundary(channelId);
  const recsysBoundary = await fetchRecsysBoundary();
  const result = sanitizeHyperbeamDebugValue({
    trust,
    auth: compactAuthResult(auth),
    ownedChannels,
    selectedChannel,
    legacyClaims,
    upload,
    channel,
    nativeClaim,
    searchBoundary,
    recsysBoundary,
    readback,
    checks: {
      tokenValidated: Boolean(auth?.identity?.['legacy-user-id']),
      ownedChannelsResolved: ownedChannels.length > 0,
      nativeUploadStored: Boolean(uploadId && upload.sha256),
      uploadReadbackMatched: Boolean(readback.ok && readback.sha256 === upload.sha256),
      mixedChannelResolved: Boolean(channel?.['hyperbeam-upload-ids']?.includes(uploadId)),
      nativeUploadResolved: Boolean(nativeClaim?.claim_id === uploadId || nativeClaim?.['claim-id'] === uploadId),
      searchDeviceUsed: searchBoundary?.poweredBy === 'hyperbeam',
      recsysDeviceUsed: recsysBoundary?.gid === 'hyperbeam-demo',
    },
  }) as HyperbeamCallDemoResult;

  pushHyperbeamDebug('tomorrow call demo', result, allChecksPassed(result.checks) ? 'ok' : 'warn');
  return result;
}

export function installHyperbeamLegacyAuthDemoGlobal() {
  if (typeof window === 'undefined') return;
  (window as any).odyseeHyperbeamLegacyAuthDemo = (authToken?: string) => runHyperbeamLegacyAuthDemo(authToken);
  (window as any).odyseeHyperbeamLegacyAuthUploadDemo = (authToken?: string, file?: File | Blob) =>
    runHyperbeamLegacyAuthUploadDemo({ authToken, file });
  (window as any).odyseeHyperbeamCallDemo = (authToken?: string) => runHyperbeamCallDemo({ authToken });
}

function legacyAuthToken(authToken?: string) {
  if (authToken) {
    const token = normalizeLegacyAuthToken(authToken);
    rememberHyperbeamLegacyAuthDemoToken(token);
    return token;
  }

  return (
    normalizeLegacyAuthToken(getAuthToken()) ||
    normalizeLegacyAuthToken(sessionLegacyAuthToken()) ||
    normalizeLegacyAuthToken(String(ODYSEE_HYPERBEAM_LEGACY_AUTH_DEMO_TOKEN || ''))
  );
}

function sessionLegacyAuthToken() {
  if (typeof window === 'undefined') return '';

  try {
    return window.sessionStorage.getItem(LEGACY_AUTH_TOKEN_SESSION_KEY) || '';
  } catch (_error) {
    return '';
  }
}

async function fetchLegacyAuthJson(path: string, authToken: string) {
  const response = await fetch(`${hyperbeamNodeBase()}/${HYPERBEAM_DEVICE.legacyAuth}/${path}`, {
    method: 'GET',
    credentials: hyperbeamFetchCredentials(),
    headers: legacyAuthIdentifyHeaders(authToken),
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

async function fetchUploadDemo(
  body: ArrayBuffer,
  options: {
    authToken: string;
    channelId?: string;
    channelName?: string;
    claimName?: string;
    contentType: string;
    description?: string;
    filename: string;
    tags?: Array<string> | string;
    thumbnailUrl?: string;
    title?: string;
  }
) {
  const metadata = {
    filename: options.filename,
    'content-type': options.contentType,
    ...(options.channelId ? { 'channel-id': options.channelId } : {}),
    ...(options.channelName ? { 'channel-name': options.channelName } : {}),
    ...(options.claimName ? { 'claim-name': options.claimName } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(options.tags ? { tags: Array.isArray(options.tags) ? options.tags.join(',') : options.tags } : {}),
    ...(options.thumbnailUrl ? { 'thumbnail-url': options.thumbnailUrl } : {}),
  };
  const params = new URLSearchParams({
    metadata64: base64Url(JSON.stringify(metadata)),
  });

  const response = await fetch(`${hyperbeamNodeBase()}/${HYPERBEAM_DEVICE.uploadDemo}/upload?!&${params.toString()}`, {
    method: 'POST',
    credentials: hyperbeamFetchCredentials(),
    headers: {
      ...legacyAuthHeaders(options.authToken),
      'content-type': options.contentType,
    },
    body,
  });
  return parseJsonResponse(response, 'legacy-auth-upload');
}

async function uploadWithLegacyAuth(input: LegacyAuthUploadDemoInput) {
  const trust = hyperbeamLegacyAuthTrust();
  const resolvedAuthToken = legacyAuthToken(input.authToken);
  if (!trust.allowed) {
    const result = { trust };
    pushHyperbeamDebug('legacy auth upload blocked', result, 'warn');
    throw Object.assign(new Error(trust.reason), { result });
  }

  if (!resolvedAuthToken) {
    const result = { trust };
    pushHyperbeamDebug('legacy auth upload missing token', result, 'warn');
    throw Object.assign(new Error('No legacy auth_token is available for the upload demo.'), { result });
  }

  const uploadFile = input.file || defaultUploadBlob();
  const body = await uploadFile.arrayBuffer();
  const filename = input.filename || uploadFilename(uploadFile) || 'hyperbeam-upload-demo.txt';
  const contentType = input.contentType || uploadFile.type || 'application/octet-stream';
  const upload = await fetchUploadDemo(body, {
    authToken: resolvedAuthToken,
    channelId: input.channelId,
    channelName: input.channelName,
    claimName: input.claimName,
    contentType,
    description: input.description,
    filename,
    tags: input.tags,
    thumbnailUrl: input.thumbnailUrl,
    title: input.title,
  });

  return { trust, resolvedAuthToken, upload };
}

function hyperbeamUploadClaim(upload: any, input: LegacyAuthUploadDemoInput) {
  const uploadId = upload['upload-id'] || upload['hyperbeam-upload-id'] || upload.id;
  const filename = upload.filename || input.filename || 'hyperbeam-upload-demo.bin';
  const contentType = upload['content-type'] || input.contentType || 'application/octet-stream';
  const claimName = safeClaimName(
    input.claimName || upload['claim-name'] || input.title || filename || 'hyperbeam-upload'
  );
  const channelName = ensureChannelName(input.channelName || upload['channel-name'] || '@hyperbeam');
  const channelId = input.channelId || upload['channel-id'] || upload.channel_id;
  const thumbnailUrl = input.thumbnailUrl || upload['thumbnail-url'] || upload.thumbnail_url;
  const tags = normalizedTags(input.tags || upload.tags);
  const source = {
    media_type: contentType,
    name: filename,
    size: upload.size || 0,
    sha256: upload.sha256 || '',
    hyperbeam_upload_id: uploadId,
    hyperbeam_body_path: upload['body-path'] || '',
  };
  const value = {
    title: input.title || upload.title || claimName,
    description: input.description || upload.description || '',
    tags,
    thumbnail: thumbnailUrl ? { url: thumbnailUrl } : undefined,
    source,
    stream_type: streamType(contentType),
  };
  const canonicalUrl = channelId
    ? `lbry://${channelName}#${channelId}/${claimName}#${uploadId}`
    : `lbry://${claimName}#${uploadId}`;
  const channelUrl = channelId ? `lbry://${channelName}#${channelId}` : undefined;

  return {
    claim_id: uploadId,
    name: claimName,
    type: 'claim',
    value_type: 'stream',
    canonical_url: canonicalUrl,
    permanent_url: canonicalUrl,
    short_url: canonicalUrl,
    value,
    meta: { effective_amount: '0' },
    timestamp: Math.floor(Date.now() / 1000),
    txid: uploadId,
    nout: 0,
    confirmations: 0,
    is_channel_signature_valid: Boolean(channelId),
    hyperbeam_upload_id: uploadId,
    is_hyperbeam_upload: true,
    signing_channel: channelId
      ? {
          claim_id: channelId,
          name: channelName,
          normalized_name: channelName,
          value_type: 'channel',
          canonical_url: channelUrl,
          permanent_url: channelUrl,
          short_url: channelUrl,
          value: {
            title: channelName,
          },
        }
      : undefined,
  };
}

async function fetchUploadChannel(channelId: string, legacyClaimIds: Array<string>, authToken: string) {
  const params = new URLSearchParams({ 'channel-id': channelId });
  if (legacyClaimIds.length) params.set('legacy-claim-ids', legacyClaimIds.join(','));

  const response = await fetch(`${hyperbeamNodeBase()}/${HYPERBEAM_DEVICE.uploadDemo}/channel?${params.toString()}`, {
    method: 'GET',
    credentials: hyperbeamFetchCredentials(),
    headers: legacyAuthHeaders(authToken),
  });
  return parseJsonResponse(response, 'legacy-auth-upload-channel');
}

async function fetchUploadReadback(uploadId: string) {
  if (!uploadId) throw new Error('Upload demo did not return an upload id.');

  const response = await fetch(
    `${hyperbeamNodeBase()}/${HYPERBEAM_DEVICE.uploadDemo}/read?id=${encodeURIComponent(uploadId)}`,
    {
      method: 'GET',
      credentials: hyperbeamFetchCredentials(),
      headers: {
        Accept: '*/*',
      },
    }
  );
  if (!response.ok) {
    const body = await response.text();
    throw Object.assign(new Error(`legacy-auth-upload readback failed with ${response.status}`), {
      response,
      body: sanitizeHyperbeamDebugValue(safeJson(body) || body),
    });
  }

  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  return {
    ok: true,
    bytes: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    contentType,
    preview: previewBytes(bytes, contentType),
  };
}

async function fetchOwnedChannels(authToken: string) {
  return fetchHyperbeamDeviceJson(HYPERBEAM_DEVICE.channel, 'channel_list', {
    page: 1,
    page_size: 99999,
    resolve: true,
    auth_token: authToken,
  });
}

async function selectDemoChannel(ownedChannels: Array<any>) {
  if (!ownedChannels.length) throw new Error('No owned channels were returned for the legacy auth token.');

  let selectedChannel = ownedChannels[0];
  let legacyClaims: Array<any> = [];
  for (const channel of ownedChannels.slice(0, 5)) {
    const channelClaims = await fetchLegacyChannelClaims(channel.claim_id);
    if (channelClaims.length) {
      selectedChannel = channel;
      legacyClaims = channelClaims;
      break;
    }
  }

  if (!legacyClaims.length) {
    legacyClaims = await fetchLegacyChannelClaims(selectedChannel.claim_id);
  }

  return { selectedChannel, legacyClaims };
}

async function fetchLegacyChannelClaims(channelId: string) {
  if (!channelId) return [];

  const result = await fetchHyperbeamDeviceJson(HYPERBEAM_DEVICE.claim, 'search', {
    channel_ids: [channelId],
    claim_type: ['stream'],
    page: 1,
    page_size: 5,
    resolve: true,
  });
  return resultItems(result).filter((claim) => !claim.is_hyperbeam_upload);
}

async function fetchNativeUploadClaim(uploadId: string) {
  const response = await fetch(
    `${hyperbeamNodeBase()}/${HYPERBEAM_DEVICE.claim}/resolve?upload-id=${encodeURIComponent(uploadId)}`,
    {
      method: 'GET',
      credentials: hyperbeamFetchCredentials(),
      headers: { Accept: 'application/json' },
    }
  );
  return parseJsonResponse(response, 'native-upload-resolve');
}

async function fetchSearchBoundary(channelId: string) {
  return fetchHyperbeamDeviceJson(HYPERBEAM_DEVICE.search, 'search', {
    kind: 'primary',
    query: `channel_ids=${encodeURIComponent(channelId)}&claimType=file&size=5`,
  });
}

async function fetchRecsysBoundary() {
  return fetchHyperbeamDeviceJson(HYPERBEAM_DEVICE.search, 'recsys_fyp', {
    action: 'fetch',
    gid: 'hyperbeam-demo',
  });
}

async function fetchHyperbeamDeviceJson(device: string, key: string, params: Record<string, any>) {
  const request = hyperbeamDevicePostParams64(device, key, params, { accept: 'application/json' });
  if (!request) throw new Error(`HyperBEAM ${device}/${key} is not configured.`);
  const response = await request;
  return unwrapJsonResult(await parseJsonResponse(response, `${device}/${key}`));
}

function unwrapJsonResult(json: any) {
  if (json?.error) {
    throw new Error(json.error.message || json.error);
  }

  return json && Object.prototype.hasOwnProperty.call(json, 'result') ? json.result : json;
}

function resultItems(result: any) {
  const candidates = [result?.items, result?.claims, result?.result?.items, result?.result?.claims];
  return candidates.find(Array.isArray) || [];
}

function compactAuthResult(auth: LegacyAuthDemoResult) {
  return {
    identity: auth.identity,
    signedRequest: {
      body: auth.signedRequest?.body,
      commitmentCount: auth.signedRequest?.commitmentCount,
      committers: auth.signedRequest?.committers,
      devices: auth.signedRequest?.devices,
    },
  };
}

function allChecksPassed(checks: Record<string, boolean>) {
  return Object.values(checks).every(Boolean);
}

function legacyAuthHeaders(authToken: string) {
  const token = normalizeLegacyAuthToken(authToken);
  return {
    Accept: 'application/json',
    'X-Odysee-Demo-Auth-Token': token,
  };
}

export function legacyAuthIdentifyHeaders(authToken: string) {
  const token = normalizeLegacyAuthToken(authToken);
  return {
    Accept: 'application/json',
    'X-Odysee-Demo-Auth-Token': token,
  };
}

export function normalizeLegacyAuthToken(value?: string | null) {
  const text = String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!text) return '';

  const explicit = text.match(
    /(?:auth[_-]?token|x-lbry-auth-token|x-odysee-demo-auth-token)\s*[:=]\s*['"]?([A-Za-z0-9_-]+)/i
  );
  if (explicit?.[1]) return explicit[1];

  const bearer = text.match(/bearer\s+([A-Za-z0-9_-]+)/i);
  if (bearer?.[1]) return bearer[1];

  return text;
}

export function isLegacyAuthRejected(error: any) {
  const body = error?.body || {};
  const responseStatus = error?.response?.status;
  const status = responseStatus || body?.status;
  const message = String(body?.error || body?.body || error?.message || '').toLowerCase();
  return status === 401 || status === 403 || message.includes('could not authenticate user');
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
    const error = Object.assign(new Error(`${label} failed with ${response.status}`), {
      response,
      body: sanitizeHyperbeamDebugValue(body || text),
    });
    if (isLegacyAuthRejected(error)) {
      rememberHyperbeamLegacyAuthDemoToken('');
    }
    throw error;
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

function defaultUploadBlob() {
  return new Blob([`Odysee HyperBEAM upload demo ${new Date().toISOString()}\n`], {
    type: 'text/plain',
  });
}

function uploadFilename(file: File | Blob) {
  const name = (file as File).name;
  return typeof name === 'string' ? name : '';
}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function previewBytes(bytes: ArrayBuffer, contentType: string) {
  if (!contentType.toLowerCase().startsWith('text/') && !contentType.toLowerCase().includes('json')) return undefined;
  try {
    return new TextDecoder().decode(bytes.slice(0, 280));
  } catch (_error) {
    return undefined;
  }
}

function isLocalNode(node: string) {
  try {
    const host = new URL(node).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch (_error) {
    return false;
  }
}

function normalizedTags(tags?: Array<string> | string) {
  if (!tags) return [];
  const values = Array.isArray(tags) ? tags : String(tags).split(',');
  return values.map((tag) => String(tag).trim()).filter(Boolean);
}

function streamType(contentType: string) {
  const type = String(contentType || '').toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('image/')) return 'image';
  if (type.includes('markdown') || type.startsWith('text/')) return 'document';
  return 'binary';
}

function ensureChannelName(name: string) {
  const safe = safeClaimName(name || '@hyperbeam') || 'hyperbeam';
  return safe.startsWith('@') ? safe : `@${safe}`;
}

function safeClaimName(value: string) {
  const safe = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^lbry:\/\//, '')
    .replace(/[^a-z0-9@._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'hyperbeam-upload';
}
