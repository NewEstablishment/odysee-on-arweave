import { ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { getHyperbeamMode, HYPERBEAM_MODES, shouldAllowOriginalNetworkFallback } from 'util/hyperbeamMode';

export type HyperbeamDebugLevel = 'info' | 'ok' | 'warn' | 'error';

export type HyperbeamDebugEvent = {
  time: string;
  label: string;
  level: HyperbeamDebugLevel;
  data?: any;
};

const EVENT_NAME = 'odysee-hyperbeam-debug';
const MAX_BUFFERED_EVENTS = 320;
let installed = false;
const bufferedEvents: Array<HyperbeamDebugEvent> = [];

export function hyperbeamDebugColor(level: HyperbeamDebugLevel, sourceLayer?: string) {
  const source = String(sourceLayer || '');
  if (source === 'native-device') return '#0ea5e9';
  if (level === 'error' || source === 'native-failed' || source === 'native-missing') return '#ff4d7d';
  if (source === 'original') return '#94a3b8';
  if (
    level === 'warn' ||
    source.startsWith('fallback') ||
    source === 'device:fallback' ||
    source.startsWith('materialized:')
  ) {
    return '#ffb020';
  }
  if (level === 'ok') return '#22c55e';
  return 'rgba(255,255,255,0.76)';
}

export function pushHyperbeamDebug(label: string, data?: any, level: HyperbeamDebugLevel = 'info') {
  if (typeof window === 'undefined') return;

  const event = {
    time: new Date().toLocaleTimeString(),
    label,
    level,
    data,
  };
  bufferedEvents.push(event);
  if (bufferedEvents.length > MAX_BUFFERED_EVENTS) {
    bufferedEvents.splice(0, bufferedEvents.length - MAX_BUFFERED_EVENTS);
  }

  window.dispatchEvent(
    new CustomEvent(EVENT_NAME, {
      detail: event,
    })
  );
}

export function addHyperbeamDebugListener(listener: (event: HyperbeamDebugEvent) => void) {
  const wrapped = (event: Event) => listener((event as CustomEvent<HyperbeamDebugEvent>).detail);
  window.addEventListener(EVENT_NAME, wrapped);
  bufferedEvents.forEach(listener);
  return () => window.removeEventListener(EVENT_NAME, wrapped);
}

export function installHyperbeamFetchDebug() {
  if (installed || typeof window === 'undefined' || typeof fetch !== 'function') return;

  const nodeBase = String(ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');

  installed = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const mode = getHyperbeamMode();
    const isHyperbeam = Boolean(url && url.startsWith(nodeBase));
    const shouldLog = isHyperbeam || (shouldAllowOriginalNetworkFallback() && isOriginalModeFetch(url));
    const startedAt = performance.now();
    const pageContext = pageContextSummary();
    const requestKey = requestBodyKey(url, init);

    if (shouldLog) {
      pushHyperbeamDebug(
        'request',
        requestSummary(url, input, init, isHyperbeam ? undefined : 'original', pageContext),
        'info'
      );
    }

    try {
      const response = await nativeFetch(input, init);
      if (!shouldLog) return response;

      const elapsedMs = Math.round(performance.now() - startedAt);
      const summary = await responseSummary(
        url,
        response,
        elapsedMs,
        isHyperbeam ? hyperbeamFallbackLayer(url) : 'original',
        pageContext,
        requestKey
      );
      pushHyperbeamDebug('response', summary, response.ok ? 'ok' : 'error');
      return response;
    } catch (error: any) {
      if (shouldLog) {
        pushHyperbeamDebug(
          'request failed',
          {
            ...pageContext,
            url: sanitizeUrl(url),
            method: requestMethod(input, init),
            devicePath: devicePath(url),
            device: hyperbeamDevice(url),
            deviceLayer: hyperbeamDeviceLayer(url),
            sourceLayer: isHyperbeam ? hyperbeamFallbackLayer(url) : 'original',
            requestKey,
            error: String(error?.message || error),
            elapsedMs: Math.round(performance.now() - startedAt),
          },
          'error'
        );
      }

      throw error;
    }
  };
}

function hyperbeamFallbackLayer(url: string) {
  void url;
  return undefined;
}

function isOriginalModeFetch(url: string) {
  if (!url) return false;

  try {
    const parsed = new URL(url, window.location.origin);
    const path = parsed.pathname;
    if (path.startsWith('/public/') || path.startsWith('/static/') || path === '/favicon.ico') return false;
    return true;
  } catch {
    return true;
  }
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(init?.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET') || 'GET');
}

function requestSummary(
  url: string,
  input: RequestInfo | URL,
  init?: RequestInit,
  fallbackSourceLayer?: string,
  pageContext: Record<string, any> = pageContextSummary()
) {
  return {
    ...pageContext,
    method: requestMethod(input, init),
    devicePath: devicePath(url),
    device: hyperbeamDevice(url),
    deviceLayer: hyperbeamDeviceLayer(url),
    nativePath: nativeSourcePath(url),
    nativeSource: nativeSourceKind(url),
    url: sanitizeUrl(url),
    sourceLayer: fallbackSourceLayer,
    bodyBytes: typeof init?.body === 'string' ? init.body.length : undefined,
    requestKey: requestBodyKey(url, init),
  };
}

async function responseSummary(
  url: string,
  response: Response,
  elapsedMs: number,
  fallbackSourceLayer?: string,
  pageContext: Record<string, any> = pageContextSummary(),
  requestKey?: string
) {
  const summary: Record<string, any> = {
    ...pageContext,
    status: response.status,
    ok: response.ok,
    elapsedMs,
    devicePath: devicePath(url),
    device: hyperbeamDevice(url),
    deviceLayer: hyperbeamDeviceLayer(url),
    nativePath: nativeSourcePath(url),
    nativeSource: nativeSourceKind(url),
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    contentRange: response.headers.get('content-range'),
    acceptRanges: response.headers.get('accept-ranges'),
    mediaMs: response.headers.get('x-odysee-media-ms'),
    mediaBlobs: response.headers.get('x-odysee-media-blobs'),
    responseDevice: response.headers.get('device'),
    sourceLayer: response.headers.get('x-odysee-source-layer') || fallbackSourceLayer,
    sourceReason: redactSensitive(response.headers.get('x-odysee-source-reason') || undefined),
    requestKey,
  };
  const signatureInput = response.headers.get('signature-input') || '';
  summary.sourceAlg = nativeResponseDevice(response.headers.get('device'));
  if (signatureInput) {
    summary.signatureInput = redactSensitiveString(signatureInput.slice(0, 900));
    summary.sourceAlg = sourceCommitmentAlg(signatureInput) || nativeResponseDevice(response.headers.get('device'));
  }

  if (!response.ok || (response.headers.get('content-type') || '').includes('application/json')) {
    summary.body = await response
      .clone()
      .text()
      .then((text) => previewBody(text))
      .then((body) => redactSensitive(body))
      .catch(() => null);
    summary.sourceLayer = summary.sourceLayer || sourceLayer(summary.body);
  }

  return summary;
}

function pageContextSummary() {
  if (typeof window === 'undefined') return {};

  return {
    pageUrl: sanitizeUrl(window.location.href),
    pagePath: `${window.location.pathname}${window.location.search}${window.location.hash}`,
  };
}

function sourceLayer(body: any) {
  if (body?.reason === 'native_source_required') return 'native-missing';

  const layer =
    body?.['source-layer'] ||
    body?.['source_layer'] ||
    body?.sourceLayer ||
    body?.result?.['source-layer'] ||
    body?.result?.['source_layer'] ||
    body?.result?.sourceLayer ||
    body?.body?.['source-layer'] ||
    body?.body?.['source_layer'] ||
    body?.body?.sourceLayer;

  if (!layer) return undefined;
  if (layer.native === true) {
    return 'native-device';
  }
  if (layer.native === false) {
    if (layer.fallback === false && layer.source) return 'native-failed';
    const fallback = String(layer.fallback || layer.materialized_from || 'unknown');
    return `fallback:${fallback}`;
  }
  return layer;
}

function sourceCommitmentAlg(signatureInput: string) {
  const match = signatureInput.match(/alg="([^"]+)"/);
  return match?.[1];
}

function requestBodyKey(url: string, init?: RequestInit) {
  if (typeof init?.body !== 'string') return undefined;

  try {
    const body = JSON.parse(init.body);
    const device = hyperbeamDevice(url);
    if (device === '~odysee-claim@1.0') {
      if (body.uri) return `uri:${limitDebugString(body.uri, 120)}`;
      if (body.urls) return `urls:${limitDebugString(String(body.urls), 120)}`;
      if (body.uris) return `uris:${limitDebugString(String(body.uris), 120)}`;
      return `search:${limitDebugString(stableDebugString(body), 180)}`;
    }
    if (body.claim_id || body.claim_ids)
      return `claim:${limitDebugString(String(body.claim_id || body.claim_ids), 120)}`;
    if (body.comment_ids) return `comments:${limitDebugString(String(body.comment_ids), 120)}`;
  } catch (_error) {
    return undefined;
  }

  return undefined;
}

function stableDebugString(value: any): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableDebugString).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableDebugString(value[key])}`)
    .join(',')}}`;
}

