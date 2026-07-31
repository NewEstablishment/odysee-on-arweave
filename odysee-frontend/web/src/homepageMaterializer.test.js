const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  categorySearchParams,
  materializeHomepageData,
  mergePinnedIds,
  readHomepageSnapshot,
  writeHomepageSnapshot,
} = require('./homepageMaterializer');

test('categorySearchParams preserves homepage selection rules', () => {
  assert.deepEqual(
    categorySearchParams(
      {
        channelIds: ['channel'],
        excludedChannelIds: ['excluded'],
        claimType: ['stream'],
        tags: ['gaming'],
        order: 'new',
        pageSize: 12,
        channelLimit: '2',
        searchLanguages: ['en'],
        duration: '>=60',
        exclude_shorts: true,
        daysOfContent: 7,
      },
      1_000_000
    ),
    {
      channel_ids: ['channel'],
      not_channel_ids: ['excluded'],
      claim_type: ['stream'],
      any_tags: ['gaming'],
      order_by: ['release_time'],
      page: 1,
      page_size: 12,
      limit_claims_per_channel: 2,
      any_languages: ['en'],
      duration: '>=60',
      exclude_shorts: true,
      release_time: '>395200',
    }
  );
});

test('materialization returns ordered immutable IDs only after warming every selected claim', async () => {
  const searches = [];
  const warmed = [];
  const search = async (params) => {
    searches.push(params);
    if (params.claim_ids?.[0] === 'pinned-claim') {
      return {
        items: [
          {
            claim_id: 'pinned-claim',
            immutable_id: 'pinned:0',
            channel_claim_id: 'channel-claim',
          },
        ],
      };
    }
    if (params.claim_ids) {
      return {
        items: params.claim_ids.map((claimId) => ({
          claim_id: claimId,
          immutable_id: claimId === 'channel-claim' ? 'channel:0' : 'source-channel:0',
        })),
      };
    }
    return {
      items: [
        { immutable_id: 'first:0', channel_claim_id: 'channel-claim' },
        { immutable_id: 'second:0', channel_claim_id: 'channel-claim' },
        { immutable_id: 'third:0', channel_claim_id: 'channel-claim' },
      ],
    };
  };
  const source = {
    en: {
      categories: {
        featured: {
          label: 'Featured',
          pageSize: 3,
          pinnedClaimIds: ['pinned-claim'],
          channelIds: ['source-channel'],
        },
      },
    },
  };

  const result = await materializeHomepageData(source, {
    search,
    warm: async (id) => {
      warmed.push(id);
      return true;
    },
    nowSeconds: 1_000_000,
  });

  assert.deepEqual(result.en.categories.featured.immutableIds, ['first:0', 'second:0', 'pinned:0']);
  assert.deepEqual(result.en.categories.featured.immutableChannelIds, ['source-channel:0']);
  assert.deepEqual(
    new Set(warmed),
    new Set(['first:0', 'second:0', 'pinned:0', 'channel:0'])
  );
  assert.equal(searches.length, 3);
  assert.equal(source.en.categories.featured.immutableIds, undefined);
  assert.equal(source.en.categories.featured.immutableChannelIds, undefined);
});

test('materialization rejects an incomplete HyperBEAM cache warm', async () => {
  const source = {
    en: {
      categories: {
        featured: { label: 'Featured', pageSize: 1 },
      },
    },
  };

  await assert.rejects(
    materializeHomepageData(source, {
      search: async () => ({ items: [{ immutable_id: 'missing:0' }] }),
      warm: async () => false,
      warmRetries: 0,
    }),
    /Failed to cache 1 homepage objects/
  );
});

test('materialization records source channels that cannot be converted to immutable IDs', async () => {
  const source = {
    en: {
      categories: {
        featured: { label: 'Featured', channelIds: ['missing-channel'], pageSize: 1 },
      },
    },
  };

  const result = await materializeHomepageData(source, {
    search: async (params) =>
      params.claim_ids ? { items: [] } : { items: [{ immutable_id: 'media:0' }] },
    warm: async () => true,
  });

  assert.deepEqual(result.en.categories.featured.immutableChannelIds, []);
  assert.deepEqual(result.en.categories.featured.unresolvedChannelIds, ['missing-channel']);
});

test('materialization retries a transient source search failure', async () => {
  let calls = 0;
  const result = await materializeHomepageData(
    {
      en: {
        categories: {
          featured: { label: 'Featured', pageSize: 1 },
        },
      },
    },
    {
      search: async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary timeout');
        return { items: [{ immutable_id: 'media:0' }] };
      },
      searchRetries: 1,
      searchRetryDelayMs: 0,
      warm: async () => true,
    }
  );

  assert.equal(calls, 2);
  assert.deepEqual(result.en.categories.featured.immutableIds, ['media:0']);
});

test('mergePinnedIds preserves the configured row size and pin position', () => {
  assert.deepEqual(mergePinnedIds(['a', 'b', 'c', 'd'], ['d'], 4), ['a', 'b', 'd', 'c']);
});

test('homepage snapshots are written atomically and can be read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homepage-materializer-test-'));
  const snapshotPath = path.join(dir, 'snapshot.json');
  const data = { en: { categories: {} } };

  writeHomepageSnapshot(snapshotPath, data);

  assert.deepEqual(readHomepageSnapshot(snapshotPath).data, data);
  assert.deepEqual(fs.readdirSync(dir), ['snapshot.json']);
  fs.rmSync(dir, { recursive: true });
});
