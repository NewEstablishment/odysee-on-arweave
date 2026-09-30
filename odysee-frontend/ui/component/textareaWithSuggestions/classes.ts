export const TEXTAREA_SUGGESTIONS_CLASSES = {
  group: String.raw`tw:[&:last-child_hr]:hidden tw:[&_.Mui-focused_.textarea-suggestion\_\_label_.textarea-suggestion\_\_value]:!text-[var(--color-primary-contrast)] tw:[&_.emoji]:mb-[3px] tw:[&_.emoji]:text-app-large`,
  groupLabel: String.raw`tw:mb-app-xs tw:ml-app-m tw:text-app-body tw:[[data-wunderbar-mobile-suggestions]_&]:ml-0`,
  separator: 'tw:my-app-s tw:w-full',
} as const;
