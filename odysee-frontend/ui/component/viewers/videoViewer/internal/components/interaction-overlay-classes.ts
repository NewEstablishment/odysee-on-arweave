export const CLICK_TO_PLAY_CLASS = 'tw:absolute tw:inset-0 tw:z-0 tw:cursor-pointer';

export const CLICK_TO_PLAY_FLOATING_CLASS = 'tw:upto-small:!hidden';

export const SEEK_INDICATOR_CLASSES = {
  bubble:
    'tw:mt-[-4px] tw:flex tw:flex-col tw:items-center tw:gap-0 tw:animate-[seek-indicator-fade_0.8s_ease-out_forwards] tw:[filter:drop-shadow(0_1px_4px_rgba(0,0,0,0.7))]',
  label: 'tw:mt-[-6px] tw:text-[1rem] tw:font-bold tw:text-white tw:[text-shadow:0_1px_4px_rgba(0,0,0,0.6)]',
  root: 'tw:pointer-events-none tw:absolute tw:inset-0 tw:z-[10] tw:flex',
  side: 'tw:flex tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:first:pr-[25%] tw:last:pl-[25%]',
} as const;
