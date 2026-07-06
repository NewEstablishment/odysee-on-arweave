const { HYPERBEAM_ALLOW_COMPATIBILITY_READS, ODYSEE_HYPERBEAM_NODE_API } = require('../../config.cjs');

const HYPERBEAM_NODE_TIMEOUT_MS = 15000;
const HYPERBEAM_MODE_STORAGE_KEY = 'odysee-hyperbeam-mode';
const HYPERBEAM_DEVICE_CLAIM = '~odysee-claim@1.0';
const HYPERBEAM_DEVICE_STREAM = '~odysee-stream@1.0';
const HYPERBEAM_DEVICE_UPLOAD = '~odysee-upload@1.0';
const HYPERBEAM_DEVICE_ACCOUNT = '~odysee-account@1.0';
const HYPERBEAM_DEVICE_SEARCH = '~odysee-search@1.0';
const HYPERBEAM_DEVICES = new Set([
  HYPERBEAM_DEVICE_ACCOUNT,
  HYPERBEAM_DEVICE_CLAIM,
  HYPERBEAM_DEVICE_SEARCH,
  HYPERBEAM_DEVICE_STREAM,
  HYPERBEAM_DEVICE_UPLOAD,
  '~odysee-channel@1.0',
  '~odysee-comment@1.0',
  '~odysee-file@1.0',
  '~odysee-file-reaction@1.0',
  '~odysee-reaction@1.0',
]);

function hyperbeamNodeBase() {
  return (ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
}

function hyperbeamNodeConfigured() {
  return Boolean(hyperbeamNodeBase()) && hyperbeamMode() !== 'original';
}

function deviceBase(device) {
  const base = hyperbeamNodeBase();
  return base && isHyperbeamDeviceEnabled(device) ? `${base}/${device}` : '';
}

function hyperbeamNodeJsonPath(device, key, value) {
  const base = deviceBase(device);
  if (!base) return '';

  return {
    postUrl: `${base}/${key}`,
    url: `${base}/${key}`,
    body: value || {},
  };
}

function hyperbeamNodeRequestHeaders(extraHeaders) {
  const headers = { accept: 'application/json' };
  if (hyperbeamMode() !== 'hyperbeam') return headers;

  ['X-Lbry-Auth-Token', 'X-Odysee-User-Id', 'Authorization'].forEach((key) => {
    const value = extraHeaders && extraHeaders[key];
    if (value) headers[key] = value;
  });
  return headers;
}

async function hyperbeamNodeResolve(params, extraHeaders) {
  if (!hyperbeamNodeConfigured()) return null;

  const urls = Array.isArray(params?.urls)
    ? params.urls
    : params?.urls
      ? [params.urls]
      : Array.isArray(params?.uris)
        ? params.uris
        : params?.uris
          ? [params.uris]
          : params?.uri
            ? [params.uri]
            : [];
  if (!urls.length) return null;

  const { channelUris, resolveUris } = splitClaimIdChannelUris(urls);
  const channelEntries =
    channelUris.length > 1
      ? await hyperbeamNodeClaimIdChannelEntries(channelUris, extraHeaders)
      : await hyperbeamNodeResolveEntries(channelUris, extraHeaders);
  const resolveEntries = await hyperbeamNodeResolveEntries(resolveUris, extraHeaders);

  return Object.fromEntries([...channelEntries, ...resolveEntries].filter(([, claim]) => claim));
}

async function hyperbeamNodeResolveEntries(urls, extraHeaders) {
  return Promise.all(
    urls.map(async (uri) => {
      const immutableClaim = await hyperbeamNodeImmutableResolve(uri);
      if (immutableClaim) return [uri, immutableClaim];

      const storeClaim = storeResponsePayload(await hyperbeamNodeFetchStoreJson(storePath('odysee/claim', uri)));
      if (storeClaim) return [uri, sdkClaimFromHyperbeam(storeClaim)];

      const claimId = claimIdFromUri(uri);
      if (claimId) {
        try {
          const cacheResult = await hyperbeamNodeFetchJson(hyperbeamCacheReadPath(claimId), extraHeaders);
          const cacheClaim = sdkClaimFromHyperbeam(cacheReadClaim(cacheResult));
          if (cacheClaim) return [uri, cacheClaim];
        } catch (e) {
          void e;
        }
      }

      const result = await hyperbeamNodeFetchJson(
        hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_CLAIM, 'resolve', { uri }),
        extraHeaders
      );
      const claim = sdkClaimFromHyperbeam((result && result[uri]) || result);
      if (claim) return [uri, claim];

      return [uri, await hyperbeamNodeUploadResolve(uri, extraHeaders)];
    })
  );
}

async function hyperbeamNodeImmutableResolve(uri) {
  const immutableId = immutableRouteIdFromUri(uri);
  if (!immutableId) return null;

  const name = claimNameFromUri(uri);
  const result = storeResponsePayload(await hyperbeamNodeFetchImmutableJson(immutableId));
  const claim = immutableClaimFromHyperbeam(result, immutableId, name);
  if (!claim) return null;

  return !name || claim.name === name ? claim : null;
}

async function hyperbeamNodeUploadResolve(uri, extraHeaders) {
  const claimId = routeModifierFromUri(uri);
  const name = claimNameFromUri(uri);
  if (!claimId && !name) return null;

  const result = await hyperbeamNodeUploadList(
    {
      ...(claimId ? { claim_ids: [claimId] } : {}),
      ...(name ? { name } : {}),
      page_size: 1,
    },
    extraHeaders
  ).catch(() => null);

  return Array.isArray(result && result.items) ? result.items[0] || null : null;
}

