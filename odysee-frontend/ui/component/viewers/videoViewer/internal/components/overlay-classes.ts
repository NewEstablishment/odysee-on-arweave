export const OVERLAY_CLASSES = {
  root: 'tw:pointer-events-none tw:absolute tw:top-1/2 tw:left-1/2 tw:z-10 tw:animate-[overlay-fade_0.8s_ease-out_forwards] tw:[transform:translate(-50%,-50%)]',
  content:
    'tw:rounded-[var(--border-radius)] tw:[background:rgba(0,0,0,0.7)] tw:px-4 tw:py-2 tw:text-[1.2rem] tw:font-bold tw:text-white',
} as const;
