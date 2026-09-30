import React from 'react';
import Button from 'component/button';
import classnames from 'classnames';
import { SHORTS_DOCUMENT_PLAYING_TARGET_CLASS } from 'component/shortsActions/classes';
import {
  SHORTS_VIEW_MODE_BUTTON_ACTIVE_CLASS,
  SHORTS_VIEW_MODE_BUTTON_CLASS,
  SHORTS_VIEW_MODE_TOGGLE_CLASS,
  SHORTS_VIEW_MODE_TOGGLE_HIDDEN_CLASS,
} from './classes';
type Props = {
  viewMode: string;
  channelName: string | null | undefined;
  onViewModeChange: (mode: string) => void;
  isTransitioning?: boolean;
};
const ViewModeToggle = React.memo<Props>(({ viewMode, channelName, onViewModeChange, isTransitioning }: Props) => {
  return (
    <div
      className={classnames(SHORTS_VIEW_MODE_TOGGLE_CLASS, SHORTS_DOCUMENT_PLAYING_TARGET_CLASS, {
        [SHORTS_VIEW_MODE_TOGGLE_HIDDEN_CLASS]: isTransitioning,
      })}
    >
      <Button
        className={classnames(SHORTS_VIEW_MODE_BUTTON_CLASS, {
          [SHORTS_VIEW_MODE_BUTTON_ACTIVE_CLASS]: viewMode === 'related',
        })}
        label={__('Related')}
        onClick={(e) => {
          e.stopPropagation();
          onViewModeChange('related');
        }}
      />
      <Button
        className={classnames(SHORTS_VIEW_MODE_BUTTON_CLASS, {
          [SHORTS_VIEW_MODE_BUTTON_ACTIVE_CLASS]: viewMode === 'channel',
        })}
        label={__('From %channel%', {
          channel:
            channelName && channelName.length > 15 ? channelName.substring(0, 15) + '...' : channelName || 'Channel',
        })}
        onClick={(e) => {
          e.stopPropagation();
          onViewModeChange('channel');
        }}
      />
    </div>
  );
});
export default ViewModeToggle;
