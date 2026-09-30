export const LIVESTREAM_STUDIO_CLASSES = {
  portalHost: 'tw:contents',
  root: 'tw:mt-app-s tw:flex tw:flex-col tw:gap-app-m',
  floating: 'tw:!hidden',
  disabled:
    'tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-app-m tw:rounded-app tw:border tw:border-[rgba(var(--color-header-button-base),0.3)] tw:bg-[rgba(var(--color-header-button-base),0.08)] tw:px-app-m tw:py-app-xl tw:text-center tw:text-app-text-subtitle',
  stageRow: 'tw:flex tw:items-start tw:justify-center tw:gap-app-m tw:upto-small:flex-col tw:upto-small:items-stretch',
  sourcesColumn:
    'tw:flex tw:min-w-0 tw:[flex:1_1_0] tw:flex-col tw:gap-app-m tw:upto-small:w-full tw:upto-small:[flex:none]',
  stageColumn:
    'tw:flex tw:w-3/4 tw:min-w-0 tw:self-start tw:flex-col tw:gap-app-m tw:upto-small:w-full tw:upto-small:[flex:none]',
  stage:
    'tw:flex tw:w-full tw:flex-col tw:overflow-clip tw:rounded-app tw:border-2 tw:border-[var(--color-header-button)] tw:bg-black tw:[transition:border-color_0.3s_ease]',
  stageLive: 'tw:!border-[rgba(var(--color-primary-dynamic),0.5)]',
  previewTabs:
    'tw:flex tw:gap-[2px] tw:overflow-x-auto tw:bg-[var(--color-header-button)] tw:px-[4px] tw:pt-[4px] tw:pb-0 tw:[scrollbar-width:none] tw:[&::-webkit-scrollbar]:hidden',
  previewTab:
    'tw:cursor-pointer tw:whitespace-nowrap tw:rounded-t-[6px] tw:![border:none] tw:bg-[var(--color-input-bg-secondary)] tw:px-app-s tw:py-app-xxs tw:text-app-xsmall tw:text-app-text',
  previewTabActive: 'tw:!bg-app-card tw:pointer-events-none',
  previewCanvas: 'tw:block tw:size-full',
  preview:
    'tw:relative tw:aspect-[16/9] tw:w-full tw:overflow-hidden tw:bg-[linear-gradient(135deg,#0a0a0a_0%,#1a1a2e_100%)] tw:[transition:aspect-ratio_0.3s_ease]',
  previewActive: 'tw:![background:#000]',
  previewPortrait: 'tw:mx-auto tw:max-h-[70vh] tw:!aspect-[9/16] tw:!w-auto',
  previewOverlay: 'tw:pointer-events-none tw:absolute tw:inset-0 tw:flex tw:flex-col tw:justify-between tw:p-app-s',
  overlayBottom:
    'tw:mt-auto tw:flex tw:items-center tw:justify-end tw:gap-app-xs tw:upto-small:ml-auto tw:upto-small:max-w-[70%] tw:upto-small:flex-wrap tw:upto-small:justify-end tw:upto-small:gap-y-app-xxs',
  pill: 'tw:inline-flex tw:h-[22px] tw:cursor-default tw:items-center tw:gap-[3px] tw:whitespace-nowrap tw:rounded-[4px] tw:bg-[rgba(0,0,0,0.5)] tw:px-[7px] tw:text-[11px] tw:font-semibold tw:text-[rgba(255,255,255,0.9)] tw:tabular-nums tw:[backdrop-filter:blur(8px)]',
  pillHw:
    'tw:ml-[2px] tw:inline-flex tw:h-[14px] tw:items-center tw:rounded-[3px] tw:bg-[rgba(255,255,255,0.12)] tw:px-[4px] tw:text-[9px] tw:font-bold tw:tracking-[0.03em] tw:text-[rgba(255,255,255,0.7)]',
  placeholder:
    'tw:absolute tw:inset-0 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-app-s tw:p-app-l tw:text-center',
  placeholderIcon: 'tw:text-[rgba(255,255,255,0.2)]',
  placeholderIconError: 'tw:!text-[rgba(255,100,100,0.4)]',
  placeholderText: 'tw:m-0 tw:max-w-[28rem] tw:text-app-small tw:leading-[1.5] tw:text-[rgba(255,255,255,0.4)]',
  placeholderError: 'tw:m-0 tw:max-w-[28rem] tw:text-app-small tw:leading-[1.5] tw:text-[rgba(255,100,100,0.7)]',
  allowCameraButton:
    'tw:cursor-pointer tw:rounded-[8px] tw:border tw:border-[rgba(255,255,255,0.2)] tw:bg-[rgba(255,255,255,0.1)] tw:px-[20px] tw:py-[8px] tw:text-app-small tw:font-semibold tw:text-[rgba(255,255,255,0.8)] tw:[backdrop-filter:blur(4px)] tw:[transition:all_0.15s_ease] tw:hover:bg-[rgba(255,255,255,0.18)] tw:hover:text-white tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
  taskbar:
    'tw:flex tw:items-center tw:gap-app-xs tw:[border-top:1px_solid_rgba(var(--color-header-button-base),0.12)] tw:bg-[var(--color-header-button)] tw:px-app-s tw:py-app-xs tw:upto-small:px-app-xs tw:upto-small:py-app-xxs',
  controlButton:
    'tw:flex tw:size-[40px] tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[50%] tw:![border:none] tw:bg-[rgba(var(--color-header-button-base),0.15)] tw:text-app-text tw:[transition:background_0.15s_ease,color_0.15s_ease] tw:hover:bg-[rgba(var(--color-header-button-base),0.25)] tw:disabled:cursor-not-allowed tw:disabled:opacity-40 tw:upto-small:size-[36px]',
  controlOn: 'tw:!bg-[#2eb868] tw:!text-white tw:hover:!bg-[#28a25c]',
  controlOff: 'tw:!bg-[#d33] tw:!text-white tw:hover:!bg-[#b82a2a]',
  controlP2p:
    'tw:[&&]:text-app-text-subtitle tw:hover:[&&]:bg-[rgba(var(--color-primary-dynamic),0.12)] tw:hover:[&&]:text-app-primary',
  controlP2pActive:
    'tw:[&&&]:bg-[rgba(var(--color-primary-dynamic),0.15)] tw:[&&&]:text-app-primary tw:[box-shadow:0_0_0_1px_rgba(var(--color-primary-dynamic),0.3)] tw:hover:[&&&]:bg-[rgba(var(--color-primary-dynamic),0.2)]',
  controlP2pPulse: 'tw:[animation:studio-p2p-bolt-glow_2s_ease-in-out_infinite]',
  taskbarSpacer: 'tw:flex-1',
  taskbarItem:
    'tw:flex tw:max-w-[120px] tw:cursor-pointer tw:items-center tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:rounded-[calc(var(--border-radius)/2)] tw:border tw:border-[rgba(var(--color-header-button-base),0.2)] tw:bg-[rgba(var(--color-header-button-base),0.1)] tw:px-app-xs tw:py-app-xxs tw:text-app-xsmall tw:text-app-text-subtitle tw:hover:bg-[rgba(var(--color-header-button-base),0.2)] tw:hover:text-app-text',
  taskbarItemActive: 'tw:!border-app-primary tw:!text-app-text',
  savedBox: 'tw:mt-app-m tw:w-full',
  savedGrid: 'tw:grid tw:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] tw:gap-app-s tw:p-app-xs',
  savedItem:
    'tw:relative tw:overflow-hidden tw:rounded-app tw:border tw:border-[rgba(var(--color-text-base),0.15)] tw:bg-app-card',
  savedThumb: 'tw:block tw:aspect-[16/9] tw:w-full tw:bg-black tw:object-cover',
  savedThumbEmpty: 'tw:!bg-black',
  savedName:
    'tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:px-app-xs tw:py-[4px] tw:text-app-xsmall tw:text-app-text',
  savedDelete:
    'tw:absolute tw:top-[4px] tw:right-[4px] tw:size-[18px] tw:cursor-pointer tw:rounded-[50%] tw:![border:none] tw:bg-[rgba(0,0,0,0.6)] tw:text-[14px] tw:leading-none tw:text-white',
  actionArea: 'tw:flex tw:w-full tw:flex-col tw:items-center tw:gap-app-s',
  saveCompositionButton:
    'tw:inline-flex tw:w-full tw:cursor-pointer tw:items-center tw:justify-center tw:gap-[8px] tw:whitespace-nowrap tw:rounded-app tw:![border:none] tw:bg-[var(--color-header-button)] tw:px-[18px] tw:py-[10px] tw:text-app-small tw:font-semibold tw:text-app-text tw:[transition:filter_0.15s_ease] tw:hover:[&:not(:disabled)]:brightness-[1.1] tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
  goLiveButton:
    'tw:h-[48px] tw:w-full tw:!rounded-[12px] tw:!text-app-body tw:!font-bold tw:tracking-[0.01em] tw:upto-small:sticky tw:upto-small:bottom-app-s tw:upto-small:z-[5] tw:upto-small:w-full',
  goLiveContent: 'tw:justify-center',
  stopButton: '',
  errorMessage:
    'tw:m-0 tw:max-w-[32rem] tw:rounded-app tw:border tw:border-[rgba(255,70,70,0.25)] tw:bg-[rgba(255,70,70,0.1)] tw:px-app-s tw:py-app-xs tw:text-center tw:text-app-small tw:text-app-text-error',
  hintMessage: 'tw:m-0 tw:text-center tw:text-app-small tw:text-app-text-subtitle',
  modalBackdrop: 'tw:fixed tw:inset-0 tw:z-[100] tw:flex tw:items-center tw:justify-center tw:bg-[rgba(0,0,0,0.5)]',
  modal: 'tw:flex tw:w-[360px] tw:max-w-[90vw] tw:flex-col tw:gap-app-s tw:rounded-app tw:bg-app-card tw:p-app-m',
  modalTitle: 'tw:m-0 tw:[font-size:var(--font-base)]',
  modalInput:
    'tw:rounded-app tw:border tw:border-[rgba(var(--color-text-base),0.25)] tw:bg-[var(--color-input-bg-secondary,var(--color-card-background))] tw:px-app-s tw:py-app-xs tw:text-app-small tw:text-app-text',
  modalActions: 'tw:flex tw:justify-end tw:gap-app-xs',
  modalButton: 'tw:cursor-pointer tw:rounded-app tw:![border:none] tw:px-app-m tw:py-app-xs tw:text-app-small',
  modalCancel: 'tw:bg-transparent tw:text-app-text',
  modalSave: 'tw:bg-app-primary tw:text-white',
  p2pBanner:
    'tw:flex tw:items-center tw:gap-app-s tw:rounded-[8px] tw:border tw:border-[rgba(var(--color-primary-dynamic),0.15)] tw:bg-[rgba(var(--color-primary-dynamic),0.04)] tw:px-app-s tw:py-app-xs tw:[animation:studio-settings-in_0.3s_ease]',
  p2pBannerIcon:
    'tw:flex tw:size-[32px] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-[8px] tw:bg-[rgba(var(--color-primary-dynamic),0.1)] tw:text-app-primary',
  p2pBannerText: 'tw:min-w-0 tw:flex-1',
  p2pBannerTitle: 'tw:block tw:text-app-small tw:leading-[1.3] tw:font-semibold tw:text-app-text',
  p2pBannerSub: 'tw:mt-[1px] tw:block tw:text-[11px] tw:leading-[1.4] tw:text-app-text-subtitle',
  p2pBannerButton:
    'tw:shrink-0 tw:cursor-pointer tw:rounded-[6px] tw:![border:none] tw:bg-app-primary tw:px-[14px] tw:py-[6px] tw:text-[12px] tw:font-semibold tw:text-white tw:[transition:filter_0.15s_ease] tw:hover:brightness-[1.1]',
  claimSection: 'tw:flex tw:flex-col tw:gap-app-xs',
  claimHeader: 'tw:flex tw:items-center tw:justify-between',
  claimLabel:
    'tw:inline-flex tw:items-center tw:gap-[6px] tw:text-app-xsmall tw:font-semibold tw:tracking-[0.06em] tw:text-app-text-subtitle tw:uppercase',
  claimLiveBadge:
    'tw:inline-flex tw:h-[18px] tw:items-center tw:rounded-[4px] tw:bg-app-primary tw:px-[6px] tw:text-[10px] tw:font-bold tw:tracking-[0.04em] tw:text-white tw:[animation:studio-pulse_2s_ease-in-out_infinite]',
  noClaim:
    'tw:flex tw:items-center tw:gap-app-xs tw:rounded-app tw:border tw:border-dashed tw:border-[rgba(var(--color-header-button-base),0.18)] tw:px-app-m tw:py-app-s tw:[&_p]:m-0 tw:[&_p]:text-app-small tw:[&_p]:text-app-text-subtitle',
  p2pConfirm:
    'tw:fixed tw:inset-0 tw:z-[100002] tw:flex tw:items-center tw:justify-center tw:bg-[rgba(0,0,0,0.5)] tw:[animation:studio-settings-in_0.2s_ease]',
  p2pConfirmCard:
    'tw:max-w-[360px] tw:rounded-[12px] tw:border tw:border-[rgba(var(--color-header-button-base),0.15)] tw:bg-app-background tw:p-app-l tw:text-center tw:[box-shadow:0_8px_32px_rgba(0,0,0,0.3)] tw:[&_svg]:mb-app-s tw:[&_svg]:text-app-primary tw:[&_h4]:mt-0 tw:[&_h4]:mr-0 tw:[&_h4]:mb-app-xs tw:[&_h4]:ml-0 tw:[&_h4]:text-app-body tw:[&_h4]:font-bold tw:[&_h4]:text-app-text tw:[&_p]:mt-0 tw:[&_p]:mr-0 tw:[&_p]:mb-app-m tw:[&_p]:ml-0 tw:[&_p]:text-app-small tw:[&_p]:leading-[1.5] tw:[&_p]:text-app-text-subtitle',
  p2pConfirmActions: 'tw:flex tw:justify-center tw:gap-app-xs',
  p2pConfirmButton:
    'tw:cursor-pointer tw:rounded-[8px] tw:px-[16px] tw:py-[8px] tw:text-app-small tw:font-semibold tw:[transition:all_0.15s_ease]',
  p2pConfirmPrimary: 'tw:![border:none] tw:bg-app-primary tw:text-white tw:hover:brightness-[1.1]',
  p2pConfirmOutline:
    'tw:border tw:border-app-primary tw:bg-transparent tw:text-app-primary tw:hover:bg-[rgba(var(--color-primary-dynamic),0.08)]',
  p2pConfirmSecondary:
    'tw:border tw:border-[rgba(var(--color-header-button-base),0.15)] tw:bg-[rgba(var(--color-header-button-base),0.06)] tw:text-app-text-subtitle tw:hover:bg-[rgba(var(--color-header-button-base),0.12)] tw:hover:text-app-text',
} as const;
