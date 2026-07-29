#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const DEFAULTS = {
  sourceUrl: process.env.MEILI_URL || 'http://127.0.0.1:7700',
  sourceIndex: process.env.MEILI_INDEX || 'odysee_claims',
  targetIndex: process.env.HYPERBEAM_SEARCH_INDEX || 'hyperbeam_messages',
  hyperbeamUrl: process.env.HYPERBEAM_URL || 'http://127.0.0.1:18785',
  meiliKey: process.env.MEILI_MASTER_KEY || '',
  batchSize: 250,
  sourceOffset: 0,
  concurrency: 8,
  waitTimeoutMs: 120000,
  directTarget: false,
  verifyHydration: true,
};

const SEARCHABLE_ATTRIBUTES = [
  'title',
  'name',
  'tags_text',
  'description',
];

const FILTERABLE_ATTRIBUTES = [
  'state',
  'is_public',
  'bid_state',
  'claim_type',
  'content_type',
  'media_type',
  'language',
  'nsfw',
  'fee',
  'release_time',
  'created_at',
  'transaction_time',
  'duration',
  'height',
  'width',
  'is_channel',
  'source_system',
  'channel_claim_id',
  'claim_id',
  'immutable_id',
  'search_group',
];

const SORTABLE_ATTRIBUTES = [
  'has_thumbnail',
  'is_channel',
  'search_rank',
  'release_time',
  'created_at',
  'transaction_time',
  'duration',
];

const RANKING_RULES = [
  'words',
  'typo',
  'proximity',
  'attribute',
  'exactness',
  'is_channel:desc',
  'has_thumbnail:desc',
  'sort',
  'search_rank:desc',
];

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--source-url') options.sourceUrl = value;
    else if (arg === '--source-index') options.sourceIndex = value;
    else if (arg === '--target-index') options.targetIndex = value;
    else if (arg === '--hyperbeam-url') options.hyperbeamUrl = value;
    else if (arg === '--batch-size') options.batchSize = positiveInteger(value, arg);
    else if (arg === '--source-offset') options.sourceOffset = nonNegativeInteger(value, arg);
    else if (arg === '--concurrency') options.concurrency = positiveInteger(value, arg);
    else if (arg === '--wait-timeout-ms') options.waitTimeoutMs = positiveInteger(value, arg);
    else if (arg === '--direct-target') {
      options.directTarget = true;
      continue;
    } else if (arg === '--skip-hydration-check') {
      options.verifyHydration = false;
      continue;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
    index += 1;
  }
  return options;
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${option} must be a non-negative integer`);
  }
  return parsed;
}

function sourceDocumentId(document) {
  return String(document.immutable_id || document.doc_id || document.id || '');
}

function indexableMessage(document) {
  const tags = Array.isArray(document.tags) ? document.tags.map(String).filter(Boolean) : [];
  const message = Object.fromEntries(
    Object.entries(document).filter(([key, value]) => {
      if (key === 'id' || key === 'search_id') return false;
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    })
  );
  const bidState = String(document.bid_state || '').toLowerCase();
  const hiddenTags = new Set(['c:unlisted', 'c:private', 'c:scheduled:hide', 'c:scheduled:show']);
  return {
    ...message,
    state: document.state || (bidState === 'expired' || bidState === 'spent' ? 'deleted' : 'active'),
    is_public:
      numberValue(document.is_public) === 0 && document.is_public !== undefined
        ? 0
        : tags.some((tag) => hiddenTags.has(tag.toLowerCase()))
          ? 0
          : 1,
    tags_text: tags.join(' '),
    search_group: searchGroup(document),
    search_rank: rankingScore(document),
    search_rank_version: 3,
  };
}

function searchGroup(document) {
  const claimType = String(document.claim_type || '').toLowerCase();
  const ownClaimId = String(document.claim_id || '').trim();
  const channelClaimId = String(document.channel_claim_id || '').trim();
  if (claimType === 'channel' && ownClaimId) return ownClaimId;
  if (channelClaimId) return channelClaimId;
  return sourceDocumentId(document);
}

function rankingScore(document, nowSeconds = Math.floor(Date.now() / 1000)) {
  const timestamp = numberValue(
    document.release_time ?? document.created_at ?? document.transaction_time ?? document.modified_at
  );
  const ageDays = timestamp > 0 ? Math.max(0, (nowSeconds - timestamp) / 86400) : Number.POSITIVE_INFINITY;
  const recency = 10 * Math.exp((-Math.LN2 * ageDays) / 365);
  const views = boundedLogRank(document.view_count ?? document.view_cnt, 100_000_000, 6);
  const subscribers = boundedLogRank(document.sub_cnt ?? document.sub_count, 10_000_000, 4);
  const channel = numberValue(document.has_channel) > 0 ? 0.5 : 0;
  return recency + views + subscribers + channel;
}

function boundedLogRank(value, cap, weight) {
  return (Math.log1p(Math.min(cap, Math.max(0, numberValue(value)))) / Math.log1p(cap)) * weight;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function searchIndexSettings() {
  return {
    searchableAttributes: SEARCHABLE_ATTRIBUTES,
    filterableAttributes: FILTERABLE_ATTRIBUTES,
    sortableAttributes: SORTABLE_ATTRIBUTES,
    rankingRules: RANKING_RULES,
    distinctAttribute: 'search_group',
  };
}

async function fetchDocuments(url, index, offset, limit, meiliKey, fields) {
  const response = await fetch(`${trimSlash(url)}/indexes/${encodeURIComponent(index)}/documents/fetch`, {
    method: 'POST',
    headers: jsonHeaders(meiliKey),
    body: JSON.stringify({ offset, limit, ...(fields ? { fields } : {}) }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Meilisearch document fetch failed with ${response.status}: ${JSON.stringify(body)}`);
  return Array.isArray(body?.results) ? body.results : [];
}

