export const LIVESTREAM_PUBLISHER_FLOATING_CLASSES = {
  root: 'tw:group/floating tw:fixed tw:right-app-l tw:bottom-app-l tw:z-[100000] tw:w-[var(--floating-viewer-width)] tw:cursor-grab tw:overflow-hidden tw:rounded-[12px] tw:border-2 tw:border-[rgba(var(--color-header-button-base),0.5)] tw:bg-black tw:select-none tw:[animation:livestream-floating-in_0.3s_cubic-bezier(0.16,1,0.3,1)] tw:[transition:border-color_0.3s_ease] tw:[touch-action:none] tw:active:cursor-grabbing tw:upto-small:right-app-m tw:upto-small:bottom-app-m tw:upto-small:w-[220px] tw:upto-small:rounded-[8px]',
  rootLive: 'tw:!border-[rgba(var(--color-primary-dynamic),0.6)]',
  inner: 'tw:relative tw:aspect-[16/9]',
  video: 'tw:pointer-events-none tw:block tw:size-full tw:object-cover',
  overlay:
    'tw:pointer-events-none tw:absolute tw:inset-0 tw:flex tw:flex-col tw:justify-between tw:bg-[linear-gradient(180deg,rgba(0,0,0,0.4)_0%,transparent_30%,transparent_70%,rgba(0,0,0,0.35)_100%)] tw:p-app-xs',
  bar: 'tw:flex tw:items-center tw:gap-app-xxs',
  bottomBar: 'tw:justify-end',
  meta: 'tw:inline-flex tw:h-[22px] tw:items-center tw:rounded-[4px] tw:bg-[rgba(0,0,0,0.45)] tw:px-[6px] tw:py-0 tw:text-[11px] tw:font-semibold tw:text-[rgba(255,255,255,0.85)] tw:backdrop-blur-[8px]',
  close:
    'tw:absolute tw:top-[8px] tw:right-[8px] tw:z-[3] tw:flex tw:size-[2.25rem] tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[50%] tw:![border:none] tw:bg-[rgba(var(--color-primary-dynamic),0.95)] tw:p-0 tw:text-white tw:opacity-0 tw:[transition:opacity_300ms_ease-out_500ms] tw:[&_svg]:size-[16px] tw:[&_svg]:stroke-white tw:group-hover/floating:opacity-100 tw:group-hover/floating:[transition:opacity_150ms_ease-out] tw:hover:bg-[rgba(var(--color-primary-dynamic),1)]',
  infoActions: 'tw:flex tw:shrink-0 tw:items-center tw:gap-[6px]',
  controlButton:
    'tw:flex tw:size-[28px] tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[50%] tw:![border:none] tw:bg-[rgba(255,255,255,0.15)] tw:text-white tw:backdrop-blur-[4px] tw:[transition:background_0.15s_ease] tw:hover:bg-[rgba(255,255,255,0.3)] tw:disabled:cursor-not-allowed tw:disabled:opacity-40 tw:upto-small:size-[32px]',
  controlStop:
    'tw:!w-auto tw:min-w-[96px] tw:gap-[6px] tw:!rounded-app tw:!bg-[#d8324a] tw:px-[12px] tw:py-0 tw:hover:!bg-[#d8324a] tw:hover:brightness-110',
  controlPrimary:
    'tw:!w-auto tw:min-w-[96px] tw:gap-[6px] tw:!rounded-app tw:!bg-app-primary tw:px-[12px] tw:py-0 tw:not-disabled:hover:!bg-app-primary tw:not-disabled:hover:brightness-110 tw:upto-small:min-w-[88px]',
  controlWide: 'tw:gap-[6px]',
  controlLabel: 'tw:text-[12px] tw:font-bold tw:tracking-[0.02em]',
  infoBar:
    'tw:flex tw:items-center tw:gap-[8px] tw:[border-top:1px_solid_rgba(255,255,255,0.12)] tw:bg-[rgba(var(--color-header-button-base),0.12)] tw:px-app-xxs tw:py-app-s',
  infoTitle:
    'tw:m-0 tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:![border:none] tw:bg-none tw:p-0 tw:text-left tw:text-app-body tw:leading-[1.3] tw:font-semibold tw:text-white tw:hover:text-app-primary tw:disabled:cursor-default tw:disabled:text-app-text-subtitle',
  pill: 'tw:fixed tw:right-app-l tw:bottom-app-l tw:z-[100000] tw:flex tw:items-center tw:gap-[6px] tw:rounded-[999px] tw:border tw:border-[rgba(255,255,255,0.12)] tw:bg-[rgba(0,0,0,0.8)] tw:px-[8px] tw:py-[6px] tw:backdrop-blur-[12px] tw:[animation:livestream-floating-in_0.3s_cubic-bezier(0.16,1,0.3,1)] tw:[box-shadow:0_4px_16px_rgba(0,0,0,0.3)] tw:upto-small:right-app-m tw:upto-small:bottom-app-m tw:upto-small:max-w-[calc(100vw-var(--spacing-m)*2)]',
  pillBadge:
    'tw:inline-flex tw:h-[28px] tw:items-center tw:gap-[5px] tw:rounded-[999px] tw:bg-[rgba(255,255,255,0.15)] tw:px-[10px] tw:py-0 tw:text-[12px] tw:font-bold tw:tracking-[0.04em] tw:text-white tw:uppercase',
  pillBadgeLive: 'tw:!bg-app-primary',
  pillDot:
    'tw:size-[6px] tw:rounded-[50%] tw:bg-white tw:[animation:livestream-floating-pulse_1.5s_ease-in-out_infinite]',
  pillButton:
    'tw:flex tw:size-[32px] tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[50%] tw:![border:none] tw:bg-[rgba(255,255,255,0.1)] tw:text-white tw:[transition:background_0.15s_ease] tw:hover:bg-[rgba(255,255,255,0.25)]',
  pillButtonStop: 'tw:!bg-[rgba(255,70,70,0.4)] tw:hover:!bg-[rgba(255,70,70,0.65)]',
  pillButtonClose: 'tw:!bg-[rgba(255,255,255,0.15)] tw:hover:!bg-[rgba(255,255,255,0.3)]',
  pillButtonGoLive:
    'tw:!h-[32px] tw:!w-auto tw:gap-[6px] tw:!rounded-app tw:!bg-app-primary tw:px-[12px] tw:py-0 tw:text-[12px] tw:font-bold tw:not-disabled:hover:!bg-app-primary tw:not-disabled:hover:brightness-110 tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
  pillMeta:
    'tw:inline-flex tw:h-[22px] tw:items-center tw:gap-[3px] tw:whitespace-nowrap tw:rounded-[999px] tw:bg-[rgba(255,255,255,0.08)] tw:px-[6px] tw:py-0 tw:text-[10px] tw:leading-none tw:font-semibold tw:text-[rgba(255,255,255,0.88)] tw:[font-variant-numeric:tabular-nums]',
  confirm:
    'tw:fixed tw:inset-0 tw:z-[100001] tw:flex tw:items-center tw:justify-center tw:bg-[rgba(0,0,0,0.5)] tw:[animation:livestream-floating-in_0.15s_ease]',
  confirmCard:
    'tw:max-w-[280px] tw:rounded-[12px] tw:border tw:border-[rgba(var(--color-header-button-base),0.15)] tw:bg-app-background tw:p-app-m tw:text-center tw:[box-shadow:0_8px_32px_rgba(0,0,0,0.3)]',
  confirmText:
    'tw:mt-0 tw:mr-0 tw:mb-app-m tw:ml-0 tw:text-app-small tw:leading-[1.4] tw:font-semibold tw:text-app-text',
  confirmActions: 'tw:flex tw:justify-center tw:gap-app-xs',
  confirmButton:
    'tw:cursor-pointer tw:rounded-[8px] tw:px-[16px] tw:py-[8px] tw:text-app-small tw:font-semibold tw:[transition:all_0.15s_ease]',
  confirmCancel:
    'tw:border tw:border-[rgba(var(--color-header-button-base),0.15)] tw:bg-[rgba(var(--color-header-button-base),0.06)] tw:text-app-text-subtitle tw:hover:bg-[rgba(var(--color-header-button-base),0.12)] tw:hover:text-app-text',
  confirmStop: 'tw:![border:none] tw:bg-[rgba(255,70,70,0.9)] tw:text-white tw:hover:bg-[rgb(255,70,70)]',
} as const;
