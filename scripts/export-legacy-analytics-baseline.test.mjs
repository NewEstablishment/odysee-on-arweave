import assert from 'node:assert/strict';
import test from 'node:test';

import { createLegacyApiToken, legacyBaselineBatches } from './export-legacy-analytics-baseline.mjs';

test('creates a transient anonymous migration token without a user login', async () => {
  const token = await createLegacyApiToken('http://api.test', async (url, init) => {
    assert.equal(String(url), 'http://api.test/user/new');
    assert.equal(init.method, 'POST');
    const params = new URLSearchParams(init.body);
    assert.equal(params.get('auth_token'), '');
    assert.equal(params.get('language'), 'en');
    assert.match(params.get('app_id'), /^[a-z0-9]{66}$/);
    return response({ success: true, data: { auth_token: 'migration-token' } });
  });

  assert.equal(token, 'migration-token');
});

test('discovers legacy media and returns ordered current view counts', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/documents/fetch')) {
      const request = JSON.parse(init.body);
      return response(
        request.offset === 0
          ? {
              results: [
                { claim_id: 'a'.repeat(40), claim_type: 'stream' },
                { claim_id: 'b'.repeat(40), claim_type: 'channel' },
                { claim_id: 'native-id', claim_type: 'stream' },
              ],
            }
          : { results: [] }
      );
    }

    assert.match(String(url), /\/file\/view_count$/);
    assert.equal(new URLSearchParams(init.body).get('claim_id'), 'a'.repeat(40));
    return response({ success: true, data: [123] });
  };
  const options = {
    meiliUrl: 'http://meili.test',
    meiliKey: 'secret',
    index: 'claims',
    apiUrl: 'http://api.test',
    apiToken: 'token',
    batchSize: 3,
    apiBatchSize: 2,
  };
  const records = [];
  for await (const batch of legacyBaselineBatches(options, fetchImpl)) records.push(...batch);

  assert.deepEqual(records, [{ 'subject-id': 'a'.repeat(40), value: 123 }]);
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret');
  assert.equal(calls.length, 3);
});

test('uses view counts already stored in the legacy search index without an API token', async () => {
  let requests = 0;
  const fetchImpl = async (url) => {
    requests += 1;
    assert.match(String(url), /\/indexes\/claims\/documents\/fetch$/);
    return response({
      results: [
        { claim_id: 'a'.repeat(40), claim_type: 'stream', view_count: 12 },
        { claim_id: 'b'.repeat(40), claim_type: 'channel', view_count: 99 },
        { claim_id: 'c'.repeat(40), claim_type: 'stream', view_cnt: 7 },
      ],
    });
  };
  const options = {
    meiliUrl: 'http://meili.test',
    meiliKey: '',
    index: 'claims',
    apiUrl: 'http://api.test',
    apiToken: '',
    batchSize: 10,
    apiBatchSize: 10,
  };
  const records = [];
  for await (const batch of legacyBaselineBatches(options, fetchImpl)) records.push(...batch);

  assert.deepEqual(records, [
    { 'subject-id': 'a'.repeat(40), value: 12 },
    { 'subject-id': 'c'.repeat(40), value: 7 },
  ]);
  assert.equal(requests, 1);
});

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
