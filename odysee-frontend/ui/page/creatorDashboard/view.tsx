import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import * as PAGES from 'constants/pages';
import React from 'react';
import Page from 'component/page';
import Spinner from 'component/spinner';
import Button from 'component/button';
import CreatorAnalytics from 'component/creatorAnalytics';
import ChannelSelector from 'component/channelSelector';
import Yrbl from 'component/yrbl';
import { useAppSelector } from 'redux/hooks';
import { selectHasChannels, selectFetchingMyChannels } from 'redux/selectors/claims';
import { selectActiveChannelClaim } from 'redux/selectors/app';
import { SECTION_CLASSES } from 'component/common/section-classes';

export default function CreatorDashboardPage() {
  const hasChannels = useAppSelector(selectHasChannels);
  const fetchingChannels = useAppSelector(selectFetchingMyChannels);
  const activeChannelClaim = useAppSelector(selectActiveChannelClaim);
  return (
    <Page>
      {fetchingChannels && (
        <div className={PAGE_MAIN_EMPTY_CLASS}>
          <Spinner delayed />
        </div>
      )}

      {!fetchingChannels && !hasChannels && (
        <Yrbl
          type="happy"
          title={__("You haven't created a channel yet, let's fix that!")}
          actions={
            <div className={SECTION_CLASSES.actions}>
              <Button button="primary" navigate={`/$/${PAGES.CHANNEL_NEW}`} label={__('Create A Channel')} />
            </div>
          }
        />
      )}

      {!fetchingChannels && activeChannelClaim && (
        <React.Fragment>
          <ChannelSelector hideAnon />
          <CreatorAnalytics uri={activeChannelClaim.canonical_url} />
        </React.Fragment>
      )}
    </Page>
  );
}
