import { lazyImport } from 'util/lazyImport';
import { useIsMobile, useIsMobileLandscape } from 'effects/use-screensize';
import FileTitleSection from 'component/fileTitleSection';
import LivestreamLink from 'component/livestreamLink';
import React from 'react';
import { PRIMARY_PLAYER_WRAPPER_CLASS } from 'constants/player';
import VideoClaimInitiator from 'component/videoClaimInitiator';
import LivestreamBrowserViewer from 'component/livestreamBrowserViewer';
import * as ICONS from 'constants/icons';
import * as SETTINGS from 'constants/settings';
import MobileTabView from 'component/mobileTabView';
import RecommendedContent from 'component/recommendedContent';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectClaimForUri, selectClaimIsMineForUri } from 'redux/selectors/claims';
import { selectClientSetting } from 'redux/selectors/settings';
import {
  getActiveLivestreamUri,
  selectActiveLivestreamForChannel,
  selectLivestreamInfoAlreadyFetchedForCreatorId,
} from 'redux/selectors/livestream';
import { selectCommentsDisabledSettingForChannelId } from 'redux/selectors/comments';
import { getChannelIdFromClaim, getClaimScheduledState, isStreamPlaceholderClaim } from 'util/claim';
import { doClearPlayingUri as doClearPlayingUriAction } from 'redux/actions/content';
import useLivestreamMetrics from 'effects/use-livestream-metrics';
import LivestreamMetrics from 'component/livestreamMetrics/view';
import Lbry from 'lbry';
import { toHex } from 'util/hex';

const LivestreamScheduledInfo = lazyImport(
  () =>
    import(
      'component/livestreamScheduledInfo'
      /* webpackChunkName: "livestreamScheduledInfo" */
    )
);
const ChatLayout = lazyImport(
  () =>
    import(
      'component/chat'
      /* webpackChunkName: "chat" */
    )
);
const VIEW_MODES = {
  CHAT: 'chat',
  SUPERCHAT: 'sc',
};

const LIVESTREAM_TAB_DEFS = [
  { icon: ICONS.INFO, label: 'Info' },
  { icon: ICONS.CHAT, label: 'Chat' },
  { icon: ICONS.DISCOVER, label: 'Related' },
];

