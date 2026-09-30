import { lazyImport } from 'util/lazyImport';
import { MAIN_CLASS } from 'constants/classnames';
import { parseURI } from 'util/lbryURI';
import { useLocation } from 'react-router-dom';
import { useIsMobile, useIsSmallScreen } from 'effects/use-screensize';
import classnames from 'classnames';
import Header from 'component/header';
import React from 'react';
import Wallpaper from 'component/wallpaper';
import usePersistedState from 'effects/use-persisted-state';
import { useAppSelector } from 'redux/hooks';
import { makeSelectFileRenderModeForUri } from 'redux/selectors/content';
import { selectClientSetting } from 'redux/selectors/settings';
import { selectPrimaryUri } from 'redux/selectors/content';
import * as SETTINGS from 'constants/settings';
import { CHAT_POPOUT_PAGE_CLASS } from 'component/chat/classes';
import { isHyperbeamImmutableWebPath } from 'util/hyperbeam-route';
import {
  AUTH_PAGE_CLASS,
  AUTH_PAGE_WRAPPER_CLASS,
  PAGE_MAIN_LIVESTREAM_THEATER_CLASS,
  PAGE_MAIN_FULL_WIDTH_CLASS,
  PAGE_MAIN_MARKDOWN_CLASS,
  PAGE_MAIN_SETTINGS_CLASS,
  PAGE_MAIN_SHORTS_CLASS,
  PAGE_MAIN_THEATER_CLASS,
  PAGE_MAIN_VIDEO_CLASS,
  PAGE_MAIN_WRAPPER_CLASS,
  PAGE_MAIN_WRAPPER_FILE_CLASS,
  PAGE_SIDEBAR_PUSHER_CLASS,
  PAGE_SIDEBAR_PUSHER_FILE_CLASS,
} from './classes';
const Footer = lazyImport(
  () =>
    import(
      'web/component/footer'
      /* webpackChunkName: "footer" */
    )
);
const SettingsSideNavigation = lazyImport(
  () =>
    import(
      'component/settingsSideNavigation'
      /* webpackChunkName: "settingsSideNavigation" */
    )
);
const SideNavigation = lazyImport(
  () =>
    import(
      'component/sideNavigation'
      /* webpackChunkName: "sideNavigation" */
    )
);
type Props = {
  authPage?: boolean;
  authRedirect?: string;
  // Redirects to '/' by default.
  backout?: {
    backLabel?: string;
    backNavDefault?: string;
    onBack?: () => void;
    title: string | React.ReactNode;
    simpleTitle?: string; // Just use the same value as `title` if `title` is already short (~< 10 chars), unless you have a better idea for title overlfow on mobile
  };
  children?: React.ReactNode | Array<React.ReactNode>;
  className?: string | null | undefined;
  filePage?: boolean;
  fullWidthPage?: boolean;
  isMarkdown?: boolean;
  livestream?: boolean;
  noFooter?: boolean;
  noHeader?: boolean;
  noSideNavigation?: boolean;
  settingsPage?: boolean;
  isPopoutWindow?: boolean;
  notcontained?: boolean;
  backoutLabel?: string;
};

