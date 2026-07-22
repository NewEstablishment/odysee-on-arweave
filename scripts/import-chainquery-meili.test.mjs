import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeLegacyDocument,
  chainquerySql,
  checkpointScope,
  checkpointState,
  generationDocument,
  initialCursor,
  legacyClaimFilter,
  mergeNativeDocuments,
  nextCursor,
  normalizeDoc,
  normalizeNativeDoc,
  rebuildCutoverAction,
  replaceNativeDocuments,
  scanMode,
  searchId,
  validateCheckpoint,
  validateRebuildRequest,
  validateTaskWaiting,
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
  const current = { claim_id: 'claim-a', bid_state: 'Controlling' };
  const expired = { claim_id: 'claim-b', bid_state: 'Expired' };
  assert.equal(activeLegacyDocument(current), true);
  assert.equal(activeLegacyDocument(expired), false);
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
  assert.equal(doc.search_id, searchId('transaction:0'));
  assert.equal(doc.media_type, 'video');
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
