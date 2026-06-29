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
import { isURIValid } from 'util/lbryURI';

const HYPERBEAM_UPLOAD_URL = '/$/api/hyperbeam-upload/v1/large';
const HYPERBEAM_UPLOAD_INDEX_URL = '/$/api/hyperbeam-upload/v1/index';
const HYPERBEAM_UPLOAD_LIST_URL = '/$/api/hyperbeam-upload/v1/list';
const HYPERBEAM_UPLOAD_DELETE_URL = '/$/api/hyperbeam-upload/v1/delete';

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

export async function listHyperbeamPublishes(
  filters: { channelIds?: Array<string | null | undefined> } = {}
): Promise<Array<StreamClaim>> {
  if (!isHyperbeamFullMode()) return [];

  try {
    const channelIds = (filters.channelIds || []).filter(Boolean);
    const response = await fetch(HYPERBEAM_UPLOAD_LIST_URL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(channelIds.length ? { 'x-odysee-channel-ids': channelIds.join(',') } : {}),
      },
      body: JSON.stringify({
        channel_ids: channelIds,
      }),
    });
    const json = await responseJson(response);

    if (!response.ok) {
      return [];
    }

    const result = resultPayload(json);
    const items = Array.isArray(result?.items) ? result.items : [];
    return items
      .filter((item) => item && item.value_type === 'stream' && item.claim_id && item.permanent_url)
      .map(normalizeIndexedHyperbeamClaim)
      .filter((item) => item.permanent_url);
  } catch {
    return [];
  }
}

export async function deleteHyperbeamPublish(claimId: string) {
  const response = await fetch(HYPERBEAM_UPLOAD_DELETE_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ claim_id: claimId }),
  });
  const json = await responseJson(response);

  if (!response.ok) {
    throw new Error(errorMessage(json, response.status));
  }

  return resultPayload(json);
}

function normalizePublishResponse(
  json: any,
  publishPayload: PublishParams,
  file: Blob,
  myChannels?: Array<ChannelClaim> | null
): PublishResponse {
  const uploadId = uploadIdFromResponse(json, file, publishPayload);
  const mediaUrl = mediaUrlFromResponse(json, uploadId);
  const signingChannel = signingChannelFromPayload(publishPayload, myChannels);
  const publishedUri = publishedUriFromPayload(publishPayload, uploadId, signingChannel);
  const sourceName = fileName(file, publishPayload);
  const sourceSize = String(file.size);
  const now = Math.floor(Date.now() / 1000);

  const claim: StreamClaim & {
    streaming_url?: string;
    download_url?: string;
    channel_id?: string;
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
    channel_id: signingChannel?.claim_id,
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

function normalizeIndexedHyperbeamClaim(claim: any) {
  const permanentUrl = validIndexedUri(claim.permanent_url) ? claim.permanent_url : null;
  const canonicalUrl = validIndexedUri(claim.canonical_url) ? claim.canonical_url : permanentUrl;
  const shortUrl = validIndexedUri(claim.short_url) ? claim.short_url : permanentUrl || canonicalUrl;

  return {
    ...claim,
    address: claim.address || '',
    amount: claim.amount || '0',
    claim_op: claim.claim_op || 'create',
    confirmations: claim.confirmations ?? 1,
    height: claim.height ?? 0,
    is_my_output: claim.is_my_output ?? true,
    nout: claim.nout ?? 0,
    permanent_url: permanentUrl,
    short_url: shortUrl,
    canonical_url: canonicalUrl,
    timestamp: claim.timestamp || claim.value?.release_time || claim.meta?.creation_timestamp || 0,
    txid: claim.txid || claim.claim_id,
    type: claim.type || 'claim',
    meta: normalizeIndexedClaimMeta(claim.meta),
    signing_channel: claim.signing_channel ? normalizeIndexedChannel(claim.signing_channel) : claim.signing_channel,
  };
}

function validIndexedUri(uri: any) {
  return typeof uri === 'string' && isURIValid(uri, false);
}

function normalizeIndexedChannel(channel: any) {
  return {
    ...channel,
    type: channel.type || 'claim',
    value_type: channel.value_type || 'channel',
    meta: normalizeIndexedClaimMeta(channel.meta),
  };
}

function normalizeIndexedClaimMeta(meta: any = {}) {
  return {
    activation_height: meta.activation_height ?? 0,
    claims_in_channel: meta.claims_in_channel ?? 0,
    creation_height: meta.creation_height ?? 0,
    creation_timestamp: meta.creation_timestamp ?? 0,
    effective_amount: meta.effective_amount ?? '0',
    expiration_height: meta.expiration_height ?? 0,
    is_controlling: meta.is_controlling ?? true,
    reposted: meta.reposted ?? 0,
    support_amount: meta.support_amount ?? '0',
    ...meta,
  };
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

function publishedUriFromPayload(publishPayload: PublishParams, uploadId: string, signingChannel?: ChannelClaim) {
  if (!signingChannel) {
    const existingUri = publishPayload.permanent_url || publishPayload.canonical_url || publishPayload.short_url;
    return existingUri ? uriWithStreamClaimId(existingUri, uploadId) : `lbry://${publishPayload.name}#${uploadId}`;
  }

  const channelBaseUrl = signingChannel.short_url || signingChannel.canonical_url || signingChannel.permanent_url;
  return channelBaseUrl
    ? `${channelBaseUrl}/${publishPayload.name}#${uploadId}`
    : `lbry://${publishPayload.name}#${uploadId}`;
}

function uriWithStreamClaimId(uri: string, uploadId: string) {
  const lastSegment = uri.split('/').pop() || uri;
  return lastSegment.includes('#') ? uri : `${uri}#${uploadId}`;
}

function uploadIdFromResponse(json: any, file: Blob, publishPayload: PublishParams) {
  const returnedId = json?.id || json?.path || json?.read_path;
  if (returnedId) return String(returnedId).replace(/^\//, '');

  const source = [publishPayload.name || fileName(file, publishPayload), file.size, file.type, Date.now()].join(':');
  return `hyperbeam-local-${hashString(source)}`;
}

function mediaUrlFromResponse(json: any, uploadId: string) {
  const readPath = json?.read_path || json?.readPath || json?.url;
  const id = String(json?.id || readPath || uploadId).replace(/^\//, '');
  return id ? `/$/api/hyperbeam-upload/v1/read/${encodeURIComponent(id)}` : '';
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
  const message = json?.body || json?.details || json?.error;

  if (typeof message === 'string' && /<!doctype html|<html[\s>]/i.test(message)) {
    return `HyperBEAM upload failed with ${status}: received an HTML response instead of JSON`;
  }

  if (typeof message === 'string') return message;
  if (message) {
    try {
      return JSON.stringify(message);
    } catch {}
  }

  return `HyperBEAM upload failed with ${status}`;
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

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
