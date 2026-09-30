const paginationItemBaseClassName =
  'pagination-item-surface tw:size-[3rem] tw:list-none tw:rounded-[50%] tw:text-center tw:hover:bg-[var(--color-button-secondary-bg)] tw:upto-small:size-[2rem]';

const paginationSelectableClassName = 'tw:cursor-pointer tw:hover:!bg-app-primary tw:hover:!text-app-primary-contrast';

const paginationNumberClassName = 'tw:mx-[0.5em] tw:font-bold tw:leading-[3rem] tw:upto-small:leading-[2rem]';

export const PAGINATION_CLASSES = {
  break: `${paginationItemBaseClassName} ${paginationNumberClassName} tw:opacity-30`,
  channel: 'tw:w-[5rem] tw:rounded-tl-app tw:rounded-bl-app tw:bg-[var(--color-header-button)]',
  container: 'pagination-surface tw:!flex tw:items-center tw:upto-small:text-app-small',
  disabled: `${DISABLED_CLASS} tw:!cursor-default tw:hover:!bg-[var(--color-button-secondary-bg)] tw:hover:!text-[var(--color-button-secondary-text)]`,
  direction: `${paginationItemBaseClassName} ${paginationSelectableClassName} tw:relative tw:!mb-0 tw:bg-[var(--color-header-button)] tw:pt-app-s tw:leading-[1.5] tw:upto-small:leading-[0.6]`,
  page: `${paginationItemBaseClassName} ${paginationNumberClassName} ${paginationSelectableClassName}`,
  selected: 'pagination-item-selected-surface tw:!bg-app-primary tw:!text-app-primary-contrast',
} as const;
import { DISABLED_CLASS } from './state-classes.ts';
