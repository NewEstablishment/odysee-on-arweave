export const SHORTS_VIEWER_CONTENT_CLASSES = {
  info: String.raw`shorts-viewer__content-info tw:pointer-events-none tw:absolute tw:bottom-[60px] tw:left-0 tw:z-[2] tw:flex tw:w-full tw:flex-col tw:items-start tw:gap-[8px] tw:py-[12px] tw:pr-[86px] tw:pl-[10px] tw:[transition:opacity_100ms_ease-out] tw:shorts:[[data-shorts-viewer]_&]:opacity-0 tw:shorts:[[data-shorts-viewer]:has(.media-controls[data-visible])_&]:opacity-100 tw:shorts:[[data-shorts-viewer]:has(.media-controls[data-visible])_&]:[transition:opacity_100ms_ease-out] tw:shorts:[[data-shorts-viewer]:has([data-paused])_&]:opacity-100 tw:shorts:[[data-shorts-viewer]:has([data-paused])_&]:[transition:opacity_100ms_ease-out] tw:shorts:[body:has(.swipe-navigation-overlay.shorts-swipe-overlay:hover)_&]:opacity-100 tw:shorts:[body:has(.swipe-navigation-overlay.shorts-swipe-overlay:hover)_&]:[transition:opacity_100ms_ease-out]`,
  channel:
    'shorts-viewer__channel tw:pointer-events-auto tw:flex tw:cursor-pointer tw:items-center tw:gap-[8px] tw:no-underline',
  channelName:
    'shorts-viewer__channel-name tw:text-[11px] tw:font-medium tw:text-[rgba(255,255,255,0.75)] tw:[text-shadow:0_1px_2px_rgba(0,0,0,0.5)]',
  title: String.raw`shorts-viewer__title tw:line-clamp-2 tw:overflow-hidden tw:text-ellipsis tw:text-[12px] tw:leading-[1.3] tw:font-semibold tw:text-white tw:[overflow-wrap:anywhere] tw:[text-shadow:0_1px_3px_rgba(0,0,0,0.5)]`,
} as const;

const SHORTS_TRANSITION_CLASS = String.raw`tw:fixed tw:top-0 tw:left-1/2 tw:z-[2] tw:mt-[60px] tw:h-[90vh] tw:w-[var(--shorts-viewer-width,var(--shorts-viewer-width-default))] tw:overflow-hidden tw:rounded-[10px] tw:pointer-events-none tw:bg-black tw:bg-cover tw:bg-center tw:bg-no-repeat tw:opacity-0 tw:[--shorts-preview-translate-x:calc(-50%_-_6px)] tw:upto-shorts:!left-0 tw:upto-shorts:mt-0 tw:upto-shorts:h-screen tw:upto-shorts:w-screen tw:upto-shorts:rounded-none tw:upto-shorts:![--shorts-preview-translate-x:0] tw:upto-shorts:supports-[height:100svh]:h-[100svh]`;

const SHORTS_TRANSITION_PANEL_RANGE_CLASS = String.raw`tw:[@media(min-width:1020px)_and_(max-width:1400px)]:![--shorts-preview-translate-x:0] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:left-[20px] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:!w-[350px]`;

