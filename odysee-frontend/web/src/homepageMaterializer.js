const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const {
  hyperbeamNodeResolve,
  hyperbeamNodeQueueImmutableClaims,
  hyperbeamNodeSourceClaimSearch,
  hyperbeamNodeWarmImmutableClaims,
} = require('./odyseeHyperbeamNode');

const DEFAULT_PAGE_SIZE = 8;
const QUERY_CONCURRENCY = 2;
const IMMUTABLE_BATCH_SIZE = 512;
const FALLBACK_WARM_CONCURRENCY = 2;
const WARM_RETRIES = 5;
const WARM_RETRY_DELAY_MS = 500;
const SEARCH_RETRIES = 3;
const IMPORT_RETRIES = 2;
const IMPORT_RETRY_DELAY_MS = 1000;
const RESOLVE_BATCH_SIZE = 24;
const BANNER_RESOLVE_BATCH_SIZE = 6;
const CATEGORY_CANDIDATE_MULTIPLIER = 3;
const CATEGORY_EXPANSION_ROUNDS = 3;

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
  if (direct) return nativeIdFromLocator(String(direct));
  if (item.txid !== undefined && item.nout !== undefined) return nativeIdFromLocator(`${item.txid}:${item.nout}`);
  return null;
}

function sourceLocator(item) {
  if (!item || typeof item !== 'object') return null;
  const direct =
    item.legacy_outpoint || item['legacy-outpoint'] || item.outpoint || item.immutable_id || item['immutable-id'];
  if (direct) return String(direct);
  if (item.txid !== undefined && item.nout !== undefined) return `${item.txid}:${item.nout}`;
  return null;
}

function nativeIdFromLocator(locator) {
  const outpoint = String(locator || '').match(/^([0-9a-f]{64}):([0-9]+)$/i);
  if (!outpoint) return locator || null;

  const nout = Number(outpoint[2]);
  if (!Number.isSafeInteger(nout) || nout < 0 || nout > 0xffffffff) return null;
  const nativeId = Buffer.alloc(36);
  Buffer.from(outpoint[1], 'hex').copy(nativeId, 0);
  nativeId.writeUInt32BE(nout, 32);
  return crypto.createHash('sha256').update(nativeId).digest('base64url');
}

