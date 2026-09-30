export const SEARCH_OPTIONS_CLASSES = {
  chip: String.raw`tw:inline-flex tw:min-h-[1.85rem] tw:items-center tw:whitespace-nowrap tw:rounded-[999px] tw:bg-[var(--color-button-toggle-bg)] tw:px-app-s tw:py-0 tw:text-app-xsmall tw:text-app-text tw:upto-small:[.searchPage-wrapper_&]:flex-[0_0_auto]`,
  closeButton: 'tw:[position:unset] tw:self-center tw:ml-app-s',
  closeButtonVisible: 'tw:visible',
  filterValues: 'tw:flex tw:items-start tw:[&_.button-toggle-surface]:mr-0 tw:small:[&_select]:min-w-[200px]',
  helpIcon: 'tw:mt-[4px]',
  legend: 'tw:p-app-xxs tw:text-app-small tw:[font-weight:var(--font-weight-bold)]',
  mediaTypes: String.raw`tw:mt-app-m tw:flex tw:flex-col tw:[&_:is(label,.confirm\_\_label)]:!flex tw:[&_:is(label,.confirm\_\_label)]:items-center tw:[&_:is(.radio,.checkbox)]:mt-0 tw:[&_:is(.radio,.checkbox)]:inline-block tw:[&_:is(.radio,.checkbox):not(:first-of-type)]:mt-app-s tw:small:flex-row tw:small:[&_:is(.radio,.checkbox):not(:first-of-type)]:mt-0 tw:small:[&_:is(.radio,.checkbox):not(:first-of-type)]:ml-app-m`,
  options:
    'tw:mt-app-s tw:[&_fieldset:not(:first-child)]:mt-app-m tw:[&_table]:table-fixed tw:[&_table]:leading-[1.5] tw:[&_td]:align-middle tw:[&_td:nth-of-type(1)]:w-1/4',
  optionsCollapsed: 'tw:hidden',
  optionsExpanded: 'tw:block',
  summary:
    'tw:mt-app-s tw:flex tw:flex-wrap tw:items-center tw:gap-app-xs tw:upto-small:[.searchPage-wrapper_&]:flex-nowrap tw:upto-small:[.searchPage-wrapper_&]:overflow-x-auto tw:upto-small:[.searchPage-wrapper_&]:pb-app-xxs tw:upto-small:[.searchPage-wrapper_&]:[-webkit-overflow-scrolling:touch]',
  summaryLabel:
    'tw:text-app-small tw:text-app-primary tw:[font-weight:var(--font-weight-bold)] tw:upto-small:[.searchPage-wrapper_&]:flex-[0_0_auto]',
  toggle: 'tw:min-w-[8.5rem]',
  toolbar: 'tw:flex tw:flex-wrap tw:items-center tw:gap-app-s',
} as const;
