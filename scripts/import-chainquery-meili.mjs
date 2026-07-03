#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';

const DEFAULTS = {
  chainqueryHost: process.env.CHAINQUERY_HOST || 'chainquery.odysee.tv',
  chainqueryUser: process.env.CHAINQUERY_USER || 'blobs-cleaner',
  chainqueryPass: process.env.CHAINQUERY_PASS || '',
  chainqueryDb: process.env.CHAINQUERY_DB || 'chainquery',
  meiliUrl: process.env.MEILI_URL || process.env.ODYSEE_SEARCH_BACKEND_URL || 'http://127.0.0.1:7700',
  meiliKey: process.env.MEILI_MASTER_KEY || process.env.ODYSEE_SEARCH_API_KEY || '',
  index: process.env.MEILI_INDEX || 'odysee_claims',
};

const args = parseArgs(process.argv.slice(2));
const checkpointFile = stringArg(args['checkpoint-file'], process.env.ODYSEE_SEARCH_IMPORT_CHECKPOINT || '');
const checkpoint = await readCheckpoint(checkpointFile);
const fromId = intArg(args['from-id'], Number(checkpoint.cursor || 0));
const limit = intArg(args.limit, 1000);
const batchSize = intArg(args['batch-size'], Math.min(limit, 1000));
const dryRun = Boolean(args['dry-run']);
const setupSettings = Boolean(args['setup-settings']);
const waitForTasks = !Boolean(args['no-wait']);
const waitTimeoutMs = intArg(args['wait-timeout-ms'], Number(process.env.MEILI_WAIT_TIMEOUT_MS || 60000));
const modifiedSince = intArg(args['modified-since'], 0);
const searchTerm = stringArg(args['search-term'], '');
const exactTerm = stringArg(args['exact-term'], '');
const order = stringArg(args.order, searchTerm || exactTerm ? 'recent' : 'id');
const mysqlBin = args.mysql || process.env.MYSQL_BIN || 'mysql';
const meiliUrl = String(args['meili-url'] || DEFAULTS.meiliUrl).replace(/\/+$/, '');
const index = String(args.index || DEFAULTS.index);

if (!DEFAULTS.chainqueryPass && !process.env.MYSQL_PWD) {
  fail('Set CHAINQUERY_PASS or MYSQL_PWD before importing.');
}

if (setupSettings && !dryRun) {
  await configureIndex(meiliUrl, index, waitForTasks, waitTimeoutMs);
}

let imported = 0;
let cursor = fromId;
let maxModifiedAt = Number(checkpoint.modified_at || 0);

while (imported < limit) {
  const take = Math.min(batchSize, limit - imported);
  const rows = await readChainquery(mysqlBin, cursor, take, modifiedSince, searchTerm, exactTerm, order);
  if (!rows.length) break;

  cursor = Math.max(...rows.map((doc) => Number(doc.id || 0)));
  maxModifiedAt = Math.max(maxModifiedAt, ...rows.map((doc) => Number(doc.modified_at || 0)));
  const docs = rows.map(normalizeDoc).filter((doc) => doc.doc_id);

  if (dryRun) {
    process.stdout.write(JSON.stringify({ cursor, count: docs.length, sample: docs.slice(0, 3) }, null, 2) + '\n');
  } else if (docs.length) {
    await postDocuments(meiliUrl, index, docs, waitForTasks, waitTimeoutMs);
  }

  imported += rows.length;
  if (checkpointFile && !dryRun) {
    await writeCheckpoint(checkpointFile, { cursor, modified_at: maxModifiedAt, index, updated_at: new Date().toISOString() });
  }
  process.stderr.write(`imported=${imported} cursor=${cursor} docs=${docs.length}\n`);
  if (rows.length < take) break;
}

process.stdout.write(JSON.stringify({ imported, cursor, modified_at: maxModifiedAt, dryRun, index }) + '\n');

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

async function readChainquery(mysqlBin, afterId, count, modifiedSince, searchTerm, exactTerm, orderMode) {
  const query = chainquerySql(afterId, count, modifiedSince, searchTerm, exactTerm, orderMode);
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

function chainquerySql(afterId, count, modifiedSince, searchTerm, exactTerm, orderMode) {
  const id = Number(afterId) || 0;
  const lim = Math.max(1, Math.min(Number(count) || 1000, 50000));
  const orderBy = orderMode === 'recent'
    ? 'COALESCE(c.release_time, c.transaction_time, UNIX_TIMESTAMP(c.created_at)) DESC, c.id DESC'
    : 'c.id';
  const modifiedFilter =
    Number(modifiedSince) > 0 ? `\n  AND c.modified_at >= FROM_UNIXTIME(${Number(modifiedSince)})` : '';
  const searchFilter = searchTerm ? `\n  AND (${searchPredicate(searchTerm)})` : '';
  const exactFilter = exactTerm ? `\n  AND (${exactPredicate(exactTerm)})` : '';
  return `
SELECT JSON_OBJECT(
  'id', c.id,
  'modified_at', UNIX_TIMESTAMP(c.modified_at),
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
WHERE c.id > ${id}
  AND c.claim_id IS NOT NULL
  AND COALESCE(c.transaction_hash_update, c.transaction_hash_id) IS NOT NULL${modifiedFilter}${searchFilter}${exactFilter}
GROUP BY c.id
ORDER BY ${orderBy}
LIMIT ${lim}`;
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
  const hasThumbnail = thumbnailUrl ? 1 : 0;
  const hasChannel = doc.channel_claim_id || doc.channel_name ? 1 : 0;
  const isControlling = String(doc.bid_state || '') === 'Controlling' ? 1 : 0;
  const recencyRank = recencyScore(releaseTimestamp(doc));
  return {
    ...doc,
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

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
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
      'doc_id',
      'claim_id',
      'immutable_id',
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
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
  };
  const task = await meiliFetch(`${meiliUrl}/indexes/${encodeURIComponent(index)}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
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
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
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
