export const FILE_THUMBNAIL_CLASSES = {
  small: 'media__thumb--small tw:!w-[calc(var(--file-list-thumbnail-width)/1.5)]',
  live: String.raw`tw:[box-shadow:0_0_0_1px_rgba(var(--color-primary-dynamic),0.3)]`,
  liveImage:
    'tw:pointer-events-none tw:absolute tw:inset-0 tw:size-full tw:object-cover tw:opacity-0 tw:[transition:opacity_0.22s_ease-out] tw:will-change-[opacity]',
  liveImageActive: 'tw:opacity-100',
  liveRefreshing: String.raw`tw:[&_:is([data-claim-preview-file-property-overlay],.button-surface--play,.claim-preview-progress)]:pointer-events-none tw:[&_:is([data-claim-preview-file-property-overlay],.button-surface--play,.claim-preview-progress)]:opacity-0 tw:[&_:is([data-claim-preview-file-property-overlay],.button-surface--play,.claim-preview-progress)]:[transition:opacity_0.15s_ease]`,
  hasPreview: 'tw:![background-size:100%]',
  previewActive: String.raw`tw:![background-size:100%] tw:[&_.claim-preview-progress]:pointer-events-none tw:[&_.claim-preview-progress]:opacity-0 tw:[&_.claim-preview-progress]:[transition:opacity_0.15s_ease] tw:[&_[data-claim-preview-file-property-overlay]]:z-[4]`,
  frameCrossfade: String.raw`tw:pointer-events-none tw:absolute tw:inset-0 tw:z-[2] tw:overflow-hidden tw:rounded-app tw:opacity-0 tw:[transition:opacity_0.5s_ease] tw:after:pointer-events-none tw:after:absolute tw:after:inset-0 tw:after:z-[3] tw:after:rounded-[inherit] tw:after:[box-shadow:0_0_0_1px_rgba(var(--color-primary-dynamic),1)_inset] tw:after:content-['']`,
  frameCrossfadeActive: 'tw:opacity-100 tw:![transition:opacity_0.3s_ease]',
  frameCrossfadePortrait: 'tw:bg-black tw:[&_img]:object-contain tw:[&_img]:[transform:scale(1.35)]',
  framePreview: 'tw:absolute tw:inset-0 tw:size-full tw:object-cover',
  framePreviewFront: 'tw:opacity-0 tw:[animation:frameFadeIn_0.65s_ease-in-out_forwards]',
  frameCounter:
    'tw:pointer-events-none tw:absolute tw:bottom-app-xxs tw:left-app-xxs tw:z-[12] tw:rounded-app tw:bg-[var(--color-black)] tw:p-[0.3rem] tw:text-app-xsmall tw:leading-[1.2] tw:tabular-nums tw:text-[var(--color-white)] tw:opacity-70 tw:[@media(pointer:fine)]:opacity-[0.85] tw:[@media(pointer:coarse)]:opacity-[0.85]',
  muteButton: String.raw`tw:absolute tw:top-app-xxs tw:left-app-xxs tw:z-[12] tw:flex tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-app tw:![border:none] tw:bg-[var(--color-black)] tw:p-[0.3rem] tw:text-[var(--color-white)] tw:[&_.icon]:!stroke-white`,
  progressWrap: String.raw`tw:group/thumbnail-progress tw:pointer-events-auto tw:absolute tw:right-0 tw:bottom-0 tw:left-0 tw:z-[15] tw:flex tw:h-[30px] tw:items-end tw:[&:hover~[data-claim-preview-file-property-overlay]]:opacity-0 tw:[&:hover~[data-claim-preview-file-property-overlay]]:[transition:opacity_0.15s]`,
  progress:
    'tw:relative tw:mx-[1px] tw:mt-0 tw:mb-[1px] tw:h-[4px] tw:w-[calc(100%-2px)] tw:overflow-hidden tw:rounded-[0_0_calc(var(--border-radius)-1px)_calc(var(--border-radius)-1px)] tw:bg-[rgba(255,255,255,0.3)] tw:[transition:height_0.2s_ease,margin_0.2s_ease,border-radius_0.2s_ease] tw:group-hover/thumbnail-progress:mx-[8px] tw:group-hover/thumbnail-progress:mt-0 tw:group-hover/thumbnail-progress:mb-[10px] tw:group-hover/thumbnail-progress:h-[5px] tw:group-hover/thumbnail-progress:overflow-visible tw:group-hover/thumbnail-progress:rounded-[2px]',
  progressHover:
    'tw:absolute tw:top-0 tw:left-0 tw:h-full tw:rounded-[inherit] tw:bg-[rgba(255,255,255,0.4)] tw:opacity-0 tw:[transition:opacity_0.15s] tw:group-hover/thumbnail-progress:opacity-100',
  progressBar:
    'tw:absolute tw:top-0 tw:left-0 tw:h-full tw:rounded-[inherit] tw:bg-[image:var(--color-odysee-gradient)]',
  progressDot:
    'tw:pointer-events-none tw:absolute tw:top-1/2 tw:mt-[-5px] tw:size-[10px] tw:rounded-[50%] tw:bg-[#f77937] tw:opacity-0 tw:[transform:translateX(-50%)_scale(0)] tw:[transition:opacity_0.15s,transform_0.15s] tw:group-hover/thumbnail-progress:opacity-100 tw:group-hover/thumbnail-progress:[transform:translateX(-50%)_scale(1)]',
  progressTooltip:
    'tw:pointer-events-none tw:absolute tw:bottom-full tw:z-[20] tw:mb-[-8px] tw:flex tw:flex-col tw:items-center tw:[transform:translateX(-50%)]',
  progressTooltipSprite:
    'tw:flex tw:aspect-video tw:min-h-fit tw:min-w-fit tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-[6px] tw:border-2 tw:border-white tw:bg-black tw:[box-shadow:0_1px_4px_rgba(0,0,0,0.5)]',
  progressTooltipSpriteInner: 'tw:[zoom:1]',
  progressTooltipTime:
    'tw:mt-[4px] tw:whitespace-nowrap tw:rounded-[4px] tw:bg-[rgba(0,0,0,0.7)] tw:px-[4px] tw:py-[1px] tw:text-[13px] tw:leading-[16px] tw:font-black tw:tabular-nums tw:text-white',
  videoWrap: String.raw`tw:pointer-events-none tw:absolute tw:inset-0 tw:z-[1] tw:overflow-hidden tw:rounded-app tw:opacity-0 tw:[transition:opacity_0.5s_ease] tw:after:pointer-events-none tw:after:absolute tw:after:inset-0 tw:after:z-[3] tw:after:rounded-[inherit] tw:after:[box-shadow:0_0_0_1px_rgba(var(--color-primary-dynamic),1)_inset] tw:after:content-['']`,
  videoWrapActive: 'tw:opacity-100 tw:![transition:opacity_0.3s_ease]',
  videoPreview: 'tw:size-full tw:object-cover',
  videoPreviewPortrait: 'tw:bg-black tw:!object-contain tw:![transform:scale(1.35)]',
} as const;
