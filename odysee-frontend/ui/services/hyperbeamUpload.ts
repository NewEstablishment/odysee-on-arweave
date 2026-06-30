import { X_LBRY_AUTH_TOKEN } from 'constants/token';
import {
  MEMBERS_ONLY_TAGS,
  PURCHASE_TAG,
  PURCHASE_TAG_OLD,
  RENTAL_TAG,
  RENTAL_TAG_OLD,
  SCHEDULED_TAGS,
  VISIBILITY_TAGS,
} from 'constants/tags';
import { isHyperbeamFullMode } from 'util/hyperbeamMode';
import {
  HYPERBEAM_DEVICE,
  base64Url,
  hyperbeamDeviceBase,
  hyperbeamDevicePostParams64,
  hyperbeamNodeBase,
} from 'util/hyperbeamDevices';

const LARGE_UPLOAD_THRESHOLD_BYTES = 8 * 1024 * 1024;
const UNSUPPORTED_EXACT_TAGS = new Set([
  ...MEMBERS_ONLY_TAGS,
  PURCHASE_TAG,
  RENTAL_TAG,
  ...Object.values(VISIBILITY_TAGS),
  ...Object.values(SCHEDULED_TAGS),
]);

export function canPublishThroughHyperbeam(
  filePath: any,
  publishPayload: PublishParams,
  publishType?: PublishType
): filePath is Blob {
  return Boolean(
    isHyperbeamFullMode() &&
    hyperbeamNodeBase() &&
    publishType === 'file' &&
    isBlob(filePath) &&
    !hasValue(publishPayload.claim_id) &&
    !hasValue(publishPayload.remote_url) &&
    !hasValue(publishPayload.fee_amount) &&
    !hasValue(publishPayload.fee_currency) &&
    !publishPayload.optimize_file &&
    !hasUnsupportedTags(publishPayload.tags)
  );
}

export async function publishThroughHyperbeam(
  file: Blob,
  publishPayload: PublishParams,
  authToken: string,
  myChannels?: Array<ChannelClaim> | null
): Promise<PublishResponse> {
  const signingChannel = signingChannelFromPayload(publishPayload, myChannels);
  const uploadPayload = {
    filename: fileName(file, publishPayload),
    content_type: file.type || publishPayload.content_type || 'application/octet-stream',
    size: file.size,
    name: publishPayload.name,
    metadata: {
      ...publishMetadata(publishPayload),
      ...(signingChannel ? { channel: channelSummary(signingChannel) } : {}),
    },
  };
  const storeResponse = await genericStoreWriteResponse(file);
  if (storeResponse) {
    const storeJson = await responseJsonWithHeaders(storeResponse);
    if (storeResponse.ok)
      return publishIndexedStoreWrite(storeJson, uploadPayload, publishPayload, file, authToken, myChannels);
    if (!shouldFallbackStoreWrite(storeResponse.status)) throw new Error(errorMessage(storeJson, storeResponse.status));
  }

  const cacheResponse = await cacheWriteResponse(file, authToken);
  if (cacheResponse) {
    const cacheJson = await responseJsonWithHeaders(cacheResponse);
    if (cacheResponse.ok)
      return publishIndexedStoreWrite(cacheJson, uploadPayload, publishPayload, file, authToken, myChannels);
    if (!shouldFallbackStoreWrite(cacheResponse.status)) throw new Error(errorMessage(cacheJson, cacheResponse.status));
  }

  if (!authToken) throw new Error('HyperBEAM upload fallback requires an Odysee auth token.');

  const response =
    file.size >= LARGE_UPLOAD_THRESHOLD_BYTES
      ? (await largeUploadResponse(file, { ...uploadPayload, chunked_manifest: true }, authToken)) ||
        (await directUploadResponse(file, uploadPayload, authToken))
      : await directUploadResponse(file, uploadPayload, authToken);
  const json = await responseJson(response);
  if (!response.ok) throw new Error(errorMessage(json, response.status));

  return normalizePublishResponse(json, publishPayload, file, myChannels);
}

