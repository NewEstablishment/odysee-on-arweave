import React from 'react';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import { NavLink } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectClaimForUri } from 'redux/selectors/claims';
import { doResolveUri, doResolveUris } from 'redux/actions/claims';
import ClaimPreviewTile from 'component/claimPreviewTile';
import ChannelThumbnail from 'component/channelThumbnail';
import SubscribeButton from 'component/subscribeButton';
import { hyperbeamImmutableUri, hyperbeamImmutableWebPath } from 'util/hyperbeam-route';
import {
  FEATURED_BANNER_CHANNEL_LINK_CLASS,
  FEATURED_BANNER_LATEST_CLASS,
  FEATURED_BANNER_TILES_CLASS,
} from './classes';

type Props = {
  homepageData: any;
  authenticated: boolean;
};

const FEATURED_ROOT_CLASS =
  'tw:group/featured tw:relative tw:mt-[calc(var(--spacing-l)*-1)] tw:mr-[calc(var(--spacing-l)*-1)] tw:mb-app-l tw:ml-[calc(var(--spacing-l)*-1)] tw:aspect-[5/1] tw:w-[calc(100%+2*var(--spacing-l))] tw:select-none tw:overflow-hidden tw:bg-black tw:[-webkit-touch-callout:none] tw:[@media(max-width:1150px)]:ml-[calc(var(--spacing-l)*-1+6px)] tw:[@media(max-width:1150px)]:w-[calc(100%+2*var(--spacing-l)-6px)] tw:[@media(max-width:900px)]:mt-[calc(var(--spacing-xs)*-1)] tw:[@media(max-width:900px)]:mr-[calc(var(--spacing-xs)*-1)] tw:[@media(max-width:900px)]:mb-app-s tw:[@media(max-width:900px)]:ml-[calc(var(--spacing-xs)*-1)] tw:[@media(max-width:900px)]:w-[calc(100%+2*var(--spacing-xs))]';
const FEATURED_CLOSE_CLASS =
  'tw:absolute tw:top-app-s tw:right-app-s tw:z-10 tw:flex tw:size-[32px] tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-app tw:![border:none] tw:bg-[rgba(var(--color-header-background-base),0.8)] tw:p-0 tw:text-app-text tw:opacity-0 tw:[&_.icon]:size-[14px] tw:group-hover/featured:opacity-100 tw:hover:bg-[rgba(var(--color-header-background-base),1)] tw:[@media(max-width:900px)]:size-[30px] tw:[@media(max-width:900px)]:opacity-100 tw:[@media(max-width:900px)]:[&_.icon]:size-[12px]';
const FEATURED_BROWSE_CLASS =
  'tw:absolute tw:top-[calc(50%-30px)] tw:size-[60px] tw:rounded-[50%] tw:bg-[rgba(var(--color-header-background-base),0.8)] tw:text-center tw:[font-size:38px] tw:opacity-0 tw:group-hover/featured:opacity-100 tw:hover:cursor-pointer tw:hover:!bg-[rgba(var(--color-header-background-base),1)] tw:hover:!opacity-100 tw:[@media(max-width:900px)]:top-auto tw:[@media(max-width:900px)]:bottom-app-xxxs tw:[@media(max-width:900px)]:size-[30px] tw:[@media(max-width:900px)]:[font-size:20px] tw:[@media(max-width:900px)]:opacity-100';
const FEATURED_DOT_CLASS =
  'tw:mx-app-xxs tw:inline-block tw:rounded-[50%] tw:border tw:border-white tw:[transition:all_1s] tw:hover:cursor-pointer tw:hover:!bg-white';

function getChannelUri(itemUrl: string): string | null {
  let path = itemUrl;
  if (path.includes('odysee.com')) {
    path = path.substring(path.indexOf('odysee.com') + 10);
  }
  if (path.includes('?')) {
    path = path.substring(0, path.indexOf('?'));
  }
  if (!path.startsWith('/@')) return null;
  const replaced = path.slice(1).replace(':', '#');
  try {
    return `lbry://${decodeURIComponent(replaced)}`;
  } catch {
    return `lbry://${replaced}`;
  }
}

