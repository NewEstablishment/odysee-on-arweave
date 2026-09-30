export const FILE_DESCRIPTION_CLASSES = {
  surface:
    'file-description-surface tw:mt-app-m tw:max-h-none tw:text-app-small tw:fullscreen-side-panel:mt-0 tw:upto-small:mt-0',
  contracted: String.raw`tw:max-w-[50rem] tw:overflow-hidden tw:[overflow-wrap:anywhere] tw:[&>.mediaInfo\_\_description]:max-h-[5rem] tw:[-webkit-mask-image:-webkit-gradient(linear,left_55%,left_bottom,from(rgb(0,0,0)),to(rgba(0,0,0,0)))] tw:[mask-image:-webkit-gradient(linear,left_55%,left_bottom,from(rgb(0,0,0)),to(rgba(0,0,0,0)))]`,
  expanded: 'tw:w-full tw:max-w-none',
  content: String.raw`mediaInfo__description tw:[word-break:break-word] tw:upto-small:mt-app-s tw:[&_[data-claim-tags]_.tag]:bg-[rgba(var(--color-header-button-base),1)] tw:[&_[data-claim-tags]_.tag:hover]:bg-app-primary`,
} as const;
