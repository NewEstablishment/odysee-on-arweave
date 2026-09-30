import React from 'react';
import Skeleton from '@mui/material/Skeleton';
import classnames from 'classnames';
import * as REACTION_TYPES from 'constants/reactions';
import * as ICONS from 'constants/icons';
import RatioBar from 'component/ratioBar';
import FileActionButton from 'component/common/file-action-button';
import { ButtonFireEffect, ButtonSlimeEffect } from 'component/buttonReactionEffects/view';
import {
  BUTTON_REACTION_DISLIKE_ACTIVE_CLASS,
  BUTTON_REACTION_DISLIKE_CLASS,
  BUTTON_REACTION_LIKE_ACTIVE_CLASS,
  BUTTON_REACTION_LIKE_CLASS,
} from 'component/button/classes';
import Counter from 'component/counter';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectMyReactionForUri, selectLikeCountForUri, selectDislikeCountForUri } from 'redux/selectors/reactions';
import { doFetchReactions, doReactionLike, doReactionDislike } from 'redux/actions/reactions';
import {
  selectClaimForUri,
  selectIsStreamPlaceholderForUri,
  selectClaimIsMine,
  selectScheduledStateForUri,
  makeSelectTagInClaimOrChannelForUri,
} from 'redux/selectors/claims';
import { DISABLE_SLIMES_VIDEO_TAG, DISABLE_SLIMES_ALL_TAG } from 'constants/tags';
import { hyperbeamNodeEnabled } from 'util/hyperbeamDevices';
import {
  FILE_REACTION_COUNT_PLACEHOLDER_CLASS,
  FILE_REACTIONS_CLASS,
  FILE_REACTIONS_DISABLED_CLASS,
  FILE_REACTIONS_NO_SLIME_CLASS,
} from './classes';
import { EMBED_COMPACT_REACTION_BUTTON_CLASS } from './compact-classes';
const LIVE_REACTION_FETCH_MS = 1000 * 45;
type Props = {
  uri: string;
  compact?: boolean;
};
export default function FileReactions(props: Props) {
  const { uri, compact } = props;
  const dispatch = useAppDispatch();
  const [reactionPending, setReactionPending] = React.useState(false);
  const reactionPendingRef = React.useRef(false);

  const claim = useAppSelector((state) => selectClaimForUri(state, uri));
  const claimId = claim?.claim_id;
  const myReaction = useAppSelector((state) => selectMyReactionForUri(state, uri));
  const likeCount = useAppSelector((state) => selectLikeCountForUri(state, uri));
  const dislikeCount = useAppSelector((state) => selectDislikeCountForUri(state, uri));
  const isLivestreamClaim = useAppSelector((state) => selectIsStreamPlaceholderForUri(state, uri));
  const scheduledState = useAppSelector((state) => selectScheduledStateForUri(state, uri));
  const disableSlimes = useAppSelector(
    (state) =>
      makeSelectTagInClaimOrChannelForUri(uri, DISABLE_SLIMES_ALL_TAG)(state) ||
      makeSelectTagInClaimOrChannelForUri(uri, DISABLE_SLIMES_VIDEO_TAG)(state)
  );

  const runReaction = React.useCallback((request: () => any) => {
    if (reactionPendingRef.current) return;
    reactionPendingRef.current = true;
    setReactionPending(true);
    Promise.resolve()
      .then(request)
      .finally(() => {
        reactionPendingRef.current = false;
        setReactionPending(false);
      });
  }, []);
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
  return (
    <div
      className={classnames(FILE_REACTIONS_CLASS, {
        [FILE_REACTIONS_DISABLED_CLASS]: scheduledState === 'scheduled',
        [FILE_REACTIONS_NO_SLIME_CLASS]: disableSlimes,
      })}
    >
      <LikeButton
        compact={compact}
        disabled={reactionPending}
        myReaction={myReaction}
        reactionCount={likeCount}
        onClick={() => runReaction(() => dispatch(doReactionLike(uri)))}
      />
      {!disableSlimes && (
        <DislikeButton
          compact={compact}
          disabled={reactionPending}
          myReaction={myReaction}
          reactionCount={dislikeCount}
          onClick={() => runReaction(() => dispatch(doReactionDislike(uri)))}
        />
      )}
      <RatioBar likeCount={likeCount} dislikeCount={disableSlimes ? 0 : dislikeCount} />
    </div>
  );
}
const Placeholder = <Skeleton variant="text" animation="wave" className={FILE_REACTION_COUNT_PLACEHOLDER_CLASS} />;
type ButtonProps = {
  compact?: boolean;
  disabled: boolean;
  myReaction: string | null | undefined;
  reactionCount: number;
  onClick: () => void;
};

const LikeButton = (props: ButtonProps) => {
  const { compact, disabled, myReaction, reactionCount, onClick } = props;
  return (
    <FileActionButton
      disabled={disabled}
      title={__('I like this')}
      requiresAuth={!hyperbeamNodeEnabled()}
      authSrc="filereaction_like"
      className={classnames(BUTTON_REACTION_LIKE_CLASS, compact && EMBED_COMPACT_REACTION_BUTTON_CLASS, {
        [BUTTON_REACTION_LIKE_ACTIVE_CLASS]: myReaction === REACTION_TYPES.LIKE,
      })}
      label={
        <>
          {myReaction === REACTION_TYPES.LIKE && <ButtonFireEffect />}
          {Number.isInteger(reactionCount) ? <Counter value={reactionCount} precision={0} /> : Placeholder}
        </>
      }
      iconSize={18}
      icon={myReaction === REACTION_TYPES.LIKE ? ICONS.FIRE_ACTIVE : ICONS.FIRE}
      onClick={onClick}
    />
  );
};

const DislikeButton = (props: ButtonProps) => {
  const { compact, disabled, myReaction, reactionCount, onClick } = props;
  return (
    <FileActionButton
      disabled={disabled}
      requiresAuth={!hyperbeamNodeEnabled()}
      authSrc={'filereaction_dislike'}
      title={__('I dislike this')}
      className={classnames(BUTTON_REACTION_DISLIKE_CLASS, compact && EMBED_COMPACT_REACTION_BUTTON_CLASS, {
        [BUTTON_REACTION_DISLIKE_ACTIVE_CLASS]: myReaction === REACTION_TYPES.DISLIKE,
      })}
      label={
        <>
          {myReaction === REACTION_TYPES.DISLIKE && <ButtonSlimeEffect />}
          {Number.isInteger(reactionCount) ? <Counter value={reactionCount} precision={0} /> : Placeholder}
        </>
      }
      iconSize={18}
      icon={myReaction === REACTION_TYPES.DISLIKE ? ICONS.SLIME_ACTIVE : ICONS.SLIME}
      onClick={onClick}
    />
  );
};
