import { HYPERBEAM_PLAYBACK_URL } from 'config';
import { fetchStoreStreamEvidenceForUri, hyperbeamStoreReadPath } from 'util/hyperbeam';
import { hyperbeamNodeBase } from 'util/hyperbeamDevices';

const HYPERBEAM_TIMEOUT_MS = 5000;

// The playback request URL is a plain read-only store GET: the node's
// `odysee/stream/<uri>` store path returns the stream claim evidence message
// (claim + sd-hash), from which the media URL is constructed. An explicit
// HYPERBEAM_PLAYBACK_URL config still wins as an external resolver.
export function buildHyperbeamPlaybackUrl(uri: string): string {
  if (HYPERBEAM_PLAYBACK_URL) {
    try {
      const url = new URL(HYPERBEAM_PLAYBACK_URL);
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

  const node = hyperbeamNode();
  return node ? `${node}/${hyperbeamStoreReadPath(`odysee/stream/${uri}`)}` : '';
}

function hyperbeamNode() {
  return hyperbeamNodeBase();
}

export async function fetchHyperbeamPlaybackUrl(uri: string): Promise<string> {
  const requestUrl = buildHyperbeamPlaybackUrl(uri);
  if (!requestUrl) return '';

  const playbackUrl = HYPERBEAM_PLAYBACK_URL
    ? await fetchExternalPlaybackUrl(requestUrl)
    : await fetchStoreStreamEvidenceForUri(uri)
        .then(hyperbeamMediaUrlFromPayload)
        .catch(() => '');
  if (!playbackUrl) {
    // eslint-disable-next-line no-console
    console.warn(`[hyperbeam] playback resolution failed for ${uri}; falling back to legacy CDN (node: ${requestUrl})`);
  }
  return playbackUrl;
}

async function fetchExternalPlaybackUrl(requestUrl: string): Promise<string> {
  try {
    const response = await fetch(requestUrl, {
      headers: { accept: 'application/json' },
      signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS),
    });
    const body = response.ok ? await response.json().catch(() => null) : null;
    const payload = playbackPayload(body);
    if (!payload) return '';

    // An external playback resolver returns a ready-to-use media URL; prefer
    // it over anything we could reconstruct locally.
    const direct = payload.streaming_url || payload['streaming-url'] || payload.download_url || payload['download-url'];
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
    return `${node}/${hyperbeamStoreReadPath(`odysee/media/stream-id/${outpoint}`)}`;
  }

  return '';
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  const timeout = typeof AbortSignal !== 'undefined' && (AbortSignal as any).timeout;
  return typeof timeout === 'function' ? timeout(ms) : undefined;
}
