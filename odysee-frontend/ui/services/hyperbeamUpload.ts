import {
  MEMBERS_ONLY_TAGS,
  PURCHASE_TAG,
  PURCHASE_TAG_OLD,
  RENTAL_TAG,
  RENTAL_TAG_OLD,
  SCHEDULED_TAGS,
  VISIBILITY_TAGS,
} from 'constants/tags';
import { hyperbeamNodeBase } from 'util/hyperbeamDevices';
import { getHyperbeamAccount } from 'util/hyperbeamAccount';
import { fetchHyperbeamUploadDelete, fetchHyperbeamUploadUpdate } from 'util/hyperbeam';

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

export function canUpdateThroughHyperbeam(claim: any, publishPayload: PublishParams) {
  return Boolean(hyperbeamNodeBase() && hasValue(publishPayload.claim_id) && hyperbeamClaimRecordId(claim));
}

export function canDeleteThroughHyperbeam(claim: any) {
  return Boolean(hyperbeamNodeBase() && hyperbeamClaimRecordId(claim));
}

// Edit and delete are append-only revision messages through the generic
// `/id` write path (no app device): see ui/util/nativeUploadRevisions.ts.
export async function updateThroughHyperbeam(
  claim: any,
  publishPayload: PublishParams,
  _authToken?: string,
  myChannels?: Array<ChannelClaim> | null
): Promise<PublishResponse> {
  const updated = await fetchHyperbeamUploadUpdate(claim, publishMetadata(publishPayload));
  return normalizePublishResponse({ outputs: [updated] }, publishPayload, null, myChannels);
}

export async function deleteThroughHyperbeam(claim: any, _authToken?: string): Promise<void> {
  await fetchHyperbeamUploadDelete(claim);
}

function hyperbeamClaimRecordId(claim: any) {
  const hyperbeam = claim?.hyperbeam;
  // record-id/record_id come from a fresh publish response; a claim resolved
  // from the node after a reload carries the same id as immutable_id.
  return (
    hyperbeam?.['record-id'] ||
    hyperbeam?.record_id ||
    hyperbeam?.['data-id'] ||
    hyperbeam?.data_id ||
    hyperbeam?.immutable_id ||
    hyperbeam?.['immutable-id'] ||
    ''
  );
}

export async function publishThroughHyperbeam(
  file: Blob,
  publishPayload: PublishParams,
  _authToken: string,
  myChannels?: Array<ChannelClaim> | null
): Promise<PublishResponse> {
  // Every native upload is attributed to the signed-in profile: an anonymous
  // index message can never be claimed by a channel later, so without an
  // account the upload would be permanently orphaned.
  const account = getHyperbeamAccount();
  if (!account) throw new Error('Sign in with your account before publishing.');
  const signingChannel = signingChannelFromPayload(publishPayload, myChannels);
  const channel = signingChannel ? channelSummary(signingChannel) : { claim_id: account.id, name: account.name };
  const uploadPayload = {
    filename: fileName(file, publishPayload),
    content_type: file.type || publishPayload.content_type || 'application/octet-stream',
    size: file.size,
    name: publishPayload.name,
    metadata: {
      ...publishMetadata(publishPayload),
      ...(await fileMediaMetadata(file)),
      channel,
    },
  };
  const storeResponse = await genericStoreWriteResponse(file);
  if (!storeResponse) throw new Error('HyperBEAM node is not configured.');
  const storeJson = await responseJsonWithHeaders(storeResponse);
  if (!storeResponse.ok) throw new Error(errorMessage(storeJson, storeResponse.status));

  const dataId = storeWriteId(storeJson);
  if (!dataId) throw new Error('HyperBEAM store write response did not include an ID.');

  const indexResponse = await indexUploadResponse(dataId, uploadPayload);
  if (!indexResponse) throw new Error('HyperBEAM node is not configured.');
  const indexJson = await responseJsonWithHeaders(indexResponse);
  if (!indexResponse.ok) throw new Error(errorMessage(indexJson, indexResponse.status));

  const recordId = storeWriteId(indexJson);
  if (!recordId) throw new Error('HyperBEAM upload index did not return an ID.');

  return normalizePublishResponse(
    synthesizedUploadResponse(recordId, dataId, uploadPayload),
    publishPayload,
    file,
    myChannels
  );
}

