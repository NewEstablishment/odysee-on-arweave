const Mime = require('mime-types');

const {
  PLAYER_SERVER,
  HYPERBEAM_BASE_URL,
  HYPERBEAM_PLAYBACK_URL,
  ODYSEE_HYPERBEAM_NODE_API,
  URL: SITE_URL,
} = require('../../config.cjs');

const { lbryProxy: Lbry } = require('../lbry');

const { buildURI } = require('./lbryURI');

const HYPERBEAM_TIMEOUT_MS = 5000;
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

  const hyperbeamStreamUrl = await fetchHyperbeamStreamUrl(uri, claimId);
  if (hyperbeamStreamUrl) {
    return hyperbeamStreamUrl;
  }

  return await Lbry.get({
    uri,
  })
    .then(({ streaming_url }) => streaming_url)
    .catch((error) => {
      return '';
    });
}

async function fetchHyperbeamStreamUrl(uri, claimId) {
  const storeUrl = buildHyperbeamStoreStreamUrl(uri, claimId);
  const storeStreamUrl = storeUrl ? await fetchHyperbeamPlaybackPayloadUrl(storeUrl) : '';
  if (storeStreamUrl) {
    return storeStreamUrl;
  }

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
      const mediaUrl = hyperbeamMediaUrlFromPayload(payload);
      return (
        mediaUrl ||
        (payload &&
          (payload.download_url || payload['download-url'] || payload.streaming_url || payload['streaming-url'])) ||
        ''
      );
    }
  } catch (error) {
    return '';
  }

  return '';
}

function buildHyperbeamPlaybackUrl(uri) {
  if (!HYPERBEAM_PLAYBACK_URL) {
    return '';
  }

  try {
    const url = new URL(HYPERBEAM_PLAYBACK_URL);
    url.searchParams.set('url', uri);
    if (!url.searchParams.has('media-base-url')) {
      url.searchParams.set('media-base-url', url.origin);
    }
    return url.toString();
  } catch (error) {
    return '';
  }
}

function buildHyperbeamStoreStreamUrl(uri, claimId) {
  const node = String(HYPERBEAM_BASE_URL || ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
  if (!node) return '';

  const claimIdText = String(claimId || '');
  if (/^[0-9a-f]{40}$/i.test(claimIdText)) {
    return `${node}/odysee/stream-id/${encodeURIComponent(claimIdText)}`;
  }

  return `${node}/odysee/stream/${encodeURIComponent(uri)}`;
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
  const node = String(HYPERBEAM_BASE_URL || ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
  if (!node || !payload) return '';

  const streamStorePath = payload['stream-store-path'] || payload.stream_store_path;
  if (typeof streamStorePath === 'string') {
    if (streamStorePath.startsWith('odysee/stream-id/')) {
      return `${node}/odysee/media/stream-id/${encodeURIComponent(streamStorePath.slice('odysee/stream-id/'.length))}`;
    }
    if (streamStorePath.startsWith('odysee/stream/')) {
      return `${node}/odysee/media/stream/${encodeURIComponent(streamStorePath.slice('odysee/stream/'.length))}`;
    }
  }

  const claimId = payload.claim_id || payload['claim-id'];
  if (claimId) return `${node}/odysee/media/stream-id/${encodeURIComponent(String(claimId))}`;

  const sdHash = payload.sd_hash || payload['sd-hash'];
  return sdHash ? `${node}/odysee/media/sd-hash/${encodeURIComponent(String(sdHash))}` : '';
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
