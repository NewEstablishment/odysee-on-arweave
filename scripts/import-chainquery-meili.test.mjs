import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeLegacyDocument,
  chainquerySql,
  checkpointScope,
  checkpointState,
  enrichEngagement,
  generationDocument,
  initialCursor,
  legacyClaimFilter,
  mergeNativeDocuments,
  nextCursor,
  normalizeDoc,
  normalizeNativeDoc,
  rebuildCutoverAction,
  replaceNativeDocuments,
  recencyScore,
  scanMode,
  searchId,
  searchRank,
  validateCheckpoint,
  validateRebuildRequest,
  validateTaskWaiting,
  validThumbnailUrl,
} from './import-chainquery-meili.mjs';

test('search ids are deterministic and collision-safe', () => {
  assert.equal(searchId('abc:def'), '7FlShRuAUeHs9rYHbZnQVkbNkKnyk8FyUBBXQrnkoZ4');
  assert.equal(searchId('abc_def'), '-hbpjRHLqdaCg4WbPxNZaSQ_50KIRo4pAiswNVkyT6A');
  assert.notEqual(searchId('abc:def'), searchId('abc_def'));
});

test('id scans resume by ascending claim row id', () => {
  const sql = chainquerySql({ id: 42 }, 100, '', '', 'id');
  assert.match(sql, /WHERE c\.id > 42/);
  assert.match(sql, /ORDER BY c\.id ASC/);
  assert.deepEqual(nextCursor('id', [{ id: 43 }, { id: 44 }]), { id: 44 });
});

test('modified scans freeze a time window and page only by stable row id', () => {
  const cursor = { id: 8, lower_bound: 1000, upper_bound: 2000 };
  const sql = chainquerySql(cursor, 100, '', '', 'modified');
  assert.match(sql, /c\.id > 8/);
  assert.match(sql, /c\.modified_at >= FROM_UNIXTIME\(1000\)/);
  assert.match(sql, /c\.modified_at < FROM_UNIXTIME\(2000\)/);
  assert.match(sql, /ORDER BY c\.id ASC/);
  assert.deepEqual(nextCursor('modified', [{ id: 9, modified_at: 1001 }], cursor), {
    id: 9,
    lower_bound: 1000,
    upper_bound: 2000,
  });
});

test('recent scans resume by descending release time and id', () => {
  const first = chainquerySql({ id: 0, sort_time: 0 }, 100, 'test', '', 'recent');
  assert.match(first, /WHERE 1 = 1/);
  assert.match(first, /ORDER BY COALESCE\(.+\) DESC, c\.id DESC/);

  const resumed = chainquerySql({ id: 50, sort_time: 2000 }, 100, '', '', 'recent');
  assert.match(resumed, /< 2000/);
  assert.match(resumed, /= 2000 AND c\.id < 50/);
  assert.deepEqual(nextCursor('recent', [{ id: 49, sort_time: 1999 }]), {
    id: 49,
    sort_time: 1999,
  });
});

test('legacy numeric cursors remain readable before a versioned checkpoint is written', () => {
  assert.equal(scanMode('id', 0), 'id');
  assert.equal(scanMode('recent', 0), 'recent');
  assert.equal(scanMode('id', 100), 'modified');
  assert.deepEqual(initialCursor('id', { cursor: 27 }, {}, 0), { id: 27 });
});

test('checkpoint mode and index mismatches fail closed', () => {
  const scope = checkpointScope({
    mode: 'id',
    targetIndex: 'one',
    stagingIndex: '',
    searchTerm: '',
    exactTerm: '',
  });
  const checkpoint = checkpointState('id', { id: 1 }, 'one', { scope });
  assert.throws(() => validateCheckpoint(checkpoint, 'modified', 'one', scope), /mode/);
  assert.throws(() => validateCheckpoint(checkpoint, 'id', 'two', scope), /index/);
  assert.throws(() => validateCheckpoint({ mode: 'id', index: 'one' }, 'id', 'one', scope), /version/);
  assert.throws(
    () => validateCheckpoint(checkpoint, 'id', 'one', { ...scope, chainquery_db: 'other' }),
    /scope/
  );
});

