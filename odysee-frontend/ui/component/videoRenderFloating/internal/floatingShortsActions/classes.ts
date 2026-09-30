const FLOATING_SHORTS_REVEAL_CLASS =
  'tw:opacity-0 tw:[transition:opacity_0.1s_ease_0.5s] tw:[[data-floating-shorts-player]:hover_&]:opacity-100 tw:[[data-floating-shorts-player]:hover_&]:[transition-delay:0s] tw:[[data-floating-shorts-paused]_&]:opacity-100 tw:[[data-floating-shorts-paused]_&]:[transition-delay:0s] tw:[[data-floating-shorts-player]:has([data-paused])_&]:opacity-100 tw:[[data-floating-shorts-player]:has([data-paused])_&]:[transition-delay:0s] tw:[.player-fullscreen-target:fullscreen_&]:!hidden tw:[html.ios-fullscreen_.player-fullscreen-target_&]:!hidden';

export const FLOATING_SHORTS_ACTIONS_CLASSES = {
  nav: `${FLOATING_SHORTS_REVEAL_CLASS} tw:absolute tw:top-[calc(2.8rem+4px)] tw:right-[calc(0.0625rem+0.5px)] tw:z-[3] tw:flex tw:flex-col tw:items-center tw:gap-app-xxs tw:p-app-xxs tw:[&_.button]:!size-[39.59px] tw:[&_.button]:!rounded-[50%] tw:[&_.button]:!border-none tw:[&_.button]:!bg-[oklch(0%_0_0deg/0.4)] tw:[&_.button:hover]:!bg-[oklch(20%_0_0deg/0.6)] tw:[@media(max-width:900px)]:hidden`,
  actions: `${FLOATING_SHORTS_REVEAL_CLASS} tw:absolute tw:right-[calc(0.0625rem+0.5px)] tw:bottom-[calc(3.8rem+3px)] tw:z-[2] tw:flex tw:flex-col tw:items-center tw:gap-app-xxs tw:p-app-xxs tw:[@media(max-width:900px)]:hidden`,
} as const;
