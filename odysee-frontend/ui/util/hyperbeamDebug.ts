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
const AUTH_REQUIRED_DEVICE_PATHS = new Set([
  '/~odysee-account@1.0/preference-get',
  '/~odysee-account@1.0/preference-set',
  '/~odysee-account@1.0/settings-get',
  '/~odysee-account@1.0/settings-set',
  '/~odysee-account@1.0/settings-clear',
  '/~odysee-account@1.0/user-exists',
  '/~odysee-account@1.0/user-new',
  '/~odysee-account@1.0/user-signin',
  '/~odysee-account@1.0/user-me',
  '/~odysee-account@1.0/user-email-resend-token',
  '/~odysee-file@1.0/view-count',
  '/~odysee-file@1.0/view_count',
  '/~odysee-file-reaction@1.0/list',
  '/~odysee-subscription@1.0/sub-count',
  '/~odysee-subscription@1.0/sub_count',
]);
let installed = false;
let resourceDebugInstalled = false;
let fetchDebugCallId = 0;
const bufferedEvents: Array<HyperbeamDebugEvent> = [];
const seenResourceEvents = new Set<string>();

export function hyperbeamDebugColor(level: HyperbeamDebugLevel, sourceLayer?: string) {
  const source = String(sourceLayer || '');
  if (level === 'error' || source === 'native-failed' || source === 'native-missing') return '#ff4d7d';
  if (source === 'native-device:auth') return '#22c55e';
  if (source === 'native-device') return '#0ea5e9';
  if (source === 'browser-resource') return '#38bdf8';
  if (source === 'original') return '#94a3b8';
  if (
    level === 'warn' ||
    source.startsWith('fallback') ||
    source === 'device:fallback' ||
    source.startsWith('materialized:')
  ) {
    return '#ffb020';
  }
  if (level === 'ok') return 'rgba(255,255,255,0.76)';
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
  installHyperbeamResourceDebug(nodeBase);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const mode = getHyperbeamMode();
    const isHyperbeam = Boolean(url && url.startsWith(nodeBase));
    const shouldLog = isHyperbeam || (shouldAllowOriginalNetworkFallback() && isOriginalModeFetch(url));
    const startedAt = performance.now();
    const pageContext = pageContextSummary();
    const requestKey = requestBodyKey(url, init);
    const callId = `hb-${Date.now().toString(36)}-${(fetchDebugCallId += 1).toString(36)}`;
    const requestData = shouldLog
      ? requestSummary(url, input, init, isHyperbeam ? undefined : 'original', pageContext, callId)
      : undefined;

    if (shouldLog) {
      pushHyperbeamDebug('request', requestData, 'info');
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
        requestKey,
        requestData,
        callId
      );
      pushHyperbeamDebug('response', summary, response.ok ? 'ok' : 'error');
      return response;
    } catch (error: any) {
      if (shouldLog) {
        pushHyperbeamDebug(
          'request failed',
          {
            ...requestData,
            ...pageContext,
            url: sanitizeUrl(url),
            method: requestMethod(input, init),
            devicePath: devicePath(url),
            device: hyperbeamDevice(url),
            deviceLayer: hyperbeamDeviceLayer(url),
            authRequired: isAuthRequiredUrl(url),
            sourceLayer: isHyperbeam ? hyperbeamFallbackLayer(url) : 'original',
            requestKey,
            callId,
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

function installHyperbeamResourceDebug(nodeBase: string) {
  if (resourceDebugInstalled || typeof window === 'undefined' || typeof performance === 'undefined') return;

  resourceDebugInstalled = true;

  const processEntry = (entry: PerformanceResourceTiming) => {
    if (!isFileResourceUrl(entry.name, entry.initiatorType, nodeBase)) return;

    const key = `${entry.name}|${entry.startTime}|${entry.duration}|${entry.transferSize}`;
    if (seenResourceEvents.has(key)) return;
    seenResourceEvents.add(key);
    if (seenResourceEvents.size > 700) {
      const first = seenResourceEvents.values().next().value;
      if (first) seenResourceEvents.delete(first);
    }

    const status = Number((entry as any).responseStatus || 0);
    const ok = !status || status < 400;
    const source = nativeSourceParts(entry.name);
    const nativePath = nativeSourcePath(entry.name) || resourceNativePath(entry.name, entry.initiatorType);

    pushHyperbeamDebug(
      `${resourceEventKind(entry.initiatorType)} response`,
      {
        ...pageContextSummary(),
        callId: `res-${Math.round(entry.startTime)}-${Math.round(entry.duration)}-${seenResourceEvents.size}`,
        method: 'GET',
        status: status || (entry.transferSize || entry.encodedBodySize || entry.decodedBodySize ? 200 : 'loaded'),
        ok,
        elapsedMs: Math.round(entry.duration || 0),
        url: sanitizeUrl(entry.name),
        urlParts: urlParts(entry.name),
        device: hyperbeamDevice(entry.name),
        devicePath: devicePath(entry.name),
        deviceLayer: hyperbeamDeviceLayer(entry.name) || 'browser-resource',
        authRequired: isAuthRequiredUrl(entry.name),
        nativeSource: source?.kind || 'media',
        nativePath,
        sourceLayer: 'browser-resource',
        requestKey: resourceRequestKey(entry.name, entry.initiatorType),
        initiatorType: entry.initiatorType,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        contentLength: entry.decodedBodySize || entry.encodedBodySize || undefined,
        bodyCapture:
          'Browser resource load; request headers, response headers, and body are not exposed to JavaScript.',
      },
      ok ? 'ok' : 'error'
    );
  };

  performance
    .getEntriesByType('resource')
    .filter((entry): entry is PerformanceResourceTiming => 'initiatorType' in entry)
    .forEach(processEntry);

  if (typeof PerformanceObserver !== 'function') return;

  try {
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if ('initiatorType' in entry) processEntry(entry as PerformanceResourceTiming);
      });
    });
    observer.observe({ type: 'resource', buffered: true });
  } catch (_error) {
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if ('initiatorType' in entry) processEntry(entry as PerformanceResourceTiming);
        });
      });
      observer.observe({ entryTypes: ['resource'] });
    } catch (_ignored) {}
  }
}