async function genericStoreWriteResponse(file: Blob) {
  const base = hyperbeamNodeBase();
  if (!base) return null;

  return fetch(`${base}/id?!=true`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': file.type || 'application/octet-stream',
    },
    body: file,
  });
}

async function cacheWriteResponse(file: Blob, authToken?: string) {
  const base = hyperbeamDeviceBase(HYPERBEAM_DEVICE.cache);
  if (!base) return null;

  return fetch(`${base}/write?!=true`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': file.type || 'application/octet-stream',
      ...odyseeAuthHeaders(authToken),
    },
    body: file,
  });
}

async function directUploadResponse(file: Blob, uploadPayload: Record<string, any>, authToken: string) {
  const request = hyperbeamDevicePostParams64(
    HYPERBEAM_DEVICE.upload,
    'submit&!',
    {
      ...uploadPayload,
      content_base64: await blobToBase64(file),
    },
    {
      Authorization: `Bearer ${authToken}`,
      [X_LBRY_AUTH_TOKEN]: authToken,
    }
  );
  if (!request) throw new Error('HyperBEAM upload device is not configured.');

  return request;
}

async function publishIndexedStoreWrite(
  json: any,
  uploadPayload: Record<string, any>,
  publishPayload: PublishParams,
  file: Blob,
  authToken: string,
  myChannels?: Array<ChannelClaim> | null
): Promise<PublishResponse> {
  const localResponse = normalizeStoreWriteResponse(json, publishPayload, file, myChannels);
  const indexedResponse = await indexUploadResponse(json, uploadPayload, localResponse, authToken);
  if (!indexedResponse) return localResponse;

  const indexedJson = await responseJson(indexedResponse);
  if (indexedResponse.ok) return normalizePublishResponse(indexedJson, publishPayload, file, myChannels);
  if (!shouldFallbackStoreWrite(indexedResponse.status))
    throw new Error(errorMessage(indexedJson, indexedResponse.status));

  return localResponse;
}

async function indexUploadResponse(
  json: any,
  uploadPayload: Record<string, any>,
  localResponse: PublishResponse,
  authToken?: string
) {
  const claim: any = Array.isArray(localResponse?.outputs) ? localResponse.outputs[0] : null;
  const dataId = storeWriteId(storeWritePayload(json)) || claim?.hyperbeam?.['data-id'];
  if (!dataId || !claim) return null;

  return hyperbeamDevicePostParams64(
    HYPERBEAM_DEVICE.index,
    'upload&!',
    {
      ...uploadPayload,
      data_id: dataId,
      claim,
    },
    odyseeAuthHeaders(authToken)
  );
}

function shouldFallbackStoreWrite(status: number) {
  return status === 403 || status === 404 || status === 405;
}

async function largeUploadResponse(file: Blob, uploadPayload: Record<string, any>, authToken: string) {
  const response = await fetch('/$/api/hyperbeam-upload/v1/large', {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': uploadPayload.content_type || 'application/octet-stream',
      'x-odysee-filename': uploadPayload.filename || 'upload',
      'x-odysee-upload-params64': base64Url(JSON.stringify(uploadPayload || {})),
      Authorization: `Bearer ${authToken}`,
      [X_LBRY_AUTH_TOKEN]: authToken,
    },
    body: file,
  });
  const contentType = response.headers.get('content-type') || '';

  if (response.status === 404 || contentType.includes('text/html')) return null;
  return response;
}

function publishMetadata(publishPayload: PublishParams) {
  const {
    file_path: _filePath,
    uploadUrl: _uploadUrl,
    guid: _guid,
    remote_url: _remoteUrl,
    ...metadata
  } = publishPayload as any;
  return metadata;
}

