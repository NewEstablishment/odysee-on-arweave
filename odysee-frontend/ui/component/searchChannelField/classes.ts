export const SEARCH_CHANNEL_FIELD_CLASSES = {
  popup: 'tw:relative tw:inline-block tw:w-full',
  results: String.raw`tw:absolute tw:inset-x-0 tw:top-full tw:z-[99] tw:bg-[rgba(var(--color-header-background-base),0.9)] tw:text-[var(--color-text)] tw:[&_.claim-preview\_\_title]:text-[var(--color-text)] tw:[&_.placeholder_.claim-preview\_\_title\_b]:text-[var(--color-text)] tw:[.placeholder_&_.claim-preview\_\_title\_b]:text-[var(--color-text)] tw:[&_:is(.button--uri-indicator,[data-comment-time],.comment\_\_action,.media\_\_subtitle,.media\_\_subtitle--centered,.media\_\_subtitle--between)]:text-[rgba(var(--color-text-base),0.6)] tw:[&_.icon--help]:align-middle`,
  root: String.raw`tw:[&_fieldset-section]:mt-0 tw:[&_.fieldset-section]:mt-0`,
} as const;
