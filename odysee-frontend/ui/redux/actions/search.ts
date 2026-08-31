import * as ACTIONS from 'constants/action_types';
import * as MODALS from 'constants/modal_types';
import * as SETTINGS from 'constants/settings';
import { doOpenModal } from 'redux/actions/app';
import { doToast } from 'redux/actions/notifications';
import { selectClientSetting, selectLanguage, selectShowMatureContent } from 'redux/selectors/settings';
import { selectClaimForUri, selectClaimIdForUri, selectClaimIsNsfwForUri } from 'redux/selectors/claims';
import { doClaimSearch, doResolveUris } from 'redux/actions/claims';
import { buildURI, isURIValid } from 'util/lbryURI';
import {
  makeSelectSearchUrisForQuery,
  selectPersonalRecommendations,
  selectSearchOptions,
  selectSearchValue,
} from 'redux/selectors/search';
import { selectUser } from 'redux/selectors/user';
import { getSearchQueryString } from 'util/query-params';
import { getRecommendationSearchOptions, getShortsRecommendationSearchOptions } from 'util/search';
import { getRecommendationSearchQuery } from 'util/relatedSearch';
import { fetchSearchIds } from 'util/hyperbeam';
import { hyperbeamImmutableUri } from 'util/hyperbeam-route';
import { hyperbeamSearchRequest } from 'util/hyperbeamSearch';
import { RECSYS_FYP_ENDPOINT } from 'config';
import { SEARCH_OPTIONS } from 'constants/search';
import { X_LBRY_AUTH_TOKEN } from 'constants/token';
import { getAuthToken } from 'util/saved-passwords';
import { LocalStorage, LS } from 'util/storage';
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
/**
 * Processes a search-service-formatted result to an array of uris.
 * @param results
 */
const processSearchResults = (results: Array<any>) => {
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

const uniqueUris = (uris: Array<string>) => Array.from(new Set(uris.filter(Boolean)));

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
    const queryWithOptions = getSearchQueryString(query, searchOptions);
    const size = searchOptions.size;
    const from = searchOptions.from;
    // If we have already searched for something, we don't need to do anything
    const urisForQuery = makeSelectSearchUrisForQuery(queryWithOptions)(state);

    if (urisForQuery && !!urisForQuery.length) {
      if (!size || !from || from + size < urisForQuery.length) {
        return;
      }
    }

    dispatch({
      type: ACTIONS.SEARCH_START,
      // The reducer keys the in-flight request by query: without it the
      // request registers under '' and no completion can ever clear it,
      // leaving the results spinner running forever.
      data: { query: queryWithOptions },
    });

    const start = Number(from) || 0;
    const count = Number(size) || 20;

    const searchQuery = searchOptions[SEARCH_OPTIONS.EXACT]
      ? `"${query.replace(/["\\]/g, (character) => `\\${character}`)}"`
      : query;

    fetchSearchIds(searchQuery, hyperbeamSearchRequest(searchOptions, start, count))
      .then(async (ids) => {
        const candidates = uniqueUris(ids.map((id) => hyperbeamImmutableUri(id)).filter(Boolean));
        const publish = (uris: Array<string>) =>
          dispatch({
            type: ACTIONS.SEARCH_SUCCESS,
            data: {
              query: queryWithOptions,
              from: from,
              size: size,
              uris,
              poweredBy: 'HyperBEAM',
              uuid: '',
              sourceResultCount: ids.length,
            },
          });

        // Publish the hits straight away so the list renders its loading
        // cards while the claims arrive, then republish once resolution is
        // done: an id whose claim never arrives would otherwise leave a
        // loading card that never settles.
        publish(candidates);
        const resolved = await dispatch(doResolveUris(candidates)).catch(() => null);
        publish(filterToResolved(candidates, resolved));
      })
      .catch(() => {
        dispatch({
          type: ACTIONS.SEARCH_FAIL,
          data: { query: queryWithOptions },
        });
      });
  };
// `doResolveUris` answers with the raw resolve response: a map keyed by uri
// whose values are the claims themselves, with `{error}` in place of the ones
// that could not be resolved. A claim that never arrives renders as a loading
// card that never settles, so keep only the uris that came back with a claim.
// If nothing at all resolved the node is having a bad day rather than every
// result being dead, so fall back to showing the candidates.
function filterToResolved(candidates: Array<string>, resolved: any): Array<string> {
  if (!resolved || typeof resolved !== 'object') return candidates;

  const alive = new Set(
    Object.keys(resolved).filter((uri) => {
      const entry = resolved[uri];
      if (!entry || typeof entry !== 'object' || entry.error) return false;
      return Boolean(entry.claim_id || entry.stream || entry.channel || entry.collection || entry.claim);
    })
  );

  if (!alive.size) return candidates;
  return candidates.filter((uri) => alive.has(uri));
}

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

      const { title, tags } = claim.value;
      const searchQuery = getRecommendationSearchQuery(title, tags);

      if (searchQuery && options) {
        dispatch(doSearch(searchQuery, options));
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
        const uris = processSearchResults(recs);
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
export { recsysFyp };
