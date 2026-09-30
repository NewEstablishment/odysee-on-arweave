import {
  ACCOUNT_PAGE_CARD_CLASS,
  ACCOUNT_PAGE_CARD_TITLE_CLASS,
  ACCOUNT_PAGE_CLASSES,
} from '../../component/accountPage/classes.ts';
import { SECTION_CLASSES } from '../../component/common/section-classes.ts';

export const AR_ACCOUNT_PAGE_CLASSES = {
  page: ACCOUNT_PAGE_CLASSES.page,
  header: String.raw`page-header tw:relative tw:mt-[calc(var(--spacing-l)*-1)] tw:h-[184px] tw:min-h-[var(--cover-photo-height)] tw:w-full tw:bg-fixed tw:bg-no-repeat tw:[background-image:url('https://thumbs.odycdn.com/a655210a5610362e238853d3db050538.webp')] tw:[background-position-x:var(--side-nav-width--micro)] tw:[background-position-y:var(--header-height)] tw:[background-size:calc(100%_-_var(--side-nav-width--micro))] tw:after:absolute tw:after:right-0 tw:after:bottom-0 tw:after:left-0 tw:after:h-full tw:after:w-full tw:after:bg-[linear-gradient(0deg,#0d0d0d_0,transparent_65%)] tw:after:opacity-100 tw:after:content-[''] tw:[@media(min-width:1600.01px)]:[background-position:calc(50%_+_var(--side-nav-width--micro)/2)_calc(0%_-_340px)] tw:[@media(max-width:1600px)]:[background-position:calc(50%_+_var(--side-nav-width--micro)/2)_calc(0%_-_220px)] tw:upto-medium:![background-position:calc(50%_+_var(--side-nav-width--micro)/2)_calc(0%_-_60px)] tw:upto-small:mx-[calc(var(--spacing-xs)*-1)] tw:upto-small:[background-image:url('https://thumbs.odycdn.com/a655210a5610362e238853d3db050538.webp')] tw:upto-small:![background-position:0_0] tw:upto-small:[background-size:100%]`,
  tabs: String.raw`tw:[&_.tab\_\_divider]:hidden`,
  tabWrapper: ACCOUNT_PAGE_CLASSES.tabWrapper,
  tabList: ACCOUNT_PAGE_CLASSES.tabList,
  tab: ACCOUNT_PAGE_CLASSES.tab,
  tabPanel: `${ACCOUNT_PAGE_CLASSES.tabPanel} tw:upto-small:w-full`,
  wallet: ACCOUNT_PAGE_CLASSES.wallet,
  card: ACCOUNT_PAGE_CARD_CLASS,
  cardTitle: ACCOUNT_PAGE_CARD_TITLE_CLASS,
  refresh: ACCOUNT_PAGE_CLASSES.refresh,
  refreshLoading: ACCOUNT_PAGE_CLASSES.refreshLoading,
  sectionTitle: String.raw`${SECTION_CLASSES.titleSmall} tw:mt-0 tw:flex tw:!font-semibold tw:[&_a]:ml-auto tw:[&_a]:font-semibold tw:[&_a]:!text-app-primary tw:[&_a:hover]:cursor-pointer tw:[&_a:hover]:!text-app-secondary`,
  learnMore: String.raw`learn-more tw:ml-auto tw:flex tw:items-center tw:justify-center tw:rounded-[var(--border-radius)_var(--border-radius)_0_0] tw:bg-app-background tw:pr-app-s tw:text-app-xxsmall tw:[&:hover_a]:!text-app-secondary tw:[&:hover_svg]:text-app-secondary`,
  learnMoreIcon: 'tw:mt-[-2px] tw:mr-app-xxxxs tw:ml-app-s tw:size-[var(--font-xsmall)] tw:text-app-primary',
  learnMoreLink: 'tw:font-semibold tw:!text-app-primary',
  sectionContent: ACCOUNT_PAGE_CLASSES.sectionContent,
  help: `${HELP_CLASS} ${String.raw`tw:[&_a]:!text-app-primary tw:[&_a:hover]:!text-app-secondary`}`,
} as const;

export const AR_ACCOUNT_CARD_CLASS = AR_ACCOUNT_PAGE_CLASSES.card;
export const AR_ACCOUNT_CARD_TITLE_CLASS = AR_ACCOUNT_PAGE_CLASSES.cardTitle;
import { HELP_CLASS } from '../../component/common/help-classes.ts';
