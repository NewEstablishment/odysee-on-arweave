import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  hyperbeamLegacyFetchBases,
  hyperbeamLegacyRealtimeBlocked,
  hyperbeamLegacyUrlBlocked,
  hyperbeamSdkMethodBlocked,
  legacyOnlySdkMethod,
} from '../../ui/util/hyperbeamLegacyBoundary.ts';

assert.equal(hyperbeamSdkMethodBlocked('channel_sign', true), true);
assert.equal(hyperbeamSdkMethodBlocked('channel_sign', false), false);
assert.equal(hyperbeamSdkMethodBlocked('resolve', true), false);
assert.equal(hyperbeamSdkMethodBlocked('wallet_balance', true), true);
assert.equal(legacyOnlySdkMethod('wallet_balance'), true);
assert.equal(hyperbeamLegacyRealtimeBlocked(true), true);
assert.equal(hyperbeamLegacyRealtimeBlocked(false), false);

const proxy = 'https://api.na-backend.odysee.com/api/v1/proxy';
const mainProxy = '/api/proxy';
const productionBases = hyperbeamLegacyFetchBases({
  lbryApiUrl: 'https://api.odysee.com',
  proxyUrl: mainProxy,
  proxyUrlNoCf: proxy,
  recsysEndpoint: 'https://recsys.example',
  recsysFypEndpoint: 'https://fyp.example',
});
assert.equal(productionBases.includes(mainProxy), true, 'the production boundary must include the primary SDK proxy');
assert.equal(hyperbeamLegacyUrlBlocked(`${proxy}?m=channel_sign`, productionBases, true), true);
assert.equal(hyperbeamLegacyUrlBlocked(`${mainProxy}?m=wallet_balance`, productionBases, true), true);
assert.equal(hyperbeamLegacyUrlBlocked(`${proxy}?m=channel_sign`, productionBases, false), false);
assert.equal(hyperbeamLegacyUrlBlocked('http://127.0.0.1:18801/message', productionBases, true), false);

const fetchGuardSource = await readFile(new URL('../../ui/util/hyperbeamFetchGuard.ts', import.meta.url), 'utf8');
assert.match(
  fetchGuardSource,
  /proxyUrl:\s*PROXY_URL/,
  'the installed browser guard must pass the primary SDK proxy config into the shared boundary list'
);
assert.match(
  fetchGuardSource,
  /HYPERBEAM_BASE_URL \|\| ODYSEE_HYPERBEAM_NODE_API/,
  'the guard must install for either supported manifest node configuration'
);

const routerSource = await readFile(new URL('../../ui/component/router/view.tsx', import.meta.url), 'utf8');
assert.match(
  routerSource,
  /<Route path=\{`\/\$\/\$\{PAGES\.DISCOVER\}`\} element=\{renderLegacyPage\(DiscoverPage\)\} \/>/,
  'the bare discover route must remain available for existing links and query parameters'
);
assert.doesNotMatch(
  routerSource,
  /\(tagParams \|\| isGlobalMod\).*PAGES\.DISCOVER/,
  'the bare discover route must not depend on a tag or moderator state'
);

console.log('HyperBEAM legacy boundary tests passed');