async function fetchAllIds(url, index, batchSize, meiliKey) {
  const ids = new Set();
  let offset = 0;
  while (true) {
    const documents = await fetchDocuments(url, index, offset, batchSize, meiliKey, ['id']);
    documents.forEach((document) => {
      if (document.id) ids.add(String(document.id));
    });
    offset += documents.length;
    if (documents.length < batchSize) return ids;
  }
}

async function writeDocument(hyperbeamUrl, document, fetchImpl = fetch) {
  const id = sourceDocumentId(document);
  if (!id) throw new Error('Source document is missing an immutable ID');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetchImpl(`${trimSlash(hyperbeamUrl)}/~search@1.0/write`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ id, body: indexableMessage(document) }),
    });
    if (response.ok) return id;
    const responseBody = await response.text();
    if (![429, 502, 503, 504].includes(response.status) || attempt === 7) {
      throw new Error(`search@1.0/write failed for ${id} with ${response.status}: ${responseBody}`);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
    await sleep(delay);
  }
  throw new Error(`search@1.0/write exhausted retries for ${id}`);
}

function searchDocument(document) {
  const id = sourceDocumentId(document);
  if (!id) throw new Error('Source document is missing an immutable ID');
  return {
    ...indexableMessage(document),
    id,
    search_id: createHash('sha256').update(id).digest('base64url'),
  };
}

