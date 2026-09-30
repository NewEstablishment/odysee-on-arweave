export const LIVESTREAM_SOURCE_SETTINGS_CLASSES = {
  root: 'tw:flex tw:flex-1 tw:flex-col tw:gap-app-s',
  box: 'tw:w-full tw:rounded-app tw:bg-[var(--color-header-button)] tw:p-app-s',
  title:
    'tw:mt-0 tw:mr-0 tw:mb-app-xs tw:ml-0 tw:flex tw:items-center tw:gap-app-xs tw:text-app-small tw:font-semibold tw:text-app-text',
  row: 'tw:m-0 tw:flex tw:flex-col tw:gap-[2px] tw:px-0 tw:py-app-xxs',
  rowInline: 'tw:flex-row tw:items-center tw:justify-between tw:gap-app-s',
  toggle:
    'tw:relative tw:h-[20px] tw:w-[36px] tw:shrink-0 tw:cursor-pointer tw:rounded-[10px] tw:![border:none] tw:bg-[rgba(var(--color-header-button-base),0.6)] tw:p-0 tw:[transition:background-color_0.15s_ease]',
  toggleOn: 'tw:!bg-app-primary',
  toggleChat: 'tw:opacity-100',
  toggleChatOff: 'tw:!bg-[rgba(var(--color-text-base),0.25)]',
  toggleKnob:
    'tw:absolute tw:top-[2px] tw:left-[2px] tw:size-[16px] tw:rounded-[50%] tw:bg-white tw:[transition:transform_0.15s_ease]',
  toggleKnobOn: 'tw:[transform:translateX(16px)]',
  colorWrap: 'tw:relative tw:inline-flex tw:items-center',
  color:
    'tw:h-[20px] tw:w-[36px] tw:shrink-0 tw:cursor-pointer tw:rounded-[4px] tw:border tw:border-[rgba(var(--color-text-base),0.2)] tw:p-0',
  colorPopover: 'tw:absolute tw:top-[calc(100%+6px)] tw:right-0 tw:z-10',
  miniPicker:
    'tw:flex tw:w-[220px] tw:flex-col tw:gap-app-s tw:rounded-[6px] tw:border tw:border-[rgba(var(--color-text-base),0.15)] tw:bg-app-card tw:p-app-s tw:select-none tw:[box-shadow:0_6px_24px_rgba(0,0,0,0.4)]',
  miniPickerSaturation: 'tw:relative tw:h-[140px] tw:w-full tw:overflow-hidden tw:rounded-[4px]',
  miniPickerHue: 'tw:relative tw:h-[12px] tw:w-full tw:overflow-hidden tw:rounded-[6px]',
  miniPickerHex:
    'tw:flex tw:items-center tw:gap-[4px] tw:rounded-[4px] tw:border tw:border-[rgba(var(--color-text-base),0.15)] tw:bg-[rgba(var(--color-text-base),0.08)] tw:px-app-xs tw:py-[4px] tw:[&_input]:!w-full tw:[&_input]:![border:none] tw:[&_input]:!bg-transparent tw:[&_input]:![box-shadow:none] tw:[&_input]:!text-app-text tw:[&_input]:!outline-none tw:[&_input]:![font-family:monospace] tw:[&_input]:uppercase',
  miniPickerHexPrefix: 'tw:[font-family:monospace] tw:text-app-text-subtitle',
  miniPickerAlpha: 'tw:mt-app-xs tw:flex tw:items-center tw:gap-app-xs',
  miniPickerAlphaSlider: 'tw:[flex:1_1_auto]',
  miniPickerAlphaLabel: 'tw:text-app-xsmall tw:text-app-text-subtitle',
  miniPickerAlphaValue: 'tw:min-w-[32px] tw:text-right tw:text-app-xsmall tw:text-app-text-subtitle',
  rowHeader: 'tw:flex tw:items-center tw:justify-between',
  label: 'tw:text-app-xsmall tw:text-app-text-subtitle',
  slider:
    'tw:m-0 tw:!h-[4px] tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:appearance-none tw:rounded-[2px] tw:!bg-app-background tw:p-0 tw:outline-none tw:[&::-webkit-slider-runnable-track]:h-[4px] tw:[&::-webkit-slider-runnable-track]:rounded-[2px] tw:[&::-webkit-slider-runnable-track]:bg-[rgba(var(--color-text-base),0.15)] tw:[&::-moz-range-track]:h-[4px] tw:[&::-moz-range-track]:rounded-[2px] tw:[&::-moz-range-track]:![border:none] tw:[&::-moz-range-track]:bg-[rgba(var(--color-text-base),0.15)] tw:[&::-webkit-slider-thumb]:mt-[-4px] tw:[&::-webkit-slider-thumb]:size-[12px] tw:[&::-webkit-slider-thumb]:cursor-pointer tw:[&::-webkit-slider-thumb]:appearance-none tw:[&::-webkit-slider-thumb]:rounded-[50%] tw:[&::-webkit-slider-thumb]:bg-app-primary tw:[&::-moz-range-thumb]:size-[12px] tw:[&::-moz-range-thumb]:cursor-pointer tw:[&::-moz-range-thumb]:rounded-[50%] tw:[&::-moz-range-thumb]:![border:none] tw:[&::-moz-range-thumb]:bg-app-primary',
  value: 'tw:min-w-[36px] tw:text-right tw:text-app-xsmall tw:text-app-text tw:tabular-nums',
} as const;
