import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isHomepageEligibleClaim,
  manifestHomepageModule,
  materializeManifestHomepage,
  searchResultIds,
} from '../../scripts/materialize-manifest-homepage.mjs';

const firstId = Buffer.alloc(32, 1).toString('base64url');
const secondId = Buffer.alloc(32, 2).toString('base64url');
const outpoint = `${'ab'.repeat(32)}:0`;
const validClaim = {
  value: {
    thumbnail: { url: 'https://example.test/thumbnail.jpg' },
    release_time: 1_700_000_000,
  },
};

test('reads ordered locators from HyperBEAM indexed-object responses', () => {
  assert.deepEqual(searchResultIds({ 2: secondId, status: 200, 1: firstId, 3: firstId }), [firstId, secondId]);
  assert.deepEqual(searchResultIds({ result: { ids: [{ message: secondId }, { id: firstId }] } }), [secondId, firstId]);
});

test('builds a deterministic custom homepage module', () => {
  const source = manifestHomepageModule([firstId, secondId]);
  assert.match(source, /module\.exports =/);
  assert.match(source, /"name": "local-content"/);
  assert.match(source, /"pageSize": 2/);
  assert(source.indexOf(firstId) < source.indexOf(secondId));
});

test('materializes search locators only after exact reads succeed', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odysee-manifest-homepage-'));
  const outputPath = path.join(directory, 'index.ts');
  const nowSeconds = 1_800_000_000;
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/~search@1.0/query')) {
      return Response.json({ 1: firstId, 2: secondId, status: 200 });
    }
    return Response.json(validClaim);
  };

  const result = await materializeManifestHomepage({
    nodeUrl: 'http://node.test',
    outputPath,
    nowSeconds,
    fetchImpl,
  });
  assert.deepEqual(result.locators, [firstId, secondId]);
  assert.equal(requests.length, 3);
  const searchBody = JSON.parse(requests[0].options.body);
  assert.deepEqual(searchBody.filter, ['claim_type IN ["stream", "repost"]', 'nsfw = 0']);
  assert.deepEqual(searchBody.sort, ['release_time:desc']);
  assert.equal(searchBody.limit, 72);
  const generated = await fs.readFile(outputPath, 'utf8');
  assert.equal(generated, manifestHomepageModule([firstId, secondId]));
});

test('hydrates legacy outpoints through the immutable store route', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odysee-manifest-homepage-outpoint-'));
  const outputPath = path.join(directory, 'index.ts');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const requests = [];

  await materializeManifestHomepage({
    nodeUrl: 'http://node.test',
    outputPath,
    fetchImpl: async (url) => {
      requests.push(String(url));
      return String(url).endsWith('/~search@1.0/query')
        ? Response.json({ 1: outpoint, status: 200 })
        : Response.json(validClaim);
    },
  });

  const hydrationUrl = new URL(requests[1]);
  assert.equal(hydrationUrl.pathname, '/~cache@1.0/read');
  assert.equal(hydrationUrl.searchParams.get('read'), `odysee/outpoint/${'ab'.repeat(32)}/0`);
  assert.equal(hydrationUrl.searchParams.get('accept-bundle'), 'true');
});

test('rejects missing-thumbnail and future claims before writing local content', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odysee-manifest-homepage-eligibility-'));
  const outputPath = path.join(directory, 'index.ts');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const futureId = Buffer.alloc(32, 3).toString('base64url');
  const noThumbnailId = Buffer.alloc(32, 4).toString('base64url');
  const nowSeconds = 1_800_000_000;

  const result = await materializeManifestHomepage({
    nodeUrl: 'http://node.test',
    outputPath,
    nowSeconds,
    fetchImpl: async (url) => {
      if (url.endsWith('/~search@1.0/query')) {
        return Response.json({ 1: noThumbnailId, 2: futureId, 3: firstId, status: 200 });
      }
      if (url.includes(noThumbnailId)) {
        return Response.json({ value: { release_time: nowSeconds - 1 } });
      }
      if (url.includes(futureId)) {
        return Response.json({
          value: { thumbnail: { url: 'https://example.test/future.jpg' }, release_time: nowSeconds + 1 },
        });
      }
      return Response.json(validClaim);
    },
  });

  assert.deepEqual(result.locators, [firstId]);
  const generated = await fs.readFile(outputPath, 'utf8');
  assert.match(generated, new RegExp(firstId));
  assert.doesNotMatch(generated, new RegExp(noThumbnailId));
  assert.doesNotMatch(generated, new RegExp(futureId));
});

test('uses compatibility metadata for legacy claims without a release date', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odysee-manifest-homepage-compatibility-date-'));
  const outputPath = path.join(directory, 'index.ts');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const nowSeconds = 1_800_000_000;
  const legacyClaim = {
    'claim-id': 'ab'.repeat(20),
    value: {
      thumbnail: { url: 'https://example.test/legacy.jpg' },
      release_time: 2_147_483_647,
    },
  };

  const result = await materializeManifestHomepage({
    nodeUrl: 'http://node.test',
    outputPath,
    nowSeconds,
    fetchImpl: async (url) => {
      if (url.endsWith('/~search@1.0/query')) return Response.json({ 1: firstId, status: 200 });
      if (url.includes('odysee%2Fclaim-meta%2F')) return Response.json({ timestamp: nowSeconds - 1 });
      return Response.json(legacyClaim);
    },
  });

  assert.deepEqual(result.locators, [firstId]);
});

test('homepage eligibility accepts a thumbnail only at or before the current time', () => {
  assert.equal(isHomepageEligibleClaim(validClaim, 1_800_000_000), true);
  assert.equal(isHomepageEligibleClaim({ value: { release_time: 1_700_000_000 } }, 1_800_000_000), false);
  assert.equal(
    isHomepageEligibleClaim(
      { value: { thumbnail: { url: 'https://example.test/future.jpg' }, release_time: 1_800_000_001 } },
      1_800_000_000
    ),
    false
  );
  assert.equal(
    isHomepageEligibleClaim(
      { value: { thumbnail: { url: 'https://example.test/year-4026.jpg' }, release_time: 64_874_620_800 } },
      1_800_000_000
    ),
    false
  );
  assert.equal(
    isHomepageEligibleClaim(
      { value: { thumbnail: { url: 'https://example.test/unset.jpg' }, release_time: 2_147_483_647 } },
      1_800_000_000,
      1_700_000_000
    ),
    true
  );
  assert.equal(
    isHomepageEligibleClaim(
      { value: { thumbnail: { url: 'https://example.test/milliseconds.jpg' }, release_time: 1_700_000_000_000 } },
      1_800_000_000
    ),
    true
  );
});

test('fails instead of emitting an unreachable homepage locator', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odysee-manifest-homepage-'));
  const outputPath = path.join(directory, 'index.ts');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    materializeManifestHomepage({
      nodeUrl: 'http://node.test',
      outputPath,
      fetchImpl: async (url) =>
        url.endsWith('/~search@1.0/query')
          ? Response.json({ 1: firstId, status: 200 })
          : new Response('missing', { status: 404 }),
    }),
    /failed exact hydration with 404/
  );
  await assert.rejects(fs.access(outputPath));
});
