import React from 'react';
import classnames from 'classnames';
import * as RENDER_MODES from 'constants/file_render_modes';
import * as SETTINGS from 'constants/settings';
import { useIsMobile } from 'effects/use-screensize';
import { EmbedContext } from 'contexts/embed';
import useGetPoster from 'effects/use-get-poster';
import useLiveThumbnailFrame from 'effects/use-live-thumbnail-frame';
import Button from 'component/button';
import useSwipeNavigation from 'effects/use-swipe-navigation';
import { useLocation } from 'react-router-dom';
import { useAppSelector } from 'redux/hooks';
import { getThumbnailFromClaim, isClaimShort } from 'util/claim';
import { selectShortsSidePanelOpen } from 'redux/selectors/shorts';
import { selectClaimForUri, selectClaimIsNsfwForUri } from 'redux/selectors/claims';
import { selectClientSetting } from 'redux/selectors/settings';
import { selectFileRenderModeForUri, selectPlayingUri } from 'redux/selectors/content';
import { selectLiveThumbnailForUri } from 'redux/selectors/livestream';
import {
  SHORTS_COVER_SLIME_STATE_CLASS,
  SHORTS_DOCUMENT_TRANSITION_COVER_CLASS,
  SHORTS_EFFECT_FIRE_STATE_CLASS,
} from 'component/shortsActions/classes';
import { CARD_CLASSES } from 'component/common/card-classes';
import {
  CLAIM_COVER_BLACK_BACKGROUND_CLASS,
  CLAIM_COVER_CLASSES,
  CLAIM_COVER_DISABLED_CLASS,
  CLAIM_COVER_LINK_CLASS,
  CLAIM_COVER_LIVE_IMAGE_CLASS,
  CLAIM_COVER_LIVE_REFRESHING_CLASS,
} from './classes';
type Props = {
  uri: string;
  children?: any;
  passedRef?: any;
  href?: string;
  transparent?: boolean;
  onClick?: () => void;
  onSwipeNext?: () => void;
  onSwipePrevious?: () => void;
  enableSwipe?: boolean;
  isShortsContext?: boolean;
  isFloatingContext?: boolean;
  obscurePreview?: boolean;
};

function isMissingThumbLike(url: string | null | undefined) {
  if (!url) return false;
  const normalized = url.toLowerCase();
  return normalized.includes('missing-thumb-png') || normalized.includes('missing-thumb');
}

