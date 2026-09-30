import React from 'react';
import classnames from 'classnames';
import { Menu, MenuButton, MenuList, MenuItem } from 'component/common/menu';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import { SHORTS_PAGE_MENU_BUTTON_CLASS } from '../../classes';
import {
  SHORTS_VIEW_MENU_CLASS,
  SHORTS_VIEW_MENU_LINK_CLASS,
  SHORTS_VIEW_MENU_OPTION_ACTIVE_CLASS,
  SHORTS_VIEW_MENU_OPTION_CLASS,
} from './classes';
type Props = {
  viewMode: string;
  channelName?: string;
  onViewModeChange: (mode: string) => void;
};

const ViewModeSelector = ({ viewMode, channelName, onViewModeChange }: Props) => {
  return (
    <Menu>
      <MenuButton
        className={SHORTS_PAGE_MENU_BUTTON_CLASS}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <Icon size={20} icon={ICONS.MORE} />
      </MenuButton>

      <MenuList className={SHORTS_VIEW_MENU_CLASS}>
        <MenuItem
          className={classnames(SHORTS_VIEW_MENU_OPTION_CLASS, {
            [SHORTS_VIEW_MENU_OPTION_ACTIVE_CLASS]: viewMode === 'related',
          })}
          onSelect={() => onViewModeChange('related')}
        >
          <div className={SHORTS_VIEW_MENU_LINK_CLASS}>{__('Related')}</div>
        </MenuItem>

        <MenuItem
          className={classnames(SHORTS_VIEW_MENU_OPTION_CLASS, {
            [SHORTS_VIEW_MENU_OPTION_ACTIVE_CLASS]: viewMode === 'channel',
          })}
          onSelect={() => onViewModeChange('channel')}
        >
          <div className={SHORTS_VIEW_MENU_LINK_CLASS}>
            {__('From %channel%', {
              channel:
                channelName && channelName.length > 20
                  ? channelName.substring(0, 20) + '...'
                  : channelName || 'Channel',
            })}
          </div>
        </MenuItem>
      </MenuList>
    </Menu>
  );
};

export default ViewModeSelector;