async function hyperbeamNodeClaimIdChannelEntries(urls, extraHeaders) {
  const uriByClaimId = new Map();
  urls.forEach((uri) => {
    const claimId = claimIdFromChannelUri(uri);
    if (claimId) uriByClaimId.set(claimId.toLowerCase(), uri);
  });
  const storeEntries = await Promise.all(
    Array.from(uriByClaimId.entries()).map(async ([claimId, uri]) => {
      const storeClaim = storeResponsePayload(await hyperbeamNodeFetchStoreJson(storePath('odysee/claim-id', claimId)));
      return storeClaim ? [uri, sdkClaimFromHyperbeam(storeClaim)] : null;
    })
  );
  const resolvedEntries = storeEntries.filter(Boolean);
  const resolvedUris = new Set(resolvedEntries.map(([uri]) => uri));
  const unresolvedClaimIds = Array.from(uriByClaimId.entries())
    .filter(([, uri]) => !resolvedUris.has(uri))
    .map(([claimId]) => claimId);
  if (!unresolvedClaimIds.length) return resolvedEntries;

  const result = await hyperbeamNodeFetchJson(
    hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_CLAIM, 'search', { claim_ids: unresolvedClaimIds }),
    extraHeaders
  );
  const search = sdkSearchFromHyperbeam(result);
  const items = Array.isArray(search && search.items) ? search.items : [];

  return items
    .map((item) => {
      const claim = sdkClaimFromHyperbeam(item);
      const claimId = claim && (claim.claim_id || claim['claim-id']);
      const uri = claimId && uriByClaimId.get(String(claimId).toLowerCase());
      return uri ? [uri, claim] : null;
    })
    .filter(Boolean);
}

async function hyperbeamNodeClaimSearch(params, extraHeaders) {
  if (!hyperbeamNodeConfigured()) return null;

  const immutableIds = paramValues(params || {}, 'immutable_ids', 'immutable-ids', 'immutable_id', 'immutable-id');
  if (immutableIds.length) return hyperbeamNodeImmutableList(immutableIds, params || {});

  const localParams = localUploadSearchParams(params || {});
  const localUploadsPromise = localParams
    ? hyperbeamNodeUploadList(localParams, extraHeaders).catch(() => null)
    : Promise.resolve(null);

  const storeResult = await hyperbeamNodeChannelClaimSearch(params || {}, extraHeaders);
  if (storeResult) return mergeClaimSearchResults(storeResult, await localUploadsPromise, params || {});

  const searchResult = await hyperbeamNodeSearch(params || {}, extraHeaders);
  if (searchResult) return mergeClaimSearchResults(searchResult, await localUploadsPromise, params || {});

  const result = await hyperbeamNodeFetchJson(
    hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_CLAIM, 'search', params || {}),
    extraHeaders
  ).catch(() => null);
  const publicResult = sdkSearchFromHyperbeam(result);

  return mergeClaimSearchResults(
    publicResult && Array.isArray(publicResult.items) ? publicResult : null,
    await localUploadsPromise,
    params || {}
  );
}

async function hyperbeamNodeUploadList(params, extraHeaders) {
  const result = await hyperbeamNodeFetchJson(
    hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_UPLOAD, 'list', params || {}),
    extraHeaders
  );
  const search = sdkSearchFromHyperbeam(result);
  const sourceItems = search && search.items;
  if (!Array.isArray(sourceItems)) return null;

  const items = sourceItems.map(uploadClaimFromHyperbeam).filter((claim) => claimMatchesSearchParams(claim, params));
  const pageSize = Number(search.page_size || search['page-size'] || params.page_size || items.length || 1);
  const totalItems = Number(search.total_items || search['total-items'] || items.length);

  return {
    ...search,
    items,
    page: Number(search.page || params.page || 1),
    page_size: pageSize,
    total_items: Math.max(totalItems, items.length),
    total_pages: Number(
      search.total_pages || search['total-pages'] || totalPages(Math.max(totalItems, items.length), pageSize)
    ),
  };
}

async function hyperbeamNodeImmutableList(immutableIds, params) {
  const uniqueIds = Array.from(new Set(immutableIds));
  const claims = (
    await Promise.all(
      uniqueIds.map(async (id) => {
        const result = storeResponsePayload(await hyperbeamNodeFetchImmutableJson(id));
        return immutableClaimFromHyperbeam(result, id);
      })
    )
  ).filter(Boolean);
  const filtered = claims.filter((claim) => claimMatchesSearchParams(claim, params));
  const page = Number(params.page || 1);
  const pageSize = Number(params.page_size || filtered.length || uniqueIds.length || 1);
  const start = Math.max(0, page - 1) * pageSize;

  return {
    items: filtered.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total_items: filtered.length,
    total_pages: totalPages(filtered.length, pageSize),
  };
}

async function hyperbeamNodeGet(params, extraHeaders) {
  const uri = params && (params.uri || params.url);
  if (!uri) return null;

  const immutablePayload = playbackPayloadFromUploadClaim(await hyperbeamNodeImmutableResolve(uri));
  if (immutablePayload) return immutablePayload;

  const uploadPayload = playbackPayloadFromUploadClaim(await hyperbeamNodeUploadResolve(uri, extraHeaders));
  if (uploadPayload) return uploadPayload;

  const storePayload = playbackPayloadFromHyperbeam(
    storeResponsePayload(await hyperbeamNodeFetchStoreJson(storePath('odysee/stream', uri)))
  );
  if (storePayload) return storePayload;

  const result = await hyperbeamNodeFetchJson(
    hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_STREAM, 'playback', { uri }),
    extraHeaders
  );
  return playbackPayloadFromHyperbeam(result);
}

async function hyperbeamNodeSdkCall(method, params, extraHeaders) {
  if (!hyperbeamNodeConfigured()) return null;

  const localResult = hyperbeamLocalSdkResult(method, params);
  if (localResult) return localResult;
  if (LEGACY_ONLY_SDK_METHODS.has(method)) return null;

  switch (method) {
    case 'resolve':
      return hyperbeamNodeResolve(params || {}, extraHeaders);
    case 'claim_search':
      return hyperbeamNodeClaimSearch(params || {}, extraHeaders);
    case 'get':
      return hyperbeamNodeGet(params || {}, extraHeaders);
    case 'preference_get':
    case 'preference_set':
    case 'settings_get':
    case 'settings_set':
    case 'settings_clear':
      return hyperbeamNodeAccount(method, params || {}, extraHeaders);
    default:
      return Promise.reject(new Error(`HyperBEAM mode does not support SDK method ${method}`));
  }
}

