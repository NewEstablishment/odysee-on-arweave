import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_NODE_URL = 'http://127.0.0.1:18801';
const DEFAULT_LIMIT = 24;
const LOCATOR_PATTERN = /^(?:[A-Za-z0-9_-]{43}|[0-9a-f]{64}:[0-9]+)$/i;

export function searchResultIds(payload) {
  const value = responsePayload(payload);
  if (Array.isArray(value)) return uniqueLocators(value.map(searchHitId));
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.ids)) return uniqueLocators(value.ids.map(searchHitId));

  const indexed = Object.entries(value)
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, hit]) => searchHitId(hit));
  return uniqueLocators(indexed);
}

export function manifestHomepageModule(ids, options = {}) {
  const locators = uniqueLocators(ids);
  if (!locators.length) throw new Error('Manifest homepage requires at least one immutable locator');
  const label = String(options.label || 'Local content').trim() || 'Local content';
  const homepage = {
    en: {
      categories: {
        LOCAL_CONTENT: {
          name: 'local-content',
          label,
          pageSize: locators.length,
          claimType: ['stream', 'repost'],
          order: 'new',
          immutableIds: locators,
          immutablePoolIds: locators,
        },
      },
    },
  };
  return `module.exports = ${JSON.stringify(homepage, null, 2)};\n`;
}

export async function materializeManifestHomepage(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const nodeUrl = normalizeBase(options.nodeUrl || DEFAULT_NODE_URL);
  const limit = boundedLimit(options.limit || DEFAULT_LIMIT);
  const searchResponse = await fetchImpl(`${nodeUrl}/~search@1.0/query`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      q: '',
      limit,
      filter: ['claim_type IN ["stream", "repost"]', 'nsfw = 0'],
      sort: ['release_time:desc'],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const searchText = await searchResponse.text();
  if (!searchResponse.ok) {
    throw new Error(`Homepage search failed with ${searchResponse.status}: ${searchText.slice(0, 300)}`);
  }

  const locators = searchResultIds(parseJson(searchText));
  if (!locators.length) throw new Error('Homepage search returned no immutable locators');
  await mapWithConcurrency(locators, 8, async (locator) => {
    const response = await fetchImpl(immutableHydrationUrl(nodeUrl, locator), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Homepage locator ${locator} failed exact hydration with ${response.status}`);
  });

  const outputPath = path.resolve(options.outputPath || defaultOutputPath());
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, manifestHomepageModule(locators, { label: options.label }), 'utf8');
  await fs.rename(temporaryPath, outputPath);
  return { locators, outputPath };
}

function immutableHydrationUrl(nodeUrl, locator) {
  const outpoint = String(locator).match(/^([0-9a-f]{64}):(\d+)$/i);
  if (!outpoint) return `${nodeUrl}/${encodeURIComponent(locator)}?accept-bundle=true`;

  const url = new URL(`${nodeUrl}/~cache@1.0/read`);
  url.searchParams.set('read', `odysee/outpoint/${outpoint[1]}/${outpoint[2]}`);
  url.searchParams.set('accept-bundle', 'true');
  return url.href;
}

function responsePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (typeof payload.body === 'string') {
    const body = parseJson(payload.body);
    if (body) return responsePayload(body);
  }
  if (payload.result !== undefined) return responsePayload(payload.result);
  if (payload.data !== undefined) return responsePayload(payload.data);
  return payload;
}

function searchHitId(hit) {
  if (typeof hit === 'string') return hit;
  if (!hit || typeof hit !== 'object') return null;
  return hit['message+link'] || hit['message-link'] || hit.message || hit.id || null;
}

function uniqueLocators(values) {
  return Array.from(new Set(values.map(String).filter((value) => LOCATOR_PATTERN.test(value))));
}

function normalizeBase(value) {
  const base = String(value || '')
    .trim()
    .replace(/\/+$/, '');
  const parsed = new URL(base);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Homepage node URL must use HTTP or HTTPS');
  return base;
}

function boundedLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(100, Math.floor(parsed));
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('Homepage search returned invalid JSON');
  }
}

async function mapWithConcurrency(values, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(values.length, concurrency) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      await worker(values[index]);
    }
  });
  await Promise.all(workers);
}

function defaultOutputPath() {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(directory, '../custom/homepages/v2/index.ts');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await materializeManifestHomepage({
    nodeUrl: process.env.HYPERBEAM_BASE_URL || process.env.ODYSEE_HYPERBEAM_NODE_API || process.env.HOMEPAGE_NODE_URL,
    limit: process.env.MANIFEST_HOMEPAGE_LIMIT,
    label: process.env.MANIFEST_HOMEPAGE_LABEL,
  });
  process.stdout.write(`Materialized ${result.locators.length} manifest homepage locators.\n`);
}
