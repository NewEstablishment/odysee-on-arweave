import React from 'react';
import { useOnResize } from 'effects/use-on-resize';
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
import { getThumbnailCdnUrl } from 'util/thumbnail';
import './style.lazy.scss';

type Props = {
  homepageData: any;
  authenticated: boolean;
};

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
    <div className="banner-latest-claims" onClick={(e) => e.preventDefault()}>
      <div className="banner-latest-claims__header">
        <NavLink to={hyperbeamImmutableWebPath(item.immutableId) || '/'} className="banner-latest-claims__channel-link">
          <ChannelThumbnail uri={channelUri} xsmall />
          <span className="banner-latest-claims__name" title={channelName}>
            {channelName}
          </span>
        </NavLink>
        <SubscribeButton uri={channelUri} />
      </div>
      <div className="banner-latest-claims__tiles">
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
      className="featured-banner-wrapper"
      ref={wrapper}
      onMouseEnter={() => setPause(true)}
      onMouseLeave={() => setPause(false)}
    >
      <div
        className="featured-banner-rotator"
        style={{
          marginLeft: marginLeft,
        }}
      >
        {featured &&
          featured.items.map((item, i) => {
            return (
              <div className="featured-banner-slide" key={i} style={{ minWidth: width }}>
                <NavLink
                  className="featured-banner-image"
                  onClick={(e) => handleAnchor(e, item.url)}
                  to={hyperbeamImmutableWebPath(item.immutableId) || getUriTo(item.url)}
                  target={!item.url.includes('odysee.com') ? '_blank' : undefined}
                  title={item.label}
                >
                  <img
                    src={
                      getThumbnailCdnUrl({
                        thumbnail: item.image,
                        width: imageWidth,
                        height: 0,
                        quality: 95,
                      }) || undefined
                    }
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
      <div className="banner-controls">
        <div className="banner-browse left" onClick={() => setIndex(index > 1 ? index - 1 : featured.items.length)}>
          ‹
        </div>
        <div className="banner-browse right" onClick={() => setIndex(index < featured.items.length ? index + 1 : 1)}>
          ›
        </div>
        <div className="banner-active-indicator">
          {featured &&
            featured.items.map((item, i) => {
              return (
                <div
                  key={i}
                  className={i + 1 === index ? 'banner-active-indicator-active' : ''}
                  onClick={() => setIndex(i + 1)}
                />
              );
            })}
        </div>
        {authenticated && (
          <button className="banner-close-button" onClick={removeBanner} aria-label="Close banner">
            <Icon icon={ICONS.REMOVE} />
          </button>
        )}
      </div>
    </div>
  );
}
