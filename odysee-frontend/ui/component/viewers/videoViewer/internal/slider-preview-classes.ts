const THUMBNAIL = String.raw`tw:overflow-hidden tw:rounded-[var(--border-radius)] tw:[border:1px_solid_white] tw:bg-black tw:[zoom:1.3] tw:[&_img]:!max-h-none tw:[&_img]:![object-fit:none] tw:[&:empty]:hidden tw:[&:has(img:not([src]))]:hidden tw:[&:has(img[src=''])]:hidden`;

export const SLIDER_PREVIEW_CLASSES = {
  root: String.raw`tw:pointer-events-none tw:!bottom-full tw:mb-2 tw:flex tw:flex-col tw:items-center tw:gap-1 tw:!opacity-0 tw:[transition:opacity_0.15s_ease] tw:[.odysee-progress-bar:hover_&]:!opacity-100 tw:[.odysee-time-slider[data-pointing]_&]:!opacity-100 tw:upto-small:[[data-floating-player]_&]:!hidden`,
  thumbnailFrame: String.raw`tw:flex tw:aspect-[16/9] tw:min-h-fit tw:min-w-fit tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-[var(--border-radius)] tw:[border:1px_solid_white] tw:bg-black tw:[&:has(>_:empty)]:hidden tw:[&:has(>_*_img:not([src]))]:hidden tw:[&:has(>_*_img[src=''])]:hidden`,
  thumbnail: THUMBNAIL,
  thumbnailInFrame: `${THUMBNAIL} tw:rounded-none tw:[border:none] tw:bg-transparent`,
  chapter:
    'tw:max-w-48 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:rounded-[var(--border-radius)] tw:[background:rgba(0,0,0,0.8)] tw:px-[6px] tw:py-[2px] tw:text-[0.7rem] tw:text-white',
  time: 'tw:rounded-[var(--border-radius)] tw:[background:rgba(0,0,0,0.8)] tw:px-[6px] tw:py-[2px] tw:text-[0.75rem] tw:font-semibold tw:text-white',
} as const;
