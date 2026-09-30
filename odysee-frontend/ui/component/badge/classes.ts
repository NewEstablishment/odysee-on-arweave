export const BADGE_CLASSES = {
  base: String.raw`badge tw:h-[var(--height-badge)] tw:cursor-pointer tw:items-center tw:whitespace-nowrap tw:rounded-app tw:p-app-xs tw:text-app-small tw:select-none tw:[.menu\_\_link_&]:ml-app-s tw:[.card\_\_title_&]:float-right tw:[.card\_\_title_&]:mt-[8px] tw:[.card\_\_title_&]:ml-app-s`,
  alert: 'badge--alert tw:bg-[var(--color-danger-alt)] tw:text-[var(--color-danger)]',
  free: 'badge--free tw:bg-[var(--color-secondary-alt)] tw:text-[var(--color-secondary)]',
  tag: 'badge--tag tw:bg-[var(--color-button-alt-bg)] tw:text-[var(--color-tag)] tw:hover:bg-[var(--color-button-primary-bg)] tw:hover:text-[var(--color-tag-hover)]',
  tagMature: 'badge--tag-mature tw:bg-[var(--color-tertiary-alt)] tw:text-[var(--color-tertiary)]',
} as const;
