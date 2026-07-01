const { ODYSEE_HYPERBEAM_NODE_API } = require('../../config.cjs');

const HYPERBEAM_NODE_TIMEOUT_MS = 15000;
const HYPERBEAM_MODE_STORAGE_KEY = 'odysee-hyperbeam-mode';
const HYPERBEAM_DEVICE_CLAIM = '~odysee-claim@1.0';
const HYPERBEAM_DEVICE_STREAM = '~odysee-stream@1.0';
const HYPERBEAM_DEVICE_ACCOUNT = '~odysee-account@1.0';
const HYPERBEAM_DEVICES = new Set([
  HYPERBEAM_DEVICE_ACCOUNT,
  HYPERBEAM_DEVICE_CLAIM,
  HYPERBEAM_DEVICE_STREAM,
  '~odysee-channel@1.0',
  '~odysee-comment@1.0',
  '~odysee-file@1.0',
  '~odysee-file-reaction@1.0',
  '~odysee-reaction@1.0',
  '~odysee-subscription@1.0',
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
      const claimId = claimIdFromUri(uri);
      if (claimId) {
        try {
          const result = await hyperbeamNodeFetchJson(hyperbeamCacheReadPath(claimId), extraHeaders);
          const claim = sdkClaimFromHyperbeam(cacheReadClaim(result));
          if (claim) return [uri, claim];
        } catch (e) {
          void e;
        }
      }

      const result = await hyperbeamNodeFetchJson(
        hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_CLAIM, 'resolve', { uri }),
        extraHeaders
      );
      return [uri, sdkClaimFromHyperbeam((result && result[uri]) || result)];
    })
  );
}

async function hyperbeamNodeClaimIdChannelEntries(urls, extraHeaders) {
  const uriByClaimId = new Map();
  urls.forEach((uri) => {
    const claimId = claimIdFromChannelUri(uri);
    if (claimId) uriByClaimId.set(claimId.toLowerCase(), uri);
  });

  const result = await hyperbeamNodeFetchJson(
    hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_CLAIM, 'search', { claim_ids: Array.from(uriByClaimId.keys()) }),
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

  const storeResult = await hyperbeamNodeChannelClaimSearch(params || {}, extraHeaders);
  if (storeResult) return storeResult;

  const result = await hyperbeamNodeFetchJson(
    hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_CLAIM, 'search', params || {}),
    extraHeaders
  );
  return sdkSearchFromHyperbeam(result);
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

async function hyperbeamNodeGet(params, extraHeaders) {
  const uri = params && (params.uri || params.url);
  const id = params && (params.id || params.outpoint || params.immutable_id || params.immutableId);
  if (!uri && !id) return null;

  const result = await hyperbeamNodeFetchJson(
    hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_STREAM, 'playback', id ? { id } : { uri }),
    extraHeaders
  );
  return playbackPayloadFromHyperbeam(result);
}

async function hyperbeamNodeAccount(method, params, extraHeaders) {
  const key = method.replace(/_/g, '-');
  const result = await hyperbeamNodeFetchJson(
    hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_ACCOUNT, key, params || {}),
    extraHeaders
  );
  return result && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HYPERBEAM_NODE_TIMEOUT_MS);
  const url = typeof request === 'string' ? request : request.url;
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

function unwrapJsonRpcResult(json) {
  if (json?.error) {
    throw new Error(json.error.message || json.error);
  }

  return json && Object.prototype.hasOwnProperty.call(json, 'result') ? json.result : json;
}

function hyperbeamNodeMediaUrl(uri) {
  if (!hyperbeamNodeConfigured()) return '';
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

function claimIdFromUri(uri) {
  const match = String(uri).match(/#([0-9a-f]{40})(?:$|[/?#])/i);
  return match ? match[1] : null;
}

function isHyperbeamDeviceEnabled(device) {
  const mode = hyperbeamMode();
  if (mode === 'original') return false;
  return HYPERBEAM_DEVICES.has(device);
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

function isStartupResolveProbe(params) {
  const urls = params && (params.urls || params.uris || params.uri);
  if (Array.isArray(urls)) return urls.length === 1 && urls[0] === 'lbry://one';
  return urls === 'lbry://one';
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

function stringList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value ? [String(value)] : [];
}

function playbackPayloadFromHyperbeam(result) {
  if (!result) return null;
  if (typeof result.body === 'string') {
    try {
      return JSON.parse(result.body);
    } catch (e) {
      void e;
    }
  }

  return {
    ...result,
    streaming_url: result.streaming_url || result['streaming-url'],
    download_url: result.download_url || result['download-url'],
    sd_hash: result.sd_hash || result['sd-hash'],
    media_type: result.media_type || result['media-type'],
    claim_id: result.claim_id || result['claim-id'],
    claim_name: result.claim_name || result['claim-name'],
  };
}

module.exports = {
  hyperbeamNodeConfigured,
  hyperbeamNodeClaimSearch,
  hyperbeamNodeMediaUrl,
  hyperbeamNodeResolve,
  hyperbeamNodeSdkCall,
};
