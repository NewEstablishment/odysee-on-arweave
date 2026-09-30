const PLACEHOLDER_SURFACE_CLASS =
  'tw:rounded-[var(--card-radius)] tw:[border-style:none] tw:[border-width:0] tw:bg-[var(--color-placeholder-background)]';

export const WUNDERBAR_TOP_SUGGESTION_CLASSES = {
  info: `${PLACEHOLDER_SURFACE_CLASS} tw:ml-app-s tw:h-[3rem] tw:w-1/2`,
  label: String.raw`tw:mb-app-xs tw:ml-app-m tw:[[data-wunderbar-mobile-suggestions]_&]:ml-0`,
  placeholderLabel: `${PLACEHOLDER_SURFACE_CLASS} tw:mt-app-xs tw:h-[1rem] tw:w-[30%]`,
  separator: 'tw:my-app-s tw:w-full',
  suggestion: 'tw:mb-app-s tw:min-[900px]:pl-0',
  thumbnail: `${PLACEHOLDER_SURFACE_CLASS} tw:size-[3rem]`,
} as const;
