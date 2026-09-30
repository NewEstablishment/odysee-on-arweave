export const EMPTY_CLASS = String.raw`empty tw:m-0 tw:text-[var(--color-text-empty)] tw:italic tw:[display:unset] tw:[&_.empty\_\_wrap]:[display:unset] tw:[&_.empty\_\_wrap_.empty\_\_content]:w-full tw:[&_.empty\_\_wrap_.empty\_\_content]:max-w-[unset] tw:[&_.empty\_\_wrap_.empty\_\_content]:rounded-app tw:[&_.empty\_\_wrap_.empty\_\_content]:border-2 tw:[&_.empty\_\_wrap_.empty\_\_content]:border-app-border tw:[&_.empty\_\_wrap_.empty\_\_content]:bg-[var(--color-input-bg)] tw:[&_.empty\_\_wrap_.empty\_\_content]:p-app-xxxs`;

export const EMPTY_CLASSES = {
  content: 'empty__content tw:max-w-[400px] tw:[.empty_&]:max-w-[unset]',
  padded: 'tw:px-0 tw:py-app-xl',
  wrap: String.raw`empty__wrap tw:flex tw:flex-col tw:flex-wrap tw:items-center tw:justify-center tw:text-left tw:[.empty_&]:[display:unset] tw:small:flex-row`,
} as const;

export const EMPTY_CENTERED_TIGHT_CLASS = `${EMPTY_CLASS} empty--centered-tight tw:px-0 tw:py-app-l tw:text-center`;

export const EMPTY_CENTERED_CLASS = `${EMPTY_CLASS} empty--centered tw:px-0 tw:py-[calc(var(--spacing-l)*3)] tw:text-center`;
