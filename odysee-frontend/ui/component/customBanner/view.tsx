import React, { useState } from 'react';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import { LocalStorage } from 'util/storage';

type Props = {
  image: { url: string; alt: string };
  label: string;
  description: string;
  tag?: string;
  button: { text: string; link: string };
  background: { url: string; alt: string };
  isSecondary?: boolean;
};

const BANNER_CONTAINER_CLASS =
  'tw:relative tw:mx-auto tw:mt-0 tw:mb-[20px] tw:w-full tw:overflow-hidden tw:rounded-[4px] tw:px-[30px] tw:py-0 tw:[@media(min-width:769px)_and_(max-width:1024px)]:p-[20px] tw:[@media(min-width:769px)_and_(max-width:992px)]:px-[20px] tw:[@media(min-width:769px)_and_(max-width:992px)]:py-0 tw:[@media(max-width:768px)]:mb-[15px] tw:[@media(max-width:768px)]:p-[15px]';
const BANNER_CONTENT_CLASS =
  'tw:flex tw:items-center tw:gap-[20px] tw:[@media(min-width:769px)_and_(max-width:800px)]:[flex-direction:inherit] tw:[@media(min-width:769px)_and_(max-width:800px)]:text-center tw:[@media(min-width:769px)_and_(max-width:992px)]:gap-[12px] tw:[@media(min-width:1025px)_and_(max-width:1150px)]:gap-[15px] tw:[@media(min-width:1151px)_and_(max-width:1280px)]:gap-[18px] tw:[@media(max-width:768px)]:flex-col tw:[@media(max-width:768px)]:gap-[15px] tw:[@media(max-device-width:800px)_and_(orientation:portrait)]:text-center';
const BANNER_IMAGE_CLASS =
  'tw:mr-[15px] tw:size-[240px] tw:object-cover tw:[transition:all_0.3s_ease] tw:[@media(min-width:769px)_and_(max-width:800px)]:[margin:0_auto_15px] tw:[@media(min-width:769px)_and_(max-width:992px)]:size-[180px] tw:[@media(min-width:993px)_and_(max-width:1024px)]:size-[200px] tw:[@media(min-width:1025px)_and_(max-width:1150px)]:size-[220px] tw:[@media(min-width:1151px)_and_(max-width:1280px)]:size-[230px] tw:[@media(max-width:768px)]:[margin:0_0_15px_0]';
const BANNER_LABEL_CLASS =
  'tw:mb-[10px] tw:max-w-[800px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:[font-size:30px] tw:font-bold tw:[transition:color_0.3s_ease] tw:[@media(min-width:769px)_and_(max-width:800px)]:text-center tw:[@media(min-width:769px)_and_(max-width:800px)]:whitespace-normal tw:[@media(min-width:769px)_and_(max-width:992px)]:[font-size:24px] tw:[@media(min-width:993px)_and_(max-width:1024px)]:[font-size:26px] tw:[@media(min-width:1025px)_and_(max-width:1280px)]:[font-size:28px] tw:[@media(min-width:1025px)_and_(max-width:1200px)]:whitespace-normal tw:[@media(min-width:1151px)_and_(max-width:1280px)]:max-w-[700px] tw:[@media(max-width:768px)]:[font-size:22px] tw:[@media(max-width:768px)]:whitespace-normal tw:[@media(max-device-width:800px)_and_(orientation:portrait)]:text-center tw:[@media_only_screen_and_(min-device-width:768px)_and_(max-device-width:1024px)_and_(-webkit-min-device-pixel-ratio:2)]:font-semibold';
const BANNER_DESCRIPTION_CLASS =
  'tw:mb-[10px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:[font-size:18px] tw:[transition:color_0.3s_ease] tw:[@media(min-width:769px)_and_(max-width:800px)]:text-center tw:[@media(min-width:769px)_and_(max-width:800px)]:whitespace-normal tw:[@media(min-width:769px)_and_(max-width:1024px)]:[font-size:16px] tw:[@media(min-width:1025px)_and_(max-width:1280px)]:[font-size:17px] tw:[@media(min-width:1025px)_and_(max-width:1200px)]:whitespace-normal tw:[@media(min-width:1151px)_and_(max-width:1280px)]:max-w-[700px] tw:[@media(max-width:768px)]:[font-size:15px] tw:[@media(max-width:768px)]:whitespace-normal tw:[@media(max-device-width:800px)_and_(orientation:portrait)]:text-center';
const BANNER_TAG_CLASS =
  'tw:mb-[20px] tw:block tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:[font-size:15px] tw:font-bold tw:[transition:color_0.3s_ease] tw:[@media(min-width:769px)_and_(max-width:800px)]:text-center tw:[@media(min-width:769px)_and_(max-width:800px)]:whitespace-normal tw:[@media(min-width:769px)_and_(max-width:992px)]:mb-[15px] tw:[@media(max-width:768px)]:[font-size:13px] tw:[@media(max-width:768px)]:whitespace-normal tw:[@media(max-device-width:800px)_and_(orientation:portrait)]:text-center';
