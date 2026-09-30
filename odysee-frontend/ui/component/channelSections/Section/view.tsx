import React from 'react';
import { Menu, MenuList, MenuButton, MenuItem } from 'component/common/menu';
import classnames from 'classnames';
import { useLocation, useNavigate } from 'react-router-dom';
import ChannelThumbnail from 'component/channelThumbnail';
import ChannelTitle from 'component/channelTitle';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import * as MODALS from 'constants/modal_types';
import * as PAGES from 'constants/pages';
import { CHANNEL_SECTIONS_QUERIES as CSQ } from 'constants/urlParams';
import { formatLbryUrlForWeb } from 'util/url';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doOpenModal } from 'redux/actions/app';
import { doDeleteChannelSection } from 'redux/actions/comments';
import { selectClaimIsMineForId } from 'redux/selectors/claims';
import { CHANNEL_SECTION_ITEM_CLASS } from './classes';

type Props = {
  id?: string;
  title?: string;
  uris: Array<string>;
  channelId: ClaimId;
  sectionListMenu?: boolean;
};

const ContextMenuItem = (props: { label: string; icon: string; onSelect: any }) => (
  <MenuItem className="menu__link" onSelect={props.onSelect}>
    <Icon aria-hidden icon={props.icon} />
    {__(props.label)}
  </MenuItem>
);

export default function Section(props: Props) {
  const { id, title, uris, channelId, sectionListMenu } = props;
  const dispatch = useAppDispatch();
  const isChannelMine = useAppSelector((state) => selectClaimIsMineForId(state, channelId));
  const navigate = useNavigate();
  const location = useLocation();

  // **************************************************************************
  // **************************************************************************

  const ContextMenu = (props: {}) => (
    <Menu>
      <MenuButton
        className={classnames('menu__button', {
          'tw:group-hover/section:opacity-100': !sectionListMenu,
          'tw:group tw:[transform:rotate(0deg)] tw:[transition:transform_0.4s] tw:aria-expanded:rounded-[50%] tw:aria-expanded:bg-[var(--color-header-button)] tw:aria-expanded:opacity-100 tw:aria-expanded:[transform:rotate(90deg)]':
            sectionListMenu,
        })}
      >
        <Icon
          className={classnames({ 'tw:group-aria-expanded:stroke-app-primary': sectionListMenu })}
          size={18}
          icon={ICONS.MORE_VERTICAL}
        />
      </MenuButton>

      <MenuList className="menu__list">
        {isChannelMine && (
          <>
            {!location.search.includes('sectionId') && (
              <ContextMenuItem
                label={'View'}
                icon={ICONS.EYE}
                onSelect={() =>
                  navigate(`/$/${PAGES.FEATURED_CHANNELS}?${CSQ.CLAIM_ID}=${channelId}&${CSQ.SECTION_ID}=${id}`)
                }
              />
            )}
            <ContextMenuItem label={'Edit'} icon={ICONS.EDIT} onSelect={handleSectionEdit} />
            <ContextMenuItem label={'Delete'} icon={ICONS.DELETE} onSelect={handleSectionDelete} />
          </>
        )}
      </MenuList>
    </Menu>
  );

  // **************************************************************************
  // **************************************************************************
  function handleSectionEdit() {
    dispatch(
      doOpenModal(MODALS.FEATURED_CHANNELS_EDIT, {
        channelId,
        sectionId: id,
      })
    );
  }

  function handleSectionDelete() {
    dispatch(
      doOpenModal(MODALS.CONFIRM, {
        title: title
          ? __('Delete "%list_name%"?', {
              list_name: title.slice(0, 50),
            })
          : __('Delete featured channels?'),
        subtitle: __('This action is permanent and cannot be undone.'),
        labelOk: __('Delete'),
        onConfirm: (closeModal) => {
          dispatch(doDeleteChannelSection(channelId, id));
          closeModal();
        },
      })
    );
  }

  // **************************************************************************
  // **************************************************************************
  return (
    <div className="tw:group/section tw:mt-app-l tw:w-full tw:rounded-app">
      <div className="tw:mb-app-s tw:flex tw:items-center tw:justify-between tw:border-b tw:border-b-app-border tw:pb-app-xs tw:text-app-large">
        <div className="tw:mr-app-l tw:flex tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{title}</div>
        <div className={classnames('tw:px-app-s tw:leading-none', { 'tw:p-[unset]': sectionListMenu })}>
          {isChannelMine && <ContextMenu />}
        </div>
      </div>
      <div>
        <div className="tw:flex tw:justify-between">
          <div className="tw:mb-app-l tw:grid tw:w-full tw:grid-cols-[repeat(auto-fill,minmax(calc(100%/9),1fr))] tw:gap-app-s tw:upto-medium:grid-cols-[repeat(auto-fill,minmax(calc(100%/7),1fr))] tw:upto-small:grid-cols-[repeat(auto-fill,minmax(calc(100%/4),1fr))]">
            {uris.map((uri) => (
              <div
                key={uri}
                className={CHANNEL_SECTION_ITEM_CLASS}
                onClick={() => navigate(formatLbryUrlForWeb(uri) + '?view=home')}
              >
                <ChannelThumbnail uri={uri} />
                <ChannelTitle uri={uri} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
