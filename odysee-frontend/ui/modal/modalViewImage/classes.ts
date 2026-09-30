export const MODAL_VIEW_IMAGE_CLASSES = {
  actionButton: 'tw:text-white tw:opacity-92 tw:hover:opacity-100 tw:focus-visible:opacity-100',
  actions: 'tw:flex tw:items-center tw:gap-app-xs',
  chrome:
    'tw:flex tw:flex-[0_0_auto] tw:items-center tw:justify-between tw:gap-app-s tw:pt-app-s tw:pr-app-s tw:pb-0 tw:pl-app-m',
  close: 'tw:flex-[0_0_auto]',
  image:
    'tw:h-auto tw:max-h-full tw:w-auto tw:max-w-full tw:cursor-zoom-in tw:rounded-[calc(var(--border-radius)-2px)] tw:object-contain tw:[box-shadow:0_24px_60px_rgba(0,0,0,0.35)]',
  imageZoomed: 'tw:[&]:w-[150%] tw:[&]:max-w-none tw:[&]:max-h-none tw:[&]:cursor-zoom-out tw:[&]:[object-fit:initial]',
  root: String.raw`tw:flex tw:h-[min(92vh,980px)] tw:!max-h-[min(92vh,980px)] tw:w-[min(96vw,1280px)] tw:min-w-[min(96vw,1280px)] tw:!max-w-[min(96vw,1280px)] tw:flex-col tw:gap-0 tw:overflow-hidden tw:border-2 tw:border-[rgba(255,255,255,0.16)] tw:![background:rgba(8,10,15,0.96)] tw:!p-0 tw:min-[901px]:[&_.button-close-surface]:!mt-0 tw:upto-small:h-full tw:upto-small:!max-h-full tw:upto-small:w-full tw:upto-small:min-w-[auto] tw:upto-small:!max-w-full tw:upto-small:!border-0`,
  title: 'tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-large tw:leading-[1.3] tw:text-white',
  viewport:
    'tw:flex tw:min-h-0 tw:flex-[1_1_auto] tw:items-center tw:justify-center tw:overflow-auto tw:pt-app-s tw:pr-app-m tw:pb-app-m tw:pl-app-m tw:upto-small:p-app-s',
  viewportZoomed: 'tw:[&]:items-start tw:[&]:justify-start',
} as const;
