import React from 'react';
import classnames from 'classnames';
import Button from 'component/button';
import { ButtonFireEffect, ButtonSlimeEffect } from 'component/buttonReactionEffects/view';
import {
  BUTTON_FIRE_GLOW_CLASS,
  BUTTON_REACTION_DISLIKE_ACTIVE_CLASS,
  BUTTON_REACTION_DISLIKE_CLASS,
  BUTTON_REACTION_LIKE_ACTIVE_CLASS,
  BUTTON_REACTION_LIKE_CLASS,
  BUTTON_SLIME_GLOW_CLASS,
} from 'component/button/classes';
import { FILE_ACTION_BUTTON_CLASS } from 'component/common/file-action-button-classes';
import { SHORTS_FLOATING_ACTION_CLASSES } from 'component/shortsActions/classes';
import ChannelThumbnail from 'component/channelThumbnail';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import * as REACTION_TYPES from 'constants/reactions';
import { formatNumberWithCommas } from 'util/number';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectMyReactionForUri, selectLikeCountForUri, selectDislikeCountForUri } from 'redux/selectors/reactions';
import {
  doFetchReactions as doFetchReactionsAction,
  doReactionLike as doReactionLikeAction,
  doReactionDislike as doReactionDislikeAction,
} from 'redux/actions/reactions';
import { selectClientSetting } from 'redux/selectors/settings';
import { toggleAutoplayNextShort } from 'redux/actions/settings';
import { doSetShortsSidePanel as doSetShortsSidePanelAction } from 'redux/actions/shorts';
import { selectIsSubscribedForUri } from 'redux/selectors/subscriptions';
import {
  doChannelSubscribe as doChannelSubscribeAction,
  doChannelUnsubscribe as doChannelUnsubscribeAction,
} from 'redux/actions/subscriptions';
import { selectPermanentUrlForUri, makeSelectTagInClaimOrChannelForUri } from 'redux/selectors/claims';
import * as SETTINGS from 'constants/settings';
import { hyperbeamNodeEnabled } from 'util/hyperbeamDevices';
import {
  DISABLE_SLIMES_VIDEO_TAG,
  DISABLE_SLIMES_ALL_TAG,
  DISABLE_REACTIONS_ALL_TAG,
  DISABLE_REACTIONS_VIDEO_TAG,
} from 'constants/tags';
import { FLOATING_SHORTS_ACTIONS_CLASSES } from './classes';
type Props = {
  uri: string;
  claimId: string;
  navigateUrl: string;
  onPrevious: (() => void) | null | undefined;
  onNext: (() => void) | null | undefined;
  channelUrl: string | null | undefined;
  onFireGlow?: () => void;
  onSlimeEffect?: () => void;
};

