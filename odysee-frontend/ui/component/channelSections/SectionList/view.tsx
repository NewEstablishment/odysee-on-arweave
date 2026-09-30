import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import React from 'react';
import classnames from 'classnames';
import Button from 'component/button';
import Section from 'component/channelSections/Section';
import Spinner from 'component/spinner';
import * as ICONS from 'constants/icons';
import * as MODALS from 'constants/modal_types';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doOpenModal } from 'redux/actions/app';
import { selectClaimIdForUri } from 'redux/selectors/claims';
import { selectFeaturedChannelsForChannelId, selectFetchingCreatorSettings } from 'redux/selectors/comments';
import { EMPTY_CLASS } from 'component/common/empty-classes';

type Props = {
  uri: string;
  editMode?: boolean;
};
export default function SectionList(props: Props) {
  const { uri, editMode } = props;
  const dispatch = useAppDispatch();

  const claimId = useAppSelector((state) => selectClaimIdForUri(state, uri));
  const featuredChannels = useAppSelector((state) => selectFeaturedChannelsForChannelId(state, claimId));
  const fetchingCreatorSettings = useAppSelector(selectFetchingCreatorSettings);
  const sectionCount = featuredChannels ? featuredChannels.length : 0;

  function handleAddFeaturedChannels() {
    dispatch(
      doOpenModal(MODALS.FEATURED_CHANNELS_EDIT, {
        channelId: claimId,
      })
    );
  }

  function handleSort() {
    dispatch(
      doOpenModal(MODALS.FEATURED_CHANNELS_SORT, {
        channelId: claimId,
      })
    );
  }

  return (
    <div
      className={classnames({
        'tw:pointer-events-none tw:opacity-30': fetchingCreatorSettings,
      })}
    >
      {editMode && (
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:[&_svg]:cursor-pointer">
          {fetchingCreatorSettings && <Spinner type="small" />}
          {sectionCount > 1 && (
            <Button
              className="tw:mt-app-xs tw:ml-app-s"
              title={__('Sort')}
              button="secondary"
              icon={ICONS.ARRANGE}
              onClick={handleSort}
            />
          )}
          <Button
            label={__('Add featured channels')}
            className="tw:mt-app-xs tw:ml-app-s"
            button="primary"
            icon={ICONS.ADD}
            onClick={handleAddFeaturedChannels}
          />
        </div>
      )}
      <div className="channel_sections__list">
        {sectionCount === 0 && (
          <div className={`${EMPTY_CLASS} ${PAGE_MAIN_EMPTY_CLASS}`}>
            {fetchingCreatorSettings && <Spinner />}
            {!fetchingCreatorSettings && __('No featured channels.')}
          </div>
        )}
        {!fetchingCreatorSettings &&
          featuredChannels &&
          featuredChannels.map((fc) => (
            <Section
              key={fc.id}
              id={fc.id}
              title={fc.value.title}
              uris={fc.value.uris}
              channelId={claimId}
              sectionListMenu
            />
          ))}
      </div>
    </div>
  );
}
