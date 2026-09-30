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
import { COMPACT_REACTION_BUTTON_CLASS } from 'component/fileReactions/compact-classes';
import { FLOATING_REACTIONS_CLASS } from './classes';
import * as ICONS from 'constants/icons';
import * as REACTION_TYPES from 'constants/reactions';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectMyReactionForUri } from 'redux/selectors/reactions';
import {
  doFetchReactions as doFetchReactionsAction,
  doReactionLike as doReactionLikeAction,
  doReactionDislike as doReactionDislikeAction,
} from 'redux/actions/reactions';
import { makeSelectTagInClaimOrChannelForUri } from 'redux/selectors/claims';
import {
  DISABLE_SLIMES_VIDEO_TAG,
  DISABLE_SLIMES_ALL_TAG,
  DISABLE_REACTIONS_ALL_TAG,
  DISABLE_REACTIONS_VIDEO_TAG,
} from 'constants/tags';
type Props = {
  uri: string;
  claimId: string | null | undefined;
};

const FloatingReactions = ({ uri, claimId }: Props) => {
  const dispatch = useAppDispatch();
  const myReaction = useAppSelector((state) => selectMyReactionForUri(state, uri));
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
  const doReactionLike = (uri: string) => dispatch(doReactionLikeAction(uri));
  const doReactionDislike = (uri: string) => dispatch(doReactionDislikeAction(uri));
  const [optimisticReaction, setOptimisticReaction] = React.useState(undefined);
  const [fireButtonGlow, setFireButtonGlow] = React.useState(false);
  const fireButtonGlowTimeout = React.useRef(null);
  const [slimeButtonGlow, setSlimeButtonGlow] = React.useState(false);
  const slimeButtonGlowTimeout = React.useRef(null);
  React.useEffect(() => {
    if (claimId) dispatch(doFetchReactionsAction(claimId));
  }, [claimId, dispatch]);
  React.useEffect(() => {
    setOptimisticReaction(undefined);
  }, [myReaction]);
  const effectiveReaction = optimisticReaction !== undefined ? optimisticReaction : myReaction;
  const isFireActive = effectiveReaction === REACTION_TYPES.LIKE;
  const isSlimeActive = effectiveReaction === REACTION_TYPES.DISLIKE;
  if (disableReactions) return null;
  return (
    <div className={FLOATING_REACTIONS_CLASS}>
      <div>
        <Button
          button="alt"
          onClick={() => {
            setOptimisticReaction(isFireActive ? null : REACTION_TYPES.LIKE);

            if (!isFireActive) {
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
          requiresAuth
          authSrc="filereaction_like"
          className={classnames(COMPACT_REACTION_BUTTON_CLASS, FILE_ACTION_BUTTON_CLASS, BUTTON_REACTION_LIKE_CLASS, {
            [BUTTON_REACTION_LIKE_ACTIVE_CLASS]: isFireActive,
            [BUTTON_FIRE_GLOW_CLASS]: fireButtonGlow,
          })}
          label={isFireActive ? <ButtonFireEffect /> : null}
        />
      </div>

      {!disableSlimes && (
        <div>
          <Button
            button="alt"
            onClick={() => {
              setOptimisticReaction(isSlimeActive ? null : REACTION_TYPES.DISLIKE);

              if (!isSlimeActive) {
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
            requiresAuth
            authSrc="filereaction_dislike"
            className={classnames(
              COMPACT_REACTION_BUTTON_CLASS,
              FILE_ACTION_BUTTON_CLASS,
              BUTTON_REACTION_DISLIKE_CLASS,
              {
                [BUTTON_REACTION_DISLIKE_ACTIVE_CLASS]: isSlimeActive,
                [BUTTON_SLIME_GLOW_CLASS]: slimeButtonGlow,
              }
            )}
            label={isSlimeActive ? <ButtonSlimeEffect /> : null}
          />
        </div>
      )}
    </div>
  );
};

export default FloatingReactions;