const BANNER_BUTTON_CLASS =
  'tw:inline-block tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:rounded-[5px] tw:p-[10px] tw:font-bold tw:text-white tw:no-underline tw:[transition:all_0.3s_ease] tw:hover:[transform:translateY(-1px)] tw:[@media(min-width:769px)_and_(max-width:992px)]:px-[11px] tw:[@media(min-width:769px)_and_(max-width:992px)]:py-[9px] tw:[@media(min-width:769px)_and_(max-width:992px)]:[font-size:14px] tw:[@media(min-width:993px)_and_(max-width:1024px)]:px-[15px] tw:[@media(min-width:993px)_and_(max-width:1024px)]:py-[12px] tw:[@media(min-width:1025px)_and_(max-width:1150px)]:px-[12px] tw:[@media(min-width:1025px)_and_(max-width:1150px)]:py-[10px] tw:[@media(min-width:1151px)_and_(max-width:1280px)]:px-[14px] tw:[@media(min-width:1151px)_and_(max-width:1280px)]:py-[10px] tw:[@media(max-width:768px)]:w-full tw:[@media(max-width:768px)]:p-[12px] tw:[@media(max-width:768px)]:[font-size:15px] tw:[@media_only_screen_and_(min-device-width:993px)_and_(max-device-width:1024px)_and_(-webkit-min-device-pixel-ratio:2)]:px-[14px] tw:[@media_only_screen_and_(min-device-width:993px)_and_(max-device-width:1024px)_and_(-webkit-min-device-pixel-ratio:2)]:py-[11px]';
const BANNER_CLOSE_CLASS =
  'tw:absolute tw:top-[var(--spacing-s)] tw:right-[var(--spacing-s)] tw:z-10 tw:flex tw:size-[32px] tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[var(--border-radius)] tw:![border:none] tw:bg-[rgba(var(--color-header-background-base),0.8)] tw:p-0 tw:text-app-text tw:[&_.icon]:size-[14px] tw:hover:bg-[rgba(var(--color-header-background-base),1)]';
const BANNER_BACKGROUND_CLASS =
  'tw:mr-auto tw:size-[240px] tw:object-cover tw:[@media(max-width:768px)]:[margin:0_0_15px_0]';

const CustomBanner = ({ image, label, description, tag, button, background, isSecondary = false }: Props) => {
  // Generate a unique key for the banner based on its content (e.g., the tag)
  const bannerKey = `banner-${label.replace(/\s+/g, '-').toLowerCase()}`;
  // State to control the visibility of the banner
  const [isVisible, setIsVisible] = useState(() => {
    // Check if the banner was previously closed (using localStorage)
    const isBannerClosed = LocalStorage.getItem(bannerKey) === 'closed';
    return !isBannerClosed;
  });
  const handleCloseBanner = () => {
    setIsVisible(false);
    LocalStorage.setItem(bannerKey, 'closed');
  };
  if (!isVisible) return null;

  /* If you want the banner to appear again after some time or in a new session, you can clear the saved state in localStorage. For example:
  // Clear the status of all banners
  Object.keys(localStorage).forEach((key) => {
  if (key.startsWith("banner-")) {
    localStorage.removeItem(key);
  }
  }); */
  return (
    <div
      className={`${BANNER_CONTAINER_CLASS} ${
        isSecondary ? 'tw:bg-[var(--banner-secondary-bg)]' : 'tw:bg-[var(--banner-primary-bg)]'
      }`}
    >
      <button className={BANNER_CLOSE_CLASS} onClick={handleCloseBanner} aria-label="Close banner">
        <Icon icon={ICONS.REMOVE} />
      </button>

      <div className={BANNER_CONTENT_CLASS}>
        <img className={BANNER_IMAGE_CLASS} src={image.url} alt={image.alt} />
        <div className="tw:flex-1">
          <div
            className={`${BANNER_LABEL_CLASS} ${
              isSecondary
                ? 'tw:text-[var(--banner-secondary-label)]'
                : 'tw:text-[var(--banner-primary-label)] tw:[text-shadow:0_0px_1px_rgba(0,0,0,0.3)]'
            }`}
          >
            {label}
          </div>
          <div
            className={`${BANNER_DESCRIPTION_CLASS} ${
              isSecondary
                ? 'tw:text-[var(--banner-secondary-description)]'
                : 'tw:text-[var(--banner-primary-description)]'
            }`}
          >
            {description}
          </div>
          {tag && (
            <div
              className={`${BANNER_TAG_CLASS} ${
                isSecondary ? 'tw:text-[var(--banner-secondary-tag)]' : 'tw:text-[var(--banner-primary-tag)]'
              }`}
            >
              {tag}
            </div>
          )}
          <a
            className={`${BANNER_BUTTON_CLASS} ${
              isSecondary
                ? 'tw:bg-[var(--banner-secondary-button-bg)] tw:text-[var(--banner-secondary-button-text)] tw:hover:bg-[var(--banner-secondary-button-hover)]'
                : 'tw:bg-[var(--banner-primary-button-bg)] tw:hover:bg-[var(--banner-primary-button-hover)]'
            }`}
            href={button.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            {button.text}
          </a>
        </div>
        <img className={BANNER_BACKGROUND_CLASS} src={background.url} alt={background.alt} />
      </div>
    </div>
  );
};

export default CustomBanner;
