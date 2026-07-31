const fs = require('node:fs');
const path = require('node:path');

const {
  hyperbeamNodeResolve,
  hyperbeamNodeSourceClaimSearch,
  hyperbeamNodeWarmImmutableClaim,
} = require('./odyseeHyperbeamNode');

const DEFAULT_PAGE_SIZE = 8;
const QUERY_CONCURRENCY = 2;
const WARM_CONCURRENCY = 2;
const CHANNEL_WARM_CONCURRENCY = 2;
const WARM_RETRIES = 5;
const WARM_RETRY_DELAY_MS = 500;
const SEARCH_RETRIES = 3;
const RESOLVE_BATCH_SIZE = 24;
const BANNER_RESOLVE_BATCH_SIZE = 6;
const CATEGORY_RESERVE_SIZE = 4;

function homepageSnapshotPath() {
  return (
    process.env.CUSTOM_HOMEPAGE_SNAPSHOT_FILE ||
    path.resolve(__dirname, '../../runtime/homepage/materialized-homepages-v2.json')
  );
}

function categorySearchParams(category, nowSeconds = Math.floor(Date.now() / 1000)) {
  const orderBy = {
    new: ['release_time'],
    top: ['effective_amount'],
    trending: ['trending_group', 'trending_mixed'],
  }[category.order] || ['trending_group', 'trending_mixed'];
  const pageSize = positiveInteger(category.pageSize, DEFAULT_PAGE_SIZE);
  const earliest = nowSeconds - positiveInteger(category.daysOfContent, 30) * 24 * 60 * 60;
  const channelIds = stringList(category.channelIds);
  const claimType = stringList(category.claimType || ['stream', 'repost']);
  const channelOnly = claimType.length === 1 && claimType[0] === 'channel';
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
    timestamp: channelOnly ? undefined : `>${earliest}`,
    release_time: channelOnly ? undefined : `<${nowSeconds}`,
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

function dynamicItemWithinFreshnessWindow(item, category, nowSeconds) {
  const claimTypes = stringList(category.claimType || ['stream', 'repost']);
  if (claimTypes.length === 1 && claimTypes[0] === 'channel') return true;

  const rawReleaseTime =
    item?.value?.release_time ||
    item?.value?.['release-time'] ||
    item?.release_time ||
    item?.['release-time'] ||
    item?.timestamp;
  let releaseTime = Number(rawReleaseTime);
  if (!Number.isFinite(releaseTime) || releaseTime <= 0) return true;
  while (releaseTime > 100_000_000_000) releaseTime /= 1000;

  const earliest = nowSeconds - positiveInteger(category.daysOfContent, 30) * 24 * 60 * 60;
  const latest = nowSeconds;
  return releaseTime > earliest && releaseTime <= latest;
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
  const resolve = dependencies.resolve || hyperbeamNodeResolve;
  const warm = dependencies.warm || hyperbeamNodeWarmImmutableClaim;
  const searchRetries = dependencies.searchRetries ?? SEARCH_RETRIES;
  const searchRetryDelayMs = dependencies.searchRetryDelayMs ?? 200;
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
    const searchParams = categorySearchParams(job.category, nowSeconds);
    const [dynamicResult, pinnedResult] = await Promise.all([
      searchWithRetry(
        search,
        { ...searchParams, page_size: pageSize + CATEGORY_RESERVE_SIZE },
        searchRetries,
        searchRetryDelayMs
      ),
      stringList(job.category.pinnedClaimIds).length
        ? searchWithRetry(
            search,
            {
              claim_ids: stringList(job.category.pinnedClaimIds),
              page: 1,
              page_size: stringList(job.category.pinnedClaimIds).length,
              no_totals: true,
            },
            searchRetries,
            searchRetryDelayMs
          )
        : Promise.resolve(null),
    ]);
    const dynamicItems = Array.isArray(dynamicResult?.items)
      ? dynamicResult.items.filter((item) => dynamicItemWithinFreshnessWindow(item, job.category, nowSeconds))
      : [];
    const pinnedItems = Array.isArray(pinnedResult?.items) ? pinnedResult.items : [];
    const dynamicIds = dynamicItems.map(immutableId).filter(Boolean);
    const pinnedByClaimId = new Map(
      pinnedItems
        .map((item) => [String(item.claim_id || item['claim-id'] || ''), immutableId(item)])
        .filter(([claimId, id]) => claimId && id)
    );
    const pinnedIds = stringList(job.category.pinnedClaimIds).map((claimId) => pinnedByClaimId.get(claimId));
    const channelClaimIds = [...dynamicItems, ...pinnedItems].map(signingChannelId).filter(Boolean);
    const signingChannelByMediaId = new Map(
      [...dynamicItems, ...pinnedItems]
        .map((item) => [immutableId(item), signingChannelId(item)])
        .filter(([mediaId, channelClaimId]) => mediaId && channelClaimId)
    );

    return {
      ...job,
      selectedIds: mergePinnedIds(dynamicIds, pinnedIds, pageSize + CATEGORY_RESERVE_SIZE),
      pageSize,
      channelClaimIds,
      signingChannelByMediaId,
    };
  });

  const bannerItems = locales.flatMap(([, homepage]) => homepage?.featured?.items || []);
  const bannerEntries = bannerItems.map((item) => [item, homepageClaimUri(item?.url)]).filter(([, uri]) => uri);
  const bannerUris = Array.from(new Set(bannerEntries.map(([, uri]) => uri)));
  const bannerResults = await mapWithConcurrency(
    chunk(bannerUris, BANNER_RESOLVE_BATCH_SIZE),
    QUERY_CONCURRENCY,
    (urls) => resolveWithRetry(resolve, urls, searchRetries, searchRetryDelayMs)
  );
  const bannerClaims = Object.assign({}, ...bannerResults);
  const bannerIdsByUri = new Map(
    bannerUris.map((uri) => [uri, immutableId(bannerClaims?.[uri])]).filter(([, id]) => id)
  );
  const unresolvedBannerUris = bannerUris.filter((uri) => !bannerIdsByUri.has(uri));
  if (unresolvedBannerUris.length) {
    throw new Error(`Failed to resolve ${unresolvedBannerUris.length} homepage banners`);
  }
  const bannerIds = Array.from(new Set(bannerIdsByUri.values()));
  const sourceChannelClaimIds = Array.from(
    new Set(selections.flatMap((selection) => stringList(selection.category.channelIds)))
  );
  const selectedChannelClaimIds = Array.from(new Set(selections.flatMap((selection) => selection.channelClaimIds)));
  const channelClaimIds = Array.from(new Set([...sourceChannelClaimIds, ...selectedChannelClaimIds]));
  const channelResults = await mapWithConcurrency(
    chunk(channelClaimIds, RESOLVE_BATCH_SIZE),
    QUERY_CONCURRENCY,
    (claimIds) =>
      searchWithRetry(
        search,
        {
          claim_ids: claimIds,
          page: 1,
          page_size: claimIds.length,
          no_totals: true,
        },
        searchRetries,
        searchRetryDelayMs
      )
  );
  const channelItems = channelResults.flatMap((result) => (Array.isArray(result?.items) ? result.items : []));
  const channelIdsByClaimId = new Map(
    channelItems
      .map((item) => [String(item.claim_id || item['claim-id'] || ''), immutableId(item)])
      .filter(([claimId, id]) => claimId && id)
  );
  selections.forEach((selection) => {
    selection.selectedIds = selection.selectedIds
      .filter((mediaId) => {
        const channelClaimId = selection.signingChannelByMediaId.get(mediaId);
        return !channelClaimId || channelIdsByClaimId.has(channelClaimId);
      })
      .slice(0, selection.pageSize);
  });
  const selectedIds = Array.from(new Set(selections.flatMap((selection) => selection.selectedIds)));
  const visibleChannelClaimIds = Array.from(
    new Set(
      selections.flatMap((selection) =>
        selection.selectedIds.map((mediaId) => selection.signingChannelByMediaId.get(mediaId)).filter(Boolean)
      )
    )
  );
  const selectedChannelIds = visibleChannelClaimIds.map((claimId) => channelIdsByClaimId.get(claimId)).filter(Boolean);
  const selectedIdSet = new Set(selectedIds);
  const channelWarmIds = Array.from(new Set([...selectedChannelIds, ...bannerIds])).filter(
    (id) => !selectedIdSet.has(id)
  );
  const warmRetries = dependencies.warmRetries ?? WARM_RETRIES;
  const warmRetryDelayMs = dependencies.warmRetryDelayMs ?? WARM_RETRY_DELAY_MS;
  const mediaWarmResults = await warmObjects(selectedIds, WARM_CONCURRENCY, warm, warmRetries, warmRetryDelayMs);
  const channelWarmResults = await warmObjects(
    channelWarmIds,
    CHANNEL_WARM_CONCURRENCY,
    warm,
    warmRetries,
    warmRetryDelayMs
  );
  const warmResults = [...mediaWarmResults, ...channelWarmResults];
  const warmIds = [...selectedIds, ...channelWarmIds];
  const warmed = new Set(warmResults.filter(([, ok]) => ok).map(([id]) => id));
  const failedIds = warmIds.filter((id) => !warmed.has(id));
  if (failedIds.length) {
    throw new Error(
      `Failed to cache ${failedIds.length} homepage objects in HyperBEAM: ${failedIds.slice(0, 5).join(', ')}`
    );
  }
  const materialized = structuredClone(homepageData || {});

  selections.forEach(({ locale, categoryId, selectedIds: ids, signingChannelByMediaId }) => {
    const sourceChannelIds = stringList(materialized[locale].categories[categoryId].channelIds);
    materialized[locale].categories[categoryId].immutableIds = ids;
    materialized[locale].categories[categoryId].immutableSigningChannelIds = Object.fromEntries(
      ids
        .map((mediaId) => [mediaId, channelIdsByClaimId.get(signingChannelByMediaId.get(mediaId))])
        .filter(([, channelId]) => channelId)
    );
    materialized[locale].categories[categoryId].immutableChannelIds = sourceChannelIds
      .map((claimId) => channelIdsByClaimId.get(claimId))
      .filter(Boolean);
    materialized[locale].categories[categoryId].unresolvedChannelIds = sourceChannelIds.filter(
      (claimId) => !channelIdsByClaimId.has(claimId)
    );
  });
  bannerEntries.forEach(([sourceItem, uri]) => {
    for (const homepage of Object.values(materialized)) {
      for (const item of homepage?.featured?.items || []) {
        if (item.url === sourceItem.url) item.immutableId = bannerIdsByUri.get(uri);
      }
    }
  });
  if (!selections.some((selection) => selection.selectedIds.length)) {
    throw new Error('Homepage materialization selected no visible entries');
  }

  return materialized;
}