test('full rebuilds require an unfiltered id scan and distinct staging index', () => {
  const base = {
    rebuildIndex: true,
    mode: 'id',
    searchTerm: '',
    exactTerm: '',
    checkpoint: {},
    targetIndex: 'claims',
    stagingIndex: 'claims__rebuild',
    checkpointFile: '/tmp/import-checkpoint.json',
  };
  assert.doesNotThrow(() => validateRebuildRequest(base));
  assert.throws(() => validateRebuildRequest({ ...base, mode: 'recent' }), /unfiltered id scan/);
  assert.throws(() => validateRebuildRequest({ ...base, searchTerm: 'slice' }), /unfiltered id scan/);
  assert.throws(() => validateRebuildRequest({ ...base, stagingIndex: 'claims' }), /must differ/);
});

test('full rebuild checkpoints must belong to the requested target', () => {
  const base = {
    rebuildIndex: true,
    mode: 'id',
    searchTerm: '',
    exactTerm: '',
    targetIndex: 'claims',
    stagingIndex: 'claims__rebuild',
    checkpointFile: '/tmp/import-checkpoint.json',
  };
  assert.doesNotThrow(() =>
    validateRebuildRequest({
      ...base,
      checkpoint: { rebuild: true, target_index: 'claims', index: 'claims__rebuild' },
    })
  );
  assert.throws(
    () => validateRebuildRequest({ ...base, checkpoint: { mode: 'id', index: 'claims__rebuild' } }),
    /does not describe/
  );
  assert.throws(
    () =>
      validateRebuildRequest({
        ...base,
        checkpoint: { rebuild: true, target_index: 'other', index: 'claims__rebuild' },
      }),
    /does not describe/
  );
});

test('writes cannot advance checkpoints before Meilisearch tasks finish', () => {
  assert.doesNotThrow(() => validateTaskWaiting({ dryRun: true, noWait: true }));
  assert.doesNotThrow(() => validateTaskWaiting({ dryRun: false, noWait: false }));
  assert.throws(() => validateTaskWaiting({ dryRun: false, noWait: true }), /unsafe/);
});

test('legacy replacements are source-scoped and expired claims become deletions', () => {
  const current = { claim_id: 'claim-a', bid_state: 'Controlling', title: 'Current', has_thumbnail: 1 };
  const expired = { claim_id: 'claim-b', bid_state: 'Expired', title: 'Expired', has_thumbnail: 1 };
  assert.equal(activeLegacyDocument(current), true);
  assert.equal(activeLegacyDocument(expired), false);
  assert.equal(activeLegacyDocument({ ...current, title: '', has_thumbnail: 0 }), false);
  assert.equal(
    legacyClaimFilter([current, expired, current]),
    'source_system = "legacy-chainquery" AND claim_id IN ["claim-a", "claim-b"]'
  );
});

test('generation markers make cutover replay-safe', () => {
  const marker = generationDocument('generation-a');
  assert.equal(marker.search_id, searchId('import-generation:generation-a'));
  assert.equal(rebuildCutoverAction(false, true), 'swap');
  assert.equal(rebuildCutoverAction(true, true), 'already-swapped');
  assert.throws(() => rebuildCutoverAction(false, false), /Neither live nor staging/);
});

test('normalized documents retain immutable ids and use the hashed primary key', () => {
  const doc = normalizeDoc({
    doc_id: 'transaction:0',
    immutable_id: 'transaction:0',
    claim_type: 'stream',
    content_type: 'video/mp4',
    bid_state: 'Controlling',
    release_time: 100,
  });
  assert.equal(doc.doc_id, 'transaction:0');
  assert.equal(doc.immutable_id, 'transaction:0');
  assert.equal(doc.id, 'transaction:0');
  assert.equal(doc.search_id, searchId('transaction:0'));
  assert.equal(doc.media_type, 'video');
});

test('thumbnail ranking accepts usable HTTP URLs and rejects placeholder strings', () => {
  for (const url of [
    'https://thumbs.odycdn.com/thumb.webp',
    'http://images.example.org/path/image.jpg',
    'http://192.0.2.10/thumb.jpg',
    'http://[2001:db8::1]/thumb.jpg',
  ]) {
    assert.equal(validThumbnailUrl(url), true, url);
    assert.equal(normalizeDoc({ doc_id: url, thumbnail_url: url }).has_thumbnail, 1, url);
  }

  for (const value of [
    '',
    'test',
    'jajaja',
    'htt://anonymous/image',
    'http://realstate/realstate',
    'http://localhost/thumb.jpg',
  ]) {
    assert.equal(validThumbnailUrl(value), false, value);
    assert.equal(normalizeDoc({ doc_id: value || 'empty', thumbnail_url: value }).has_thumbnail, 0, value);
  }
});