const FloatingShortsActions = ({
  uri,
  claimId,
  navigateUrl,
  onPrevious,
  onNext,
  channelUrl,
  onFireGlow,
  onSlimeEffect,
}: Props) => {
  const dispatch = useAppDispatch();
  const myReaction = useAppSelector((state) => selectMyReactionForUri(state, uri));
  const likeCount = useAppSelector((state) => selectLikeCountForUri(state, uri));
  const dislikeCount = useAppSelector((state) => selectDislikeCountForUri(state, uri));
  const autoPlayNextShort = useAppSelector((state) => selectClientSetting(state, SETTINGS.AUTOPLAY_NEXT_SHORTS));
  const isSubscribed = useAppSelector((state) => (channelUrl ? selectIsSubscribedForUri(state, channelUrl) : false));
  const channelPermanentUrl = useAppSelector((state) =>
    channelUrl ? selectPermanentUrlForUri(state, channelUrl) : undefined
  );
  const disableSlimes = useAppSelector(
    (state) =>
      makeSelectTagInClaimOrChannelForUri(uri, DISABLE_SLIMES_ALL_TAG)(state) ||
      makeSelectTagInClaimOrChannelForUri(uri, DISABLE_SLIMES_VIDEO_TAG)(state)
  );
  const disableReactions = useAppSelector(
    (state) =>
      makeSelectTagInClaimOrChannelForUri(uri, DISABLE_REACTIONS_ALL_TAG)(state) ||
      makeSelectTagInClaimOrChannelForUri(uri, DISABLE_REACTIONS_VIDEO_TAG)(state)
  );
  const doReactionLike = (uriArg: string) => dispatch(doReactionLikeAction(uriArg));
  const doReactionDislike = (uriArg: string) => dispatch(doReactionDislikeAction(uriArg));
  const doToggleShortsAutoplay = () => dispatch(toggleAutoplayNextShort());
  const doSetShortsSidePanel = (isOpen: boolean) => dispatch(doSetShortsSidePanelAction(isOpen));
  const doChannelSubscribe = (sub: any) => dispatch(doChannelSubscribeAction(sub));
  const doChannelUnsubscribe = (sub: any) => dispatch(doChannelUnsubscribeAction(sub));
  const [optimisticReaction, setOptimisticReaction] = React.useState(undefined);
  const [fireButtonGlow, setFireButtonGlow] = React.useState(false);
  const fireButtonGlowTimeout = React.useRef(null);
  const [slimeButtonGlow, setSlimeButtonGlow] = React.useState(false);
  const slimeButtonGlowTimeout = React.useRef(null);
  const [avatarHover, setAvatarHover] = React.useState(false);
  React.useEffect(() => {
    if (claimId) dispatch(doFetchReactionsAction(claimId));
  }, [claimId, dispatch]);
  React.useEffect(() => {
    setOptimisticReaction(undefined);
  }, [myReaction]);
  const effectiveReaction = optimisticReaction !== undefined ? optimisticReaction : myReaction;
  const isFireActive = effectiveReaction === REACTION_TYPES.LIKE;
  const isSlimeActive = effectiveReaction === REACTION_TYPES.DISLIKE;
  return (
    <>
      <div className={FLOATING_SHORTS_ACTIONS_CLASSES.nav} data-floating-shorts-reveal>
        <div className={SHORTS_FLOATING_ACTION_CLASSES.item}>
          <Button
            onClick={onPrevious}
            icon={ICONS.UP}
            iconSize={16}
            title={__('Previous Short')}
            disabled={!onPrevious}
          />
        </div>

        <div className={SHORTS_FLOATING_ACTION_CLASSES.item}>
          <Button onClick={onNext} icon={ICONS.DOWN} iconSize={16} title={__('Next Short')} disabled={!onNext} />
        </div>
      </div>

      <div className={FLOATING_SHORTS_ACTIONS_CLASSES.actions} data-floating-shorts-reveal>
        <div
          className={SHORTS_FLOATING_ACTION_CLASSES.item}
          style={
            disableReactions
              ? {
                  visibility: 'hidden',
                  pointerEvents: 'none',
                }
              : undefined
          }
        >
          <Button
            button="alt"
            onClick={() => {
              setOptimisticReaction(isFireActive ? null : REACTION_TYPES.LIKE);

              if (!isFireActive) {
                if (onFireGlow) onFireGlow();
                setFireButtonGlow(false);
                clearTimeout(fireButtonGlowTimeout.current);
                requestAnimationFrame(() => {
                  setFireButtonGlow(true);
                  fireButtonGlowTimeout.current = setTimeout(() => setFireButtonGlow(false), 2000);
                });
              }

              doReactionLike(uri);
            }}
            icon={isFireActive ? ICONS.FIRE_ACTIVE : ICONS.FIRE}
            iconSize={14}
            requiresAuth={!hyperbeamNodeEnabled()}
            authSrc="filereaction_like"
            className={classnames(FILE_ACTION_BUTTON_CLASS, BUTTON_REACTION_LIKE_CLASS, {
              [BUTTON_REACTION_LIKE_ACTIVE_CLASS]: isFireActive,
              [BUTTON_FIRE_GLOW_CLASS]: fireButtonGlow,
            })}
            label={isFireActive ? <ButtonFireEffect /> : null}
          />
        </div>

        <div
          className={SHORTS_FLOATING_ACTION_CLASSES.item}
          style={
            disableReactions || disableSlimes
              ? {
                  visibility: 'hidden',
                  pointerEvents: 'none',
                }
              : undefined
          }
        >
          <Button
            button="alt"
            onClick={() => {
              setOptimisticReaction(isSlimeActive ? null : REACTION_TYPES.DISLIKE);

              if (!isSlimeActive) {
                if (onSlimeEffect) onSlimeEffect();
                setSlimeButtonGlow(false);
                clearTimeout(slimeButtonGlowTimeout.current);
                requestAnimationFrame(() => {
                  setSlimeButtonGlow(true);
                  slimeButtonGlowTimeout.current = setTimeout(() => setSlimeButtonGlow(false), 3000);
                });
              }

              doReactionDislike(uri);
            }}
            icon={isSlimeActive ? ICONS.SLIME_ACTIVE : ICONS.SLIME}
            iconSize={14}
            requiresAuth={!hyperbeamNodeEnabled()}
            authSrc="filereaction_dislike"
            className={classnames(FILE_ACTION_BUTTON_CLASS, BUTTON_REACTION_DISLIKE_CLASS, {
              [BUTTON_REACTION_DISLIKE_ACTIVE_CLASS]: isSlimeActive,
              [BUTTON_SLIME_GLOW_CLASS]: slimeButtonGlow,
            })}
            label={isSlimeActive ? <ButtonSlimeEffect /> : null}
          />
        </div>

        {channelUrl && (
          <div
            className={classnames(SHORTS_FLOATING_ACTION_CLASSES.item, SHORTS_FLOATING_ACTION_CLASSES.avatarItem)}
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
            onClick={() => {
              const sub = {
                channelName: channelUrl.split('/').pop(),
                uri: channelPermanentUrl,
              };

              if (isSubscribed) {
                doChannelUnsubscribe(sub);
              } else {
                doChannelSubscribe(sub);
              }
            }}
          >
            <ChannelThumbnail
              key={channelUrl}
              uri={channelUrl}
              hideStakedIndicator
              className={SHORTS_FLOATING_ACTION_CLASSES.avatar}
            />
            <div
              className={classnames(SHORTS_FLOATING_ACTION_CLASSES.subscribe, {
                [SHORTS_FLOATING_ACTION_CLASSES.subscribeActive]: isSubscribed,
              })}
              data-shorts-subscribe-badge
            >
              <Icon
                icon={
                  isSubscribed && avatarHover
                    ? ICONS.UNSUBSCRIBE
                    : isSubscribed || avatarHover
                      ? ICONS.SUBSCRIBED
                      : ICONS.SUBSCRIBE
                }
                size={10}
              />
            </div>
          </div>
        )}

        <div className={SHORTS_FLOATING_ACTION_CLASSES.item}>
          <Button navigate={navigateUrl} onClick={() => doSetShortsSidePanel(true)} icon={ICONS.INFO} iconSize={14} />
        </div>

        <div className={SHORTS_FLOATING_ACTION_CLASSES.item}>
          <Button
            className={classnames('button-bubble', {
              'button-bubble--active': autoPlayNextShort,
            })}
            onClick={doToggleShortsAutoplay}
            icon={ICONS.AUTOPLAY_NEXT}
            iconSize={16}
          />
        </div>
      </div>
    </>
  );
};

export default FloatingShortsActions;
