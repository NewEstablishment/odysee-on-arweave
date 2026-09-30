export const CHAPTER_CLASSES = {
  marker:
    'tw:absolute tw:inset-y-0 tw:w-[2px] tw:cursor-pointer tw:bg-[rgba(0,0,0,0.6)] tw:[transform:translateX(-50%)]',
  markers: 'tw:pointer-events-none tw:absolute tw:inset-0 tw:z-[3] tw:cursor-pointer',
  pill: 'tw:rounded-[9999px] tw:p-[0.175rem]',
  pillButton:
    'tw:!h-[2.125rem] tw:!w-auto tw:!max-w-[10rem] tw:!rounded-[9999px] tw:!px-[0.5rem] tw:!py-0 tw:![aspect-ratio:unset]',
  pillLabel: 'tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-[0.75rem]',
} as const;