test('release-time quality distinguishes dated documents from fallback timestamps', () => {
  assert.equal(
    normalizeDoc({
      doc_id: 'dated:0',
      release_time: 1700000000,
      transaction_time: 1600000000,
    }).has_release_time,
    1
  );
  assert.equal(
    normalizeDoc({
      doc_id: 'undated:0',
      transaction_time: 1600000000,
      created_at: 1600000000,
    }).has_release_time,
    0
  );
});

test('ranking balances recency with bounded views and channel subscribers', () => {
  const now = Math.floor(Date.now() / 1000);
  const freshLowEngagement = searchRank({
    viewCount: 2,
    subCount: 0,
    hasChannel: 0,
    recencyRank: recencyScore(now - 30 * 86400),
  });
  const oldLowEngagement = searchRank({
    viewCount: 2,
    subCount: 0,
    hasChannel: 1,
    recencyRank: recencyScore(now - 9 * 365 * 86400),
  });
  const oldHighEngagement = searchRank({
    viewCount: 100000000,
    subCount: 10000000,
    hasChannel: 1,
    recencyRank: recencyScore(now - 9 * 365 * 86400),
  });

  assert.ok(freshLowEngagement > oldLowEngagement);
  assert.ok(oldHighEngagement > freshLowEngagement);
});

test('engagement enrichment batches view and channel subscriber counts into ranking documents', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const params = new URLSearchParams(String(init.body));
    requests.push({ url: String(url), params });
    const data = String(url).endsWith('/file/view_count')
      ? [12, 3]
      : {
          aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: 45,
        };
    return new Response(JSON.stringify({ success: true, error: null, data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const documents = [
      normalizeDoc({
        doc_id: 'tx:0',
        claim_id: '1111111111111111111111111111111111111111',
        channel_claim_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        claim_type: 'stream',
        release_time: Math.floor(Date.now() / 1000),
      }),
      normalizeDoc({
        doc_id: 'tx:1',
        claim_id: '2222222222222222222222222222222222222222',
        channel_claim_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        claim_type: 'stream',
        release_time: Math.floor(Date.now() / 1000),
      }),
    ];
    const enriched = await enrichEngagement(documents, 'https://api.example.test', 'request-token');

    assert.equal(requests.length, 2);
    assert.equal(requests[0].params.get('auth_token'), 'request-token');
    assert.equal(enriched[0].view_cnt, 12);
    assert.equal(enriched[1].view_cnt, 3);
    assert.equal(enriched[0].sub_cnt, 45);
    assert.equal(enriched[1].sub_cnt, 45);
    assert.equal(enriched[0].engagement_rank_version, 1);
    assert.ok(enriched[0].search_rank > documents[0].search_rank);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preserved native documents migrate to hashed keys and record locators', () => {
  const migrated = normalizeNativeDoc({
    source_system: 'hyperbeam-native',
    doc_id: 'media-id',
    claim_id: 'media-id',
    immutable_id: 'media-id',
    record_id: 'record-id',
  });
  assert.equal(migrated.doc_id, 'media-id');
  assert.equal(migrated.claim_id, 'media-id');
  assert.equal(migrated.immutable_id, 'record-id');
  assert.equal(migrated.id, 'record-id');
  assert.equal(migrated.search_id, searchId('media-id'));
});

test('native replacement clears staging and copies only current native rows', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url: String(url), method: init.method, body });
    if (String(url).endsWith('/indexes/live/documents/fetch')) {
      const results = body.offset
        ? []
        : [
            { source_system: 'hyperbeam-native', doc_id: 'media-1', record_id: 'record-1' },
            { source_system: 'hyperbeam-native', doc_id: 'media-2', record_id: 'record-2' },
          ];
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    return new Response(JSON.stringify({ taskUid: requests.length }), { status: 202 });
  };

  try {
    const copied = await replaceNativeDocuments('http://meili', 'live', 'staging', 2, false, 1000);
    assert.equal(copied, 2);
    assert.deepEqual(requests[0].body, { filter: 'source_system = "hyperbeam-native"' });
    const indexed = requests.find((request) => request.url.includes('/indexes/staging/documents?'));
    assert.equal(indexed.body[0].immutable_id, 'record-1');
    assert.equal(indexed.body[0].search_id, searchId('media-1'));
    assert.equal(requests.at(-1).body.offset, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