function BannerLatestClaims({ item, count }: { item: any; count: number }) {
  const dispatch = useAppDispatch();
  const channelUri = hyperbeamImmutableUri(item.immutableId) || getChannelUri(item.url);
  const resultUris = React.useMemo(
    () => (item.immutableIds || []).slice(0, count).map(hyperbeamImmutableUri).filter(Boolean) as string[],
    [item.immutableIds, count]
  );
  const immutableSigningChannelIds = React.useMemo(
    () =>
      Object.fromEntries(
        Object.entries(item.immutableSigningChannelIds || {})
          .map(([mediaId, channelId]) => [hyperbeamImmutableUri(mediaId), channelId])
          .filter(([mediaUri]) => Boolean(mediaUri))
      ),
    [item.immutableSigningChannelIds]
  );
  const channelClaim = useAppSelector((state) => selectClaimForUri(state, channelUri));

  React.useEffect(() => {
    if (channelUri) {
      dispatch(doResolveUri(channelUri));
    }
  }, [channelUri, dispatch]);

  React.useEffect(() => {
    if (resultUris.length) {
      dispatch(doResolveUris(resultUris, false, true, { immutable_signing_channel_ids: immutableSigningChannelIds }));
    }
  }, [dispatch, resultUris, immutableSigningChannelIds]);

  const channelName = channelClaim?.value?.title || channelClaim?.name?.replace('@', '') || '';

  if (resultUris.length === 0) return null;

  return (
    <div className={FEATURED_BANNER_LATEST_CLASS} onClick={(e) => e.preventDefault()}>
      <div className="tw:flex tw:w-0 tw:min-w-full tw:items-center tw:gap-app-m tw:overflow-hidden tw:[@media(max-width:1150px)]:w-auto tw:[@media(max-width:1150px)]:min-w-0">
        <NavLink to={hyperbeamImmutableWebPath(item.immutableId) || '/'} className={FEATURED_BANNER_CHANNEL_LINK_CLASS}>
          <ChannelThumbnail uri={channelUri} xsmall />
          <span
            className="tw:min-w-0 tw:flex-[0_1_auto] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-body tw:font-bold tw:text-app-text tw:group-hover/channel:text-app-primary"
            title={channelName}
          >
            {channelName}
          </span>
        </NavLink>
        <SubscribeButton uri={channelUri} />
      </div>
      <div className={FEATURED_BANNER_TILES_CLASS}>
        {resultUris.map((uri) => (
          <ClaimPreviewTile key={uri} uri={uri} />
        ))}
      </div>
    </div>
  );
}
function getUriTo(uri) {
  if (uri.includes('odysee.com')) {
    uri = uri.substring(uri.indexOf('odysee.com') + 10);
  }

  let search;

  if (uri.includes('?lid=')) {
    search = uri.substring(uri.indexOf('?lid='));
  }

  return {
    pathname: uri,
    search: search || undefined,
  };
}

