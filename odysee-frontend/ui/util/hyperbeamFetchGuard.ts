// In HyperBEAM mode the node is the only backend. Non-Lbryio legacy clients
// (recsys, search, geo, legal, blocklists) still fetch external hosts that
// CORS-fail; blocking by host neutralizes them all in one place, resolving an
// empty array so callers neither crash nor toast. Node and asset (arweave,
// fonts) requests are untouched. The SDK proxy and comment server are left
// alone (they do not fire here and a real flow could need them).
import {
  ODYSEE_HYPERBEAM_NODE_API,
  LBRY_API_URL,
  SEARCH_SERVER_API,
  SEARCH_SERVER_API_ALT,
  RECSYS_ENDPOINT,
  RECSYS_FYP_ENDPOINT,
} from 'config';

if (ODYSEE_HYPERBEAM_NODE_API && typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const legacyHosts = [
    LBRY_API_URL,
    SEARCH_SERVER_API,
    SEARCH_SERVER_API_ALT,
    RECSYS_ENDPOINT,
    RECSYS_FYP_ENDPOINT,
    'https://api.lbry.com',
  ].filter((host: any): host is string => typeof host === 'string' && host.length > 0);

  const nativeFetch = window.fetch.bind(window);
  (window as any).fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input && input.url) || '';
    const isAccountRequest = legacyHosts.some((host) => {
      if (!url.startsWith(host)) return false;
      const path = url.slice(host.length).replace(/^\/+/, '');
      return path.startsWith('user/') || path.startsWith('user_email/');
    });
    if (!isAccountRequest && legacyHosts.some((host) => url.startsWith(host))) {
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return nativeFetch(input, init);
  };
}
