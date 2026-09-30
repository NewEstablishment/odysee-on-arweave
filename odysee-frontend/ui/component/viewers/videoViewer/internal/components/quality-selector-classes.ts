export const QUALITY_SELECTOR_CLASSES = {
  root: 'tw:relative tw:z-[2]',
  label: 'tw:text-[0.75rem] tw:font-semibold tw:text-white',
  menu: 'media-surface tw:absolute tw:right-0 tw:bottom-full tw:min-w-[8em] tw:rounded-app tw:bg-[rgba(28,28,28,0.9)] tw:p-app-xs tw:[box-shadow:2px_2px_10px_rgba(0,0,0,0.7)]',
  item: 'tw:my-[2px] tw:block tw:w-full tw:cursor-pointer tw:rounded-app tw:border-none tw:bg-transparent tw:bg-none tw:px-app-xs tw:py-[4px] tw:text-left tw:text-[0.8rem] tw:text-white',
  itemHover: 'tw:hover:!bg-[rgba(115,133,159,0.5)]',
  itemSelected: 'tw:!bg-app-primary tw:text-app-primary-contrast',
} as const;
