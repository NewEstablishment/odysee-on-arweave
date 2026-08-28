import { fetchHyperbeamNodeAddress, fetchHyperbeamQueryPaths, fetchVerifiedNativeMessage } from 'util/hyperbeam';
import * as ICONS from 'constants/icons';

export const HOMEPAGE_SNAPSHOT_SCHEMA = 'odysee-homepage@1.0';
export const HOMEPAGE_SNAPSHOT_TYPE = 'homepage-snapshot';
const SNAPSHOT_LOOKBACK_HOURS = 24;
const READ_CONCURRENCY = 4;
const DEFAULT_CATEGORY_PAGE_SIZE = 12;

type HomepageSnapshot = {
  schema: typeof HOMEPAGE_SNAPSHOT_SCHEMA;
  type: typeof HOMEPAGE_SNAPSHOT_TYPE;
  language: string;
  'epoch-hour': number;
  'created-at': number;
  'content-hash': string;
  'category-count'?: number;
  complete?: boolean;
  homepage: Record<string, any>;
};

export async function fetchHomepageSnapshot(language: string): Promise<HomepageSnapshot | null> {
  const expectedOwner = await fetchHyperbeamNodeAddress();
  if (!expectedOwner) return null;

  const nowHour = Math.floor(Date.now() / 3_600_000);
  for (let age = 0; age < SNAPSHOT_LOOKBACK_HOURS; age += 1) {
    const paths = await fetchHyperbeamQueryPaths({
      schema: HOMEPAGE_SNAPSHOT_SCHEMA,
      type: HOMEPAGE_SNAPSHOT_TYPE,
      language,
      'epoch-hour': nowHour - age,
      complete: true,
    });
    const candidates = (
      await mapWithConcurrency(paths, READ_CONCURRENCY, (path) => fetchVerifiedNativeMessage<HomepageSnapshot>(path))
    )
      .filter((candidate) => candidate?.owner === expectedOwner)
      .map((candidate) => normalizeHomepageSnapshot(candidate.payload))
      .filter((payload) => isHomepageSnapshot(payload, language, nowHour - age))
      .sort(compareSnapshots);
    if (candidates.length) return candidates[0];
  }
  return null;
}

function normalizeHomepageSnapshot(snapshot: HomepageSnapshot): HomepageSnapshot {
  if (!snapshot?.homepage || typeof snapshot.homepage !== 'object') return snapshot;

  const homepage = snapshot.homepage;
  const categories = Object.fromEntries(
    Object.entries(homepage.categories || {}).map(([key, category]) => [key, normalizeHomepageCategory(category)])
  );
  const featured = normalizeHomepageFeatured(homepage.featured);

  return {
    ...snapshot,
    homepage: {
      ...homepage,
      categories,
      ...(featured ? { featured } : {}),
    },
  };
}

function normalizeHomepageCategory(category: any): any {
  if (!category || typeof category !== 'object') return category;

  const snapshotImmutableIds = arrayValue(category, 'immutableIds', 'immutableids');
  const immutablePoolIds = arrayValue(category, 'immutablePoolIds', 'immutablepoolids');
  const pageSize = numberValue(category, 'pageSize', 'pagesize') || DEFAULT_CATEGORY_PAGE_SIZE;
  const immutableIds =
    immutablePoolIds && (snapshotImmutableIds?.length || 0) < pageSize
      ? immutablePoolIds.slice(0, pageSize)
      : snapshotImmutableIds;
  const allMediaIds = Array.from(new Set([...(immutablePoolIds || []), ...(immutableIds || [])]));

  return {
    ...category,
    pageSize,
    sortOrder: numberValue(category, 'sortOrder', 'sortorder'),
    immutableIds,
    immutablePoolIds,
    immutableSigningChannelIds: restoreCaseSensitiveMap(
      objectValue(category, 'immutableSigningChannelIds', 'immutablesigningchannelids'),
      allMediaIds
    ),
  };
}

function normalizeHomepageFeatured(featured: any): any {
  if (!featured || typeof featured !== 'object') return featured;

  return {
    ...featured,
    transitionTime: numberValue(featured, 'transitionTime', 'transitiontime'),
    items: Array.isArray(featured.items)
      ? featured.items.map((item) => {
          const immutableIds = arrayValue(item, 'immutableIds', 'immutableids');
          return {
            ...item,
            immutableId: stringValue(item, 'immutableId', 'immutableid'),
            immutableIds,
            immutableSigningChannelIds: restoreCaseSensitiveMap(
              objectValue(item, 'immutableSigningChannelIds', 'immutablesigningchannelids'),
              immutableIds || []
            ),
          };
        })
      : [],
  };
}

