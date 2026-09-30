export const SWIPE_NAVIGATION_OVERLAY_CLASS =
  'swipe-navigation-overlay tw:fixed tw:z-[2] tw:pointer-events-none tw:overflow-hidden tw:bg-transparent';

export const SWIPE_NAVIGATION_OVERLAY_ENABLED_CLASS =
  'swipe-navigation-overlay--enabled tw:!pointer-events-auto tw:shorts:!pointer-events-none';

export const SHORTS_SWIPE_OVERLAY_CLASS =
  'shorts-swipe-overlay tw:top-[60px] tw:left-1/2 tw:h-[82vh] tw:w-[var(--shorts-viewer-width,var(--shorts-viewer-width-default))] tw:overflow-hidden tw:rounded-[10px] tw:[transform:translate(calc(-50%_-_6px),0%)] tw:[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] tw:[@media(max-width:1020px)]:h-[83%] tw:[@media(max-width:1020px)]:w-full tw:medium:!w-[var(--shorts-viewer-width,var(--shorts-viewer-width-default))] tw:[@media(min-width:1020px)_and_(max-width:1380px)_and_(max-height:860px)]:!w-[var(--shorts-viewer-width,var(--shorts-viewer-width-default))]';

const SHORTS_PAGE_NAVIGATION_LAYOUT_CLASS = String.raw`shorts-page__navigation tw:fixed tw:top-[60px] tw:right-[calc(50%_-_var(--shorts-viewer-width,var(--shorts-viewer-width-default))_/_2_-_60px)] tw:bottom-0 tw:z-[10000] tw:flex tw:flex-col tw:items-center tw:justify-end tw:gap-[8px] tw:overflow-hidden tw:pb-0 tw:[transition:right_0.3s_cubic-bezier(0.4,0,0.2,1)] tw:[@media(max-width:1020px)]:right-[10px] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:right-[calc(50%_-_var(--shorts-viewer-width,var(--shorts-viewer-width-default))_/_2_-_60px)] tw:[@media(min-width:1020px)_and_(max-width:1380px)_and_(max-height:860px)]:right-[calc(50%_-_var(--shorts-viewer-width,var(--shorts-viewer-width-default))_/_2_-_60px)] tw:[@media(pointer:coarse)]:hidden tw:medium:!right-[calc(49.8%_-_var(--shorts-viewer-width,var(--shorts-viewer-width-default))_/_2_-_60px)] tw:medium:bottom-[6vh]`;

const SHORTS_PAGE_NAVIGATION_PANEL_CLASS = String.raw`tw:[.shorts-page\_\_container--panel-open_&]:!right-[calc(50%_+_var(--shorts-viewer-width,var(--shorts-viewer-width-default))_*_0.3_-_75px)] tw:[.shorts-page\_\_container--panel-open_&:not(.shorts-page\_\_navigation--mobile-desktop)]:hidden tw:[@media(max-width:1020px)]:[.shorts-page\_\_container--panel-open_&]:!right-[15px] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[.shorts-page\_\_container--panel-open_&]:!left-[calc(403px_-_var(--spacing-xs))] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[.shorts-page\_\_container--panel-open_.shorts-page\_\_navigation&]:!right-auto tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[.shorts-page\_\_container--panel-open_&]:top-[60px] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[.shorts-page\_\_container--panel-open_&]:bottom-0 tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[.shorts-page\_\_container--panel-open_&]:h-auto tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[.shorts-page\_\_container--panel-open_&]:mt-0 tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[.shorts-page\_\_container--panel-open_&]:pb-[100px] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[.shorts-page\_\_container--panel-open_&_:is(p,span)]:[text-shadow:1px_1px_2px_rgba(0,0,0,0.833)] tw:[@media(min-width:1020px)_and_(max-width:1150px)_and_(min-height:750px)]:[.shorts-page\_\_container--panel-open_.shorts-page\_\_navigation&]:!left-[300px] tw:[@media(min-width:1020px)_and_(max-width:1150px)_and_(min-height:850px)]:[.shorts-page\_\_container--panel-open_.shorts-page\_\_navigation&]:!left-[calc(var(--shorts-viewer-width-default)_-_50px)] tw:[@media(min-width:1020px)_and_(max-width:1150px)_and_(max-height:750px)]:[.shorts-page\_\_container--panel-open_.shorts-page\_\_navigation&]:!left-[270px] tw:[@media(min-width:1020px)_and_(max-width:1150px)_and_(max-height:750px)]:[.shorts-page\_\_container--panel-open_.shorts-page\_\_navigation&]:!pb-[70px] tw:medium:[.shorts-page\_\_container--panel-open_&]:!right-[calc(50%_+_var(--shorts-viewer-width,var(--shorts-viewer-width-default))_*_0.3_-_75px)] tw:[@media(min-width:1150px)_and_(max-height:750px)]:[.shorts-page\_\_container--panel-open_&]:!right-[calc(50%_+_var(--shorts-viewer-width,var(--shorts-viewer-width-default))_*_0.3_-_100px)]`;

