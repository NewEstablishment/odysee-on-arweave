const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  categorySearchParams,
  dynamicItemWithinFreshnessWindow,
  homepageClaimUri,
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
      timestamp: '>395200',
      release_time: '<1000000',
    }
  );
});

test('dynamic homepage results reject stale and impossible release times', () => {
  const category = { claimType: ['stream'], daysOfContent: 90 };
  const now = 1_800_000_000;

  assert.equal(dynamicItemWithinFreshnessWindow({ value: { release_time: now - 60 } }, category, now), true);
  assert.equal(dynamicItemWithinFreshnessWindow({ value: { release_time: (now - 60) * 1000 } }, category, now), true);
  assert.equal(dynamicItemWithinFreshnessWindow({ value: { release_time: now - 91 * 86400 } }, category, now), false);
  assert.equal(
    dynamicItemWithinFreshnessWindow({ value: { release_time: (now + 2 * 86400) * 1000 } }, category, now),
    false
  );
  assert.equal(
    dynamicItemWithinFreshnessWindow({ value: { release_time: now - 365 * 86400 } }, { claimType: ['channel'] }, now),
    true
  );
});

test('channel discovery does not inherit media freshness filters', () => {
  const params = categorySearchParams({ claimType: ['channel'], order: 'top' }, 1_000_000);

  assert.equal(params.timestamp, undefined);
  assert.equal(params.release_time, undefined);
  assert.deepEqual(params.claim_type, ['channel']);
});

test('homepageClaimUri converts only internal claim links', () => {
  assert.equal(homepageClaimUri('https://odysee.com/@channel:9'), 'lbry://@channel#9');
  assert.equal(homepageClaimUri('/@channel:9/video:a'), 'lbry://@channel#9/video:a');
  assert.equal(homepageClaimUri('https://example.com/@channel:9'), null);
  assert.equal(homepageClaimUri('#section'), null);
});

test('materialization resolves and warms featured banner targets', async () => {
  const warmed = [];
  const result = await materializeHomepageData(
    {
      en: {
        categories: { featured: { pageSize: 1 } },
        featured: { items: [{ url: 'https://odysee.com/@channel:9' }] },
      },
    },
    {
      search: async () => ({ items: [{ immutable_id: 'media:0' }] }),
      resolve: async () => ({ 'lbry://@channel#9': { immutable_id: 'channel:0' } }),
      warm: async (id) => {
        warmed.push(id);
        return true;
      },
    }
  );

  assert.equal(result.en.featured.items[0].immutableId, 'channel:0');
  assert.deepEqual(new Set(warmed), new Set(['media:0', 'channel:0']));
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
  assert.deepEqual(result.en.categories.featured.immutableSigningChannelIds, {
    'first:0': 'channel:0',
    'second:0': 'channel:0',
    'pinned:0': 'channel:0',
  });
  assert.deepEqual(result.en.categories.featured.immutableChannelIds, ['source-channel:0']);
  assert.deepEqual(new Set(warmed), new Set(['first:0', 'second:0', 'pinned:0', 'channel:0']));
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

test('materialization excludes a selected claim whose signing channel cannot be resolved', async () => {
  const source = {
    en: {
      categories: {
        featured: { label: 'Featured', pageSize: 1 },
      },
    },
  };

  const result = await materializeHomepageData(source, {
    search: async (params) =>
      params.claim_ids
        ? { items: [] }
        : {
            items: [{ immutable_id: 'media:0', channel_claim_id: 'missing-channel' }, { immutable_id: 'valid:0' }],
          },
    warm: async () => true,
    searchRetries: 0,
  });

  assert.deepEqual(result.en.categories.featured.immutableIds, ['valid:0']);
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
    search: async (params) => (params.claim_ids ? { items: [] } : { items: [{ immutable_id: 'media:0' }] }),
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
