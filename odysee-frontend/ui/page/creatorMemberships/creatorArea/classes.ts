import { HELP_CLASS } from '../../../component/common/help-classes.ts';

export const CREATOR_MEMBERSHIP_CLASSES = {
  page: 'membershipPage-wrapper membershipCreatorPage-wrapper tw:mx-auto tw:w-full tw:max-w-none',
  explainer: String.raw`membership-explainer tw:m-app-l tw:rounded-app tw:border tw:border-white tw:bg-[rgba(255,221,162,0.1)] tw:p-app-l tw:[&>*]:mb-app-m tw:[&_h1]:text-app-large`,
  help: `${HELP_CLASS} ${String.raw`tw:mb-app-m tw:flex tw:flex-col tw:gap-app-s tw:rounded-app tw:border tw:border-[rgb(231,150,6)] tw:bg-[rgba(218,218,4,0.2)] tw:p-app-s tw:text-center tw:!text-app-body tw:[&_a]:text-app-primary tw:[&_a:hover]:text-app-secondary`}`,
  tabs: String.raw`tw:[&>.tab\_\_divider]:hidden tw:upto-small:static`,
  tabWrapper: 'tab__wrapper tw:mb-app-l tw:border-b tw:border-b-[var(--color-header-button)] tw:bg-app-background',
  tabList: String.raw`tw:mx-auto tw:my-0 tw:w-[calc(100%_-_2*var(--spacing-l))] tw:max-w-[var(--page-max-width)] tw:[border-bottom:unset] tw:[--tab-list-padding-block:var(--spacing-xxs)] tw:[--tab-list-padding-inline:var(--spacing-xxs)] tw:upto-small:overflow-x-auto tw:upto-small:overflow-y-hidden`,
  tab: String.raw`tw:[&[aria-selected='true']:after]:h-[4px] tw:[&[aria-selected='true']:after]:bg-app-link tw:disabled:select-none tw:[&:disabled]:[-webkit-touch-callout:none] tw:upto-small:[--tab-flex:auto] tw:upto-small:[--tab-margin-right:var(--spacing-m)] tw:upto-small:whitespace-nowrap tw:upto-small:disabled:hidden`,
  tabPanel:
    'tw:relative tw:mx-auto tw:w-[calc(100%_-_2*var(--spacing-l))] tw:max-w-[var(--page-max-width)] tw:upto-small:w-full',
  header: String.raw`creator-header-wrapper tw:relative tw:mt-[calc(var(--spacing-l)*-1)] tw:flex tw:h-[184px] tw:min-h-[var(--cover-photo-height)] tw:w-full tw:flex-row tw:bg-fixed tw:bg-no-repeat tw:[background-image:url('https://static.odycdn.com/images/banner_creatorPortal.jpg')] tw:[background-position:0_0] tw:[background-size:100%] tw:before:absolute tw:before:right-0 tw:before:bottom-0 tw:before:left-0 tw:before:h-full tw:before:w-full tw:before:bg-[linear-gradient(0deg,#0d0d0d_0,transparent_65%)] tw:before:opacity-100 tw:before:content-[''] tw:small:[background-image:url('https://static.odycdn.com/images/banner_creatorPortal.jpg')] tw:medium:[background-image:url('https://static.odycdn.com/images/banner_creatorPortal.jpg')] tw:medium:[background-position:calc(50%_+_var(--side-nav-width--micro)/2)_calc(0%_-_60px)] tw:large:[background-image:url('https://static.odycdn.com/images/banner_creatorPortal.jpg')] tw:large:[background-position:calc(50%_+_var(--side-nav-width--micro)/2)_calc(0%_-_220px)] tw:xlarge:[background-image:url('https://static.odycdn.com/images/banner_creatorPortal.jpg')]`,
  headerContent:
    'creator-header tw:relative tw:mx-auto tw:h-full tw:w-[calc(100%_-_2*var(--spacing-l))] tw:max-w-[var(--page-max-width)]',
  headerBackButton: 'tw:upto-small:mt-[calc(var(--spacing-m)*2)]',
  headerTitle:
    'tw:absolute tw:bottom-app-m tw:rounded-app tw:bg-app-header tw:p-app-m tw:text-[xx-large] tw:font-bold tw:text-app-text',
  headerActions: 'right-side tw:flex tw:h-full tw:flex-col tw:justify-end tw:p-app-m tw:[&_button]:mb-app-s',
  tierHeader: 'create-tiers-header-buttons tw:flex tw:max-w-full tw:upto-small:mb-app-s tw:upto-small:flex-col',
  tierSelector: 'create-tiers-channel-selector tw:w-1/2 tw:upto-small:w-full',
  tierPreview: String.raw`create-tiers-preview-button tw:inline-block tw:w-1/2 tw:text-right tw:[&_.checkbox]:my-app-s tw:[&_.checkbox]:flex tw:[&_.checkbox]:flex-row tw:[&_.checkbox]:justify-end tw:upto-small:mb-app-s tw:upto-small:w-full tw:upto-small:text-left`,
  tableChannelHeader:
    'table-channel-header tw:mb-[6px] tw:[&_.channel-thumbnail]:mr-app-s tw:[&_.channel-thumbnail]:mb-app-s',
  errorColumn: 'creator-membership-error-column tw:block',
} as const;
