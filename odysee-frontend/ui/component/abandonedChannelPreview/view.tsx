import React from 'react';
import classnames from 'classnames';
import ChannelThumbnail from 'component/channelThumbnail';
import { parseURI } from 'util/lbryURI';
import ChannelBlockButton from 'component/channelBlockButton';
import ChannelMuteButton from 'component/channelMuteButton';
import SubscribeButton from 'component/subscribeButton';
import { ABANDONED_CHANNEL_NOTICE_CLASS } from './classes';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { CLAIM_PREVIEW_LARGE_CLASS } from 'component/claimPreview/classes';
type Props = {
  uri: string;
  type: string;
};

function AbandonedChannelPreview(props: Props) {
  const { uri, type } = props;
  const { channelName } = parseURI(uri);
  return (
    <li className={classnames('claim-preview__wrapper', ABANDONED_CHANNEL_NOTICE_CLASS)}>
      <div
        className={classnames('claim-preview', {
          [CLAIM_PREVIEW_LARGE_CLASS]: type === 'large',
        })}
      >
        <ChannelThumbnail uri={uri} />
        <div className="claim-preview__text">
          <div className="claim-preview-metadata">
            <div className="claim-preview-info">
              <div className="claim-preview__title">{channelName}</div>
            </div>
            <div className="media__subtitle">{__(`This channel may have been unpublished.`)}</div>
          </div>
          <div className="claim-preview__actions">
            <div className={SECTION_CLASSES.actions}>
              <ChannelBlockButton uri={uri} />
              <ChannelMuteButton uri={uri} />
              <SubscribeButton uri={uri} />
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export default AbandonedChannelPreview;
