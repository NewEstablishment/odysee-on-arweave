export const CLAIM_PREVIEW_TILE_CLASSES = {
  placeholderReveal: 'tw:motion-safe:[animation:claim-placeholder-reveal_120ms_ease-out_both]',
  shortCover: 'tw:[&_.media__thumb.media__thumb--has-preview]:!bg-cover',
  shortSection: String.raw`tw:[&_.media\_\_thumb]:aspect-[9/16] tw:upto-small:!w-[48.5%]`,
  shortThumbnail: 'tw:aspect-[9/16]',
} as const;

export const CLAIM_TILE_PLACEHOLDER_SECONDARY_TITLE_CLASS =
  'tw:mt-[4px] tw:mb-[14px] tw:min-h-[var(--font-body)] tw:w-3/4 tw:rounded-app tw:bg-app-text tw:opacity-20';

export const CLAIM_TILE_ABOUT_COUNTS_CLASS = String.raw`tw:mt-[-3px] tw:!flex tw:flex-wrap tw:text-app-xsmall tw:[.placeholder_.claim-tile\_\_info_.claim-tile\_\_about_&]:mt-[4px] tw:[.placeholder_.claim-tile\_\_info_.claim-tile\_\_about_&]:h-[var(--font-xsmall)] tw:[.placeholder_.claim-tile\_\_info_.claim-tile\_\_about_&]:w-[35%] tw:[.placeholder_.claim-tile\_\_info_.claim-tile\_\_about_&]:rounded-app tw:[.placeholder_.claim-tile\_\_info_.claim-tile\_\_about_&]:bg-app-text tw:[.placeholder_.claim-tile\_\_info_.claim-tile\_\_about_&]:opacity-10`;

export const CLAIM_TILE_REPOST_AUTHOR_CLASS = 'tw:[.hide-ribbon_&]:hidden tw:[.show-ribbon_&]:block';

export const CLAIM_TILE_HEADER_CLASS = String.raw`tw:relative tw:[&_.icon]:mt-[1px] tw:[&_.icon:hover]:stroke-app-primary`;
