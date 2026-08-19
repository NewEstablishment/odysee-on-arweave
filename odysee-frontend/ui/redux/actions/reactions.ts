import * as ACTIONS from 'constants/action_types';
import * as REACTION_TYPES from 'constants/reactions';
import { selectMyReactionForUri } from 'redux/selectors/reactions';
import { makeSelectClaimForUri } from 'redux/selectors/claims';
import { fetchHyperbeamFileReactionList, fetchHyperbeamFileReactionReact } from 'util/hyperbeam';
import { getHyperbeamAccount } from 'util/hyperbeamAccount';
import { doToast } from 'redux/actions/notifications';

function requireNativeReactionAccount(dispatch: Dispatch): boolean {
  if (getHyperbeamAccount()) return true;
  dispatch(
    doToast({
      isError: true,
      message: __('Create a HyperBEAM account before reacting.'),
    })
  );
  return false;
}

export const doFetchReactions = (claimId: string) => (dispatch: Dispatch) => {
  dispatch({
    type: ACTIONS.REACTIONS_LIST_STARTED,
  });

  return fetchHyperbeamFileReactionList(claimId)
    .then((reactions) => {
      dispatch({
        type: ACTIONS.REACTIONS_LIST_COMPLETED,
        data: {
          claimId,
          reactions,
        },
      });
    })
    .catch((error) => {
      dispatch({
        type: ACTIONS.REACTIONS_LIST_FAILED,
        data: error,
      });
    });
};
export const doReactionLike = (uri: string) => (dispatch: Dispatch, getState: GetState) => {
  if (!requireNativeReactionAccount(dispatch)) return Promise.resolve();
  const state = getState();
  const myReaction = selectMyReactionForUri(state, uri);
  const claim = makeSelectClaimForUri(uri)(state);
  const claimId = claim?.claim_id;
  if (!claimId) return Promise.resolve();

  const shouldRemove = myReaction === REACTION_TYPES.LIKE;
  dispatch({
    type: ACTIONS.REACTIONS_LIKE_COMPLETED,
    data: { claimId, shouldRemove },
  });
  return fetchHyperbeamFileReactionReact({
    target: claimId,
    reaction: REACTION_TYPES.LIKE,
  })
    .then((reactions) => {
      dispatch({
        type: ACTIONS.REACTIONS_LIST_COMPLETED,
        data: {
          claimId,
          reactions,
        },
      });
    })
    .catch((error) => {
      dispatch(doToast({ isError: true, message: __('Unable to save your reaction. Please try again.') }));
      dispatch({
        type: ACTIONS.REACTIONS_NEW_FAILED,
        data: error,
      });
      return dispatch(doFetchReactions(claimId));
    });
};
export const doReactionDislike = (uri: string) => (dispatch: Dispatch, getState: GetState) => {
  if (!requireNativeReactionAccount(dispatch)) return Promise.resolve();
  const state = getState();
  const myReaction = selectMyReactionForUri(state, uri);
  const claim = makeSelectClaimForUri(uri)(state);
  const claimId = claim?.claim_id;
  if (!claimId) return Promise.resolve();

  const shouldRemove = myReaction === REACTION_TYPES.DISLIKE;
  dispatch({
    type: ACTIONS.REACTIONS_DISLIKE_COMPLETED,
    data: { claimId, shouldRemove },
  });
  return fetchHyperbeamFileReactionReact({
    target: claimId,
    reaction: REACTION_TYPES.DISLIKE,
  })
    .then((reactions) => {
      dispatch({
        type: ACTIONS.REACTIONS_LIST_COMPLETED,
        data: {
          claimId,
          reactions,
        },
      });
    })
    .catch((error) => {
      dispatch(doToast({ isError: true, message: __('Unable to save your reaction. Please try again.') }));
      dispatch({
        type: ACTIONS.REACTIONS_NEW_FAILED,
        data: error,
      });
      return dispatch(doFetchReactions(claimId));
    });
};