const SHORTS_PAGE_NAVIGATION_COMPACT_CLASS = String.raw`tw:[@media(max-height:750px)]:!grid tw:[@media(max-height:750px)]:w-fit tw:[@media(max-height:750px)]:grid-cols-[auto_auto] tw:[@media(max-height:750px)]:[align-content:end] tw:[@media(max-height:750px)]:justify-items-center tw:[@media(max-height:750px)]:gap-[8px] tw:[@media(max-height:750px)]:overflow-visible tw:[@media(max-height:750px)]:right-[calc(50%_-_var(--shorts-viewer-width,var(--shorts-viewer-width-default))_/_2_-_110px)] tw:[@media(max-width:1020px)_and_(max-height:750px)]:right-[10px] tw:[@media(max-height:750px)]:[&_.shorts-actions\_\_item:nth-of-type(2)]:col-start-1 tw:[@media(max-height:750px)]:[&_.shorts-actions\_\_item:nth-of-type(2)]:row-start-1 tw:[@media(max-height:750px)]:[&_.shorts-actions\_\_item:nth-of-type(3)]:col-start-1 tw:[@media(max-height:750px)]:[&_.shorts-actions\_\_item:nth-of-type(3)]:row-start-2 tw:[@media(max-height:750px)]:[&_.shorts-actions\_\_group:not(.shorts-actions\_\_group--bottom)>_.shorts-actions\_\_item]:col-start-1 tw:[@media(max-height:750px)]:[&_.shorts-actions\_\_group:not(.shorts-actions\_\_group--bottom)>_.shorts-actions\_\_item:first-child]:row-start-3 tw:[@media(max-height:750px)]:[&_.shorts-actions\_\_group:not(.shorts-actions\_\_group--bottom)>_.shorts-actions\_\_item:nth-child(2)]:row-start-4`;

const SHORTS_PAGE_NAVIGATION_BUTTON_CONTEXT_CLASS = String.raw`tw:[&_.shorts-page\_\_actions-button]:[transition:opacity_0.2s_ease-in-out,visibility_0.2s_ease-in-out] tw:[&_.shorts-page\_\_actions-button:disabled]:opacity-50 tw:[&_.shorts-page\_\_actions-button:disabled]:cursor-not-allowed tw:[&_.button-bubble]:rounded-[20px] tw:[&_.button-bubble]:border-none tw:[&_.button-bubble]:bg-transparent tw:[&_.button-bubble]:px-[10px] tw:[&_.button-bubble]:py-[12px] tw:[&_.button-bubble]:text-app-small tw:[&_.button-bubble]:font-medium tw:[&_.button-bubble]:text-white tw:[&_.button-bubble]:whitespace-nowrap tw:[&_.button-bubble]:cursor-pointer tw:[&_.button-bubble:hover]:!bg-[var(--color-odysee)] tw:[&_.button-bubble--active]:!bg-app-primary tw:[&_.button-bubble--active]:text-white`;

