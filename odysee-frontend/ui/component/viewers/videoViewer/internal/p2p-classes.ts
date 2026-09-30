export const P2P_CLASSES = {
  control: 'tw:inline-flex tw:items-center tw:gap-[0.25rem] tw:align-middle',
  controlCompact: 'tw:!gap-[0.3rem]',
  button: 'media-button media-button--icon tw:relative',
  buttonEnabled:
    'tw:rounded-[50%] tw:!bg-[rgba(var(--color-primary-dynamic),0.15)] tw:!text-app-primary tw:[animation:p2p-bolt-glow_2.5s_ease-in-out_infinite]',
  buttonActive: 'tw:[box-shadow:0_0_0_1px_rgba(var(--color-primary-dynamic),0.18)]',
  indicator:
    'tw:inline-flex tw:h-[1.75rem] tw:min-w-0 tw:items-center tw:gap-[0.35rem] tw:rounded-[999px] tw:[border:1px_solid_rgba(255,255,255,0.14)] tw:bg-[rgba(15,15,18,0.66)] tw:pt-0 tw:pr-[0.5rem] tw:pb-0 tw:pl-[0.4rem] tw:text-[0.65rem] tw:leading-none tw:font-bold tw:tracking-[0.01em] tw:text-[rgba(255,255,255,0.94)] tw:[backdrop-filter:blur(10px)] tw:[transition:background-color_0.3s_ease,border-color_0.3s_ease,color_0.3s_ease,opacity_0.3s_ease]',
  indicatorPeered:
    'tw:![border-color:rgba(var(--color-primary-dynamic),0.32)] tw:!bg-[rgba(var(--color-primary-dynamic),0.1)]',
  indicatorActive:
    'tw:![border-color:rgba(var(--color-primary-dynamic),0.44)] tw:!bg-[rgba(var(--color-primary-dynamic),0.15)] tw:!text-white',
  indicatorCompact: 'tw:!h-[1.7rem] tw:!gap-[0.28rem] tw:!px-[0.45rem] tw:!py-0',
  dot: 'tw:size-[0.45rem] tw:flex-[0_0_auto] tw:rounded-[999px] tw:bg-[rgba(255,255,255,0.38)]',
  dotActive:
    'tw:!bg-app-primary tw:[box-shadow:0_0_0_0_rgba(var(--color-primary-dynamic),0.38)] tw:[animation:p2p-indicator-pulse_1.8s_ease-in-out_infinite]',
  label: 'tw:inline-flex tw:items-center tw:leading-none tw:whitespace-nowrap',
  labelCompact: 'tw:min-w-[0.5rem] tw:text-center',
  traffic: 'tw:inline-flex tw:items-center tw:gap-[0.18rem] tw:text-inherit',
  arrow: 'tw:flex-[0_0_auto] tw:opacity-70 tw:[transition:opacity_0.2s_ease]',
  arrowActive: 'tw:!opacity-100 tw:[animation:p2p-arrow-bounce_1s_ease-in-out_infinite]',
  speed:
    'tw:ml-[0.15rem] tw:inline-flex tw:min-w-[2.8rem] tw:items-center tw:[border-left:1px_solid_rgba(255,255,255,0.12)] tw:pl-[0.2rem] tw:text-[0.63rem] tw:leading-none tw:font-bold tw:tracking-[0.01em] tw:text-[rgba(255,255,255,0.92)] tw:[font-variant-numeric:tabular-nums] tw:[transition:opacity_0.5s_ease]',
  speedCompact: 'tw:!hidden',
} as const;
