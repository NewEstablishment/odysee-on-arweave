// In HyperBEAM mode the node is the only backend. Non-Lbryio legacy clients
// (recsys, geo, legal, blocklists) still fetch external hosts that
// CORS-fail; blocking by host neutralizes them all in one place, resolving an
// empty array so callers neither crash nor toast. Node and asset (arweave,
// fonts) requests are untouched. The SDK proxy is blocked as a final defense
// after method-level routing; the comment server remains outside this list.
import { ODYSEE_HYPERBEAM_NODE_API, LBRY_API_URL, PROXY_URL_NO_CF, RECSYS_ENDPOINT, RECSYS_FYP_ENDPOINT } from 'config';
import { hyperbeamLegacyUrlBlocked } from 'util/hyperbeamLegacyBoundary';

if (ODYSEE_HYPERBEAM_NODE_API && typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const legacyHosts = [
    LBRY_API_URL,
    PROXY_URL_NO_CF,
    RECSYS_ENDPOINT,
    RECSYS_FYP_ENDPOINT,
    'https://api.lbry.com',
  ].filter((host: any): host is string => typeof host === 'string' && host.length > 0);

  const nativeFetch = window.fetch.bind(window);
  (window as any).fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
    if (hyperbeamLegacyUrlBlocked(url, legacyHosts, true)) {
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return nativeFetch(input, init);
  };
}
