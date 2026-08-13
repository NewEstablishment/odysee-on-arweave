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
  nativeIdFromLocator,
  readHomepageSnapshot,
  writeHomepageSnapshot,
} = require('./homepageMaterializer');

test('legacy outpoints become native LBRY commitment IDs', () => {
  const txid = '00'.repeat(32);
  assert.equal(nativeIdFromLocator(`${txid}:0`), 'bbZf1Z_TVvZykUBXG1vNa7O4NJKhbhvwo4hEQvw8ig4');
  assert.equal(nativeIdFromLocator('native-message-id'), 'native-message-id');
});

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
  assert.deepEqual(result.en.categories.featured.immutablePoolIds, ['first:0', 'second:0', 'pinned:0', 'third:0']);
  assert.deepEqual(result.en.categories.featured.immutableSigningChannelIds, {
    'first:0': 'channel:0',
    'second:0': 'channel:0',
    'pinned:0': 'channel:0',
    'third:0': 'channel:0',
  });
  assert.deepEqual(new Set(warmed), new Set(['first:0', 'second:0', 'third:0', 'pinned:0', 'channel:0']));
  assert.equal(searches.length, 3);
  assert.equal(source.en.categories.featured.immutableIds, undefined);
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

test('materialization rejects a source result that cannot fill the configured row', async () => {
  const source = {
    en: {
      categories: {
        featured: { label: 'Featured', pageSize: 2 },
      },
    },
  };

  await assert.rejects(
    materializeHomepageData(source, {
      search: async () => ({ items: [{ immutable_id: 'only:0' }] }),
      warm: async () => true,
      warmRetries: 0,
    }),
    /Failed to cache 1 homepage objects/
  );
});

test('materialization backfills a failed media candidate from the verified reserve', async () => {
  const source = {
    en: {
      categories: {
        featured: { label: 'Featured', pageSize: 1 },
      },
    },
  };

  const result = await materializeHomepageData(source, {
    search: async () => ({ items: [{ immutable_id: 'missing:0' }, { immutable_id: 'valid:0' }] }),
    warm: async (id) => id === 'valid:0',
    warmRetries: 0,
  });

  assert.deepEqual(result.en.categories.featured.immutableIds, ['valid:0']);
});

test('materialization expands the reserve window only for incomplete categories', async () => {
  const requestedPages = { complete: [], sparse: [] };
  const requestedTimestamps = { complete: [], sparse: [] };
  const source = {
    en: {
      categories: {
        complete: { label: 'Complete', pageSize: 1, tags: ['complete'], daysOfContent: 1 },
        sparse: { label: 'Sparse', pageSize: 1, tags: ['sparse'], daysOfContent: 1 },
      },
    },
  };

  const result = await materializeHomepageData(source, {
    search: async (params) => {
      const category = params.any_tags[0];
      requestedPages[category].push(params.page);
      requestedTimestamps[category].push(params.timestamp);
      if (category === 'complete') return { items: [{ immutable_id: 'complete:0' }] };
      return {
        items:
          params.page === 2
            ? [{ immutable_id: 'sparse:0' }, { immutable_id: 'reserve:0' }, { immutable_id: 'reserve:1' }]
            : [{ immutable_id: 'missing:0' }, { immutable_id: 'missing:1' }, { immutable_id: 'missing:2' }],
      };
    },
    warm: async (id) => !id.startsWith('missing:'),
    warmRetries: 0,
    nowSeconds: 1_000_000,
  });

  assert.deepEqual(result.en.categories.complete.immutableIds, ['complete:0']);
  assert.deepEqual(result.en.categories.sparse.immutableIds, ['sparse:0']);
  assert.deepEqual(requestedPages, { complete: [1, 1], sparse: [1, 1, 2] });
  assert.deepEqual(requestedTimestamps, {
    complete: ['>913600', '>913600'],
    sparse: ['>913600', '>827200', '>827200'],
  });
});

test('materialization uses a semantic fallback only after the curated pool is exhausted', async () => {
  const searches = [];
  const result = await materializeHomepageData(
    {
      en: {
        categories: {
          TECHNOLOGY: {
            label: 'Technology',
            pageSize: 1,
            channelIds: ['curated-channel'],
            daysOfContent: 1,
          },
        },
      },
    },
    {
      search: async (params) => {
        searches.push(params);
        return params.channel_ids
          ? { items: [{ immutable_id: 'missing:0' }] }
          : { items: [{ immutable_id: 'semantic:0' }] };
      },
      warm: async (id) => id === 'semantic:0',
      warmRetries: 0,
      candidateExpansionRounds: 1,
      nowSeconds: 1_000_000,
    }
  );

  assert.deepEqual(result.en.categories.TECHNOLOGY.immutableIds, ['semantic:0']);
  assert.equal(searches.filter((params) => params.channel_ids).length, 2);
  assert.deepEqual(searches.find((params) => !params.channel_ids).any_tags, ['technology']);
});