const SHORTS_PAGE_NAVIGATION_FULLSCREEN_CLASS = String.raw`tw:active-shorts-fullscreen:fixed tw:active-shorts-fullscreen:top-1/2 tw:active-shorts-fullscreen:!right-[24px] tw:active-shorts-fullscreen:bottom-auto tw:active-shorts-fullscreen:left-auto tw:active-shorts-fullscreen:z-[100] tw:active-shorts-fullscreen:flex tw:active-shorts-fullscreen:[transform:translateY(-50%)] tw:active-shorts-fullscreen:flex-col tw:active-shorts-fullscreen:items-center tw:active-shorts-fullscreen:gap-[8px] tw:active-shorts-fullscreen:p-0 tw:active-shorts-fullscreen:text-white tw:active-shorts-fullscreen:opacity-0 tw:active-shorts-fullscreen:pointer-events-none tw:active-shorts-fullscreen:[transition:opacity_300ms_ease-out_500ms,right_0.3s_cubic-bezier(0.4,0,0.2,1)] tw:active-player-fullscreen:!static tw:active-player-fullscreen:![transform:none] tw:active-player-fullscreen:!opacity-100 tw:active-player-fullscreen:!pointer-events-auto tw:[@media(pointer:coarse)]:active-player-fullscreen:hidden`;

const SHORTS_PAGE_NAVIGATION_FULLSCREEN_REVEAL_CLASS = String.raw`tw:active-shorts-fullscreen-revealed:opacity-100 tw:active-shorts-fullscreen-revealed:pointer-events-auto tw:active-shorts-fullscreen-revealed:[transition:opacity_100ms_ease-out,right_0.3s_cubic-bezier(0.4,0,0.2,1)]`;

const SHORTS_PAGE_NAVIGATION_FULLSCREEN_PANEL_CLASS = String.raw`tw:[.shorts-page\_\_container:fullscreen.shorts-page\_\_container--panel-open_&]:!right-[744px] tw:[.player-fullscreen-target:fullscreen.shorts-page\_\_container--panel-open_&]:!right-[744px] tw:[html.ios-fullscreen_.shorts-page\_\_container.shorts-page\_\_container--panel-open_&]:!right-[744px] tw:[html.ios-fullscreen_.player-fullscreen-target.shorts-page\_\_container--panel-open_&]:!right-[744px] tw:[.shorts-page\_\_container:fullscreen:has([data-shorts-side-panel-open])_&]:!right-[744px] tw:[.player-fullscreen-target:fullscreen:has([data-shorts-side-panel-open])_&]:!right-[744px] tw:[html.ios-fullscreen_.shorts-page\_\_container:has([data-shorts-side-panel-open])_&]:!right-[744px] tw:[html.ios-fullscreen_.player-fullscreen-target:has([data-shorts-side-panel-open])_&]:!right-[744px]`;

export const SHORTS_PAGE_NAVIGATION_CLASS = [
  SHORTS_PAGE_NAVIGATION_LAYOUT_CLASS,
  SHORTS_PAGE_NAVIGATION_PANEL_CLASS,
  SHORTS_PAGE_NAVIGATION_COMPACT_CLASS,
  SHORTS_PAGE_NAVIGATION_BUTTON_CONTEXT_CLASS,
  SHORTS_PAGE_NAVIGATION_FULLSCREEN_CLASS,
  SHORTS_PAGE_NAVIGATION_FULLSCREEN_REVEAL_CLASS,
  SHORTS_PAGE_NAVIGATION_FULLSCREEN_PANEL_CLASS,
].join(' ');

