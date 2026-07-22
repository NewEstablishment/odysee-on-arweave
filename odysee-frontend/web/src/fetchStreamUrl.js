const Mime = require('mime-types');

const {
  PLAYER_SERVER,
  HYPERBEAM_BASE_URL,
  HYPERBEAM_PLAYBACK_URL,
  ODYSEE_HYPERBEAM_NODE_API,
  URL: SITE_URL,
} = require('../../config.cjs');

const { buildURI } = require('./lbryURI');

const HYPERBEAM_TIMEOUT_MS = 5000;
const HYPERBEAM_DEVICE_STREAM = '~odysee-stream@1.0';
const EXTRA_PATH_SEGMENT_CHARS = /['()]/g;
const FALLBACK_SOURCE_FILENAME = 'stream';
const SOURCE_HASH_FILENAME_LENGTH = 6;

function encodePathSegmentCharacter(character) {
  return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value ?? '')).replace(EXTRA_PATH_SEGMENT_CHARS, encodePathSegmentCharacter);
}

function getSourceFilename(claim) {
  const source = claim?.value?.source;
  const filename = source?.sd_hash ? source.sd_hash.slice(0, SOURCE_HASH_FILENAME_LENGTH) : FALLBACK_SOURCE_FILENAME;
  const extension = source?.media_type ? Mime.extension(source.media_type) : null;

  return extension ? `${filename}.${extension}` : filename;
}

async function fetchStreamUrl(claimName, claimId) {
  const uri = buildURI({
    streamName: claimName,
    streamClaimId: claimId,
  });

  return fetchHyperbeamStreamUrl(uri);
}

async function fetchHyperbeamStreamUrl(uri) {
  const requestUrl = buildHyperbeamPlaybackUrl(uri);
  if (!requestUrl) {
    return '';
  }

  return fetchHyperbeamPlaybackPayloadUrl(requestUrl);
}

async function fetchHyperbeamPlaybackPayloadUrl(requestUrl) {
  try {
    const response = await fetch(requestUrl, { signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS) });
    if (response.ok) {
      const body = await response.json().catch(() => null);
      const payload = playbackPayload(body);
      if (!payload) return '';

      // The stream device returns a ready-to-use node media URL; prefer it
      // over anything we could reconstruct locally.
      const direct =
        payload.streaming_url || payload['streaming-url'] || payload.download_url || payload['download-url'];
      if (typeof direct === 'string' && direct) return direct;

      return hyperbeamMediaUrlFromPayload(payload);
    }
  } catch (error) {
    return '';
  }

  return '';
}

function buildHyperbeamPlaybackUrl(uri) {
  const playbackUrl = HYPERBEAM_PLAYBACK_URL || defaultHyperbeamPlaybackUrl();
  if (!playbackUrl) {
    return '';
  }

  try {
    const url = new URL(playbackUrl);
    url.searchParams.set('url', uri);
    if (!url.searchParams.has('media-base-url')) {
      url.searchParams.set('media-base-url', url.origin);
    }
    return url.toString();
  } catch (error) {
    return '';
  }
}

function defaultHyperbeamPlaybackUrl() {
  const node = hyperbeamNode();
  return node ? `${node}/${HYPERBEAM_DEVICE_STREAM}/playback` : '';
}

function hyperbeamNode() {
  return String(HYPERBEAM_BASE_URL || ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
}

function playbackPayload(body) {
  if (body && typeof body.body === 'string') {
    try {
      return playbackPayload(JSON.parse(body.body));
    } catch (error) {
      return body;
    }
  }

  return (body && body.result) || body;
}

function hyperbeamMediaUrlFromPayload(payload) {
  const node = hyperbeamNode();
  if (!node || !payload) return '';

  const txid = payload.txid;
  const nout = payload.nout;
  const outpoint = payload.outpoint || (txid != null && nout != null ? `${txid}:${nout}` : '');
  if (outpoint) {
    return `${node}/${HYPERBEAM_DEVICE_STREAM}/media?id=${encodeURIComponent(String(outpoint))}`;
  }

  const claimId = payload.claim_id || payload['claim-id'];
  if (claimId) {
    const claimName = payload.claim_name || payload['claim-name'];
    const nameParam = claimName ? `&claim-name=${encodeURIComponent(String(claimName))}` : '';
    return `${node}/${HYPERBEAM_DEVICE_STREAM}/media?claim-id=${encodeURIComponent(String(claimId))}${nameParam}`;
  }

  return '';
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

/**
 * Direct URL to the content's bits without redirects.
 *
 * Move back to 'utils/web' when `fetchStreamUrl` is no longer needed.
 *
 * @param claim
 */
function generateContentUrl(claim) {
  const streamUrl = (claim) => {
    // Hardcoded version of fetchStreamUrl().
    return `${PLAYER_SERVER}/api/v3/streams/free/${claim.name}/${claim.claim_id}`;
  };

  const value = claim?.value;

  if (value?.source?.media_type && value?.source?.sd_hash) {
    const fileExt = `.${Mime.extension(value.source.media_type)}`;
    const sdHash = value.source.sd_hash.slice(0, 6);
    return `${streamUrl(claim)}/${sdHash}${fileExt}`;
  }

  return streamUrl(claim);
}

function generateDownloadUrl(claim) {
  const value = claim?.value;

  if (value?.source?.media_type && value?.source?.sd_hash) {
    const fileExt = `.${Mime.extension(value.source.media_type)}`;
    const sdHash = value.source.sd_hash.slice(0, 6);
    return `${PLAYER_SERVER}/v6/streams/${claim.claim_id}/${sdHash}${fileExt}`;
  }

  return `${PLAYER_SERVER}/v6/streams/${claim.claim_id}`;
}

function generateRssContentUrl(claim) {
  const siteURL = String(SITE_URL || '').replace(/\/$/, '');
  return `${siteURL}/$/rss/media/${encodePathSegment(claim.name)}/${encodePathSegment(
    claim.claim_id
  )}/${encodePathSegment(getSourceFilename(claim))}`;
}

module.exports = {
  fetchStreamUrl,
  generateContentUrl,
  generateDownloadUrl,
  buildHyperbeamPlaybackUrl,
  generateRssContentUrl,
};