const ClaimCoverRender = (props: Props) => {
  const {
    uri,
    children,
    passedRef,
    href,
    transparent,
    onClick,
    onSwipeNext,
    onSwipePrevious,
    enableSwipe,
    isShortsContext,
    isFloatingContext,
    obscurePreview,
  } = props;
  // -- redux --
  const claim = useAppSelector((state) => selectClaimForUri(state, uri));
  const claimThumbnail = getThumbnailFromClaim(claim);
  const isShortClaim = isClaimShort(claim);
  const playingUri = useAppSelector(selectPlayingUri);
  const isCurrentlyPlaying = playingUri && playingUri.uri === uri;
  const isMature = useAppSelector((state) => selectClaimIsNsfwForUri(state, uri));
  const renderMode = useAppSelector((state) => selectFileRenderModeForUri(state, uri));
  const sidePanelOpen = useAppSelector(selectShortsSidePanelOpen);
  const videoTheaterMode = useAppSelector((state) => selectClientSetting(state, SETTINGS.VIDEO_THEATER_MODE));
  const autoplayMedia = useAppSelector((state) => selectClientSetting(state, SETTINGS.AUTOPLAY_MEDIA));
  const isEmbed = React.useContext(EmbedContext);
  const { search } = useLocation();
  const urlParams = new URLSearchParams(search);
  const isShortsParam = urlParams.get('view') === 'shorts';
  const isMobile = useIsMobile();
  const theaterMode = RENDER_MODES.FLOATING_MODES.includes(renderMode) && videoTheaterMode;
  const isShorts = typeof isShortsContext === 'boolean' ? isShortsContext : isShortsParam || isShortClaim;
  const shouldUseShortsCoverLayout = isShorts && !isFloatingContext;
  const staticThumbnail = useGetPoster(claimThumbnail as string, isShorts);
  const liveThumbnailFromStore = useAppSelector((state) => selectLiveThumbnailForUri(state, uri));
  const liveThumbnail = isMissingThumbLike(liveThumbnailFromStore) ? null : liveThumbnailFromStore;

  const [isHovering, setIsHovering] = React.useState(false);
  const liveFrameUrl = useLiveThumbnailFrame(liveThumbnail, Boolean(isHovering && liveThumbnail));
  const [coverBufferA, setCoverBufferA] = React.useState<string | null>(liveThumbnail || staticThumbnail || null);
  const [coverBufferB, setCoverBufferB] = React.useState<string | null>(null);
  const [activeCoverBuffer, setActiveCoverBuffer] = React.useState<'a' | 'b'>('a');
  React.useEffect(() => {
    if (!liveThumbnail) {
      setCoverBufferA(staticThumbnail || null);
      setCoverBufferB(null);
      setActiveCoverBuffer('a');
      return;
    }

    if (!liveFrameUrl) return;

    if (activeCoverBuffer === 'a') {
      if (coverBufferB !== liveFrameUrl) setCoverBufferB(liveFrameUrl);
    } else if (coverBufferA !== liveFrameUrl) {
      setCoverBufferA(liveFrameUrl);
    }
  }, [activeCoverBuffer, coverBufferA, coverBufferB, liveFrameUrl, staticThumbnail, liveThumbnail]);

  const activeCoverThumb = activeCoverBuffer === 'a' ? coverBufferA : coverBufferB;
  const stableCoverThumb = activeCoverThumb || coverBufferA || coverBufferB || staticThumbnail || null;
  const enableLiveCrossfade = Boolean(isHovering && liveThumbnail && liveFrameUrl);
  const isLiveRefreshing = Boolean(liveThumbnail && isHovering && liveFrameUrl);

  const swipeRef = useSwipeNavigation({
    onSwipeNext,
    onSwipePrevious,
    isEnabled: enableSwipe && isMobile,
    minSwipeDistance: 50,
    tapDuration: 200,
    onTap: enableSwipe ? onClick : undefined,
  });
  const isNavigateLink = href;
  const Wrapper = isNavigateLink ? Button : 'div';
  return (
    <Wrapper
      ref={shouldUseShortsCoverLayout ? swipeRef : passedRef}
      href={href}
      onClick={onClick}
      onMouseEnter={liveThumbnail ? () => setIsHovering(true) : undefined}
      onMouseLeave={liveThumbnail ? () => setIsHovering(false) : undefined}
      style={
        !enableLiveCrossfade &&
        stableCoverThumb &&
        !obscurePreview &&
        !(isCurrentlyPlaying && shouldUseShortsCoverLayout) &&
        !(shouldUseShortsCoverLayout && autoplayMedia)
          ? {
              backgroundImage: `url("${stableCoverThumb}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : {}
      }
      className={classnames(CLAIM_COVER_CLASSES.base, SHORTS_DOCUMENT_TRANSITION_COVER_CLASS, {
        [CLAIM_COVER_CLASSES.nonEmbed]: !isEmbed,
        [CLAIM_COVER_CLASSES.shorts]: shouldUseShortsCoverLayout,
        [SHORTS_EFFECT_FIRE_STATE_CLASS]: shouldUseShortsCoverLayout,
        [SHORTS_COVER_SLIME_STATE_CLASS]: shouldUseShortsCoverLayout,
        [CLAIM_COVER_CLASSES.embed]: isEmbed,
        [CLAIM_COVER_BLACK_BACKGROUND_CLASS]: !transparent,
        [CLAIM_COVER_DISABLED_CLASS]: !onClick && !href,
        [CLAIM_COVER_CLASSES.theater]: theaterMode && !isMobile,
        [CLAIM_COVER_LINK_CLASS]: isNavigateLink,
        [CARD_CLASSES.mediaNsfw]: obscurePreview,
        [CLAIM_COVER_CLASSES.sidePanel]: sidePanelOpen && !isMobile,
        [CLAIM_COVER_LIVE_REFRESHING_CLASS]: isLiveRefreshing,
      })}
      data-claim-cover
      data-claim-cover-shorts={shouldUseShortsCoverLayout ? '' : undefined}
    >
      {enableLiveCrossfade && coverBufferA && (
        <img
          src={coverBufferA}
          className={classnames(CLAIM_COVER_LIVE_IMAGE_CLASS, {
            'tw:opacity-100': activeCoverBuffer === 'a',
          })}
          onLoad={() => setActiveCoverBuffer('a')}
          alt=""
          draggable={false}
          data-claim-cover-live-image
        />
      )}
      {enableLiveCrossfade && coverBufferB && (
        <img
          src={coverBufferB}
          className={classnames(CLAIM_COVER_LIVE_IMAGE_CLASS, {
            'tw:opacity-100': activeCoverBuffer === 'b',
          })}
          onLoad={() => setActiveCoverBuffer('b')}
          alt=""
          draggable={false}
          data-claim-cover-live-image
        />
      )}
      {children}
    </Wrapper>
  );
};

export default ClaimCoverRender;