export const SHORTS_ACTION_CLASSES = {
  mobileDesktopNavigation:
    'shorts-page__navigation--mobile-desktop tw:top-[60px] tw:bottom-0 tw:mt-0 tw:h-auto tw:pb-[80px]',
  button: String.raw`shorts-page__actions-button tw:!flex tw:!size-[40px] tw:shrink-0 tw:cursor-pointer tw:!items-center tw:!justify-center tw:!rounded-[50%] tw:!bg-[rgba(45,44,44,0.895)] tw:!text-white tw:[transition:background-color_0.2s] tw:[&_.icon]:!text-white tw:[&:hover:not(.file-action-surface)]:!bg-[var(--color-odysee)] tw:disabled:cursor-not-allowed tw:disabled:opacity-30`,
  info: String.raw`shorts-page__actions-button--info tw:mb-auto tw:[@media(max-height:750px)]:col-start-2 tw:[@media(max-height:750px)]:row-start-1 tw:[@media(max-height:750px)]:mb-0 tw:[@media(max-height:750px)]:!mt-0 tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[.shorts-page\_\_container--panel-open_.shorts-page\_\_navigation_&]:mt-app-s`,
  previous: String.raw`shorts-page__actions-button--previous tw:!size-[60px] tw:[@media(max-height:750px)]:!size-[40px] tw:[@media(max-height:750px)]:col-start-2 tw:[@media(max-height:750px)]:row-start-2 tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[.shorts-page\_\_container--panel-open_&]:!size-[40px]`,
  next: String.raw`shorts-page__actions-button--next tw:!size-[60px] tw:[@media(max-height:750px)]:!size-[40px] tw:[@media(max-height:750px)]:col-start-2 tw:[@media(max-height:750px)]:row-start-3 tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[.shorts-page\_\_container--panel-open_&]:!size-[40px]`,
  group: 'shorts-actions__group tw:contents',
  groupBottom: String.raw`shorts-actions__group--bottom tw:[@media(max-height:750px)]:!flex tw:[@media(max-height:750px)]:col-start-1 tw:[@media(max-height:750px)]:row-start-5 tw:[@media(max-height:750px)]:flex-col tw:[@media(max-height:750px)]:items-center tw:[@media(max-height:750px)]:gap-[8px]`,
  item: String.raw`shorts-actions__item tw:relative tw:flex tw:flex-col tw:items-center tw:justify-center tw:overflow-visible tw:[&_p]:text-[0.7rem] tw:[@media(max-width:1020px)]:[&_p]:[text-shadow:1px_1px_2px_rgba(0,0,0,0.833)] tw:[@media(max-height:820px)]:[&_p]:hidden`,
  placeholder: 'shorts-actions__item--placeholder tw:invisible tw:h-[57px] tw:[@media(max-height:750px)]:h-[40px]',
  heartParticle:
    'shorts-heart-particle tw:pointer-events-none tw:absolute tw:z-[1] tw:text-app-primary tw:[animation:shorts-heart-float_2s_ease-out_forwards]',
  reactionCount: String.raw`tw:flex tw:flex-col tw:items-center tw:justify-center tw:text-app-text tw:[&_span]:text-[0.7rem] tw:[&_span]:leading-[1.8] tw:[&_.counter-inline]:text-[0.7rem] tw:[&_.counter-inline]:leading-[1.8] tw:[&_.counter-wrapper]:inline-flex tw:[@media(max-width:1020px)]:[&_span]:[text-shadow:1px_1px_2px_rgba(0,0,0,0.833)] tw:[@media(max-width:1020px)]:[&_.counter-inline]:[text-shadow:1px_1px_2px_rgba(0,0,0,0.833)] tw:[@media(max-height:750px)]:[&_span]:hidden tw:[@media(max-height:750px)]:[&_.counter-inline]:hidden`,
  fireCount: 'fire-and-count tw:[@media(max-height:750px)]:mb-[8px]',
  slimeCount: 'slime-and-count',
  ratings: String.raw`shorts-page__ratings tw:relative tw:my-[8px] tw:flex tw:w-[60px] tw:flex-col tw:items-center tw:rounded-[30px] tw:px-0 tw:py-[12px] tw:before:pointer-events-none tw:before:absolute tw:before:inset-0 tw:before:rounded-[30px] tw:before:[background:var(--ratings-gradient,linear-gradient(to_bottom,var(--color-fire)_35%,var(--color-slime)_65%))] tw:before:p-[2px] tw:before:content-[''] tw:before:[-webkit-mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] tw:before:[mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] tw:before:[-webkit-mask-composite:xor] tw:before:[mask-composite:exclude] tw:[&_.button]:relative tw:[&_.button]:overflow-visible tw:[&_.button_.button-surface\_\_label]:contents tw:[&_.button_.button\_\_fire-glow]:bottom-1/2 tw:[&_.button_.button\_\_fire-glow]:left-1/2 tw:[&_.button_:is([class^='button\_\_fire-particle'],[class^='button\_\_slime-drop'],.button\_\_slime-stain)]:top-1/2 tw:[&_.button_:is([class^='button\_\_fire-particle'],[class^='button\_\_slime-drop'],.button\_\_slime-stain)]:left-1/2 tw:[&_.button_:is(.button\_\_fire-particle1,.button\_\_fire-particle4)]:![animation-name:particleUpCenter1] tw:[&_.button_:is(.button\_\_fire-particle2,.button\_\_fire-particle5)]:![animation-name:particleUpCenter2] tw:[&_.button_:is(.button\_\_fire-particle3,.button\_\_fire-particle6)]:![animation-name:particleUpCenter3] tw:[@media(max-height:750px)]:col-start-2 tw:[@media(max-height:750px)]:row-start-5 tw:[@media(max-height:750px)]:m-0 tw:[@media(max-height:750px)]:w-auto tw:[@media(max-height:750px)]:p-0 tw:[@media(max-height:750px)]:before:hidden`,
  ratingsNoSlime: 'shorts-page__ratings--no-slime tw:before:bottom-auto tw:before:h-[calc(50%_+_6px)]',
} as const;

