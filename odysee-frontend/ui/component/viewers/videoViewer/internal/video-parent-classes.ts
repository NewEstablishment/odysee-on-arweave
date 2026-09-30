export const VIDEO_PARENT_CLASSES = {
  root: String.raw`video-js-parent tw:relative tw:size-full tw:overflow-hidden tw:bg-black tw:[&:has(.media-button--settings-open)]:overflow-visible tw:[.shorts\_\_viewer_[data-content-wrapper]_[data-file-render-video]_&]:rounded-[10px] tw:[.shorts\_\_viewer_[data-content-wrapper]_[data-file-render-video]_&_video]:size-full tw:[.shorts\_\_viewer_[data-content-wrapper]_[data-file-render-video]_&_video]:object-cover tw:[.shorts\_\_viewer_[data-content-wrapper]_[data-file-render-video]_&_video]:!rounded-[10px]`,
  ios: 'tw:[-webkit-overflow-scrolling:touch]',
} as const;
