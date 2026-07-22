import * as ACTIONS from 'constants/action_types';
import * as MODALS from 'constants/modal_types';
import * as SETTINGS from 'constants/settings';
import { doOpenModal } from 'redux/actions/app';
import { doToast } from 'redux/actions/notifications';
import { selectClientSetting, selectLanguage, selectShowMatureContent } from 'redux/selectors/settings';
import { selectClaimForUri, selectClaimIdForUri, selectClaimIsNsfwForUri } from 'redux/selectors/claims';
import { doClaimSearch, doResolveClaimIds, doResolveUris } from 'redux/actions/claims';
import { buildURI, isURIValid } from 'util/lbryURI';
import {
  makeSelectHasReachedMaxResultsLength,
  makeSelectSearchUrisForQuery,
  selectPersonalRecommendations,
  selectSearchOptions,
  selectSearchValue,
} from 'redux/selectors/search';
import { selectUser } from 'redux/selectors/user';
import handleFetchResponse from 'util/handle-fetch';
import { getSearchQueryString } from 'util/query-params';
import { createNormalizedSearchKey, getRecommendationSearchOptions, getShortsRecommendationSearchOptions } from 'util/search';
import { SEARCH_SERVER_API, SEARCH_SERVER_API_ALT, RECSYS_FYP_ENDPOINT } from 'config';
import { SEARCH_OPTIONS } from 'constants/search';
import { X_LBRY_AUTH_TOKEN } from 'constants/token';
import { getAuthToken } from 'util/saved-passwords';
import { LocalStorage, LS } from 'util/storage';
import { fetchHyperbeamSearchIds } from 'util/hyperbeam';
import { hyperbeamImmutableUri, hyperbeamImmutableUriFromClaim } from 'util/hyperbeam-route';
const isDev = process.env.NODE_ENV !== 'production';
// ****************************************************************************
// FYP
// ****************************************************************************
// TODO: This should be part of `extras/recsys/recsys`, but due to the circular
// dependency problem with `extras`, I'm temporarily placing it. The recsys
// object should be moved into `ui`, but that change will require more testing.
assert(RECSYS_FYP_ENDPOINT, 'RECSYS_FYP_ENDPOINT not defined!');
const recsysFyp = {
  fetchPersonalRecommendations: (userId: string) => {
    return fetch(`${RECSYS_FYP_ENDPOINT}/${userId}/fyp`, {
      headers: {
        [X_LBRY_AUTH_TOKEN]: getAuthToken(),
      },
    })
      .then((response) => response.json())
      .then((result) => result)
      .catch((error) => {
        console.log('FYP: fetch', {
          error,
          userId,
        }); // eslint-disable-line no-console

        return {};
      });
  },
  markPersonalRecommendations: (userId: string, gid: string) => {
    return fetch(`${RECSYS_FYP_ENDPOINT}/${userId}/fyp/${gid}/mark`, {
      method: 'POST',
      headers: {
        [X_LBRY_AUTH_TOKEN]: getAuthToken(),
      },
    }).catch((error) => {
      console.log('FYP: mark', {
        error,
        userId,
        gid,
      }); // eslint-disable-line no-console

      return {};
    });
  },
  ignoreRecommendation: (userId: string, gid: string, claimId: string, ignoreChannel: boolean) => {
    let endpoint = `${RECSYS_FYP_ENDPOINT}/${userId}/fyp/${gid}/c/${claimId}/ignore`;

    if (ignoreChannel) {
      endpoint += '?entire_channel=1';
    }

    return fetch(endpoint, {
      method: 'POST',
      headers: {
        [X_LBRY_AUTH_TOKEN]: getAuthToken(),
      },
    })
      .then((result) => result)
      .catch((error) => {
        console.log('FYP: ignore', {
          error,
          userId,
          gid,
          claimId,
        }); // eslint-disable-line no-console

        return {};
      });
  },
};
// ****************************************************************************
// ****************************************************************************
type SearchOptions = {
  [key: string]: any;
  size?: number;
  from?: number;
  related_to?: string;
  nsfw?: boolean;
  isBackgroundSearch?: boolean;
  language?: string;
  gid?: string;
  // for fyp only
  uuid?: string; // for fyp only
};
let lighthouse = {
  CONNECTION_STRING: SEARCH_SERVER_API,
  user_id: '',
  uid: '',
  search: (queryString: string) => {
    if (lighthouse.uid) {
      return fetch(`${lighthouse.CONNECTION_STRING}?${queryString}${lighthouse.uid}`).then(handleFetchResponse);
    } else {
      return fetch(`${lighthouse.CONNECTION_STRING}?${queryString}`).then(handleFetchResponse);
    }
  },
  searchRecommendations: (queryString: string) => {
    if (lighthouse.user_id) {
      return fetch(`${SEARCH_SERVER_API_ALT}?${queryString}${lighthouse.user_id}${lighthouse.uid}`).then(
        handleFetchResponse
      );
    } else {
      return fetch(`${SEARCH_SERVER_API_ALT}?${queryString}`).then(handleFetchResponse);
    }
  },
};
export const setSearchApi = (endpoint: string) => {
  lighthouse.CONNECTION_STRING = endpoint.replace(/\/*$/, '/'); // exactly one slash at the end;
};
export const setSearchUserId = (userId: string | null | undefined) => {
  lighthouse.user_id = userId ? `&user_id=${userId}` : '';
  lighthouse.uid = userId ? `&uid=${userId}` : '';
};

/**
 * Processes a lighthouse-formatted search result to an array of uris.
 * @param results
 */
const processLighthouseResults = (results: Array<any>) => {
  const uris = [];
  results.forEach((item) => {
    if (item) {
      const { name, claimId } = item;
      const urlObj: LbryUrlObj = {};

      if (name.startsWith('@')) {
        urlObj.channelName = name;
        urlObj.channelClaimId = claimId;
      } else {
        urlObj.streamName = name;
        urlObj.streamClaimId = claimId;
      }

      const url = buildURI(urlObj, true);

      if (isURIValid(url)) {
        uris.push(url);
      }
    }
  });
  return uris;
};

const hitIds = (item: any) =>
  (typeof item === 'string'
    ? [item]
    : [
        item?.hyperbeam?.immutable_id,
        item?.hyperbeam?.['immutable-id'],
        item?.immutable_id,
        item?.['immutable-id'],
        item?.doc_id,
        item?.['doc-id'],
        item?.claim_id,
        item?.['claim-id'],
        item?.claimId,
        item?.legacy_outpoint,
        item?.['legacy-outpoint'],
      ]
  ).filter(Boolean);

const immutableSearchUris = (items: Array<any>) =>
  uniqueUris(
    items
      .map((item) => hitIds(item)[0])
      .map((id) => hyperbeamImmutableUri(String(id || '')))
      .filter(Boolean) as Array<string>
  );

const claimSearchUri = (claim: any) =>
  hyperbeamImmutableUriFromClaim(claim) || claim?.canonical_url || claim?.permanent_url || claim?.short_url;

const orderedHyperbeamSearchUris = (
  results: Array<any>,
  resolveInfo: any,
  fallbackUris: Array<string>,
  storeUrisById: Record<string, string> = {}
) => {
  if (!resolveInfo) return fallbackUris;

  const urisByClaimId = {};
  Object.values(resolveInfo).forEach((resolved: any) => {
    const claim = resolved && (resolved.stream || resolved.channel || resolved.collection || resolved);
    if (!claim || !claim.claim_id) return;

    const uri = claimSearchUri(claim);
    if (uri) urisByClaimId[claim.claim_id] = uri;
  });

  const orderedUris = [];
  results.forEach((item) => {
    if (!item) return;
    const storeUri = hitIds(item)
      .map((id) => storeUrisById[id])
      .find(Boolean);
    const claimId = item.claim_id || item['claim-id'] || item.claimId;
    const uri = claimId && urisByClaimId[claimId];
    const fallbackUri = claimSearchUri(item);
    const resultUri = storeUri || uri || fallbackUri;
    if (resultUri && !orderedUris.includes(resultUri)) orderedUris.push(resultUri);
  });

  return orderedUris.length ? orderedUris : fallbackUris;
};

const HYPERBEAM_MEDIA_SEARCH_OPTIONS = [
  SEARCH_OPTIONS.MEDIA_AUDIO,
  SEARCH_OPTIONS.MEDIA_VIDEO,
  SEARCH_OPTIONS.MEDIA_TEXT,
  SEARCH_OPTIONS.MEDIA_IMAGE,
  SEARCH_OPTIONS.MEDIA_APPLICATION,
];

const durationMinutesToSeconds = (value: any) => {
  if (value === undefined || value === null || value === '') return value;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.round(numberValue * 60)) : value;
};

const hyperbeamSearchParams = (query: string, searchOptions: SearchOptions) => {
  const params = {
    ...searchOptions,
    s: query,
    size: searchOptions.size,
    from: searchOptions.from,
  };
  const claimType = String(searchOptions[SEARCH_OPTIONS.CLAIM_TYPE] || '');
  const fileOnly = claimType === SEARCH_OPTIONS.INCLUDE_FILES;

  if (fileOnly) {
    params[SEARCH_OPTIONS.MIN_DURATION] = durationMinutesToSeconds(searchOptions[SEARCH_OPTIONS.MIN_DURATION]);
    params[SEARCH_OPTIONS.MAX_DURATION] = durationMinutesToSeconds(searchOptions[SEARCH_OPTIONS.MAX_DURATION]);
  } else {
    HYPERBEAM_MEDIA_SEARCH_OPTIONS.forEach((option) => delete params[option]);
    delete params[SEARCH_OPTIONS.MIN_DURATION];
    delete params[SEARCH_OPTIONS.MAX_DURATION];
  }

  return params;
};

const uniqueUris = (uris: Array<string>) => Array.from(new Set(uris.filter(Boolean)));
let searchRequestSequence = 0;
const activeSearchRequests = new Map<string, number>();

export const doSearch =
  (rawQuery: string, searchOptions: SearchOptions) => (dispatch: Dispatch, getState: GetState) => {
    const query = rawQuery.replace(/^lbry:\/\//i, '').replace(/\//, ' ');

    if (!query) {
      dispatch({
        type: ACTIONS.SEARCH_FAIL,
      });
      return;
    }

    const state = getState();
    const hideShorts = Object.prototype.hasOwnProperty.call(searchOptions, SEARCH_OPTIONS.EXCLUDE_SHORTS)
      ? Boolean(searchOptions[SEARCH_OPTIONS.EXCLUDE_SHORTS])
      : Boolean(selectClientSetting(state, SETTINGS.HIDE_SHORTS));
    const effectiveSearchOptions = {
      ...searchOptions,
      [SEARCH_OPTIONS.EXCLUDE_SHORTS]: hideShorts,
      [SEARCH_OPTIONS.EXCLUDE_SHORTS_ASPECT_RATIO_LTE]: SETTINGS.SHORTS_ASPECT_RATIO_LTE,
      [SEARCH_OPTIONS.EXCLUDE_SHORTS_DURATION_LTE]: SETTINGS.SHORTS_DURATION_LTE,
    };
    const queryWithOptions = getSearchQueryString(query, effectiveSearchOptions);
    const requestKey = createNormalizedSearchKey(queryWithOptions);
    const size = effectiveSearchOptions.size;
    const from = effectiveSearchOptions.from;
    const hyperbeamSearchEnabled = !effectiveSearchOptions.hasOwnProperty(SEARCH_OPTIONS.RELATED_TO);
    // If we have already searched for something, we don't need to do anything
    const urisForQuery = makeSelectSearchUrisForQuery(queryWithOptions)(state);
    const hasReachedMaxResultsLength = makeSelectHasReachedMaxResultsLength(queryWithOptions)(state);

    if (urisForQuery && !!urisForQuery.length) {
      const requestedEnd = Number(from || 0) + Number(size || 0);
      if (!size || urisForQuery.length >= requestedEnd || hasReachedMaxResultsLength) {
        return;
      }
    }

    if (activeSearchRequests.has(requestKey)) return;
    const requestId = ++searchRequestSequence;
    activeSearchRequests.set(requestKey, requestId);
    const isActiveRequest = () => activeSearchRequests.get(requestKey) === requestId;
    const releaseRequest = () => {
      if (isActiveRequest()) activeSearchRequests.delete(requestKey);
    };

    dispatch({
      type: ACTIONS.SEARCH_START,
      data: { query: queryWithOptions, requestId },
    });
    const isSearchingRecommendations = effectiveSearchOptions.hasOwnProperty(SEARCH_OPTIONS.RELATED_TO);
    const cmd = isSearchingRecommendations && !isDev ? lighthouse.searchRecommendations : lighthouse.search;

    const dispatchSearchResult = (type: string, uris: Array<string>, poweredBy?: string, uuid?: string) => {
      if (!isActiveRequest()) return false;
      dispatch({
        type,
        data: {
          query: queryWithOptions,
          from: from,
          size: size,
          uris,
          poweredBy,
          uuid,
          requestId,
        },
      });
      if (type === ACTIONS.SEARCH_SUCCESS || type === ACTIONS.SEARCH_FAIL) releaseRequest();
      return true;
    };

    const failSearch = () => dispatchSearchResult(ACTIONS.SEARCH_FAIL, []);

    const finishSearch = (uris: Array<string>, poweredBy?: string, uuid?: string, returnCachedClaims?: boolean) => {
      if (!isActiveRequest()) return;
      dispatch(doResolveUris(uris, returnCachedClaims));
      dispatchSearchResult(ACTIONS.SEARCH_SUCCESS, uris, poweredBy, uuid);
    };

    const fetchLighthouseResults = () =>
      cmd(queryWithOptions).then((data: SearchResults) => {
        const { body: result, poweredBy, uuid } = data;
        return { result, poweredBy, uuid, uris: processLighthouseResults(result) };
      });

    const runLighthouseSearch = () =>
      fetchLighthouseResults()
        .then(({ result, poweredBy, uuid, uris }) => {
          if (isSearchingRecommendations) {
            const claimIds = Array.from(new Set<string>(result.map((x) => x.claimId).filter(Boolean)));
            const resolveTimeout = new Promise((resolve) => setTimeout(resolve, 2000));
            Promise.race([dispatch(doResolveClaimIds(claimIds)).catch(() => undefined), resolveTimeout]).then(
              (resolveInfo) => {
                const resolvedUris = orderedHyperbeamSearchUris(result, resolveInfo, uris);
                dispatchSearchResult(ACTIONS.SEARCH_SUCCESS, resolvedUris, poweredBy, uuid);
              }
            );
            return;
          }

          finishSearch(uniqueUris(uris), poweredBy, uuid);
        })
        .catch(failSearch);

    if (hyperbeamSearchEnabled) {
      fetchHyperbeamSearchIds(hyperbeamSearchParams(query, effectiveSearchOptions))
        .then((data) => {
          if (!isActiveRequest()) return;
          if (!data || !Array.isArray(data.items)) throw new Error('HyperBEAM search returned no items array');
          const uris = immutableSearchUris(data.items);
          if (data.items.length && !uris.length) throw new Error('HyperBEAM search returned invalid immutable IDs');
          finishSearch(uris, 'HyperBEAM');
        })
        .catch(failSearch);
      return;
    }

    runLighthouseSearch();
  };
export const doUpdateSearchOptions =
  (newOptions: SearchOptions, additionalOptions: SearchOptions) => (dispatch: Dispatch, getState: GetState) => {
    const state = getState();
    const searchValue = selectSearchValue(state);
    const existingOptions = selectSearchOptions(state);
    const updatedOptions = { ...existingOptions, ...newOptions };

    LocalStorage.setItem(LS.SEARCH_OPTIONS, JSON.stringify(updatedOptions));
    dispatch({
      type: ACTIONS.UPDATE_SEARCH_OPTIONS,
      data: newOptions,
    });

    if (searchValue) {
      // After updating, perform a search with the new options
      dispatch(doSearch(searchValue, { ...updatedOptions, ...additionalOptions }));
    }
  };
export const doSetMentionSearchResults = (query: string, uris: Array<string>) => (dispatch: Dispatch) => {
  dispatch({
    type: ACTIONS.SET_MENTION_SEARCH_RESULTS,
    data: {
      query,
      uris,
    },
  });
};
export const doFetchShortsRecommendedContent =
  (uri: string, fyp: FypParam | null | undefined = null, forChannel: boolean | null | undefined = false) =>
  (dispatch: Dispatch, getState: GetState) => {
    const state = getState();
    const claim = selectClaimForUri(state, uri);
    const matureEnabled = selectShowMatureContent(state);
    const claimIsMature = selectClaimIsNsfwForUri(state, uri);
    const languageSetting = selectLanguage(state);
    const searchInLanguage = selectClientSetting(state, SETTINGS.SEARCH_IN_LANGUAGE);
    const language = searchInLanguage ? languageSetting : null;

    if (claim && claim.value && claim.claim_id) {
      let idToUse;

      if (forChannel) {
        const channelClaim = claim.signing_channel;
        idToUse = channelClaim?.claim_id;

        if (!idToUse) {
          console.error('No channel ID found for channel shorts mode');
          return;
        }
      } else {
        idToUse = claim.claim_id;
      }

      const options: SearchOptions = getShortsRecommendationSearchOptions(
        matureEnabled,
        claimIsMature,
        idToUse,
        language,
        forChannel
      );

      if (fyp) {
        options['gid'] = fyp.gid;
        options['uuid'] = fyp.uuid;
      }

      const { title } = claim.value;

      if (title && options) {
        dispatch(doSearch(title, options));
      }
    }
  };
export const doFetchRecommendedContent =
  (uri: string, fyp: FypParam | null | undefined = null) =>
  (dispatch: Dispatch, getState: GetState) => {
    const state = getState();
    const claim = selectClaimForUri(state, uri);
    const matureEnabled = selectShowMatureContent(state);
    const claimIsMature = selectClaimIsNsfwForUri(state, uri);
    const languageSetting = selectLanguage(state);
    const searchInLanguage = selectClientSetting(state, SETTINGS.SEARCH_IN_LANGUAGE);
    const language = searchInLanguage ? languageSetting : null;

    if (claim && claim.value && claim.claim_id) {
      const options: SearchOptions = getRecommendationSearchOptions(
        matureEnabled,
        claimIsMature,
        claim.claim_id,
        language
      );

      if (fyp) {
        options['gid'] = fyp.gid;
        options['uuid'] = fyp.uuid;
      }

      const { title } = claim.value;

      if (title && options) {
        dispatch(doSearch(title, options));
      }
    }
  };
export const doFetchPersonalRecommendations = () => (dispatch: Dispatch, getState: GetState) => {
  const state = getState();
  const user = selectUser(state);

  if (!user || !user.id) {
    dispatch({
      type: ACTIONS.FYP_FETCH_FAILED,
    });
    return;
  }

  recsysFyp
    .fetchPersonalRecommendations(user.id)
    .then((data) => {
      const { gid, recs } = data;

      if (gid && recs) {
        const uris = processLighthouseResults(recs);
        dispatch(
          doClaimSearch({
            claim_ids: recs.map((r) => r.claimId),
            page: 1,
            page_size: 50,
            no_totals: true,
          })
        ).finally(() => {
          dispatch({
            type: ACTIONS.FYP_FETCH_SUCCESS,
            data: {
              gid,
              uris,
            },
          });
        });
      } else {
        dispatch({
          type: ACTIONS.FYP_FETCH_FAILED,
        });
      }
    })
    .catch(() => {
      dispatch({
        type: ACTIONS.FYP_FETCH_FAILED,
      });
    });
};
export const doRemovePersonalRecommendation = (uri: string) => (dispatch: Dispatch, getState: GetState) => {
  const state = getState();
  const user = selectUser(state);
  const personalRecommendations = selectPersonalRecommendations(state);
  const claimId = selectClaimIdForUri(state, uri);

  if (!user || !user.id || !personalRecommendations.gid || !claimId) {
    return;
  }

  dispatch(
    doOpenModal(MODALS.HIDE_RECOMMENDATION, {
      uri,
      onConfirm: (hideChannel) => {
        recsysFyp
          .ignoreRecommendation(user.id, personalRecommendations.gid, claimId, hideChannel)
          .then((res) => {
            dispatch({
              type: ACTIONS.FYP_HIDE_URI,
              data: {
                uri,
              },
            });
            dispatch(
              doToast({
                message: __('Recommendation removed.'),
                subMessage: __('Thanks for the feedback!'),
              })
            );
          })
          .catch((err) => {
            assert(false, 'recsys "ignore" failed', err);
          });
      },
    })
  );
};
export { lighthouse, recsysFyp };