function restoreCaseSensitiveMap(mapping: any, canonicalIds: Array<string>): Record<string, string> {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return {};

  const valuesByLowercaseId = new Map(
    Object.entries(mapping)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([id, value]) => [id.toLowerCase(), value])
  );
  return Object.fromEntries(
    canonicalIds
      .map((id) => [id, valuesByLowercaseId.get(id.toLowerCase())] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  );
}

function arrayValue(value: any, canonical: string, normalized: string): Array<string> | undefined {
  const result = value?.[canonical] ?? value?.[normalized];
  return Array.isArray(result) ? result.map(String) : undefined;
}

function objectValue(value: any, canonical: string, normalized: string): Record<string, unknown> | undefined {
  const result = value?.[canonical] ?? value?.[normalized];
  return result && typeof result === 'object' && !Array.isArray(result) ? result : undefined;
}

function numberValue(value: any, canonical: string, normalized: string): number | undefined {
  const result = Number(value?.[canonical] ?? value?.[normalized]);
  return Number.isFinite(result) ? result : undefined;
}

function stringValue(value: any, canonical: string, normalized: string): string | undefined {
  const result = value?.[canonical] ?? value?.[normalized];
  return typeof result === 'string' ? result : undefined;
}

export function mergeHomepageSnapshot(
  configuredHomepage: Record<string, any> | null | undefined,
  snapshot: HomepageSnapshot | null
): Record<string, any> | null {
  if (!configuredHomepage && !snapshot) return null;
  if (!snapshot) return configuredHomepage || null;

  const generated = snapshot.homepage;
  return {
    ...configuredHomepage,
    ...generated,
    categories: generated.categories,
  };
}

export function withLocalContentCategory(homepage: Record<string, any> | null): Record<string, any> | null {
  if (!homepage) return null;
  const categories = homepage.categories || {};
  return {
    ...homepage,
    categories: {
      LOCAL_CONTENT: {
        name: 'local-content',
        label: 'Local content',
        icon: ICONS.LOCAL_CONTENT,
        sortOrder: -1,
        pageSize: 12,
        claimType: ['stream', 'repost'],
        order: 'new',
        excludeFuture: true,
      },
      ...categories,
    },
  };
}

export function isHomepageSnapshot(payload: any, language: string, epochHour?: number): payload is HomepageSnapshot {
  return Boolean(
    payload &&
    payload.schema === HOMEPAGE_SNAPSHOT_SCHEMA &&
    payload.type === HOMEPAGE_SNAPSHOT_TYPE &&
    payload.language === language &&
    Number.isSafeInteger(Number(payload['epoch-hour'])) &&
    (epochHour === undefined || Number(payload['epoch-hour']) === epochHour) &&
    Number.isFinite(Number(payload['created-at'])) &&
    payload.complete === true &&
    typeof payload['content-hash'] === 'string' &&
    payload['content-hash'].length > 0 &&
    payload.homepage &&
    typeof payload.homepage === 'object' &&
    payload.homepage.categories &&
    typeof payload.homepage.categories === 'object'
  );
}

function compareSnapshots(left: HomepageSnapshot, right: HomepageSnapshot): number {
  const completeDelta = Number(right.complete === true) - Number(left.complete === true);
  if (completeDelta) return completeDelta;

  const categoryDelta = snapshotCategoryCount(right) - snapshotCategoryCount(left);
  if (categoryDelta) return categoryDelta;
  return right['created-at'] - left['created-at'];
}

function snapshotCategoryCount(snapshot: HomepageSnapshot): number {
  const declared = Number(snapshot['category-count']);
  if (Number.isSafeInteger(declared) && declared >= 0) return declared;
  return Object.keys(snapshot.homepage?.categories || {}).length;
}

async function mapWithConcurrency<T, R>(
  values: Array<T>,
  concurrency: number,
  worker: (value: T) => Promise<R>
): Promise<Array<R>> {
  const results: Array<R> = Array.from({ length: values.length });
  let cursor = 0;
  const workers = Array.from({ length: Math.min(values.length, concurrency) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