const LEGACY_ONLY_SDK_METHODS = new Set([
  'account_list',
  'address_is_mine',
  'address_list',
  'address_unused',
  'blob_list',
  'channel_sign',
  'channel_list',
  'collection_list',
  'file_list',
  'purchase_list',
  'stream_list',
  'sync_get',
  'sync_set',
  'sync_apply',
  'sync_hash',
  'transaction_list',
  'txo_list',
  'wallet_balance',
  'wallet_decrypt',
  'wallet_encrypt',
  'wallet_list',
  'wallet_lock',
  'wallet_status',
  'wallet_unlock',
]);

async function hyperbeamNodeFetchJson(request, extraHeaders) {
  if (!request) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HYPERBEAM_NODE_TIMEOUT_MS);
  const url = typeof request === 'string' ? request : request.url;
  if (!url) {
    clearTimeout(timeout);
    return null;
  }
  const usePost = typeof request === 'object';
  const fetchUrl = usePost ? request.postUrl || url : url;

  try {
    const response = await fetch(fetchUrl, {
      method: usePost ? 'POST' : 'GET',
      headers: {
        ...hyperbeamNodeRequestHeaders(extraHeaders),
        ...(usePost ? { 'content-type': 'application/json' } : {}),
      },
      ...(usePost ? { body: JSON.stringify(request.body) } : {}),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HyperBEAM device ${response.status}`);
    }

    return response.json().then(unwrapJsonRpcResult);
  } finally {
    clearTimeout(timeout);
  }
}

async function hyperbeamNodeFetchStoreJson(path) {
  return hyperbeamNodeFetchStorePath(path, true);
}

async function hyperbeamNodeFetchStorePath(path, preferJson = true) {
  const base = hyperbeamNodeBase();
  if (!base) return null;
  if (!allowHyperbeamCompatibilityReads() && isCompatibilityStorePath(path)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HYPERBEAM_NODE_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/${path}`, {
      headers: preferJson ? { accept: 'application/json' } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return parseStoreResponse(response);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function hyperbeamNodeFetchImmutableJson(id) {
  if (!isOutpointId(id) && !isStandaloneImmutableId(id)) return null;
  // `accept-bundle` inlines the node-decoded native `value` sub-message so
  // legacy and native content parse through one shape. Bare `GET /<id>` store
  // fall-through (with node-side cache warming) serves legacy outpoints too.
  return hyperbeamNodeFetchStorePath(`${encodeDataPath(id)}?accept-bundle=true`, false);
}

function unwrapJsonRpcResult(json) {
  if (json?.error) {
    throw new Error(json.error.message || json.error);
  }

  return json && Object.prototype.hasOwnProperty.call(json, 'result') ? json.result : json;
}

function storeResponsePayload(json) {
  if (!json || json.error) return null;
  return json && Object.prototype.hasOwnProperty.call(json, 'result') ? json.result : json;
}

async function parseStoreResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json().catch(() => null);

  const body = Buffer.from(await response.arrayBuffer());
  const headers = responseHeadersObject(response);
  if (contentType.includes('multipart/form-data')) {
    return {
      ...headers,
      ...parseMultipartBytes(body, contentType),
    };
  }

  return {
    ...headers,
    body: body.toString('utf8'),
  };
}

function responseHeadersObject(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function parseMultipartBytes(body, contentType) {
  const boundary = contentType.match(/boundary="?([^";]+)"?/i)?.[1];
  if (!boundary) return { body: body.toString('utf8') };

  const text = body.toString('latin1');
  const result = {};
  for (const segment of text.split(`--${boundary}`)) {
    // Sub-message parts (e.g. `value`, `value/source`) are header-only; blob
    // parts (`claim`, `raw-transaction`) carry a `\r\n\r\n` body.
    const separator = segment.indexOf('\r\n\r\n');
    const rawHeaders = separator === -1 ? segment : segment.slice(0, separator);
    const name = rawHeaders.match(/name="([^"]+)"/i)?.[1];
    if (!name || isBundleHousekeepingPart(name)) continue;

    const path = name.split('/').filter(Boolean);
    const fields = parsePartHeaderFields(rawHeaders);
    if (Object.keys(fields).length > 0) {
      Object.assign(ensureNestedObject(result, path), fields);
    } else if (separator !== -1) {
      const partBody = segment.slice(separator + 4).replace(/\r\n$/, '');
      setNestedValue(result, path, Buffer.from(partBody, 'latin1').toString('hex'));
    }
  }

  return arrayifyNumericMaps(result);
}

function isBundleHousekeepingPart(name) {
  const segments = name.split('/');
  return segments.includes('commitments') || segments[segments.length - 1] === 'committed';
}

const BUNDLE_META_HEADERS = new Set([
  'content-disposition',
  'content-type',
  'ao-types',
  'content-digest',
  'signature',
  'signature-input',
]);

function parsePartHeaderFields(rawHeaders) {
  const types = parseAoTypes(rawHeaders);
  const fields = {};
  for (const line of rawHeaders.split(/\r\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim().toLowerCase();
    const raw = line.slice(separator + 1).trim();
    if (!key || BUNDLE_META_HEADERS.has(key)) continue;

    fields[key] = types[key] === 'integer' ? Number(raw) : Buffer.from(raw, 'latin1').toString('utf8');
  }
  return fields;
}

function parseAoTypes(rawHeaders) {
  const line = rawHeaders.match(/ao-types:\s*([^\r\n]+)/i)?.[1];
  if (!line) return {};

  const types = {};
  for (const match of line.matchAll(/([a-z0-9_-]+)\s*=\s*"([^"]+)"/gi)) {
    types[match[1].toLowerCase()] = match[2];
  }
  return types;
}

function ensureNestedObject(root, path) {
  let current = root;
  for (const key of path) {
    if (typeof current[key] !== 'object' || current[key] === null) current[key] = {};
    current = current[key];
  }
  return current;
}

function setNestedValue(root, path, value) {
  if (!path.length) return;
  const leaf = path[path.length - 1];
  ensureNestedObject(root, path.slice(0, -1))[leaf] = value;
}

function arrayifyNumericMaps(value) {
  if (!isObject(value)) return value;

  const keys = Object.keys(value);
  const isSequential = keys.length > 0 && keys.every((key, index) => key === String(index + 1));
  if (isSequential) return keys.map((key) => arrayifyNumericMaps(value[key]));

  const result = {};
  for (const key of keys) result[key] = arrayifyNumericMaps(value[key]);
  return result;
}

function hyperbeamNodeMediaUrl(uri) {
  if (!hyperbeamNodeConfigured()) return '';
  if (allowHyperbeamCompatibilityReads()) {
    const base = hyperbeamNodeBase();
    if (base) return `${base}/odysee/media/stream/${encodeURIComponent(uri)}`;
  }
  const base = deviceBase(HYPERBEAM_DEVICE_STREAM);
  return base ? `${base}/media?uri=${encodeURIComponent(uri)}` : '';
}

function hyperbeamMode() {
  if (!ODYSEE_HYPERBEAM_NODE_API) return 'original';
  if (typeof window === 'undefined') return 'hyperbeam';
  const value = window.localStorage && window.localStorage.getItem(HYPERBEAM_MODE_STORAGE_KEY);
  if (value === 'hybrid') return 'hyperbeam';
  return value === 'original' || value === 'hyperbeam' ? value : 'hyperbeam';
}

function splitClaimIdChannelUris(urls) {
  return urls.reduce(
    (groups, uri) => {
      groups[claimIdFromChannelUri(uri) ? 'channelUris' : 'resolveUris'].push(uri);
      return groups;
    },
    { channelUris: [], resolveUris: [] }
  );
}

function claimIdFromChannelUri(uri) {
  const match = String(uri).match(/^lbry:\/\/@[^/]+#([0-9a-f]{40})$/i);
  return match ? match[1] : null;
}

function storePath(prefix, value) {
  return `${prefix}/${encodeURIComponent(value)}`;
}

function allowHyperbeamCompatibilityReads() {
  return HYPERBEAM_ALLOW_COMPATIBILITY_READS !== false;
}

function isCompatibilityStorePath(path) {
  return [
    'odysee/claim/',
    'odysee/claim-id/',
    'odysee/stream/',
    'odysee/stream-id/',
    'odysee/channel/',
    'odysee/channel-id/',
    'odysee/comment/',
    'odysee/comment-id/',
    'odysee/comment-reaction/',
    'odysee/file-view-count/',
    'odysee/file-reaction/',
    'odysee/subscription-count/',
    'odysee/media/stream/',
    'odysee/media/stream-id/',
  ].some((prefix) => path.startsWith(prefix));
}

function isHyperbeamDeviceEnabled(device) {
  const mode = hyperbeamMode();
  if (mode === 'original') return false;
  if (!allowHyperbeamCompatibilityReads() && isHyperbeamCompatibilityDevice(device)) return false;
  return HYPERBEAM_DEVICES.has(device);
}

function isHyperbeamCompatibilityDevice(device) {
  return [
    '~odysee-claim@1.0',
    '~odysee-channel@1.0',
    '~odysee-comment@1.0',
    '~odysee-file@1.0',
    '~odysee-file-reaction@1.0',
    '~odysee-reaction@1.0',
    '~odysee-stream@1.0',
    '~odysee-subscription@1.0',
  ].includes(device);
}

function hyperbeamLocalSdkResult(method, params) {
  switch (method) {
    case 'status':
      return Promise.resolve({ is_running: true, wallet: { available_servers: 1 } });
    case 'wallet_status':
      return Promise.resolve({ is_locked: false, is_syncing: false });
    case 'version':
      return Promise.resolve({ lbrynet_version: 'hyperbeam' });
    case 'resolve':
      if (isStartupResolveProbe(params)) return Promise.resolve({});
      return null;
    case 'ffmpeg_find':
      return Promise.reject(new Error(`${method} requires authentication`));
    default:
      return null;
  }
}

function sdkClaimFromHyperbeam(result) {
  if (!result) return null;
  const claim = result.claim || result;
  const claimId = claim.claim_id || claim['claim-id'];
  if (!claim || !claimId) return claim;
  const txid = claim.txid || claim['tx-id'];
  const nout = claim.nout ?? claim['n-out'];
  const outpoint = claimOutpoint(txid, nout);

  return {
    ...claim,
    claim_id: claimId,
    ...(outpoint
      ? {
          outpoint,
          immutable_id: outpoint,
          immutable_store_path:
            claim['claim-output-store-path'] ||
            claim['claim-proof-store-path'] ||
            `odysee/claim-output/${txid}/${nout}`,
        }
      : {}),
    name: claim.name || claim['claim-name'],
    canonical_url: claim.canonical_url || claim['canonical-url'],
    permanent_url: claim.permanent_url || claim['permanent-url'],
    short_url: claim.short_url || claim['short-url'],
    value_type: claim.value_type || claim['value-type'],
  };
}

function sdkSearchFromHyperbeam(result) {
  if (!result) return null;
  const sdkResult = result.result && Array.isArray(result.result.items) ? result.result : result;

  return {
    ...sdkResult,
    page_size: sdkResult.page_size || sdkResult['page-size'] || result.page_size || result['page-size'],
    total_items: sdkResult.total_items || sdkResult['total-items'] || result.total_items || result['total-items'],
    total_pages: sdkResult.total_pages || sdkResult['total-pages'] || result.total_pages || result['total-pages'],
  };
}

function storePayload(result) {
  const payload = storeResponsePayload(result);
  if (!payload) return null;
  if (typeof payload === 'string') return { body: payload };

  const body = value(payload, 'body');
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return isObject(parsed) ? { ...payload, ...parsed } : payload;
    } catch (e) {
      void e;
    }
  }

  return payload;
}

function compactParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null));
}

