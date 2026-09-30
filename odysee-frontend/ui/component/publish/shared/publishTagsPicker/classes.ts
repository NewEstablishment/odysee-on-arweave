export const PUBLISH_TAGS_PICKER_CLASSES = {
  root: String.raw`tw:grid tw:grid-cols-2 tw:gap-app-m tw:[&_input[type='text']]:!bg-[rgba(var(--color-text-base),0.06)] tw:[&_.tag]:!bg-[rgba(var(--color-text-base),0.06)] tw:upto-small:gap-app-s`,
  panel:
    'tw:flex tw:h-[250px] tw:flex-col tw:gap-app-s tw:overflow-y-auto tw:rounded-app tw:border tw:border-app-border tw:bg-app-card tw:p-app-s',
} as const;
