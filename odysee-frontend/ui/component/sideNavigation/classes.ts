const NAVIGATION_WRAPPER_LAYOUT_CLASS = String.raw`navigation__wrapper tw:h-[calc(100vh_-_var(--header-height))] tw:w-[var(--side-nav-width)] tw:supports-[height:100dvh]:h-[calc(100dvh_-_var(--header-height))] tw:upto-small:h-[calc(100vh_-_var(--header-height-mobile))] tw:upto-small:supports-[height:100dvh]:h-[calc(100dvh_-_var(--header-height-mobile))]`;

export const NAVIGATION_WRAPPER_FOCUS_CLASS = String.raw`tw:[&_*:focus-visible:not(.wunderbar\_\_input):not(.wunderbar\_\_input--inline):not(.menu\_\_list):not(.menu\_\_list--header):not(.menu\_\_list--header):not(.button-surface--secondary):not(.reaction-button-surface--like):not(.reaction-button-surface--dislike):not(select):not(input):not(textarea):not(video)]:!bg-[rgba(var(--color-primary-static),0.2)] tw:[&_*:focus-visible:not(.wunderbar\_\_input):not(.wunderbar\_\_input--inline):not(.menu\_\_list):not(.menu\_\_list--header):not(.menu\_\_list--header):not(.button-surface--secondary):not(.reaction-button-surface--like):not(.reaction-button-surface--dislike):not(select):not(input):not(textarea):not(video)]:!text-[var(--color-text)] tw:[&_*:focus-visible:not(.wunderbar\_\_input):not(.wunderbar\_\_input--inline):not(.menu\_\_list):not(.menu\_\_list--header):not(.menu\_\_list--header):not(.button-surface--secondary):not(.reaction-button-surface--like):not(.reaction-button-surface--dislike):not(select):not(input):not(textarea):not(video)]:[box-shadow:0_0_0_2px_var(--color-odysee)_inset] tw:[&_*:focus-visible:not(.wunderbar\_\_input):not(.wunderbar\_\_input--inline):not(.menu\_\_list):not(.menu\_\_list--header):not(.menu\_\_list--header):not(.button-surface--secondary):not(.reaction-button-surface--like):not(.reaction-button-surface--dislike):not(select):not(input):not(textarea):not(video)_.icon]:![stroke:var(--color-text)] tw:[&_select:focus-visible]:![box-shadow:0_0_0_2px_var(--color-odysee)_inset] tw:[&_input:focus-visible:not(.wunderbar\_\_input):not(.wunderbar\_\_input--inline)]:![box-shadow:0_0_0_2px_var(--color-odysee)_inset] tw:[&_textarea:focus-visible]:![box-shadow:0_0_0_2px_var(--color-odysee)_inset]`;

export const NAVIGATION_WRAPPER_CLASS = `${NAVIGATION_WRAPPER_LAYOUT_CLASS} ${NAVIGATION_WRAPPER_FOCUS_CLASS}`;

export const NAVIGATION_WRAPPER_MICRO_CLASS =
  'navigation__wrapper--micro tw:w-[var(--side-nav-width--micro)] tw:upto-small:w-0';

export const NAVIGATION_WRAPPER_ABSOLUTE_CLASS = String.raw`navigation__wrapper--absolute tw:[&:not(.navigation\_\_wrapper--micro)]:w-0`;

export const NAVIGATION_CLASS = String.raw`navigation tw:fixed tw:top-[var(--header-height)] tw:left-0 tw:z-[100000] tw:flex tw:h-[calc(100vh_-_var(--header-height))] tw:w-[var(--side-nav-width)] tw:origin-left tw:translate-x-0 tw:flex-col tw:overflow-x-hidden tw:overflow-y-auto tw:bg-[var(--color-card-background)] tw:[-webkit-backdrop-filter:blur(4px)] tw:[backdrop-filter:blur(4px)] tw:[animation-timing-function:var(--resizing-animation-function)] tw:[scrollbar-width:thin] tw:[transition:transform_var(--resizing-animation-timing)] tw:supports-[height:100dvh]:h-[calc(100dvh_-_var(--header-height))] tw:[&_.wunderbar\_\_input]:bg-[var(--color-header-button)] tw:[&_.wunderbar\_\_input--inline]:bg-[var(--color-header-button)] tw:[&_.empty--centered]:text-app-body tw:[&_.button-surface--secondary]:!bg-[var(--color-odysee)] tw:[&_.button-surface--secondary]:!text-[var(--color-odysee-contrast)] tw:[&_ul]:pb-app-s tw:[&_ul:empty]:hidden tw:medium:justify-between tw:medium:overflow-y-hidden tw:medium:hover:overflow-y-scroll tw:upto-medium:w-[calc(var(--side-nav-width)+6px)] tw:upto-small:top-[var(--header-height-mobile)] tw:upto-small:h-[calc(100vh_-_var(--header-height-mobile))] tw:upto-small:w-[var(--side-nav-width)] tw:upto-small:supports-[height:100dvh]:h-[calc(100dvh_-_var(--header-height-mobile))] tw:[@media(pointer:coarse)]:!overflow-y-auto`;

