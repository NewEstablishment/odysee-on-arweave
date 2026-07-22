import assert from 'node:assert/strict';
import test from 'node:test';
import {
  indexableMessage,
  mapWithConcurrency,
  parseArgs,
  rankingScore,
  searchIndexSettings,
  sourceDocumentId,
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
});

test('ranking keeps recency strongest while views and subscribers remain bounded weights', () => {
  const now = 2_000_000_000;
  const fresh = rankingScore({ release_time: now }, now);
  const oldPopular = rankingScore({ release_time: now - 10 * 365 * 86400, view_count: 100_000_000 }, now);
  const maxSignals = rankingScore(
    { release_time: now, view_count: 1_000_000_000, sub_cnt: 1_000_000_000 },
    now
  );
  assert.ok(fresh > oldPopular);
  assert.ok(maxSignals <= 26.01);
});

test('generic index settings preserve lexical ranking before bounded weights', () => {
  const settings = searchIndexSettings();
  assert.deepEqual(settings.rankingRules.slice(0, 5), ['words', 'typo', 'proximity', 'attribute', 'exactness']);
  assert.equal(settings.rankingRules.at(-1), 'search_rank:desc');
  assert.ok(settings.filterableAttributes.includes('state'));
  assert.ok(settings.sortableAttributes.includes('release_time'));
  assert.ok(!settings.searchableAttributes.includes('view_count'));
  assert.ok(!settings.searchableAttributes.includes('sub_cnt'));
});

test('parseArgs validates numeric options and dry run', () => {
  const options = parseArgs(['--batch-size', '100', '--concurrency', '4', '--dry-run']);
  assert.equal(options.batchSize, 100);
  assert.equal(options.concurrency, 4);
  assert.equal(options.dryRun, true);
  assert.throws(() => parseArgs(['--concurrency', '0']), /positive integer/);
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