export const SWIPE_NAVIGATION_PANEL_OPEN_CLASS =
  'shorts__viewer--panel-open tw:![transform:translate(-130%,0%)] tw:[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] tw:[@media(max-width:1020px)]:![transform:none] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:!left-[20px] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:![transform:none] tw:large:![transform:translate(-130%,0%)] tw:xlarge:![transform:translate(-129%,0%)]';

export const SHORTS_PAGE_MENU_BUTTON_CLASS = String.raw`shorts-page-menu__button tw:absolute tw:top-[10px] tw:right-[10px] tw:z-[1000000] tw:flex tw:size-[48px] tw:items-center tw:justify-center tw:rounded-[100%] tw:bg-[rgba(0,0,0,0.2156862745)] tw:[rotate:90deg] tw:[&_.icon]:text-white`;

export const SHORTS_DOCUMENT_PLAYING_TARGET_CLASS =
  'tw:[[data-shorts-playing]_&]:!opacity-0 tw:[[data-shorts-playing]_&]:!pointer-events-none tw:[[data-shorts-playing]_&]:![transition-delay:0ms] tw:[[data-shorts-playing]_&]:![transition-duration:50ms]';

export const SHORTS_DOCUMENT_TRANSITION_COVER_CLASS = 'tw:[[data-shorts-transitioning]_&]:!invisible';

export const SHORTS_EFFECT_FIRE_STATE_CLASS =
  'tw:[&[data-shorts-fire-glow]]:![transition:none] tw:[&[data-shorts-fire-glow]]:[animation:shortsFireGlow_2s_ease-out_forwards]';

export const SHORTS_VIEWER_SLIME_STATE_CLASS =
  'tw:[&[data-shorts-slime-glow]::after]:[animation:shortsSlimeInset_3s_ease-out_forwards]';

