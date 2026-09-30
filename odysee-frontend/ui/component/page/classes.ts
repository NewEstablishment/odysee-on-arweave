export const NARROW_PAGE_SHELL_CLASS =
  'tw:mx-auto tw:w-full tw:max-w-[var(--narrow-page-max-width,70rem)] tw:px-app-s tw:small:mt-[var(--spacing-main-padding)] tw:small:px-app-l';

export const PAGE_TITLE_CLASS = String.raw`page__title tw:flex tw:min-h-[36px] tw:flex-row tw:items-center tw:[&_svg]:mt-[-2px] tw:[&_svg]:mr-app-m tw:[&_svg]:size-[2rem] tw:[&_svg]:overflow-visible tw:[&_svg]:rounded-[50%] tw:[&_svg]:bg-app-text tw:[&_svg]:p-[6px] tw:[&_svg]:[stroke:var(--color-background)] tw:[&_:is(label,.confirm\_\_label)]:!m-0 tw:[&_:is(label,.confirm\_\_label)]:flex tw:[&_:is(label,.confirm\_\_label)]:flex-1 tw:[&_:is(label,.confirm\_\_label)]:items-center tw:[&_:is(label,.confirm\_\_label)]:![font-size:var(--font-large)] tw:[&_:is(label,.confirm\_\_label)]:![font-weight:var(--font-weight-bold)] tw:[&_button]:mt-[-6px] tw:[&_button]:h-[36px] tw:[&_button]:float-right tw:[&_button]:pr-app-s tw:[&_button]:pl-app-xs tw:[&_button_.button-surface\_\_content_.button-surface\_\_label]:ml-0 tw:[&_button_.button-surface\_\_content_.button-surface\_\_label]:[font-size:var(--font-body)] tw:[&_button_.icon]:m-0 tw:[&_button_.icon]:size-[2rem] tw:[&_button_.icon]:bg-[unset] tw:[&_button_.icon]:![padding:8px_0] tw:[&_button_.icon]:stroke-white`;

export const PAGE_TITLE_MARGIN_CLASS = `${PAGE_TITLE_CLASS} page__title--margin tw:mb-app-m`;

export const STATIC_PAGE_CLASS = String.raw`static-page tw:[&_.card\_\_title-section]:pb-0 tw:[&_.card\_\_title-section_.card\_\_title]:text-app-title tw:[&_p]:mt-app-m tw:[&_p:nth-of-type(1)]:mt-0 tw:[&_p:nth-of-type(1)]:mb-app-l tw:[&_p:nth-of-type(1)]:opacity-80 tw:[&_p:nth-of-type(2)]:mb-app-l tw:[&_h3]:mt-app-xl tw:[&_h3]:mb-0 tw:[&_h3]:text-app-large tw:[&_h3]:font-[var(--font-weight-bold)] tw:[&_a]:text-app-primary tw:[&_a:hover]:text-app-secondary`;

export const AUTH_PAGE_WRAPPER_CLASS = 'tw:!p-0';

export const AUTH_PAGE_CLASS = `${NARROW_PAGE_SHELL_CLASS} tw:min-h-[unset] tw:small:min-h-[calc(100vh_-_var(--header-height)_-_var(--spacing-main-padding))]`;

export const PAGE_MAIN_CONTAINED_CLASS =
  'main--contained tw:m-auto tw:flex tw:max-w-[60rem] tw:flex-col tw:items-start tw:text-left tw:[&>*]:w-full';

export const PAGE_MAIN_EMPTY_CLASS = String.raw`main--empty tw:my-app-l tw:flex tw:w-full tw:self-center tw:flex-col tw:items-center tw:px-app-m tw:text-center tw:[&>:is(.card,.wunderbar\_\_suggestions,.snack-bar--notification,.modal,.card--after-tabs,.MuiAutocomplete-paper,[data-content-viewer])]:w-full tw:small:my-[100px]`;

export const PAGE_MAIN_FULL_WIDTH_CLASS = 'main--full-width tw:max-w-none';

const PAGE_MAIN_AUTH_FORM_CLASS = String.raw`tw:mx-auto tw:max-w-[27rem] tw:upto-small:mt-app-m tw:upto-small:[&_.card\_\_title]:!text-app-large`;

export const PAGE_MAIN_SIGN_IN_CLASS = `main__sign-in ${PAGE_MAIN_AUTH_FORM_CLASS}`;

export const PAGE_MAIN_SIGN_UP_CLASS = `main__sign-up ${PAGE_MAIN_AUTH_FORM_CLASS}`;

