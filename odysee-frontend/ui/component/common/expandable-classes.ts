export const EXPANDABLE_CLASSES = {
  root: 'tw:relative tw:max-h-[220px] tw:overflow-y-hidden',
  closedFade: String.raw`tw:[-webkit-mask-image:-webkit-gradient(linear,left_90%,left_bottom,from(rgb(0,0,0)),to(rgba(0,0,0,0)))] tw:[&_.img\_\_zoomable]:h-[200px]`,
  open: 'tw:mb-app-s tw:max-h-full',
} as const;
