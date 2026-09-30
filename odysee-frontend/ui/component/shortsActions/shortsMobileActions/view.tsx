import React from 'react';
import { createPortal } from 'react-dom';
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
import ChannelThumbnail from 'component/channelThumbnail';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import * as MODALS from 'constants/modal_types';
import * as REACTION_TYPES from 'constants/reactions';
import Counter from 'component/counter';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectIsSubscribedForUri } from 'redux/selectors/subscriptions';
import { selectPermanentUrlForUri, selectChannelForClaimUri, selectClaimIsMineForUri } from 'redux/selectors/claims';
import { doChannelSubscribe, doChannelUnsubscribe } from 'redux/actions/subscriptions';
import { hyperbeamNodeEnabled } from 'util/hyperbeamDevices';
import {
  SHORTS_MOBILE_ACTIONS_CLASS,
  SHORTS_MOBILE_ACTION_BUTTON_CLASS,
  SHORTS_MOBILE_ACTION_ITEM_CLASS,
  SHORTS_MOBILE_AVATAR_WRAPPER_CLASS,
  SHORTS_MOBILE_COUNT_CLASS,
  SHORTS_MOBILE_FLAMES_CLASS,
  SHORTS_MOBILE_FLAME_PARTICLE_CLASS,
  SHORTS_MOBILE_SLIME_CLASS,
  SHORTS_MOBILE_SLIME_FILTER,
  SHORTS_MOBILE_SUBSCRIBE_ICON_ACTIVE_CLASS,
  SHORTS_MOBILE_SUBSCRIBE_ICON_CLASS,
} from '../classes';

type Props = {
  uri: string;
  likeCount: number;
  dislikeCount: number;
  myReaction: string | null | undefined;
  doReactionLike: (uri: string) => void;
  doReactionDislike: (uri: string) => void;
  onCommentsClick: () => void;
  onShareClick: () => void;
  onInfoButtonClick: () => void;
  doOpenModal: (id: string, arg1: {}) => void;
  autoPlayNextShort: boolean;
  doToggleShortsAutoplay: () => void;
  isUnlisted: boolean | null | undefined;
  webShareable?: boolean;
  collectionId?: string;
};

