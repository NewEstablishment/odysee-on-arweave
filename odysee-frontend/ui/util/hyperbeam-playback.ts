import { HYPERBEAM_BASE_URL, HYPERBEAM_PLAYBACK_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';

const HYPERBEAM_TIMEOUT_MS = 5000;
const ODYSEE_DEVICE = '~odysee@1.0';

export function buildHyperbeamPlaybackUrl(uri: string): string {
  const playbackUrl = hyperbeamPlaybackUrl();
  if (!playbackUrl) return '';

  try {
    const url = new URL(playbackUrl);
    url.searchParams.set('url', uri);
    url.searchParams.set('mode', 'hyperbeam');
    if (!url.searchParams.has('media-base-url')) {
      url.searchParams.set('media-base-url', url.origin);
    }
    return url.toString();
  } catch {
    return '';
  }
}

function hyperbeamPlaybackUrl() {
  if (HYPERBEAM_PLAYBACK_URL) return HYPERBEAM_PLAYBACK_URL;
  const node = String(ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
  return node ? `${node}/~odysee-stream@1.0/playback` : '';
}

export async function fetchHyperbeamPlaybackUrl(uri: string): Promise<string> {
  const storeUrl = buildHyperbeamStoreStreamUrl(uri);
  const storePlaybackUrl = storeUrl ? await fetchPlaybackUrl(storeUrl) : '';
  if (storePlaybackUrl) return storePlaybackUrl;

  const requestUrl = buildHyperbeamPlaybackUrl(uri);
  if (!requestUrl) return '';

  return fetchPlaybackUrl(requestUrl);
}

async function fetchPlaybackUrl(requestUrl: string): Promise<string> {
  try {
    const response = await fetch(requestUrl, { signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS) });
    const body = response.ok ? await response.json().catch(() => null) : null;
    const payload = playbackPayload(body);
    const mediaUrl = hyperbeamMediaUrlFromPayload(payload);
    return (
      mediaUrl ||
      (payload &&
        (payload.download_url || payload['download-url'] || payload.streaming_url || payload['streaming-url'])) ||
      ''
    );
  } catch {
    return '';
  }
}

function buildHyperbeamStoreStreamUrl(uri: string): string {
  const node = String(HYPERBEAM_BASE_URL || ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
  return node ? `${node}/odysee/stream/${encodeURIComponent(uri)}` : '';
}

function playbackPayload(body: any): any {
  if (body?.body && typeof body.body === 'string') {
    try {
      return playbackPayload(JSON.parse(body.body));
    } catch {
      return body;
    }
  }

  return body?.result || body;
}

function hyperbeamMediaUrlFromPayload(payload: any): string {
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
  return sdHash ? `${node}/${ODYSEE_DEVICE}/media?sd-hash=${encodeURIComponent(String(sdHash))}` : '';
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  const timeout = typeof AbortSignal !== 'undefined' && (AbortSignal as any).timeout;
  return typeof timeout === 'function' ? timeout(ms) : undefined;
}
