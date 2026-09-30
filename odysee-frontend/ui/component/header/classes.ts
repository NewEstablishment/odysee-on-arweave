const HEADER_MENU_CLASS = String.raw`tw:flex tw:items-center tw:small:w-[16rem] tw:small:min-w-[16rem] tw:upto-small:[.card\_\_actions--between_&]:w-[5rem] tw:upto-small:[.card\_\_actions--between_&]:min-w-[5rem]`;

const HEADER_NAVIGATION_ITEM_CLASS = String.raw`tw:relative tw:flex tw:h-[var(--height-button)] tw:items-center tw:justify-center tw:rounded-app tw:[font-weight:var(--font-weight-bold)] tw:[&_svg]:stroke-app-text tw:aria-expanded:[transform:rotate(0deg)] tw:aria-expanded:!bg-[var(--color-header-button-hover)] tw:aria-expanded:[&_.icon]:stroke-[var(--color-odysee-contrast)] tw:upto-small:h-[var(--height-button-mobile)]`;

export const HEADER_ICON_BASE_CLASSES = String.raw`tw:relative tw:flex tw:h-[var(--height-button)] tw:items-center tw:justify-center tw:rounded-app tw:[font-weight:var(--font-weight-bold)] tw:[&_svg]:stroke-app-text tw:[&[aria-expanded='true']]:[transform:rotate(0deg)] tw:[&[aria-expanded='true']:not(.button-rotate)]:bg-[var(--color-header-button-hover)] tw:[&[aria-expanded='true']:not(.button-rotate)_.icon]:stroke-[var(--color-odysee-contrast)]`;

export const HEADER_ICON_SURFACE_CLASSES = String.raw`tw:mr-app-s tw:w-[var(--height-button)] tw:rounded-[1.5rem]! tw:bg-[var(--color-header-button)] tw:[&_span]:flex tw:[&_span]:items-center tw:[&_span]:justify-center tw:hover:bg-[var(--color-odysee)] tw:hover:[&_.icon]:stroke-[var(--color-odysee-contrast)] tw:upto-small:mr-0 tw:upto-small:size-[calc(var(--header-height-mobile)-var(--spacing-m))]`;

export const HEADER_NAVIGATION_ICON_CLASS = `header__navigationItem--icon ${HEADER_ICON_BASE_CLASSES} ${HEADER_ICON_SURFACE_CLASSES}`;

export const HEADER_SIDEBAR_TOGGLE_CLASS = String.raw`${HEADER_NAVIGATION_ICON_CLASS} button-rotate tw:mr-app-s! tw:[transform:rotate(90deg)] tw:[transition:transform_0.2s] tw:aria-expanded:[transform:rotate(0deg)] tw:aria-expanded:!bg-[var(--color-button-toggle-bg-active)] tw:aria-expanded:[&_.icon]:stroke-white`;

export const HEADER_MINIMAL_CLASS = String.raw`header--minimal tw:[border-bottom:none] tw:bg-[var(--color-header-background)] tw:[box-shadow:none] tw:[&_.header\_\_navigation]:p-app-xs tw:[&_.header\_\_navigationItem--logo]:h-[3rem] tw:[&_:is(.header\_\_menu--left,.header\_\_menu--right)]:w-[unset] tw:[&_:is(.header\_\_menu--left,.header\_\_menu--right)]:min-w-[unset]`;

export const HEADER_CONTENTS_CLASS =
  'header__contents tw:mr-[var(--body-scrollbar-width)] tw:flex tw:h-[var(--header-height)] tw:w-[unset] tw:flex-1 tw:items-center tw:px-app-m tw:py-app-s tw:upto-small:h-[var(--header-height-mobile)] tw:upto-small:p-app-xs';

export const HEADER_NAVIGATION_CLASS = String.raw`header__navigation tw:mr-[var(--body-scrollbar-width)] tw:flex tw:h-[var(--header-height)] tw:flex-1 tw:flex-nowrap tw:items-center tw:justify-between tw:px-app-m tw:py-app-s tw:[&_.wunderbar\_\_wrapper_:is(.wunderbar\_\_input,.wunderbar\_\_input--inline)]:!bg-[var(--color-header-button)] tw:[&_.wunderbar\_\_wrapper_:is(.wunderbar\_\_input,.wunderbar\_\_input--inline)]:rounded-[calc(var(--height-input)/2)] tw:[&_.button-surface--alt]:bg-[var(--color-header-button)] tw:[&_.button-surface--alt]:text-app-text tw:[&_.button-surface--alt:hover]:bg-[var(--color-odysee)] tw:[&_.button-surface--alt:hover]:text-[var(--color-odysee-contrast)] tw:[&_.button-surface\_\_content:hover_.button-surface\_\_label]:text-app-text tw:upto-small:h-[var(--header-height-mobile)] tw:upto-small:p-app-xs tw:upto-small:[&_.button-surface--alt]:flex tw:upto-small:[&_.button-surface--alt]:items-center tw:upto-small:[&_.button-surface--alt]:justify-center tw:upto-small:[&_.button-surface--alt]:p-0 tw:upto-small:[&_.button-surface--alt_.button-surface\_\_content]:h-[22px] tw:upto-small:[&_.button-surface--alt_.button-surface\_\_content]:w-[unset] tw:upto-small:[&_:is(.button,.header\_\_navigationItem--icon,.wunderbar\_\_mobile-search)]:size-[calc(var(--header-height-mobile)-var(--spacing-m))] tw:upto-small:[&_:is(.button,.header\_\_navigationItem--icon,.wunderbar\_\_mobile-search)]:bg-[rgba(var(--color-primary-static),0.6)] tw:upto-small:[&_:is(.button,.header\_\_navigationItem--icon,.wunderbar\_\_mobile-search)_.icon]:stroke-[var(--color-odysee-contrast)]`;