type Props = {
  uri: string;
  livestreamChatEnabled: boolean;
};
export default function LivestreamLayout(props: Props) {
  const { uri, livestreamChatEnabled } = props;
  const dispatch = useAppDispatch();
  const claim = useAppSelector((state) => selectClaimForUri(state, uri));
  const channelId = getChannelIdFromClaim(claim);
  const activeLivestream = useAppSelector((state) => selectActiveLivestreamForChannel(state, channelId));
  const liveStatusFetched = useAppSelector((state) =>
    channelId ? selectLivestreamInfoAlreadyFetchedForCreatorId(state, channelId) : false
  );
  const activeStreamUri = getActiveLivestreamUri(activeLivestream);
  const activeLivestreamClaimId = activeLivestream?.claimId || activeLivestream?.claim_id || null;
  const activeLivestreamVideoUrl = activeLivestream?.videoUrlPublic || activeLivestream?.videoUrl || null;
  const activeLivestreamP2PTrackerUrl = activeLivestream?.p2pTrackerUrl || null;
  const activeLivestreamP2PSwarmId = activeLivestream?.p2pSwarmId || null;
  const isCurrentClaimLive =
    activeLivestreamClaimId === claim?.claim_id ||
    Boolean(
      activeStreamUri && [claim?.claimUri, claim?.uri, claim?.canonical_url, claim?.permanent_url].includes(activeStreamUri)
    );
  const chatDisabled = useAppSelector((state) => selectCommentsDisabledSettingForChannelId(state, channelId));
  const videoTheaterMode = useAppSelector((state) => selectClientSetting(state, SETTINGS.VIDEO_THEATER_MODE));
  const scheduledState = claim ? getClaimScheduledState(claim) : 'non-scheduled';
  const showScheduledInfo = scheduledState === 'scheduled' || scheduledState === 'started';
  const isLivestreamClaim = isStreamPlaceholderClaim(claim);
  const discoverBrowserLivestream = Boolean(isLivestreamClaim && !activeLivestreamVideoUrl);
  const doClearPlayingUri = () => dispatch(doClearPlayingUriAction());

  const isMobile = useIsMobile();
  const isLandscapeRotated = useIsMobileLandscape();

  const [hyperchatsHidden] = React.useState(false);
  const [chatViewMode, setChatViewMode] = React.useState(VIEW_MODES.CHAT);

  // Creator-only stream metrics
  const claimIsMine = useAppSelector((state) => selectClaimIsMineForUri(state, uri));
  const signingChannel = claim?.signing_channel;
  const myChannelName = claimIsMine ? signingChannel?.name : undefined;
  const myChannelId = claimIsMine ? signingChannel?.claim_id : undefined;
  const [sigData, setSigData] = React.useState<{ signature?: string; signing_ts?: string }>({});
  React.useEffect(() => {
    if (myChannelId && myChannelName) {
      Lbry.channel_sign({ channel_id: myChannelId, hexdata: toHex(myChannelName) })
        .then((data: any) => setSigData(data))
        .catch(() => setSigData({}));
    }
  }, [myChannelId, myChannelName]);
  const metricsActive = Boolean(claimIsMine && isCurrentClaimLive);
  const serverMetrics = useLivestreamMetrics(
    myChannelId,
    myChannelName,
    sigData.signature,
    sigData.signing_ts,
    metricsActive
  );

  const liveStatusFetching = Boolean(channelId && !liveStatusFetched);
  React.useEffect(() => {
    if (!isCurrentClaimLive && doClearPlayingUri) doClearPlayingUri(); // eslint-disable-next-line react-hooks/exhaustive-deps -- @see TODO_NEED_VERIFICATION
  }, [isCurrentClaimLive]);
  if (!claim || !claim.signing_channel) return null;
  const { name: channelName } = claim.signing_channel;
  const isMobilePortrait = isMobile && !isLandscapeRotated;

  const noticeContent =
    !liveStatusFetching && !activeStreamUri && !showScheduledInfo && !isCurrentClaimLive ? (
      <div className="help--notice" style={{ marginTop: '20px' }}>
        {channelName
          ? __("%channelName% isn't live right now, but the chat is! Check back later to watch the stream.", {
              channelName,
            })
          : __("This channel isn't live right now, but the chat is! Check back later to watch the stream.")}
      </div>
    ) : (
      chatDisabled && (
        <div className="help--notice">
          {channelName
            ? __('%channel% has disabled chat for this stream. Enjoy the stream!', { channel: channelName })
            : __('This channel has disabled chat for this stream. Enjoy the stream!')}
        </div>
      )
    );
  const scheduledInfo = showScheduledInfo ? <LivestreamScheduledInfo uri={claim.canonical_url} /> : null;
  const primaryPlayer = (
    <LivestreamBrowserViewer
      active={Boolean(isCurrentClaimLive && activeLivestream)}
      discoverable={discoverBrowserLivestream}
      channelId={channelId}
      claimId={activeLivestreamClaimId || claim?.claim_id}
      videoUrl={activeLivestreamVideoUrl}
      trackerUrl={activeLivestreamP2PTrackerUrl}
      swarmId={activeLivestreamP2PSwarmId}
      fallback={
        <VideoClaimInitiator uri={claim.canonical_url}>
          {scheduledInfo}
        </VideoClaimInitiator>
      }
    />
  );

  if (isMobilePortrait) {
    const infoContent = (
      <section className="file-page__media-actions">
        {noticeContent}
        <LivestreamLink title={__("Click here to access the stream that's currently active")} uri={uri} />
        {claimIsMine && serverMetrics?.live && <LivestreamMetrics metrics={serverMetrics} mode="compact" />}
        <FileTitleSection uri={uri} expandOverride />
      </section>
    );

    const chatContent = livestreamChatEnabled ? (
      <React.Suspense fallback={null}>
        <ChatLayout
          uri={uri}
          hyperchatsHidden={hyperchatsHidden}
          customViewMode={chatViewMode}
          setCustomViewMode={(mode) => setChatViewMode(mode)}
        />
      </React.Suspense>
    ) : null;

    const relatedContent = <RecommendedContent uri={uri} />;

    return (
      <section className="card-stack file-page__video">
        <div className={PRIMARY_PLAYER_WRAPPER_CLASS}>{primaryPlayer}</div>

        <MobileTabView
          infoContent={infoContent}
          commentsContent={chatContent}
          relatedContent={relatedContent}
          tabDefs={LIVESTREAM_TAB_DEFS}
        />
      </section>
    );
  }

  return (
    <section className="card-stack file-page__video">
      <div className={PRIMARY_PLAYER_WRAPPER_CLASS}>{primaryPlayer}</div>
      <div className="file-page__secondary-content">
        <div className="file-page__media-actions">
          <div className="section card-stack">
            {noticeContent}
            <LivestreamLink title={__("Click here to access the stream that's currently active")} uri={uri} />
            {claimIsMine && serverMetrics?.live && <LivestreamMetrics metrics={serverMetrics} mode="compact" />}
            <FileTitleSection uri={uri} />
          </div>
        </div>

        {(!isMobile || isLandscapeRotated) && videoTheaterMode && livestreamChatEnabled && (
          <React.Suspense fallback={null}>
            <ChatLayout
              uri={uri}
              hyperchatsHidden={hyperchatsHidden}
              customViewMode={chatViewMode}
              setCustomViewMode={(mode) => setChatViewMode(mode)}
            />
          </React.Suspense>
        )}
      </div>
    </section>
  );
}
