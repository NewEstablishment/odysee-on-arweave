import { HYPERBEAM_BASE_URL, HYPERBEAM_PLAYBACK_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';

const HYPERBEAM_TIMEOUT_MS = 5000;
const STREAM_DEVICE = '~odysee-stream@1.0';

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
  const node = hyperbeamNode();
  return node ? `${node}/${STREAM_DEVICE}/playback` : '';
}

function hyperbeamNode() {
  return String(HYPERBEAM_BASE_URL || ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
}

export async function fetchHyperbeamPlaybackUrl(uri: string): Promise<string> {
  const requestUrl = buildHyperbeamPlaybackUrl(uri);
  if (!requestUrl) return '';

  const playbackUrl = await fetchPlaybackUrl(requestUrl);
  if (!playbackUrl) {
    // eslint-disable-next-line no-console
    console.warn(`[hyperbeam] playback resolution failed for ${uri}; falling back to legacy CDN (node: ${requestUrl})`);
  }
  return playbackUrl;
}

async function fetchPlaybackUrl(requestUrl: string): Promise<string> {
  try {
    const response = await fetch(requestUrl, { signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS) });
    const body = response.ok ? await response.json().catch(() => null) : null;
    const payload = playbackPayload(body);
    if (!payload) return '';

    // The stream device returns a ready-to-use node media URL; prefer it over
    // anything we could reconstruct locally.
    const direct =
      payload.streaming_url || payload['streaming-url'] || payload.download_url || payload['download-url'];
    if (typeof direct === 'string' && direct) return direct;

    return hyperbeamMediaUrlFromPayload(payload);
  } catch {
    return '';
  }
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
  const node = hyperbeamNode();
  if (!node || !payload) return '';

  const txid = payload.txid;
  const nout = payload.nout;
  const outpoint = payload.outpoint || (txid != null && nout != null ? `${txid}:${nout}` : '');
  if (outpoint) {
    return `${node}/${STREAM_DEVICE}/media?id=${encodeURIComponent(String(outpoint))}`;
  }

  const claimId = payload.claim_id || payload['claim-id'];
  if (claimId) {
    const claimName = payload.claim_name || payload['claim-name'];
    const nameParam = claimName ? `&claim-name=${encodeURIComponent(String(claimName))}` : '';
    return `${node}/${STREAM_DEVICE}/media?claim-id=${encodeURIComponent(String(claimId))}${nameParam}`;
  }

  return '';
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  const timeout = typeof AbortSignal !== 'undefined' && (AbortSignal as any).timeout;
  return typeof timeout === 'function' ? timeout(ms) : undefined;
}
