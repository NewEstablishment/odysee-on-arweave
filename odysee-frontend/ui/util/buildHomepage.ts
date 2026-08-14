import * as PAGES from 'constants/pages';
import * as ICONS from 'constants/icons';
import * as CS from 'constants/claim_search';
import { toCapitalCase } from 'util/string';
import { hyperbeamImmutableUri } from 'util/hyperbeam-route';
export type HomepageCat = {
  id?: string;
  name: string;
  icon: string;
  label: string;
  title: string;
  link: string;
  route: string | null | undefined;
  channelIds?: Array<string>;
  daysOfContent?: number;
  channelLimit?: string;
  pageSize?: number;
  claimType?: string;
  order?: string;
  tags?: Array<string>;
  pinnedUrls?: Array<string>;
  pinnedClaimIds?: Array<string>;
  // takes precedence over pinnedUrls
  hideSort?: boolean;
  excludedChannelIds?: Array<string>;
  searchLanguages?: Array<string>;
  duration?: string;
  exclude_shorts?: boolean;
  mixIn?: Array<string>;
  hideByDefault?: boolean;
  immutableIds?: Array<string>;
  immutablePoolIds?: Array<string>;
  immutableChannelIds?: Array<string>;
  immutableSigningChannelIds?: Record<string, string>;
  unresolvedChannelIds?: Array<string>;
};

function getLimitPerChannel(size, isChannel) {
  if (isChannel) {
    return 1;
  } else {
    return size < 250 ? (size < 150 ? 3 : 2) : 1;
  }
}

type RelativeTimeUnit = 'day' | 'days' | 'month' | 'months' | 'year' | 'years';
type TimeBoundary = 'day' | 'hour' | 'week';

function getRelativeUnixTimestamp(amount: number, unit: RelativeTimeUnit, boundary: TimeBoundary) {
  const date = new Date();

  if (unit === 'day' || unit === 'days') {
    date.setDate(date.getDate() - amount);
  } else if (unit === 'month' || unit === 'months') {
    date.setMonth(date.getMonth() - amount);
  } else if (unit === 'year' || unit === 'years') {
    date.setFullYear(date.getFullYear() - amount);
  }

  if (boundary === 'hour') {
    date.setMinutes(0, 0, 0);
  } else {
    date.setHours(0, 0, 0, 0);

    if (boundary === 'week') {
      date.setDate(date.getDate() - date.getDay());
    }
  }

  return Math.floor(date.getTime() / 1000);
}

