import assert from 'node:assert/strict';

import { recoverOnce, retryable, sessionRejected } from '../../ui/util/hyperbeamSession.ts';

const withStatus = (status) => Object.assign(new Error(`status ${status}`), { status });

assert.equal(sessionRejected(withStatus(401)), true);
assert.equal(sessionRejected(withStatus(403)), true);
assert.equal(sessionRejected(withStatus(500)), false);
assert.equal(sessionRejected(new TypeError('Failed to fetch')), false);

assert.equal(retryable(new TypeError('Failed to fetch')), true, 'network failures retry');
assert.equal(retryable(withStatus(503)), true, '5xx retries');
assert.equal(retryable(withStatus(409)), false, 'a deterministic 4xx does not retry');
assert.equal(retryable(withStatus(401)), false);

let calls = 0;
assert.equal(
  await recoverOnce(async () => (++calls === 1 ? Promise.reject(withStatus(502)) : 'account'), 0),
  'account',
  'a transient failure is retried once'
);
assert.equal(calls, 2);

calls = 0;
await assert.rejects(
  recoverOnce(async () => {
    calls++;
    throw withStatus(409);
  }, 0),
  /409/
);
assert.equal(calls, 1, 'a deterministic failure is not retried');

calls = 0;
await assert.rejects(
  recoverOnce(async () => {
    calls++;
    throw withStatus(503);
  }, 0),
  /503/
);
assert.equal(calls, 2, 'a second transient failure is reported');

assert.equal(await recoverOnce(async () => null, 0), null, 'a final null answer passes through untouched');

console.log('hyperbeam session policy tests passed');
