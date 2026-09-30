import React from 'react';
import { useOnResize } from 'effects/use-on-resize';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import * as SETTINGS from 'constants/settings';
import classnames from 'classnames';
import { NavLink } from 'react-router-dom';
import { DISABLED_CLASS } from 'component/common/state-classes';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectClientSetting } from 'redux/selectors/settings';
import { doSetClientSetting as doSetClientSettingAction } from 'redux/actions/settings';
import { getThumbnailCdnUrl } from 'util/thumbnail';

const PORTALS_WRAPPER_CLASS =
  'tw:group/portals tw:relative tw:mb-app-xxl tw:w-full tw:overflow-hidden tw:rounded-app tw:bg-fixed tw:bg-cover tw:px-[12px] tw:py-app-l tw:select-none tw:[-webkit-touch-callout:none] tw:upto-small:pt-app-xl';
const PORTAL_ITEM_CLASS = 'tw:mr-[12px] tw:inline-block';
const PORTAL_THUMBNAIL_CLASS = 'tw:w-full tw:rounded-t-app tw:![border-bottom:none] tw:[transition:background_0.6s]';
const PORTAL_BROWSE_CLASS =
  'tw:absolute tw:top-[calc(50%_-_30px)] tw:size-[60px] tw:rounded-[50%] tw:bg-[rgba(var(--color-header-background-base),0.8)] tw:text-center tw:text-[38px] tw:opacity-0 tw:group-hover/portals:opacity-80 tw:hover:cursor-pointer tw:hover:!bg-[rgba(var(--color-header-background-base),1)] tw:hover:!opacity-100 tw:upto-small:top-[calc(50%_-_20px)] tw:upto-small:size-[40px] tw:upto-small:text-[26px] tw:upto-small:opacity-80';
const PORTAL_DOT_CLASS =
  'tw:mx-app-xxs tw:inline-block tw:size-[12px] tw:rounded-[50%] tw:border tw:border-white tw:bg-[rgba(150,150,150,0.6)] tw:[transition:all_1s] tw:hover:cursor-pointer tw:hover:!bg-white tw:upto-small:size-[6px]';

type HomepageOrder = {
  active: Array<string> | null | undefined;
  hidden: Array<string> | null | undefined;
};
type Props = {
  homepageData: any;
  authenticated?: boolean;
  activePortal?: number;
};
function getInitialList(listId, savedOrder, homepageSections) {
  const savedActiveOrder = savedOrder.active || [];
  const savedHiddenOrder = savedOrder.hidden || [];
  const sectionKeys = Object.keys(homepageSections);
  let activeOrder: Array<string> = savedActiveOrder.filter((x) => sectionKeys.includes(x));
  let hiddenOrder: Array<string> = savedHiddenOrder.filter((x) => sectionKeys.includes(x));
  sectionKeys.forEach((key: string) => {
    if (!activeOrder.includes(key) && !hiddenOrder.includes(key)) {
      if (homepageSections[key].hideByDefault) {
        hiddenOrder.push(key);
      } else {
        if (key === 'BANNER') {
          activeOrder.unshift(key);
        } else if (key === 'PORTALS') {
          // Skip
        } else {
          activeOrder.push(key);
        }
      }
    }
  });
  activeOrder = activeOrder.filter((x) => !hiddenOrder.includes(x));
  return listId === 'ACTIVE' ? activeOrder : hiddenOrder;
}