export const SHORTS_COVER_SLIME_STATE_CLASS = String.raw`tw:[&[data-shorts-slime-glow]::after]:absolute tw:[&[data-shorts-slime-glow]::after]:inset-0 tw:[&[data-shorts-slime-glow]::after]:z-[1] tw:[&[data-shorts-slime-glow]::after]:rounded-[inherit] tw:[&[data-shorts-slime-glow]::after]:pointer-events-none tw:[&[data-shorts-slime-glow]::after]:content-[''] tw:[&[data-shorts-slime-glow]::after]:[animation:shortsSlimeInset_3s_ease-out_forwards]`;

export const SHORTS_EFFECT_CLASSES = {
  flames:
    'tw:pointer-events-none tw:absolute tw:right-0 tw:bottom-[-40px] tw:left-0 tw:z-10 tw:h-[calc(60%_+_40px)] tw:overflow-hidden tw:blur-[2px] tw:[animation:shortsFlamesContainer_2s_ease-out_forwards]',
  flameParticle:
    'tw:absolute tw:bottom-[-20px] tw:size-[70px] tw:rounded-[50%] tw:bg-[radial-gradient(rgb(255,80,0)_20%,rgba(255,80,0,0)_70%)] tw:opacity-0 tw:mix-blend-screen tw:[animation:shortsFlameRise_1s_ease-in_infinite]',
  slime:
    'tw:pointer-events-none tw:absolute tw:inset-0 tw:z-10 tw:rounded-[inherit] tw:bg-[radial-gradient(ellipse,rgba(129,197,84,0.75)_40%,transparent_70%),radial-gradient(ellipse,rgba(100,180,60,0.7)_40%,transparent_70%),radial-gradient(ellipse,rgba(129,197,84,0.65)_40%,transparent_70%),radial-gradient(ellipse,rgba(110,190,70,0.7)_40%,transparent_70%),radial-gradient(ellipse,rgba(129,197,84,0.6)_40%,transparent_70%),radial-gradient(ellipse,rgba(90,170,50,0.65)_40%,transparent_70%),radial-gradient(ellipse,rgba(120,190,75,0.7)_40%,transparent_70%),radial-gradient(ellipse,rgba(129,197,84,0.6)_40%,transparent_70%),radial-gradient(ellipse,rgba(95,175,55,0.7)_40%,transparent_70%),radial-gradient(ellipse,rgba(129,197,84,0.65)_40%,transparent_70%),radial-gradient(ellipse,rgba(110,185,65,0.6)_40%,transparent_70%),radial-gradient(ellipse,rgba(129,197,84,0.7)_40%,transparent_70%)] tw:[background-size:22px_35px,16px_50px,28px_30px,14px_55px,20px_40px,18px_48px,12px_42px,24px_32px,15px_52px,20px_36px,10px_45px,26px_28px] tw:bg-no-repeat tw:[animation:shortsSlimeDrip_3s_ease-in_forwards]',
} as const;

export const SHORTS_MOBILE_ACTIONS_CLASS =
  'shorts-mobile-panel__actions tw:fixed tw:right-[2px] tw:bottom-[2px] tw:z-[10001] tw:flex tw:flex-col tw:gap-[10px] tw:pt-[10px] tw:pointer-events-auto tw:[transition:opacity_300ms_ease-out] tw:[@media(max-width:768px)_and_(orientation:landscape)]:bottom-[5vh] tw:[@media(max-width:768px)_and_(orientation:landscape)]:gap-[6px] tw:[@media(min-width:1021px)]:hidden tw:[@media(pointer:fine)]:hidden';

export const SHORTS_MOBILE_ACTION_ITEM_CLASS =
  'shorts-mobile-panel__action-item tw:relative tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-[2px] tw:overflow-visible';

