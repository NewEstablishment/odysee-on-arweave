/* eslint-disable react/prop-types */
import React from 'react';
import { createPortal } from 'react-dom';
import Button from 'component/button';
import { ButtonFireEffect, ButtonSlimeEffect } from 'component/buttonReactionEffects/view';
import {
  BUTTON_REACTION_DISLIKE_ACTIVE_CLASS,
  BUTTON_REACTION_DISLIKE_CLASS,
  BUTTON_REACTION_LIKE_ACTIVE_CLASS,
  BUTTON_REACTION_LIKE_CLASS,
} from 'component/button/classes';
import { FILE_ACTION_BUTTON_CLASS } from 'component/common/file-action-button-classes';
import * as ICONS from 'constants/icons';
import * as MODALS from 'constants/modal_types';
import classnames from 'classnames';
import * as REACTION_TYPES from 'constants/reactions';
import Counter from 'component/counter';
import { COUNTER_INLINE_CLASS } from 'component/counter/classes';
import ClaimCollectionAddButton from 'component/claimCollectionAddButton';
import ChannelThumbnail from 'component/channelThumbnail';
import Icon from 'component/common/icon';
import { useIsShortsMobile } from 'effects/use-screensize';
import { platform } from 'util/platform';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectMyReactionForUri, selectLikeCountForUri, selectDislikeCountForUri } from 'redux/selectors/reactions';
import { doFetchReactions, doReactionLike, doReactionDislike } from 'redux/actions/reactions';
import {
  selectClaimForUri,
  selectIsStreamPlaceholderForUri,
  selectClaimIsMine,
  selectScheduledStateForUri,
  makeSelectTagInClaimOrChannelForUri,
  selectIsUriUnlisted,
  selectPermanentUrlForUri,
  selectChannelForClaimUri,
  selectChannelTitleForUri,
} from 'redux/selectors/claims';
import { selectIsSubscribedForUri } from 'redux/selectors/subscriptions';
import { doChannelSubscribe, doChannelUnsubscribe } from 'redux/actions/subscriptions';
import {
  DISABLE_SLIMES_VIDEO_TAG,
  DISABLE_SLIMES_ALL_TAG,
  DISABLE_REACTIONS_ALL_TAG,
  DISABLE_REACTIONS_VIDEO_TAG,
} from 'constants/tags';
import { doOpenModal } from 'redux/actions/app';
import { hyperbeamNodeEnabled } from 'util/hyperbeamDevices';
import { CLAIM_COVER_SHORTS_SELECTOR } from 'component/claimCoverRender/classes';
import {
  SHORTS_ACTION_CLASSES,
  SHORTS_EFFECT_CLASSES,
  SHORTS_FLOATING_ACTION_CLASSES,
  SHORTS_MOBILE_SLIME_FILTER,
  SHORTS_PAGE_NAVIGATION_CLASS,
} from './classes';

type Props = {
  hasPlaylist: boolean;
  onNext: () => void;
  onPrevious: () => void;
  isLoading?: boolean;
  isAtStart?: boolean;
  isAtEnd?: boolean;
  autoPlayNextShort: boolean;
  doToggleShortsAutoplay: () => void;
  uri: string;
  onCommentsClick: () => void;
  collectionId?: string;
  handleShareClick: () => void;
  onInfoClick: () => void;
  currentIndex?: number;
  totalVideos?: number;
};
const LIVE_REACTION_FETCH_MS = 1000 * 45;

function updateRestartableEffect(element: Element | null, attribute: string, active: boolean) {
  if (!element) return;
  element.removeAttribute(attribute);
  if (active) {
    void (element as HTMLElement).offsetWidth;
    element.setAttribute(attribute, '');
  }
}