export const NAVIGATION_TOUCH_CLASS = 'navigation-touch tw:!overflow-y-auto';

export const NAVIGATION_MOBILE_ONLY_CLASS =
  'mobile-only tw:hidden tw:upto-small:block tw:active-fullscreen-side-panel:block';

export const NAVIGATION_PUSH_CLASS =
  'navigation--push tw:translate-x-0 tw:[&:not(.navigation--micro)]:overflow-y-scroll';

export const NAVIGATION_ABSOLUTE_CLASS =
  'navigation--absolute tw:z-[4] tw:w-[var(--side-nav-width)] tw:bg-[var(--color-header-background-transparent)] tw:pt-0 tw:[box-shadow:var(--card-box-shadow)]';

export const NAVIGATION_HIDDEN_CLASS =
  'navigation-file-page-and-mobile tw:[transform:translateX(calc(-1*var(--side-nav-width)))]';

export const NAVIGATION_MICRO_CLASS = String.raw`navigation--micro tw:[transform:translateX(calc(var(--side-nav-width--micro)_-_var(--side-nav-width)))] tw:[&_.navigation-inner-container_ul:nth-child(4)]:![border-bottom:unset] tw:[&_ul]:!pb-app-xs tw:medium:hover:w-[calc(var(--side-nav-width)+var(--scrollbar-width))] tw:medium:hover:overflow-y-auto tw:medium:hover:[scrollbar-width:thin] tw:upto-small:hidden`;

export const NAVIGATION_SECONDARY_CLASS = String.raw`navigation__secondary tw:mt-app-m tw:[&_.button-surface\_\_content]:items-start tw:[&_.navigation-item]:p-app-xxs tw:[&_.navigation-item_.button-surface\_\_content]:bg-[var(--color-header-button)]`;

export const NAVIGATION_TERTIARY_CLASS = String.raw`navigation__tertiary tw:mt-app-m tw:[&_.navigation-link]:!text-app-xxsmall tw:[&_.navigation-link_.button-surface\_\_content]:pt-0 tw:[&_.navigation-link_.button-surface\_\_content]:pb-0 tw:[&_.navigation-link_.button-surface\_\_label]:text-[var(--color-navigation-link)] tw:[&_.navigation-link:hover]:!text-app-text tw:[&_.navigation-link:hover_.button-surface\_\_content]:![background-color:unset] tw:[&_.navigation-link:hover_.button-surface\_\_label]:text-app-text`;

export const NAVIGATION_LINK_CLASS = String.raw`navigation-link tw:relative tw:block tw:w-full tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-small tw:font-bold tw:text-[var(--color-navigation-link)] tw:[&_.icon]:size-[1rem] tw:[&_.icon]:stroke-[var(--color-navigation-icon)] tw:[&_.icon]:[stroke-width:1.5px] tw:[&_.icon--Heart]:text-[var(--color-transparent)] tw:[&_.button-surface\_\_content]:ml-auto tw:[&_.button-surface\_\_content]:flex-col tw:[&_.button-surface\_\_content]:justify-start tw:[&_.button-surface\_\_content]:p-app-xxs tw:[&_.button-surface\_\_content]:pb-app-xxxs tw:[&_.button-surface\_\_label]:select-none tw:[&:hover:not(.navigation-link--active)_.button-surface\_\_content]:bg-[var(--color-navigation-hover)] tw:[&:hover:not(.navigation-link--active)_.button-surface\_\_content]:text-[var(--color-navigation-hover-text)] tw:[&:hover:not(.navigation-link--active)_.icon]:stroke-[var(--color-navigation-hover-text)] tw:medium:mb-0 tw:medium:text-left tw:medium:[&_.icon]:size-[1rem] tw:medium:[&_.button-surface\_\_content]:flex-row`;

export const NAVIGATION_LINK_WITH_THUMBNAIL_CLASS = String.raw`navigation-link--with-thumbnail tw:[&_.button-surface\_\_content]:!flex-row tw:[&_.channel-thumbnail]:mr-app-s tw:[&_.channel-thumbnail]:size-[1.5rem] tw:[&_.channel-thumbnail]:shrink-0 tw:[&_.channel-thumbnail_.ff-canvas]:size-full tw:[&_.channel-thumbnail_.ff-canvas]:rounded-[50%] tw:[&_.channel-thumbnail_.freezeframe-img]:size-full tw:[&_.channel-thumbnail_.freezeframe-img]:rounded-[50%] tw:[&_.comment\_\_badge]:ml-app-xxs`;