export function getAllIds(all: any) {
  const idsSet: Set<string> = new Set();
  (Object.values(all) as any).forEach((cat) => {
    const ids = cat?.channelIds || cat?.ids;

    if (ids && ids.length) {
      ids.forEach((id) => idsSet.add(id));
    }
  });
  return Array.from(idsSet);
}
export const getHomepageRowForCat = (key: string, cat: HomepageCat) => {
  let orderValue;

  switch (cat.order) {
    case 'trending':
      orderValue = CS.ORDER_BY_TRENDING;
      break;

    case 'top':
      orderValue = CS.ORDER_BY_TOP;
      break;

    case 'new':
      orderValue = CS.ORDER_BY_NEW;
      break;

    default:
      orderValue = CS.ORDER_BY_TRENDING;
  }

  let urlParams = new URLSearchParams();

  if (cat.claimType) {
    urlParams.set(CS.CLAIM_TYPE, cat.claimType);
  }

  const channelIds = cat.channelIds;

  if (channelIds) {
    urlParams.set(CS.CHANNEL_IDS_KEY, channelIds.join(','));
  }

  const isChannelType = cat.claimType && cat.claimType === 'channel';
  // can intend no limit, numerica auto limit, specific limit.
  let limitClaims;

  if (typeof cat.channelLimit === 'string' && cat.channelIds && cat.channelIds.length) {
    if (cat.channelLimit === 'auto') {
      limitClaims = getLimitPerChannel(cat.channelIds.length, isChannelType);
    } else if (cat.channelLimit) {
      const limitNumber = Number(cat.channelLimit);

      // eslint-disable-next-line
      if (limitNumber === limitNumber && limitNumber !== 0) {
        // because javascript and NaN !== NaN
        limitClaims = Math.floor(limitNumber);
      }
    }
  } else if (typeof cat.channelLimit === 'string' && cat.channelLimit) {
    const limitNumber = Number(cat.channelLimit);

    // eslint-disable-next-line
    if (limitNumber === limitNumber && limitNumber !== 0) {
      // because javascript and NaN !== NaN
      limitClaims = Math.floor(limitNumber);
    }
  }

  return {
    id: key,
    link: `/$/${PAGES.DISCOVER}?${urlParams.toString()}`,
    route: cat.name ? `/$/${cat.name}` : undefined,
    icon: cat.icon || '',
    // some default
    title: cat.label,
    pinnedUrls: cat.pinnedUrls,
    pinnedClaimIds: cat.pinnedClaimIds,
    uris: (cat.immutableIds || []).map(hyperbeamImmutableUri).filter((uri): uri is string => Boolean(uri)),
    categoryUris: (cat.immutablePoolIds || cat.immutableIds || [])
      .map(hyperbeamImmutableUri)
      .filter((uri): uri is string => Boolean(uri)),
    immutableSigningChannelIds: Object.fromEntries(
      Object.entries(cat.immutableSigningChannelIds || {}).map(([mediaId, channelId]) => [
        hyperbeamImmutableUri(mediaId) || mediaId,
        channelId,
      ])
    ),
    hideByDefault: cat.hideByDefault,
    hideSort: cat.hideSort,
    options: {
      claimType: cat.claimType || ['stream', 'repost'],
      channelIds,
      excludedChannelIds: cat.excludedChannelIds,
      orderBy: orderValue,
      pageSize: cat.pageSize || undefined,
      limitClaimsPerChannel: limitClaims,
      searchLanguages: cat.searchLanguages,
      duration: cat.duration || undefined,
      excludeShorts: cat.exclude_shorts ? true : undefined,
      releaseTime: `>${getRelativeUnixTimestamp(cat.daysOfContent || 30, 'days', 'hour')}`,
    },
  };
};
export function GetLinksData(
  all: any, // HomepageData type?
  isSmallScreen: boolean,
  isMediumScreen: boolean,
  isLargeScreen: boolean,
  isHomepage?: boolean,
  authenticated?: boolean,
  showPersonalizedChannels?: boolean,
  showPersonalizedTags?: boolean,
  subscribedChannelIds?: Array<ClaimId>,
  followedTags?: Array<Tag>,
  showIndividualTags?: boolean,
  showNsfw?: boolean
) {
  function getPageSize(originalSize, following?) {
    if (following) {
      return isLargeScreen ? originalSize * (3 / 2) : isMediumScreen ? 8 : isSmallScreen ? 6 : originalSize;
    }

    return isLargeScreen ? originalSize * (3 / 2) : originalSize;
  }

  let rowData: Array<RowDataItem> = [];
  const individualTagDataItems: Array<RowDataItem> = [];

  if (isHomepage && showPersonalizedChannels && subscribedChannelIds) {
    const RECENT_FROM_FOLLOWING = {
      id: 'FOLLOWING',
      title: __('Recent From Following'),
      link: `/$/${PAGES.CHANNELS_FOLLOWING}`,
      icon: ICONS.SUBSCRIBE,
      hideSort: false,
      options: {
        orderBy: CS.ORDER_BY_NEW,
        claimType: ['stream', 'repost'],
        releaseTime:
          subscribedChannelIds.length > 20
            ? `>${getRelativeUnixTimestamp(9, 'months', 'week')}`
            : `>${getRelativeUnixTimestamp(1, 'year', 'week')}`,
        pageSize: getPageSize(subscribedChannelIds.length > 3 ? (subscribedChannelIds.length > 6 ? 12 : 8) : 4, true),
        streamTypes: null,
        channelIds: subscribedChannelIds,
      },
    };
    rowData.push(RECENT_FROM_FOLLOWING); // const SHORTS_SECTION = {
    //   id: 'SHORTS',
    //   title: __('Shorts'),
    //   route: `/$/${PAGES.DISCOVER}?t=shorts`,
    //   icon: ICONS.VIDEO,
    //   hideSort: false,
    //   options: {
    //     claimType: ['stream'],
    //     orderBy: CS.ORDER_BY_NEW,
    //     pageSize: getPageSize(24),
    //     limitClaimsPerChannel: 1,
    //     releaseTime: `>${Math.floor(dayjs().subtract(1, 'months').startOf('week').unix())}`,
    //     duration: '<=180',
    //     excludeShorts: false,
    //     // channelIds: subscribedChannelIds,
    //   },
    // };
    // rowData.push(SHORTS_SECTION);
  }

  if (isHomepage && authenticated) {
    const WATCH_LATER_SECTION = {
      id: 'WATCH_LATER',
      title: __('Watch Later'),
      link: `/$/${PAGES.PLAYLIST}/watchlater`,
      icon: ICONS.TIME,
      hideSort: false,
      hideByDefault: true,
      options: {
        pageSize: getPageSize(8),
      },
    };
    rowData.push(WATCH_LATER_SECTION);
  }

  if (isHomepage) {
    if (followedTags) {
      const TRENDING_FOR_TAGS = {
        title: __('Trending For Your Tags'),
        link: `/$/${PAGES.TAGS_FOLLOWING}`,
        icon: ICONS.TAG,
        hideSort: false,
        options: {
          pageSize: getPageSize(4),
          orderBy: CS.ORDER_BY_NEW,
          tags: followedTags.map((tag) => tag.name),
          claimType: ['stream'],
          limitClaimsPerChannel: 2,
        },
      };
      followedTags.forEach((tag: Tag) => {
        const tagName = `#${toCapitalCase(tag.name)}`;
        individualTagDataItems.push({
          id: tagName,
          title: __('Trending for %tagName%', {
            tagName: tagName,
          }),
          link: `/$/${PAGES.DISCOVER}?t=${tag.name}`,
          options: {
            pageSize: 4,
            tags: [tag.name],
            claimType: ['stream'],
          },
        });
      });
      if (showPersonalizedTags && !showIndividualTags) rowData.push(TRENDING_FOR_TAGS);

      if (showPersonalizedTags && showIndividualTags) {
        individualTagDataItems.forEach((item: RowDataItem) => {
          rowData.push(item);
        });
      }
    }
  }

  // **************************************************************************
  const { categories } = all;
  const entries = Object.entries(categories || []);

  for (let i = 0; i < entries.length; ++i) {
    const key = entries[i][0];
    const val = entries[i][1];
    rowData.push(getHomepageRowForCat(key, val as HomepageCat));
  }

  return rowData;
}
export type HomepageTitles =
  | 'Recent From Following'
  | 'Featured'
  | 'Discover'
  | 'Pop Culture'
  | 'Artists'
  | 'Education'
  | 'Lifestyle'
  | 'Gaming'
  | 'Spooky'
  | 'Tech'
  | 'Comedy'
  | 'Music'
  | 'Sports'
  | 'Finance 2.0'
  | 'Shorts';