export const PAGE_MAIN_SIGN_UP_GRAPHIC_CLASS = String.raw`main__sign-up--graphic tw:max-w-[47rem] tw:[&_.card\_\_title]:font-[var(--font-weight-bold)] tw:[&_div:not(.checkbox)_label]:text-app-body tw:[&_div:not(.checkbox)_.confirm\_\_label]:text-app-body tw:[&_.checkbox]:mb-app-l tw:[&_input]:mb-app-m tw:[&_.card\_\_main-actions]:border-0 tw:[&_.card\_\_main-actions]:border-current`;

export const WALLET_ACTION_PAGE_LAYOUT_CLASS = String.raw`tw:min-h-[400px] tw:[&_:is(.card,.wunderbar\_\_suggestions,.snack-bar--notification,.modal,.card--after-tabs,.MuiAutocomplete-paper,[data-content-viewer])]:m-0 tw:[&_:is(.card,.wunderbar\_\_suggestions,.snack-bar--notification,.modal,.card--after-tabs,.MuiAutocomplete-paper,[data-content-viewer])]:h-full tw:[&_:is(.card,.wunderbar\_\_suggestions,.snack-bar--notification,.modal,.card--after-tabs,.MuiAutocomplete-paper,[data-content-viewer])]:p-0 tw:[&_iframe]:mb-[2rem] tw:[&_iframe]:min-h-[420px] tw:[&_iframe]:bg-app-card`;

export const PAGE_MAIN_WRAPPER_CLASS = String.raw`main-wrapper__inner tw:mx-auto tw:mt-[var(--header-height)] tw:flex tw:items-start tw:justify-between tw:px-0 tw:py-app-l tw:[&>*:first-child]:shrink-0 tw:large:w-full tw:upto-small:mt-[var(--header-height-mobile)] tw:upto-small:p-0`;

export const PAGE_MAIN_WRAPPER_FILE_CLASS =
  'main-wrapper__inner--filepage tw:!p-0 tw:upto-small:!mt-0 tw:upto-small:!pt-[var(--header-height-mobile)]';

export const PAGE_SIDEBAR_PUSHER_CLASS =
  'sidebar--pusher tw:absolute tw:w-full tw:pl-[var(--side-nav-width--micro)] tw:[animation-timing-function:var(--resizing-animation-function)] tw:upto-small:relative tw:upto-small:ml-[calc(var(--spacing-xs)*-1)] tw:upto-small:pl-0';

export const PAGE_SIDEBAR_PUSHER_FILE_CLASS = 'sidebar--pusher--filepage tw:w-full';

export const PAGE_MAIN_SHORTS_CLASS = 'main--shorts-page tw:h-[85vh] tw:z-auto tw:small:!h-fit';

export const PAGE_MAIN_VIDEO_CLASS = String.raw`main--video-page tw:medium:grid tw:medium:grid-cols-[minmax(0,var(--desktop-landscape-player-max-width))_minmax(calc(var(--recommended-content-width)-var(--spacing-l)*3-var(--spacing-m)*2),1fr)] tw:medium:justify-between tw:medium:gap-app-l tw:medium:[&_:is(.file-page\_\_recommended,.playlist\_\_wrapper)]:ml-0 tw:medium:[&_:is(.file-page\_\_recommended,.playlist\_\_wrapper)]:h-full tw:medium:[&_:is(.file-page\_\_recommended,.playlist\_\_wrapper)]:w-full tw:medium:[&_:is(.file-page\_\_recommended,.playlist\_\_wrapper)]:overflow-hidden`;

const THEATER_PAGE_CLASS = String.raw`tw:mx-0 tw:mt-0 tw:w-screen tw:max-w-none tw:pl-0 tw:[&>*:first-child]:mr-0 tw:[&_.file-page\_\_secondary-content]:flex-row tw:[&_.file-page\_\_secondary-content]:px-app-s tw:[&_.file-page\_\_recommended]:mt-[10px] tw:upto-medium:[&_.file-page\_\_secondary-content]:flex-col tw:upto-medium:[&_.file-page\_\_recommended]:w-full`;

export const PAGE_MAIN_THEATER_CLASS = String.raw`main--theater-mode ${THEATER_PAGE_CLASS} tw:pr-[var(--body-scrollbar-width)] tw:[&_.card-stack--spacing-m]:pr-app-m tw:[&_.file-page\_\_video-container]:aspect-video tw:[&_.file-page\_\_video-container]:max-h-[var(--desktop-portrait-player-max-height)]`;