export const NAVIGATION_SETTINGS_LINKS_CLASS = String.raw`navigation-links--settings tw:ml-app-s tw:[&_.navigation-link]:rounded-app tw:[&_.navigation-link]:text-app-small`;

export const NAVIGATION_LINK_ACTIVE_CLASS = String.raw`navigation-link--active tw:[&_.button-surface\_\_content]:!bg-[var(--color-button-toggle-bg-active)] tw:[&_.button-surface\_\_content]:!text-[var(--color-odysee-contrast)] tw:[&_.button-surface\_\_content_.icon]:!stroke-[var(--color-navigation-active-text)] tw:hover:cursor-default`;

export const NAVIGATION_LINK_PULSE_CLASS =
  'navigation-link--pulse tw:overflow-visible tw:[&_.icon]:[animation:shadow-pulse_2.5s_infinite]';

export const NAVIGATION_LINK_HIGHLIGHTED_CLASS = String.raw`navigation-link--highlighted tw:[&_.button-surface\_\_content]:!bg-[var(--color-navigation-hover)] tw:[&_.button-surface\_\_content]:!text-[var(--color-navigation-hover-text)] tw:[&_.icon]:!stroke-[var(--color-navigation-hover-text)]`;

export const NAVIGATION_LINK_CENTERED_CLASS = String.raw`navigation-link--icon-centered tw:rounded-app tw:pl-0 tw:[&_.button-surface\_\_content]:!justify-center tw:[&.navigation-link--active]:hidden`;

export const NAVIGATION_LINKS_CLASS = String.raw`navigation-links tw:max-h-full tw:flex-col tw:items-start tw:[list-style:none] tw:[&_.claim-preview\_\_title]:h-[16px] tw:[&_.claim-preview\_\_title_.truncated-text]:h-[16px] tw:[&_.claim-preview\_\_title_.truncated-text]:mb-[unset] tw:[&_.placeholder_.claim-preview\_\_title_b]:h-[16px] tw:[&_.placeholder_.claim-preview\_\_title_b_.truncated-text]:h-[16px] tw:[&_.placeholder_.claim-preview\_\_title_b_.truncated-text]:mb-[unset]`;

export const NAVIGATION_SECTION_HEADER_CLASS =
  'navigation-section-header tw:mb-app-xxxs tw:flex tw:justify-between tw:border-b tw:border-b-app-border tw:px-app-s tw:py-app-xxxs tw:text-app-xsmall tw:text-app-text-subtitle tw:opacity-70 tw:[&_svg]:text-app-text-subtitle tw:[&_svg]:[scale:0.75] tw:[&_svg:hover]:text-app-primary';

export const NAVIGATION_INNER_CLASS = String.raw`navigation-inner-container tw:w-[var(--side-nav-width)] tw:[&_.navigation-links--micro:first-of-type]:mt-app-xxxs`;

export const NAVIGATION_LINKS_MICRO_CLASS = String.raw`navigation-links--micro tw:border-b tw:border-b-app-border tw:[&_li]:!mb-0 tw:[&_li]:!px-app-xxs tw:[&_li]:!py-[3px] tw:[&_.button-surface\_\_content]:!w-[calc(var(--side-nav-width--micro)_-_2*var(--spacing-xxs))] tw:[&_.button-surface\_\_content]:!flex-col tw:[&_.button-surface\_\_content]:!justify-start tw:[&_.button-surface\_\_content]:rounded-app tw:[&_.button-surface\_\_content_.icon]:!size-[1.1rem] tw:[&_.button-surface\_\_content_.icon]:![stroke-width:2px] tw:[&_.button-surface\_\_content_.button-surface\_\_label]:!ml-0 tw:[&_.button-surface\_\_content_.button-surface\_\_label]:max-w-full tw:[&_.button-surface\_\_content_.button-surface\_\_label]:text-app-xxsmall tw:[&_.button-surface\_\_content_.button-surface\_\_label]:font-normal tw:[&_.navigation-link]:!pl-0 tw:upto-small:hidden tw:xlarge:[&_.icon]:!mt-[6px] tw:xlarge:[&_.icon]:!size-[2.1rem] tw:xlarge:[&_.button-surface\_\_label]:!mt-[4px] tw:xlarge:[&_.button-surface\_\_label]:!mb-[2px]`;

