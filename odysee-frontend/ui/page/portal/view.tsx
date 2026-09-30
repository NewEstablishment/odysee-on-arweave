import React from 'react';
import Page from 'component/page';
import { useParams } from 'react-router-dom';
import ClaimListDiscover from 'component/claimListDiscover';
import { lazyImport } from 'util/lazyImport';
import { useAppSelector } from 'redux/hooks';
import { selectHomepageData } from 'redux/selectors/settings';
import { selectUser } from 'redux/selectors/user';
import { PORTAL_PAGE_CLASSES, PORTAL_THEME_CLASS } from './classes';
import { WALLPAPER_PORTAL_ACTIVE_CLASS } from 'component/wallpaper/classes';
import { getThumbnailCdnUrl } from 'util/thumbnail';

const Portals = lazyImport(
  () =>
    import(
      'component/portals'
      /* webpackChunkName: "portals" */
    )
);

export const PortalContext = React.createContext<any>(undefined);

function PortalPage() {
  const homepageData = useAppSelector(selectHomepageData) || {};
  const user = useAppSelector(selectUser);

  const { portals: portalData } = homepageData;
  const { mainPortal } = portalData || {};
  const portals = mainPortal?.portals;
  const { global_mod, internal_feature } = user || {};
  const showViews = global_mod || internal_feature;

  const [portal, setIndex] = React.useState(undefined);
  const [displayedTiles, setDisplayedTiles] = React.useState(0);
  let { portalName } = useParams();
  React.useEffect(() => {
    if (portals) {
      const index = portals.find((portal) => portal.name === portalName);
      setIndex(index);
    }
  }, [portals, portalName]);
  React.useEffect(() => {
    if (!portal) return;

    const theme = document.querySelector<HTMLElement>('.theme');
    const stars = document.querySelector<HTMLElement>('.stars');
    const previousBackgroundImage = theme?.style.backgroundImage || '';

    document.documentElement.classList.add(PORTAL_THEME_CLASS);
    if (theme) {
      theme.style.backgroundImage =
        'radial-gradient(circle at 80% 20%, rgba(0,0,0,0.6), #000 50%, rgba(101,15,124,0.9) 25%, #000 75%)';
    }
    stars?.classList.add(WALLPAPER_PORTAL_ACTIVE_CLASS);

    return () => {
      document.documentElement.classList.remove(PORTAL_THEME_CLASS);
      if (theme) theme.style.backgroundImage = previousBackgroundImage;
      stars?.classList.remove(WALLPAPER_PORTAL_ACTIVE_CLASS);
    };
  }, [portal]);
  return portal ? (
    <>
      <Page fullWidthPage>
        <div className={PORTAL_PAGE_CLASSES.header}>
          <img
            className={PORTAL_PAGE_CLASSES.image}
            src={getThumbnailCdnUrl({ thumbnail: portal.image, width: 237, height: 0, quality: 95 }) || undefined}
            style={{
              background: `rgba(` + portal.css.rgb + `,1)`,
            }}
          />
          <div className={PORTAL_PAGE_CLASSES.meta}>
            <h1 className={PORTAL_PAGE_CLASSES.title}>{portal.label}</h1>
            <p className={PORTAL_PAGE_CLASSES.description}>{portal.description}</p>
          </div>
        </div>
        <div className={PORTAL_PAGE_CLASSES.content}>
          <ClaimListDiscover
            claimIds={(portal.claimIds && portal.claimIds.videos) || []}
            infiniteScroll
            tileLayout
            showHeader={false}
            loadedCallback={setDisplayedTiles}
            fetchViewCount={showViews}
          />
        </div>
        {homepageData && displayedTiles >= portal.claimIds.videos.length - 3 && (
          <Portals homepageData={homepageData} activePortal={portal.name} />
        )}
      </Page>
    </>
  ) : (
    <></>
  );
}

export default PortalPage;