function homepageClaimUri(value) {
  if (!value || typeof value !== 'string' || value.startsWith('#')) return null;
  let pathname = value;
  try {
    const url = new URL(value);
    if (!/(^|\.)odysee\.com$/i.test(url.hostname)) return null;
    pathname = url.pathname;
  } catch {
    if (!pathname.startsWith('/')) return null;
  }
  const claimPath = pathname.replace(/^\/+/, '').split('/').filter(Boolean).slice(0, 2).join('/');
  if (!claimPath) return null;
  return `lbry://${decodeURIComponent(claimPath).replace(':', '#')}`;
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

function warmObjects(ids, concurrency, warm, retries, retryDelayMs) {
  return mapWithConcurrency(ids, concurrency, async (id) => {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (await warm(id).catch(() => false)) return [id, true];
      if (attempt < retries && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
    return [id, false];
  });
}

async function searchWithRetry(search, params, retries, retryDelayMs) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await search(params);
      if (result) return result;
      lastError = new Error('Homepage source search returned no result');
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }
  throw lastError;
}

async function resolveWithRetry(resolve, urls, retries, retryDelayMs) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await resolve({ urls });
      if (result) return result;
      lastError = new Error('Homepage banner resolution returned no result');
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries && retryDelayMs > 0) {
      await new Promise((done) => setTimeout(done, retryDelayMs * (attempt + 1)));
    }
  }
  throw lastError;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

module.exports = {
  categorySearchParams,
  dynamicItemWithinFreshnessWindow,
  homepageSnapshotPath,
  homepageClaimUri,
  immutableId,
  materializeHomepageData,
  mergePinnedIds,
  readHomepageSnapshot,
  writeHomepageSnapshot,
};
