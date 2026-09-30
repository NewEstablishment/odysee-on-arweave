import Button from 'component/button';
import CommentView from 'component/comment';
import React from 'react';
import Spinner from 'component/spinner';
import { selectIsFetchingCommentsForParentId, selectRepliesForParentId } from 'redux/selectors/comments';
import { useAppSelector } from 'redux/hooks';
import { COMMENT_NESTED_ACTIONS_CLASS, COMMENT_REPLIES_CLASS } from './classes';
import { URI_INDICATOR_CLASS } from 'component/uriIndicator/classes';

// ****************************************************************************
// ****************************************************************************
export type Props = {
  uri?: string;
  parentId: CommentId;
  linkedCommentId?: string;
  threadCommentId?: string | null | undefined;
  numDirectReplies: number;
  // Total replies for parentId as reported by 'comment[replies]'. Includes blocked items.
  hasMore: boolean;
  supportDisabled?: boolean;
  threadDepthLevel?: number;
  onShowMore?: () => void;
  threadLevel: number;
  updateUiFilteredComments?: (commentIds: Array<string>) => void;
};

// ****************************************************************************
// CommentsReplies
// ****************************************************************************

export default function CommentsReplies(props: Props) {
  const {
    parentId,
    uri,
    linkedCommentId,
    threadCommentId,
    numDirectReplies,
    hasMore,
    supportDisabled,
    threadDepthLevel,
    onShowMore,
    threadLevel,
    updateUiFilteredComments,
  } = props;

  const fetchedReplies = useAppSelector((state) => selectRepliesForParentId(state, parentId));
  const isFetching = useAppSelector((state) => selectIsFetchingCommentsForParentId(state, parentId));
  return !numDirectReplies ? null : (
    <div className="tw:m-0 tw:overflow-x-hidden">
      <ul className={COMMENT_REPLIES_CLASS}>
        {fetchedReplies.map((comment) => (
          <CommentView
            key={comment.comment_id}
            uri={uri}
            comment={comment}
            linkedCommentId={linkedCommentId}
            threadCommentId={threadCommentId}
            supportDisabled={supportDisabled}
            threadLevel={threadLevel + 1}
            threadDepthLevel={threadDepthLevel}
            updateUiFilteredComments={updateUiFilteredComments}
          />
        ))}
      </ul>

      {fetchedReplies.length > 0 &&
        hasMore &&
        (isFetching ? (
          <span
            className={`${COMMENT_NESTED_ACTIONS_CLASS} comment__replies-loading--more tw:items-start tw:[transform:translate(var(--spacing-xs))]`}
          >
            <Spinner text={__('Loading')} type="small" />
          </span>
        ) : (
          <div className={COMMENT_NESTED_ACTIONS_CLASS}>
            <Button
              button="link"
              label={__('Show more')}
              onClick={() => onShowMore && onShowMore()}
              className={URI_INDICATOR_CLASS}
            />
          </div>
        ))}
    </div>
  );
}