export const SHORTS_PAGE_CLASSES = {
  root: String.raw`shorts-page tw:absolute tw:h-fit tw:w-[98.5%] tw:overflow-hidden tw:upto-shorts:!fixed tw:upto-shorts:inset-0 tw:upto-shorts:!h-screen tw:upto-shorts:!max-h-screen tw:upto-shorts:!w-screen tw:upto-shorts:!overflow-hidden tw:upto-shorts:![overscroll-behavior:none] tw:upto-shorts:![-webkit-overflow-scrolling:none] tw:upto-shorts:supports-[height:100svh]:!h-[100svh] tw:upto-shorts:supports-[height:100svh]:!max-h-[100svh]`,
  container: String.raw`shorts-page__container tw:relative tw:flex tw:!h-[86vh] tw:w-full tw:upto-shorts:!w-screen tw:upto-shorts:!overflow-hidden tw:[&:fullscreen]:!inset-0 tw:[&:fullscreen]:flex tw:[&:fullscreen]:!h-[100dvh] tw:[&:fullscreen]:!w-screen tw:[&:fullscreen]:items-center tw:[&:fullscreen]:justify-center tw:[&:fullscreen]:!m-0 tw:[&:fullscreen]:!p-0 tw:[&:fullscreen]:bg-black tw:[html.ios-fullscreen_&]:!inset-0 tw:[html.ios-fullscreen_&]:flex tw:[html.ios-fullscreen_&]:!h-[100dvh] tw:[html.ios-fullscreen_&]:!w-screen tw:[html.ios-fullscreen_&]:items-center tw:[html.ios-fullscreen_&]:justify-center tw:[html.ios-fullscreen_&]:!m-0 tw:[html.ios-fullscreen_&]:!p-0 tw:[html.ios-fullscreen_&]:bg-black`,
  containerPanelOpen: 'shorts-page__container--panel-open',
  mainContent: String.raw`shorts-page__main-content tw:upto-shorts:!h-screen tw:upto-shorts:!w-screen tw:upto-shorts:!overflow-hidden tw:upto-shorts:supports-[height:100svh]:!h-[100svh] tw:active-shorts-fullscreen:flex tw:active-shorts-fullscreen:h-full tw:active-shorts-fullscreen:w-full tw:active-shorts-fullscreen:items-center tw:active-shorts-fullscreen:justify-center tw:active-shorts-fullscreen:[transition:margin-right_0.3s_cubic-bezier(0.4,0,0.2,1)] tw:[:is(.shorts-page\_\_container:fullscreen.shorts-page\_\_container--panel-open,html.ios-fullscreen_.shorts-page\_\_container.shorts-page\_\_container--panel-open,.player-fullscreen-target:fullscreen.shorts-page\_\_container--panel-open,html.ios-fullscreen_.player-fullscreen-target.shorts-page\_\_container--panel-open)_&]:mr-[720px]`,
  transitionPreview: `shorts-transition-preview ${SHORTS_TRANSITION_CLASS}`,
  transitionPreviewNext:
    'shorts-transition-preview--next tw:opacity-100 tw:[animation:shorts-preview-next_0.32s_cubic-bezier(0.4,0,0.2,1)_forwards]',
  transitionPreviewPrevious:
    'shorts-transition-preview--previous tw:opacity-100 tw:[animation:shorts-preview-previous_0.32s_cubic-bezier(0.4,0,0.2,1)_forwards]',
  transitionPreviewPanelOpen: String.raw`shorts-transition-preview--panel-open tw:![--shorts-preview-translate-x:-130%] tw:upto-shorts:![--shorts-preview-translate-x:0] ${SHORTS_TRANSITION_PANEL_RANGE_CLASS}`,
  transitionCurrent: String.raw`shorts-transition-current ${SHORTS_TRANSITION_CLASS} tw:[transform:translate(var(--shorts-preview-translate-x),0)]`,
  transitionCurrentNext:
    'shorts-transition-current--next tw:opacity-100 tw:[animation:shorts-current-next_0.32s_cubic-bezier(0.4,0,0.2,1)_forwards]',
  transitionCurrentPrevious:
    'shorts-transition-current--previous tw:opacity-100 tw:[animation:shorts-current-previous_0.32s_cubic-bezier(0.4,0,0.2,1)_forwards]',
  transitionCurrentPanelOpen: String.raw`shorts-transition-current--panel-open tw:![--shorts-preview-translate-x:-130%] tw:upto-shorts:![--shorts-preview-translate-x:0] tw:upto-shorts:!w-[350px] ${SHORTS_TRANSITION_PANEL_RANGE_CLASS}`,
} as const;
