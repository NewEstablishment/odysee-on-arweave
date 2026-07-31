const fs = require('node:fs');
const path = require('node:path');

const { hyperbeamNodeSourceClaimSearch, hyperbeamNodeWarmImmutableClaim } = require('./odyseeHyperbeamNode');

const DEFAULT_PAGE_SIZE = 8;
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
const QUERY_CONCURRENCY = 6;
const WARM_CONCURRENCY = 24;

function homepageSnapshotPath(sourceDir) {
  return process.env.CUSTOM_HOMEPAGE_SNAPSHOT_FILE || path.resolve(sourceDir, '..', 'materialized-homepages-v2.json');
}

function homepageSnapshotMaxAgeMs() {
  const configured = Number(process.env.CUSTOM_HOMEPAGE_SNAPSHOT_MAX_AGE_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_MAX_AGE_MS;
}

function categorySearchParams(category, nowSeconds = Math.floor(Date.now() / 1000)) {
  const orderBy = {
    new: ['release_time'],
    top: ['effective_amount'],
    trending: ['trending_group', 'trending_mixed'],
  }[category.order] || ['trending_group', 'trending_mixed'];
  const pageSize = positiveInteger(category.pageSize, DEFAULT_PAGE_SIZE);
  const channelIds = stringList(category.channelIds);
  const claimType = stringList(category.claimType || ['stream', 'repost']);
  const channelLimit =
    category.channelLimit === 'auto'
      ? channelIds.length
        ? getLimitPerChannel(channelIds.length, claimType.length === 1 && claimType[0] === 'channel')
        : undefined
      : positiveInteger(category.channelLimit);

  return compact({
    channel_ids: channelIds.length ? channelIds : undefined,
    not_channel_ids: stringList(category.excludedChannelIds),
    claim_type: claimType,
    any_tags: stringList(category.tags),
    order_by: orderBy,
    page: 1,
    page_size: pageSize,
    limit_claims_per_channel: channelLimit,
    any_languages: stringList(category.searchLanguages),
    duration: category.duration,
    exclude_shorts: category.exclude_shorts ? true : undefined,
    release_time: `>${nowSeconds - positiveInteger(category.daysOfContent, 30) * 24 * 60 * 60}`,
  });
}

function immutableId(item) {
  if (!item || typeof item !== 'object') return null;
  const direct =
    item.immutable_id || item['immutable-id'] || item.outpoint || item.legacy_outpoint || item['legacy-outpoint'];
  if (direct) return String(direct);
  if (item.txid !== undefined && item.nout !== undefined) return `${item.txid}:${item.nout}`;
  return null;
}

function signingChannelId(item) {
  const signingChannel = item && (item.signing_channel || item['signing-channel']);
  return (
    item?.channel_claim_id ||
    item?.['channel-claim-id'] ||
    signingChannel?.claim_id ||
    signingChannel?.['claim-id'] ||
    null
  );
}

function mergePinnedIds(ids, pinnedIds, pageSize) {
  const merged = Array.from(ids);
  const pins = Array.from(new Set(pinnedIds.filter(Boolean)));
  pins.forEach((id) => {
    const index = merged.indexOf(id);
    if (index !== -1) merged.splice(index, 1);
  });
  merged.splice(Math.min(2, merged.length), 0, ...pins);
  return merged.slice(0, pageSize);
}

async function materializeHomepageData(homepageData, dependencies = {}) {
  const search = dependencies.search || hyperbeamNodeSourceClaimSearch;
  const warm = dependencies.warm || hyperbeamNodeWarmImmutableClaim;
  const nowSeconds = dependencies.nowSeconds || Math.floor(Date.now() / 1000);
  const locales = Object.entries(homepageData || {});
  const jobs = locales.flatMap(([locale, homepage]) =>
    Object.entries(homepage?.categories || {}).map(([categoryId, category]) => ({
      locale,
      homepage,
      categoryId,
      category,
    }))
  );

  const selections = await mapWithConcurrency(jobs, QUERY_CONCURRENCY, async (job) => {
    const pageSize = positiveInteger(job.category.pageSize, DEFAULT_PAGE_SIZE);
    const [dynamicResult, pinnedResult] = await Promise.all([
      search(categorySearchParams(job.category, nowSeconds)),
      stringList(job.category.pinnedClaimIds).length
        ? search({
            claim_ids: stringList(job.category.pinnedClaimIds),
            page: 1,
            page_size: stringList(job.category.pinnedClaimIds).length,
            no_totals: true,
          })
        : Promise.resolve(null),
    ]);
    const dynamicItems = Array.isArray(dynamicResult?.items) ? dynamicResult.items : [];
    const pinnedItems = Array.isArray(pinnedResult?.items) ? pinnedResult.items : [];
    const dynamicIds = dynamicItems.map(immutableId).filter(Boolean);
    const pinnedByClaimId = new Map(
      pinnedItems
        .map((item) => [String(item.claim_id || item['claim-id'] || ''), immutableId(item)])
        .filter(([claimId, id]) => claimId && id)
    );
    const pinnedIds = stringList(job.category.pinnedClaimIds).map((claimId) => pinnedByClaimId.get(claimId));
    const channelClaimIds = [...dynamicItems, ...pinnedItems].map(signingChannelId).filter(Boolean);

    return {
      ...job,
      selectedIds: mergePinnedIds(dynamicIds, pinnedIds, pageSize),
      channelClaimIds,
    };
  });

  const selectedIds = Array.from(new Set(selections.flatMap((selection) => selection.selectedIds)));
  const channelClaimIds = Array.from(new Set(selections.flatMap((selection) => selection.channelClaimIds)));
  const channelResult = channelClaimIds.length
    ? await search({
        claim_ids: channelClaimIds,
        page: 1,
        page_size: channelClaimIds.length,
        no_totals: true,
      })
    : null;
  const channelIds = (Array.isArray(channelResult?.items) ? channelResult.items : []).map(immutableId).filter(Boolean);
  const warmIds = Array.from(new Set([...selectedIds, ...channelIds]));
  const warmResults = await mapWithConcurrency(warmIds, WARM_CONCURRENCY, async (id) => [
    id,
    await warm(id).catch(() => false),
  ]);
  const warmed = new Set(warmResults.filter(([, ok]) => ok).map(([id]) => id));
  const failedIds = selectedIds.filter((id) => !warmed.has(id));
  if (failedIds.length) {
    throw new Error(`Failed to cache ${failedIds.length} homepage claims in HyperBEAM`);
  }
  const materialized = structuredClone(homepageData || {});

  selections.forEach(({ locale, categoryId, selectedIds: ids }) => {
    materialized[locale].categories[categoryId].immutableIds = ids;
  });

  return materialized;
}

function readHomepageSnapshot(snapshotPath) {
  try {
    const stat = fs.statSync(snapshotPath);
    return {
      data: JSON.parse(fs.readFileSync(snapshotPath, 'utf8')),
      ageMs: Date.now() - stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

function writeHomepageSnapshot(snapshotPath, data) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const temporaryPath = `${snapshotPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(data)}\n`);
  fs.renameSync(temporaryPath, snapshotPath);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getLimitPerChannel(size, isChannel) {
  if (isChannel) return 1;
  return size < 250 ? (size < 150 ? 3 : 2) : 1;
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value ? [String(value)] : [];
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')
  );
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = {
  categorySearchParams,
  homepageSnapshotMaxAgeMs,
  homepageSnapshotPath,
  immutableId,
  materializeHomepageData,
  mergePinnedIds,
  readHomepageSnapshot,
  writeHomepageSnapshot,
};
