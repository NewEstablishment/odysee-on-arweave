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
import { HYPERBEAM_DEVICE, hyperbeamDevicePostParams64, hyperbeamNodeBase } from 'util/hyperbeamDevices';

const METADATA_KEYS = [
  'title',
  'description',
  'thumbnail_url',
  'tags',
  'languages',
  'license',
  'license_url',
  'release_time',
];
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
  if (!storeResponse) throw new Error('HyperBEAM node is not configured.');
  const storeJson = await responseJsonWithHeaders(storeResponse);
  if (!storeResponse.ok) throw new Error(errorMessage(storeJson, storeResponse.status));

  const dataId = storeWriteId(storeJson);
  if (!dataId) throw new Error('HyperBEAM store write response did not include an ID.');

  const indexResponse = await indexUploadResponse(dataId, uploadPayload, authToken);
  if (!indexResponse) throw new Error('HyperBEAM upload device is not configured.');
  const indexJson = await responseJson(indexResponse);
  if (!indexResponse.ok) throw new Error(errorMessage(indexJson, indexResponse.status));

  return normalizePublishResponse(indexJson, publishPayload, file, myChannels);
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

async function indexUploadResponse(dataId: string, uploadPayload: Record<string, any>, authToken?: string) {
  return hyperbeamDevicePostParams64(
    HYPERBEAM_DEVICE.upload,
    'index&!',
    {
      ...uploadPayload,
      data_id: dataId,
    },
    odyseeAuthHeaders(authToken)
  );
}

function publishMetadata(publishPayload: PublishParams) {
  const payload = publishPayload as any;
  return METADATA_KEYS.reduce<Record<string, any>>((metadata, key) => {
    if (hasValue(payload[key])) metadata[key] = payload[key];
    return metadata;
  }, {});
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
  const recordId = uploadRecordId(response, outputs[0]);
  const publishedUri = publishedUriFromClaim(outputs[0], publishPayload, signingChannel, recordId);
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
    hyperbeam: {
      ...outputs[0].hyperbeam,
      ...(recordId ? { 'record-id': recordId, record_id: recordId } : {}),
    },
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

function publishedUriFromClaim(
  claim: any,
  publishPayload: PublishParams,
  signingChannel?: ChannelClaim,
  recordId?: string
) {
  const name = claim.name || publishPayload.name;
  const claimId = claim.claim_id || claim['claim-id'] || recordId;

  if (signingChannel) {
    const channelBaseUrl = signingChannel.short_url || signingChannel.canonical_url || signingChannel.permanent_url;
    if (channelBaseUrl && name) return `${channelBaseUrl}/${name}`;
  }
  if (name && claimId) return `lbry://${name}#${claimId}`;
  if (recordId) return `lbry://${recordId}`;

  return claim.permanent_url || claim.canonical_url || claim.short_url || (name ? `lbry://${name}` : '');
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
  const responsePath = json?.['read-path'] || json?.read_path || json?.url || json?.['media-path'] || json?.media_path;
  const path =
    recordId && String(responsePath || '').includes('/~odysee-upload@1.0/')
      ? `/${recordId}`
      : responsePath || (recordId ? `/${recordId}` : '');
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

function uploadRecordId(json: any, claim: any) {
  return (
    json?.['record-id'] ||
    json?.record_id ||
    json?.id ||
    json?.record?.['record-id'] ||
    json?.record?.record_id ||
    claim?.hyperbeam?.['record-id'] ||
    claim?.hyperbeam?.record_id ||
    claim?.claim_id ||
    claim?.['claim-id']
  );
}

function storeWriteId(json: any) {
  const path = json?.path || json?.id || json?.['read-path'] || json?.read_path || json?.url || json?.body;
  return typeof path === 'string' ? path.replace(/^\//, '') : '';
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

function odyseeAuthHeaders(authToken?: string): Record<string, string> {
  return authToken
    ? {
        Authorization: `Bearer ${authToken}`,
        [X_LBRY_AUTH_TOKEN]: authToken,
      }
    : {};
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

function isBlob(value: any): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}