function isFileResourceUrl(url: string, initiatorType: string, nodeBase: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    const path = parsed.pathname;
    const host = parsed.hostname;
    if (
      path.startsWith('/public/') ||
      path.startsWith('/static/') ||
      path.startsWith('/__') ||
      path === '/favicon.ico' ||
      path.endsWith('.js') ||
      path.endsWith('.css') ||
      path.endsWith('.map')
    ) {
      return false;
    }

    if (path.startsWith('/$/api/hyperbeam-upload/v1/read/')) return true;
    if (path.includes('/~cache@1.0/read')) return true;
    if (path.includes('/~odysee-stream@1.0/media') || path.includes('/~lbry-stream@1.0/media')) return true;
    if (nodeBase && url.startsWith(nodeBase) && mediaInitiator(initiatorType)) return true;
    if (
      mediaInitiator(initiatorType) &&
      (host === 'player.odycdn.com' ||
        host === 'secure.odycdn.com' ||
        host.endsWith('.secure.odycdn.com') ||
        host === 'thumbs.odycdn.com' ||
        host === 'thumbnails.odycdn.com')
    ) {
      return true;
    }
  } catch (_error) {
    return false;
  }

  return false;
}

function mediaInitiator(initiatorType: string) {
  return ['img', 'video', 'audio', 'source', 'track', 'object', 'embed'].includes(String(initiatorType || ''));
}

