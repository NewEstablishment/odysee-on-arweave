import React from 'react';
import { UPCOMING_CLAIMS_CLASSES } from './classes';
import dayjs from 'util/dayjs';
import classnames from 'classnames';
import ClaimList from 'component/claimList';
import Icon from 'component/common/icon';
import ClaimPreviewTile from 'component/claimPreviewTile';
import * as ICONS from 'constants/icons';
import { useIsMobile, useIsSmallScreen, useIsLargeScreen } from 'effects/use-screensize';
import Button from 'component/button';
import { BUTTON_CONTENT_CLASS } from 'component/button/classes';
import { ICON_WRAPPER_CLASS } from 'component/common/icon-classes';
import {
  CLAIM_GRID_CLASS,
  CLAIM_GRID_HEADER_CLASS,
  CLAIM_GRID_SECONDARY_TITLE_CLASS,
  CLAIM_GRID_TITLE_CLASS,
  CLAIM_GRID_VIEW_MORE_CLASS,
} from 'component/common/claim-grid-classes';
import * as SETTINGS from 'constants/settings';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectMutedAndBlockedChannelIds } from 'redux/selectors/blocked';
import { selectClaimSearchByQuery } from 'redux/selectors/claims';
import { selectClientSetting } from 'redux/selectors/settings';
import { doClaimSearch as doClaimSearchAction } from 'redux/actions/claims';
import { doSetClientSetting } from 'redux/actions/settings';
import { LIVESTREAM_UPCOMING_BUFFER } from 'constants/livestream';
import { SCHEDULED_TAGS } from 'constants/tags';
import { createNormalizedClaimSearchKey } from 'util/claim';
import { CsOptHelper } from 'util/claim-search';

function getUpcomingReleaseTime() {
  return `>${dayjs().subtract(LIVESTREAM_UPCOMING_BUFFER, 'minutes').startOf('minute').unix()}`;
}

function buildUpcomingOptions(
  mutedAndBlockedIds: any,
  channelIds: Array<string>,
  isLivestream: boolean,
  limitPerChannel?: number
): ClaimSearchOptions {
  return {
    page: 1,
    page_size: 50,
    no_totals: true,
    claim_type: ['stream'],
    remove_duplicates: true,
    any_tags: isLivestream ? [SCHEDULED_TAGS.LIVE] : [SCHEDULED_TAGS.SHOW],
    channel_ids: channelIds || [],
    not_channel_ids: mutedAndBlockedIds,
    not_tags: CsOptHelper.not_tags(),
    order_by: ['^release_time'],
    release_time: getUpcomingReleaseTime(),
    ...(isLivestream ? { has_no_source: true } : { has_source: true }),
    ...(isLivestream && limitPerChannel ? { limit_claims_per_channel: limitPerChannel } : {}),
  };
}

// ****************************************************************************
// ****************************************************************************
export type Props = {
  name: string;
  // unique instance name
  channelIds: Array<string>;
  tileLayout: boolean;
  liveUris?: Array<string> | null | undefined;
  // ones that have gone live (not upcoming anymore)
  limitClaimsPerChannel?: number;
  loading?: boolean;
  isChannelPage?: boolean;
  onLoad?: (arg0: number) => void;
  showHideSetting?: boolean;
};

