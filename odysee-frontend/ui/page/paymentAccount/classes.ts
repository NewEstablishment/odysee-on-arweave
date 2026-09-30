import {
  ACCOUNT_PAGE_CARD_CLASS,
  ACCOUNT_PAGE_CARD_TITLE_CLASS,
  ACCOUNT_PAGE_CLASSES,
} from '../../component/accountPage/classes.ts';
import { SECTION_CLASSES } from '../../component/common/section-classes.ts';

export const PAYMENT_ACCOUNT_PAGE_CLASSES = {
  ...ACCOUNT_PAGE_CLASSES,
  header: String.raw`page-header tw:relative tw:mt-[calc(var(--spacing-l)*-1)] tw:h-[184px] tw:min-h-[var(--cover-photo-height)] tw:w-full tw:bg-fixed tw:bg-no-repeat tw:[background-image:url('https://thumbs.odycdn.com/36f4a2447ac50941c99c74fb10d659cb.webp')] tw:[background-position-x:var(--side-nav-width--micro)] tw:[background-position-y:var(--header-height)] tw:[background-size:calc(100%_-_var(--side-nav-width--micro))] tw:after:absolute tw:after:right-0 tw:after:bottom-0 tw:after:left-0 tw:after:h-full tw:after:w-full tw:after:bg-[linear-gradient(0deg,#0d0d0d_0,transparent_65%)] tw:after:opacity-100 tw:after:content-[''] tw:[@media(min-width:1600.01px)]:[background-position:calc(50%_+_var(--side-nav-width--micro)/2)_calc(0%_-_320px)] tw:[@media(max-width:1600px)]:[background-position:calc(50%_+_var(--side-nav-width--micro)/2)_calc(0%_-_120px)] tw:upto-small:mx-[calc(var(--spacing-xs)*-1)] tw:upto-small:![background-position:50%_calc(0%_-_120px)] tw:upto-small:[background-size:auto_522px]`,
  sectionTitle: `${SECTION_CLASSES.titleSmall} tw:mt-0 tw:!font-semibold`,
} as const;

export const PAYMENT_ACCOUNT_CARD_CLASS = ACCOUNT_PAGE_CARD_CLASS;
export const PAYMENT_ACCOUNT_CARD_TITLE_CLASS = ACCOUNT_PAGE_CARD_TITLE_CLASS;
