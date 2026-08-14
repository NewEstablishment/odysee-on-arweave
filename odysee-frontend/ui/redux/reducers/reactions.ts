import { handleActions } from 'util/redux-utils';
import * as ACTIONS from 'constants/action_types';
import * as REACTION_TYPES from 'constants/reactions';
const defaultState = {
  fetchingReactions: false,
  reactionsError: undefined,
  reactionsById: {},
};
export default handleActions(
  {
    [ACTIONS.REACTIONS_LIST_STARTED]: (state) => ({ ...state, fetchingReactions: true }),
    [ACTIONS.REACTIONS_LIST_FAILED]: (state, action) => ({
      ...state,
      fetchingReactions: false,
      reactionsError: action.data,
    }),
    [ACTIONS.REACTIONS_LIST_COMPLETED]: (state, action) => {
      const { claimId, reactions } = action.data;
      const reactionsById = { ...state.reactionsById, [claimId]: reactions };
      return { ...state, fetchingReactions: false, reactionsError: undefined, reactionsById };
    },
    [ACTIONS.REACTIONS_LIKE_COMPLETED]: (state, action) => {
      const { claimId, shouldRemove } = action.data;
      const current = state.reactionsById[claimId] || {};
      const reactionsById = {
        ...state.reactionsById,
        [claimId]: {
          ...current,
          my_reactions: {
            ...current.my_reactions,
            [claimId]: {
              ...current.my_reactions?.[claimId],
              [REACTION_TYPES.LIKE]: shouldRemove ? 0 : 1,
              [REACTION_TYPES.DISLIKE]: 0,
            },
          },
          others_reactions: current.others_reactions || {},
        },
      };
      return { ...state, fetchingReactions: false, reactionsById };
    },
    [ACTIONS.REACTIONS_DISLIKE_COMPLETED]: (state, action) => {
      const { claimId, shouldRemove } = action.data;
      const current = state.reactionsById[claimId] || {};
      const reactionsById = {
        ...state.reactionsById,
        [claimId]: {
          ...current,
          my_reactions: {
            ...current.my_reactions,
            [claimId]: {
              ...current.my_reactions?.[claimId],
              [REACTION_TYPES.DISLIKE]: shouldRemove ? 0 : 1,
              [REACTION_TYPES.LIKE]: 0,
            },
          },
          others_reactions: current.others_reactions || {},
        },
      };
      return { ...state, fetchingReactions: false, reactionsById };
    },
  },
  defaultState
);
