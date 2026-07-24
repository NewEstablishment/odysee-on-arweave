#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULTS = {
  chainqueryHost: process.env.CHAINQUERY_HOST || 'chainquery.odysee.tv',
  chainqueryUser: process.env.CHAINQUERY_USER || 'blobs-cleaner',
  chainqueryPass: process.env.CHAINQUERY_PASS || '',
  chainqueryDb: process.env.CHAINQUERY_DB || 'chainquery',
  meiliUrl: process.env.MEILI_URL || process.env.ODYSEE_SEARCH_BACKEND_URL || 'http://127.0.0.1:7700',
  meiliKey: process.env.MEILI_MASTER_KEY || process.env.ODYSEE_SEARCH_API_KEY || '',
  index: process.env.MEILI_INDEX || 'odysee_claims',
};

const CHECKPOINT_VERSION = 3;
const ID_SCHEMA_VERSION = 'sha256-b64u-locator-v2';
const MODIFIED_SCAN_STRATEGY = 'lighthouse-id-window-v1';

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const checkpointFile = stringArg(args['checkpoint-file'], process.env.ODYSEE_SEARCH_IMPORT_CHECKPOINT || '');
  const checkpoint = await readCheckpoint(checkpointFile);
  const rebuildIndex = Boolean(args['rebuild-index']);
  const limit = intArg(args.limit, rebuildIndex ? Number.MAX_SAFE_INTEGER : 1000);
  const batchSize = Math.max(1, intArg(args['batch-size'], Math.min(limit, 1000)));
  const dryRun = Boolean(args['dry-run']);
  const setupSettings = Boolean(args['setup-settings']);
  const noWait = Boolean(args['no-wait']);
  const waitForTasks = !noWait;
  const waitTimeoutMs = intArg(args['wait-timeout-ms'], Number(process.env.MEILI_WAIT_TIMEOUT_MS || 60000));
  const modifiedSince = intArg(args['modified-since'], 0);
  const searchTerm = stringArg(args['search-term'], '');
  const exactTerm = stringArg(args['exact-term'], '');
  const order = stringArg(args.order, searchTerm || exactTerm ? 'recent' : 'id');
  const mode = scanMode(order, modifiedSince);
  const mysqlBin = args.mysql || process.env.MYSQL_BIN || 'mysql';
  const meiliUrl = String(args['meili-url'] || DEFAULTS.meiliUrl).replace(/\/+$/, '');
  const targetIndex = String(args.index || DEFAULTS.index);
  const stagingIndex = String(args['staging-index'] || `${targetIndex}__rebuild`);
  const index = rebuildIndex ? stagingIndex : targetIndex;
  const scope = checkpointScope({
    mode,
    targetIndex,
    stagingIndex: rebuildIndex ? stagingIndex : '',
    searchTerm,
    exactTerm,
  });
  const generation = String(checkpoint.generation || randomUUID());
  let cursor = initialCursor(mode, checkpoint, args, modifiedSince);

  if (!DEFAULTS.chainqueryPass && !process.env.MYSQL_PWD) {
    fail('Set CHAINQUERY_PASS or MYSQL_PWD before importing.');
  }
  validateTaskWaiting({ dryRun, noWait });
  validateCheckpoint(checkpoint, mode, index, scope);
  validateRebuildRequest({
    rebuildIndex,
    mode,
    searchTerm,
    exactTerm,
    checkpoint,
    targetIndex,
    stagingIndex,
    checkpointFile,
  });

  if (mode === 'modified' && !cursor.upper_bound) {
    cursor = { ...cursor, upper_bound: await readChainqueryWatermark(mysqlBin) };
  }

  let rebuildStartedAt = Number(checkpoint.rebuild_started_at || 0);
  if (rebuildIndex && !rebuildStartedAt) {
    rebuildStartedAt = await readChainqueryWatermark(mysqlBin);
  }

  if (rebuildIndex && !dryRun) {
    if (!Object.keys(checkpoint).length) {
      await deleteIndexIfExists(meiliUrl, stagingIndex, waitForTasks, waitTimeoutMs);
      await createIndexIfMissing(meiliUrl, stagingIndex, waitForTasks, waitTimeoutMs);
      await configureIndex(meiliUrl, stagingIndex, waitForTasks, waitTimeoutMs);
    } else if (
      !['swapped', 'cleaning'].includes(checkpoint.phase) &&
      !(await indexExists(meiliUrl, stagingIndex))
    ) {
      throw new Error(`Rebuild checkpoint exists but staging index ${stagingIndex} does not.`);
    }
    if (!Object.keys(checkpoint).length) {
      await postDocuments(
        meiliUrl,
        stagingIndex,
        [generationDocument(generation)],
        waitForTasks,
        waitTimeoutMs
      );
      await writeCheckpoint(
        checkpointFile,
        checkpointState(mode, cursor, index, {
          scope,
          phase: 'importing',
          generation,
          rebuild: true,
          rebuild_started_at: rebuildStartedAt,
          target_index: targetIndex,
        })
      );
    }
  } else if (setupSettings && !dryRun) {
    await createIndexIfMissing(meiliUrl, index, waitForTasks, waitTimeoutMs);
    await configureIndex(meiliUrl, index, waitForTasks, waitTimeoutMs);
  }

  let imported = 0;
  let exhausted = rebuildIndex && checkpoint.phase && checkpoint.phase !== 'importing';
  while (!exhausted && imported < limit) {
    const take = Math.min(batchSize, limit - imported);
    const rows = await readChainquery(mysqlBin, cursor, take, searchTerm, exactTerm, mode);
    if (!rows.length) {
      exhausted = true;
      break;
    }

    cursor = nextCursor(mode, rows, cursor);
    const normalized = rows.map(normalizeDoc).filter((doc) => doc.doc_id);
    const docs = normalized.filter(activeLegacyDocument);
    if (dryRun) {
      process.stdout.write(
        JSON.stringify(
          { cursor, count: docs.length, removed: normalized.length - docs.length, sample: docs.slice(0, 3) },
          null,
          2
        ) + '\n'
      );
    } else {
      await replaceLegacyDocuments(meiliUrl, index, normalized, docs, waitTimeoutMs);
    }

    imported += rows.length;
    if (checkpointFile && !dryRun) {
      await writeCheckpoint(
        checkpointFile,
        checkpointState(mode, cursor, index, {
          scope,
          phase: 'importing',
          ...(rebuildIndex
            ? {
                generation,
                rebuild: true,
                rebuild_started_at: rebuildStartedAt,
                target_index: targetIndex,
              }
            : {}),
        })
      );
    }
    process.stderr.write(`imported=${imported} cursor=${JSON.stringify(cursor)} docs=${docs.length}\n`);
    if (rows.length < take) {
      exhausted = true;
      break;
    }
  }

  let swapped = false;
  let preservedNative = 0;
  let reconciledLegacy = 0;
  if (rebuildIndex && !dryRun && exhausted) {
    const finalized = await finalizeRebuild({
      batchSize,
      checkpointFile,
      exactTerm,
      generation,
      index,
      meiliUrl,
      mode,
      mysqlBin,
      rebuildStartedAt,
      scope,
      searchTerm,
      stagingIndex,
      targetIndex,
      waitTimeoutMs,
    });
    swapped = finalized.swapped;
    preservedNative = finalized.preservedNative;
    reconciledLegacy = finalized.reconciledLegacy;
  } else if (!rebuildIndex && !dryRun && exhausted && checkpointFile && mode === 'modified') {
    await writeCheckpoint(
      checkpointFile,
      checkpointState(mode, { id: 0, lower_bound: cursor.upper_bound, upper_bound: 0 }, index, {
        scope,
        phase: 'cycle-complete',
      })
    );
  }

  process.stdout.write(
    JSON.stringify({
      imported,
      preservedNative,
      reconciledLegacy,
      cursor,
      mode,
      dryRun,
      index,
      targetIndex,
      rebuildIndex,
      exhausted,
      swapped,
    }) + '\n'
  );
}

