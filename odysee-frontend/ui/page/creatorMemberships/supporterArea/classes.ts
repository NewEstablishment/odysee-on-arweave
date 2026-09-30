export const SUPPORTER_MEMBERSHIP_CLASSES = {
  page: 'membershipPage-wrapper membershipSupporterPage-wrapper tw:mx-auto tw:w-full tw:max-w-none',
  tabs: 'tw:upto-small:static',
  tabWrapper: 'tab__wrapper tw:mb-app-l tw:border-b tw:border-b-[var(--color-header-button)] tw:bg-app-background',
  tabList: String.raw`tw:mx-auto tw:my-0 tw:w-[calc(100%_-_2*var(--spacing-l))] tw:max-w-[var(--page-max-width)] tw:[border-bottom:unset] tw:[--tab-list-padding-block:var(--spacing-xxs)] tw:[--tab-list-padding-inline:var(--spacing-xxs)] tw:upto-small:w-full tw:upto-small:overflow-x-auto tw:upto-small:overflow-y-hidden tw:upto-small:[--tab-list-padding-block:var(--spacing-s)] tw:upto-small:[--tab-list-padding-inline:var(--spacing-xs)]`,
  tab: String.raw`tw:[&[aria-selected='true']:after]:h-[4px] tw:[&[aria-selected='true']:after]:bg-app-link tw:disabled:select-none tw:[&:disabled]:[-webkit-touch-callout:none] tw:upto-small:[--tab-flex:auto] tw:upto-small:[--tab-margin-right:var(--spacing-m)] tw:upto-small:whitespace-nowrap tw:upto-small:disabled:hidden`,
  tabPanel:
    'tw:relative tw:mx-auto tw:w-[calc(100%_-_2*var(--spacing-l))] tw:max-w-[var(--page-max-width)] tw:upto-small:w-full',
  header: String.raw`supporter-header-wrapper tw:relative tw:mt-[calc(var(--spacing-l)*-1)] tw:h-[184px] tw:min-h-[var(--cover-photo-height)] tw:w-full tw:bg-fixed tw:bg-no-repeat tw:[background-image:url('https://static.odycdn.com/images/banner_DonorPortal.jpg')] tw:[background-position:0_0] tw:[background-size:100%] tw:before:absolute tw:before:right-0 tw:before:bottom-0 tw:before:left-0 tw:before:h-full tw:before:w-full tw:before:bg-[linear-gradient(0deg,#0d0d0d_0,transparent_65%)] tw:before:opacity-100 tw:before:content-[''] tw:small:[background-image:url('https://static.odycdn.com/images/banner_DonorPortal.jpg')] tw:medium:[background-image:url('https://static.odycdn.com/images/banner_DonorPortal.jpg')] tw:medium:[background-position:calc(50%_+_var(--side-nav-width--micro)/2)_calc(0%_-_60px)] tw:large:[background-image:url('https://static.odycdn.com/images/banner_DonorPortal.jpg')] tw:large:[background-position:calc(50%_+_var(--side-nav-width--micro)/2)_calc(0%_-_220px)] tw:xlarge:[background-image:url('https://static.odycdn.com/images/banner_creatorPortal.jpg')]`,
  headerContent:
    'supporter-header tw:relative tw:mx-auto tw:h-full tw:w-[calc(100%_-_2*var(--spacing-l))] tw:max-w-[var(--page-max-width)]',
  headerBackButton: 'tw:upto-small:mt-[calc(var(--spacing-m)*2)]',
  headerTitle:
    'tw:absolute tw:bottom-app-m tw:rounded-app tw:bg-app-header tw:p-app-m tw:text-[xx-large] tw:font-bold tw:text-app-text',
} as const;