const ShortsActions = React.memo<Props>(
  ({
    uri,
    hasPlaylist,
    onNext,
    onPrevious,
    isLoading,
    isAtStart,
    isAtEnd,
    autoPlayNextShort,
    onCommentsClick,
    doToggleShortsAutoplay,
    handleShareClick,
    onInfoClick,
  }: Props) => {
    const dispatch = useAppDispatch();

    const claim = useAppSelector((state) => selectClaimForUri(state, uri));
    const claimId = claim?.claim_id;
    const channelUrl = useAppSelector((state) => (uri ? selectChannelForClaimUri(state, uri, true) : undefined));

    const myReaction = useAppSelector((state) => selectMyReactionForUri(state, uri));
    const likeCount = useAppSelector((state) => selectLikeCountForUri(state, uri));
    const dislikeCount = useAppSelector((state) => selectDislikeCountForUri(state, uri));
    const isLivestreamClaim = useAppSelector((state) => selectIsStreamPlaceholderForUri(state, uri));
    const claimIsMine = useAppSelector((state) => selectClaimIsMine(state, claim));
    const scheduledState = useAppSelector((state) => selectScheduledStateForUri(state, uri));
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
    const isUnlisted = useAppSelector((state) => selectIsUriUnlisted(state, uri));
    const isSubscribed = useAppSelector((state) => (channelUrl ? selectIsSubscribedForUri(state, channelUrl) : false));
    const channelPermanentUrl = useAppSelector((state) =>
      channelUrl ? selectPermanentUrlForUri(state, channelUrl) : undefined
    );
    const channelTitle = useAppSelector((state) =>
      channelUrl ? selectChannelTitleForUri(state, channelUrl) : undefined
    );

    const [avatarHover, setAvatarHover] = React.useState(false);
    const followRef = React.useRef(null);
    const [countersZeroed, setCountersZeroed] = React.useState(false);
    const [fireEffect, setFireEffect] = React.useState(false);
    const fireEffectTimeout = React.useRef(null);
    const [slimeEffect, setSlimeEffect] = React.useState(false);
    const slimeEffectTimeout = React.useRef(null);
    React.useEffect(() => {
      const el = document.querySelector('.shorts__viewer') || document.querySelector(CLAIM_COVER_SHORTS_SELECTOR);
      updateRestartableEffect(el, 'data-shorts-fire-glow', fireEffect);
    }, [fireEffect]);
    React.useEffect(() => {
      const el = document.querySelector('.shorts__viewer') || document.querySelector(CLAIM_COVER_SHORTS_SELECTOR);
      updateRestartableEffect(el, 'data-shorts-slime-glow', slimeEffect);
    }, [slimeEffect]);
    React.useEffect(() => {
      setCountersZeroed(false);
    }, [claimId]);
    React.useEffect(() => {
      function fetchReactions() {
        dispatch(doFetchReactions(claimId));
      }

      let fetchInterval;

      if (claimId) {
        fetchReactions();

        if (isLivestreamClaim) {
          fetchInterval = setInterval(fetchReactions, LIVE_REACTION_FETCH_MS);
        }
      }

      return () => {
        if (fetchInterval) {
          clearInterval(fetchInterval);
        }
      };
    }, [claimId, dispatch, isLivestreamClaim]);
    const isMobile = useIsShortsMobile();
    const isMobileDevice = platform.isMobile();

    if (isMobileDevice) return null;

    const content = (
      <div
        className={classnames(SHORTS_PAGE_NAVIGATION_CLASS, {
          [SHORTS_ACTION_CLASSES.mobileDesktopNavigation]: isMobile,
        })}
      >
        <>
          <Button
            className={classnames(SHORTS_ACTION_CLASSES.button, SHORTS_ACTION_CLASSES.info)}
            onClick={onInfoClick}
            icon={ICONS.INFO}
            iconSize={20}
            title={__('Show Details')}
          />
          <Button
            className={classnames(SHORTS_ACTION_CLASSES.button, SHORTS_ACTION_CLASSES.previous)}
            onClick={() => {
              setCountersZeroed(true);
              onPrevious();
            }}
            icon={ICONS.UP}
            iconSize={24}
            title={__('Previous Short')}
            disabled={isAtStart}
          />
          <Button
            className={classnames(SHORTS_ACTION_CLASSES.button, SHORTS_ACTION_CLASSES.next)}
            onClick={() => {
              setCountersZeroed(true);
              onNext();
            }}
            icon={ICONS.DOWN}
            iconSize={24}
            title={__('Next Short')}
            disabled={isAtEnd}
          />
          <div
            className={classnames(SHORTS_ACTION_CLASSES.ratings, {
              [SHORTS_ACTION_CLASSES.ratingsNoSlime]: disableSlimes,
            })}
            style={
              {
                ...(disableReactions
                  ? {
                      visibility: 'hidden',
                      pointerEvents: 'none',
                    }
                  : {}),
                '--ratings-gradient': (() => {
                  if (!Number.isInteger(likeCount) || !Number.isInteger(dislikeCount)) return 'var(--color-border)';
                  const total = likeCount + (disableSlimes ? 0 : dislikeCount);
                  if (total === 0) return 'var(--color-border)';
                  const likePercent = (likeCount / total) * 100;
                  if (likePercent === 100) return 'var(--color-fire)';
                  if (likePercent === 0) return 'var(--color-slime)';
                  const fireStop = Math.max(0, likePercent - 15);
                  const slimeStop = Math.min(100, likePercent + 15);
                  return `linear-gradient(to bottom, var(--color-fire) ${fireStop}%, var(--color-slime) ${slimeStop}%)`;
                })(),
              } as React.CSSProperties
            }
          >
            <div className={classnames(SHORTS_ACTION_CLASSES.reactionCount, SHORTS_ACTION_CLASSES.fireCount)}>
              <Button
                button="alt"
                onClick={() => {
                  if (myReaction !== REACTION_TYPES.LIKE) {
                    setFireEffect(false);
                    clearTimeout(fireEffectTimeout.current);
                    requestAnimationFrame(() => {
                      setFireEffect(true);
                      fireEffectTimeout.current = setTimeout(() => setFireEffect(false), 2000);
                    });
                  }

                  dispatch(doReactionLike(uri));
                }}
                icon={myReaction === REACTION_TYPES.LIKE ? ICONS.FIRE_ACTIVE : ICONS.FIRE}
                iconSize={16}
                title={__('I Like This')}
                requiresAuth={!hyperbeamNodeEnabled()}
                authSrc="filereaction_like"
                className={classnames(
                  SHORTS_ACTION_CLASSES.button,
                  FILE_ACTION_BUTTON_CLASS,
                  BUTTON_REACTION_LIKE_CLASS,
                  {
                    [BUTTON_REACTION_LIKE_ACTIVE_CLASS]: myReaction === REACTION_TYPES.LIKE,
                  }
                )}
                label={<>{myReaction === REACTION_TYPES.LIKE && <ButtonFireEffect />}</>}
              />
              {countersZeroed ? (
                <span className={COUNTER_INLINE_CLASS}>0</span>
              ) : (
                <Counter
                  key={'fire-' + (claimId || '')}
                  value={Number.isInteger(likeCount) ? likeCount : 0}
                  precision={0}
                  startFrom={0}
                />
              )}
            </div>
            <div
              className={classnames(SHORTS_ACTION_CLASSES.reactionCount, SHORTS_ACTION_CLASSES.slimeCount)}
              style={
                disableSlimes
                  ? {
                      visibility: 'hidden',
                    }
                  : undefined
              }
            >
              <Button
                button="alt"
                requiresAuth={!hyperbeamNodeEnabled()}
                authSrc={'filereaction_dislike'}
                title={__('I dislike this')}
                className={classnames(
                  SHORTS_ACTION_CLASSES.button,
                  FILE_ACTION_BUTTON_CLASS,
                  BUTTON_REACTION_DISLIKE_CLASS,
                  {
                    [BUTTON_REACTION_DISLIKE_ACTIVE_CLASS]: myReaction === REACTION_TYPES.DISLIKE,
                  }
                )}
                label={<>{myReaction === REACTION_TYPES.DISLIKE && <ButtonSlimeEffect />}</>}
                iconSize={16}
                icon={myReaction === REACTION_TYPES.DISLIKE ? ICONS.SLIME_ACTIVE : ICONS.SLIME}
                onClick={() => {
                  if (myReaction !== REACTION_TYPES.DISLIKE) {
                    setSlimeEffect(false);
                    clearTimeout(slimeEffectTimeout.current);
                    requestAnimationFrame(() => {
                      setSlimeEffect(true);
                      slimeEffectTimeout.current = setTimeout(() => setSlimeEffect(false), 3000);
                    });
                  }

                  dispatch(doReactionDislike(uri));
                }}
              />
              {countersZeroed ? (
                <span className={COUNTER_INLINE_CLASS}>0</span>
              ) : (
                <Counter
                  key={'slime-' + (claimId || '')}
                  value={Number.isInteger(dislikeCount) ? dislikeCount : 0}
                  precision={0}
                  startFrom={0}
                />
              )}
            </div>
          </div>
          {channelUrl ? (
            <div
              ref={followRef}
              className={SHORTS_ACTION_CLASSES.item}
              onMouseEnter={() => setAvatarHover(true)}
              onMouseLeave={() => setAvatarHover(false)}
              onClick={() => {
                const sub = {
                  channelName: channelUrl.split('/').pop(),
                  uri: channelPermanentUrl,
                };

                if (!isSubscribed && followRef.current) {
                  const container = followRef.current;
                  container.querySelectorAll('.shorts-heart-particle').forEach((el) => el.remove());
                  const badge = container.querySelector('[data-shorts-subscribe-badge]');

                  if (badge) {
                    const containerRect = container.getBoundingClientRect();
                    const badgeRect = badge.getBoundingClientRect();
                    const cx = badgeRect.left - containerRect.left + badgeRect.width / 2;
                    const cy = badgeRect.top - containerRect.top;

                    for (let i = 0; i < 6; i++) {
                      const heart = document.createElement('span');
                      heart.textContent = '\u2764';
                      heart.className = SHORTS_ACTION_CLASSES.heartParticle;
                      heart.style.left = cx + (Math.random() * 16 - 8) + 'px';
                      heart.style.top = cy + 'px';
                      heart.style.animationDelay = Math.random() * 0.4 + 's';
                      heart.style.fontSize = 10 + Math.random() * 8 + 'px';
                      container.appendChild(heart);
                    }
                  }
                }

                if (isSubscribed) {
                  dispatch(
                    doOpenModal(MODALS.CONFIRM, {
                      title: __('Unfollow %channel%?', {
                        channel: channelTitle || sub.channelName,
                      }),
                      onConfirm: (closeModal) => {
                        dispatch(doChannelUnsubscribe(sub));
                        closeModal();
                      },
                      labelOk: __('Unfollow'),
                    })
                  );
                } else {
                  dispatch(doChannelSubscribe(sub));
                }
              }}
            >
              <div
                className={classnames(SHORTS_FLOATING_ACTION_CLASSES.item, SHORTS_FLOATING_ACTION_CLASSES.avatarItem)}
              >
                <ChannelThumbnail
                  key={channelUrl}
                  uri={channelUrl}
                  hideStakedIndicator
                  className={classnames(
                    SHORTS_FLOATING_ACTION_CLASSES.avatar,
                    SHORTS_FLOATING_ACTION_CLASSES.avatarPage
                  )}
                />
                <div
                  className={classnames(
                    SHORTS_FLOATING_ACTION_CLASSES.subscribe,
                    SHORTS_FLOATING_ACTION_CLASSES.subscribePage,
                    {
                      [SHORTS_FLOATING_ACTION_CLASSES.subscribeActive]: isSubscribed,
                    }
                  )}
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
              <p>{isSubscribed ? __('Following') : __('Follow')}</p>
            </div>
          ) : (
            <div className={classnames(SHORTS_ACTION_CLASSES.item, SHORTS_ACTION_CLASSES.placeholder)} />
          )}

          <div className={SHORTS_ACTION_CLASSES.item}>
            <Button
              className={classnames(SHORTS_ACTION_CLASSES.button, 'shorts-page__actions-button--comments')}
              onClick={onCommentsClick}
              icon={ICONS.COMMENTS_LIST}
              iconSize={16}
              title={__('Comments')}
            />
            <p>{__('Comments')}</p>
          </div>

          <div className={SHORTS_ACTION_CLASSES.group}>
            <div className={SHORTS_ACTION_CLASSES.item}>
              <ClaimCollectionAddButton uri={uri} isShortsPage />
            </div>

            {!isUnlisted && (
              <div className={SHORTS_ACTION_CLASSES.item}>
                <Button
                  className={SHORTS_ACTION_CLASSES.button}
                  onClick={() =>
                    dispatch(
                      doOpenModal(MODALS.REPOST, {
                        uri,
                      })
                    )
                  }
                  icon={ICONS.REPOST}
                  iconSize={16}
                  title={__('Repost this content')}
                  requiresChannel
                />
                <p>{__('Repost')}</p>
              </div>
            )}
          </div>
          <div className={classnames(SHORTS_ACTION_CLASSES.group, SHORTS_ACTION_CLASSES.groupBottom)}>
            {(!isUnlisted || claimIsMine) && (
              <div className={SHORTS_ACTION_CLASSES.item}>
                <Button
                  className={classnames(SHORTS_ACTION_CLASSES.button, 'shorts-page__actions-button--share')}
                  onClick={handleShareClick}
                  icon={ICONS.SHARE}
                  iconSize={16}
                  title={isUnlisted ? __('Get a sharable link for your unlisted content') : __('Share')}
                />
                <p>{__('Share')}</p>
              </div>
            )}
            <div className={SHORTS_ACTION_CLASSES.item}>
              <Button
                className={classnames(SHORTS_ACTION_CLASSES.button, 'button-bubble', {
                  'button-bubble--active': autoPlayNextShort,
                })}
                title={__('Autoplay Next')}
                onClick={doToggleShortsAutoplay}
                icon={ICONS.AUTOPLAY_NEXT}
                iconSize={16}
                disabled={isLoading}
              />
              <p>{__('Auto Next')}</p>
            </div>
          </div>
        </>
      </div>
    );
    const portalTarget =
      typeof document !== 'undefined'
        ? document.querySelector('.shorts__viewer') || document.querySelector(CLAIM_COVER_SHORTS_SELECTOR)
        : null;
    const effectOverlays = portalTarget && (
      <>
        {fireEffect &&
          createPortal(
            <div className={SHORTS_EFFECT_CLASSES.flames}>
              {Array.from(
                {
                  length: 50,
                },
                (_, i) => (
                  <div
                    key={i}
                    className={SHORTS_EFFECT_CLASSES.flameParticle}
                    style={{
                      left: `calc(${(i / 50) * 100}% - 35px)`,
                      animationDelay: `${Math.random()}s`,
                    }}
                  />
                )
              )}
            </div>,
            portalTarget
          )}
        {slimeEffect &&
          createPortal(
            <div className={SHORTS_EFFECT_CLASSES.slime} style={{ filter: SHORTS_MOBILE_SLIME_FILTER }} />,
            portalTarget
          )}
      </>
    );

    if (isMobile && document.body) {
      return (
        <>
          {effectOverlays}
          {createPortal(content, document.body)}
        </>
      );
    }

    return (
      <>
        {effectOverlays}
        {content}
      </>
    );
  }
);
export default ShortsActions;
