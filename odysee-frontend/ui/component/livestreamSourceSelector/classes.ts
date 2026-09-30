export const LIVESTREAM_SOURCE_SELECTOR_CLASSES = {
  root: 'tw:flex tw:min-w-0 tw:[flex:1_1_0] tw:flex-col tw:gap-app-s',
  box: 'tw:w-full tw:rounded-app tw:bg-[var(--color-header-button)] tw:p-[2px]',
  title:
    'tw:m-0 tw:flex tw:items-center tw:gap-app-xs tw:px-app-s tw:pt-app-xs tw:pb-[4px] tw:text-app-small tw:font-semibold tw:text-app-text',
  subbox: 'tw:mb-[2px] tw:rounded-[calc(var(--border-radius)/2)] tw:bg-app-background tw:p-[2px] tw:last:mb-0',
  subboxLabel:
    'tw:mb-app-xxs tw:block tw:px-app-xs tw:pt-app-s tw:pb-0 tw:text-app-xxsmall tw:font-semibold tw:tracking-[0.04em] tw:text-app-text-subtitle tw:uppercase',
  list: 'tw:flex tw:flex-col tw:gap-[2px]',
  item: 'tw:flex tw:cursor-pointer tw:items-center tw:gap-app-xs tw:rounded-[calc(var(--border-radius)/2)] tw:border-none tw:bg-none tw:px-app-xs tw:py-app-xxs tw:text-left tw:text-app-xsmall tw:text-app-text-subtitle tw:hover:[&:not(:disabled)]:bg-[rgba(var(--color-header-button-base),0.5)] tw:hover:[&:not(:disabled)]:text-app-text tw:disabled:cursor-default tw:disabled:opacity-50',
  itemActive: 'tw:!text-app-text',
  itemAudio: 'tw:!flex-col tw:!items-stretch tw:!gap-[4px]',
  checkbox:
    'tw:relative tw:inline-block tw:size-[14px] tw:shrink-0 tw:rounded-[3px] tw:border-2 tw:border-app-text-subtitle',
  checkboxChecked:
    "tw:!border-app-primary tw:!bg-app-primary tw:after:absolute tw:after:top-[-2px] tw:after:left-[1px] tw:after:text-[10px] tw:after:font-bold tw:after:text-white tw:after:content-['✓']",
  itemLabel: 'tw:flex tw:min-w-0 tw:[flex:1_1_0] tw:whitespace-nowrap',
  itemLabelBase: 'tw:min-w-0 tw:[flex:1_1_0] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap',
  itemLabelSuffix: 'tw:shrink-0 tw:whitespace-pre',
  itemToggle:
    'tw:flex tw:min-w-0 tw:w-full tw:cursor-pointer tw:items-center tw:gap-app-xs tw:![border:none] tw:bg-none tw:p-0 tw:text-left tw:text-[inherit] tw:text-inherit tw:disabled:cursor-default tw:disabled:opacity-50',
  itemToggleStatic: 'tw:!cursor-default',
  itemMaster:
    'tw:mb-app-xs tw:[border-bottom:1px_solid_rgba(255,255,255,0.08)] tw:pb-app-xs tw:font-semibold tw:!text-app-text',
  volumeValue:
    'tw:ml-auto tw:min-w-[32px] tw:text-right tw:text-[11px] tw:font-normal tw:text-app-text-subtitle tw:tabular-nums',
  volumeSlider:
    'tw:m-0 tw:h-[16px] tw:w-full tw:cursor-pointer tw:appearance-none tw:bg-transparent tw:p-0 tw:hover:[box-shadow:none] tw:[&::-webkit-slider-runnable-track]:h-[6px] tw:[&::-webkit-slider-runnable-track]:rounded-[3px] tw:[&::-webkit-slider-runnable-track]:bg-[rgba(255,255,255,0.18)] tw:[&::-webkit-slider-runnable-track]:[background-position:0px_0px] tw:[&::-moz-range-track]:h-[6px] tw:[&::-moz-range-track]:rounded-[3px] tw:[&::-moz-range-track]:![border:none] tw:[&::-moz-range-track]:bg-[rgba(255,255,255,0.18)] tw:[&::-webkit-slider-thumb]:mt-[-5px] tw:[&::-webkit-slider-thumb]:size-[16px] tw:[&::-webkit-slider-thumb]:cursor-pointer tw:[&::-webkit-slider-thumb]:appearance-none tw:[&::-webkit-slider-thumb]:rounded-[50%] tw:[&::-webkit-slider-thumb]:border tw:[&::-webkit-slider-thumb]:border-[rgba(0,0,0,0.4)] tw:[&::-webkit-slider-thumb]:bg-white tw:[&::-webkit-slider-thumb]:[background-position:0px_0px] tw:[&::-webkit-slider-thumb]:[box-shadow:0_1px_4px_rgba(0,0,0,0.5)] tw:[&::-moz-range-thumb]:size-[16px] tw:[&::-moz-range-thumb]:cursor-pointer tw:[&::-moz-range-thumb]:rounded-[50%] tw:[&::-moz-range-thumb]:border tw:[&::-moz-range-thumb]:border-[rgba(0,0,0,0.4)] tw:[&::-moz-range-thumb]:bg-white tw:[&::-moz-range-thumb]:[box-shadow:0_1px_4px_rgba(0,0,0,0.5)]',
  meter: 'tw:relative tw:h-[6px] tw:w-full tw:overflow-hidden tw:rounded-[3px] tw:bg-[rgba(255,255,255,0.08)]',
  meterFill:
    'tw:pointer-events-none tw:absolute tw:inset-0 tw:rounded-[3px] tw:[clip-path:inset(0_100%_0_0)] tw:bg-[linear-gradient(to_right,#2dd06e_0%,#2dd06e_70%,#f0c33c_85%,#e74c3c_100%)] tw:[transition:clip-path_60ms_linear]',
  meterPeak: 'tw:pointer-events-none tw:absolute tw:top-0 tw:bottom-0 tw:ml-[-1px] tw:w-[2px] tw:bg-white',
  activeRow: 'tw:flex tw:items-center tw:gap-[2px]',
  activeRowItem: 'tw:min-w-0 tw:flex-1',
  reorderButtons: 'tw:flex tw:shrink-0',
  permissionButton:
    'tw:block tw:w-full tw:cursor-pointer tw:rounded-app tw:![border:none] tw:bg-[var(--color-text-error,#d33)] tw:p-app-s tw:text-app-xsmall tw:font-semibold tw:text-white tw:disabled:cursor-default tw:disabled:opacity-60',
  visibilityButton:
    'tw:ml-auto tw:flex tw:size-[22px] tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:![border:none] tw:bg-none tw:p-0 tw:text-app-text-subtitle tw:hover:text-app-text',
  muteButton:
    'tw:ml-app-xs tw:inline-flex tw:size-[22px] tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:text-app-text-subtitle tw:hover:text-app-text',
  reorderButton:
    'tw:flex tw:h-[14px] tw:w-[16px] tw:cursor-pointer tw:items-center tw:justify-center tw:![border:none] tw:bg-none tw:p-0 tw:text-app-text-subtitle tw:hover:[&:not(:disabled)]:text-app-text tw:disabled:cursor-default tw:disabled:opacity-20',
  addIcon:
    'tw:w-[14px] tw:shrink-0 tw:text-center tw:text-[16px] tw:leading-none tw:font-semibold tw:text-app-text-subtitle',
  removeIcon:
    'tw:w-[14px] tw:shrink-0 tw:cursor-pointer tw:text-center tw:text-[16px] tw:leading-none tw:font-semibold tw:text-app-text-subtitle tw:hover:text-app-text-error',
  empty: 'tw:px-app-xs tw:py-app-xxs tw:text-app-xsmall tw:text-app-text-subtitle',
  player: 'tw:flex tw:flex-col tw:gap-[2px]',
  playerRow: 'tw:flex tw:items-center tw:justify-between tw:gap-app-xs',
  playerButtons: 'tw:flex tw:items-center tw:gap-[4px]',
  playerButton:
    'tw:inline-flex tw:size-[22px] tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[50%] tw:![border:none] tw:bg-[rgba(255,255,255,0.06)] tw:p-0 tw:text-[11px] tw:text-app-text-subtitle tw:hover:bg-[rgba(255,255,255,0.12)] tw:hover:text-app-text',
  playerButtonActive: 'tw:!bg-app-primary tw:!text-white',
  playerTime: 'tw:text-[10px] tw:text-app-text-subtitle tw:tabular-nums',
  seek: 'tw:group/seek tw:relative tw:flex tw:h-[14px] tw:w-full tw:touch-none tw:cursor-pointer tw:items-center tw:text-[14px]',
  seekTrack:
    'tw:relative tw:h-[0.3em] tw:w-full tw:overflow-hidden tw:rounded-[4px] tw:bg-[rgba(80,80,80,0.7)] tw:[transition:transform_0.15s_ease] tw:group-hover/seek:[transform:scaleY(1.6)]',
  seekFill: 'tw:pointer-events-none tw:h-full tw:rounded-[4px] tw:bg-[image:var(--color-odysee-gradient)]',
  seekThumb:
    'tw:pointer-events-none tw:absolute tw:top-1/2 tw:mt-[-0.425em] tw:ml-[-0.425em] tw:size-[0.85em] tw:rounded-[50%] tw:bg-[#f77937] tw:opacity-0 tw:[transition:opacity_150ms_ease-out] tw:group-hover/seek:opacity-100 tw:group-active/seek:opacity-100',
} as const;
