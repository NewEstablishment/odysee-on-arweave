export const STREAM_CLAIM_PAGE_CLASSES = {
  image: 'tw:[&_img]:cursor-pointer',
  markdown: String.raw`file-page__md tw:[.file-page_&_.media\_\_actions]:justify-center tw:[.file-page_&_.file-page\_\_secondary-content]:flex tw:[.file-page_&_.file-page\_\_secondary-content]:flex-col tw:[.file-page_&_.file-page\_\_secondary-content]:px-app-m`,
  primaryImage:
    'tw:relative tw:w-full tw:aspect-video tw:rounded-app tw:bg-[var(--color-placeholder-background)] tw:[&_[data-file-render]]:h-auto',
} as const;

export const CARD_STACK_SPACING_M_CLASS = String.raw`card-stack--spacing-m tw:[&_:is(.card,.wunderbar\_\_suggestions,.snack-bar--notification,.modal,[data-content-viewer],.MuiAutocomplete-paper,.card--after-tabs):not(:last-of-type)]:mb-app-m`;