function limitDebugString(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function nativeResponseDevice(device: string | null) {
  return device?.startsWith('lbry-') || device?.startsWith('odysee-') ? device : undefined;
}

function nativeSourcePath(url: string) {
  const source = nativeSourceParts(url);
  if (!source) return undefined;
  return source.value ? `${source.kind}:${source.value}` : source.kind;
}

function nativeSourceKind(url: string) {
  return nativeSourceParts(url)?.kind;
}

function nativeSourceParts(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path.endsWith('/~odysee-claim@1.0/transaction')) {
      return {
        kind: 'transaction',
        value: parsed.searchParams.get('txid') || parsed.searchParams.get('id') || undefined,
      };
    }
    if (path.endsWith('/~odysee-claim-output@1.0/fetch')) {
      const txid = parsed.searchParams.get('txid');
      const nout = parsed.searchParams.get('nout');
      return {
        kind: 'claim-output',
        value: txid && nout !== null ? `${txid}:${nout}` : txid || undefined,
      };
    }
    if (path.endsWith('/~odysee-stream-descriptor@1.0/fetch')) {
      return {
        kind: 'stream-descriptor',
        value: parsed.searchParams.get('sd-hash') || parsed.searchParams.get('sd_hash') || undefined,
      };
    }
    if (path.endsWith('/~odysee-blob@1.0/fetch')) {
      return {
        kind: 'blob',
        value: parsed.searchParams.get('blob-hash') || parsed.searchParams.get('blob_hash') || undefined,
      };
    }
  } catch (_error) {
    return undefined;
  }

  return undefined;
}

