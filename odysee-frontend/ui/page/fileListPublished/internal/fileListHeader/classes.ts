import { CLAIM_SEARCH_DROPDOWN_CLASS } from '../../../../component/claimListHeader/classes.ts';

export const FILE_LIST_HEADER_CLASSES = {
  enableFilters: String.raw`tw:ml-app-xxs tw:flex tw:h-[var(--height-input)] tw:items-center tw:justify-center tw:rounded-app tw:bg-[var(--color-header-button)] tw:px-app-s tw:py-0 tw:[&_:is(label,.confirm\_\_label)]:mb-[-4px] tw:[&_:is(label,.confirm\_\_label)]:pl-[calc(var(--height-checkbox)+var(--spacing-s))] tw:[&_:is(label,.confirm\_\_label)]:[font-size:var(--font-base)] tw:[&_:is(label,.confirm\_\_label)]:font-bold tw:[&_:is(label,.confirm\_\_label)::before]:mt-[-2px] tw:[&_:is(label,.confirm\_\_label)::before]:bg-app-background tw:[&_:is(label,.confirm\_\_label)::after]:mt-[-2px] tw:[&_:is(label,.confirm\_\_label)::after]:[background:none] tw:upto-small:[&_:is(label,.confirm\_\_label)]:mb-[-8px] tw:upto-small:[&_:is(label,.confirm\_\_label)]:text-app-xxsmall`,
  uploadTypeFilter: 'tw:upto-small:text-app-xxsmall',
  uploadsDropdown: `${CLAIM_SEARCH_DROPDOWN_CLASS} tw:mr-app-xs`,
} as const;
