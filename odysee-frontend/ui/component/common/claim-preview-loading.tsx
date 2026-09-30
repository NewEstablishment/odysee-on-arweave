import classnames from 'classnames';
import React from 'react';
import {
  CLAIM_PREVIEW_PLACEHOLDER_CHANNEL_ROW_CLASS,
  CLAIM_PREVIEW_PLACEHOLDER_CLASSES,
} from './claim-preview-loading-classes';
import { FILE_THUMBNAIL_CLASSES } from 'component/fileThumbnail/classes';
import { CLAIM_PREVIEW_LARGE_CLASS, CLAIM_PREVIEW_RECOMMENDATION_WRAPPER_CLASS } from 'component/claimPreview/classes';
type Props = {
  isChannel?: boolean;
  type?: string;
  WrapperElement?: any;
  xsmall?: boolean;
  className?: string;
  children?: React.ReactNode;
};

function ClaimPreviewLoading(props: Props) {
  const { isChannel, type, WrapperElement = 'li', xsmall } = props;
  return (
    // Uses the same WrapperElement as claimPreview so it's consistent with the rest of the list components
    <WrapperElement
      className={classnames(CLAIM_PREVIEW_PLACEHOLDER_CLASSES.rowRoot, {
        'claim-preview__wrapper--channel': isChannel && type !== 'inline',
        'claim-preview__wrapper--inline': type === 'inline',
        [CLAIM_PREVIEW_RECOMMENDATION_WRAPPER_CLASS]: type === 'small',
        'claim-preview__wrapper--row': type !== 'small',
      })}
    >
      <div
        className={classnames('claim-preview', {
          [CLAIM_PREVIEW_LARGE_CLASS]: type === 'large',
        })}
      >
        <div
          className={classnames(
            CLAIM_PREVIEW_PLACEHOLDER_CLASSES.thumbnail,
            CLAIM_PREVIEW_PLACEHOLDER_CLASSES.rowThumbnail,
            {
              [FILE_THUMBNAIL_CLASSES.small]: xsmall,
            }
          )}
        />
        <div className={CLAIM_PREVIEW_PLACEHOLDER_CLASSES.wrapper}>
          <div className={CLAIM_PREVIEW_PLACEHOLDER_CLASSES.rowTitle} />
          <div className={CLAIM_PREVIEW_PLACEHOLDER_CLASSES.rowSecondaryTitle} />
          <div className="claim-tile__info">
            <div className={CLAIM_PREVIEW_PLACEHOLDER_CHANNEL_ROW_CLASS} />
            <div className={CLAIM_PREVIEW_PLACEHOLDER_CLASSES.about}>
              <div className={CLAIM_PREVIEW_PLACEHOLDER_CLASSES.subtitle} />
              <div className={CLAIM_PREVIEW_PLACEHOLDER_CLASSES.secondarySubtitle} />
            </div>
          </div>
        </div>
      </div>
    </WrapperElement>
  );
}

export default ClaimPreviewLoading;
