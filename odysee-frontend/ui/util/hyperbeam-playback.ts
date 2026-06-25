import { HYPERBEAM_PLAYBACK_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';

const HYPERBEAM_TIMEOUT_MS = 5000;

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
  const requestUrl = buildHyperbeamPlaybackUrl(uri);
  if (!requestUrl) return '';

  try {
    const response = await fetch(requestUrl, { signal: timeoutSignal(HYPERBEAM_TIMEOUT_MS) });
    const body = response.ok ? await response.json().catch(() => null) : null;
    return (body && (body.download_url || body['download-url'] || body.streaming_url || body['streaming-url'])) || '';
  } catch {
    return '';
  }
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  const timeout = typeof AbortSignal !== 'undefined' && (AbortSignal as any).timeout;
  return typeof timeout === 'function' ? timeout(ms) : undefined;
}