function normalizePublishResponse(
  json: any,
  publishPayload: PublishParams,
  file: Blob,
  myChannels?: Array<ChannelClaim> | null
): PublishResponse {
  const response = uploadResponse(json);
  const result = response?.result?.outputs ? response.result : response;
  const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
  if (!outputs.length) throw new Error('HyperBEAM upload response did not include a published claim.');

  const mediaUrl = mediaUrlFromResponse(response);
  const source = outputs[0].value?.source || {};
  const signingChannel = signingChannelFromPayload(publishPayload, myChannels);
  const publishedUri = publishedUriFromClaim(outputs[0], publishPayload, signingChannel);
  const sourceName = source.name || fileName(file, publishPayload);
  const sourceSize = source.size || String(file.size);
  const claim: any = {
    ...outputs[0],
    ...(publishedUri
      ? {
          permanent_url: publishedUri,
          canonical_url: publishedUri,
          short_url: publishedUri,
        }
      : {}),
    confirmations: outputs[0].confirmations > 0 ? outputs[0].confirmations : 1,
    is_my_output: true,
    is_channel_signature_valid: Boolean(signingChannel) || outputs[0].is_channel_signature_valid,
    signing_channel: signingChannel ? channelSummary(signingChannel) : outputs[0].signing_channel,
    streaming_url: mediaUrl,
    download_url: mediaUrl,
    value: {
      ...outputs[0].value,
      source: {
        ...source,
        name: sourceName,
        size: sourceSize,
        url: mediaUrl,
      },
    },
  };

  return { ...result, outputs: [claim] };
}

