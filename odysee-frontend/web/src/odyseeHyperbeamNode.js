const { HYPERBEAM_ALLOW_COMPATIBILITY_READS, ODYSEE_HYPERBEAM_NODE_API } = require('../../config.cjs');

const HYPERBEAM_NODE_TIMEOUT_MS = 15000;
const HYPERBEAM_MODE_STORAGE_KEY = 'odysee-hyperbeam-mode';
const HYPERBEAM_DEVICE_CLAIM = '~odysee-claim@1.0';
const HYPERBEAM_DEVICE_INDEX = '~odysee-index@1.0';
const HYPERBEAM_DEVICE_STREAM = '~odysee-stream@1.0';
const HYPERBEAM_DEVICE_UPLOAD = '~odysee-upload@1.0';
const HYPERBEAM_DEVICES = new Set([
  HYPERBEAM_DEVICE_CLAIM,
  HYPERBEAM_DEVICE_INDEX,
  HYPERBEAM_DEVICE_STREAM,
  HYPERBEAM_DEVICE_UPLOAD,
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
      const storeClaim = storeResponsePayload(await hyperbeamNodeFetchStoreJson(storePath('odysee/claim', uri)));
      if (storeClaim) return [uri, sdkClaimFromHyperbeam(storeClaim)];

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
  const [result, localUploads] = await Promise.all([
    hyperbeamNodeFetchJson(hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_CLAIM, 'search', params || {}), extraHeaders),
    localParams ? hyperbeamNodeUploadList(localParams, extraHeaders).catch(() => null) : Promise.resolve(null),
  ]);
  const publicResult = sdkSearchFromHyperbeam(result);

  return mergeClaimSearchResults(
    publicResult && Array.isArray(publicResult.items) ? publicResult : null,
    localUploads,
    params || {}
  );
}

async function hyperbeamNodeUploadList(params, extraHeaders) {
  const result =
    (await hyperbeamNodeFetchJson(
      hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_INDEX, 'list', params || {}),
      extraHeaders
    ).catch(() => null)) ||
    (await hyperbeamNodeFetchJson(hyperbeamNodeJsonPath(HYPERBEAM_DEVICE_UPLOAD, 'list', params || {}), extraHeaders));
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
        const result = storeResponsePayload(await hyperbeamNodeFetchStoreJson(encodeDataPath(id)));
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
  'preference_get',
  'preference_set',
  'settings_get',
  'settings_set',
  'settings_clear',
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
  const base = hyperbeamNodeBase();
  if (!base) return null;
  if (!allowHyperbeamCompatibilityReads() && isCompatibilityStorePath(path)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HYPERBEAM_NODE_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/${path}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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

function hyperbeamNodeMediaUrl(uri) {
  if (!hyperbeamNodeConfigured()) return '';
  if (!allowHyperbeamCompatibilityReads()) return '';
  const base = hyperbeamNodeBase();
  return base ? `${base}/odysee/media/stream/${encodeURIComponent(uri)}` : '';
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
      return Promise.resolve({ is_running: true });
    case 'version':
      return Promise.resolve({ lbrynet_version: 'hyperbeam' });
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

  return {
    ...claim,
    claim_id: claimId,
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

function claimUrl(name, claimId) {
  const suffix = typeof claimId === 'string' && /^[0-9a-f]{1,40}$/i.test(claimId) ? `#${claimId}` : '';
  return `lbry://${name}${suffix}`;
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
  const result = thumbnail || (mediaUrl && typeof mediaType === 'string' && mediaType.startsWith('image/') ? mediaUrl : null);
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
  const explicitMediaUrl = absoluteHyperbeamUrl(claim.streaming_url || claim.download_url || source.url);
  const mediaUrl =
    explicitMediaUrl ||
    (dataId ? `${hyperbeamNodeBase()}/${encodeDataPath(String(dataId))}` : '') ||
    (recordId ? `${hyperbeamNodeBase()}/${HYPERBEAM_DEVICE_UPLOAD}/media?id=${encodeURIComponent(recordId)}` : '');
  const releaseTime = value(claimValue, 'release_time', 'release-time') || claim.timestamp;

  return {
    ...claim,
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

function immutableClaimFromHyperbeam(result, immutableId) {
  const payload = storePayload(result);
  if (!payload) return null;

  const claim = sdkClaimFromHyperbeam(payload) || payload;
  const existingValue = isObject(value(claim, 'value')) ? value(claim, 'value') : {};
  const payloadSource = isObject(value(payload, 'source')) ? value(payload, 'source') : {};
  const valueSource = isObject(value(existingValue, 'source')) ? value(existingValue, 'source') : {};
  const sourceClaimId = value(payload, 'claim_id', 'claim-id') || value(claim, 'claim_id', 'claim-id');
  const txid = value(payload, 'txid');
  const nout = value(payload, 'nout');
  const outpoint =
    typeof txid === 'string' && (typeof nout === 'number' || typeof nout === 'string') ? `${txid}:${nout}` : null;
  const storeId = immutableId || outpoint || value(payload, 'id') || sourceClaimId;
  if (!storeId) return null;

  const rawName = value(payload, 'claim-name', 'claim_name', 'name') || value(claim, 'name');
  const name = safeClaimName(rawName || `store-${String(storeId).slice(0, 8)}`);
  const title = value(existingValue, 'title') || value(payload, 'title') || rawName || name;
  const description = value(existingValue, 'description') || value(payload, 'description') || '';
  const sdHash =
    value(payload, 'sd_hash', 'sd-hash') ||
    value(payloadSource, 'sd_hash', 'sd-hash') ||
    value(valueSource, 'sd_hash', 'sd-hash');
  const mediaType =
    value(payload, 'media_type', 'media-type', 'content-type') ||
    value(payloadSource, 'media_type', 'media-type') ||
    value(valueSource, 'media_type', 'media-type');
  const explicitMediaUrl = absoluteHyperbeamUrl(
    value(payload, 'streaming_url', 'streaming-url', 'download_url', 'download-url') ||
      value(payloadSource, 'url') ||
      value(valueSource, 'url')
  );
  const directMediaUrl =
    !String(storeId).includes(':') && isMediaContentType(mediaType) ? `${hyperbeamNodeBase()}/${encodeDataPath(storeId)}` : '';
  const mediaUrl =
    explicitMediaUrl ||
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
    claimUrl(name, sourceClaimId);
  const permanentUrl =
    value(claim, 'permanent_url', 'permanent-url') ||
    value(payload, 'permanent_url', 'permanent-url') ||
    claimUrl(name, sourceClaimId);
  const device = value(payload, 'device');
  const valueType =
    value(claim, 'value_type', 'value-type') ||
    value(payload, 'value_type', 'value-type') ||
    (device === 'lbry-channel@1.0' || device === 'odysee-channel@1.0' ? 'channel' : 'stream');

  return compactParams({
    ...claim,
    claim_id: String(storeId),
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
        name: value(payloadSource, 'name') || value(valueSource, 'name') || value(payload, 'filename'),
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
  if (sdHash) return `${base}/odysee/media/sd-hash/${encodeURIComponent(String(sdHash))}`;
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

module.exports = {
  hyperbeamNodeConfigured,
  hyperbeamNodeClaimSearch,
  hyperbeamNodeMediaUrl,
  hyperbeamNodeResolve,
  hyperbeamNodeSdkCall,
};