// The stored index message resolves back into a claim through the
// immutable-id route (`immutableClaimFromHyperbeam`), so the publish
// response is synthesized from the same fields the resolver reads.
function synthesizedUploadResponse(recordId: string, dataId: string, uploadPayload: Record<string, any>) {
  const metadata = uploadPayload.metadata || {};
  return {
    'record-id': recordId,
    'read-path': `/${dataId}`,
    outputs: [
      {
        name: uploadPayload.name,
        normalized_name: uploadPayload.name,
        claim_id: recordId,
        value_type: 'stream',
        confirmations: 1,
        meta: {},
        ...(metadata.channel ? { signing_channel: metadata.channel, is_channel_signature_valid: true } : {}),
        value: {
          title: metadata.title,
          description: metadata.description,
          ...(metadata.thumbnail_url ? { thumbnail: { url: metadata.thumbnail_url } } : {}),
          ...(metadata.video ? { video: metadata.video } : {}),
          ...(metadata.audio ? { audio: metadata.audio } : {}),
          source: {
            name: uploadPayload.filename,
            size: String(uploadPayload.size || ''),
            media_type: uploadPayload.content_type,
          },
        },
        hyperbeam: {
          device: 'odysee-upload@1.0',
          'record-id': recordId,
          record_id: recordId,
          'data-id': dataId,
          data_id: dataId,
        },
      },
    ],
  };
}

async function genericStoreWriteResponse(file: Blob) {
  const base = hyperbeamNodeBase();
  if (!base) return null;

  return fetch(`${base}/id?0.%21=true&committers=all`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': file.type || 'application/octet-stream',
    },
    body: file,
  });
}

// The index record is a plain native message. Stage 0 is committed with the
// caller's auth-hook identity and persisted exactly like a comment; the
// trailing `id` stage only resolves that immutable identity.
async function indexUploadResponse(dataId: string, uploadPayload: Record<string, any>) {
  const base = hyperbeamNodeBase();
  if (!base) return null;

  const metadata = uploadPayload.metadata || {};
  const channel = metadata.channel || {};
  const message: Record<string, any> = {
    schema: 'odysee-upload@1.0',
    type: 'upload',
    name: uploadPayload.name,
    filename: uploadPayload.filename,
    'content-type': uploadPayload.content_type,
    'source-size': String(uploadPayload.size || ''),
    'data-id': dataId,
    'streaming-url': `/${dataId}`,
    title: metadata.title,
    description: metadata.description,
    'thumbnail-url': metadata.thumbnail_url,
    license: metadata.license,
    'release-time': metadata.release_time,
    'channel-id': channel.claim_id,
    'channel-name': channel.name,
    timestamp: Math.floor(Date.now() / 1000),
  };
  const body = Object.fromEntries(
    Object.entries(message).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );

  return fetch(`${base}/id?0.%21=true&committers=all`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
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
  file: Blob | null,
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
  const sourceSize = source.size || (file ? String(file.size) : '');
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
  const path =
    json?.['message-id'] || json?.path || json?.id || json?.['read-path'] || json?.read_path || json?.url || json?.body;
  return typeof path === 'string' ? path.replace(/^\//, '') : '';
}

async function responseJsonWithHeaders(response: Response) {
  const json = await responseJson(response);
  const headers = ['message-id', 'id', 'path', 'read-path', 'url'].reduce<Record<string, string>>((acc, name) => {
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

function fileName(file: Blob | null, publishPayload: PublishParams) {
  return typeof File !== 'undefined' && file instanceof File && file.name ? file.name : publishPayload.name || 'upload';
}

function isBlob(value: any): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

const MEDIA_METADATA_TIMEOUT_MS = 10000;

function fileMediaMetadata(file: Blob): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const type = file.type || '';
    const isVideo = type.startsWith('video/');
    const isAudio = type.startsWith('audio/');
    if ((!isVideo && !isAudio) || typeof document === 'undefined' || typeof URL === 'undefined') {
      resolve({});
      return;
    }

    const element = document.createElement(isVideo ? 'video' : 'audio');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const finish = (metadata: Record<string, any>) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      element.removeAttribute('src');
      resolve(metadata);
    };
    const timeout = setTimeout(() => finish({}), MEDIA_METADATA_TIMEOUT_MS);

    element.preload = 'metadata';
    element.addEventListener('loadedmetadata', () => {
      clearTimeout(timeout);
      const duration = Number.isFinite(element.duration) ? Math.round(element.duration) : 0;
      if (!duration) {
        finish({});
        return;
      }
      if (isAudio) {
        finish({ audio: { duration } });
        return;
      }

      const video = element as HTMLVideoElement;
      finish({
        video: {
          duration,
          ...(video.videoWidth ? { width: video.videoWidth, height: video.videoHeight } : {}),
        },
      });
    });
    element.addEventListener('error', () => {
      clearTimeout(timeout);
      finish({});
    });
    element.src = objectUrl;
  });
}
