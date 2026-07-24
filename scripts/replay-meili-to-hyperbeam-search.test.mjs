import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchHydratedDocument,
  indexableMessage,
  mapWithConcurrency,
  parseArgs,
  rankingScore,
  searchDocument,
  searchIndexSettings,
  sourceDocumentId,
  verifyHydratedDocument,
  writeDocument,
} from './replay-meili-to-hyperbeam-search.mjs';

test('sourceDocumentId prefers the immutable locator', () => {
  assert.equal(
    sourceDocumentId({ immutable_id: 'tx:0', doc_id: 'claim', id: 'other' }),
    'tx:0'
  );
});

test('indexableMessage normalizes generic search fields and ranking inputs', () => {
  const message = indexableMessage({
      id: 'tx:0',
      search_id: 'derived',
      title: 'Title',
      count: 2,
      active: true,
      tags: ['one', 'c:private'],
      description: null,
      release_time: 100,
    });
  assert.equal(message.title, 'Title');
  assert.equal(message.count, 2);
  assert.equal(message.active, true);
  assert.equal(message.state, 'active');
  assert.equal(message.is_public, 0);
  assert.equal(message.tags_text, 'one c:private');
  assert.equal(typeof message.search_rank, 'number');
  assert.equal(message.search_rank_version, 3);
});

test('ranking keeps recency strongest while popularity and channel identity remain bounded weights', () => {
  const now = 2_000_000_000;
  const fresh = rankingScore({ release_time: now }, now);
  const freshWithChannel = rankingScore({ release_time: now, has_channel: 1 }, now);
  const oneYearOld = rankingScore({ release_time: now - 365 * 86400 }, now);
  const oldPopular = rankingScore(
    {
      release_time: now - 10 * 365 * 86400,
      view_count: 100_000_000,
    },
    now
  );
  const maxSignals = rankingScore(
    { release_time: now, view_count: 1_000_000_000, sub_cnt: 1_000_000_000 },
    now
  );
  assert.equal(fresh, 10);
  assert.equal(freshWithChannel, 10.5);
  assert.ok(Math.abs(oneYearOld - 5) < 0.000001);
  assert.ok(fresh > oldPopular);
  assert.ok(maxSignals <= 20.51);
});

test('generic index settings require word matches, strongly prefer thumbnails, then rank text fields', () => {
  const settings = searchIndexSettings();
  assert.deepEqual(settings.searchableAttributes, ['title', 'tags_text', 'description']);
  assert.deepEqual(settings.rankingRules.slice(0, 6), [
    'words',
    'has_thumbnail:desc',
    'typo',
    'proximity',
    'attribute',
    'exactness',
  ]);
  assert.equal(settings.rankingRules.at(-1), 'search_rank:desc');
  assert.ok(settings.filterableAttributes.includes('state'));
  assert.ok(settings.sortableAttributes.includes('has_thumbnail'));
  assert.ok(settings.sortableAttributes.includes('release_time'));
  assert.ok(!settings.searchableAttributes.includes('view_count'));
  assert.ok(!settings.searchableAttributes.includes('sub_cnt'));
});

test('parseArgs validates numeric options and dry run', () => {
  const options = parseArgs([
    '--batch-size',
    '100',
    '--concurrency',
    '4',
    '--direct-target',
    '--dry-run',
  ]);
  assert.equal(options.batchSize, 100);
  assert.equal(options.concurrency, 4);
  assert.equal(options.directTarget, true);
  assert.equal(options.verifyHydration, true);
  assert.equal(options.dryRun, true);
  assert.equal(parseArgs(['--skip-hydration-check']).verifyHydration, false);
  assert.throws(() => parseArgs(['--concurrency', '0']), /positive integer/);
});

test('searchDocument creates the same stable primary key as the generic search worker', () => {
  assert.deepEqual(searchDocument({ immutable_id: 'tx:0', title: 'Title' }), {
    immutable_id: 'tx:0',
    title: 'Title',
    state: 'active',
    is_public: 1,
    tags_text: '',
    search_rank: 0,
    search_rank_version: 3,
    id: 'tx:0',
    search_id: 'Vvc85yJchrsGPgdKWxqHRFS5U2FcML20NbnwZTeUm8w',
  });
});

test('mapWithConcurrency preserves source order', async () => {
  const results = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
    await new Promise((resolve) => setTimeout(resolve, value));
    return value * 2;
  });
  assert.deepEqual(results, [6, 2, 4]);
});

test('writeDocument retries rate limits and preserves immutable ID', async () => {
  let attempts = 0;
  const fetchImpl = async (_url, request) => {
    attempts += 1;
    const payload = JSON.parse(request.body);
    assert.equal(payload.id, 'tx:0');
    assert.equal(payload.body.immutable_id, 'tx:0');
    assert.equal(payload.body.title, 'Title');
    assert.equal(payload.body.state, 'active');
    assert.equal(payload.body.is_public, 1);
    assert.equal(typeof payload.body.search_rank, 'number');
    return {
      ok: attempts > 1,
      status: attempts > 1 ? 200 : 429,
      headers: { get: () => '0.001' },
      text: async () => 'rate limited',
    };
  };
  assert.equal(await writeDocument('http://hyperbeam', { immutable_id: 'tx:0', title: 'Title' }, fetchImpl), 'tx:0');
  assert.equal(attempts, 2);
});

test('verifyHydratedDocument rejects stale claim normalization before indexing', () => {
  const document = {
    immutable_id: 'abc:0',
    claim_id: 'claim',
    title: 'Indexed title',
    name: 'indexed-name',
  };
  assert.equal(
    verifyHydratedDocument(document, {
      'immutable-id': 'abc:0',
      'claim-id': 'claim',
      txid: 'abc',
      nout: 0,
      'claim-name': 'indexed-name',
      value: { title: 'Indexed title' },
    }),
    'abc:0'
  );
  assert.throws(
    () =>
      verifyHydratedDocument(document, {
        txid: 'abc',
        nout: 0,
        'claim-id': 'claim',
        'claim-name': 'concert',
      }),
    /title mismatch/
  );
});

test('fetchHydratedDocument retries transient responses and validates the returned object', async () => {
  let attempts = 0;
  const fetchImpl = async (url) => {
    attempts += 1;
    assert.equal(url, 'http://hyperbeam/abc%3A0');
    return attempts === 1
      ? {
          ok: false,
          status: 429,
          headers: { get: () => '0.001' },
          json: async () => ({ error: 'busy' }),
        }
      : {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({
            txid: 'abc',
            nout: 0,
            'claim-id': 'claim',
            value: { title: 'Title' },
          }),
        };
  };
  assert.equal(
    await fetchHydratedDocument(
      { hyperbeamUrl: 'http://hyperbeam' },
      { immutable_id: 'abc:0', claim_id: 'claim', title: 'Title' },
      fetchImpl
    ),
    'abc:0'
  );
  assert.equal(attempts, 2);
});
