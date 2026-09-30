export const CLAIM_LIST_NO_MARGIN_CLASS = String.raw`tw:[&_li]:!m-0 tw:[&_li:hover]:bg-[rgba(var(--color-primary-dynamic),0.1)]`;

export const CLAIM_LIST_CLASS = String.raw`tw:w-full tw:[&_ul]:grid tw:[&_li]:list-none tw:[[data-upcoming-grid]_&]:opacity-100 tw:[[data-upcoming-grid]_&]:[transition:opacity_0.2s,display_0.2] tw:[[data-upcoming-list]_&]:opacity-100 tw:[[data-upcoming-list]_&]:[transition:opacity_0.2s,display_0.2] tw:[[data-upcoming-grid][data-upcoming-closed]_&]:h-0 tw:[[data-upcoming-grid][data-upcoming-closed]_&]:overflow-hidden tw:[[data-upcoming-grid][data-upcoming-closed]_&]:opacity-0`;

export const CLAIM_LIST_DROPDOWN_CLASS =
  'tw:px-app-m tw:py-0 tw:pr-app-xl tw:[background-position:right_var(--spacing-m)_center] tw:upto-small:ml-0';

export const CLAIM_LIST_HEADER_CLASS =
  'tw:mx-0 tw:mt-0 tw:mb-app-m tw:flex tw:flex-wrap tw:items-center tw:text-app-body tw:[.channelsPage-wrapper_&]:mb-0 tw:upto-small:mt-app-s';

const CLAIM_LIST_ALT_CONTROLS_BASE_CLASS = String.raw`tw:ml-auto tw:flex tw:items-center tw:self-start tw:[&>*]:ml-app-s tw:[&>.card\_\_actions--inline:first-child]:ml-[unset] tw:[.channelsPage-wrapper_&]:mt-auto tw:[.channelsPage-wrapper_&]:mb-app-m`;

export const CLAIM_LIST_ALT_CONTROLS_CLASS = `${CLAIM_LIST_ALT_CONTROLS_BASE_CLASS} tw:upto-small:hidden`;

export const CLAIM_LIST_ALT_CONTROLS_WRAP_CLASS = `${CLAIM_LIST_ALT_CONTROLS_BASE_CLASS} tw:upto-small:flex tw:upto-small:flex-wrap`;

export const CLAIM_LIST_SCROLL_TO_RECENT_CLASS = String.raw`tw:absolute tw:bottom-0 tw:left-0 tw:right-[12px] tw:z-[1600] tw:flex tw:justify-center tw:[transition:opacity_0.2s_ease,visibility_0.2s_ease] tw:[&_.button]:mb-app-xs tw:[&_.button]:border tw:[&_.button]:border-app-text tw:[&_.button]:!bg-[var(--color-header-button)] tw:[&_.button]:text-app-small tw:[&_.button]:backdrop-blur-[4px]`;
