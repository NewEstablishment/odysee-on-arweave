#!/usr/bin/env node

import {
  constants,
  createHash,
  createPrivateKey,
  sign,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const node = requiredString(args.node, '--node').replace(/\/+$/, '');
  const key = requiredString(args.key, '--key');
  const walletPath = requiredString(args.wallet, '--wallet');
  const inputPath = requiredString(args.input, '--input');
  const version = requiredString(args.version, '--version');
  const cutoverAt = nonNegativeInteger(args['cutover-at'], '--cutover-at');
  const source = stringArg(args.source, 'legacy');
  const startAt = Math.max(0, nonNegativeInteger(args['start-at'] ?? 0, '--start-at'));
  const dryRun = Boolean(args['dry-run']);

  const wallet = JSON.parse(await readFile(walletPath, 'utf8'));
  const owner = walletAddress(wallet);
  const records = normalizeRecords(JSON.parse(await readFile(inputPath, 'utf8')));
  let imported = 0;

  for (let index = startAt; index < records.length; index += 1) {
    const record = records[index];
    if (!dryRun) {
      await importRecord({ node, key, owner, wallet, version, cutoverAt, source, record });
    }
    imported += 1;
    process.stdout.write(
      `${JSON.stringify({ index, subject_id: record['subject-id'], value: record.value, dry_run: dryRun })}\n`
    );
  }

  process.stdout.write(
    `${JSON.stringify({ imported, total: records.length, owner, key, dry_run: dryRun })}\n`
  );
}

async function importRecord({ node, key, owner, wallet, version, cutoverAt, source, record }) {
  const nonceResponse = await requestJson(
    `${node}/~analytics@1.0/nonce?owner=${encodeURIComponent(owner)}`,
    { method: 'GET' }
  );
  const nonce = requiredString(nonceResponse.nonce, 'nonce response');
  const message = requiredString(nonceResponse.message, 'nonce message');
  const expectedMessage = `analytics@1.0:${owner}:${nonce}`;
  if (message !== expectedMessage) {
    throw new Error('Analytics nonce response contained an unexpected signing message.');
  }

  const signature = signMessage(wallet, message);
  return requestJson(`${node}/~analytics@1.0/baseline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key,
      'subject-id': record['subject-id'],
      value: record.value,
      version,
      'cutover-at': cutoverAt,
      source,
      owner,
      'public-key': wallet.n,
      nonce,
      signature,
    }),
  });
}

function normalizeRecords(input) {
  const records = Array.isArray(input)
    ? input
    : Object.entries(input || {}).map(([subjectId, value]) => ({ 'subject-id': subjectId, value }));

  return records.map((record, index) => {
    const subjectId = stringArg(record?.['subject-id'] ?? record?.subject_id ?? record?.claim_id, '');
    if (!subjectId) throw new Error(`Baseline record ${index} has no subject-id.`);
    return {
      'subject-id': subjectId,
      value: nonNegativeInteger(
        record?.value ?? record?.view_count ?? record?.view_cnt,
        `baseline record ${index} value`
      ),
    };
  });
}

function walletAddress(wallet) {
  if (!wallet?.n) throw new Error('Wallet JWK is missing its RSA modulus (n).');
  return base64url(createHash('sha256').update(Buffer.from(wallet.n, 'base64url')).digest());
}

function signMessage(wallet, message) {
  const privateKey = createPrivateKey({ key: wallet, format: 'jwk' });
  return base64url(
    sign('sha256', Buffer.from(message), {
      key: privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    })
  );
}

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (['help', 'dry-run'].includes(name)) {
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

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
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

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function usage() {
  return `Usage:
  node scripts/import-analytics-baseline.mjs \\
    --node http://127.0.0.1:18801 \\
    --key odysee \\
    --wallet /path/to/arweave-jwk.json \\
    --input /path/to/view-counts.json \\
    --version legacy-watchman-2026-08-20 \\
    --cutover-at 1787234400 \\
    [--source legacy-watchman] [--start-at 0] [--dry-run]

Input may be an object mapping subject IDs to counts or an array of
{"subject-id":"...","value":123} records. Baselines are immutable per
subject and version; rerunning an accepted record is idempotent.
`;
}

export {
  importRecord,
  normalizeRecords,
  parseArgs,
  signMessage,
  walletAddress,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