function resourceEventKind(initiatorType: string) {
  switch (initiatorType) {
    case 'img':
      return 'image';
    case 'video':
    case 'audio':
    case 'source':
    case 'track':
      return initiatorType;
    default:
      return 'resource';
  }
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
  pageContext: Record<string, any> = pageContextSummary(),
  callId?: string
) {
  const body = requestBodyPreview(init);

  return {
    ...pageContext,
    callId,
    method: requestMethod(input, init),
    devicePath: devicePath(url),
    device: hyperbeamDevice(url),
    deviceLayer: hyperbeamDeviceLayer(url),
    authRequired: isAuthRequiredUrl(url),
    nativePath: nativeSourcePath(url),
    nativeSource: nativeSourceKind(url),
    url: sanitizeUrl(url),
    sourceLayer: fallbackSourceLayer,
    bodyBytes: typeof init?.body === 'string' ? init.body.length : undefined,
    requestHeaders: requestHeaders(input, init),
    requestBody: body,
    requestKey: requestBodyKey(url, init),
    urlParts: urlParts(url),
  };
}

async function responseSummary(
  url: string,
  response: Response,
  elapsedMs: number,
  fallbackSourceLayer?: string,
  pageContext: Record<string, any> = pageContextSummary(),
  requestKey?: string,
  requestData?: Record<string, any>,
  callId?: string
) {
  const summary: Record<string, any> = {
    ...requestData,
    ...pageContext,
    callId,
    status: response.status,
    ok: response.ok,
    elapsedMs,
    devicePath: devicePath(url),
    device: hyperbeamDevice(url),
    deviceLayer: hyperbeamDeviceLayer(url),
    authRequired: isAuthRequiredUrl(url),
    nativePath: nativeSourcePath(url),
    nativeSource: nativeSourceKind(url),
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    contentRange: response.headers.get('content-range'),
    acceptRanges: response.headers.get('accept-ranges'),
    mediaSource: response.headers.get('x-odysee-media-source'),
    mediaVerification: response.headers.get('x-odysee-media-verification'),
    mediaVerificationLimitations: response.headers.get('x-odysee-media-verification-limitations'),
    mediaMs: response.headers.get('x-odysee-media-ms'),
    mediaBlobs: response.headers.get('x-odysee-media-blobs'),
    responseDevice: response.headers.get('device'),
    sourceLayer: response.headers.get('x-odysee-source-layer') || fallbackSourceLayer,
    sourceReason: redactSensitive(response.headers.get('x-odysee-source-reason') || undefined),
    requestKey,
    responseHeaders: responseHeaders(response),
    urlParts: urlParts(url),
  };
  const signatureInput = response.headers.get('signature-input') || '';
  summary.sourceAlg = nativeResponseDevice(response.headers.get('device'));
  if (signatureInput) {
    summary.signatureInput = redactSensitiveString(signatureInput.slice(0, 900));
    summary.sourceAlg = sourceCommitmentAlg(signatureInput) || nativeResponseDevice(response.headers.get('device'));
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || contentType.includes('application/json')) {
    summary.body = await response
      .clone()
      .text()
      .then((text) => previewBody(text))
      .then((body) => redactSensitive(body))
      .catch(() => null);
    summary.sourceLayer = summary.sourceLayer || sourceLayer(summary.body);
  } else {
    summary.bodyCapture = `Skipped body clone for ${contentType || 'non-JSON'} response. Headers and route were captured.`;
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

function resourceRequestKey(url: string, initiatorType: string) {
  const source = nativeSourceParts(url);
  if (source?.value) return `${source.kind}:${limitDebugString(source.value, 120)}`;
  return `media:${limitDebugString(resourceNativePath(url, initiatorType), 140)}`;
}

function resourceNativePath(url: string, initiatorType: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    const path = parsed.pathname;
    if (path.startsWith('/$/api/hyperbeam-upload/v1/read/')) {
      return `media:${decodeURIComponent(path.split('/').filter(Boolean).pop() || '')}`;
    }
    if (path.includes('/~cache@1.0/read')) {
      return `cache:${parsed.searchParams.get('id') || parsed.searchParams.get('path') || parsed.searchParams.get('key') || 'read'}`;
    }
    if (path.includes('/~odysee-stream@1.0/media') || path.includes('/~lbry-stream@1.0/media')) {
      return `media:${parsed.searchParams.get('id') || parsed.searchParams.get('claim_id') || parsed.searchParams.get('uri') || path}`;
    }
    return `${initiatorType || 'resource'}:${parsed.hostname}${path}`;
  } catch (_error) {
    return `${initiatorType || 'resource'}:${limitDebugString(String(url || ''), 120)}`;
  }
}

function requestBodyPreview(init?: RequestInit) {
  if (typeof init?.body !== 'string') return undefined;

  try {
    return redactSensitive(JSON.parse(init.body));
  } catch (_error) {
    return redactSensitiveString(limitDebugString(init.body, 4000));
  }
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  const headers: Record<string, string> = {};
  collectHeaders(typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined, headers);
  collectHeaders(init?.headers, headers);
  if (Object.keys(headers).length === 0) {
    headers['capture-note'] = 'No script-set request headers. Browser-managed headers are not exposed to JavaScript.';
  }
  return redactSensitive(headers);
}

function responseHeaders(response: Response) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  if (Object.keys(headers).length === 0) {
    headers['capture-note'] = 'No response headers are exposed to frontend JavaScript for this response.';
  }
  return redactSensitive(headers);
}

