export const CHAPTERS_CARD_CLASSES = {
  root: String.raw`chapters-card tw:flex tw:w-full tw:max-w-full tw:flex-col tw:overflow-hidden tw:rounded-app tw:bg-[rgba(var(--color-header-button-base),0.4)] tw:p-px tw:min-medium:w-[32rem] tw:upto-small:mobile-tab-panel:rounded-none tw:upto-small:mobile-tab-panel:bg-transparent tw:upto-small:mobile-tab-panel:p-0`,
  title: 'tw:flex tw:w-full tw:items-center tw:justify-center tw:gap-app-xs',
  count: 'tw:rounded-app tw:bg-[rgba(var(--color-header-button-base),0.4)] tw:px-[6px] tw:py-[2px] tw:text-app-xsmall',
  list: String.raw`chapters-card__list tw:m-0 tw:max-h-[20rem] tw:list-outside tw:list-none tw:overflow-y-auto tw:rounded-b-app tw:bg-[rgba(var(--color-header-background-base),0.9)] tw:p-0 tw:upto-small:mobile-tab-panel:rounded-none`,
  item: 'tw:[transition:background-color_0.15s]',
  itemActive: 'chapters-card__item--active',
  button: String.raw`chapters-card__button tw:flex tw:w-full tw:cursor-pointer tw:items-center tw:gap-app-s tw:[border:none] tw:px-app-s tw:py-app-xxs tw:text-left tw:text-app-small tw:text-app-text`,
  timestamp: 'tw:min-w-[3.5rem] tw:shrink-0 tw:[font-family:monospace] tw:text-app-xsmall tw:text-app-primary',
  label: 'tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap',
} as const;