function previewBody(text: string) {
  if (!text) return text;

  try {
    return JSON.parse(text);
  } catch {
    return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
  }
}

function devicePath(url: string) {
  return sanitizePath(url);
}

function hyperbeamDevice(url: string) {
  try {
    const firstPathPart = new URL(url).pathname.split('/').find(Boolean);
    return firstPathPart?.startsWith('~') ? firstPathPart : undefined;
  } catch {
    return undefined;
  }
}

function hyperbeamDeviceLayer(url: string) {
  const device = hyperbeamDevice(url);
  if (!device) return undefined;
  return 'compat-device';
}

export function sanitizeHyperbeamDebugValue(value: any): any {
  return redactSensitive(value);
}

export function sanitizeHyperbeamDebugUrl(url: string): string {
  return sanitizeUrl(url);
}

function sanitizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${sanitizeParsedPath(parsed)}`;
  } catch {
    return sanitizeUrlLikeString(String(url || ''));
  }
}

function sanitizePath(url: string) {
  try {
    const parsed = new URL(url);
    return sanitizeParsedPath(parsed);
  } catch {
    return sanitizeUrlLikeString(String(url || ''));
  }
}

function sanitizeParsedPath(parsed: URL) {
  if (!parsed.search) return parsed.pathname;

  const params = Array.from(parsed.searchParams.entries()).map(([name, value]) => {
    if (isSensitiveQueryName(name)) return `${name}=...`;
    return `${name}=${redactQueryValue(name, value)}`;
  });
  return `${parsed.pathname}?${params.join('&')}`;
}

function sanitizeUrlLikeString(value: string) {
  return value.replace(/([?&](?:params64|urls64|auth_token|token|signature|uri64)=)[^&\s]+/gi, '$1...');
}

function isSensitiveQueryName(name: string) {
  const key = name.toLowerCase();
  return (
    key === 'params64' ||
    key === 'urls64' ||
    key === 'uri64' ||
    key.includes('auth') ||
    key.includes('token') ||
    key.includes('signature')
  );
}

function redactQueryValue(name: string, value: string) {
  return isSensitiveQueryName(name) ? '...' : encodeURIComponent(value);
}

function redactSensitive(value: any): any {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return redactSensitiveString(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (typeof value !== 'object') return value;

  const redacted: Record<string, any> = {};
  Object.entries(value).forEach(([key, child]) => {
    redacted[key] = isSensitiveFieldName(key) ? '[redacted]' : redactSensitive(child);
  });
  return redacted;
}

function isSensitiveFieldName(name: string) {
  const key = name.toLowerCase().replace(/[-_]/g, '');
  return (
    key === 'authorization' ||
    key === 'auth' ||
    key === 'authtoken' ||
    key === 'xlbryauthtoken' ||
    key.includes('auth') ||
    key.includes('token') ||
    key.includes('signature') ||
    key.includes('password')
  );
}

function redactSensitiveString(value: string) {
  return value
    .replace(/(auth[_-]?token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[redacted]')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[redacted]')
    .replace(/(x[-_]?lbry[-_]?auth[-_]?token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[redacted]')
    .replace(/([?&](?:params64|urls64|auth_token|token|signature|uri64)=)[^&\s]+/gi, '$1...');
}
