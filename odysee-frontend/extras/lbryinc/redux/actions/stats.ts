import * as ACTIONS from 'constants/action_types';
import { fetchHyperbeamSubCount, fetchHyperbeamViewCount } from 'util/hyperbeam';
const FETCH_SUB_COUNT_MIN_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_SUB_COUNT_IDLE_FIRE_MS = 100;
export const doFetchViewCount = (claimIdCsv: string) => (dispatch: Dispatch) => {
  dispatch({
    type: ACTIONS.FETCH_VIEW_COUNT_STARTED,
  });
  return fetchHyperbeamViewCount(claimIdCsv)
    .then((result) => {
      if (!result) throw new Error('HyperBEAM file view_count returned no counts');
      return result;
    })
    .then((result: Array<number>) => {
      const viewCounts = result;
      dispatch({
        type: ACTIONS.FETCH_VIEW_COUNT_COMPLETED,
        data: {
          claimIdCsv,
          viewCounts,
        },
      });
    })
    .catch((error) => {
      dispatch({
        type: ACTIONS.FETCH_VIEW_COUNT_FAILED,
        data: error,
      });
    });
};

const executeFetchSubCount = (claimIdCsv: string) => (dispatch: Dispatch, getState: GetState) => {
  const state = getState();
  const subCountLastFetchedById = state.stats.subCountLastFetchedById;
  const now = Date.now();
  const claimIds = Array.from(new Set(claimIdCsv.split(',').filter(Boolean))).filter((id) => {
    const prev = subCountLastFetchedById[id];
    return !prev || now - prev > FETCH_SUB_COUNT_MIN_INTERVAL_MS;
  });

  if (claimIds.length === 0) {
    return;
  }

  dispatch({
    type: ACTIONS.FETCH_SUB_COUNT_STARTED,
  });
  const filteredClaimIdCsv = claimIds.join(',');
  return fetchHyperbeamSubCount(filteredClaimIdCsv)
    .then((result) => {
      if (!result) throw new Error('HyperBEAM subscription sub_count returned no counts');
      return result;
    })
    .then((result: Array<number>) => {
      const subCounts = result;
      dispatch({
        type: ACTIONS.FETCH_SUB_COUNT_COMPLETED,
        data: {
          claimIds,
          subCounts,
          fetchDate: now,
        },
      });
    })
    .catch((error) => {
      dispatch({
        type: ACTIONS.FETCH_SUB_COUNT_FAILED,
        data: error,
      });
    });
};

let fetchSubCountTimer;
let fetchSubCountQueue = '';
export const doFetchSubCount = (claimIdCsv: string) => (dispatch: Dispatch) => {
  if (fetchSubCountTimer) {
    clearTimeout(fetchSubCountTimer);
  }

  if (fetchSubCountQueue && !fetchSubCountQueue.endsWith(',')) {
    fetchSubCountQueue += ',';
  }

  fetchSubCountQueue += claimIdCsv;
  fetchSubCountTimer = setTimeout(() => {
    dispatch(executeFetchSubCount(fetchSubCountQueue));
    fetchSubCountQueue = '';
  }, FETCH_SUB_COUNT_IDLE_FIRE_MS);
};
