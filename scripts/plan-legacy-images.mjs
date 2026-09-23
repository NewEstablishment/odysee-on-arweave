#!/usr/bin/env node
// Offline inventory only: no fetching, credentials, node writes or ownership
// assertions. Feed it a JSON array of resolved claims / Chainquery documents.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { unwrapThumbnailProxyUrl } from '../odysee-frontend/ui/util/thumbnailProxy.ts';

const outpointPattern = /^[0-9a-f]{64}:(0|[1-9][0-9]*)$/i;
const claimIdPattern = /^[0-9a-f]{40}$/i;

function exactOutpoint(record) {
  const candidate =
    record.legacy_outpoint ??
    record.outpoint ??
    record.immutable_id ??
    record.doc_id ??
    (record.txid && Number.isSafeInteger(record.nout) && record.nout >= 0 ? `${record.txid}:${record.nout}` : '');
  return typeof candidate === 'string' && outpointPattern.test(candidate) ? candidate.toLowerCase() : '';
}

function imageUrl(value) {
  return typeof value === 'string' ? value : typeof value?.url === 'string' ? value.url : '';
}

export function planLegacyImages(records) {
  if (!Array.isArray(records)) throw new Error('Expected a JSON array of claim records.');
  const entries = new Map();
  const issues = [];
  const hosts = Object.create(null);
  let channelsWithoutBannerField = 0;
  function visit(record, inputIndex, nested = false) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      issues.push({ input_index: inputIndex, reason: 'invalid-record' });
      return;
    }
    const value = record.value || {};
    const type = record.value_type || record.claim_type || value.type;
    const channel = type === 'channel';
    const outpoint = exactOutpoint(record);
    const claimId =
      typeof record.claim_id === 'string' && claimIdPattern.test(record.claim_id) ? record.claim_id.toLowerCase() : '';
    const images = [[channel ? 'avatar' : 'thumbnail', value.thumbnail ?? record.thumbnail_url]];
    if (channel) {
      images.push(['banner', value.cover ?? record.cover_url]);
      if (value.cover === undefined && record.cover_url === undefined) channelsWithoutBannerField++;
    }
    for (const [role, image] of images) {
      const original = imageUrl(image).trim();
      if (!original) continue;
      const context = { input_index: inputIndex, role, ...(claimId ? { claim_id: claimId } : {}) };
      if (!outpoint) {
        issues.push({ ...context, reason: 'missing-immutable-outpoint' });
        continue;
      }
      let url;
      const unwrapped = unwrapThumbnailProxyUrl(original);
      try {
        url = new URL(unwrapped || original);
        // Do not copy signed URLs, embedded passwords, query tokens or fragments
        // into a shareable plan. These need a separate private source adapter.
        const source = new URL(original);
        if ([url, source].some((item) => item.username || item.password || item.search || item.hash)) {
          issues.push({ ...context, reason: 'credential-or-query-url-needs-review' });
          continue;
        }
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('scheme');
      } catch (_) {
        issues.push({ ...context, reason: 'unsupported-image-url' });
        continue;
      }
      const key = createHash('sha256')
        .update(JSON.stringify([outpoint, role, url.href]))
        .digest('hex');
      if (entries.has(key)) continue;
      entries.set(key, {
        job_id: key,
        legacy_outpoint: outpoint,
        ...(claimId ? { claim_id: claimId } : {}),
        role,
        source_url: url.href,
        optimizer_unwrapped: Boolean(unwrapped),
        status: 'planned-not-fetched',
        evidence: 'unverified-export-url-only',
      });
      hosts[url.hostname] = (hosts[url.hostname] || 0) + 1;
    }
    if (!nested && record.signing_channel) visit(record.signing_channel, inputIndex, true);
  }
  records.forEach((record, index) => visit(record, index));
  return {
    schema: 'odysee-image-migration-plan@1.0',
    mode: 'offline-inventory',
    summary: {
      input_records: records.length,
      planned_images: entries.size,
      issues: issues.length,
      channels_without_banner_field: channelsWithoutBannerField,
      hosts,
    },
    entries: [...entries.values()],
    issues,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, ...extra] = process.argv.slice(2);
  if (!input || input === '--help') {
    console.log(
      'Usage: node --experimental-strip-types scripts/plan-legacy-images.mjs <claims.json>\nPrints an offline JSON inventory. Does not fetch images or write to a node.'
    );
  } else {
    try {
      if (extra.length) throw new Error('Expected exactly one input file.');
      console.log(JSON.stringify(planLegacyImages(JSON.parse(await readFile(input, 'utf8'))), null, 2));
    } catch (_) {
      console.error(
        'Image inventory failed. Supply a readable JSON array of claim records; input contents are not logged.'
      );
      process.exitCode = 1;
    }
  }
}
