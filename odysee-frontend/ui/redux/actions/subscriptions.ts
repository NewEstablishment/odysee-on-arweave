import * as ACTIONS from 'constants/action_types';
import { MS } from 'constants/date-time';
import { SIDEBAR_SUBS_DISPLAYED } from 'constants/subscriptions';
import { doClaimSearch, doResolveUris } from 'redux/actions/claims';
import { getChannelFromClaim } from 'util/claim';
import { doToast } from 'redux/actions/notifications';
import { selectSubscriptionIds, selectSubscriptionUris } from 'redux/selectors/subscriptions';
import { fetchHyperbeamSubscriptions, fetchHyperbeamSubscriptionUpdate } from 'util/hyperbeam';
import { getHyperbeamAccount } from 'util/hyperbeamAccount';
import { hyperbeamNodeEnabled } from 'util/hyperbeamDevices';
import { nativeSubscriptionNotificationsDisabled } from 'util/nativeSubscriptions';
type SubscriptionArgs = {
  channelName: string;
  uri: string;
  notificationsDisabled?: boolean;
};
const FETCH_LAST_ACTIVE_SUBS_MIN_INTERVAL_MS = 5 * MS.MINUTE;
let activeSubsLastFetchedTime = 0;
export function doToggleSubscription(
  subscription: SubscriptionArgs,
  followToast: boolean,
  isSubscribed: boolean = false
) {
  return async (dispatch: Dispatch) => {
    if (hyperbeamNodeEnabled() && !getHyperbeamAccount()) {
      dispatch(
        doToast({
          isError: true,
          message: __('Create a HyperBEAM account before following channels.'),
        })
      );
      return;
    }

    const normalizedSubscription = {
      ...subscription,
      notificationsDisabled: nativeSubscriptionNotificationsDisabled(subscription.notificationsDisabled),
    };

    dispatch({
      type: !isSubscribed ? ACTIONS.CHANNEL_SUBSCRIBE : ACTIONS.CHANNEL_UNSUBSCRIBE,
      data: normalizedSubscription,
    });

    if (hyperbeamNodeEnabled()) {
      try {
        const subscriptions = await fetchHyperbeamSubscriptionUpdate(normalizedSubscription, isSubscribed);
        dispatch({
          type: ACTIONS.FETCH_SUBSCRIPTIONS_SUCCESS,
          data: subscriptions,
        });
      } catch (error) {
        dispatch({ type: ACTIONS.FETCH_SUBSCRIPTIONS_FAIL, data: error });
        try {
          const subscriptions = await fetchHyperbeamSubscriptions();
          dispatch({ type: ACTIONS.FETCH_SUBSCRIPTIONS_SUCCESS, data: subscriptions });
        } catch {}
        dispatch(
          doToast({
            isError: true,
            message: __('Unable to update this follow. Please try again.'),
          })
        );
        return;
      }
    }

    if (followToast) {
      dispatch(
        doToast({
          message: __(!isSubscribed ? 'You followed %CHANNEL_NAME%!' : 'Unfollowed %CHANNEL_NAME%.', {
            CHANNEL_NAME: subscription.channelName,
          }),
        })
      );
    }

    // Reset last-fetch counter
    activeSubsLastFetchedTime = 0;
  };
}
export function doFetchSubscriptions() {
  return async (dispatch: Dispatch) => {
    dispatch({ type: ACTIONS.FETCH_SUBSCRIPTIONS_START });
    try {
      const subscriptions = await fetchHyperbeamSubscriptions();
      dispatch({ type: ACTIONS.FETCH_SUBSCRIPTIONS_SUCCESS, data: subscriptions });
      return subscriptions;
    } catch (error) {
      dispatch({ type: ACTIONS.FETCH_SUBSCRIPTIONS_FAIL, data: error });
      return [];
    }
  };
}
export function doChannelSubscribe(subscription: SubscriptionArgs, followToast: boolean = true) {
  return (dispatch: Dispatch) => {
    return dispatch(doToggleSubscription(subscription, followToast));
  };
}
export function doChannelUnsubscribe(subscription: SubscriptionArgs, followToast: boolean = true) {
  return (dispatch: Dispatch) => {
    return dispatch(doToggleSubscription(subscription, followToast, true));
  };
}
export function doResolveSubscriptions() {
  return (dispatch: Dispatch, getState: GetState) => {
    const state = getState();
    const subscriptionUris = selectSubscriptionUris(state);
    dispatch(doResolveUris(subscriptionUris, true));
  };
}
export function doFetchLastActiveSubs(forceFetch: boolean = false, count: number = SIDEBAR_SUBS_DISPLAYED) {
  return (dispatch: Dispatch, getState: GetState) => {
    const now = Date.now();

    if (!forceFetch && now - activeSubsLastFetchedTime < FETCH_LAST_ACTIVE_SUBS_MIN_INTERVAL_MS) {
      dispatch({
        type: ACTIONS.FETCH_LAST_ACTIVE_SUBS_SKIP,
      });
      return;
    }

    const state = getState();
    const channelIds = selectSubscriptionIds(state);
    activeSubsLastFetchedTime = now;

    if (channelIds.length === 0) {
      dispatch({
        type: ACTIONS.FETCH_LAST_ACTIVE_SUBS_DONE,
        data: [],
      });
      return;
    }

    const searchOptions = {
      limit_claims_per_channel: 1,
      channel_ids: channelIds,
      claim_type: ['stream', 'repost'],
      page: 1,
      page_size: count,
      no_totals: true,
      order_by: ['release_time'],
      release_time: `<${Math.floor(Date.now() / MS.MINUTE) * 60}`,
    };
    dispatch(doClaimSearch(searchOptions))
      .then((results) => {
        const values = Object.values(results || {});
        dispatch({
          type: ACTIONS.FETCH_LAST_ACTIVE_SUBS_DONE,
          data: values.map((v: any) => getChannelFromClaim(v.stream)),
        });
      })
      .catch(() => {
        dispatch({
          type: ACTIONS.FETCH_LAST_ACTIVE_SUBS_FAIL,
        });
      });
  };
}
