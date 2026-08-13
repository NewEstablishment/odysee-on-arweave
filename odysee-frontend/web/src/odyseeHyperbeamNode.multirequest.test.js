const assert = require('node:assert/strict');
const test = require('node:test');

process.env.ODYSEE_HYPERBEAM_NODE_API = 'http://hyperbeam.test';
process.env.HYPERBEAM_MULTIREQUEST_MODULE_ID = 'lua-module-id';

const {
  hyperbeamNodeReadVerifiedMessages,
  hyperbeamNodeResolveMany,
  hyperbeamNodeWarmImmutableClaims,
} = require('./odyseeHyperbeamNode');

test('multirequest sends ordered singleton messages through the Lua application', async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({
        1: { status: 'ok', result: { body: 'first' } },
        2: { status: 'failure', result: 'not_found' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const result = await hyperbeamNodeResolveMany([{ path: '/first' }, { path: '/missing' }]);

  assert.deepEqual(
    result.map((item) => item.status),
    ['ok', 'failure']
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://hyperbeam.test/~lua@5.3a&module=lua-module-id/resolve-many');
  assert.equal(calls[0].options.headers['accept-bundle'], 'true');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    requests: [{ path: '/first' }, { path: '/missing' }],
  });
});

test('batch warming preserves input order and reports per-item failures', async () => {
  global.fetch = async () =>
    new Response(JSON.stringify({ 1: { status: 'ok' }, 2: { status: 'failure' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  assert.deepEqual(await hyperbeamNodeWarmImmutableClaims(['first', 'missing']), [
    ['first', true],
    ['missing', false],
  ]);
});

test('snapshot reads use exact direct verification and committer paths', async () => {
  const id = 'A'.repeat(43);
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith(`/commitments/${id}/committer`)) return new Response('publisher', { status: 200 });
    if (url.includes('/verify?commitment-ids=')) return new Response('true', { status: 200 });
    return new Response(JSON.stringify({ schema: 'odysee-homepage@1.0' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  assert.deepEqual(await hyperbeamNodeReadVerifiedMessages([id], 'publisher'), [
    { id, payload: { schema: 'odysee-homepage@1.0' }, committer: 'publisher' },
  ]);
  assert.deepEqual(calls, [
    `http://hyperbeam.test/${id}?accept-bundle=true`,
    `http://hyperbeam.test/${id}/verify?commitment-ids=${id}`,
    `http://hyperbeam.test/${id}/commitments/${id}/committer`,
  ]);
});
