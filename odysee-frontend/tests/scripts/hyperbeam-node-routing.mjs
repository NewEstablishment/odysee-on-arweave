import assert from 'node:assert/strict';

import { resolveHyperbeamNodeBase } from '../../ui/util/hyperbeamNode.ts';

assert.equal(
  resolveHyperbeamNodeBase({
    manifestOrigin: 'http://127.0.0.1:18801/',
    baseUrl: '',
    nodeApi: 'http://127.0.0.1:10000',
  }),
  'http://127.0.0.1:18801',
  'a manifest must use its serving node instead of a build-time development default'
);
assert.equal(
  resolveHyperbeamNodeBase({ baseUrl: 'http://127.0.0.1:18802/', nodeApi: 'http://127.0.0.1:10000' }),
  'http://127.0.0.1:18802'
);
assert.equal(resolveHyperbeamNodeBase({ nodeApi: 'http://127.0.0.1:10000/' }), 'http://127.0.0.1:10000');

console.log('HyperBEAM node routing tests passed');