export const SHORTS_MOBILE_ACTION_BUTTON_CLASS = String.raw`shorts-mobile-panel__action-button tw:relative tw:flex tw:size-[40px] tw:min-h-[40px] tw:min-w-[40px] tw:cursor-pointer tw:items-center tw:justify-center tw:overflow-visible tw:rounded-[50%] tw:![border:none] tw:[background:oklch(25%_0_0deg/0.45)] tw:text-white tw:[box-shadow:none] tw:[transition:all_0.2s_ease-in-out] tw:[&_.button-surface\_\_label]:contents tw:[&_.button\_\_fire-glow]:bottom-1/2 tw:[&_.button\_\_fire-glow]:left-1/2 tw:[&_[class^='button\_\_fire-particle']]:bottom-1/2 tw:[&_[class^='button\_\_fire-particle']]:left-1/2 tw:[&_[class^='button\_\_slime']]:bottom-1/2 tw:[&_[class^='button\_\_slime']]:left-1/2 tw:[&_.icon]:text-white tw:[&_.icon]:stroke-white tw:[&.button-bubble--active]:!bg-app-primary tw:[@media(max-width:768px)_and_(orientation:landscape)]:!size-[45px] tw:[@media(max-width:768px)_and_(orientation:landscape)]:!min-h-[45px] tw:[@media(max-width:768px)_and_(orientation:landscape)]:!min-w-[45px] tw:motion-reduce:[animation-duration:0.15s] tw:motion-reduce:hover:[transform:none]`;

export const SHORTS_MOBILE_AVATAR_WRAPPER_CLASS = String.raw`shorts-mobile-panel__avatar-wrapper tw:relative tw:flex tw:cursor-pointer tw:flex-col tw:items-center tw:[&_.channel-thumbnail]:mr-0 tw:[&_.channel-thumbnail]:size-[40px] tw:[&_.channel-thumbnail]:min-h-[40px] tw:[&_.channel-thumbnail]:min-w-[40px] tw:[&_.channel-thumbnail]:overflow-hidden tw:[&_.channel-thumbnail]:rounded-[50%]`;

export const SHORTS_MOBILE_SUBSCRIBE_ICON_CLASS = String.raw`shorts-mobile-panel__subscribe-icon tw:absolute tw:bottom-[-4px] tw:left-1/2 tw:flex tw:[transform:translateX(-50%)] tw:items-center tw:justify-center tw:![border:none] tw:bg-none tw:p-0 tw:[&_.icon]:stroke-white tw:[&_.icon]:[filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))]`;

export const SHORTS_MOBILE_SUBSCRIBE_ICON_ACTIVE_CLASS = String.raw`shorts-mobile-panel__subscribe-icon--active tw:[&_.icon]:fill-[rgb(226,73,94)] tw:[&_.icon]:stroke-white`;

export const SHORTS_MOBILE_COUNT_CLASS =
  'shorts-mobile-panel__count tw:min-w-[30px] tw:text-center tw:text-[12px] tw:font-semibold tw:text-white tw:[text-shadow:1px_1px_2px_rgba(0,0,0,0.833)]';

export const SHORTS_MOBILE_FLAMES_CLASS =
  'shorts-mobile-flames tw:fixed tw:right-0 tw:bottom-[-40px] tw:left-0 tw:z-[10000] tw:h-[calc(60%_+_40px)] tw:overflow-hidden tw:pointer-events-none tw:blur-[2px] tw:[animation:shortsFlamesContainer_2s_ease-out_forwards]';

export const SHORTS_MOBILE_FLAME_PARTICLE_CLASS =
  'shorts-mobile-flames__particle tw:absolute tw:bottom-[-20px] tw:size-[70px] tw:rounded-[50%] tw:bg-[radial-gradient(rgb(255,80,0)_20%,rgba(255,80,0,0)_70%)] tw:opacity-0 tw:mix-blend-screen tw:[animation:shortsFlameRise_1s_ease-in_infinite]';

