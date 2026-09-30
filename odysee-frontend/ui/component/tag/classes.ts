export const TAG_CLASSES = {
  base: String.raw`tag tw:h-[var(--height-badge)] tw:cursor-pointer tw:items-center tw:whitespace-nowrap tw:rounded-app tw:bg-[var(--color-tag)] tw:px-app-xs tw:py-app-xs tw:text-app-xsmall tw:text-[var(--color-tag-text)] tw:select-none tw:[&_.button-surface\_\_label]:mt-0 tw:[.menu\_\_link_&]:ml-app-s tw:[.card\_\_title_&]:float-right tw:[.card\_\_title_&]:mt-[8px] tw:[.card\_\_title_&]:ml-app-s tw:[.channelPage-wrapper_:is(.media\_\_info-text,.media\_\_info-text-preview)_[data-claim-tags]_&]:mt-app-xxxs tw:[.channelPage-wrapper_:is(.media\_\_info-text,.media\_\_info-text-preview)_[data-claim-tags]_&]:inline-block tw:[:is(.claim-preview\_\_wrapper--row,.playlist-preview\_\_wrapper)_.claim-preview-metadata_[data-claim-preview-tags]_[data-claim-tags]_&]:max-w-[140px] tw:hover:bg-[var(--color-tag-hover)] tw:hover:!text-[var(--color-tag-text-hover)]`,
  disabled: 'tag--disabled tw:!cursor-default tw:opacity-30',
  flow: 'tag--flow tw:m-[0.2rem] tw:max-w-[20rem]',
  large: 'tag--large tw:h-[var(--height-input)] tw:!px-app-s tw:!py-0',
  mature: 'tag--mature tw:!bg-[#710000] tw:!text-white tw:hover:!bg-[#b00000] tw:hover:!text-white',
  remove: String.raw`tag--remove tw:max-w-[20rem] tw:[.tags--remove_&:hover]:!bg-[var(--color-tag-remove)] tw:[.tags--remove_&:hover]:[outline:1px_solid_red] tw:[.tags--remove_&:hover_.button-surface\_\_label]:!text-[red] tw:[.tags--remove_&:hover_.icon]:!stroke-[red]`,
} as const;
