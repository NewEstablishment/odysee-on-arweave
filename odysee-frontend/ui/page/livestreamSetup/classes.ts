import { HELP_CLASS, HELP_NOTICE_CLASS } from '../../component/common/help-classes.ts';

export const LIVESTREAM_SETUP_CLASSES = {
  claimHint: `${HELP_CLASS} ${HELP_NOTICE_CLASS} ${String.raw`livestream-setup__claim-hint tw:absolute tw:top-[calc(100%+8px)] tw:right-0 tw:z-[2] tw:!m-0 tw:whitespace-nowrap tw:rounded-app tw:border tw:!border-app-primary tw:bg-app-card-highlighted tw:!px-app-m tw:!py-app-s tw:!text-app-small tw:text-app-text tw:before:absolute tw:before:right-[calc(var(--claim-hint-arrow-right,18px)-8px)] tw:before:bottom-full tw:before:size-0 tw:before:[border-right:8px_solid_transparent] tw:before:[border-bottom:8px_solid_var(--color-primary)] tw:before:[border-left:8px_solid_transparent] tw:before:content-[''] tw:after:absolute tw:after:right-[calc(var(--claim-hint-arrow-right,18px)-8px)] tw:after:bottom-full tw:after:mb-[-1px] tw:after:size-0 tw:after:[border-right:8px_solid_transparent] tw:after:[border-bottom:8px_solid_var(--color-card-background-highlighted)] tw:after:[border-left:8px_solid_transparent] tw:after:content-['']`}`,
  createButton:
    'tw:inline-flex tw:shrink-0 tw:cursor-pointer tw:items-center tw:gap-[8px] tw:whitespace-nowrap tw:rounded-[8px] tw:[border:none] tw:bg-app-primary tw:px-[18px] tw:py-[10px] tw:text-app-small tw:font-semibold tw:text-white tw:[transition:filter_0.15s_ease] tw:[&:hover:not(:disabled)]:brightness-110 tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
  createButtonSecondary: 'tw:!bg-[var(--color-header-button)] tw:!text-app-text',
  disabledCard: 'tw:mt-app-s',
  header:
    'tw:mb-app-m tw:flex tw:items-start tw:justify-between tw:gap-app-m tw:upto-small:flex-col tw:upto-small:items-stretch',
  headerActions: 'tw:relative tw:flex tw:shrink-0 tw:items-center tw:justify-end tw:gap-app-s',
  heading: 'tw:min-w-0',
  keyCard:
    'tw:rounded-[12px] tw:border tw:border-[rgba(var(--color-header-button-base),0.35)] tw:bg-[rgba(var(--color-header-button-base),0.08)] tw:px-app-m tw:py-app-s tw:[background-image:linear-gradient(135deg,rgba(var(--color-primary-dynamic),0.05),transparent_60%),none] tw:[transition:opacity_0.2s_ease] tw:upto-small:p-app-m',
  keyCardDisabled: 'tw:pointer-events-none tw:opacity-50',
  keyFields: 'tw:flex tw:flex-col tw:gap-app-s',
  keyHeader: 'tw:mb-app-m',
  keySubtitle: 'tw:m-0 tw:text-app-small tw:text-app-text-subtitle',
  keyTitle: 'tw:mt-0 tw:mr-0 tw:mb-app-xxs tw:ml-0 tw:text-app-body tw:font-bold tw:text-app-text',
  noClaims:
    'tw:flex tw:flex-col tw:items-center tw:gap-app-m tw:rounded-app tw:border tw:border-dashed tw:border-[rgba(var(--color-header-button-base),0.4)] tw:bg-[rgba(var(--color-header-button-base),0.06)] tw:px-app-m tw:py-app-xl tw:text-center',
  noClaimsActions: 'tw:flex tw:gap-app-s',
  noClaimsCopy: 'tw:m-0 tw:text-app-small tw:text-app-text-subtitle',
  optionGroup: 'tw:flex tw:items-center tw:gap-app-xs tw:upto-small:w-full tw:upto-small:justify-between',
  optionLabel:
    'tw:whitespace-nowrap tw:text-app-xsmall tw:font-bold tw:tracking-[0.05em] tw:text-app-text-subtitle tw:uppercase',
  preview:
    'tw:mt-app-s tw:flex tw:items-stretch tw:justify-center tw:gap-app-m tw:upto-small:flex-col tw:upto-small:items-stretch',
  previewChat: String.raw`livestream-setup__preview-chat-wrap tw:relative tw:min-w-0 tw:flex-[1_1_0] tw:self-stretch tw:[&_>*]:absolute tw:[&_>*]:!m-0 tw:[&_>*]:!size-full tw:[&_>*]:!min-w-0 tw:[&_>*]:inset-0 tw:upto-small:min-h-[50vh]`,
  previewChatDisabled: 'tw:pointer-events-none tw:opacity-50',
  previewOffair:
    'tw:pointer-events-none tw:absolute tw:top-1/2 tw:left-1/2 tw:inline-flex tw:items-center tw:gap-[14px] tw:rounded-[10px] tw:bg-[rgba(0,0,0,0.65)] tw:px-[32px] tw:py-[16px] tw:text-[2.5rem] tw:font-extrabold tw:tracking-[0.18em] tw:text-white tw:uppercase tw:[transform:translate(-50%,-50%)] tw:upto-small:gap-[10px] tw:upto-small:px-[18px] tw:upto-small:py-[10px] tw:upto-small:text-[1.25rem] tw:upto-small:tracking-[0.12em]',
  previewOffairDot: 'tw:inline-block tw:size-[18px] tw:rounded-[50%] tw:bg-[#888] tw:upto-small:size-[12px]',
  previewPlaceholder: 'tw:absolute tw:inset-0 tw:bg-black',
  previewVideo:
    'tw:relative tw:w-3/4 tw:self-start tw:overflow-hidden tw:rounded-[12px] tw:bg-black tw:aspect-video tw:upto-small:w-full',
  qualityPill:
    'tw:cursor-pointer tw:rounded-[6px] tw:[border:none] tw:bg-transparent tw:px-[14px] tw:py-[5px] tw:text-app-small tw:font-semibold tw:text-app-text-subtitle tw:[transition:all_0.15s_ease] tw:[&:hover:not(:disabled)]:bg-[rgba(var(--color-header-button-base),0.2)] tw:[&:hover:not(:disabled)]:text-app-text tw:disabled:cursor-not-allowed tw:disabled:opacity-[0.45]',
  qualityPillActive:
    'tw:!bg-app-background tw:!text-app-text tw:[box-shadow:0_1px_3px_rgba(0,0,0,0.1)] tw:[&:hover:not(:disabled)]:!bg-app-background',
  qualityPills:
    'tw:flex tw:gap-[2px] tw:rounded-[8px] tw:border tw:border-[rgba(var(--color-header-button-base),0.1)] tw:bg-[rgba(var(--color-header-button-base),0.12)] tw:p-[3px]',
  rtmp: 'tw:mt-app-s tw:flex tw:flex-col tw:gap-app-m',
  streamOptions: 'tw:flex tw:flex-wrap tw:items-center tw:gap-app-s tw:upto-small:justify-between',
  subtitle: 'tw:m-0 tw:max-w-[36rem] tw:text-app-small tw:leading-[1.5] tw:text-app-text-subtitle',
  tab: 'tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-[6px] tw:whitespace-nowrap tw:rounded-[8px] tw:[border:none] tw:bg-transparent tw:px-[16px] tw:py-[8px] tw:text-app-small tw:font-semibold tw:text-app-text-subtitle tw:[transition:all_0.15s_ease] tw:[&:hover:not(:disabled)]:bg-[rgba(var(--color-header-button-base),0.25)] tw:[&:hover:not(:disabled)]:text-app-text tw:disabled:cursor-not-allowed tw:disabled:opacity-40 tw:upto-small:flex-1 tw:upto-small:justify-center tw:upto-small:px-[12px] tw:upto-small:text-[13px]',
  tabActive:
    'tw:!bg-app-background tw:!text-app-text tw:[box-shadow:0_1px_3px_rgba(0,0,0,0.1)] tw:[&:hover:not(:disabled)]:!bg-app-background',
  tabs: 'tw:inline-flex tw:gap-[2px] tw:rounded-[10px] tw:border tw:border-[rgba(var(--color-header-button-base),0.12)] tw:bg-[var(--color-header-button)] tw:p-[4px] tw:upto-small:flex tw:upto-small:w-full tw:upto-small:overflow-x-auto tw:upto-small:[-webkit-overflow-scrolling:touch]',
  tips: 'tw:overflow-hidden tw:rounded-app tw:border tw:border-[rgba(var(--color-header-button-base),0.25)]',
  tipsBody:
    'tw:pt-0 tw:pr-app-m tw:pb-app-m tw:pl-app-m tw:[border-top:1px_solid_rgba(var(--color-header-button-base),0.2)] tw:[&_ul]:my-app-s tw:[&_ul]:pl-app-m tw:[&_ul_li]:text-app-small tw:[&_ul_li]:leading-[1.6] tw:[&_ul_li]:text-app-text',
  tipsNote: 'tw:m-0 tw:text-app-xsmall tw:text-app-text-subtitle',
  tipsSummary:
    'tw:cursor-pointer tw:px-app-m tw:py-app-s tw:text-app-small tw:font-semibold tw:text-app-text-subtitle tw:select-none tw:[list-style:none] tw:[&::-webkit-details-marker]:hidden tw:hover:text-app-text',
  toolbar:
    'tw:mb-app-m tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-app-m tw:upto-small:flex-col tw:upto-small:items-stretch',
} as const;

export const PUBLISH_LIVESTREAM_HEADER_CLASS = String.raw`publish-livestream-header tw:[&_[data-channel-selector]_button_[data-channel-selector-item]]:bg-[var(--color-header-button)] tw:[&_[data-channel-selector]_button:hover_[data-channel-selector-item]]:bg-app-primary tw:[&_[data-channel-selector]_button[aria-expanded=true]_[data-channel-selector-item]]:bg-app-primary tw:[&_.card\_\_main-actions]:pt-0 tw:[&_.card\_\_main-actions_div]:inline-block tw:[&_.card\_\_main-actions_.button-surface--secondary]:float-right tw:upto-medium:[&_.card\_\_main-actions]:mt-0 tw:upto-medium:[&_.card\_\_main-actions_.button-surface--secondary]:top-0 tw:upto-medium:[&_.card\_\_main-actions_.button-surface--secondary]:px-app-xs tw:upto-medium:[&_.card\_\_main-actions_.button-surface--secondary]:py-0 tw:upto-medium:[&_.card\_\_main-actions_.button-surface--secondary_.button-surface\_\_label]:hidden`;
