export const CAST_CLASSES = {
  indicator:
    'tw:absolute tw:top-1/2 tw:left-1/2 tw:z-[5] tw:flex tw:-translate-x-1/2 tw:-translate-y-1/2 tw:flex-col tw:items-center tw:gap-[6px] tw:whitespace-nowrap tw:rounded-[8px] tw:bg-[rgba(0,0,0,0.7)] tw:px-[24px] tw:py-[12px] tw:text-[16px] tw:text-white',
  indicatorDevice: 'tw:text-[22px] tw:font-semibold',
  indicatorLabel: 'tw:flex tw:items-center tw:gap-[8px]',
  indicatorMobile:
    'tw:!top-[8px] tw:![translate:none] tw:![transform:translateX(-50%)] tw:!flex-row tw:!gap-[6px] tw:!px-[12px] tw:!py-[6px] tw:!text-[13px] tw:pointer-events-none',
  indicatorStop:
    'tw:mt-[4px] tw:cursor-pointer tw:rounded-[4px] tw:border-none tw:bg-[rgba(255,255,255,0.15)] tw:px-[16px] tw:py-[6px] tw:text-[14px] tw:text-white tw:hover:bg-[rgba(255,255,255,0.3)]',
  slider: 'tw:relative tw:touch-none tw:py-[8px]',
  sliderFill: 'tw:transition-[width] tw:duration-1000 tw:ease-linear',
  sliderHoverFill:
    'tw:pointer-events-none tw:absolute tw:top-0 tw:left-0 tw:h-full tw:rounded-[4px] tw:bg-[rgba(255,255,255,0.2)]',
  sliderThumb:
    'tw:!top-1/2 tw:!-translate-x-1/2 tw:!-translate-y-1/2 tw:transition-[left] tw:duration-1000 tw:ease-linear',
  sliderTrack: 'tw:flex-[1_1_auto]',
  spinner:
    'tw:size-[18px] tw:animate-[odysee-cast-spin_0.6s_linear_infinite] tw:rounded-[50%] tw:border-2 tw:border-solid tw:border-[rgba(255,255,255,0.3)] tw:border-t-white',
  spinnerMobile: 'tw:!size-[36px] tw:!border-[3px]',
  thumbnail: 'tw:pointer-events-none tw:absolute tw:inset-0 tw:z-[1] tw:!size-full tw:object-contain tw:!opacity-100',
} as const;
