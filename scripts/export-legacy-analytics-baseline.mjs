#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const LEGACY_CLAIM_ID = /^[0-9a-f]{40}$/i;

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const meiliUrl = requiredString(
    args['meili-url'] ?? process.env.MEILI_URL ?? process.env.ODYSEE_SEARCH_BACKEND_URL,
    '--meili-url'
  ).replace(/\/+$/, '');
  const meiliKey = stringArg(
    args['meili-key'] ?? process.env.MEILI_MASTER_KEY ?? process.env.ODYSEE_SEARCH_API_KEY,
    ''
  );
  const index = stringArg(args.index ?? process.env.MEILI_INDEX, 'odysee_claims');
  const apiUrl = stringArg(args['odysee-api-url'] ?? process.env.ODYSEE_API_URL, 'https://api.odysee.com').replace(
    /\/+$/,
    ''
  );
  const useIndexCounts = Boolean(args['use-index-counts']);
  let apiToken = stringArg(args['odysee-api-token'] ?? process.env.ODYSEE_API_AUTH_TOKEN, '');
  if (!useIndexCounts && !apiToken) {
    apiToken = await createLegacyApiToken(apiUrl);
  }
  const output = requiredString(args.output, '--output');
  const batchSize = positiveInteger(args['batch-size'] ?? 1000, '--batch-size');
  const apiBatchSize = Math.min(100, positiveInteger(args['api-batch-size'] ?? 100, '--api-batch-size'));
  const temp = `${output}.tmp`;
  const file = await open(temp, 'w');
  let count = 0;

  try {
    await file.write('[\n');
    for await (const records of legacyBaselineBatches({
      meiliUrl,
      meiliKey,
      index,
      apiUrl,
      apiToken,
      batchSize,
      apiBatchSize,
    })) {
      for (const record of records) {
        if (count > 0) await file.write(',\n');
        await file.write(`  ${JSON.stringify(record)}`);
        count += 1;
      }
      process.stderr.write(`exported=${count}\n`);
    }
    await file.write('\n]\n');
    await file.sync();
    await file.close();
    await rename(temp, output);
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }

  process.stdout.write(`${JSON.stringify({ output, records: count, index })}\n`);
}

async function* legacyBaselineBatches(options, fetchImpl = fetch) {
  const seen = new Set();
  let offset = 0;

  while (true) {
    const documents = await fetchLegacyDocuments(options, offset, fetchImpl);
    if (documents.length === 0) break;

    const mediaDocuments = documents
      .filter((document) => String(document?.claim_type || '').toLowerCase() !== 'channel')
      .map((document) => ({ ...document, claim_id: String(document?.claim_id || '').trim() }))
      .filter((document) => LEGACY_CLAIM_ID.test(document.claim_id) && !seen.has(document.claim_id));
    const claimIds = mediaDocuments.map((document) => document.claim_id);
    claimIds.forEach((claimId) => seen.add(claimId));

    for (let index = 0; index < claimIds.length; index += options.apiBatchSize) {
      const chunk = claimIds.slice(index, index + options.apiBatchSize);
      const documentChunk = mediaDocuments.slice(index, index + options.apiBatchSize);
      const counts = options.apiToken
        ? await fetchLegacyViewCounts(options, chunk, fetchImpl)
        : documentChunk.map((document) =>
            nonNegativeInteger(document.view_count ?? document.view_cnt, `view count for ${document.claim_id}`)
          );
      yield chunk.map((claimId, countIndex) => ({
        'subject-id': claimId,
        value: nonNegativeInteger(counts[countIndex], `view count for ${claimId}`),
      }));
    }

    offset += documents.length;
    if (documents.length < options.batchSize) break;
  }
}

async function fetchLegacyDocuments(options, offset, fetchImpl) {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(options.meiliKey ? { authorization: `Bearer ${options.meiliKey}` } : {}),
  };
  const response = await fetchImpl(
    `${options.meiliUrl}/indexes/${encodeURIComponent(options.index)}/documents/fetch`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: 'source_system = "legacy-chainquery"',
        fields: ['claim_id', 'claim_type', 'view_count', 'view_cnt'],
        offset,
        limit: options.batchSize,
      }),
    }
  );
  const body = await responseJson(response, 'Meilisearch document fetch');
  return Array.isArray(body?.results) ? body.results : [];
}

async function fetchLegacyViewCounts(options, claimIds, fetchImpl) {
  if (claimIds.length === 0) return [];
  const response = await fetchImpl(`${options.apiUrl}/file/view_count`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      auth_token: options.apiToken,
      claim_id: claimIds.join(','),
    }),
  });
  const body = await responseJson(response, 'Odysee view-count request');
  if (!body?.success || !Array.isArray(body.data) || body.data.length !== claimIds.length) {
    throw new Error(
      `Odysee view-count response did not contain ${claimIds.length} ordered values: ${JSON.stringify(body)}`
    );
  }
  return body.data;
}

async function createLegacyApiToken(apiUrl, fetchImpl = fetch) {
  const appId = (`odyseecom${randomBytes(32).toString('hex')}`).slice(0, 66);
  const response = await fetchImpl(`${apiUrl}/user/new`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ auth_token: '', language: 'en', app_id: appId }),
  });
  const body = await responseJson(response, 'Odysee migration-token request');
  const token = stringArg(body?.data?.auth_token ?? body?.auth_token, '');
  if (!body?.success || !token) {
    throw new Error(`Odysee migration-token response did not contain an auth token: ${JSON.stringify(body)}`);
  }
  return token;
}

async function responseJson(response, label) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (['help', 'use-index-counts'].includes(name)) {
      args[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${name}.`);
    args[name] = value;
    index += 1;
  }
  return args;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer.`);
  return parsed;
}

function requiredString(value, label) {
  const result = stringArg(value, '');
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function stringArg(value, fallback) {
  return value === undefined || value === null ? fallback : String(value).trim();
}

function usage() {
  return `Usage:
  node scripts/export-legacy-analytics-baseline.mjs \\
    --meili-url http://127.0.0.1:7700 \\
    --index odysee_claims \\
    --output /secure/path/legacy-view-counts.json \\
    [--meili-key KEY] [--odysee-api-token TOKEN] \\
    [--odysee-api-url https://api.odysee.com] \\
    [--batch-size 1000] [--api-batch-size 100] [--use-index-counts]

By default the exporter creates a transient anonymous legacy service token and
refreshes each count from the Odysee API. This does not require an Odysee user
login. Pass --use-index-counts to use view_count values already captured in the
search index instead. Output uses the generic analytics baseline format. Do not
commit the output file.
`;
}

export {
  createLegacyApiToken,
  fetchLegacyDocuments,
  fetchLegacyViewCounts,
  legacyBaselineBatches,
  parseArgs,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
