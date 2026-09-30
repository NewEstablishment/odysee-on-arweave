export const LIVE_BUTTON_CLASSES = {
  atEdge: 'tw:text-[var(--color-live,#e73838)] tw:[&>span]:bg-[var(--color-live,#e73838)]',
  dot: 'tw:size-[8px] tw:rounded-[50%] tw:bg-[rgba(255,255,255,0.5)] tw:[transition:background-color_0.3s_ease]',
  root: 'tw:flex tw:h-[34px] tw:cursor-pointer tw:items-center tw:gap-[5px] tw:rounded-[9999px] tw:border-none tw:bg-transparent tw:bg-none tw:px-[8px] tw:py-0 tw:text-[0.75rem] tw:font-bold tw:tracking-[0.05em] tw:text-[rgba(255,255,255,0.7)] tw:[transition:background-color_0.2s_ease,color_0.2s_ease] tw:hover:bg-[var(--player-hover-bg)]',
} as const;
