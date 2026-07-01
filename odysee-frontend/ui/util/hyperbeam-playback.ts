import { HYPERBEAM_PLAYBACK_URL } from 'config';

const HYPERBEAM_TIMEOUT_MS = 5000;

export function buildHyperbeamPlaybackUrl(uri: string, immutableId?: string | null): string {
  if (!HYPERBEAM_PLAYBACK_URL) return '';

  try {
    const url = new URL(HYPERBEAM_PLAYBACK_URL);
    if (immutableId) {
      url.searchParams.set('id', immutableId);
      url.searchParams.delete('url');
      url.searchParams.delete('uri');
    } else {
      url.searchParams.set('url', uri);
    }
    if (!url.searchParams.has('media-base-url')) {
      url.searchParams.set('media-base-url', url.origin);
    }
    return url.toString();
  } catch {
    return '';
  }
}

export async function fetchHyperbeamPlaybackUrl(uri: string, immutableId?: string | null): Promise<string> {
  const requestUrl = buildHyperbeamPlaybackUrl(uri, immutableId);
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