export default function FeaturedBanner(props: Props) {
  const { homepageData, authenticated } = props;
  const { featured } = homepageData;
  const latestClaimCount = 3;
  const [marginLeft, setMarginLeft] = React.useState(0);
  const [width, setWidth] = React.useState(0);
  const [index, setIndex] = React.useState(1);
  const [pause, setPause] = React.useState(false);
  const [localBannerHidden, setLocalBannerHidden] = React.useState(
    () => sessionStorage.getItem('bannerHidden') === 'true'
  );
  const wrapper = React.useRef(null);
  const itemCount = Array.isArray(featured?.items) ? featured.items.length : 0;
  const configuredTransitionTime = Number(featured?.transitionTime);
  const transitionTime =
    Number.isFinite(configuredTransitionTime) && configuredTransitionTime > 0 ? configuredTransitionTime : 3;
  const transitionInterval = transitionTime * 1000 + 1000;
  const imageWidth = width >= 1600 ? 1700 : width >= 1150 ? 1150 : width >= 900 ? 900 : width >= 600 ? 600 : 400;
  const navigate = useNavigate();
  React.useEffect(() => {
    if (!width || !itemCount || pause) return;

    const interval = setInterval(() => {
      setIndex((currentIndex) => (currentIndex < itemCount ? currentIndex + 1 : 1));
    }, transitionInterval);
    return () => clearInterval(interval);
  }, [width, itemCount, pause, transitionInterval]);
  React.useEffect(() => {
    if (!itemCount) return;
    setIndex((currentIndex) => Math.min(Math.max(currentIndex, 1), itemCount));
  }, [itemCount]);
  React.useEffect(() => {
    if (itemCount && width) {
      setMarginLeft((index - 1) * (width * -1));
    }
  }, [index, itemCount, width]);
  React.useEffect(() => {
    function measure() {
      if (wrapper.current) {
        setWidth(wrapper.current.offsetWidth);
      }
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  function handleAnchor(e, uri) {
    if (uri.charAt(0) !== '#') {
      return;
    }

    e.preventDefault();
    const anchor = document.getElementById(uri.substring(1));

    if (anchor) {
      window.scrollTo({
        top: anchor && anchor.offsetTop,
        behavior: 'smooth',
      });
    } else {
      navigate('$/portal/adventureaddict');
    }
  }

  function removeBanner() {
    setLocalBannerHidden(true);
    sessionStorage.setItem('bannerHidden', 'true');
  }

  if (localBannerHidden) return null;
  return (
    <div
      className={FEATURED_ROOT_CLASS}
      ref={wrapper}
      onMouseEnter={() => setPause(true)}
      onMouseLeave={() => setPause(false)}
    >
      <div
        className="tw:absolute tw:top-0 tw:ml-0 tw:flex tw:h-full tw:overflow-hidden tw:[transition:margin-left_1s]"
        style={{
          marginLeft: marginLeft,
        }}
      >
        {featured &&
          featured.items.map((item, i) => {
            return (
              <div
                className="tw:relative tw:inline-block tw:h-full tw:shrink-0 tw:overflow-hidden"
                key={i}
                style={{ minWidth: width }}
              >
                <NavLink
                  className="tw:block tw:max-h-full"
                  onClick={(e) => handleAnchor(e, item.url)}
                  to={hyperbeamImmutableWebPath(item.immutableId) || getUriTo(item.url)}
                  target={!item.url.includes('odysee.com') ? '_blank' : undefined}
                  title={item.label}
                >
                  <img
                    className="tw:w-full"
                    src={'https://thumbnails.odycdn.com/optimize/s:' + imageWidth + ':0/quality:95/plain/' + item.image}
                    style={{ width: width }}
                  />
                </NavLink>
                {(item.immutableId || getChannelUri(item.url)) && (
                  <BannerLatestClaims item={item} count={latestClaimCount} />
                )}
              </div>
            );
          })}
      </div>
      <div>
        <div
          className={`${FEATURED_BROWSE_CLASS} tw:left-[40px] tw:[@media(max-width:1150px)]:left-app-s`}
          onClick={() => setIndex(index > 1 ? index - 1 : featured.items.length)}
        >
          ‹
        </div>
        <div
          className={`${FEATURED_BROWSE_CLASS} tw:right-[40px] tw:[@media(max-width:1150px)]:right-app-s`}
          onClick={() => setIndex(index < featured.items.length ? index + 1 : 1)}
        >
          ›
        </div>
        <div className="tw:absolute tw:bottom-app-m tw:mt-app-m tw:flex tw:w-full tw:items-center tw:justify-center tw:text-center tw:[@media(max-width:900px)]:bottom-[5px]">
          {featured &&
            featured.items.map((item, i) => {
              return (
                <div
                  key={i}
                  className={`${FEATURED_DOT_CLASS} ${
                    i + 1 === index
                      ? 'tw:size-[12px] tw:bg-white tw:[@media(max-width:900px)]:size-[8px]'
                      : 'tw:size-[12px] tw:bg-[rgba(150,150,150,0.6)] tw:[@media(max-width:900px)]:size-[6px]'
                  }`}
                  onClick={() => setIndex(i + 1)}
                />
              );
            })}
        </div>
        {authenticated && (
          <button className={FEATURED_CLOSE_CLASS} onClick={removeBanner} aria-label="Close banner">
            <Icon icon={ICONS.REMOVE} />
          </button>
        )}
      </div>
    </div>
  );
}
