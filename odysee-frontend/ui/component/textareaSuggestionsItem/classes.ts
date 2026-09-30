export const TEXTAREA_SUGGESTION_CLASSES = {
  thumbnail:
    'tw:!size-[2.1rem] tw:[&_:is(.ff-canvas,.freezeframe-img)]:size-full tw:[&_:is(.ff-canvas,.freezeframe-img)]:rounded-[50%]',
  label:
    'textarea-suggestion__label tw:[.MuiAutocomplete-option_&]:relative tw:[.MuiAutocomplete-option_&]:ml-app-m tw:[.MuiAutocomplete-option_&]:block tw:[.MuiAutocomplete-option_&]:min-w-0 tw:[.MuiAutocomplete-option_&]:whitespace-nowrap tw:[.MuiAutocomplete-option_&]:text-app-small',
  title:
    'textarea-suggestion__title tw:[.MuiAutocomplete-option_&]:overflow-hidden tw:[.MuiAutocomplete-option_&]:text-ellipsis',
  value:
    'textarea-suggestion__value tw:[.MuiAutocomplete-option_&]:mt-0 tw:[.MuiAutocomplete-option_&]:block tw:[.MuiAutocomplete-option_&]:w-full tw:[.MuiAutocomplete-option_&]:overflow-hidden tw:[.MuiAutocomplete-option_&]:text-ellipsis tw:[.MuiAutocomplete-option_&]:text-app-xsmall tw:[.MuiAutocomplete-option_&]:text-app-text tw:small:[.MuiAutocomplete-option_&]:text-app-small',
} as const;