const MobileActions = (props: Props) => {
  const {
    uri,
    likeCount,
    dislikeCount,
    myReaction,
    doReactionLike,
    doReactionDislike,
    onCommentsClick,
    onShareClick,
    onInfoButtonClick,
    doOpenModal,
    autoPlayNextShort,
    doToggleShortsAutoplay,
    isUnlisted,
  } = props;
  const dispatch = useAppDispatch();
  const channelUrl = useAppSelector((state) => (uri ? selectChannelForClaimUri(state, uri, true) : undefined));
  const claimIsMine = useAppSelector((state) => selectClaimIsMineForUri(state, uri));
  const isSubscribed = useAppSelector((state) => (channelUrl ? selectIsSubscribedForUri(state, channelUrl) : false));
  const channelPermanentUrl = useAppSelector((state) =>
    channelUrl ? selectPermanentUrlForUri(state, channelUrl) : undefined
  );
  const [optimisticReaction, setOptimisticReaction] = React.useState(undefined);
  const [fireButtonGlow, setFireButtonGlow] = React.useState(false);
  const fireButtonGlowTimeout = React.useRef(null);
  const [slimeButtonGlow, setSlimeButtonGlow] = React.useState(false);
  const slimeButtonGlowTimeout = React.useRef(null);
  const [fireEffect, setFireEffect] = React.useState(false);
  const fireEffectTimeout = React.useRef(null);
  const [slimeEffect, setSlimeEffect] = React.useState(false);
  const slimeEffectTimeout = React.useRef(null);
  const [avatarHover, setAvatarHover] = React.useState(false);
  React.useEffect(() => {
    setOptimisticReaction(undefined);
  }, [myReaction]);
  const effectiveReaction = optimisticReaction !== undefined ? optimisticReaction : myReaction;
  const isFireActive = effectiveReaction === REACTION_TYPES.LIKE;
  const isSlimeActive = effectiveReaction === REACTION_TYPES.DISLIKE;
  return (
    <>
      {fireEffect &&
        createPortal(
          <div className={SHORTS_MOBILE_FLAMES_CLASS}>
            {Array.from(
              {
                length: 50,
              },
              (_, i) => (
                <div
                  key={i}
                  className={SHORTS_MOBILE_FLAME_PARTICLE_CLASS}
                  style={{
                    left: `calc(${(i / 50) * 100}% - 35px)`,
                    animationDelay: `${Math.random()}s`,
                  }}
                />
              )
            )}
          </div>,
          document.body
        )}

      {slimeEffect &&
        createPortal(
          <div className={SHORTS_MOBILE_SLIME_CLASS} style={{ filter: SHORTS_MOBILE_SLIME_FILTER }} />,
          document.body
        )}

      <div className={SHORTS_MOBILE_ACTIONS_CLASS}>
        <div className={SHORTS_MOBILE_ACTION_ITEM_CLASS}>
          <Button
            button="alt"
            onClick={() => {
              setOptimisticReaction(isFireActive ? null : REACTION_TYPES.LIKE);

              if (!isFireActive) {
                setFireButtonGlow(false);
                setFireEffect(false);
                clearTimeout(fireButtonGlowTimeout.current);
                clearTimeout(fireEffectTimeout.current);
                requestAnimationFrame(() => {
                  setFireButtonGlow(true);
                  setFireEffect(true);
                  fireButtonGlowTimeout.current = setTimeout(() => setFireButtonGlow(false), 2000);
                  fireEffectTimeout.current = setTimeout(() => setFireEffect(false), 2000);
                });
              }

              doReactionLike(uri);
            }}
            icon={isFireActive ? ICONS.FIRE_ACTIVE : ICONS.FIRE}
            iconSize={16}
            title={__('I Like This')}
            requiresAuth={!hyperbeamNodeEnabled()}
            authSrc="filereaction_like"
            className={classnames(
              SHORTS_MOBILE_ACTION_BUTTON_CLASS,
              FILE_ACTION_BUTTON_CLASS,
              BUTTON_REACTION_LIKE_CLASS,
              {
                [BUTTON_REACTION_LIKE_ACTIVE_CLASS]: isFireActive,
                [BUTTON_FIRE_GLOW_CLASS]: fireButtonGlow,
              }
            )}
            label={<>{isFireActive && <ButtonFireEffect />}</>}
          />
          <span className={SHORTS_MOBILE_COUNT_CLASS}>
            <Counter value={Number.isInteger(likeCount) ? likeCount : 0} precision={0} startFrom={0} />
          </span>
        </div>

        <div className={SHORTS_MOBILE_ACTION_ITEM_CLASS}>
          <Button
            button="alt"
            requiresAuth={!hyperbeamNodeEnabled()}
            authSrc={'filereaction_dislike'}
            title={__('I dislike this')}
            className={classnames(
              SHORTS_MOBILE_ACTION_BUTTON_CLASS,
              FILE_ACTION_BUTTON_CLASS,
              BUTTON_REACTION_DISLIKE_CLASS,
              {
                [BUTTON_REACTION_DISLIKE_ACTIVE_CLASS]: isSlimeActive,
                [BUTTON_SLIME_GLOW_CLASS]: slimeButtonGlow,
              }
            )}
            iconSize={16}
            icon={isSlimeActive ? ICONS.SLIME_ACTIVE : ICONS.SLIME}
            onClick={() => {
              setOptimisticReaction(isSlimeActive ? null : REACTION_TYPES.DISLIKE);

              if (!isSlimeActive) {
                setSlimeButtonGlow(false);
                setSlimeEffect(false);
                clearTimeout(slimeButtonGlowTimeout.current);
                clearTimeout(slimeEffectTimeout.current);
                requestAnimationFrame(() => {
                  setSlimeButtonGlow(true);
                  setSlimeEffect(true);
                  slimeButtonGlowTimeout.current = setTimeout(() => setSlimeButtonGlow(false), 3000);
                  slimeEffectTimeout.current = setTimeout(() => setSlimeEffect(false), 3000);
                });
              }

              doReactionDislike(uri);
            }}
            label={<>{isSlimeActive && <ButtonSlimeEffect />}</>}
          />
          <span className={SHORTS_MOBILE_COUNT_CLASS}>
            <Counter value={Number.isInteger(dislikeCount) ? dislikeCount : 0} precision={0} startFrom={0} />
          </span>
        </div>

        {channelUrl && (
          <div
            className={SHORTS_MOBILE_ACTION_ITEM_CLASS}
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
            onClick={(e) => {
              e.stopPropagation();
              const sub = {
                channelName: channelUrl.split('/').pop(),
                uri: channelPermanentUrl,
              };

              if (isSubscribed) {
                dispatch(doChannelUnsubscribe(sub));
              } else {
                dispatch(doChannelSubscribe(sub));
              }
            }}
          >
            <div className={SHORTS_MOBILE_AVATAR_WRAPPER_CLASS}>
              <ChannelThumbnail key={channelUrl} uri={channelUrl} hideStakedIndicator />
              <div
                className={classnames(SHORTS_MOBILE_SUBSCRIBE_ICON_CLASS, {
                  [SHORTS_MOBILE_SUBSCRIBE_ICON_ACTIVE_CLASS]: isSubscribed,
                })}
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
          </div>
        )}

        <div className={SHORTS_MOBILE_ACTION_ITEM_CLASS}>
          <Button
            className={SHORTS_MOBILE_ACTION_BUTTON_CLASS}
            onClick={onInfoButtonClick}
            icon={ICONS.INFO}
            iconSize={16}
          />
        </div>

        <div className={SHORTS_MOBILE_ACTION_ITEM_CLASS}>
          <Button
            className={SHORTS_MOBILE_ACTION_BUTTON_CLASS}
            onClick={onCommentsClick}
            icon={ICONS.COMMENTS_LIST}
            iconSize={16}
          />
        </div>

        {(!isUnlisted || claimIsMine) && (
          <div className={SHORTS_MOBILE_ACTION_ITEM_CLASS}>
            <Button
              className={SHORTS_MOBILE_ACTION_BUTTON_CLASS}
              onClick={onShareClick}
              icon={ICONS.SHARE}
              iconSize={16}
              title={isUnlisted ? __('Get a sharable link for your unlisted content') : __('Share')}
            />
          </div>
        )}

        {!isUnlisted && (
          <div className={SHORTS_MOBILE_ACTION_ITEM_CLASS}>
            <Button
              className={SHORTS_MOBILE_ACTION_BUTTON_CLASS}
              onClick={() =>
                doOpenModal(MODALS.REPOST, {
                  uri,
                })
              }
              icon={ICONS.REPOST}
              iconSize={16}
              title={__('Repost this content')}
              requiresChannel
            />
          </div>
        )}

        <div className={SHORTS_MOBILE_ACTION_ITEM_CLASS}>
          <Button
            className={classnames(SHORTS_MOBILE_ACTION_BUTTON_CLASS, 'button-bubble', {
              'button-bubble--active': autoPlayNextShort,
            })}
            requiresAuth={IS_WEB}
            title={__('Autoplay Next')}
            onClick={doToggleShortsAutoplay}
            icon={ICONS.AUTOPLAY_NEXT}
            iconSize={24}
          />
        </div>
      </div>
    </>
  );
};

export default MobileActions;
