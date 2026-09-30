export const PREVIEW_OVERLAY_VIEWER_COUNT_CLASS = String.raw`livestream__viewer-count tw:flex tw:items-center tw:[&_.icon]:ml-app-xxs tw:[[data-claim-preview-file-property-overlay]_&]:h-[1.2rem] tw:[[data-claim-preview-file-property-overlay]_&]:rounded-[calc(var(--border-radius)/2)] tw:[[data-claim-preview-file-property-overlay]_&]:bg-[var(--color-live)] tw:[[data-claim-preview-file-property-overlay]_&]:px-app-xxxs tw:[[data-claim-preview-file-property-overlay]_&]:py-0 tw:[[data-claim-preview-file-property-overlay]_&]:text-[var(--color-white-alt)]`;

export const CLAIM_PREVIEW_OVERLAY_PROPERTIES_CLASS = String.raw`tw:relative tw:mt-auto tw:ml-0 tw:flex tw:items-center tw:whitespace-nowrap tw:text-[#dddddd] tw:text-app-xsmall tw:leading-[1.2] tw:[&>*:not(:last-child)]:mr-[calc(var(--spacing-xxs)/2)] tw:[.claim-tile\_\_info_&]:text-[rgba(var(--color-text-base)_0.7)]`;

export const CLAIM_PREVIEW_OVERLAY_PROPERTIES_SMALL_CLASS =
  'tw:text-app-xxsmall tw:text-app-text tw:[&[data-claim-preview-overlay-properties-small]]:leading-[0.9]';

export const CLAIM_PREVIEW_FILE_PROPERTY_OVERLAY_CLASS = String.raw`tw:absolute tw:right-app-xxs tw:bottom-app-xxs tw:z-[6] tw:rounded-app tw:bg-[var(--color-black)] tw:p-[0.3rem] tw:opacity-70 tw:[@media(pointer:fine)]:opacity-[0.85] tw:[@media(pointer:coarse)]:opacity-[0.85] tw:[.claim-preview:hover_&]:opacity-100 tw:[.claim-preview\_\_wrapper--live_&]:opacity-90 tw:[.claim-preview\_\_wrapper--live_&_[data-claim-preview-overlay-properties]]:text-white tw:[.media\_\_thumb--small_&]:p-[0.18rem]`;