export const SHORTS_MOBILE_SLIME_CLASS =
  'shorts-mobile-slime tw:fixed tw:inset-0 tw:z-[10000] tw:pointer-events-none tw:bg-[radial-gradient(ellipse,rgba(129,197,84,0.75)_40%,transparent_70%),radial-gradient(ellipse,rgba(100,180,60,0.7)_40%,transparent_70%),radial-gradient(ellipse,rgba(129,197,84,0.65)_40%,transparent_70%),radial-gradient(ellipse,rgba(110,190,70,0.7)_40%,transparent_70%),radial-gradient(ellipse,rgba(129,197,84,0.6)_40%,transparent_70%),radial-gradient(ellipse,rgba(90,170,50,0.65)_40%,transparent_70%),radial-gradient(ellipse,rgba(120,190,75,0.7)_40%,transparent_70%),radial-gradient(ellipse,rgba(129,197,84,0.6)_40%,transparent_70%),radial-gradient(ellipse,rgba(95,175,55,0.7)_40%,transparent_70%),radial-gradient(ellipse,rgba(129,197,84,0.65)_40%,transparent_70%),radial-gradient(ellipse,rgba(110,185,65,0.6)_40%,transparent_70%),radial-gradient(ellipse,rgba(129,197,84,0.7)_40%,transparent_70%)] tw:[background-size:20px_20px,16px_16px,24px_24px,14px_14px,18px_18px,16px_16px,12px_12px,22px_22px,14px_14px,18px_18px,10px_10px,24px_24px] tw:[background-position:10%_-15px,30%_-80px,55%_-15px,75%_-120px,90%_-40px,45%_-100px,5%_-140px,65%_-20px,20%_-160px,82%_-50px,40%_-130px,95%_-15px] tw:bg-no-repeat tw:[animation:mobileSlimeDrip_3s_ease-in_forwards]';

export const SHORTS_MOBILE_SLIME_FILTER = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.03 0.06' numOctaves='4' seed='3'/%3E%3CfeDisplacementMap in='SourceGraphic' scale='25'/%3E%3C/filter%3E%3C/svg%3E#f")`;

export const SHORTS_FLOATING_ACTION_CLASSES = {
  item: String.raw`tw:flex tw:flex-col tw:items-center tw:gap-[2px] tw:[&_.button]:flex tw:[&_.button]:size-[39.59px] tw:[&_.button]:items-center tw:[&_.button]:justify-center tw:[&_.button]:rounded-[50%] tw:[&_.button]:border-none tw:[&_.button]:bg-[oklch(0%_0_0deg/0.4)] tw:[&_.button]:text-white tw:[&_.button:hover]:bg-[oklch(20%_0_0deg/0.6)] tw:[&_.button_.icon]:shrink-0 tw:[&_.button_.icon]:stroke-white tw:[&_.button.button-bubble--active]:!bg-[var(--color-primary)] tw:[&_.button_.button-surface\_\_label]:absolute`,
  avatarItem: 'tw:group/shorts-avatar tw:relative tw:cursor-pointer',
  avatar: 'tw:!mr-0 tw:!size-[39.59px] tw:!min-h-[39.59px] tw:!min-w-[39.59px] tw:overflow-hidden',
  avatarPage: 'tw:!size-[40px] tw:!min-h-[40px] tw:!min-w-[40px]',
  subscribe: String.raw`tw:absolute tw:bottom-[-4px] tw:left-1/2 tw:flex tw:cursor-pointer tw:items-center tw:justify-center tw:border-none tw:bg-none tw:p-0 tw:[transform:translateX(-50%)] tw:[&_.icon]:stroke-white tw:[&_.icon]:[filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))] tw:group-hover/shorts-avatar:[&_.icon]:fill-[rgb(226,73,94)] tw:[.shorts-actions\_\_item:hover_&_.icon]:fill-[rgb(226,73,94)]`,
  subscribeActive: 'tw:[&_.icon]:fill-[rgb(226,73,94)] tw:[&_.icon]:stroke-white',
  subscribePage: 'tw:!bottom-[-3px] tw:[&_.icon]:size-[14px]',
} as const;