function isOutpointId(value) {
  return /^[0-9a-f]{64}:[0-9]+$/i.test(String(value || ''));
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
  const warmMany =
    dependencies.warmMany ||
    (dependencies.warm
      ? (ids, locatorById) => warmObjects(ids, FALLBACK_WARM_CONCURRENCY, dependencies.warm, 0, 0, locatorById)
      : hyperbeamNodeWarmImmutableClaims);
  const queueImports = dependencies.queueImports || hyperbeamNodeQueueImmutableClaims;
  const importRetries = dependencies.importRetries ?? IMPORT_RETRIES;
  const importRetryDelayMs = dependencies.importRetryDelayMs ?? IMPORT_RETRY_DELAY_MS;
  const searchRetries = dependencies.searchRetries ?? SEARCH_RETRIES;
  const searchRetryDelayMs = dependencies.searchRetryDelayMs ?? 200;
  const nowSeconds = dependencies.nowSeconds || Math.floor(Date.now() / 1000);
  const candidatePageCounts = dependencies.candidatePageCounts || new Map();
  const freshnessMultipliers = dependencies.freshnessMultipliers || new Map();
  const semanticFallbacks = dependencies.semanticFallbacks || new Set();
  const candidateExpansionRound = dependencies.candidateExpansionRound || 0;
  const candidateExpansionRounds = dependencies.candidateExpansionRounds ?? CATEGORY_EXPANSION_ROUNDS;
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
    const selectionKey = `${job.locale}/${job.categoryId}`;
    const candidatePageCount = candidatePageCounts.get(selectionKey) || 1;
    const freshnessMultiplier = freshnessMultipliers.get(selectionKey) || 1;
    const effectiveCategory = {
      ...job.category,
      daysOfContent: positiveInteger(job.category.daysOfContent, 30) * freshnessMultiplier,
    };
    const searchParams = categorySearchParams(effectiveCategory, nowSeconds);
    const semanticTags = stringList(job.category.tags).length
      ? stringList(job.category.tags)
      : [String(job.categoryId).toLowerCase()];
    const [dynamicResult, semanticResult, pinnedResult] = await Promise.all([
      searchCandidatePages(
        search,
        searchParams,
        pageSize * CATEGORY_CANDIDATE_MULTIPLIER,
        candidatePageCount,
        searchRetries,
        searchRetryDelayMs
      ),
      semanticFallbacks.has(selectionKey)
        ? searchCandidatePages(
            search,
            { ...searchParams, channel_ids: undefined, any_tags: semanticTags },
            pageSize * CATEGORY_CANDIDATE_MULTIPLIER,
            candidatePageCount,
            searchRetries,
            searchRetryDelayMs
          )
        : Promise.resolve(null),
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
    const dynamicItems = [...(dynamicResult?.items || []), ...(semanticResult?.items || [])].filter((item) =>
      dynamicItemWithinFreshnessWindow(item, effectiveCategory, nowSeconds)
    );
    const pinnedItems = Array.isArray(pinnedResult?.items) ? pinnedResult.items : [];
    const dynamicIds = Array.from(new Set(dynamicItems.map(immutableId).filter(Boolean)));
    const pinnedByClaimId = new Map(
      pinnedItems
        .map((item) => [String(item.claim_id || item['claim-id'] || ''), immutableId(item)])
        .filter(([claimId, id]) => claimId && id)
    );
    const pinnedIds = stringList(job.category.pinnedClaimIds).map((claimId) => pinnedByClaimId.get(claimId));
    const signingChannelByMediaId = new Map(
      [...dynamicItems, ...pinnedItems]
        .map((item) => [immutableId(item), signingChannelId(item)])
        .filter(([mediaId, channelClaimId]) => mediaId && channelClaimId)
    );
    const sourceLocatorById = new Map(
      [...dynamicItems, ...pinnedItems]
        .map((item) => [immutableId(item), sourceLocator(item)])
        .filter(([id, locator]) => id && locator)
    );

    return {
      ...job,
      selectedIds: mergePinnedIds(dynamicIds, pinnedIds, pageSize * CATEGORY_CANDIDATE_MULTIPLIER * candidatePageCount),
      pageSize,
      signingChannelByMediaId,
      sourceLocatorById,
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
  const bannerLocatorById = new Map(
    bannerUris
      .map((uri) => [immutableId(bannerClaims?.[uri]), sourceLocator(bannerClaims?.[uri])])
      .filter(([id, locator]) => id && locator)
  );
  const unresolvedBannerUris = bannerUris.filter((uri) => !bannerIdsByUri.has(uri));
  if (unresolvedBannerUris.length) {
    throw new Error(`Failed to resolve ${unresolvedBannerUris.length} homepage banners`);
  }
  const bannerIds = Array.from(new Set(bannerIdsByUri.values()));
  const channelClaimIds = Array.from(
    new Set(
      selections.flatMap((selection) =>
        selection.selectedIds.map((mediaId) => selection.signingChannelByMediaId.get(mediaId)).filter(Boolean)
      )
    )
  );
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
  const channelLocatorById = new Map(
    channelItems.map((item) => [immutableId(item), sourceLocator(item)]).filter(([id, locator]) => id && locator)
  );
  selections.forEach((selection) => {
    selection.selectedIds = selection.selectedIds.filter((mediaId) => {
      const channelClaimId = selection.signingChannelByMediaId.get(mediaId);
      return !channelClaimId || channelIdsByClaimId.has(channelClaimId);
    });
    selection.expectedSize = selection.pageSize;
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
  const mediaLocatorById = new Map(selections.flatMap((selection) => Array.from(selection.sourceLocatorById)));
  const channelLocatorByWarmId = new Map([...channelLocatorById, ...bannerLocatorById]);
  const allWarmIds = [...selectedIds, ...channelWarmIds];
  const locatorByWarmId = new Map([...mediaLocatorById, ...channelLocatorByWarmId]);
  const importLocators = Array.from(new Set(allWarmIds.map((id) => locatorByWarmId.get(id)).filter(isOutpointId)));
  const importedLocators = new Set(
    await importOutpoints(importLocators, queueImports, importRetries, importRetryDelayMs)
  );
  const importedIds = new Set(allWarmIds.filter((id) => importedLocators.has(locatorByWarmId.get(id))));
  const sourceBackedIds = new Set(allWarmIds.filter((id) => isOutpointId(locatorByWarmId.get(id))));
  const failedImportIds = new Set(Array.from(sourceBackedIds).filter((id) => !importedIds.has(id)));
  const probeIds = allWarmIds.filter((id) => !sourceBackedIds.has(id));
  const initialWarmResults = [
    ...Array.from(importedIds, (id) => [id, true]),
    ...Array.from(failedImportIds, (id) => [id, false]),
    ...(await warmObjectBatches(probeIds, warmMany, locatorByWarmId)),
  ];
  const initialWarmById = new Map(initialWarmResults);
  const initialMediaWarmResults = selectedIds.map((id) => [id, initialWarmById.get(id) === true]);
  const initialChannelWarmResults = channelWarmIds.map((id) => [id, initialWarmById.get(id) === true]);
  const missingMediaIds = initialMediaWarmResults.filter(([, ok]) => !ok).map(([id]) => id);
  const missingChannelIds = initialChannelWarmResults.filter(([, ok]) => !ok).map(([id]) => id);
  const retriedWarmResults = await retryWarmObjects(
    [...missingMediaIds, ...missingChannelIds].filter((id) => !sourceBackedIds.has(id)),
    warmMany,
    warmRetries,
    warmRetryDelayMs,
    locatorByWarmId
  );
  const retriedWarmById = new Map(retriedWarmResults);
  const retriedMediaWarmResults = missingMediaIds.map((id) => [id, retriedWarmById.get(id) === true]);
  const retriedChannelWarmResults = missingChannelIds.map((id) => [id, retriedWarmById.get(id) === true]);
  const mediaWarmResults = [...initialMediaWarmResults.filter(([, ok]) => ok), ...retriedMediaWarmResults];
  const channelWarmResults = [...initialChannelWarmResults.filter(([, ok]) => ok), ...retriedChannelWarmResults];
  const warmedMedia = new Set(mediaWarmResults.filter(([, ok]) => ok).map(([id]) => id));
  const warmedChannels = new Set(channelWarmResults.filter(([, ok]) => ok).map(([id]) => id));
  const failedBannerIds = bannerIds.filter((id) => !warmedChannels.has(id));
  if (failedBannerIds.length) {
    throw new Error(
      `Failed to cache ${failedBannerIds.length} homepage banners in HyperBEAM: ${failedBannerIds
        .slice(0, 5)
        .join(', ')}`
    );
  }

  selections.forEach((selection) => {
    selection.poolIds = selection.selectedIds.filter((mediaId) => {
      if (!warmedMedia.has(mediaId)) return false;
      const channelClaimId = selection.signingChannelByMediaId.get(mediaId);
      if (!channelClaimId) return true;
      const channelId = channelIdsByClaimId.get(channelClaimId);
      return Boolean(channelId && warmedChannels.has(channelId));
    });
    selection.selectedIds = selection.poolIds.slice(0, selection.pageSize);
  });
  const incompleteSelections = selections.filter((selection) => selection.selectedIds.length < selection.expectedSize);
  if (incompleteSelections.length) {
    if (candidateExpansionRound < candidateExpansionRounds) {
      const expandedPageCounts = new Map(candidatePageCounts);
      const expandedFreshnessMultipliers = new Map(freshnessMultipliers);
      const expandedSemanticFallbacks = new Set(semanticFallbacks);
      incompleteSelections.forEach((selection) => {
        const selectionKey = `${selection.locale}/${selection.categoryId}`;
        const currentPageCount = expandedPageCounts.get(selectionKey) || 1;
        expandedPageCounts.set(selectionKey, currentPageCount * 2);
        const currentFreshnessMultiplier = expandedFreshnessMultipliers.get(selectionKey) || 1;
        expandedFreshnessMultipliers.set(selectionKey, currentFreshnessMultiplier * 2);
        if (candidateExpansionRound + 1 === candidateExpansionRounds) {
          expandedSemanticFallbacks.add(selectionKey);
        }
      });
      return materializeHomepageData(homepageData, {
        ...dependencies,
        candidatePageCounts: expandedPageCounts,
        freshnessMultipliers: expandedFreshnessMultipliers,
        semanticFallbacks: expandedSemanticFallbacks,
        candidateExpansionRound: candidateExpansionRound + 1,
      });
    }
    const failedEntries = incompleteSelections.reduce(
      (count, selection) => count + selection.expectedSize - selection.selectedIds.length,
      0
    );
    const incompleteCategories = incompleteSelections
      .map(
        (selection) =>
          `${selection.locale}/${selection.categoryId} (${selection.selectedIds.length}/${selection.expectedSize})`
      )
      .join(', ');
    throw new Error(
      `Failed to cache ${failedEntries} homepage objects in HyperBEAM across ` +
        `${incompleteSelections.length} categories: ${incompleteCategories}`
    );
  }
  const materialized = structuredClone(homepageData || {});

  selections.forEach(({ locale, categoryId, selectedIds: ids, poolIds, signingChannelByMediaId, pageSize }) => {
    materialized[locale].categories[categoryId].immutableIds = ids;
    materialized[locale].categories[categoryId].immutablePoolIds = poolIds.slice(
      0,
      pageSize * CATEGORY_CANDIDATE_MULTIPLIER
    );
    materialized[locale].categories[categoryId].immutableSigningChannelIds = Object.fromEntries(
      materialized[locale].categories[categoryId].immutablePoolIds
        .map((mediaId) => [mediaId, channelIdsByClaimId.get(signingChannelByMediaId.get(mediaId))])
        .filter(([, channelId]) => channelId)
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

function warmObjects(ids, concurrency, warm, retries, retryDelayMs, locatorById = new Map()) {
  return mapWithConcurrency(ids, concurrency, async (id) => {
    const locator = locatorById.get(id) || id;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (await warm(id, locator).catch(() => false)) return [id, true];
      if (attempt < retries && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
    return [id, false];
  });
}

async function warmObjectBatches(ids, warmMany, locatorById = new Map()) {
  const results = [];
  for (const batch of chunk(ids, IMMUTABLE_BATCH_SIZE)) {
    const batchResults = await warmMany(batch, locatorById).catch(() => []);
    const warmedById = new Map(batchResults);
    results.push(...batch.map((id) => [id, warmedById.get(id) === true]));
  }
  return results;
}

async function importOutpoints(locators, queueImports, retries, retryDelayMs) {
  let unresolved = Array.from(new Set(locators));
  const imported = new Set();

  for (let attempt = 0; attempt <= retries && unresolved.length; attempt += 1) {
    const results = (
      await mapWithConcurrency(chunk(unresolved, RESOLVE_BATCH_SIZE), QUERY_CONCURRENCY, queueImports)
    ).flat();
    results.forEach((locator) => {
      if (unresolved.includes(locator)) imported.add(locator);
    });
    unresolved = unresolved.filter((locator) => !imported.has(locator));
    if (unresolved.length && attempt < retries && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }

  return Array.from(imported);
}

async function retryWarmObjects(ids, warmMany, retries, retryDelayMs, locatorById = new Map()) {
  let unresolved = Array.from(ids);
  const warmed = new Set();

  for (let attempt = 0; attempt <= retries && unresolved.length; attempt += 1) {
    const results = await warmObjectBatches(unresolved, warmMany, locatorById);
    results.forEach(([id, ok]) => {
      if (ok) warmed.add(id);
    });
    unresolved = unresolved.filter((id) => !warmed.has(id));
    if (unresolved.length && attempt < retries && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }

  return ids.map((id) => [id, warmed.has(id)]);
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

async function searchCandidatePages(search, params, pageSize, pageCount, retries, retryDelayMs) {
  const items = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const result = await searchWithRetry(search, { ...params, page, page_size: pageSize }, retries, retryDelayMs);
    const pageItems = Array.isArray(result?.items) ? result.items : [];
    items.push(...pageItems);
    if (pageItems.length < pageSize) break;
  }
  return { items };
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
  nativeIdFromLocator,
  materializeHomepageData,
  mergePinnedIds,
  readHomepageSnapshot,
  writeHomepageSnapshot,
};
