const CHANNEL_THUMBNAIL_CONTEXT_CLASS = [
  String.raw`tw:[:is(.claim-preview\_\_wrapper--row,.playlist-preview\_\_wrapper)_.claim-preview-metadata_.claim-tile\_\_info_&]:mt-[4px]`,
  String.raw`tw:upto-small:[.claim-preview_.claim-preview-metadata_.claim-tile\_\_info_&]:mb-[5px]`,
  String.raw`tw:[.claim-preview--large_&_:is(.ff-canvas,.freezeframe-img)]:size-full tw:[.claim-preview--large_&_:is(.ff-canvas,.freezeframe-img)]:rounded-[50%]`,
  String.raw`tw:[.claim-tile\_\_info_&_:is(.ff-canvas,.freezeframe-img)]:size-full tw:[.claim-tile\_\_info_&_:is(.ff-canvas,.freezeframe-img)]:rounded-[50%]`,
  String.raw`tw:[.playlist-preview\_\_wrapper_.content_.text_.channel_&]:shrink-0`,
  String.raw`tw:upto-small:[.file-page_.claim-preview--inline_.button-surface--unstyled_&]:mt-[2px] tw:upto-small:[.file-page_.claim-preview--inline_.button-surface--unstyled_&]:mb-app-xxs tw:upto-small:[.file-page_.claim-preview--inline_.button-surface--unstyled_&]:ml-0 tw:upto-small:[.file-page_.claim-preview--inline_.button-surface--unstyled_&_.ff-container]:size-[2.5rem] tw:upto-small:[.file-page_.claim-preview--inline_.button-surface--unstyled_&_.ff-container]:overflow-hidden tw:upto-small:[.file-page_.claim-preview--inline_.button-surface--unstyled_&_.ff-container]:rounded-app`,
  String.raw`tw:upto-small:[.main--markdown_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_&]:!size-[2rem]`,
  String.raw`tw:active-fullscreen-side-panel:[.claim-preview_.claim-preview-metadata_.claim-tile\_\_info_&]:mb-[5px]`,
  String.raw`tw:active-fullscreen-side-panel:[.file-page_.claim-preview--inline_.button-surface--unstyled_&]:mt-[2px] tw:active-fullscreen-side-panel:[.file-page_.claim-preview--inline_.button-surface--unstyled_&]:mb-app-xxs tw:active-fullscreen-side-panel:[.file-page_.claim-preview--inline_.button-surface--unstyled_&]:ml-0 tw:active-fullscreen-side-panel:[.file-page_.claim-preview--inline_.button-surface--unstyled_&_.ff-container]:size-[2.5rem] tw:active-fullscreen-side-panel:[.file-page_.claim-preview--inline_.button-surface--unstyled_&_.ff-container]:overflow-hidden tw:active-fullscreen-side-panel:[.file-page_.claim-preview--inline_.button-surface--unstyled_&_.ff-container]:rounded-app`,
  String.raw`tw:upto-small:[.header\_\_navigation_&]:!size-[calc(var(--header-height-mobile)-var(--spacing-m))]`,
].join(' ');

const CHANNEL_THUMBNAIL_BASE_CLASS = String.raw`channel-thumbnail tw:relative tw:mr-app-m tw:flex tw:size-[5rem] tw:rounded-[50%] tw:bg-cover tw:select-none tw:[-webkit-touch-callout:none] tw:[&_.button]:absolute tw:[&_.button]:right-[-1rem] tw:[&_.button]:bottom-[-16%] tw:[&_.button]:flex tw:[&_.button]:w-4/5 tw:[&_.button]:!bg-[unset] tw:[&_.button]:text-center tw:[&_.button]:![left:unset] tw:[&_.link--small]:!right-[-3rem] tw:[&_.comment\_\_badge]:absolute tw:[&_.comment\_\_badge]:bottom-[-26%] tw:[&_.comment\_\_badge]:left-[22%] tw:[&_.comment\_\_badge]:w-4/5 tw:[&_.comment\_\_badge]:text-center tw:[&_.comment\_\_badge_svg]:size-full tw:[&_.comment\_\_badge_svg]:overflow-visible tw:[&_.comment\_\_badge_svg]:[stroke:unset] tw:[&.freezeframe-wrapper_.ff-container]:overflow-hidden`;