// ****************************************************************************
// UpcomingClaims
// ****************************************************************************
const UpcomingClaims = (props: Props) => {
  const {
    name,
    channelIds,
    tileLayout,
    liveUris = [],
    loading,
    isChannelPage,
    limitClaimsPerChannel,
    showHideSetting = true,
  } = props;
  const dispatch = useAppDispatch();
  const csByQuery = useAppSelector(selectClaimSearchByQuery) || {};
  const mutedAndBlockedChannelIds = useAppSelector(selectMutedAndBlockedChannelIds);
  const validChannelIds = React.useMemo(() => channelIds.filter(Boolean), [channelIds]);
  const hasRequiredChannelScope = !isChannelPage || validChannelIds.length > 0;
  const livestreamOptions = React.useMemo(
    () =>
      hasRequiredChannelScope
        ? buildUpcomingOptions(mutedAndBlockedChannelIds, validChannelIds, true, limitClaimsPerChannel)
        : null,
    [mutedAndBlockedChannelIds, validChannelIds, hasRequiredChannelScope, limitClaimsPerChannel]
  );
  const scheduledOptions = React.useMemo(
    () => (hasRequiredChannelScope ? buildUpcomingOptions(mutedAndBlockedChannelIds, validChannelIds, false) : null),
    [mutedAndBlockedChannelIds, validChannelIds, hasRequiredChannelScope]
  );
  const loKey = livestreamOptions ? createNormalizedClaimSearchKey(livestreamOptions) : '';
  const soKey = scheduledOptions ? createNormalizedClaimSearchKey(scheduledOptions) : '';
  const livestreamUris = csByQuery[loKey];
  const scheduledUris = csByQuery[soKey];
  const hideUpcoming = useAppSelector((state) => selectClientSetting(state, SETTINGS.HIDE_SCHEDULED_LIVESTREAMS));
  const doClaimSearch = React.useCallback(
    (csOptions: ClaimSearchOptions) => dispatch(doClaimSearchAction(csOptions)),
    [dispatch]
  );
  const isMobileScreen = useIsMobile();
  const isSmallScreen = useIsSmallScreen();
  const isLargeScreen = useIsLargeScreen();
  const [showAllUpcoming, setShowAllUpcoming] = React.useState(false);
  const upcomingMax = React.useMemo(() => {
    let multiply = 1;
    if (showAllUpcoming) multiply = 2;
    if (isLargeScreen) return 6 * multiply;
    if (isMobileScreen || isSmallScreen) return 3 * multiply;
    return 4 * multiply;
  }, [showAllUpcoming, isMobileScreen, isSmallScreen, isLargeScreen]);
  const list = React.useMemo(() => {
    let uris = (livestreamUris || []).concat(scheduledUris || []);

    if (liveUris) {
      uris = uris.filter((x) => !liveUris.includes(x));
    }

    if (uris.length > 12) uris = uris.slice(0, 12);
    return {
      uris: upcomingMax > 0 ? uris.slice(0, upcomingMax) : uris,
      total: uris.length,
    };
  }, [liveUris, livestreamUris, scheduledUris, upcomingMax]);

  const hideScheduled = (e) => {
    dispatch(doSetClientSetting(SETTINGS.HIDE_SCHEDULED_LIVESTREAMS, e, true));
  };

  const Header = () => {
    if (list.total === 0) return null;
    return (
      <div
        className={CLAIM_GRID_HEADER_CLASS}
        data-claim-grid-header
        onClick={() => {
          showHideSetting && hideScheduled(!hideUpcoming);
        }}
      >
        <div className={BUTTON_CONTENT_CLASS}>
          <span className={ICON_WRAPPER_CLASS}>
            <Icon icon={ICONS.TIME} />
          </span>
          <span className={CLAIM_GRID_TITLE_CLASS} data-claim-grid-title>
            {__('Upcoming')}
          </span>

          {showHideSetting && (
            <div className={UPCOMING_CLAIMS_CLASSES.visibility} onClick={() => hideScheduled(!hideUpcoming)}>
              <Icon icon={hideUpcoming ? ICONS.EYE : ICONS.EYE_OFF} />
              <span>{hideUpcoming ? __('Show') : __('Hide')}</span>
              <div className={UPCOMING_CLAIMS_CLASSES.counter}>
                {Math.min(list.total, showAllUpcoming ? upcomingMax : upcomingMax * 2)}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  React.useEffect(() => {
    if (livestreamOptions) {
      doClaimSearch(livestreamOptions);
    }
  }, [doClaimSearch, livestreamOptions]);
  React.useEffect(() => {
    if (scheduledOptions) {
      doClaimSearch(scheduledOptions);
    }
  }, [doClaimSearch, scheduledOptions]);
  if (isChannelPage && list.total === 0) return null;
  const isGridLayout = showHideSetting && tileLayout;
  const isListLayout = !isGridLayout;
  const isClosed =
    (hideUpcoming && showHideSetting) ||
    (showHideSetting && list.total === 0 && !loading) ||
    (!showHideSetting && list.total === 0 && !loading);
  return (
    <div
      className={classnames(UPCOMING_CLAIMS_CLASSES.root, {
        [UPCOMING_CLAIMS_CLASSES.grid]: isGridLayout,
        [UPCOMING_CLAIMS_CLASSES.list]: isListLayout,
        [UPCOMING_CLAIMS_CLASSES.extended]: showAllUpcoming,
        [UPCOMING_CLAIMS_CLASSES.closed]: isClosed,
      })}
      data-upcoming-grid={isGridLayout ? '' : undefined}
      data-upcoming-list={isListLayout ? '' : undefined}
      data-upcoming-extended={showAllUpcoming ? '' : undefined}
      data-upcoming-closed={isClosed ? '' : undefined}
    >
      <Header />
      {loading && (
        <section className={CLAIM_GRID_CLASS}>
          {Array.from({ length: upcomingMax }, (_, i) => (
            <ClaimPreviewTile key={i} placeholder="loading" pulse />
          ))}
        </section>
      )}

      {!loading && list.total > 0 && <ClaimList uris={list.uris} tileLayout={tileLayout} showNoSourceClaims />}
      {list.total > upcomingMax && !showAllUpcoming && !isChannelPage && !hideUpcoming && (
        <div className={CLAIM_GRID_VIEW_MORE_CLASS}>
          <Button
            label={__('Show more upcoming content')}
            button="link"
            iconRight={ICONS.ARROW_RIGHT}
            className={CLAIM_GRID_SECONDARY_TITLE_CLASS}
            onClick={() => setShowAllUpcoming(true)}
          />
        </div>
      )}

      {showAllUpcoming && !hideUpcoming && (
        <div className={CLAIM_GRID_VIEW_MORE_CLASS}>
          <Button
            label={__('Show less upcoming content')}
            button="link"
            iconRight={ICONS.ARROW_RIGHT}
            className={CLAIM_GRID_SECONDARY_TITLE_CLASS}
            onClick={() => {
              if (isMobileScreen)
                window.scrollTo({
                  top: 0,
                  left: 0,
                  behavior: 'smooth',
                });
              setShowAllUpcoming(false);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default UpcomingClaims;
