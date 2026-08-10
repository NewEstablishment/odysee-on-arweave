import * as PAGES from 'constants/pages';
import * as ICONS from 'constants/icons';
import * as CS from 'constants/claim_search';
import * as SETTINGS from 'constants/settings';
import React from 'react';
import ClaimListDiscover from 'component/claimListDiscover';
import Page from 'component/page';
import Button from 'component/button';
import Icon from 'component/common/icon';
import { lazyImport } from 'util/lazyImport';
import { tagSearchCsOptionsHook } from 'util/search';
import usePersistedState from 'effects/use-persisted-state';
import { useAppSelector } from 'redux/hooks';
import { selectSubscriptionIds } from 'redux/selectors/subscriptions';
import { selectClientSetting } from 'redux/selectors/settings';

const ChannelsFollowingDiscoverPage = lazyImport(
  () =>
    import(
      'page/channelsFollowingDiscover'
      /* webpackChunkName: "channelsFollowingDiscover" */
    )
);
function ChannelsFollowingPage() {
  const channelIds = useAppSelector(selectSubscriptionIds);
  const tileLayout = useAppSelector((state) => selectClientSetting(state, SETTINGS.TILE_LAYOUT));
  const hasSubscribedChannels = channelIds.length > 0;
  const [hideMembersOnly] = usePersistedState('channelPage-hideMembersOnly', false);
  return !hasSubscribedChannels ? (
    <React.Suspense fallback={null}>
      <ChannelsFollowingDiscoverPage />
    </React.Suspense>
  ) : (
    <Page noFooter fullWidthPage={tileLayout} className="main__channelsFollowing">
      <ClaimListDiscover
        streamType={CS.CONTENT_ALL}
        tileLayout={tileLayout}
        headerLabel={
          <h1 className="page__title">
            <Icon icon={ICONS.SUBSCRIBE} />
            <label>{__('Following')}</label>
          </h1>
        }
        hideMembersOnly={hideMembersOnly}
        defaultOrderBy={CS.ORDER_BY_NEW}
        channelIds={channelIds}
        releaseTime=">0"
        meta={
          <>
            <Button
              icon={ICONS.SEARCH}
              button="alt"
              label={__('Discover Channels')}
              navigate={`/$/${PAGES.CHANNELS_FOLLOWING_DISCOVER}`}
            />
            <Button
              icon={ICONS.SETTINGS}
              button="alt"
              label={__('Manage')}
              navigate={`/$/${PAGES.CHANNELS_FOLLOWING_MANAGE}`}
            />
          </>
        }
        hasSource
        csOptionsHook={tagSearchCsOptionsHook}
      />
    </Page>
  );
}

export default ChannelsFollowingPage;
