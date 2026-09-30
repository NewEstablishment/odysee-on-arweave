const SETTINGS_CONTROL_RESET =
  'tw:box-border tw:!h-auto tw:min-h-0 tw:min-w-0 tw:max-w-full tw:m-0 tw:appearance-none tw:leading-[1.2] tw:tracking-[0] tw:normal-case tw:whitespace-nowrap';

export const MEDIA_SETTINGS_MENU_CLASSES = {
  popover: String.raw`media-popover--settings tw:box-border tw:min-w-[17em] tw:max-w-[calc(100vw-16px)] tw:max-h-[min(360px,calc(100vh-24px))] tw:overflow-x-hidden tw:overflow-y-auto tw:rounded-[var(--border-radius)] tw:!bg-[rgba(28,28,28,0.9)] tw:p-[6px] tw:![box-shadow:2px_2px_10px_rgba(0,0,0,0.7)] tw:[transition:opacity_0.3s_ease] tw:[translate:calc(-6px_-_var(--spacing-xs))_0] tw:[--media-popover-side-offset:2rem] tw:[.odysee-skin:has(.media-controls:not(.odysee-mobile-controls):not([data-visible])):not(:has(.media-button--settings-open))_&]:pointer-events-none tw:[.odysee-skin:has(.media-controls:not(.odysee-mobile-controls):not([data-visible])):not(:has(.media-button--settings-open))_&]:opacity-0 tw:[.odysee-skin:has(.media-controls:not(.odysee-mobile-controls):not([data-visible])):not(:has(.media-button--settings-open))_&]:delay-500 tw:[.odysee-skin:has(.media-controls[data-mobile-hidden])_&]:pointer-events-none tw:[.odysee-skin:has(.media-controls[data-mobile-hidden])_&]:opacity-0 tw:[.odysee-skin:has(.media-controls[data-mobile-hidden])_&]:delay-0`,
  menu: 'tw:w-full tw:min-w-0 tw:animate-[settings-fade-in_0.15s_ease-out]',
  item: `${SETTINGS_CONTROL_RESET} tw:!flex tw:!flex-row tw:!items-center tw:!justify-start tw:w-full tw:gap-[10px] tw:![border:none] tw:rounded-[var(--border-radius)] tw:px-[8px] tw:py-[11px] tw:text-[0.85rem] tw:text-white tw:cursor-pointer tw:hover:bg-[rgba(115,133,159,0.3)] tw:disabled:pointer-events-none tw:disabled:cursor-default tw:disabled:opacity-[0.45]`,
  itemDisabled: 'tw:pointer-events-none tw:opacity-40',
  icon: 'tw:block tw:size-[16px] tw:min-w-[16px] tw:flex-[0_0_16px] tw:m-0 tw:shrink-0 tw:opacity-80',
  label:
    'tw:block tw:min-w-0 tw:flex-[1_1_auto] tw:m-0 tw:overflow-hidden tw:text-left tw:text-ellipsis tw:whitespace-nowrap',
  value: 'tw:block tw:flex-[0_0_auto] tw:ml-[8px] tw:whitespace-nowrap tw:text-[0.8rem] tw:font-semibold tw:opacity-70',
  back: `${SETTINGS_CONTROL_RESET} tw:!flex tw:!flex-row tw:!items-center tw:!justify-start tw:w-full tw:gap-[6px] tw:![border-top:none] tw:![border-right:none] tw:![border-bottom:1px_solid_rgba(255,255,255,0.1)] tw:![border-left:none] tw:px-[12px] tw:py-[10px] tw:text-left tw:text-[0.85rem] tw:font-semibold tw:text-white tw:cursor-pointer tw:hover:bg-[rgba(115,133,159,0.3)]`,
  backIcon: 'tw:block tw:size-[16px] tw:min-w-[16px] tw:flex-[0_0_16px] tw:m-0 tw:shrink-0',
  option: `${SETTINGS_CONTROL_RESET} tw:!block tw:w-full tw:![border:none] tw:rounded-[var(--border-radius)] tw:px-[12px] tw:py-[9px] tw:text-left tw:text-[0.85rem] tw:text-white tw:cursor-pointer tw:disabled:pointer-events-none tw:disabled:cursor-default tw:disabled:opacity-[0.45]`,
  optionHover: 'tw:hover:bg-[rgba(115,133,159,0.3)]',
  optionSelected: 'tw:!bg-[var(--color-primary)] tw:!text-[var(--color-primary-contrast)]',
  toggle:
    'tw:relative tw:!ml-auto tw:!inline-block tw:!h-[16px] tw:!min-h-[16px] tw:!w-[28px] tw:!min-w-[28px] tw:!flex-[0_0_28px] tw:!rounded-[8px] tw:!bg-[rgba(255,255,255,0.25)] tw:!p-0 tw:align-middle tw:[transition:background-color_0.2s_ease]',
  toggleOn: 'tw:!bg-[var(--color-primary)]',
  toggleKnob:
    'tw:absolute tw:top-[2px] tw:left-[2px] tw:!m-0 tw:!block tw:!size-[12px] tw:!min-h-[12px] tw:!min-w-[12px] tw:![border-radius:50%] tw:!bg-white tw:!p-0 tw:[transition:transform_0.2s_ease]',
  toggleKnobOn: 'tw:[transform:translateX(12px)]',
  popoverEmbed:
    'tw:min-w-[min(15rem,calc(100vw-16px))] tw:w-[min(15rem,calc(100vw-16px))] tw:!max-h-[min(320px,calc(100vh-24px))]',
  popoverExternalEmbed:
    'tw:min-w-[min(13rem,calc(100vw-16px))] tw:w-[min(13rem,calc(100vw-16px))] tw:!max-h-[min(240px,calc(100vh-24px))]',
} as const;
