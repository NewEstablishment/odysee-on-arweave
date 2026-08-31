export type HyperbeamSearchRequest = {
  limit: number;
  offset?: number;
  filter?: string | Array<string>;
  sort?: Array<string>;
};

const MEDIA_TYPES = ['audio', 'video', 'text', 'image', 'application'];
const CLAIM_TYPE = 'claimType';
const INCLUDE_MATURE = 'nsfw';
const PRICE_FILTER_FREE = 'free_only';
const LANGUAGE = 'language';
const TIME_FILTER = 'time_filter';
const MIN_DURATION = 'min_duration';
const MAX_DURATION = 'max_duration';
const SORT = 'sort_by';
const RELATED_TO = 'related_to';

export function hyperbeamSearchRequest(
  options: Record<string, any>,
  offset: number,
  limit: number,
  nowSeconds = Math.floor(Date.now() / 1000)
): HyperbeamSearchRequest {
  const filter: Array<string> = [];
  const claimTypes = normalizedClaimTypes(options[CLAIM_TYPE]);
  if (claimTypes.length && claimTypes.length < 3) filter.push(inFilter('claim_type', claimTypes));

  const mediaTypes = MEDIA_TYPES.filter((mediaType) => Boolean(options[mediaType]));
  if (mediaTypes.length && mediaTypes.length < MEDIA_TYPES.length) filter.push(inFilter('media_type', mediaTypes));

  if (options[INCLUDE_MATURE] === false) filter.push('nsfw = 0');
  if (options[PRICE_FILTER_FREE]) filter.push('fee = 0');

  const relatedClaimId = String(options[RELATED_TO] || '').trim();
  if (relatedClaimId) filter.push(`claim_id != ${JSON.stringify(relatedClaimId)}`);

  const language = String(options[LANGUAGE] || '').trim();
  if (language) filter.push(equalityFilter('language', language));

  const earliest = earliestReleaseTime(options[TIME_FILTER], nowSeconds);
  if (earliest) filter.push(`release_time >= ${earliest}`);

  const minDuration = positiveNumber(options[MIN_DURATION]);
  const maxDuration = positiveNumber(options[MAX_DURATION]);
  if (minDuration) filter.push(`duration >= ${Math.floor(minDuration * 60)}`);
  if (maxDuration) filter.push(`duration <= ${Math.floor(maxDuration * 60)}`);

  const sort = searchSort(options[SORT]);
  return compactRequest({ limit, offset, filter, sort });
}

export function hyperbeamChannelSearchRequest(params: {
  channelId: string;
  showMature?: boolean | null;
  mediaType?: string | null;
  earliestReleaseTime?: number | null;
  minDuration?: number | null;
  maxDuration?: number | null;
  sortField?: string | null;
  sortAscending?: boolean;
  offset: number;
  limit: number;
}): HyperbeamSearchRequest {
  const filter = [equalityFilter('channel_claim_id', params.channelId)];
  if (!params.showMature) filter.push('nsfw = 0');
  if (params.mediaType) filter.push(equalityFilter('media_type', params.mediaType));
  if (positiveNumber(params.earliestReleaseTime)) {
    filter.push(`release_time >= ${Math.floor(Number(params.earliestReleaseTime))}`);
  }
  if (positiveNumber(params.minDuration)) filter.push(`duration >= ${Math.floor(Number(params.minDuration))}`);
  if (positiveNumber(params.maxDuration)) filter.push(`duration <= ${Math.floor(Number(params.maxDuration))}`);

  const sortField = ['release_time', 'effective_amount'].includes(String(params.sortField || ''))
    ? String(params.sortField)
    : '';
  const sort = sortField ? [`${sortField}:${params.sortAscending ? 'asc' : 'desc'}`] : [];
  return compactRequest({ limit: params.limit, offset: params.offset, filter, sort });
}

export function hyperbeamClaimSearchRequest(
  options: Record<string, any>,
  offset: number,
  limit: number
): HyperbeamSearchRequest {
  const filter: Array<string> = [];
  const claimTypes = normalizedClaimTypes(options.claim_type || options.claimType);
  if (claimTypes.length) filter.push(inFilter('claim_type', claimTypes));

  if (options.nsfw !== true) filter.push('nsfw = 0');

  const languages = stringList(options.any_languages || options.language);
  if (languages.length) filter.push(inFilter('language', languages));

  const channelIds = stringList(options.channel_ids || options.channelIds);
  if (channelIds.length) filter.push(inFilter('channel_claim_id', channelIds));

  const releaseTime = numericComparison('release_time', options.release_time);
  const timestamp = numericComparison('release_time', options.timestamp);
  if (releaseTime) filter.push(releaseTime);
  if (timestamp) filter.push(timestamp);

  const sort = claimSearchSort(options.order_by);
  return compactRequest({ limit, offset, filter, sort });
}

export function earliestReleaseTime(timeFilter: any, nowSeconds: number): number | null {
  const seconds = {
    lasthour: 60 * 60,
    today: 24 * 60 * 60,
    thisweek: 7 * 24 * 60 * 60,
    thismonth: 30 * 24 * 60 * 60,
    thisyear: 365 * 24 * 60 * 60,
  }[String(timeFilter || '')];
  return seconds ? Math.max(0, Math.floor(nowSeconds - seconds)) : null;
}

function normalizedClaimTypes(value: any): Array<string> {
  const requested = stringList(value);
  const mapped = requested.flatMap((item) => (item === 'file' ? ['stream', 'repost'] : [item]));
  return Array.from(new Set(mapped.filter((item) => ['stream', 'repost', 'channel'].includes(item))));
}

function claimSearchSort(value: any): Array<string> {
  const [field] = stringList(value);
  if (field === '^release_time') return ['release_time:asc'];
  return ['release_time:desc'];
}

function numericComparison(field: string, value: any): string | null {
  const match = String(value || '')
    .trim()
    .match(/^(<=|>=|<|>)?\s*(\d+)$/);
  if (!match) return null;
  return `${field} ${match[1] || '='} ${Number(match[2])}`;
}

function stringList(value: any): Array<string> {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return source
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);
}

function searchSort(value: any): Array<string> {
  if (value === '^release_time') return ['release_time:asc'];
  if (value === 'release_time') return ['release_time:desc'];
  return [];
}

function equalityFilter(field: string, value: string): string {
  return `${field} = ${JSON.stringify(value)}`;
}

function inFilter(field: string, values: Array<string>): string {
  return `${field} IN [${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

function positiveNumber(value: any): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function compactRequest(request: {
  limit: number;
  offset: number;
  filter: Array<string>;
  sort: Array<string>;
}): HyperbeamSearchRequest {
  return {
    limit: Math.max(1, Math.floor(Number(request.limit) || 20)),
    ...(request.offset > 0 ? { offset: Math.floor(request.offset) } : {}),
    ...(request.filter.length ? { filter: request.filter } : {}),
    ...(request.sort.length ? { sort: request.sort } : {}),
  };
}
