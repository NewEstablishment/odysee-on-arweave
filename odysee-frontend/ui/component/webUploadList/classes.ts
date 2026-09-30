export const WEB_UPLOAD_ITEM_CLASS = String.raw`tw:p-app-m tw:[flex-flow:row] tw:before:hidden tw:[&_.claim-preview-metadata]:w-full tw:[&_.claim-preview-metadata]:flex-1 tw:[&_[data-web-upload-progress]]:mt-0 tw:[@media(max-width:900px)]:block tw:[@media(max-width:900px)]:[&_.media\_\_thumb]:mb-app-s tw:[@media(max-width:900px)]:[&_.media\_\_thumb]:w-full tw:[@media(max-width:900px)]:[&_.claim-preview-metadata]:block`;

export const WEB_UPLOAD_ROUND_BUTTON_CLASS =
  'tw:flex tw:size-[32px] tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[50%] tw:border-none tw:[background:var(--color-card-background)] tw:text-app-text tw:[transition:background-color_0.15s_ease,color_0.15s_ease] tw:hover:[background:var(--color-primary)] tw:hover:text-app-primary-contrast';

export const WEB_UPLOAD_STATS_CLASS =
  'tw:mt-app-m tw:mb-0 tw:flex tw:items-center tw:justify-between tw:text-app-xsmall tw:text-app-text-subtitle';

export const WEB_UPLOAD_PROGRESS_CLASSES = {
  outer: 'tw:mt-app-s tw:w-full tw:rounded-app tw:bg-app-header',
  inner: 'tw:flex tw:h-[2.4rem] tw:items-center tw:rounded-app tw:[background:var(--color-primary)] tw:p-app-xxs',
  text: 'tw:absolute tw:w-4/5 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text',
} as const;
