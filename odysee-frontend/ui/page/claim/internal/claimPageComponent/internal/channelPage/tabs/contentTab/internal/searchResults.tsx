import React from 'react';
import ClaimList from 'component/claimList';
import { DEBOUNCE_WAIT_DURATION_MS, SEARCH_OPTIONS } from 'constants/search';
import * as CS from 'constants/claim_search';
import { fetchSearchIds } from 'util/hyperbeam';
import { hyperbeamImmutableUri } from 'util/hyperbeam-route';
import { normalizeURI } from 'util/lbryURI';
type Props = {
  searchQuery: string;
  claimId: string | null | undefined;
  showMature: boolean | null | undefined;
  tileLayout: boolean;
  orderBy?: string | null | undefined;
  sortByParam?: string | null | undefined;
  hideShorts?: boolean;
  minDuration?: number | null | undefined;
  maxDuration?: number | null | undefined;
  maxAspectRatio?: number;
  contentType?: string | null | undefined;
  freshness?: string | null | undefined;
  durationParam?: string | null | undefined;
  customMinMinutes?: number | null | undefined;
  customMaxMinutes?: number | null | undefined;
  onResults?: (results: Array<string> | null | undefined) => void;
  doResolveUris: (arg0: Array<string>, arg1?: boolean) => any;
};
export function SearchResults(props: Props) {
  const {
    searchQuery,
    claimId,
    showMature,
    tileLayout,
    orderBy,
    hideShorts,
    minDuration,
    onResults,
    doResolveUris,
    maxDuration,
    maxAspectRatio,
    contentType,
    freshness,
    sortByParam,
    durationParam,
    customMinMinutes,
    customMaxMinutes,
  } = props;
  const SEARCH_PAGE_SIZE = 24;
  const [page, setPage] = React.useState(1);
  const [searchResults, setSearchResults] = React.useState(undefined);
  const [isSearchingState, setIsSearchingState] = React.useState(false);
  const isSearching = React.useRef(false);
  const noMoreResults = React.useRef(false);
  // Map contentType from ClaimListDiscover to the search service mediaType param
  const mediaTypeParam = React.useMemo(() => {
    if (!contentType || contentType === CS.CONTENT_ALL) return '';
    // Map claim_search file types to the search service media types
    const typeMap = {
      [CS.FILE_VIDEO]: SEARCH_OPTIONS.MEDIA_VIDEO,
      [CS.FILE_AUDIO]: SEARCH_OPTIONS.MEDIA_AUDIO,
      [CS.FILE_IMAGE]: SEARCH_OPTIONS.MEDIA_IMAGE,
      [CS.FILE_DOCUMENT]: SEARCH_OPTIONS.MEDIA_TEXT,
      [CS.FILE_BINARY]: SEARCH_OPTIONS.MEDIA_APPLICATION,
      [CS.FILE_MODEL]: SEARCH_OPTIONS.MEDIA_APPLICATION,
    };
    const mapped = typeMap[contentType];
    return mapped ? `&mediaType=${mapped}` : '';
  }, [contentType]);
  // Map freshness to the search service time_filter
  const timeFilterParam = React.useMemo(() => {
    if (!freshness || freshness === CS.FRESH_ALL) return '';
    const freshnessMap = {
      [CS.FRESH_DAY]: 'today',
      [CS.FRESH_WEEK]: 'thisweek',
      [CS.FRESH_MONTH]: 'thismonth',
      [CS.FRESH_YEAR]: 'thisyear',
    };
    const mapped = freshnessMap[freshness];
    return mapped ? `&time_filter=${mapped}` : '';
  }, [freshness]);
  // Map duration filter to the search service min_duration/max_duration (in seconds)
  const SHORT_DURATION_SECONDS = 240; // 4 minutes

  const LONG_DURATION_SECONDS = 1200; // 20 minutes

  const durationMinParam = React.useMemo(() => {
    if (!durationParam || durationParam === CS.DURATION.ALL) return null;
    if (durationParam === CS.DURATION.SHORT) return null;
    if (durationParam === CS.DURATION.LONG) return LONG_DURATION_SECONDS;
    if (durationParam === CS.DURATION.CUSTOM && customMinMinutes) return customMinMinutes * 60;
    return null;
  }, [durationParam, customMinMinutes]);
  const durationMaxParam = React.useMemo(() => {
    if (!durationParam || durationParam === CS.DURATION.ALL) return null;
    if (durationParam === CS.DURATION.SHORT) return SHORT_DURATION_SECONDS;
    if (durationParam === CS.DURATION.LONG) return null;
    if (durationParam === CS.DURATION.CUSTOM && customMaxMinutes) return customMaxMinutes * 60;
    return null;
  }, [durationParam, customMaxMinutes]);
  // Build sort_by param: handle ascending (oldest first = ^release_time)
  const isOldestFirst = sortByParam === CS.SORT_BY.OLDEST.key;
  const sortBy =
    !orderBy || orderBy === CS.ORDER_BY_NEW
      ? `&sort_by=${isOldestFirst ? '^' : ''}${CS.ORDER_BY_NEW_VALUE[0]}`
      : orderBy === CS.ORDER_BY_TOP
        ? `&sort_by=${CS.ORDER_BY_TOP_VALUE[0]}`
        : ``;
  // Combine prop-based duration (e.g. shorts) with filter-based duration using intersection
  const effectiveMinDuration =
    durationMinParam != null && minDuration != null
      ? Math.max(durationMinParam, minDuration)
      : durationMinParam != null
        ? durationMinParam
        : minDuration != null
          ? minDuration
          : null;
  const effectiveMaxDuration =
    durationMaxParam != null && maxDuration != null
      ? Math.min(durationMaxParam, maxDuration)
      : durationMaxParam != null
        ? durationMaxParam
        : maxDuration != null
          ? maxDuration
          : null;
  React.useEffect(() => {
    noMoreResults.current = false;
    setSearchResults(null);
    setPage(1);
  }, [searchQuery, sortBy, mediaTypeParam, timeFilterParam, effectiveMinDuration, effectiveMaxDuration]);
  React.useEffect(() => {
    if (onResults) {
      onResults(searchResults);
    }
  }, [searchResults, onResults]);
  React.useEffect(() => {
    if (noMoreResults.current) return;
    isSearching.current = true;
    let canceled = false;
    const timer = setTimeout(() => {
      if (searchQuery.trim().length < 3 || !claimId) {
        isSearching.current = false;
        setIsSearchingState(false);
        return setSearchResults(null);
      }

      setIsSearchingState(true);
      fetchSearchIds(searchQuery, SEARCH_PAGE_SIZE * page)
        .then((ids) => {
          if (canceled) return;

          const urls = ids.map((id) => hyperbeamImmutableUri(id)).filter(Boolean);
          // Batch-resolve the urls before calling 'setSearchResults', as the
          // latter will immediately cause the tiles to resolve, ending up
          // calling doResolveUri one by one before the batched one.
          return Promise.resolve(doResolveUris(urls, true)).then((resolveResponse) => {
            if (canceled) return;

            const resolvedUrls = resolveResponse
              ? urls.filter((url) => {
                  let normalizedUrl = url;

                  try {
                    normalizedUrl = normalizeURI(url);
                  } catch {}

                  const resolveResult = resolveResponse[normalizedUrl] || resolveResponse[url];

                  if (!resolveResult) return true;
                  if ('error' in resolveResult) return false;
                  const stream = resolveResult.stream;
                  return !stream || stream.signing_channel?.claim_id === claimId;
                })
              : urls;

            setSearchResults((prev) =>
              page === 1 ? resolvedUrls : Array.from(new Set((prev || []).concat(resolvedUrls)))
            );
            noMoreResults.current = !ids || ids.length < SEARCH_PAGE_SIZE * page;
          });
        })
        .catch(() => {
          if (canceled) return;

          setPage(1);
          setSearchResults(null);
          noMoreResults.current = false;
        })
        .finally(() => {
          if (canceled) return;

          isSearching.current = false;
          setIsSearchingState(false);
        });
    }, DEBOUNCE_WAIT_DURATION_MS);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [
    searchQuery,
    claimId,
    page,
    showMature,
    doResolveUris,
    sortBy,
    effectiveMinDuration,
    effectiveMaxDuration,
    maxAspectRatio,
    hideShorts,
    mediaTypeParam,
    timeFilterParam,
  ]);

  if (!searchResults) {
    return null;
  }

  return (
    <ClaimList
      uris={searchResults}
      loading={isSearchingState}
      onScrollBottom={() => setPage((prev) => (noMoreResults.current ? prev : isSearching.current ? prev : prev + 1))}
      page={page}
      pageSize={SEARCH_PAGE_SIZE}
      tileLayout={tileLayout}
      useLoadingSpinner={isSearchingState}
    />
  );
}