export default function Portals(props: Props) {
  const { homepageData, authenticated, activePortal } = props;
  const dispatch = useAppDispatch();
  const homepageOrder = useAppSelector((state) => selectClientSetting(state, SETTINGS.HOMEPAGE_ORDER));
  const doSetClientSetting = (key: string, value: any, push: boolean) =>
    dispatch(doSetClientSettingAction(key, value, push));
  const { portals, categories } = homepageData;
  const mainPortal = portals?.mainPortal;
  const mainPortals = mainPortal?.portals || [];
  const [width, setWidth] = React.useState(0);
  const [tileWidth, setTileWidth] = React.useState(0);
  const [tileNum, setTileNum] = React.useState(0);
  const [marginLeft, setMarginLeft] = React.useState(0);
  const [index, setIndex] = React.useState(1);
  const [pause, setPause] = React.useState(false);
  const [hover, setHover] = React.useState(undefined);
  const rotate = mainPortals.length > tileNum;
  const [kill, setKill] = React.useState(false);
  const wrapper = React.useRef(null);
  const imageWidth = width >= 1600 ? 1700 : width >= 1150 ? 1150 : width >= 900 ? 900 : width >= 600 ? 600 : 400;
  React.useEffect(() => {
    if (rotate && width) {
      const interval = setInterval(() => {
        if (!pause) {
          setIndex(index + 1 <= mainPortals.length - (tileNum - 1) ? index + 1 : 1);
        }
      }, 5000 + 1000);
      return () => clearInterval(interval);
    }
  }, [rotate, mainPortals.length, tileNum, marginLeft, width, pause, index]);
  React.useEffect(() => {
    if (portals && width) {
      setMarginLeft((index - 1) * (tileWidth * -1));
    } // eslint-disable-next-line react-hooks/exhaustive-deps -- @see TODO_NEED_VERIFICATION
  }, [portals, index, width]);
  const handleResize = React.useCallback(() => {
    if (wrapper.current) {
      let wrapperWidth = wrapper.current.offsetWidth + 12;
      let tileNum = wrapperWidth > 954 ? 6 : wrapperWidth > 870 ? 5 : wrapperWidth > 470 ? 3 : 2;

      if (tileNum === 6 && mainPortals.length < 9 && mainPortals.length > 0) {
        tileNum = mainPortals.length;
      }

      setWidth(wrapperWidth);
      setTileNum(tileNum);
      setTileWidth(wrapperWidth / tileNum);
    }
  }, [mainPortals.length]);
  useOnResize(handleResize);
  const NON_CATEGORY = Object.freeze({
    BANNER: {
      label: 'Banner',
    },
    FOLLOWING: {
      label: 'Following',
    },
    PORTALS: {
      label: 'Portals',
    },
    FYP: {
      label: 'Recommended',
    },
  });

  function removePortals() {
    let orderToSave = homepageOrder;

    if (orderToSave.active && orderToSave.active.includes('PORTALS')) {
      orderToSave.active.splice(orderToSave.active.indexOf('PORTALS'), 1);

      if (orderToSave.hidden) {
        orderToSave.hidden.push('PORTALS');
      } else {
        orderToSave.hidden = ['PORTALS'];
      }
    } else if (!orderToSave.hidden) {
      const SECTIONS = { ...NON_CATEGORY, ...categories };
      orderToSave = {
        active: [],
        hidden: [],
      };
      orderToSave.active = getInitialList('ACTIVE', homepageOrder, SECTIONS);
      orderToSave.hidden = getInitialList('HIDDEN', homepageOrder, SECTIONS);
      orderToSave.hidden.push('PORTALS');
    } else if (orderToSave.hidden && !orderToSave.hidden.includes('PORTALS')) {
      orderToSave.hidden.push('PORTALS');
    }

    doSetClientSetting(SETTINGS.HOMEPAGE_ORDER, orderToSave, true);
    setKill(true);
  }

  return mainPortal ? (
    <div
      id="portals"
      className={classnames(PORTALS_WRAPPER_CLASS, {
        'tw:hidden': kill,
      })}
      style={{
        backgroundImage: `url(${getThumbnailCdnUrl({
          thumbnail: mainPortal.background,
          width: imageWidth,
          height: 0,
          quality: 95,
        })})`,
      }}
      onMouseEnter={() => setPause(true)}
      onMouseLeave={() => setPause(false)}
    >
      <h1 className="tw:absolute tw:w-full tw:bg-[radial-gradient(rgba(101,15,124,0.7)_0%,transparent_60%)] tw:text-center tw:text-app-large tw:font-bold tw:text-[rgba(255,255,255,0.9)] tw:upto-small:w-[90%]">
        {mainPortal.description}
      </h1>
      <div
        className="tw:relative tw:mt-[60px] tw:mb-app-m tw:ml-0 tw:flex tw:h-full tw:w-full tw:flex-nowrap tw:[transition:all_1s] tw:upto-small:mt-[80px]"
        style={{
          marginLeft: marginLeft,
        }}
        ref={wrapper}
      >
        {mainPortals.map((portal, i) => {
          return (
            <div
              className={classnames(PORTAL_ITEM_CLASS, {
                [DISABLED_CLASS]: portal.name === activePortal,
              })}
              style={{
                width: tileWidth - 12,
                minWidth: tileWidth - 12,
              }}
              key={i}
              onMouseEnter={() => setHover(portal.name)}
              onMouseLeave={() => setHover(undefined)}
            >
              <NavLink
                aria-hidden
                tabIndex={-1}
                to={
                  {
                    pathname: '/$/portal/' + portal.name,
                  } as any
                }
                state={portal}
              >
                <div
                  className={PORTAL_THUMBNAIL_CLASS}
                  style={{
                    background: `rgba(` + portal.css.rgb + `,` + (hover === portal.name ? 1 : 0.8) + `)`,
                    border: `2px solid rgba(` + portal.css.rgb + `,1)`,
                  }}
                >
                  <img
                    className="tw:rounded-t-app"
                    style={{
                      width: tileWidth - 12,
                      height: tileWidth - 12,
                    }}
                    src={
                      getThumbnailCdnUrl({ thumbnail: portal.image, width: 237, height: 0, quality: 95 }) || undefined
                    }
                  />
                </div>
                <div
                  className="tw:rounded-b-app tw:bg-[rgba(0,0,0,0.6)] tw:text-center"
                  style={{
                    border: `2px solid rgba(` + portal.css.rgb + `,1)`,
                  }}
                >
                  <label className="tw:font-bold tw:text-white tw:hover:cursor-pointer">{portal.label}</label>
                </div>
              </NavLink>
            </div>
          );
        })}
      </div>
      {mainPortals.length > tileNum && (
        <>
          <div
            className={`${PORTAL_BROWSE_CLASS} tw:left-app-m`}
            onClick={() => setIndex(index > 1 ? index - 1 : mainPortals.length - (tileNum - 1))}
          >
            ‹
          </div>
          <div
            className={`${PORTAL_BROWSE_CLASS} tw:right-app-m`}
            onClick={() => setIndex(index + (tileNum - 1) < mainPortals.length ? index + 1 : 1)}
          >
            ›
          </div>
          <div className="tw:absolute tw:bottom-app-m tw:flex tw:w-full tw:items-center tw:justify-center tw:text-center">
            {mainPortals.map((item, i) => {
              return (
                i < mainPortals.length - (tileNum - 1) && (
                  <div
                    key={i}
                    className={classnames(PORTAL_DOT_CLASS, {
                      'tw:!size-[12px] tw:!bg-white tw:upto-small:!size-[8px]': i + 1 === index,
                    })}
                    onClick={() => setIndex(i + 1)}
                  />
                )
              );
            })}
          </div>
        </>
      )}
      {authenticated && (
        <div
          className="tw:absolute tw:top-app-m tw:right-app-m tw:flex tw:rounded-app tw:bg-app-primary tw:p-[0.3rem] tw:opacity-0 tw:group-hover/portals:opacity-100 tw:hover:cursor-pointer tw:upto-small:top-app-s tw:upto-small:right-app-s"
          onClick={() => removePortals()}
        >
          <Icon className="tw:size-[1rem] tw:stroke-white" icon={ICONS.REMOVE} />
        </div>
      )}
    </div>
  ) : (
    <div className={PORTALS_WRAPPER_CLASS}>
      <div className={PORTAL_ITEM_CLASS}>
        <div className={PORTAL_THUMBNAIL_CLASS} />
      </div>
    </div>
  );
}