function collectHeaders(source: HeadersInit | undefined, target: Record<string, string>) {
  if (!source) return;
  if (source instanceof Headers) {
    source.forEach((value, key) => {
      target[key] = value;
    });
    return;
  }
  if (Array.isArray(source)) {
    source.forEach(([key, value]) => {
      target[String(key).toLowerCase()] = String(value);
    });
    return;
  }
  Object.entries(source).forEach(([key, value]) => {
    target[key.toLowerCase()] = String(value);
  });
}

function urlParts(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    return {
      origin: parsed.origin,
      path: parsed.pathname,
      query: Object.fromEntries(
        Array.from(parsed.searchParams.entries()).map(([key, value]) => [
          key,
          isSensitiveQueryName(key) ? '[redacted]' : redactQueryValue(key, value),
        ])
      ),
    };
  } catch (_error) {
    return undefined;
  }
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
    const parsed = new URL(url, window.location.origin);
    const path = parsed.pathname;
    if (path.startsWith('/$/api/hyperbeam-upload/v1/read/')) {
      return {
        kind: 'media',
        value: decodeURIComponent(path.split('/').filter(Boolean).pop() || '') || undefined,
      };
    }
    if (path.includes('/~cache@1.0/read')) {
      return {
        kind: 'cache',
        value:
          parsed.searchParams.get('id') ||
          parsed.searchParams.get('path') ||
          parsed.searchParams.get('key') ||
          undefined,
      };
    }
    if (path.includes('/~odysee-stream@1.0/media') || path.includes('/~lbry-stream@1.0/media')) {
      return {
        kind: 'media',
        value:
          parsed.searchParams.get('id') ||
          parsed.searchParams.get('claim_id') ||
          parsed.searchParams.get('uri') ||
          undefined,
      };
    }
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

function isAuthRequiredUrl(url: string) {
  return AUTH_REQUIRED_DEVICE_PATHS.has(devicePath(url));
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
  if (NON_SENSITIVE_DEBUG_FIELDS.has(key)) return false;
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

const NON_SENSITIVE_DEBUG_FIELDS = new Set(
  [
    'acceptRanges',
    'authRequired',
    'authenticated',
    'authorizationRequired',
    'deviceLayer',
    'nativeSource',
    'requestKey',
    'responseDevice',
    'sourceAlg',
    'sourceLayer',
    'sourceReason',
  ].map((key) => key.toLowerCase().replace(/[-_]/g, ''))
);

function redactSensitiveString(value: string) {
  return value
    .replace(/(auth[_-]?token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[redacted]')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[redacted]')
    .replace(/(x[-_]?lbry[-_]?auth[-_]?token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[redacted]')
    .replace(/([?&](?:params64|urls64|auth_token|token|signature|uri64)=)[^&\s]+/gi, '$1...');
}