export const NAVIGATION_LINKS_ABSOLUTE_CLASS = String.raw`navigation-links--absolute tw:[&_li]:!mb-0 tw:[&_li]:!px-app-xxs tw:[&_li]:!py-0 tw:[&_.navigation-link]:!mb-0 tw:[&_.navigation-link]:!pt-[2px] tw:[&_.navigation-link]:!pb-[2px] tw:[&_.navigation-link_.button-surface\_\_content]:!flex-row tw:[&_.navigation-link_.button-surface\_\_content]:rounded-app tw:[&_.navigation-link_.button-surface\_\_content_.icon]:!size-[1rem] tw:[&_.navigation-link_.button-surface\_\_content_.button-surface\_\_label]:!mt-0 tw:[&_.navigation-link_.button-surface\_\_content_.button-surface\_\_label]:text-app-small tw:[&_.navigation-link_.button-surface\_\_content_.button-surface\_\_label]:font-bold tw:upto-small:[&_.navigation-link_.button-surface\_\_label]:mb-[-1px]`;

export const NAVIGATION_LINKS_SMALL_CLASS = String.raw`navigation-links--small tw:mt-app-xxl tw:mr-0 tw:mb-0 tw:pr-0 tw:[&_.navigation-link]:text-app-small tw:[&_.button-surface\_\_content]:items-start`;

export const NAVIGATION_ITEM_CLASS = String.raw`navigation-item tw:p-app-s tw:[&_.empty]:p-0 tw:[&_.wunderbar_fieldset-section]:w-full tw:[&_.wunderbar_.fieldset-section]:w-full tw:[&_.wunderbar--inline_fieldset-section]:w-full tw:[&_.wunderbar--inline_.fieldset-section]:w-full tw:upto-small:[&_.wunderbar]:pl-0 tw:upto-small:[&_.wunderbar--inline]:pl-0 tw:upto-small:[&_.wunderbar_.icon]:left-app-s tw:upto-small:[&_.wunderbar--inline_.icon]:left-app-s`;

export const NAVIGATION_OVERLAY_CLASS =
  'navigation__overlay tw:fixed tw:top-[var(--header-height)] tw:left-0 tw:z-[3] tw:h-screen tw:w-screen tw:invisible tw:bg-[var(--color-background-overlay)] tw:opacity-0 tw:[-webkit-backdrop-filter:blur(2px)] tw:[backdrop-filter:blur(2px)] tw:[animation-timing-function:var(--resizing-animation-function)] tw:[transition:visibility_var(--resizing-animation-timing),opacity_var(--resizing-animation-timing)] tw:supports-[height:100dvh]:h-dvh tw:upto-small:top-[var(--header-height-mobile)]';

export const NAVIGATION_OVERLAY_ACTIVE_CLASS =
  'navigation__overlay--active tw:visible tw:opacity-100 tw:[animation:fadeIn_var(--resizing-animation-timing)_var(--resizing-animation-function)]';

export const NAVIGATION_AUTH_NUDGE_CLASS = String.raw`card tw:mx-app-s tw:mt-app-m tw:mb-app-s tw:flex tw:flex-col tw:text-app-small tw:[&_.button]:mt-app-s tw:[&_.button-surface\_\_content]:justify-center tw:[&_.icon]:mb-[-2px]`;

export const NAVIGATION_SUBSCRIPTION_CLASS = String.raw`navigation__subscription tw:mb-0 tw:[&_.button-surface\_\_content]:pt-app-xxs tw:[&_.button-surface\_\_content]:pb-app-xxs tw:[&_.navigation-link:hover_.channel-name]:text-app-primary-contrast tw:[&_.channel-thumbnail]:self-center tw:[&_.claim-preview\_\_title_span]:mb-[-3.5px] tw:[&_.claim-preview\_\_title_span]:block tw:[&_.claim-preview\_\_title_span]:overflow-hidden tw:[&_.claim-preview\_\_title_span]:text-ellipsis tw:[&_.claim-preview\_\_title_span]:whitespace-nowrap tw:[&_.claim-preview\_\_title_span]:text-app-xsmall tw:[&_.placeholder_.claim-preview\_\_title_b_span]:mb-[-3.5px] tw:[&_.placeholder_.claim-preview\_\_title_b_span]:block tw:[&_.placeholder_.claim-preview\_\_title_b_span]:overflow-hidden tw:[&_.placeholder_.claim-preview\_\_title_b_span]:text-ellipsis tw:[&_.placeholder_.claim-preview\_\_title_b_span]:whitespace-nowrap tw:[&_.placeholder_.claim-preview\_\_title_b_span]:text-app-xsmall tw:[&_.channel-name]:text-app-xxsmall tw:[&_.channel-name]:opacity-70`;

export const NAVIGATION_SUBSCRIPTION_TITLE_CLASS = String.raw`tw:max-w-[90%] tw:[&_.channel-name]:mr-app-m tw:[&_.channel-name]:block tw:[&_.channel-name]:max-w-full tw:[&_.channel-name]:overflow-hidden tw:[&_.channel-name]:text-ellipsis tw:[&_.channel-name]:whitespace-nowrap tw:[&_.comment\_\_badge]:brightness-[1.2]`;
