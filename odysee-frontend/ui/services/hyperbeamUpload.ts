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

const HYPERBEAM_UPLOAD_URL = '/$/api/hyperbeam-upload/v1/large';
const HYPERBEAM_UPLOAD_INDEX_URL = '/$/api/hyperbeam-upload/v1/index';
const HYPERBEAM_UPLOAD_LIST_URL = '/$/api/hyperbeam-upload/v1/list';

const UNSUPPORTED_EXACT_TAGS = new Set([
  ...MEMBERS_ONLY_TAGS,
  PURCHASE_TAG,
  RENTAL_TAG,
  ...Object.values(VISIBILITY_TAGS),
  ...Object.values(SCHEDULED_TAGS),
]);

export function canPublishThroughHyperbeam(
  file: any,
  publishPayload: PublishParams,
  publishType?: string
): file is Blob {
  return Boolean(
    isHyperbeamFullMode() &&
    publishType === 'file' &&
    isBlob(file) &&
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
  myChannels?: Array<ChannelClaim> | null
): Promise<PublishResponse> {
  const response = await fetch(HYPERBEAM_UPLOAD_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': file.type || publishPayload.content_type || 'application/octet-stream',
      'x-odysee-filename': fileName(file, publishPayload),
    },
    body: file,
  });
  const json = await responseJson(response);

  if (!response.ok) {
    throw new Error(errorMessage(json, response.status));
  }

  const publishResponse = normalizePublishResponse(json, publishPayload, file, myChannels);
  await indexHyperbeamPublish(publishResponse.outputs[0]);
  return publishResponse;
}

export async function listHyperbeamPublishes(): Promise<Array<StreamClaim>> {
  if (!isHyperbeamFullMode()) return [];

  const response = await fetch(HYPERBEAM_UPLOAD_LIST_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  const json = await responseJson(response);

  if (!response.ok) {
    return [];
  }

  const result = resultPayload(json);
  const items = Array.isArray(result?.items) ? result.items : [];
  return items.filter((item) => item && item.value_type === 'stream');
}

function normalizePublishResponse(
  json: any,
  publishPayload: PublishParams,
  file: Blob,
  myChannels?: Array<ChannelClaim> | null
): PublishResponse {
  const uploadId = json?.id || json?.path || json?.read_path || `pending-${Date.now()}`;
  const mediaUrl = mediaUrlFromResponse(json);
  const signingChannel = signingChannelFromPayload(publishPayload, myChannels);
  const publishedUri = publishedUriFromPayload(publishPayload, signingChannel);
  const sourceName = fileName(file, publishPayload);
  const sourceSize = String(file.size);
  const now = Math.floor(Date.now() / 1000);

  const claim: StreamClaim & {
    streaming_url?: string;
    download_url?: string;
    hyperbeam_upload?: any;
    hyperbeam?: any;
  } = {
    address: '',
    amount: '0',
    claim_id: uploadId,
    claim_op: 'create',
    height: 0,
    name: publishPayload.name,
    normalized_name: publishPayload.name,
    permanent_url: publishedUri,
    canonical_url: publishedUri,
    short_url: publishedUri,
    type: 'claim',
    value_type: 'stream',
    confirmations: 1,
    is_my_output: true,
    is_channel_signature_valid: Boolean(signingChannel),
    signing_channel: signingChannel || undefined,
    streaming_url: mediaUrl,
    download_url: mediaUrl,
    value: {
      title: publishPayload.title || publishPayload.name,
      description: publishPayload.description || '',
      thumbnail: publishPayload.thumbnail_url ? { url: publishPayload.thumbnail_url } : undefined,
      tags: publishPayload.tags || [],
      languages: publishPayload.languages || [],
      source: {
        name: sourceName,
        size: sourceSize,
        media_type: file.type || publishPayload.content_type || 'application/octet-stream',
      },
    },
    txid: uploadId,
    nout: 0,
    meta: {
      activation_height: 0,
      creation_height: 0,
      creation_timestamp: now,
      effective_amount: '0',
      expiration_height: 0,
      is_controlling: true,
      reposted: 0,
      support_amount: '0',
    },
    timestamp: publishPayload.release_time || now,
    hyperbeam_upload: json,
    hyperbeam: {
      upload_device: '~odysee-upload@1.0',
      upload_id: uploadId,
      read_path: json?.read_path,
    },
  };

  return { outputs: [claim] };
}

async function indexHyperbeamPublish(claim: Claim) {
  const response = await fetch(HYPERBEAM_UPLOAD_INDEX_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ claim }),
  });
  const json = await responseJson(response);

  if (!response.ok) {
    throw new Error(errorMessage(json, response.status));
  }
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

function signingChannelFromPayload(publishPayload: PublishParams, myChannels?: Array<ChannelClaim> | null) {
  return publishPayload.channel_id && myChannels
    ? myChannels.find((channel) => channel.claim_id === publishPayload.channel_id)
    : undefined;
}

function publishedUriFromPayload(publishPayload: PublishParams, signingChannel?: ChannelClaim) {
  if (!signingChannel)
    return publishPayload.permanent_url || publishPayload.canonical_url || publishPayload.short_url || '';

  const channelBaseUrl = signingChannel.short_url || signingChannel.canonical_url || signingChannel.permanent_url;
  return channelBaseUrl ? `${channelBaseUrl}/${publishPayload.name}` : '';
}

function mediaUrlFromResponse(json: any) {
  const readPath = json?.read_path || json?.readPath || json?.url;
  return readPath
    ? `/$/api/hyperbeam-upload/v1/read/${encodeURIComponent(String(json.id || readPath).replace(/^\//, ''))}`
    : '';
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