export const PAGE_MAIN_LIVESTREAM_THEATER_CLASS = String.raw`main--livestream--theater-mode ${THEATER_PAGE_CLASS} tw:pr-0 tw:[&_.file-page\_\_secondary-content]:mx-auto tw:[&_.file-page\_\_secondary-content]:mt-app-m tw:[&_.file-page\_\_secondary-content]:flex tw:[&_.file-page\_\_secondary-content]:w-full tw:[&_.file-page\_\_secondary-content]:max-w-[var(--page-max-width--filepage)] tw:[&_.file-page\_\_secondary-content]:justify-center`;

export const PAGE_MAIN_SETTINGS_CLASS = String.raw`main--settings-page tw:mx-auto tw:mt-app-m tw:w-full tw:max-w-[70rem] tw:px-app-m tw:upto-small:px-app-xs tw:upto-small:[&_.section\_\_header--actions_.section\_\_actions--inline:last-of-type_.button-surface\_\_label]:hidden tw:upto-small:[&_.wunderbar\_\_wrapper]:mr-0 tw:upto-small:[&_.wunderbar\_\_wrapper_:is(.wunderbar,.wunderbar--inline)]:pl-0 tw:upto-small:[&_.wunderbar\_\_wrapper_:is(.wunderbar,.wunderbar--inline)_.icon]:left-[11px] tw:[&_.button-surface--inverse]:text-app-primary tw:[&_.card\_\_title-section:not(:first-child)]:pt-app-l tw:[&_.claim-preview\_\_wrapper--channel_.menu\_\_button]:right-app-s tw:[&_.claim-preview\_\_wrapper--channel_.claim-tile\_\_info]:mt-0 tw:[&_.claim-preview\_\_wrapper--channel_.claim-tile\_\_info]:pb-app-xxxs tw:[&_.claim-preview\_\_wrapper--channel_.button-surface--secondary]:!bg-[var(--color-header-button)] tw:[&_.claim-preview\_\_wrapper--channel_.button-surface--secondary:hover_.button-surface\_\_label]:!text-app-text tw:[&_.claim-preview\_\_wrapper--channel_[data-claim-tags]_a.button_.button-surface\_\_content]:mt-[-3px] tw:[&_.claim-preview\_\_wrapper--channel_[data-claim-tags]_a.button_.button-surface\_\_content_.button-surface\_\_label]:overflow-visible`;

export const PAGE_MAIN_MARKDOWN_CLASS = String.raw`main--markdown tw:flex-col tw:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_.claim-tile\_\_info]:mt-[-4px] tw:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_.claim-tile\_\_info]:pb-[unset] tw:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_.claim-tile\_\_info_.channel-name]:mt-[-8px] tw:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_.claim-preview--channel_.claim-preview\_\_text_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)]:!ml-[calc((2.5rem+var(--spacing-xxs))*-1)] tw:[&_.markdown-preview_p_:is(.button--uri-indicator,[data-comment-time],.comment\_\_action)_.channel-name]:text-app-primary tw:[&_.markdown-preview_p_:is(.button--uri-indicator,[data-comment-time],.comment\_\_action)_.channel-name]:text-app-large tw:[&_.markdown-preview_p_:is(.button--uri-indicator,[data-comment-time],.comment\_\_action)_.channel-name:hover]:text-app-secondary tw:upto-small:p-app-xxxs tw:upto-small:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_a.button]:self-start tw:upto-small:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_.claim-preview\_\_text]:!overflow-visible tw:upto-small:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_.claim-preview\_\_text]:flex-col tw:upto-small:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_.claim-preview\_\_text_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)]:mt-app-s tw:upto-small:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_.claim-preview\_\_text_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)]:ml-[calc((2rem+2*var(--spacing-xxs))*-1)] tw:upto-small:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_.claim-preview\_\_text_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)]:w-[calc(100%+2rem+2*var(--spacing-xxs))] tw:upto-small:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_.claim-preview\_\_text_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)]:overflow-visible tw:upto-small:[&_.markdown-preview_p_:is(.button--uri-indicator,[data-comment-time],.comment\_\_action)_.channel-name]:[font-size:var(--font-base)] tw:upto-small:[&_:is(.claim-preview\_\_wrapper,.playlist-preview\_\_wrapper)_.claim-tile\_\_info]:!mt-app-xs`;

export const PAGE_MAIN_LAUNCHING_CLASS =
  'main--launching tw:h-screen tw:w-screen tw:bg-app-background tw:supports-[height:100dvh]:h-dvh';