test('materialization retries all missing objects after imports are queued', async () => {
  const attempts = new Map();
  const result = await materializeHomepageData(
    {
      en: {
        categories: {
          featured: { label: 'Featured', pageSize: 2 },
        },
      },
    },
    {
      search: async () => ({ items: [{ immutable_id: 'first:0' }, { immutable_id: 'second:0' }] }),
      warm: async (id) => {
        const count = (attempts.get(id) || 0) + 1;
        attempts.set(id, count);
        return count > 1;
      },
      warmRetries: 1,
      warmRetryDelayMs: 0,
    }
  );

  assert.deepEqual(result.en.categories.featured.immutableIds, ['first:0', 'second:0']);
  assert.deepEqual(Object.fromEntries(attempts), { 'first:0': 2, 'second:0': 2 });
});

test('materialization imports known legacy outpoints before probing immutable IDs', async () => {
  const outpoint = `${'11'.repeat(32)}:0`;
  const nativeId = nativeIdFromLocator(outpoint);
  const imports = [];
  const probes = [];
  const result = await materializeHomepageData(
    {
      en: {
        categories: {
          featured: { label: 'Featured', pageSize: 1 },
        },
      },
    },
    {
      search: async () => ({ items: [{ immutable_id: outpoint }] }),
      queueImports: async (locators) => {
        imports.push(...locators);
        return locators;
      },
      warmMany: async (ids) => {
        probes.push(...ids);
        return ids.map((id) => [id, true]);
      },
    }
  );

  assert.deepEqual(imports, [outpoint]);
  assert.deepEqual(probes, []);
  assert.deepEqual(result.en.categories.featured.immutableIds, [nativeId]);
});

test('materialization retries only unresolved legacy imports', async () => {
  const first = `${'21'.repeat(32)}:0`;
  const second = `${'22'.repeat(32)}:0`;
  const calls = [];
  const result = await materializeHomepageData(
    {
      en: {
        categories: {
          featured: { label: 'Featured', pageSize: 2 },
        },
      },
    },
    {
      search: async () => ({ items: [{ immutable_id: first }, { immutable_id: second }] }),
      queueImports: async (locators) => {
        calls.push(locators);
        return calls.length === 1 ? [first] : locators;
      },
      warmMany: async () => {
        throw new Error('source-backed imports must not be probed');
      },
      importRetries: 1,
      importRetryDelayMs: 0,
    }
  );

  assert.deepEqual(calls, [[first, second], [second]]);
  assert.deepEqual(result.en.categories.featured.immutableIds, [
    nativeIdFromLocator(first),
    nativeIdFromLocator(second),
  ]);
});

test('materialization does not probe immutable IDs after a legacy import fails', async () => {
  const outpoint = `${'22'.repeat(32)}:0`;
  const probes = [];

  await assert.rejects(
    materializeHomepageData(
      {
        en: {
          categories: {
            featured: { label: 'Featured', pageSize: 1 },
          },
        },
      },
      {
        search: async () => ({ items: [{ immutable_id: outpoint }] }),
        queueImports: async () => [],
        warmMany: async (ids) => {
          probes.push(...ids);
          return ids.map((id) => [id, true]);
        },
        warmRetries: 0,
        importRetryDelayMs: 0,
      }
    ),
    /Failed to cache 1 homepage objects in HyperBEAM/
  );

  assert.deepEqual(probes, []);
});

test('materialization warms the selected immutable objects in one ordered batch', async () => {
  const batches = [];
  const result = await materializeHomepageData(
    {
      en: {
        categories: {
          featured: { label: 'Featured', pageSize: 2 },
        },
      },
    },
    {
      search: async () => ({
        items: [{ immutable_id: 'first:0' }, { immutable_id: 'second:0' }, { immutable_id: 'reserve:0' }],
      }),
      warmMany: async (ids) => {
        batches.push(ids);
        return ids.map((id) => [id, true]);
      },
    }
  );

  assert.deepEqual(batches, [['first:0', 'second:0', 'reserve:0']]);
  assert.deepEqual(result.en.categories.featured.immutableIds, ['first:0', 'second:0']);
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

test('materialization does not resolve unused source channel pools', async () => {
  let searches = 0;
  const source = {
    en: {
      categories: {
        featured: { label: 'Featured', channelIds: ['missing-channel'], pageSize: 1 },
      },
    },
  };

  const result = await materializeHomepageData(source, {
    search: async () => {
      searches += 1;
      return { items: [{ immutable_id: 'media:0' }] };
    },
    warm: async () => true,
  });

  assert.deepEqual(result.en.categories.featured.immutableIds, ['media:0']);
  assert.equal(searches, 1);
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
