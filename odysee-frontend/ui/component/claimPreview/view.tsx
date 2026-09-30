import React, { useEffect, forwardRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isEmpty } from 'util/object';
import { lazyImport } from 'util/lazyImport';
import classnames from 'classnames';
import { isURIValid } from 'util/lbryURI';
import * as COLLECTIONS_CONSTS from 'constants/collections';
import * as PAGES from 'constants/pages';
import * as SETTINGS from 'constants/settings';
import { isChannelClaim, isClaimNsfw, isClaimShort, isStreamPlaceholderClaim } from 'util/claim';
import { isClaimAllowedForCollection } from 'util/collections';
import { formatLbryUrlForWeb } from 'util/url';
import { appHref } from 'util/manifest-prefix';
import { formatClaimPreviewTitle } from 'util/formatAriaLabel';
import { getChannelSubCountStr } from 'util/formatMediaDuration';
import { toCompactNotation } from 'util/string';
import formatMediaDuration from 'util/formatMediaDuration';
import ClaimPreviewProgress from 'component/claimPreviewProgress';
import Icon from 'component/common/icon';
import Tooltip from 'component/common/tooltip';
import FileThumbnail from 'component/fileThumbnail';
import UriIndicator from 'component/uriIndicator';
import PreviewOverlayProperties from 'component/previewOverlayProperties';
import { CLAIM_PREVIEW_FILE_PROPERTY_OVERLAY_CLASS } from 'component/previewOverlayProperties/classes';
import ClaimTags from 'component/claimTags';
import SubscribeButton from 'component/subscribeButton';
import JoinMembershipButton from 'component/joinMembershipButton';
import ChannelThumbnail from 'component/channelThumbnail';
import ClaimSupportButton from 'component/claimSupportButton';
import useGetThumbnail from 'effects/use-get-thumbnail';
import ClaimPreviewTitle from 'component/claimPreviewTitle';
import ClaimPreviewSubtitle from 'component/claimPreviewSubtitle';
import ClaimRepostAuthor from 'component/claimRepostAuthor';
import FileWatchLaterLink from 'component/fileWatchLaterLink';
import PublishPending from 'component/publish/shared/publishPending';
import ButtonAddToQueue from 'component/buttonAddToQueue';
import ButtonFloatingPlayer from 'component/buttonFloatingPlayer';
import ClaimMenuList from 'component/claimMenuList';
import ClaimPreviewReset from 'component/claimPreviewReset';
import ClaimPreviewLoading from 'component/common/claim-preview-loading';
import { DMCA_INFO_CLASS } from 'component/common/content-restriction-classes';
import ClaimPreviewHidden from './internal/claim-preview-no-mature';
import ClaimPreviewNoContent from './internal/claim-preview-no-content';
import { CLAIM_PREVIEW_HOVER_ACTIONS_GRID_CLASS } from './hover-action-classes';
import {
  CLAIM_PREVIEW_ACTIONS_CLASS,
  CLAIM_PREVIEW_BACKGROUND_CLASS,
  CLAIM_PREVIEW_ACTIVE_WRAPPER_CLASS,
  CLAIM_PREVIEW_CHANNEL_CLASS,
  CLAIM_PREVIEW_CHANNEL_SUB_COUNT_CLASS,
  CLAIM_PREVIEW_CHANNEL_STAKED_CLASS,
  CLAIM_PREVIEW_COLLECTION_EDITING_CLASS,
  CLAIM_PREVIEW_DESCRIPTION_CLASS,
  CLAIM_PREVIEW_LIST_INDEX_CLASS,
  CLAIM_PREVIEW_LARGE_CLASS,
  CLAIM_PREVIEW_LIVE_WRAPPER_CLASS,
  CLAIM_PREVIEW_MEMBERSHIP_CLASS,
  CLAIM_PREVIEW_PENDING_CLASS,
  CLAIM_PREVIEW_PLAYLIST_ROW_CLASS,
  CLAIM_PREVIEW_RECOMMENDATION_WRAPPER_CLASS,
  CLAIM_PREVIEW_ROOT_CLASS,
  CLAIM_PREVIEW_SMALL_CLASS,
  CLAIM_PREVIEW_TAGS_CLASS,
  CLAIM_PREVIEW_TEXT_CLASS,
} from './classes';
import { ENABLE_NO_SOURCE_CLAIMS } from 'config';
import { getThumbnailCdnUrl } from 'util/thumbnail';
import CollectionEditButtons from 'component/collectionEditButtons';
import * as ICONS from 'constants/icons';
import { useIsMobile } from 'effects/use-screensize';
import { EmbedContext } from 'contexts/embed';
import CollectionPreviewOverlay from 'component/collectionPreviewOverlay';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import {
  selectClaimForUri,
  selectIsUriResolving,
  selectClaimIsMine,
  makeSelectClaimIsPending,
  makeSelectReflectingClaimForUri,
  selectTitleForUri,
  selectDateForUri,
  selectGeoRestrictionForUri,
  selectThumbnailForUri,
} from 'redux/selectors/claims';
import { selectStreamingUrlForUri } from 'redux/selectors/file_info';
import { selectCollectionIsMine, selectFirstItemUrlForCollection } from 'redux/selectors/collections';
import { doResolveUri } from 'redux/actions/claims';
import { doFileGetForUri } from 'redux/actions/file';
import { selectBanStateForUri, type BanState } from 'lbryinc';
import { selectIsActiveLivestreamForUri } from 'redux/selectors/livestream';
import { selectLanguage, selectShowMatureContent, selectClientSetting } from 'redux/selectors/settings';
import { makeSelectHasVisitedUri } from 'redux/selectors/content';
import { doClearContentHistoryUri, doPlayNextUri } from 'redux/actions/content';
import { hyperbeamImmutableUriFromClaim } from 'util/hyperbeam-route';
const AbandonedChannelPreview = lazyImport(
  () =>
    import(
      'component/abandonedChannelPreview'
      /* webpackChunkName: "abandonedChannelPreview" */
    )
) as React.LazyExoticComponent<React.ComponentType<{ uri: string; type: string }>>;
// preview images used on the landing page and on the channel page
type Props = {
  uri?: string;
  active?: boolean;
  showUserBlocked?: boolean;
  placeholder?: string;
  type?: string;
  nonClickable?: boolean;
  blockedUris?: Array<string>;
  actions?: boolean | React.ReactNode | string | number;
  properties?: boolean | React.ReactNode | string | number | ((arg0: Claim) => React.ReactNode);
  empty?: React.ReactNode;
  onClick?: (e: any, claim?: Claim | null, index?: number) => any;
  customShouldHide?: (arg0: Claim) => boolean;
  searchParams?: Record<string, string>;
  showUnresolvedClaim?: boolean;
  showNullPlaceholder?: boolean;
  includeSupportAction?: boolean;
  hideActions?: boolean;
  hideJoin?: boolean;
  renderActions?: (arg0: Claim) => React.ReactNode | null | undefined;
  wrapperElement?: string;
  hideRepostLabel?: boolean;
  repostUrl?: string;
  hideMenu?: boolean;
  collectionId?: string;
  disableNavigation?: boolean;
  // DEPRECATED - use 'nonClickable'. Remove this when channel-finder is consolidated (#810)
  indexInContainer?: number;
  // The index order of this component within 'containerId'.
  channelSubCount?: number;
  showEdit?: boolean;
  isEditPreview?: boolean;
  dragHandleProps?: any;
  unavailableUris?: Array<string>;
  inWatchHistory?: boolean;
  smallThumbnail?: boolean;
  showIndexes?: boolean;
  playItemsOnClick?: boolean;
  disableClickNavigation?: boolean;
  doDisablePlayerDrag?: (disable: boolean) => void;
  showHiddenByUser?: boolean;
  showNoSourceClaims?: boolean;
  fypId?: string;
};
const ClaimPreview = forwardRef<any, Props>((props: Props, ref: any) => {
  const {
    // core
    uri,
    wrapperElement,
    type,
    nonClickable,
    placeholder,
    empty,
    // modifiers
    active,
    customShouldHide,
    searchParams,
    showNullPlaceholder,
    showUserBlocked,
    showUnresolvedClaim,
    hideRepostLabel = false,
    hideActions = false,
    properties,
    onClick,
    actions,
    includeSupportAction,
    renderActions,
    hideMenu = false,
    hideJoin = false,
    collectionId,
    disableNavigation,
    indexInContainer,
    channelSubCount,
    showEdit,
    isEditPreview,
    dragHandleProps,
    unavailableUris,
    inWatchHistory,
    smallThumbnail,
    showIndexes,
    playItemsOnClick,
    disableClickNavigation,
    doDisablePlayerDrag,
  } = props;
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [rowHover, setRowHover] = React.useState(false);
  const claim = useAppSelector((state) => (uri ? selectClaimForUri(state, uri) : undefined));
  const media = claim && claim.value && (claim.value.video || claim.value.audio);
  const mediaDuration = media && media.duration && formatMediaDuration(media.duration);
  const isLivestream = isStreamPlaceholderClaim(claim);
  const repostSrcUri = claim && claim.repost_url && claim.canonical_url;
  const isCollection = claim && claim.value_type === 'collection';
  const banState = useAppSelector((state) => selectBanStateForUri(state, uri));
  const claimIsMine = useAppSelector((state) => (uri ? selectClaimIsMine(state, claim) : false));
  const date = useAppSelector((state) => (uri ? selectDateForUri(state, uri) : undefined));
  const geoRestriction = useAppSelector((state) => selectGeoRestrictionForUri(state, uri));
  const hasVisitedUri = useAppSelector((state) => (uri ? makeSelectHasVisitedUri(uri)(state) : false));
  const isCollectionMine = useAppSelector((state) => selectCollectionIsMine(state, collectionId));
  const isLivestreamActive = useAppSelector((state) => isLivestream && selectIsActiveLivestreamForUri(state, uri));
  const isResolvingUri = useAppSelector((state) => (uri ? selectIsUriResolving(state, uri) : false));
  const lang = useAppSelector(selectLanguage);
  const nsfw = claim ? isClaimNsfw(claim) : false;
  const obscureNsfw = useAppSelector((state) => selectShowMatureContent(state) === false);
  const pending = useAppSelector((state) => (uri ? makeSelectClaimIsPending(uri)(state) : false));
  const reflectingProgress = useAppSelector((state) => (uri ? makeSelectReflectingClaimForUri(uri)(state) : undefined));
  const streamingUrl = useAppSelector((state) =>
    repostSrcUri || uri ? selectStreamingUrlForUri(state, repostSrcUri || uri) : undefined
  );
  const title = useAppSelector((state) => (uri ? selectTitleForUri(state, uri) : ''));
  const firstCollectionItemUrl = useAppSelector((state) =>
    claim && isCollection ? selectFirstItemUrlForCollection(state, claim.claim_id) : undefined
  );
  const thumbnailFromClaim = useAppSelector((state) => selectThumbnailForUri(state, uri)) as string | null | undefined;
  const defaultCollectionAction = useAppSelector((state) =>
    selectClientSetting(state, SETTINGS.DEFAULT_COLLECTION_ACTION)
  );
  const disableShortsView = useAppSelector((state) => selectClientSetting(state, SETTINGS.DISABLE_SHORTS_VIEW));
  const isEmbed = React.useContext(EmbedContext);
  const isMobile = useIsMobile();
  const { pathname, search } = useLocation();
  const playlistPreviewItem = unavailableUris !== undefined || showIndexes;
  const collectionClaimId = isCollection && claim && claim.claim_id;
  const listId = collectionId || collectionClaimId || undefined;
  const WrapperElement: any = wrapperElement || 'li';
  const shouldFetch =
    claim === undefined || (claim !== null && claim.value_type === 'channel' && isEmpty(claim.meta) && !pending);
  const abandoned = !isResolvingUri && !claim;
  const isMyCollection = listId && (isCollectionMine || listId.includes('-'));
  if (isMyCollection && claim === null && unavailableUris) unavailableUris.push(uri);
  const shortClaim = isClaimShort(claim);
  const isMissingThumbLike = React.useCallback((url: string | null | undefined) => {
    if (!url) return false;
    const normalized = url.toLowerCase();
    return normalized.includes('missing-thumb-png') || normalized.includes('missing-thumb');
  }, []);
  const backgroundImage =
    thumbnailFromClaim && !isMissingThumbLike(thumbnailFromClaim)
      ? getThumbnailCdnUrl({
          thumbnail: thumbnailFromClaim,
          quality: 85,
        })
      : undefined;
  const shouldHideActions = hideActions || isMyCollection || type === 'small' || type === 'tooltip';
  const channelSubscribers = React.useMemo(() => {
    if (channelSubCount === undefined) {
      return <span />;
    }

    const formattedSubCount = toCompactNotation(channelSubCount, lang, 10000);
    const formattedSubCountLocale = Number(channelSubCount).toLocaleString();
    return (
      <div className="media__subtitle">
        <Tooltip title={formattedSubCountLocale} followCursor placement="top">
          <span className={CLAIM_PREVIEW_CHANNEL_SUB_COUNT_CLASS} data-claim-preview-channel-sub-count>
            {getChannelSubCountStr(channelSubCount, formattedSubCount)}
          </span>
        </Tooltip>
      </div>
    ); // eslint-disable-next-line react-hooks/exhaustive-deps -- @see TODO_NEED_VERIFICATION
  }, [channelSubCount]);
  const showCollectionContext = isClaimAllowedForCollection(claim);
  const isChannelUri = isChannelClaim(claim, uri);
  const signingChannel = claim && claim.signing_channel;
  const repostedChannelUri =
    claim && claim.repost_channel_url && claim.value_type === 'channel'
      ? claim.permanent_url || claim.canonical_url
      : undefined;
  const repostedContentUri = claim && (claim.reposted_claim ? claim.reposted_claim.permanent_url : claim.permanent_url);
  const isPublishSuggestion = placeholder === 'publish' && !claim && uri.startsWith('lbry://@'); // See commit a43d9150.

  // Get channel title ( use name as fallback )
  let channelTitle = null;

  if (signingChannel) {
    const { value, name } = signingChannel;

    if (value && value.title) {
      channelTitle = value.title;
    } else {
      channelTitle = name;
    }
  }

  const ariaLabelData = isChannelUri
    ? title
    : formatClaimPreviewTitle(title, channelTitle, date ? date.getTime() : null, mediaDuration);
  const navigateUrl =
    isCollection && listId && defaultCollectionAction === COLLECTIONS_CONSTS.DEFAULT_ACTION_VIEW
      ? `/$/${PAGES.PLAYLIST}/${listId}`
      : formatLbryUrlForWeb(hyperbeamImmutableUriFromClaim(claim) || claim?.canonical_url || uri || '/');
  let navigateSearch = new URLSearchParams();

  if (!isCollection && listId) {
    navigateSearch.set(COLLECTIONS_CONSTS.COLLECTION_ID, listId);
  }

  if (searchParams) {
    Object.keys(searchParams).forEach((key) => {
      navigateSearch.set(key, searchParams[key]);
    });
  }

  if (shortClaim && !disableShortsView) {
    navigateSearch.set('view', 'shorts');
  }

  function playPlaylistItem() {
    if (!claim) return;

    dispatch(
      doPlayNextUri({
        uri: hyperbeamImmutableUriFromClaim(claim) || claim.canonical_url || uri,
        collectionId: listId,
        navigateInline: !disableClickNavigation,
      })
    );
  }

  const handleNavLinkClick = (e) => {
    const previewTime = (window as any).__previewCurrentTime;
    const previewUnmuted = (window as any).__previewMuted === false;
    if (previewTime && previewTime > 0 && previewUnmuted) {
      e.preventDefault();
      const params = new URLSearchParams(navigateSearch.toString());
      params.set('t', String(previewTime));
      navigate({
        pathname: navigateUrl,
        search: '?' + params.toString(),
      });
    }

    if (playItemsOnClick && claim) {
      playPlaylistItem();
    }

    if (onClick) {
      onClick(e, claim, indexInContainer);
    }

    e.stopPropagation();
  };

  const navLinkProps = {
    to: {
      pathname: disableClickNavigation ? pathname : navigateUrl,
      search: disableClickNavigation ? search : navigateSearch.toString() ? '?' + navigateSearch.toString() : '',
    },
    onClick: handleNavLinkClick,
    onAuxClick: undefined,
  };
  // A claim that resolved but carries no title, thumbnail or channel has
  // nothing to show the user: a placeholder card with a bare name. Those
  // are noise in any list, so treat them like unresolved claims.
  const unrenderable = Boolean(
    claim &&
    !claim.value?.title &&
    !claim.value?.thumbnail?.url &&
    !claim.signing_channel &&
    claim.value_type !== 'channel'
  );
  let shouldHide =
    placeholder !== 'loading' &&
    (((abandoned || unrenderable) && !showUnresolvedClaim) ||
      (!claimIsMine && obscureNsfw && nsfw && !showUserBlocked));

  // This will be replaced once blocking is done at the wallet server level
  if (!shouldHide && !claimIsMine && (banState.blacklisted || banState.filtered)) {
    shouldHide = true;
  }

  // block stream claims
  if (!shouldHide && !showUserBlocked && (banState.muted || banState.blocked)) {
    shouldHide = true;
  }

  // Filter empty reposts
  if (!shouldHide) {
    shouldHide = claim?.value_type === 'repost' && !pathname.includes(`/$/${PAGES.UPLOAD}`);
  }

  if (!shouldHide && isPublishSuggestion) {
    shouldHide = true;
  }

  if (!shouldHide && !claimIsMine && geoRestriction) {
    shouldHide = true;
  }

  if (!shouldHide && customShouldHide && claim) {
    if (customShouldHide(claim)) {
      shouldHide = true;
    }
  }

  // **************************************************************************
  // **************************************************************************
  // Weird placement warning
  // Make sure this happens after we figure out if this claim needs to be hidden
  const getFile = React.useCallback((fileUri: string) => dispatch(doFileGetForUri(fileUri)), [dispatch]);
  const thumbnailUrl = useGetThumbnail(uri, claim, streamingUrl, getFile, shouldHide);

  function handleOnClick(e) {
    if (onClick) {
      onClick(e, claim, indexInContainer);
    }

    if (playItemsOnClick && claim) {
      return playPlaylistItem();
    }

    if (claim && !pending && !disableNavigation && !disableClickNavigation && !isEmbed) {
      const previewTime = (window as any).__previewCurrentTime;
      const previewUnmuted = (window as any).__previewMuted === false;
      const params = new URLSearchParams(navigateSearch.toString());
      if (previewTime && previewTime > 0 && previewUnmuted) {
        params.set('t', String(previewTime));
      }
      navigate({
        pathname: navigateUrl,
        search: params.toString() ? '?' + params.toString() : '',
      });
    }
  }

  function removeFromHistory(e, uri) {
    e.stopPropagation();
    dispatch(doClearContentHistoryUri(uri));
  }

  useEffect(() => {
    if (!isResolvingUri && shouldFetch && uri) {
      if (isURIValid(uri, false)) {
        dispatch(doResolveUri(uri));
      }
    }
  }, [uri, isResolvingUri, shouldFetch, dispatch]);
  const JoinButton = React.useMemo(
    () => () =>
      isChannelUri &&
      !claimIsMine &&
      !hideJoin &&
      (!banState.muted || showUserBlocked) && (
        <div className={classnames(CLAIM_PREVIEW_MEMBERSHIP_CLASS, type)} data-claim-preview-membership>
          <JoinMembershipButton uri={uri} />
        </div>
      ),
    [banState.muted, claimIsMine, hideJoin, isChannelUri, showUserBlocked, type, uri]
  );
  const hyperbeamTraceAttrs =
    claim && claim.claim_id
      ? {
          'data-hyperbeam-claim-id': claim.claim_id,
          'data-hyperbeam-immutable-id': claim.immutable_id || claim.outpoint,
          'data-hyperbeam-store-path': claim.immutable_store_path,
          'data-hyperbeam-claim-txid': claim.txid,
          'data-hyperbeam-claim-nout': claim.nout,
          'data-hyperbeam-claim-sd-hash': claim.value?.source?.sd_hash,
          'data-hyperbeam-claim-uri': claim.canonical_url || claim.permanent_url || uri,
          'data-hyperbeam-claim-title': title || claim.name,
          'data-hyperbeam-claim-type': claim.value_type,
          'data-hyperbeam-signing-channel-id': claim.signing_channel?.claim_id,
          'data-hyperbeam-signing-channel-uri':
            claim.signing_channel?.canonical_url || claim.signing_channel?.permanent_url,
          'data-hyperbeam-signing-channel-title': channelTitle || claim.signing_channel?.name,
        }
      : {};

  // **************************************************************************
  // **************************************************************************
  if (!playlistPreviewItem && ((shouldHide && !showNullPlaceholder) || (isLivestream && !ENABLE_NO_SOURCE_CLAIMS))) {
    return null;
  }

  if (claim && geoRestriction && !claimIsMine) {
    return null; // Ignore 'showNullPlaceholder'
  }

  if (placeholder === 'loading' || (uri && claim === undefined)) {
    return (
      <ClaimPreviewLoading
        isChannel={isChannelUri}
        type={type}
        WrapperElement={WrapperElement}
        xsmall={smallThumbnail}
      />
    );
  }

  if (claim && showNullPlaceholder && shouldHide && nsfw && obscureNsfw) {
    return (
      <ClaimPreviewHidden
        message={__('Mature content hidden by your preferences')}
        isChannel={isChannelUri}
        type={type}
      />
    );
  }

  if ((claim && showNullPlaceholder && shouldHide) || (!claim && playlistPreviewItem)) {
    return (
      <WrapperElement
        ref={ref}
        className={classnames('claim-preview__wrapper', {
          'claim-preview__wrapper--row': !type,
          'claim-preview__wrapper--inline': type === 'inline',
          [CLAIM_PREVIEW_PLAYLIST_ROW_CLASS]: type === 'small' && collectionId,
          [CLAIM_PREVIEW_ACTIVE_WRAPPER_CLASS]: active,
          'tw:pointer-events-none': !playlistPreviewItem || nonClickable,
        })}
        data-claim-preview-active-wrapper={active ? true : undefined}
        data-claim-preview-playlist-row={type === 'small' && collectionId ? true : undefined}
      >
        <ClaimPreviewHidden
          message={!claim && playlistPreviewItem ? __('Deleted content') : __('This content is hidden')}
          isChannel={isChannelUri}
          type={type}
          uri={uri}
          collectionId={!claim && playlistPreviewItem && collectionId ? collectionId : undefined}
        />
        {playlistPreviewItem && !hideMenu && <ClaimMenuList uri={uri} collectionId={collectionId} />}
      </WrapperElement>
    );
  }

  if (!claim && (showNullPlaceholder || empty)) {
    return empty || <ClaimPreviewNoContent isChannel={isChannelUri} type={type} />;
  }

  if (!shouldFetch && showUnresolvedClaim && !isResolvingUri && isChannelUri && claim === null) {
    return (
      <React.Suspense fallback={null}>
        <AbandonedChannelPreview uri={uri} type={type || ''} />
      </React.Suspense>
    );
  }

  if (isPublishSuggestion) {
    return null; // Ignore 'showNullPlaceholder'
  }

  return (
    <WrapperElement
      ref={ref}
      role="link"
      {...hyperbeamTraceAttrs}
      onClick={pending || type === 'inline' ? undefined : handleOnClick}
      onMouseEnter={() => setRowHover(true)}
      onMouseLeave={() => setRowHover(false)}
      onAuxClick={(e: any) => {
        if (e.button === 1 && navigateUrl && !pending && !disableNavigation) {
          e.preventDefault();
          window.open(appHref(navigateUrl), '_blank');
        }
      }}
      className={classnames('claim-preview__wrapper', {
        'claim-preview__wrapper--row': !type,
        'claim-preview__wrapper--channel': isChannelUri && type !== 'inline',
        'claim-preview__wrapper--inline': type === 'inline',
        [CLAIM_PREVIEW_RECOMMENDATION_WRAPPER_CLASS]: type === 'small',
        [CLAIM_PREVIEW_PLAYLIST_ROW_CLASS]: type === 'small' && collectionId,
        [CLAIM_PREVIEW_LIVE_WRAPPER_CLASS]: isLivestreamActive,
        [CLAIM_PREVIEW_ACTIVE_WRAPPER_CLASS]: active,
        'tw:pointer-events-none': nonClickable,
      })}
      data-claim-preview-active-wrapper={active ? true : undefined}
      data-claim-preview-playlist-row={type === 'small' && collectionId ? true : undefined}
    >
      <>
        {!type && (
          <div
            className={CLAIM_PREVIEW_BACKGROUND_CLASS}
            data-claim-preview-background
            style={
              backgroundImage && {
                backgroundImage: 'url(' + backgroundImage + ')',
              }
            }
          />
        )}

        <div
          className={classnames(CLAIM_PREVIEW_ROOT_CLASS, {
            [CLAIM_PREVIEW_SMALL_CLASS]: type === 'small' || type === 'tooltip',
            [CLAIM_PREVIEW_LARGE_CLASS]: type === 'large',
            'claim-preview--inline': type === 'inline',
            'claim-preview--tooltip': type === 'tooltip',
            [CLAIM_PREVIEW_CHANNEL_CLASS]: isChannelUri,
            'claim-preview--visited': !isChannelUri && !claimIsMine && hasVisitedUri,
            [CLAIM_PREVIEW_PENDING_CLASS]: pending,
            [CLAIM_PREVIEW_COLLECTION_EDITING_CLASS]: isMyCollection && showEdit,
          })}
          data-claim-preview-pending={pending ? true : undefined}
          data-claim-preview-small={type === 'small' || type === 'tooltip' ? true : undefined}
          data-claim-preview-collection-editing={isMyCollection && showEdit ? true : undefined}
        >
          {!hideRepostLabel && <ClaimRepostAuthor uri={uri} short={false} />}
          {showIndexes && (
            <span className={`${CLAIM_PREVIEW_LIST_INDEX_CLASS} tw:m-0 tw:text-app-xsmall tw:text-app-text-subtitle`}>
              {indexInContainer + 1}
            </span>
          )}

          {isMyCollection && showEdit && (
            <CollectionEditButtons
              uri={uri}
              collectionId={listId}
              isEditPreview={isEditPreview}
              dragHandleProps={dragHandleProps}
              doDisablePlayerDrag={doDisablePlayerDrag}
            />
          )}

          {isChannelUri && claim ? (
            <UriIndicator focusable={false} uri={uri} link external={isEmbed}>
              <ChannelThumbnail uri={uri} small={type === 'inline'} />
            </UriIndicator>
          ) : (
            <>
              {!pending ? (
                <NavLink aria-hidden tabIndex={-1} {...navLinkProps} target={isEmbed && '_blank'}>
                  <FileThumbnail
                    thumbnail={thumbnailUrl}
                    small={smallThumbnail}
                    hoverPreview={!smallThumbnail}
                    uri={uri}
                    secondaryUri={firstCollectionItemUrl}
                    externalHover={rowHover}
                  >
                    {!smallThumbnail && (
                      <div className={CLAIM_PREVIEW_HOVER_ACTIONS_GRID_CLASS}>
                        {showCollectionContext && (
                          <>
                            <FileWatchLaterLink focusable={false} uri={repostedContentUri} />
                            <ButtonAddToQueue focusable={false} uri={repostedContentUri} />
                          </>
                        )}
                        {media && (!isLivestream || isLivestreamActive) && (
                          <ButtonFloatingPlayer uri={repostedContentUri} />
                        )}
                      </div>
                    )}
                    <div className={CLAIM_PREVIEW_FILE_PROPERTY_OVERLAY_CLASS} data-claim-preview-file-property-overlay>
                      <PreviewOverlayProperties
                        uri={uri}
                        small={type === 'small'}
                        isSubscribed={false}
                        iconOnly={false}
                        xsmall={smallThumbnail}
                      />
                    </div>
                    {isCollection && <CollectionPreviewOverlay collectionId={listId} />}
                    <ClaimPreviewProgress uri={uri} />
                  </FileThumbnail>
                </NavLink>
              ) : (
                <>
                  <FileThumbnail thumbnail={thumbnailUrl} uri={uri}>
                    <div className={CLAIM_PREVIEW_FILE_PROPERTY_OVERLAY_CLASS} data-claim-preview-file-property-overlay>
                      <PreviewOverlayProperties
                        uri={uri}
                        small={type === 'small'}
                        isSubscribed={false}
                        iconOnly={false}
                        xsmall={smallThumbnail}
                        pending
                      />
                    </div>
                  </FileThumbnail>
                </>
              )}
            </>
          )}

          <div className={CLAIM_PREVIEW_TEXT_CLASS}>
            <div className="claim-preview-metadata">
              <div className="claim-preview-info">
                {pending ? (
                  <ClaimPreviewTitle uri={uri} />
                ) : (
                  <NavLink
                    aria-label={ariaLabelData}
                    aria-current={active ? 'page' : null}
                    {...navLinkProps}
                    target={isEmbed && '_blank'}
                  >
                    <ClaimPreviewTitle uri={uri} />
                  </NavLink>
                )}
                {banState.blacklisted && claimIsMine && (
                  <a
                    href="https://help.odysee.tv/category-uploading/dmca-content/#receiving-a-dmca-notice"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <div className={DMCA_INFO_CLASS}>{__('DMCA flagged')}</div>
                  </a>
                )}
                {banState.filtered && claimIsMine && (
                  <a
                    href="https://help.odysee.tv/category-uploading/dmca-content/#receiving-a-dmca-notice"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <div className={DMCA_INFO_CLASS}>{__('Filtered')}</div>
                  </a>
                )}
                {(pending || !!reflectingProgress) && <PublishPending uri={uri} />}
              </div>
              <div className="claim-tile__info">
                {!isChannelUri && signingChannel && (
                  <div className={CLAIM_PREVIEW_CHANNEL_STAKED_CLASS} data-claim-preview-channel-staked>
                    <UriIndicator focusable={false} uri={uri} link hideAnonymous external={isEmbed}>
                      <ChannelThumbnail uri={signingChannel.permanent_url} xsmall />
                    </UriIndicator>
                  </div>
                )}
                <ClaimPreviewSubtitle uri={uri} type={type} showAtSign={isChannelUri} />
                {channelSubscribers}

                {type !== 'small' && (
                  <>
                    <div className={CLAIM_PREVIEW_TAGS_CLASS} data-claim-preview-tags>
                      {claim && (
                        <React.Fragment>
                          {typeof properties === 'function'
                            ? properties(claim)
                            : properties !== undefined
                              ? properties
                              : !isMobile && <ClaimTags uri={uri} type={type} />}
                        </React.Fragment>
                      )}
                    </div>
                    {isChannelUri && renderActions && claim && renderActions(claim)}
                  </>
                )}
              </div>
              {(pending || !!reflectingProgress) && <PublishPending uri={uri} />}

              {!type && (
                <div className={CLAIM_PREVIEW_DESCRIPTION_CLASS} data-claim-preview-description>
                  <div className="description">{claim?.value?.description || __('No description available.')}</div>
                </div>
              )}
            </div>

            {type !== 'small' && (!pending || !type) && isChannelUri && (
              <div className={CLAIM_PREVIEW_ACTIONS_CLASS}>
                {!hideJoin && <JoinButton />}
                {!pending && (
                  <>
                    {shouldHideActions || renderActions ? null : actions !== undefined ? (
                      actions
                    ) : (
                      <>
                        {isChannelUri && !claimIsMine && (!banState.muted || showUserBlocked) && (
                          <SubscribeButton
                            uri={repostedChannelUri || (uri.startsWith('lbry://') ? uri : `lbry://${uri}`)}
                            shrinkOnMobile={false}
                          />
                        )}
                        {includeSupportAction && type && <ClaimSupportButton uri={uri} />}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {inWatchHistory && (
          <div onClick={(e) => removeFromHistory(e, uri)} className="claim-preview__history-remove">
            <Icon icon={ICONS.REMOVE} />
          </div>
        )}
        {/* Todo: check isLivestreamActive once we have that data consistently everywhere. */}
        {claim && isLivestream && <ClaimPreviewReset uri={uri} />}

        {!hideMenu && <ClaimMenuList uri={uri} collectionId={listId} />}
      </>
    </WrapperElement>
  );
});
export default React.memo(ClaimPreview);