async function writeDocumentsDirect(options, documents, fetchImpl = fetch) {
  if (!documents.length) return;
  const response = await fetchImpl(
    `${trimSlash(options.sourceUrl)}/indexes/${encodeURIComponent(options.targetIndex)}/documents?primaryKey=search_id`,
    {
      method: 'POST',
      headers: jsonHeaders(options.meiliKey),
      body: JSON.stringify(documents.map(searchDocument)),
    }
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Meilisearch bulk replay failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  if (Number.isInteger(body?.taskUid)) await waitForMeiliTask(options, body.taskUid, fetchImpl);
}

function firstValue(object, keys) {
  if (!object || typeof object !== 'object') return undefined;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim().normalize('NFKC') : '';
}

function hydratedClaimFields(message) {
  const value = firstValue(message, ['value']) || {};
  return {
    title: normalizedText(firstValue(value, ['title']) ?? firstValue(message, ['title'])),
    name: normalizedText(
      firstValue(message, ['claim-name', 'claim_name', 'name']) ??
        firstValue(value, ['name'])
    ),
    claimId: normalizedText(firstValue(message, ['claim-id', 'claim_id'])),
    immutableId: normalizedText(firstValue(message, ['immutable-id', 'immutable_id'])),
    txid: normalizedText(firstValue(message, ['txid', 'tx-id'])),
    nout: firstValue(message, ['nout', 'n-out']),
  };
}

function verifyHydratedDocument(document, message) {
  const expectedId = sourceDocumentId(document);
  const expectedTitle = normalizedText(document.title);
  const expectedName = normalizedText(document.name ?? document.source_name);
  const expectedClaimId = normalizedText(document.claim_id);
  const actual = hydratedClaimFields(message);
  const derivedId =
    actual.txid && actual.nout !== undefined ? `${actual.txid}:${String(actual.nout)}` : '';

  if (!message || typeof message !== 'object') {
    throw new Error(`Immutable hydration returned no object for ${expectedId}`);
  }
  if (actual.immutableId && actual.immutableId !== expectedId) {
    throw new Error(
      `Immutable hydration changed locator ${expectedId} to ${actual.immutableId}`
    );
  }
  if (derivedId && derivedId !== expectedId) {
    throw new Error(`Immutable hydration changed outpoint ${expectedId} to ${derivedId}`);
  }
  if (expectedClaimId && actual.claimId && actual.claimId !== expectedClaimId) {
    throw new Error(
      `Immutable hydration changed claim ${expectedClaimId} to ${actual.claimId} for ${expectedId}`
    );
  }
  if (expectedTitle && actual.title !== expectedTitle) {
    throw new Error(
      `Immutable hydration title mismatch for ${expectedId}: expected ${JSON.stringify(expectedTitle)}, got ${JSON.stringify(actual.title)}`
    );
  }
  if (!expectedTitle && expectedName && actual.name !== expectedName) {
    throw new Error(
      `Immutable hydration name mismatch for ${expectedId}: expected ${JSON.stringify(expectedName)}, got ${JSON.stringify(actual.name)}`
    );
  }
  return expectedId;
}

async function fetchHydratedDocument(options, document, fetchImpl = fetch) {
  const id = sourceDocumentId(document);
  if (!id) throw new Error('Source document is missing an immutable ID');
  const url = `${trimSlash(options.hyperbeamUrl)}/${encodeURIComponent(id)}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
    });
    const body = await response.json().catch(() => null);
    if (response.ok) return verifyHydratedDocument(document, body);
    if (![429, 502, 503, 504].includes(response.status) || attempt === 7) {
      throw new Error(
        `Immutable hydration failed for ${id} with ${response.status}: ${JSON.stringify(body)}`
      );
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
    await sleep(delay);
  }
  throw new Error(`Immutable hydration exhausted retries for ${id}`);
}

async function verifyHydrationBatch(options, documents, fetchImpl = fetch) {
  if (options.verifyHydration === false || !documents.length) return;
  await mapWithConcurrency(documents, options.concurrency, (document) =>
    fetchHydratedDocument(options, document, fetchImpl)
  );
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function indexStats(url, index, meiliKey) {
  const response = await fetch(`${trimSlash(url)}/indexes/${encodeURIComponent(index)}/stats`, {
    headers: jsonHeaders(meiliKey),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Meilisearch stats failed with ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function configureIndex(options, fetchImpl = fetch) {
  const response = await fetchImpl(
    `${trimSlash(options.sourceUrl)}/indexes/${encodeURIComponent(options.targetIndex)}/settings`,
    {
      method: 'PATCH',
      headers: jsonHeaders(options.meiliKey),
      body: JSON.stringify(searchIndexSettings()),
    }
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Meilisearch settings update failed with ${response.status}: ${JSON.stringify(body)}`);
  if (Number.isInteger(body?.taskUid)) await waitForMeiliTask(options, body.taskUid, fetchImpl);
  return body;
}

