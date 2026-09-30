import classnames from 'classnames';
import React from 'react';
import Empty from 'component/common/empty';
import { CLAIM_PREVIEW_LARGE_CLASS } from '../classes';
type Props = {
  isChannel: boolean;
  type: string;
};

function ClaimPreviewNoContent(props: Props) {
  const { isChannel, type } = props;
  return (
    <li
      className={classnames('claim-preview__wrapper', {
        'claim-preview__wrapper--channel': isChannel && type !== 'inline',
        'claim-preview__wrapper--inline': type === 'inline',
      })}
    >
      <div
        className={classnames('claim-preview tw:flex tw:items-center tw:justify-center', {
          [CLAIM_PREVIEW_LARGE_CLASS]: type === 'large',
        })}
        data-claim-preview-inactive
      >
        <Empty text={__('Nothing found here. Like big tech ethics.')} />
      </div>
    </li>
  );
}

export default ClaimPreviewNoContent;