function parseArgs(values) {
  const out = {};
  for (let i = 0; i < values.length; i += 1) {
    const arg = values[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = values[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function intArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function stringArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  return String(value);
}

function scanMode(order, modifiedSince) {
  if (modifiedSince > 0) return 'modified';
  return order === 'recent' ? 'recent' : 'id';
}

function initialCursor(mode, checkpoint, args, modifiedSince) {
  const checkpointCursor = checkpoint && typeof checkpoint.cursor === 'object' ? checkpoint.cursor : {};
  const legacyCursor = Number(checkpoint && typeof checkpoint.cursor !== 'object' ? checkpoint.cursor : 0) || 0;
  const fromId = intArg(args['from-id'], Number(checkpointCursor.id || legacyCursor));
  if (mode === 'modified') {
    return {
      id: fromId,
      lower_bound: intArg(
        args['from-modified-at'],
        Number(checkpointCursor.lower_bound || checkpointCursor.modified_at || modifiedSince)
      ),
      upper_bound: Number(checkpointCursor.upper_bound || 0),
    };
  }
  if (mode === 'recent') {
    return {
      id: fromId,
      sort_time: intArg(args['from-sort-time'], Number(checkpointCursor.sort_time || 0)),
    };
  }
  return { id: fromId };
}

function nextCursor(mode, rows, cursor = {}) {
  const row = rows[rows.length - 1] || {};
  if (mode === 'modified') {
    return {
      id: Number(row.id || 0),
      lower_bound: Number(cursor.lower_bound || 0),
      upper_bound: Number(cursor.upper_bound || 0),
    };
  }
  if (mode === 'recent') {
    return { id: Number(row.id || 0), sort_time: Number(row.sort_time || 0) };
  }
  return { id: Number(row.id || 0) };
}

function checkpointState(mode, cursor, index, metadata = {}) {
  return {
    version: CHECKPOINT_VERSION,
    id_schema: ID_SCHEMA_VERSION,
    mode,
    cursor,
    index,
    ...metadata,
    updated_at: new Date().toISOString(),
  };
}

function checkpointScope({ mode, targetIndex, stagingIndex, searchTerm, exactTerm }) {
  return {
    chainquery_host: DEFAULTS.chainqueryHost,
    chainquery_db: DEFAULTS.chainqueryDb,
    target_index: targetIndex,
    staging_index: stagingIndex,
    mode,
    search_term: searchTerm,
    exact_term: exactTerm,
    scan_strategy: mode === 'modified' ? MODIFIED_SCAN_STRATEGY : `${mode}-keyset-v1`,
    id_schema: ID_SCHEMA_VERSION,
  };
}

function validateCheckpoint(checkpoint, mode, index, scope) {
  if (!checkpoint || !Object.keys(checkpoint).length) return;
  if (checkpoint.version !== CHECKPOINT_VERSION) {
    throw new Error(
      `Checkpoint version ${checkpoint.version || 'legacy'} does not match required version ${CHECKPOINT_VERSION}.`
    );
  }
  if (checkpoint.id_schema !== ID_SCHEMA_VERSION) {
    throw new Error(`Checkpoint id schema ${checkpoint.id_schema || 'missing'} does not match ${ID_SCHEMA_VERSION}.`);
  }
  if (checkpoint.mode && checkpoint.mode !== mode) {
    throw new Error(`Checkpoint mode ${checkpoint.mode} does not match requested mode ${mode}.`);
  }
  if (checkpoint.index && checkpoint.index !== index) {
    throw new Error(`Checkpoint index ${checkpoint.index} does not match requested index ${index}.`);
  }
  if (scope && JSON.stringify(checkpoint.scope || null) !== JSON.stringify(scope)) {
    throw new Error('Checkpoint source/filter scope does not match the requested import.');
  }
}

function validateTaskWaiting({ dryRun, noWait }) {
  if (!dryRun && noWait) {
    throw new Error('--no-wait is unsafe for imports because checkpoints must follow completed Meilisearch tasks.');
  }
}

function validateRebuildRequest({
  rebuildIndex,
  mode,
  searchTerm,
  exactTerm,
  checkpoint,
  targetIndex,
  stagingIndex,
  checkpointFile,
}) {
  if (!rebuildIndex) return;
  if (mode !== 'id' || searchTerm || exactTerm) {
    throw new Error('A full index rebuild requires an unfiltered id scan.');
  }
  if (targetIndex === stagingIndex) {
    throw new Error('The rebuild staging index must differ from the live index.');
  }
  if (!checkpointFile) {
    throw new Error('A full index rebuild requires --checkpoint-file for restart-safe cutover.');
  }
  if (!checkpoint || !Object.keys(checkpoint).length) return;
  if (checkpoint.rebuild !== true || checkpoint.target_index !== targetIndex) {
    throw new Error('Checkpoint does not describe the requested full index rebuild.');
  }
}

async function readCheckpoint(file) {
  if (!file) return {};
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeCheckpoint(file, state) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n');
  await rename(tmp, file);
}

async function unlinkIfExists(file) {
  try {
    await unlink(file);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
}

async function readChainquery(mysqlBin, cursor, count, searchTerm, exactTerm, mode) {
  const query = chainquerySql(cursor, count, searchTerm, exactTerm, mode);
  const output = await run(mysqlBin, [
    '--skip-ssl',
    '--batch',
    '--raw',
    '--skip-column-names',
    '-h',
    DEFAULTS.chainqueryHost,
    '-u',
    DEFAULTS.chainqueryUser,
    DEFAULTS.chainqueryDb,
    '-e',
    query,
  ]);

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readChainqueryWatermark(mysqlBin) {
  const output = await run(mysqlBin, [
    '--skip-ssl',
    '--batch',
    '--raw',
    '--skip-column-names',
    '-h',
    DEFAULTS.chainqueryHost,
    '-u',
    DEFAULTS.chainqueryUser,
    DEFAULTS.chainqueryDb,
    '-e',
    'SELECT UNIX_TIMESTAMP(NOW())',
  ]);
  const watermark = Number.parseInt(output.trim(), 10);
  if (!Number.isFinite(watermark) || watermark <= 0) {
    throw new Error(`Chainquery returned an invalid cycle watermark: ${output.trim()}`);
  }
  return watermark;
}

function chainquerySql(cursor, count, searchTerm, exactTerm, mode) {
  const id = Number(cursor && cursor.id) || 0;
  const lim = Math.max(1, Math.min(Number(count) || 1000, 50000));
  const scan = scanSql(mode, cursor, id);
  const searchFilter = searchTerm ? `\n  AND (${searchPredicate(searchTerm)})` : '';
  const exactFilter = exactTerm ? `\n  AND (${exactPredicate(exactTerm)})` : '';
  return `
SELECT JSON_OBJECT(
  'id', c.id,
  'modified_at', UNIX_TIMESTAMP(c.modified_at),
  'sort_time', COALESCE(c.release_time, c.transaction_time, UNIX_TIMESTAMP(c.created_at)),
  'doc_id', CONCAT(COALESCE(c.transaction_hash_update, c.transaction_hash_id), ':', COALESCE(c.vout_update, c.vout)),
  'immutable_id', CONCAT(COALESCE(c.transaction_hash_update, c.transaction_hash_id), ':', COALESCE(c.vout_update, c.vout)),
  'legacy_outpoint', CONCAT(COALESCE(c.transaction_hash_update, c.transaction_hash_id), ':', COALESCE(c.vout_update, c.vout)),
  'source_system', 'legacy-chainquery',
  'claim_id', c.claim_id,
  'name', c.name,
  'source_name', c.source_name,
  'searchable_name', TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.name, '.', ' '), '_', ' '), '-', ' '), '(', ' '), ')', ' '), '[', ' ')),
  'stripped_name', REPLACE(REPLACE(REPLACE(REPLACE(c.name, '-', ''), '_', ''), 'The', ''), 'the', ''),
  'channel_name', p.name,
  'channel_claim_id', p.claim_id,
  'channel_claim_count', p.claim_count,
  'claim_count', c.claim_count,
  'bid_state', c.bid_state,
  'effective_amount', c.effective_amount,
  'certificate_amount', COALESCE(p.effective_amount, 1),
  'transaction_time', c.transaction_time,
  'created_at', UNIX_TIMESTAMP(c.created_at),
  'title', c.title,
  'description', c.description,
  'release_time', c.release_time,
  'content_type', c.content_type,
  'cert_valid', c.is_cert_valid,
  'claim_type', c.type,
  'width', c.frame_width,
  'height', c.frame_height,
  'duration', COALESCE(c.duration, c.audio_duration),
  'nsfw', c.is_nsfw,
  'thumbnail_url', c.thumbnail_url,
  'fee', c.fee,
  'tags_csv', GROUP_CONCAT(t.tag SEPARATOR ','),
  'language', c.language
)
FROM claim c
LEFT JOIN claim p ON p.claim_id = c.publisher_id
LEFT JOIN claim_tag ct ON ct.claim_id = c.claim_id
LEFT JOIN tag t ON ct.tag_id = t.id
WHERE ${scan.where}
  AND c.claim_id IS NOT NULL
  AND COALESCE(c.transaction_hash_update, c.transaction_hash_id) IS NOT NULL${searchFilter}${exactFilter}
GROUP BY c.id
ORDER BY ${scan.orderBy}
LIMIT ${lim}`;
}

function scanSql(mode, cursor, id) {
  if (mode === 'modified') {
    const lowerBound = Number(cursor && (cursor.lower_bound || cursor.modified_at)) || 0;
    const upperBound = Number(cursor && cursor.upper_bound) || 0;
    if (!upperBound) throw new Error('Modified scans require a frozen upper-bound watermark.');
    return {
      where: `c.id > ${id} AND c.modified_at >= FROM_UNIXTIME(${lowerBound}) AND c.modified_at < FROM_UNIXTIME(${upperBound})`,
      orderBy: 'c.id ASC',
    };
  }
  if (mode === 'recent') {
    const sortTime = Number(cursor && cursor.sort_time) || 0;
    const sortExpression = 'COALESCE(c.release_time, c.transaction_time, UNIX_TIMESTAMP(c.created_at))';
    return {
      where: sortTime > 0 ? `(${sortExpression} < ${sortTime} OR (${sortExpression} = ${sortTime} AND c.id < ${id}))` : '1 = 1',
      orderBy: `${sortExpression} DESC, c.id DESC`,
    };
  }
  return { where: `c.id > ${id}`, orderBy: 'c.id ASC' };
}

function exactPredicate(value) {
  const noExt = String(value).replace(/\.[^.]+$/, '');
  const candidates = [...new Set([String(value), noExt].filter(Boolean))];
  return candidates.flatMap((candidate) => {
    const quoted = sqlString(candidate);
    return [`c.name = ${quoted}`, `c.title = ${quoted}`, `c.source_name = ${quoted}`];
  }).join(' OR ');
}

function searchPredicate(value) {
  const like = `%${sqlString(value).slice(1, -1)}%`;
  const quotedLike = sqlString(like);
  return [
    `c.name LIKE ${quotedLike}`,
    `c.title LIKE ${quotedLike}`,
    `c.description LIKE ${quotedLike}`,
    `p.name LIKE ${quotedLike}`,
    `t.tag LIKE ${quotedLike}`,
  ].join(' OR ');
}

function sqlString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function normalizeDoc(doc) {
  const tags = typeof doc.tags_csv === 'string' && doc.tags_csv ? doc.tags_csv.split(',').filter(Boolean) : [];
  delete doc.tags_csv;

  const docId = String(doc.doc_id || '');
  const claimType = String(doc.claim_type || '');
  const effectiveAmount = numberValue(doc.effective_amount);
  const certificateAmount = numberValue(doc.certificate_amount, 1);
  const viewCount = numberValue(doc.view_cnt || doc.view_count);
  const subCount = numberValue(doc.sub_cnt);
  const claimCount = numberValue(doc.claim_count || doc.claim_cnt);
  const channelClaimCount = numberValue(doc.channel_claim_count);
  const thumbnailUrl = String(doc.thumbnail_url || '');
  const isChannel = claimType === 'channel' ? 1 : 0;
  const hasThumbnail = validThumbnailUrl(thumbnailUrl) ? 1 : 0;
  const hasChannel = doc.channel_claim_id || doc.channel_name ? 1 : 0;
  const isControlling = String(doc.bid_state || '') === 'Controlling' ? 1 : 0;
  const recencyRank = recencyScore(releaseTimestamp(doc));
  return {
    ...doc,
    id: docId,
    search_id: searchId(docId),
    tags,
    media_type: mediaType(doc.content_type),
    fee: Number(doc.fee || 0),
    claim_cnt: claimCount || channelClaimCount,
    view_cnt: viewCount,
    sub_cnt: subCount,
    view_count: viewCount,
    is_channel: isChannel,
    has_thumbnail: hasThumbnail,
    has_channel: hasChannel,
    is_controlling: isControlling,
    recency_rank: recencyRank,
    search_rank: searchRank({
      isControlling,
      hasThumbnail,
      effectiveAmount,
      certificateAmount,
      viewCount,
      subCount,
      claimCount: claimCount || channelClaimCount,
      isChannel,
      duration: numberValue(doc.duration),
      recencyRank,
    }),
  };
}

function normalizeNativeDoc(doc) {
  const docId = String(doc.doc_id || doc.claim_id || doc.data_id || doc.immutable_id || '');
  const recordId = String(doc.record_id || '');
  const immutableId = String(recordId || doc.immutable_id || docId);
  return {
    ...doc,
    ...(docId ? { doc_id: docId, search_id: searchId(docId) } : {}),
    ...(recordId ? { immutable_id: recordId } : {}),
    ...(immutableId ? { id: immutableId } : {}),
  };
}

function activeLegacyDocument(doc) {
  const state = String(doc.bid_state || '').toLowerCase();
  return state !== 'spent' && state !== 'expired';
}

function meiliString(value) {
  return JSON.stringify(String(value));
}

function legacyClaimFilter(documents) {
  const claimIds = [
    ...new Set(
      documents
        .map((document) => String(document.claim_id || ''))
        .filter(Boolean)
    ),
  ];
  if (!claimIds.length) return '';
  return `source_system = "legacy-chainquery" AND claim_id IN [${claimIds.map(meiliString).join(', ')}]`;
}

async function replaceLegacyDocuments(meiliUrl, index, normalized, active, waitTimeoutMs) {
  const filter = legacyClaimFilter(normalized);
  if (filter) {
    const deletion = await meiliFetch(
      `${meiliUrl}/indexes/${encodeURIComponent(index)}/documents/delete`,
      { method: 'POST', body: JSON.stringify({ filter }) }
    );
    await maybeWaitForTask(meiliUrl, deletion, true, waitTimeoutMs);
  }
  if (active.length) {
    await postDocuments(meiliUrl, index, active, true, waitTimeoutMs);
  }
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validThumbnailUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname === 'localhost') return false;
    return hostname.includes('.') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
  } catch {
    return false;
  }
}

function searchRank({
  isControlling,
  hasThumbnail,
  effectiveAmount,
  certificateAmount,
  viewCount,
  subCount,
  claimCount,
  isChannel,
  duration,
  recencyRank,
}) {
  const supportRank =
    Math.log1p(Math.max(1, Math.min(effectiveAmount, 100000000)) * 21) * 2 +
    Math.log1p(Math.max(1, Math.min(certificateAmount, 100000000)) * 21) * 2;
  const rank =
    recencyRank * 20 +
    isControlling * 25 +
    hasThumbnail * 20 +
    supportRank +
    Math.log1p(Math.max(1, viewCount)) * 2 +
    Math.log1p(Math.max(1, subCount)) * 3 +
    (isChannel && claimCount > 10 ? 10 : 0);
  return duration > 0 && duration < 120 ? rank * 0.5 : rank;
}

function releaseTimestamp(doc) {
  return numberValue(doc.release_time) || numberValue(doc.transaction_time) || numberValue(doc.created_at);
}

function recencyScore(timestamp) {
  if (!timestamp) return 0;
  const ageDays = Math.max(0, (Date.now() / 1000 - timestamp) / 86400);
  if (ageDays <= 7) return 60;
  if (ageDays <= 30) return 45;
  if (ageDays <= 90) return 30;
  if (ageDays <= 365) return 18;
  if (ageDays <= 3650) return Math.max(0, 12 - ((ageDays - 365) / 365));
  return 0;
}

function searchId(value) {
  return createHash('sha256').update(String(value)).digest('base64url');
}

function mediaType(contentType) {
  const value = String(contentType || '').toLowerCase();
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('audio/')) return 'audio';
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('text/')) return 'text';
  if (value.startsWith('application/')) return 'application';
  if (value === 'skp' || value === 'simplify3d_stl') return 'cad';
  return '';
}

async function configureIndex(meiliUrl, index, waitForTasks, waitTimeoutMs) {
  const settings = {
    searchableAttributes: ['title', 'name', 'source_name', 'channel_name', 'searchable_name', 'stripped_name', 'tags', 'description'],
    filterableAttributes: [
      'search_id',
      'doc_id',
      'claim_id',
      'immutable_id',
      'record_id',
      'data_id',
      'channel_claim_id',
      'bid_state',
      'claim_type',
      'content_type',
      'media_type',
      'tags',
      'language',
      'nsfw',
      'fee',
      'release_time',
      'created_at',
      'transaction_time',
      'duration',
      'height',
      'width',
      'claim_count',
      'claim_cnt',
      'channel_claim_count',
      'is_channel',
      'has_thumbnail',
      'has_channel',
      'is_controlling',
      'recency_rank',
      'source_system',
    ],
    sortableAttributes: [
      'is_channel',
      'search_rank',
      'has_thumbnail',
      'is_controlling',
      'recency_rank',
      'effective_amount',
      'certificate_amount',
      'view_count',
      'view_cnt',
      'sub_cnt',
      'claim_count',
      'claim_cnt',
      'channel_claim_count',
      'release_time',
      'created_at',
      'transaction_time',
      'duration',
    ],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'exactness', 'sort'],
  };
  const task = await meiliFetch(`${meiliUrl}/indexes/${encodeURIComponent(index)}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
  await maybeWaitForTask(meiliUrl, task, waitForTasks, waitTimeoutMs);
}

async function indexExists(meiliUrl, index) {
  const result = await meiliRequest(`${meiliUrl}/indexes/${encodeURIComponent(index)}`, { method: 'GET' });
  if (result.response.status === 404) return false;
  assertMeiliSuccess(result);
  return true;
}

async function createIndexIfMissing(meiliUrl, index, waitForTasks, waitTimeoutMs) {
  if (await indexExists(meiliUrl, index)) return;
  const task = await meiliFetch(`${meiliUrl}/indexes`, {
    method: 'POST',
    body: JSON.stringify({ uid: index, primaryKey: 'search_id' }),
  });
  await maybeWaitForTask(meiliUrl, task, waitForTasks, waitTimeoutMs);
}

async function deleteIndexIfExists(meiliUrl, index, waitForTasks, waitTimeoutMs) {
  if (!(await indexExists(meiliUrl, index))) return;
  const task = await meiliFetch(`${meiliUrl}/indexes/${encodeURIComponent(index)}`, { method: 'DELETE' });
  await maybeWaitForTask(meiliUrl, task, waitForTasks, waitTimeoutMs);
}

async function swapIndexes(meiliUrl, targetIndex, stagingIndex, waitForTasks, waitTimeoutMs) {
  const task = await meiliFetch(`${meiliUrl}/swap-indexes`, {
    method: 'POST',
    body: JSON.stringify([{ indexes: [targetIndex, stagingIndex] }]),
  });
  await maybeWaitForTask(meiliUrl, task, waitForTasks, waitTimeoutMs);
}

async function postDocuments(meiliUrl, index, docs, waitForTasks, waitTimeoutMs) {
  const task = await meiliFetch(`${meiliUrl}/indexes/${encodeURIComponent(index)}/documents?primaryKey=search_id`, {
    method: 'POST',
    body: JSON.stringify(docs),
  });
  await maybeWaitForTask(meiliUrl, task, waitForTasks, waitTimeoutMs);
}

async function replaceNativeDocuments(
  meiliUrl,
  sourceIndex,
  targetIndex,
  batchSize,
  waitForTasks,
  waitTimeoutMs
) {
  const filter = 'source_system = "hyperbeam-native"';
  const deletion = await meiliFetch(
    `${meiliUrl}/indexes/${encodeURIComponent(targetIndex)}/documents/delete`,
    { method: 'POST', body: JSON.stringify({ filter }) }
  );
  await maybeWaitForTask(meiliUrl, deletion, waitForTasks, waitTimeoutMs);

  let copied = 0;
  while (true) {
    const page = await meiliFetch(
      `${meiliUrl}/indexes/${encodeURIComponent(sourceIndex)}/documents/fetch`,
      {
        method: 'POST',
        body: JSON.stringify({ filter, offset: copied, limit: batchSize }),
      }
    );
    const docs = Array.isArray(page && page.results) ? page.results.map(normalizeNativeDoc) : [];
    if (!docs.length) break;
    await postDocuments(meiliUrl, targetIndex, docs, waitForTasks, waitTimeoutMs);
    copied += docs.length;
    if (docs.length < batchSize) break;
  }
  return copied;
}

function generationSearchId(generation) {
  return searchId(`import-generation:${generation}`);
}

function generationDocument(generation) {
  return {
    search_id: generationSearchId(generation),
    doc_id: `import-generation:${generation}`,
    source_system: 'import-generation',
    generation,
  };
}

async function indexHasDocument(meiliUrl, index, documentId) {
  const result = await meiliRequest(
    `${meiliUrl}/indexes/${encodeURIComponent(index)}/documents/${encodeURIComponent(documentId)}`,
    { method: 'GET' }
  );
  if (result.response.status === 404) return false;
  assertMeiliSuccess(result);
  return true;
}

async function deleteDocumentIfExists(meiliUrl, index, documentId, waitTimeoutMs) {
  const task = await meiliFetch(
    `${meiliUrl}/indexes/${encodeURIComponent(index)}/documents/${encodeURIComponent(documentId)}`,
    { method: 'DELETE' }
  );
  await maybeWaitForTask(meiliUrl, task, true, waitTimeoutMs);
}

function rebuildCutoverAction(liveHasGeneration, stagingHasGeneration) {
  if (liveHasGeneration) return 'already-swapped';
  if (stagingHasGeneration) return 'swap';
  throw new Error('Neither live nor staging index contains the rebuild generation marker.');
}

async function mergeNativeDocuments(
  meiliUrl,
  sourceIndex,
  targetIndex,
  batchSize,
  waitTimeoutMs
) {
  const filter = 'source_system = "hyperbeam-native"';
  let offset = 0;
  let merged = 0;
  while (true) {
    const page = await meiliFetch(
      `${meiliUrl}/indexes/${encodeURIComponent(sourceIndex)}/documents/fetch`,
      {
        method: 'POST',
        body: JSON.stringify({ filter, offset, limit: batchSize }),
      }
    );
    const docs = Array.isArray(page && page.results) ? page.results.map(normalizeNativeDoc) : [];
    if (!docs.length) break;

    const ids = docs.map((doc) => doc.search_id).filter(Boolean);
    const currentPage = ids.length
      ? await meiliFetch(
          `${meiliUrl}/indexes/${encodeURIComponent(targetIndex)}/documents/fetch`,
          {
            method: 'POST',
            body: JSON.stringify({
              filter: `search_id IN [${ids.map(meiliString).join(', ')}]`,
              limit: ids.length,
            }),
          }
        )
      : { results: [] };
    const current = new Map(
      (Array.isArray(currentPage && currentPage.results) ? currentPage.results : []).map((doc) => [
        String(doc.search_id || ''),
        doc,
      ])
    );
    const updates = docs.filter((doc) => {
      const existing = current.get(String(doc.search_id || ''));
      return !existing || documentVersion(doc) > documentVersion(existing);
    });
    if (updates.length) {
      await postDocuments(meiliUrl, targetIndex, updates, true, waitTimeoutMs);
      merged += updates.length;
    }
    offset += docs.length;
    if (docs.length < batchSize) break;
  }
  return merged;
}

function documentVersion(doc) {
  return Math.max(
    numberValue(doc.modified_at),
    numberValue(doc.timestamp),
    numberValue(doc.signing_ts),
    numberValue(doc.release_time),
    numberValue(doc.created_at),
    numberValue(doc.transaction_time)
  );
}

async function finalizeRebuild({
  batchSize,
  checkpointFile,
  exactTerm,
  generation,
  index,
  meiliUrl,
  mode,
  mysqlBin,
  rebuildStartedAt,
  scope,
  searchTerm,
  stagingIndex,
  targetIndex,
  waitTimeoutMs,
}) {
  let state = await readCheckpoint(checkpointFile);
  let phase = state.phase || 'importing';
  let preservedNative = Number(state.preserved_native || 0);
  let reconciledLegacy = Number(state.reconciled_legacy || 0);

  const persist = async (nextPhase, extra = {}) => {
    state = checkpointState(mode, state.cursor || { id: 0 }, index, {
      scope,
      generation,
      rebuild: true,
      rebuild_started_at: rebuildStartedAt,
      target_index: targetIndex,
      ...state,
      ...extra,
      phase: nextPhase,
    });
    await writeCheckpoint(checkpointFile, state);
    phase = nextPhase;
  };

  if (phase === 'importing') {
    const upperBound = await readChainqueryWatermark(mysqlBin);
    await persist('reconciling-legacy', {
      delta_cursor: { id: 0, lower_bound: rebuildStartedAt, upper_bound: upperBound },
    });
  }

  if (phase === 'reconciling-legacy') {
    let deltaCursor = state.delta_cursor;
    while (true) {
      const rows = await readChainquery(mysqlBin, deltaCursor, batchSize, searchTerm, exactTerm, 'modified');
      if (!rows.length) break;
      deltaCursor = nextCursor('modified', rows, deltaCursor);
      const normalized = rows.map(normalizeDoc).filter((doc) => doc.doc_id);
      const active = normalized.filter(activeLegacyDocument);
      await replaceLegacyDocuments(meiliUrl, stagingIndex, normalized, active, waitTimeoutMs);
      reconciledLegacy += rows.length;
      await persist('reconciling-legacy', {
        delta_cursor: deltaCursor,
        reconciled_legacy: reconciledLegacy,
      });
      if (rows.length < batchSize) break;
    }
    await persist('preserving-native', { reconciled_legacy: reconciledLegacy });
  }

  if (phase === 'preserving-native') {
    await createIndexIfMissing(meiliUrl, targetIndex, true, waitTimeoutMs);
    preservedNative = await replaceNativeDocuments(
      meiliUrl,
      targetIndex,
      stagingIndex,
      batchSize,
      true,
      waitTimeoutMs
    );
    await persist('ready-to-swap', { preserved_native: preservedNative });
  }

  if (phase === 'ready-to-swap') {
    const marker = generationSearchId(generation);
    const liveHasGeneration = await indexHasDocument(meiliUrl, targetIndex, marker);
    const stagingHasGeneration = await indexHasDocument(meiliUrl, stagingIndex, marker);
    if (rebuildCutoverAction(liveHasGeneration, stagingHasGeneration) === 'swap') {
      await swapIndexes(meiliUrl, targetIndex, stagingIndex, true, waitTimeoutMs);
    }
    await persist('swapped', { preserved_native: preservedNative });
  }

  if (phase === 'swapped') {
    const mergedNative = await mergeNativeDocuments(
      meiliUrl,
      stagingIndex,
      targetIndex,
      batchSize,
      waitTimeoutMs
    );
    await persist('cleaning', { merged_native: mergedNative, preserved_native: preservedNative });
  }

  if (phase === 'cleaning') {
    await deleteDocumentIfExists(meiliUrl, targetIndex, generationSearchId(generation), waitTimeoutMs);
    await deleteIndexIfExists(meiliUrl, stagingIndex, true, waitTimeoutMs);
    await unlinkIfExists(checkpointFile);
  }

  return { swapped: true, preservedNative, reconciledLegacy };
}

async function maybeWaitForTask(meiliUrl, task, waitForTasks, waitTimeoutMs) {
  if (!waitForTasks || !task || task.taskUid === undefined) return;
  const started = Date.now();
  while (Date.now() - started <= waitTimeoutMs) {
    const current = await meiliFetch(`${meiliUrl}/tasks/${task.taskUid}`, { method: 'GET' });
    if (current.status === 'succeeded') return;
    if (current.status === 'failed' || current.status === 'canceled') {
      throw new Error(`Meilisearch task ${task.taskUid} ${current.status}: ${JSON.stringify(current.error || current)}`);
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Meilisearch task ${task.taskUid}`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function meiliFetch(url, init) {
  const result = await meiliRequest(url, init);
  assertMeiliSuccess(result);
  return result.body;
}

async function meiliRequest(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(DEFAULTS.meiliKey ? { authorization: `Bearer ${DEFAULTS.meiliKey}` } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null, text };
}

function assertMeiliSuccess({ response, text }) {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
}

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, {
      env: {
        ...process.env,
        MYSQL_PWD: process.env.MYSQL_PWD || DEFAULTS.chainqueryPass,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr}`));
    });
  });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export {
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
  validThumbnailUrl,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