async function waitForMeiliTask(options, taskUid, fetchImpl = fetch) {
  const started = Date.now();
  while (Date.now() - started <= options.waitTimeoutMs) {
    const response = await fetchImpl(`${trimSlash(options.sourceUrl)}/tasks/${taskUid}`, {
      headers: jsonHeaders(options.meiliKey),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Meilisearch task ${taskUid} failed to load with ${response.status}`);
    if (body?.status === 'succeeded') return body;
    if (body?.status === 'failed' || body?.status === 'canceled') {
      throw new Error(`Meilisearch task ${taskUid} ${body.status}: ${JSON.stringify(body.error || body)}`);
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for Meilisearch task ${taskUid}`);
}

async function waitForDocumentCount(options, expected) {
  const started = Date.now();
  let idleChecks = 0;
  while (Date.now() - started <= options.waitTimeoutMs) {
    const stats = await indexStats(options.sourceUrl, options.targetIndex, options.meiliKey);
    const fields = stats.fieldDistribution || {};
    const fullyRewritten = [
      'state',
      'is_public',
      'search_group',
      'search_rank',
      'search_rank_version',
    ].every(
      (field) => Number(fields[field] || 0) >= expected
    );
    if (!stats.isIndexing && Number(stats.numberOfDocuments) >= expected && fullyRewritten) {
      idleChecks += 1;
      if (idleChecks >= 4) return stats;
    } else {
      idleChecks = 0;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${options.targetIndex} to rewrite ${expected} documents`);
}

async function replay(options) {
  if (!options.dryRun) await configureIndex(options);
  if (options.directTarget) return replayDirect(options);
  const existingIds = await fetchAllIds(
    options.sourceUrl,
    options.targetIndex,
    options.batchSize,
    options.meiliKey
  );
  const expectedIds = new Set(existingIds);
  const preservedNativeDocuments = [];
  let targetOffset = 0;
  while (true) {
    const documents = await fetchDocuments(
      options.sourceUrl,
      options.targetIndex,
      targetOffset,
      options.batchSize,
      options.meiliKey
    );
    preservedNativeDocuments.push(
      ...documents.filter((document) => String(document.source_system || '') !== 'legacy-chainquery')
    );
    targetOffset += documents.length;
    if (documents.length < options.batchSize) break;
  }
  if (!options.dryRun && preservedNativeDocuments.length && !options.directTarget) {
    await verifyHydrationBatch(options, preservedNativeDocuments);
    await mapWithConcurrency(preservedNativeDocuments, options.concurrency, (document) =>
      writeDocument(options.hyperbeamUrl, document)
    );
  }
  let offset = options.sourceOffset;
  let written = 0;

  while (true) {
    const documents = await fetchDocuments(
      options.sourceUrl,
      options.sourceIndex,
      offset,
      options.batchSize,
      options.meiliKey
    );
    if (!documents.length) break;
    documents.forEach((document) => {
      const id = sourceDocumentId(document);
      if (id) expectedIds.add(id);
    });
    if (!options.dryRun) {
      await verifyHydrationBatch(options, documents);
      if (options.directTarget) {
        await writeDocumentsDirect(options, documents);
      } else {
        await mapWithConcurrency(documents, options.concurrency, (document) =>
          writeDocument(options.hyperbeamUrl, document)
        );
      }
    }
    written += documents.length;
    offset += documents.length;
    process.stdout.write(`\rReplayed ${written} documents`);
    if (documents.length < options.batchSize) break;
  }

  process.stdout.write('\n');
  if (options.dryRun) return { expected: expectedIds.size, written };
  const stats = await waitForDocumentCount(options, expectedIds.size);
  const indexedIds = await fetchAllIds(
    options.sourceUrl,
    options.targetIndex,
    options.batchSize,
    options.meiliKey
  );
  const missing = [...expectedIds].filter((id) => !indexedIds.has(id));
  if (missing.length) throw new Error(`${missing.length} expected documents are missing from ${options.targetIndex}`);
  return {
    expected: expectedIds.size,
    indexed: Number(stats.numberOfDocuments),
    preservedNative: preservedNativeDocuments.length,
    written,
  };
}

async function replayDirect(options) {
  const sourceStats = await indexStats(options.sourceUrl, options.sourceIndex, options.meiliKey);
  const targetStats = await indexStats(options.sourceUrl, options.targetIndex, options.meiliKey);
  let offset = options.sourceOffset;
  let written = 0;

  while (true) {
    const documents = await fetchDocuments(
      options.sourceUrl,
      options.sourceIndex,
      offset,
      options.batchSize,
      options.meiliKey
    );
    if (!documents.length) break;
    if (!options.dryRun) await writeDocumentsDirect(options, documents);
    written += documents.length;
    offset += documents.length;
    process.stdout.write(`\rReplayed ${written} documents`);
    if (documents.length < options.batchSize) break;
  }

  process.stdout.write('\n');
  if (options.dryRun) {
    return { expected: Number(sourceStats.numberOfDocuments), written };
  }
  const stats = await waitForDocumentCount(
    options,
    Number(sourceStats.numberOfDocuments)
  );
  return {
    expected: Number(sourceStats.numberOfDocuments),
    indexed: Number(stats.numberOfDocuments),
    preservedNative: Math.max(
      0,
      Number(targetStats.numberOfDocuments) - Number(sourceStats.numberOfDocuments)
    ),
    written,
  };
}

function jsonHeaders(meiliKey) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(meiliKey ? { authorization: `Bearer ${meiliKey}` } : {}),
  };
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const result = await replay(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export {
  configureIndex,
  fetchHydratedDocument,
  hydratedClaimFields,
  indexableMessage,
  mapWithConcurrency,
  parseArgs,
  rankingScore,
  replay,
  searchDocument,
  searchGroup,
  searchIndexSettings,
  sourceDocumentId,
  verifyHydratedDocument,
  verifyHydrationBatch,
  writeDocument,
  writeDocumentsDirect,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