export const HEADER_MENU_LEFT_CLASS = `${HEADER_MENU_CLASS} header__menu--left tw:justify-start tw:ml-app-s tw:upto-small:ml-[unset]`;

export const HEADER_MENU_RIGHT_CLASS = `${HEADER_MENU_CLASS} header__menu--right tw:justify-end`;

export const HEADER_BALANCE_CLASS = String.raw`${HEADER_NAVIGATION_ITEM_CLASS} header__navigationItem--balance tw:mx-app-s tw:mr-app-s! tw:min-w-fit tw:!bg-[var(--color-header-button)] tw:p-app-xxs! tw:text-app-text tw:[transition:border-radius_0.4s] tw:[&_.button-surface\_\_label]:ml-app-xxs! tw:hover:!bg-[var(--color-header-button-hover)] tw:hover:text-[var(--color-primary-contrast)] tw:upto-small:ml-0!`;

export const HEADER_BALANCE_LOADING_CLASS =
  'header__navigationItem--balanceLoading tw:mx-app-s tw:my-0 tw:w-[4rem] tw:bg-[var(--color-header-button)] tw:upto-small:!m-0 tw:upto-small:w-[5rem]';

export const HEADER_BALANCE_ROUND_CLASS = String.raw`header__navigationItem--balance-round tw:[@media(max-width:1600px)]:min-w-[var(--height-button)] tw:[@media(max-width:1600px)]:max-w-[var(--height-button)] tw:[@media(max-width:1600px)]:rounded-[50%] tw:[@media(max-width:1600px)]:[&_.button-surface\_\_label]:hidden`;

export const HEADER_LOGO_BUTTON_CLASS = String.raw`${HEADER_NAVIGATION_ITEM_CLASS} header__navigationItem--logo tw:mx-app-s tw:text-app-text tw:small:w-[150px] tw:upto-small:m-0 tw:upto-small:rounded-[50%] tw:upto-small:[&_.button-surface\_\_label]:hidden tw:upto-small:[&_svg]:size-[calc(var(--header-height-mobile)-var(--spacing-m))]`;

export const HEADER_AUTH_BUTTONS_CLASS = String.raw`header__authButtons tw:flex tw:items-center tw:[font-weight:var(--font-weight-bold)] tw:[&>*:not(:last-child)]:mx-app-m tw:[&>*:not(:last-child)]:my-0 tw:upto-small:[&_:is(.button-surface--link,.button--uri-indicator,[data-comment-time],.comment\_\_action,.footer\_\_link,.tab)]:!m-0 tw:upto-small:[&_.markdown-preview_a]:!m-0 tw:upto-small:[.markdown-preview_&_a]:!m-0 tw:upto-small:[&_.button-surface--primary]:p-app-xxs`;

const HEADER_CENTERED_CLASS = String.raw`tw:flex tw:w-full tw:justify-center tw:[&_.button.active]:bg-app-primary tw:[&_.button.active_svg]:stroke-[var(--color-primary-contrast)]`;

export const HEADER_CENTER_CLASS = `header__center ${HEADER_CENTERED_CLASS}`;

export const HEADER_AUTH_TITLE_CLASS = `header__authTitle ${HEADER_CENTERED_CLASS} tw:justify-center tw:small:text-app-large tw:upto-small:hidden`;

export const HEADER_CHANGELOG_BUTTON_CLASS = String.raw`header__changelog-button tw:rounded-app tw:border-none tw:![background-image:var(--color-odysee-gradient)] tw:px-app-s tw:py-app-xxs tw:text-app-xsmall tw:font-bold tw:!text-white tw:[&_.icon]:!stroke-white tw:[&_:is(.button-surface\_\_label,.button-surface\_\_content)]:!text-white tw:[&:hover]:!text-white tw:[&:hover]:!stroke-white tw:[&:hover_:is(.button-surface\_\_label,.button-surface\_\_content,.icon)]:!text-white tw:[&:hover_:is(.button-surface\_\_label,.button-surface\_\_content,.icon)]:!stroke-white tw:upto-small:ml-app-s tw:upto-small:[&_.button-surface\_\_label]:hidden`;