function normalizeStoreWriteResponse(
  json: any,
  publishPayload: PublishParams,
  file: Blob,
  myChannels?: Array<ChannelClaim> | null
): PublishResponse {
  const payload = storeWritePayload(json);
  const dataId = storeWriteId(payload);
  if (!dataId) throw new Error('HyperBEAM store write response did not include an ID.');

  const metadata = publishMetadata(publishPayload);
  const signingChannel = signingChannelFromPayload(publishPayload, myChannels);
  const name = publishPayload.name || fileName(file, publishPayload);
  const mediaUrl = genericReadUrl(dataId);
  const publishedUri = signingChannel
    ? publishedUriFromClaim({ name }, publishPayload, signingChannel)
    : `lbry://${name}#${dataId}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const mediaType = file.type || publishPayload.content_type || 'application/octet-stream';
  const sourceName = fileName(file, publishPayload);
  const claim: any = {
    address: '',
    amount: '0',
    claim_id: dataId,
    claim_op: 'create',
    name,
    normalized_name: name.toLowerCase(),
    permanent_url: publishedUri,
    canonical_url: publishedUri,
    short_url: publishedUri,
    type: 'claim',
    value_type: 'stream',
    confirmations: 1,
    is_my_output: true,
    is_channel_signature_valid: Boolean(signingChannel),
    signing_channel: signingChannel ? channelSummary(signingChannel) : undefined,
    height: 0,
    txid: dataId,
    nout: 0,
    timestamp,
    meta: {
      activation_height: 0,
      creation_height: 0,
      creation_timestamp: timestamp,
      effective_amount: '0',
      expiration_height: 0,
      is_controlling: true,
      reposted: 0,
      support_amount: '0',
    },
    streaming_url: mediaUrl,
    download_url: mediaUrl,
    hyperbeam: {
      'data-id': dataId,
      path: genericReadPath(dataId),
    },
    value: {
      title: metadata.title || name,
      description: metadata.description || '',
      thumbnail: thumbnailValue(metadata.thumbnail_url || metadata.thumbnail),
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      languages: Array.isArray(metadata.languages) ? metadata.languages : [],
      release_time: metadata.release_time || timestamp,
      source: {
        media_type: mediaType,
        name: sourceName,
        size: String(file.size),
        source: dataId,
        sd_hash: dataId,
        url: mediaUrl,
      },
    },
  };

  return { outputs: [claim] };
}

function uploadResponse(json: any) {
  if (json?.result?.outputs || Array.isArray(json?.outputs)) return json;
  if (typeof json?.body !== 'string') return json;

  try {
    const body = JSON.parse(json.body);
    return body?.result?.outputs || Array.isArray(body?.outputs) ? body : json;
  } catch {
    return json;
  }
}

function signingChannelFromPayload(publishPayload: PublishParams, myChannels?: Array<ChannelClaim> | null) {
  return publishPayload.channel_id && myChannels
    ? myChannels.find((channel) => channel.claim_id === publishPayload.channel_id)
    : undefined;
}

function channelSummary(channel: ChannelClaim) {
  return {
    claim_id: channel.claim_id,
    name: channel.name,
    permanent_url: channel.permanent_url,
    canonical_url: channel.canonical_url,
    value: channel.value,
  };
}

function publishedUriFromClaim(claim: any, publishPayload: PublishParams, signingChannel?: ChannelClaim) {
  if (!signingChannel) return claim.permanent_url || claim.canonical_url || claim.short_url || '';

  const channelBaseUrl = signingChannel.short_url || signingChannel.canonical_url || signingChannel.permanent_url;
  return channelBaseUrl ? `${channelBaseUrl}/${claim.name || publishPayload.name}` : '';
}

function mediaUrlFromResponse(json: any) {
  const base = hyperbeamNodeBase();
  const recordId =
    json?.['record-id'] ||
    json?.record_id ||
    json?.id ||
    json?.record?.['record-id'] ||
    json?.record?.record_id ||
    json?.claim?.hyperbeam?.['record-id'];
  const path = json?.['media-path'] || json?.media_path || (recordId ? `/~odysee-upload@1.0/media?id=${recordId}` : '');
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

function genericReadPath(id: string) {
  return `/${id
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

function genericReadUrl(id: string) {
  const base = hyperbeamNodeBase();
  return `${base}${genericReadPath(id)}`;
}

function storeWritePayload(json: any) {
  const body = responseBodyObject(json);
  return body ? { ...json, ...body } : json;
}

function storeWriteId(json: any) {
  const path = json?.path || json?.id || json?.['read-path'] || json?.read_path || json?.url || json?.body;
  return typeof path === 'string' ? path.replace(/^\//, '') : '';
}

function responseBodyObject(json: any) {
  if (json?.body && typeof json.body === 'object') return json.body;
  if (typeof json?.body !== 'string') return null;

  try {
    return JSON.parse(json.body);
  } catch {
    return null;
  }
}

async function responseJsonWithHeaders(response: Response) {
  const json = await responseJson(response);
  const headers = ['id', 'path', 'read-path', 'url'].reduce<Record<string, string>>((acc, name) => {
    const value = response.headers.get(name);
    if (value) acc[name] = value;
    return acc;
  }, {});
  return { ...json, ...headers };
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
  return json?.body || json?.details || json?.error || `HyperBEAM upload failed with ${status}`;
}

function odyseeAuthHeaders(authToken?: string): Record<string, string> {
  return authToken
    ? {
        Authorization: `Bearer ${authToken}`,
        [X_LBRY_AUTH_TOKEN]: authToken,
      }
    : {};
}

function hasValue(value: any) {
  return value !== undefined && value !== null && value !== '';
}

function hasUnsupportedTags(tags: any) {
  if (!Array.isArray(tags)) return false;

  return tags.some((tag) => {
    const value = typeof tag === 'string' ? tag : tag?.name;
    return (
      typeof value === 'string' &&
      (UNSUPPORTED_EXACT_TAGS.has(value) ||
        value.startsWith(`${PURCHASE_TAG}:`) ||
        value.startsWith(`${RENTAL_TAG}:`) ||
        value.startsWith(PURCHASE_TAG_OLD) ||
        value.startsWith(RENTAL_TAG_OLD))
    );
  });
}

function fileName(file: Blob, publishPayload: PublishParams) {
  return typeof File !== 'undefined' && file instanceof File && file.name ? file.name : publishPayload.name || 'upload';
}

function thumbnailValue(value: any) {
  if (!value) return undefined;
  return typeof value === 'string' ? { url: value } : value;
}

function isBlob(value: any): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    });
    reader.addEventListener('error', () => reject(reader.error || new Error('Failed to read upload')));
    reader.readAsDataURL(blob);
  });
}