export const CHANNEL_THUMBNAIL_CLASSES = {
  base: `${CHANNEL_THUMBNAIL_BASE_CLASS} ${CHANNEL_THUMBNAIL_CONTEXT_CLASS}`,
  channelPage: String.raw`channel__thumbnail--channel-page tw:absolute tw:top-[-9.2rem] tw:left-[calc((100%-var(--page-max-width))/2)] tw:z-[11] tw:mt-app-l tw:size-[var(--channel-thumbnail-width)] tw:bg-[var(--color-header-background)] tw:[box-shadow:0_3px_6px_0_var(--color-shadow),0_4px_10px_0_rgba(0,0,0,0.6)] tw:[transition:width_0.2s,height_0.2s,top_0.2s] tw:[&_.comment\_\_badge]:!left-0 tw:[&_.comment\_\_badge]:!w-[60%] tw:[&_.comment\_\_badge]:text-center tw:[&_.comment\_\_badge_svg]:size-full tw:[&_.comment\_\_badge_svg]:overflow-visible tw:[&_.comment\_\_badge_svg]:[stroke:unset] tw:hover:cursor-pointer tw:active:[border:2px_solid_rgba(0,0,0,0.6)] tw:active:[box-shadow:0_0_0_0_var(--color-shadow),0_0_0_0_rgba(0,0,0,0.6)] tw:[@media(min-width:900px)_and_(max-width:1449px)]:left-[var(--spacing-l)] tw:[@media(min-width:1450px)_and_(max-width:1600px)]:!left-[calc((100%-var(--page-max-width))/2)] tw:upto-small:!top-[-7.2rem] tw:upto-small:!left-app-xs tw:upto-small:!size-[5rem]`,
  channelPageFixed: String.raw`channel__thumbnail--channel-page-fixed tw:!top-[-1.9rem] tw:!size-[50px] tw:upto-small:!size-[calc(var(--header-height-mobile)-var(--spacing-m))]`,
  custom:
    'channel-thumbnail__custom tw:w-full tw:rounded-[50%] tw:object-cover tw:text-[1px] tw:select-none tw:[-webkit-touch-callout:none]',
  default: 'channel-thumbnail__default tw:mx-auto tw:h-4/5 tw:w-4/5 tw:self-end',
  defaultColors: [
    String.raw`channel-thumbnail__default--0 tw:[&.channel-thumbnail\_\_default--0]:bg-[#748ffc]`,
    String.raw`channel-thumbnail__default--1 tw:[&.channel-thumbnail\_\_default--1]:bg-[#ffa855]`,
    String.raw`channel-thumbnail__default--2 tw:[&.channel-thumbnail\_\_default--2]:bg-[#339af0]`,
    String.raw`channel-thumbnail__default--3 tw:[&.channel-thumbnail\_\_default--3]:bg-[#ec8383]`,
    String.raw`channel-thumbnail__default--4 tw:[&.channel-thumbnail\_\_default--4]:bg-[#ccc]`,
  ],
  profileBadgeTooltip: 'tw:!mt-0 tw:!right-[0.5rem]',
  resolving: 'channel-thumbnail--resolving tw:bg-[var(--color-gray-3)]',
  small: 'channel-thumbnail--small tw:[&.channel-thumbnail--small]:size-[3rem]',
  waiting: 'channel-thumbnail--waiting tw:rounded-app tw:bg-[var(--color-gray-5)] tw:px-[1rem] tw:pt-[4rem]',
  xsmall:
    'channel-thumbnail--xsmall tw:[&.channel-thumbnail--xsmall]:mr-app-xs tw:[&.channel-thumbnail--xsmall]:size-[2.1rem]',
  xxsmall:
    'channel-thumbnail--xxsmall tw:[&.channel-thumbnail--xxsmall]:size-[1rem] tw:[&_.ff-container]:size-full tw:[&_.ff-canvas]:size-full',
} as const;
