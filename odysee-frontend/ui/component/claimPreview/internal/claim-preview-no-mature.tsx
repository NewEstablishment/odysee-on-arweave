import classnames from 'classnames';
import React from 'react';
import Empty from 'component/common/empty';
import ButtonRemoveFromCollection from './buttonRemoveFromCollection';
import { CLAIM_PREVIEW_HOVER_ACTIONS_GRID_CLASS } from '../hover-action-classes';
import { FILE_THUMBNAIL_CLASSES } from 'component/fileThumbnail/classes';
import { CLAIM_PREVIEW_LARGE_CLASS, CLAIM_PREVIEW_RECOMMENDATION_WRAPPER_CLASS } from '../classes';
type Props = {
  uri?: string;
  collectionId?: string | null | undefined;
  isChannel: boolean;
  type: string;
  message: string;
};

function ClaimPreviewHidden(props: Props) {
  const { uri, collectionId, isChannel, type, message } = props;
  return (
    <li
      className={classnames('claim-preview__wrapper', {
        'claim-preview__wrapper--channel': isChannel && type !== 'inline',
        'claim-preview__wrapper--inline': type === 'inline',
        [CLAIM_PREVIEW_RECOMMENDATION_WRAPPER_CLASS]: type === 'small',
      })}
    >
      <div
        className={classnames('claim-preview claim-preview--empty', {
          [CLAIM_PREVIEW_LARGE_CLASS]: type === 'large',
        })}
        data-claim-preview-inactive
      >
        <div
          className={classnames('media__thumb', {
            [FILE_THUMBNAIL_CLASSES.small]: type === 'small',
          })}
        >
          {collectionId && (
            <div className={CLAIM_PREVIEW_HOVER_ACTIONS_GRID_CLASS}>
              <ButtonRemoveFromCollection uri={uri} collectionId={collectionId} />
            </div>
          )}
        </div>

        <Empty text={message} />
      </div>
    </li>
  );
}

export default ClaimPreviewHidden;