function safeClaimName(name) {
  const cleaned = String(name || '')
    .replace(/^lbry:\/\//, '')
    .replace(/[ =&#:$@%?;/\\\n"<>%{}|^~[\]`]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || 'store-object';
}

function slugFromText(text) {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  return safeClaimName(text).toLowerCase();
}

function claimUrl(name, claimId) {
  const suffix = typeof claimId === 'string' && isRouteClaimModifier(claimId) ? `#${claimId}` : '';
  return `lbry://${name}${suffix}`;
}

function isOutpointId(id) {
  return /^[0-9a-f]{64}:[0-9]+$/i.test(String(id || ''));
}

function isStandaloneImmutableId(id) {
  return /^[0-9A-Za-z_-]{41,128}$/.test(String(id || ''));
}

function isClaimId(id) {
  return /^[0-9a-f]{40}$/i.test(String(id || ''));
}

function claimIdFromSignatureInput(input) {
  const match = String(input || '').match(/claim-id="([0-9a-f]{40})"/i);
  return match && match[1];
}

function outpointParts(id) {
  const match = String(id || '').match(/^([0-9a-f]{64}):([0-9]+)$/i);
  return match ? { txid: match[1], nout: Number(match[2]) } : null;
}

function webSafeImmutableId(id) {
  const result = String(id || '');
  const outpoint = result.match(/^([0-9a-f]{64}):([0-9]+)$/i);
  return outpoint ? `out_${outpoint[1]}_${outpoint[2]}` : result;
}

function immutableRouteIdFromUri(uri) {
  const modifier = routeModifierFromUri(uri);
  if (typeof modifier !== 'string') {
    const name = claimNameFromUri(uri);
    return isStandaloneImmutableId(name) ? String(name) : null;
  }

  const outpoint = modifier.match(/^out_([0-9a-f]{64})_([0-9]+)$/i);
  return outpoint ? `${outpoint[1]}:${outpoint[2]}` : null;
}

function streamPartFromUri(uri) {
  const match = String(uri || '').match(/^lbry:\/\/(?:@[^#:/]+(?:[#:][^/]+)?\/)?([^#:/]+)(?:[#:]([^/]+))?/);
  return {
    name: match ? match[1] : null,
    modifier: match && match[2] ? match[2] : null,
  };
}

function routeModifierFromUri(uri) {
  return streamPartFromUri(uri).modifier;
}

function claimNameFromUri(uri) {
  const name = streamPartFromUri(uri).name;
  return name ? safeClaimName(name) : null;
}

function isRouteClaimModifier(claimId) {
  return /^[0-9a-f]{1,40}$/i.test(claimId) || /^[0-9A-Za-z_-]{41,128}$/.test(claimId);
}

function isMediaContentType(contentType) {
  return typeof contentType === 'string' && /^(video|audio|image)\//i.test(contentType);
}

function streamTypeFromMediaType(mediaType) {
  if (typeof mediaType !== 'string') return undefined;
  if (mediaType.startsWith('video/')) return 'video';
  if (mediaType.startsWith('audio/')) return 'audio';
  if (mediaType.startsWith('image/')) return 'image';
}

function thumbnailObject(thumbnail, mediaUrl, mediaType) {
  const result =
    thumbnail || (mediaUrl && typeof mediaType === 'string' && mediaType.startsWith('image/') ? mediaUrl : null);
  if (typeof result === 'string') return { url: result };
  return isObject(result) ? result : undefined;
}

function isObject(source) {
  return Boolean(source) && typeof source === 'object' && !Array.isArray(source);
}

function localUploadSearchParams(params) {
  const hasTarget =
    paramValues(params, 'channel_ids', 'channel-ids', 'channel_id', 'channel-id').length > 0 ||
    paramValues(params, 'claim_ids', 'claim-ids', 'claim_id', 'claim-id', 'txid').length > 0 ||
    paramValues(params, 'name', 'claim-name', 'claim_name').length > 0 ||
    paramValues(params, 'uri', 'uris', 'url', 'urls').length > 0;

  return hasTarget ? params : null;
}

function mergeClaimSearchResults(publicResult, localResult, params) {
  if (!publicResult) return localResult;
  if (!localResult || !localResult.items.length) return publicResult;

  const publicItems = Array.isArray(publicResult.items) ? publicResult.items : [];
  const localOnlyItems = localResult.items.filter((claim) => !publicItems.some((item) => sameClaim(item, claim)));
  if (!localOnlyItems.length) return publicResult;

  const items = [...localOnlyItems, ...publicItems];
  const publicTotal = Number(publicResult.total_items || publicItems.length);
  const totalItems = publicTotal + localOnlyItems.length;
  const pageSize = Number(publicResult.page_size || params.page_size || items.length || 1);

  return {
    ...publicResult,
    items,
    page: Number(publicResult.page || params.page || 1),
    page_size: pageSize,
    total_items: totalItems,
    total_pages: Math.max(Number(publicResult.total_pages || 1), totalPages(totalItems, pageSize)),
  };
}

function uploadClaimFromHyperbeam(item) {
  const claim = sdkClaimFromHyperbeam(item);
  if (!claim) return claim;

  const hyperbeam = claim.hyperbeam || {};
  const claimValue = claim.value || {};
  const source = claimValue.source || {};
  const dataId = value(hyperbeam, 'data-id', 'data_id') || value(source, 'sd_hash', 'sd-hash', 'source');
  const recordId = value(hyperbeam, 'record-id', 'record_id') || claim.claim_id;
  const routeId = recordId || dataId || claim.claim_id;
  const routeUrl = routeId ? `lbry://${routeId}` : claimUrl(claim.name, routeId);
  const explicitMediaUrl = absoluteHyperbeamUrl(claim.streaming_url || claim.download_url || source.url);
  const mediaUrl =
    normalizedUploadMediaUrl(explicitMediaUrl, recordId) ||
    (recordId ? `${hyperbeamNodeBase()}/${encodeDataPath(String(recordId))}` : '') ||
    (dataId ? `${hyperbeamNodeBase()}/${encodeDataPath(String(dataId))}` : '');
  const releaseTime = value(claimValue, 'release_time', 'release-time') || claim.timestamp;

  return {
    ...claim,
    canonical_url: routeUrl,
    permanent_url: routeUrl,
    short_url: routeUrl,
    confirmations: Number(claim.confirmations) > 0 ? claim.confirmations : 1,
    is_my_output: claim.is_my_output !== undefined ? claim.is_my_output : true,
    streaming_url: mediaUrl || claim.streaming_url,
    download_url: mediaUrl || claim.download_url,
    value: {
      ...claimValue,
      release_time: releaseTime,
      source: {
        ...source,
        url: source.url || mediaUrl,
      },
    },
  };
}

function playbackPayloadFromUploadClaim(claim) {
  if (!claim) return null;

  const source = (claim.value && claim.value.source) || {};
  const hyperbeam = claim.hyperbeam || {};
  const dataId = value(hyperbeam, 'data-id', 'data_id') || value(source, 'sd_hash', 'sd-hash', 'source');
  const recordId = value(hyperbeam, 'record-id', 'record_id') || value(claim, 'claim_id', 'claim-id');
  const explicitMediaUrl = absoluteHyperbeamUrl(claim.streaming_url || claim.download_url || source.url);
  const mediaUrl =
    normalizedUploadMediaUrl(explicitMediaUrl, recordId) ||
    (recordId ? `${hyperbeamNodeBase()}/${encodeDataPath(String(recordId))}` : '') ||
    (dataId ? `${hyperbeamNodeBase()}/${encodeDataPath(String(dataId))}` : '');
  if (!mediaUrl) return null;

  return {
    streaming_url: mediaUrl,
    download_url: mediaUrl,
    media_type: value(source, 'media_type', 'media-type') || 'application/octet-stream',
    source_size: value(source, 'size', 'byte-size', 'byte_size'),
    claim_id: value(claim, 'claim_id', 'claim-id'),
    claim_name: claim.name,
    file_name: source.name,
    sd_hash: dataId,
  };
}

function immutableClaimFromHyperbeam(result, immutableId, fallbackName) {
  const payload = storePayload(result);
  if (!payload) return null;

  const immutableOutpoint = outpointParts(immutableId);
  const claim = sdkClaimFromHyperbeam(payload) || payload;
  const existingValue = isObject(value(claim, 'value')) ? value(claim, 'value') : {};
  const payloadSource = isObject(value(payload, 'source')) ? value(payload, 'source') : {};
  const valueSource = isObject(value(existingValue, 'source')) ? value(existingValue, 'source') : {};
  const sourceClaimId =
    value(payload, 'claim_id', 'claim-id') ||
    value(claim, 'claim_id', 'claim-id') ||
    claimIdFromSignatureInput(value(payload, 'signature-input'));
  const txid = value(payload, 'txid') || immutableOutpoint?.txid;
  const nout = value(payload, 'nout') || immutableOutpoint?.nout;
  const outpoint =
    typeof txid === 'string' && (typeof nout === 'number' || typeof nout === 'string') ? `${txid}:${nout}` : null;
  const storeId = immutableId || outpoint || value(payload, 'id') || sourceClaimId;
  if (!storeId) return null;
  const frontendClaimId = sourceClaimId || String(storeId);
  const routeClaimId = webSafeImmutableId(storeId);

  const rawName =
    fallbackName ||
    value(payload, 'claim-name', 'claim_name', 'name') ||
    value(claim, 'name') ||
    slugFromText(value(existingValue, 'title') || value(payload, 'title'));
  const name = safeClaimName(rawName || `store-${String(storeId).slice(0, 8)}`);
  const title = value(existingValue, 'title') || value(payload, 'title') || rawName || name;
  const description = value(existingValue, 'description') || value(payload, 'description') || '';
  const device = value(payload, 'device');
  const sdHash =
    value(payload, 'sd_hash', 'sd-hash') ||
    value(payloadSource, 'sd_hash', 'sd-hash') ||
    value(valueSource, 'sd_hash', 'sd-hash');
  const payloadContentType = value(payload, 'content-type');
  const mediaType =
    value(payload, 'media_type', 'media-type') ||
    value(payloadSource, 'media_type', 'media-type') ||
    value(valueSource, 'media_type', 'media-type') ||
    (isMediaContentType(payloadContentType) ? payloadContentType : undefined) ||
    (device === 'lbry-stream@1.0' && sdHash ? 'video/mp4' : undefined);
  const explicitMediaUrl = absoluteHyperbeamUrl(
    value(payload, 'streaming_url', 'streaming-url', 'download_url', 'download-url') ||
      value(payloadSource, 'url') ||
      value(valueSource, 'url')
  );
  const directMediaUrl =
    !String(storeId).includes(':') && isMediaContentType(mediaType)
      ? `${hyperbeamNodeBase()}/${encodeDataPath(storeId)}`
      : '';
  const claimMediaUrl =
    name && isClaimId(sourceClaimId)
      ? `${hyperbeamNodeBase()}/${HYPERBEAM_DEVICE_STREAM}/media?claim-name=${encodeURIComponent(name)}&claim-id=${encodeURIComponent(String(sourceClaimId))}`
      : '';
  const mediaUrl =
    explicitMediaUrl ||
    claimMediaUrl ||
    hyperbeamMediaUrlFromPayload({
      ...payload,
      sd_hash: sdHash,
      'sd-hash': sdHash,
      media_type: mediaType,
      'media-type': mediaType,
    }) ||
    directMediaUrl;
  const canonicalUrl =
    value(claim, 'canonical_url', 'canonical-url') ||
    value(payload, 'canonical_url', 'canonical-url') ||
    claimUrl(name, routeClaimId);
  const permanentUrl =
    value(claim, 'permanent_url', 'permanent-url') ||
    value(payload, 'permanent_url', 'permanent-url') ||
    claimUrl(name, routeClaimId);
  const valueType =
    value(claim, 'value_type', 'value-type') ||
    value(payload, 'value_type', 'value-type') ||
    (device === 'lbry-channel@1.0' || device === 'odysee-channel@1.0' ? 'channel' : 'stream');

  return compactParams({
    ...claim,
    claim_id: frontendClaimId,
    txid,
    nout,
    name,
    canonical_url: canonicalUrl,
    permanent_url: permanentUrl,
    short_url: value(claim, 'short_url', 'short-url') || permanentUrl,
    value_type: valueType,
    timestamp: value(claim, 'timestamp') || value(payload, 'timestamp', 'release_time', 'release-time'),
    confirmations: Number(value(claim, 'confirmations') || 1),
    is_my_output: value(claim, 'is_my_output', 'is-my-output'),
    streaming_url: mediaUrl || value(claim, 'streaming_url', 'streaming-url'),
    download_url: mediaUrl || value(claim, 'download_url', 'download-url'),
    value: compactParams({
      ...existingValue,
      title,
      description,
      thumbnail: thumbnailObject(value(existingValue, 'thumbnail') || value(payload, 'thumbnail'), mediaUrl, mediaType),
      stream_type: value(existingValue, 'stream_type', 'stream-type') || streamTypeFromMediaType(mediaType),
      source: compactParams({
        ...payloadSource,
        ...valueSource,
        sd_hash: sdHash,
        media_type: mediaType,
        name:
          value(payloadSource, 'name') ||
          value(valueSource, 'name') ||
          value(payload, 'filename') ||
          (mediaType === 'video/mp4' ? `${name}.mp4` : undefined),
        size: value(payloadSource, 'size') || value(valueSource, 'size') || value(payload, 'byte-size', 'source-size'),
        url: mediaUrl || value(payloadSource, 'url') || value(valueSource, 'url'),
      }),
    }),
    hyperbeam: compactParams({
      ...(isObject(value(claim, 'hyperbeam')) ? value(claim, 'hyperbeam') : {}),
      immutable_id: String(storeId),
      'immutable-id': String(storeId),
      'store-path': `/${encodeDataPath(String(storeId))}`,
      'source-claim-id': sourceClaimId,
      txid,
      nout,
      device,
    }),
  });
}

function claimMatchesSearchParams(claim, params) {
  return (
    claimTypeMatches(claim, params) &&
    claimIdsMatch(claim, params) &&
    claimNameMatches(claim, params) &&
    claimChannelMatches(claim, params) &&
    claimTagsMatch(claim, params)
  );
}

function claimTypeMatches(claim, params) {
  const types = paramValues(params, 'claim_type', 'claim-type', 'type');
  return types.length === 0 || types.includes(claim.value_type);
}

function claimIdsMatch(claim, params) {
  const ids = paramValues(params, 'claim_ids', 'claim-ids', 'claim_id', 'claim-id', 'txid');
  const immutableIds = paramValues(params, 'immutable_ids', 'immutable-ids', 'immutable_id', 'immutable-id');
  const immutableId = value(claim.hyperbeam, 'immutable_id', 'immutable-id');
  return (
    (ids.length === 0 || ids.includes(claim.claim_id) || ids.includes(immutableId)) &&
    (immutableIds.length === 0 || immutableIds.includes(immutableId) || immutableIds.includes(claim.claim_id))
  );
}

function claimNameMatches(claim, params) {
  const names = paramValues(params, 'name', 'claim-name', 'claim_name');
  return names.length === 0 || names.includes(claim.name);
}

function claimChannelMatches(claim, params) {
  const channelIds = paramValues(params, 'channel_ids', 'channel-ids', 'channel_id', 'channel-id');
  const channelId = value(claim.signing_channel, 'claim_id', 'claim-id', 'id');
  return channelIds.length === 0 || channelIds.includes(channelId);
}

function claimTagsMatch(claim, params) {
  const tags = paramValues(claim.value || {}, 'tags');
  const anyTags = paramValues(params, 'any_tags', 'any-tags');
  const notTags = paramValues(params, 'not_tags', 'not-tags');
  return (
    (anyTags.length === 0 || anyTags.some((tag) => tags.includes(tag))) && !notTags.some((tag) => tags.includes(tag))
  );
}

function paramValues(source, ...keys) {
  const raw = value(source, ...keys);
  if (raw === undefined || raw === null || raw === '') return [];
  if (Array.isArray(raw)) return raw.flatMap((item) => paramValues({ item }, 'item'));
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function sameClaim(a, b) {
  const aId = value(a, 'claim_id', 'claim-id');
  const bId = value(b, 'claim_id', 'claim-id');
  const aImmutableId = value(a?.hyperbeam, 'immutable_id', 'immutable-id');
  const bImmutableId = value(b?.hyperbeam, 'immutable_id', 'immutable-id');
  return Boolean((aImmutableId && bImmutableId && aImmutableId === bImmutableId) || (aId && bId && aId === bId));
}

function totalPages(totalItems, pageSize) {
  return Math.max(1, Math.ceil(totalItems / Math.max(1, pageSize || 1)));
}

function encodeDataPath(id) {
  return id
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function absoluteHyperbeamUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  if (/^https?:\/\//.test(url)) return url;
  const baseUrl = hyperbeamNodeBase();
  return baseUrl && url.startsWith('/') ? `${baseUrl}${url}` : url;
}

function normalizedUploadMediaUrl(url, recordId) {
  if (!url || !recordId || !url.includes('/~odysee-upload@1.0/')) return url || '';
  return `${hyperbeamNodeBase()}/${encodeDataPath(String(recordId))}`;
}

function value(source, ...keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) return source[key];
  }
}

function playbackPayloadFromHyperbeam(result) {
  if (!result) return null;
  if (typeof result.body === 'string') {
    try {
      return playbackPayloadFromHyperbeam(JSON.parse(result.body));
    } catch (e) {
      void e;
    }
  }

  const payload = {
    ...result,
    streaming_url: result.streaming_url || result['streaming-url'],
    download_url: result.download_url || result['download-url'],
    sd_hash: result.sd_hash || result['sd-hash'],
    media_type: result.media_type || result['media-type'],
    claim_id: result.claim_id || result['claim-id'],
    claim_name: result.claim_name || result['claim-name'],
  };
  const mediaUrl = hyperbeamMediaUrlFromPayload(payload);

  return {
    ...payload,
    streaming_url: mediaUrl || payload.streaming_url,
    download_url: mediaUrl || payload.download_url,
  };
}

function hyperbeamMediaUrlFromPayload(payload) {
  const base = hyperbeamNodeBase();
  if (!base || !payload) return '';

  const sdHash = payload.sd_hash || payload['sd-hash'];
  if (sdHash) return `${base}/${HYPERBEAM_DEVICE_STREAM}/media?sd-hash=${encodeURIComponent(String(sdHash))}`;
  if (!allowHyperbeamCompatibilityReads()) return '';

  const streamStorePath = payload['stream-store-path'] || payload.stream_store_path;
  if (typeof streamStorePath === 'string') {
    if (streamStorePath.startsWith('odysee/stream-id/')) {
      return `${base}/odysee/media/stream-id/${encodeURIComponent(streamStorePath.slice('odysee/stream-id/'.length))}`;
    }
    if (streamStorePath.startsWith('odysee/stream/')) {
      return `${base}/odysee/media/stream/${encodeURIComponent(streamStorePath.slice('odysee/stream/'.length))}`;
    }
  }

  const claimId = payload.claim_id || payload['claim-id'];
  if (claimId) return `${base}/odysee/media/stream-id/${encodeURIComponent(String(claimId))}`;
  return '';
}

// --- master-side account/search/cache-path machinery ---

async function hyperbeamNodeSearch(params, extraHeaders) {
  try {
    const result = await hyperbeamNodeFetchJson(
      hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_SEARCH, 'query', params || {}),
      extraHeaders
    );
    const search = sdkSearchFromHyperbeam(result);
    return Array.isArray(search && search.items) ? search : null;
  } catch (e) {
    void e;
    return null;
  }
}

async function hyperbeamNodeChannelClaimSearch(params, extraHeaders) {
  const channelIds = stringList(params.channel_ids || params.channelIds);
  if (!channelIds.length) return null;

  try {
    const page = Number(params.page || 1);
    const pageSize = Number(params.page_size || params['page-size'] || 20);
    let storeIds = (
      await Promise.all(
        channelIds.map(async (channelId) => {
          const result = await hyperbeamNodeFetchJson(
            hyperbeamCacheListPath(`${channelId}/claim-outputs`, { page, page_size: pageSize }),
            extraHeaders
          );
          return Array.isArray(result?.items) ? result.items : [];
        })
      )
    ).flat();
    if (!storeIds.length) {
      storeIds = (
        await Promise.all(
          channelIds.map(async (channelId) => {
            const result = await hyperbeamNodeFetchJson(
              hyperbeamCacheListPath(`${channelId}/claims`, { page, page_size: pageSize }),
              extraHeaders
            );
            return Array.isArray(result?.items) ? result.items : [];
          })
        )
      ).flat();
    }
    if (!storeIds.length) return { items: [], page, page_size: pageSize, total_items: 0, total_pages: 0 };

    const items = (
      await Promise.all(
        storeIds.slice(0, pageSize).map(async (storeId) => {
          const result = await hyperbeamNodeFetchJson(hyperbeamCacheReadPath(storeId), extraHeaders);
          return sdkClaimFromHyperbeam(cacheReadClaim(result));
        })
      )
    ).filter(Boolean);

    return {
      items,
      page,
      page_size: pageSize,
      total_items: storeIds.length,
      total_pages: Math.max(1, Math.ceil(storeIds.length / pageSize)),
    };
  } catch (e) {
    void e;
    return null;
  }
}

async function hyperbeamNodeAccount(method, params, extraHeaders) {
  const key = method.replace(/_/g, '-');
  const result = await hyperbeamNodeFetchJson(
    hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_ACCOUNT, key, params || {}),
    extraHeaders
  );
  return result && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
}

function isStartupResolveProbe(params) {
  const urls = params && (params.urls || params.uris || params.uri);
  if (Array.isArray(urls)) return urls.length === 1 && urls[0] === 'lbry://one';
  return urls === 'lbry://one';
}

function claimOutpoint(txid, nout) {
  if (!txid && txid !== 0) return null;
  if (nout === undefined || nout === null || nout === '') return null;
  return `${txid}:${nout}`;
}

function cacheReadClaim(result) {
  if (Array.isArray(result?.items) && result.items.length) return result.items[0];
  if (Array.isArray(result?.claims) && result.claims.length) return result.claims[0];
  return result;
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value ? [String(value)] : [];
}

function claimIdFromUri(uri) {
  const match = String(uri).match(/#([0-9a-f]{40})(?:$|[/?#])/i);
  return match ? match[1] : null;
}

function hyperbeamCacheReadPath(id) {
  const base = hyperbeamNodeBase();
  return `${base}/${hyperbeamDirectPath(id)}`;
}

function hyperbeamCacheListPath(path, params = {}) {
  const base = hyperbeamNodeBase();
  const urlParams = new URLSearchParams({ list: String(path).replace(/^\//, '') });
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') urlParams.set(key, String(value));
  });
  return `${base}/~cache@1.0/list?${urlParams.toString()}`;
}

function hyperbeamDirectPath(id) {
  return String(id)
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

module.exports = {
  hyperbeamNodeConfigured,
  hyperbeamNodeClaimSearch,
  hyperbeamNodeMediaUrl,
  hyperbeamNodeResolve,
  hyperbeamNodeSdkCall,
};