function Page(props: Props) {
  const {
    authPage = false,
    authRedirect,
    backout,
    children,
    className,
    filePage = false,
    fullWidthPage = false,
    isMarkdown = false,
    livestream,
    noFooter = false,
    noHeader = false,
    noSideNavigation = false,
    settingsPage,
    isPopoutWindow,
  } = props;
  const primaryUri = useAppSelector(selectPrimaryUri);
  const renderMode = useAppSelector((state) => makeSelectFileRenderModeForUri(primaryUri)(state));
  const videoTheaterMode = useAppSelector((state) => selectClientSetting(state, SETTINGS.VIDEO_THEATER_MODE));
  const { pathname, hash, search } = useLocation();
  const theaterMode =
    renderMode === 'video' || renderMode === 'audio' || renderMode === 'unsupported' ? videoTheaterMode : false;
  const isSmallScreen = useIsSmallScreen();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = usePersistedState('sidebar', false);
  const openSidebar = React.useCallback((open) => setSidebarOpen(open), []); // eslint-disable-line react-hooks/exhaustive-deps

  const urlPath = `lbry://${(pathname + hash).slice(1).replace(/:/g, '#')}`;
  let isOnFilePage = filePage || isHyperbeamImmutableWebPath(pathname);

  if (!isOnFilePage) {
    try {
      const { isChannel } = parseURI(urlPath);
      if (!isChannel) isOnFilePage = true;
    } catch (e) {}
  }

  const isAbsoluteSideNavHidden = (isOnFilePage || isMobile) && !sidebarOpen;
  const urlParams = new URLSearchParams(search);
  const isShortVideo = urlParams.get('view') === 'shorts';
  React.useEffect(() => {
    if (isOnFilePage || isSmallScreen) setSidebarOpen(false); // TODO: make sure setState callback for usePersistedState uses useCallback to it doesn't cause effect to re-run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnFilePage, isSmallScreen]);
  return (
    <>
      <Wallpaper uri={urlPath} />
      {!noHeader && (
        <Header
          authHeader={authPage}
          authRedirect={authRedirect}
          backout={backout}
          sidebarOpen={sidebarOpen}
          isAbsoluteSideNavHidden={isAbsoluteSideNavHidden}
          setSidebarOpen={openSidebar}
          hideSidebarToggle={noSideNavigation}
        />
      )}

      <div
        className={classnames(PAGE_MAIN_WRAPPER_CLASS, {
          [PAGE_MAIN_WRAPPER_FILE_CLASS]: isOnFilePage,
          'tw:pt-0': isOnFilePage && theaterMode && !isMobile,
          [AUTH_PAGE_WRAPPER_CLASS]: authPage,
          [CHAT_POPOUT_PAGE_CLASS]: isPopoutWindow,
        })}
      >
        {!authPage && (
          <React.Suspense fallback={null}>
            {settingsPage ? (
              <SettingsSideNavigation />
            ) : (
              !noSideNavigation && (
                <SideNavigation
                  sidebarOpen={sidebarOpen}
                  setSidebarOpen={openSidebar}
                  isMediumScreen={isSmallScreen}
                  isOnFilePage={isOnFilePage}
                />
              )
            )}
          </React.Suspense>
        )}

        <div
          className={classnames({
            [PAGE_SIDEBAR_PUSHER_CLASS]: fullWidthPage,
            'sidebar--pusher--open': sidebarOpen && fullWidthPage,
            [PAGE_SIDEBAR_PUSHER_FILE_CLASS]: !fullWidthPage,
          })}
        >
          <main
            id={'main-content'}
            className={classnames(MAIN_CLASS, className, {
              [PAGE_MAIN_FULL_WIDTH_CLASS]: fullWidthPage,
              [AUTH_PAGE_CLASS]: authPage,
              'main--file-page': filePage,
              [PAGE_MAIN_VIDEO_CLASS]: filePage && !theaterMode && !livestream && !isMarkdown && !isShortVideo,
              [PAGE_MAIN_SETTINGS_CLASS]: settingsPage,
              [PAGE_MAIN_MARKDOWN_CLASS]: isMarkdown,
              [PAGE_MAIN_THEATER_CLASS]: isOnFilePage && theaterMode && !livestream && !isMarkdown && !isMobile,
              'main--livestream': livestream && !theaterMode,
              [PAGE_MAIN_LIVESTREAM_THEATER_CLASS]: livestream && theaterMode,
              [CHAT_POPOUT_PAGE_CLASS]: isPopoutWindow,
              [PAGE_MAIN_SHORTS_CLASS]: isShortVideo,
            })}
          >
            {children}
          </main>

          {!noFooter && (
            <React.Suspense fallback={null}>
              <Footer />
            </React.Suspense>
          )}
        </div>
      </div>
    </>
  );
}

export default Page;
