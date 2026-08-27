import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { hyperbeamLegacyUrlBlocked, hyperbeamSdkMethodBlocked } from '../../ui/util/hyperbeamLegacyBoundary.ts';

assert.equal(hyperbeamSdkMethodBlocked('channel_sign', true), true);
assert.equal(hyperbeamSdkMethodBlocked('channel_sign', false), false);
assert.equal(hyperbeamSdkMethodBlocked('resolve', true), false);

const proxy = 'https://api.na-backend.odysee.com/api/v1/proxy';
assert.equal(hyperbeamLegacyUrlBlocked(`${proxy}?m=channel_sign`, [proxy], true), true);
assert.equal(hyperbeamLegacyUrlBlocked(`${proxy}?m=channel_sign`, [proxy], false), false);
assert.equal(hyperbeamLegacyUrlBlocked('http://127.0.0.1:18801/message', [proxy], true), false);

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
