import { PAGE_MAIN_FULL_WIDTH_CLASS } from '../page/classes.ts';

export const ACCOUNT_PAGE_CLASSES = {
  page: `paymentAccountPage-wrapper ${PAGE_MAIN_FULL_WIDTH_CLASS} tw:w-full`,
  tabWrapper: 'tab__wrapper tw:mb-app-l tw:border-b tw:border-b-[var(--color-header-button)] tw:bg-app-background',
  tabList:
    'tabs__list tw:mx-auto tw:w-[calc(100%_-_2*var(--spacing-l))] tw:max-w-[var(--page-max-width)] tw:border-b-[unset] tw:[--tab-list-padding-block:var(--spacing-xxs)] tw:[--tab-list-padding-inline:var(--spacing-xxs)] tw:upto-small:w-full tw:upto-small:[--tab-list-padding-block:var(--spacing-s)] tw:upto-small:[--tab-list-padding-inline:var(--spacing-xs)]',
  tab: 'tw:select-none tw:aria-selected:after:h-[4px] tw:aria-selected:after:bg-app-link tw:upto-small:disabled:hidden',
  tabPanel: 'tw:relative tw:mx-auto tw:w-[calc(100%_-_2*var(--spacing-l))] tw:max-w-[var(--page-max-width)]',
  wallet: 'wallet tw:absolute tw:inset-0 tw:flex tw:items-center tw:justify-center',
  card: String.raw`account-page-card-surface tw:h-full tw:rounded-app tw:bg-[var(--color-header-button)] tw:p-app-s tw:[&_a]:text-app-text tw:[&_.credit-amount]:text-app-body tw:[&_.card\_\_actions]:[align-items:end] tw:[&_.empty_.spinner]:![border:unset] tw:[&_.empty_.spinner]:![background:unset] tw:[&_.card\_\_title-section]:w-full tw:[&_.card\_\_title-section]:pt-0 tw:[&_.card\_\_title-text]:w-full tw:[&_.card\_\_subtitle]:box-content tw:[&_.card\_\_subtitle]:min-h-[48px] tw:[&_.card\_\_subtitle]:pb-app-s tw:[&_.button-surface--secondary]:bg-[var(--color-header-button)] tw:[&_.card\_\_main-actions]:flex tw:[&_.card\_\_main-actions]:h-full tw:[&_.card\_\_main-actions]:flex-col tw:[&_.card\_\_main-actions]:gap-app-m tw:[&_.card\_\_main-actions]:![border-top:unset] tw:[&_.card\_\_first-pane]:flex tw:[&_.card\_\_first-pane]:h-full tw:[&_.card\_\_first-pane]:flex-col tw:[&_.section\_\_actions]:mt-auto tw:[&_.section\_\_actions]:rounded-app tw:[&_.section\_\_actions]:bg-app-background tw:[&_.section\_\_actions]:p-app-s`,
  cardTitle: String.raw`tw:box-content tw:mt-[calc(var(--spacing-s)*-1)] tw:mr-[calc(var(--spacing-s)*-1)] tw:ml-[calc(var(--spacing-s)*-1)] tw:flex tw:min-w-full tw:items-center tw:rounded-[var(--border-radius)_var(--border-radius)_0_0] tw:bg-[var(--color-header-button)] tw:p-app-xxs tw:![filter:invert(0)] tw:[&_span]:mb-[-4px] tw:[&_svg]:box-content tw:[&_svg]:mb-0 tw:[&_svg]:rounded-app tw:[&_svg]:bg-app-background tw:[&_svg]:p-[4px] tw:[&_button]:ml-auto tw:[&_button]:h-[27px] tw:[&_button]:select-none tw:[&_button]:border tw:[&_button]:border-app-text tw:[&_button]:!bg-[unset] tw:[&_button]:px-app-xxs tw:[&_button]:py-0 tw:[&_button]:text-app-body tw:[&_button_span]:!m-0 tw:[&_button_span]:!text-app-text tw:[&_button_span_svg]:![background:none] tw:[&_button_span_svg]:pt-[2px] tw:[&_button_span_svg]:pl-0 tw:[&_button_span_svg]:!text-app-text tw:[&_button:hover]:!bg-app-text tw:[&_button:hover_span:not(.button-surface\_\_label)]:![filter:invert(1)]`,
  refresh: String.raw`refresh-balance tw:flex tw:justify-center tw:!bg-[unset] tw:[&_svg]:!bg-[unset] tw:[&_svg]:![stroke:var(--color-text)] tw:hover:cursor-pointer tw:hover:[&_svg]:![stroke:var(--color-primary)]`,
  refreshLoading: String.raw`refresh-balance--loading tw:opacity-80 tw:[animation:rotate_1s_linear_infinite] tw:hover:!cursor-default tw:hover:[&_svg]:![stroke:var(--color-text)]`,
  sectionContent: 'section-content__wrapper tw:flex tw:min-h-full tw:flex-col',
  sectionWarning:
    'section__warning tw:mt-auto tw:rounded-app tw:border-2 tw:border-app-text-error tw:bg-[rgba(255,0,0,0.2)] tw:p-app-m',
} as const;

export const ACCOUNT_PAGE_CARD_CLASS = ACCOUNT_PAGE_CLASSES.card;
export const ACCOUNT_PAGE_CARD_TITLE_CLASS = ACCOUNT_PAGE_CLASSES.cardTitle;
