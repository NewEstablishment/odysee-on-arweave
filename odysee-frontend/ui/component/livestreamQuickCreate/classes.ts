export const LIVESTREAM_QUICK_CREATE_CLASSES = {
  root: 'tw:flex tw:justify-center tw:px-0 tw:py-app-s tw:upto-small:p-0',
  card: 'tw:w-full tw:max-w-[540px] tw:rounded-[14px] tw:border tw:border-[rgba(var(--color-header-button-base),0.25)] tw:[background:linear-gradient(135deg,rgba(var(--color-primary-dynamic),0.04),transparent_60%),rgba(var(--color-header-button-base),0.06)] tw:p-app-l tw:upto-small:rounded-[10px] tw:upto-small:p-app-m',
  header: 'tw:mb-app-l tw:flex tw:items-start tw:gap-app-s tw:upto-small:flex-col tw:upto-small:gap-app-xs',
  icon: 'tw:flex tw:size-[44px] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-[12px] tw:bg-[rgba(var(--color-primary-dynamic),0.12)] tw:text-app-primary tw:upto-small:size-[36px] tw:upto-small:rounded-[8px] tw:upto-small:[&_svg]:size-[18px]',
  title:
    'tw:mt-0 tw:mr-0 tw:mb-[2px] tw:ml-0 tw:text-app-large tw:leading-[1.3] tw:font-bold tw:text-app-text tw:upto-small:text-app-body',
  subtitle: 'tw:m-0 tw:text-app-small tw:leading-[1.4] tw:text-app-text-subtitle',
  section: 'tw:mb-app-m tw:[&_.tag]:m-0',
  label:
    'tw:mb-app-xs tw:block tw:text-app-xsmall tw:font-bold tw:tracking-[0.04em] tw:text-app-text-subtitle tw:uppercase',
  hint: 'tw:mt-app-xs tw:mr-0 tw:mb-0 tw:ml-0 tw:text-app-xsmall tw:leading-[1.4] tw:text-app-text-subtitle',
  input:
    'tw:w-full tw:rounded-[8px] tw:border tw:border-[rgba(var(--color-header-button-base),0.2)] tw:bg-[rgba(var(--color-header-button-base),0.06)] tw:px-app-s tw:py-[10px] tw:text-app-body tw:text-app-text tw:[transition:border-color_0.15s_ease,background_0.15s_ease] tw:placeholder:text-app-text-subtitle tw:placeholder:opacity-60 tw:focus:border-[rgba(var(--color-primary-dynamic),0.5)] tw:focus:bg-[rgba(var(--color-header-button-base),0.1)] tw:focus:outline-none',
  dateInput: 'tw:!w-auto tw:min-w-[200px]',
  uri: 'tw:mt-[6px] tw:block tw:break-all tw:px-[2px] tw:py-0 tw:[font-family:var(--font-mono,monospace)] tw:text-[12px] tw:text-app-text-subtitle tw:opacity-70',
  schedule:
    'tw:inline-flex tw:gap-[2px] tw:rounded-[8px] tw:border tw:border-[rgba(var(--color-header-button-base),0.1)] tw:bg-[rgba(var(--color-header-button-base),0.12)] tw:p-[3px] tw:upto-small:w-full',
  scheduleButton:
    'tw:cursor-pointer tw:rounded-[6px] tw:![border:none] tw:bg-transparent tw:px-[16px] tw:py-[6px] tw:text-app-small tw:font-semibold tw:text-app-text-subtitle tw:[transition:all_0.15s_ease] tw:hover:bg-[rgba(var(--color-header-button-base),0.15)] tw:hover:text-app-text tw:upto-small:flex-1 tw:upto-small:text-center',
  scheduleButtonActive: 'tw:!bg-app-background tw:!text-app-text tw:[box-shadow:0_1px_3px_rgba(0,0,0,0.1)]',
  dateRow: 'tw:mt-app-s tw:[&_.react-datepicker-wrapper]:w-auto',
  expandButton:
    'tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-[6px] tw:![border:none] tw:bg-none tw:p-0 tw:text-app-small tw:font-semibold tw:text-app-text-subtitle tw:[transition:color_0.15s_ease] tw:hover:text-app-text',
  chevron: 'tw:[transition:transform_0.2s_ease]',
  chevronOpen: 'tw:[transform:rotate(180deg)]',
  optional: 'tw:text-app-xsmall tw:font-normal tw:text-app-text-subtitle tw:opacity-60',
  thumbnailSection: 'tw:mt-app-s tw:[animation:quick-create-in_0.2s_ease]',
  thumbnailPreview:
    'tw:mt-app-xs tw:aspect-[16/9] tw:w-[180px] tw:overflow-hidden tw:rounded-[8px] tw:border tw:border-[rgba(var(--color-header-button-base),0.15)] tw:bg-[#0a0a0a] tw:[&_img]:block tw:[&_img]:size-full tw:[&_img]:object-cover tw:upto-small:w-[140px]',
  submit:
    'tw:mt-app-s tw:flex tw:h-[48px] tw:w-full tw:cursor-pointer tw:items-center tw:justify-center tw:gap-[8px] tw:rounded-[10px] tw:![border:none] tw:bg-[linear-gradient(135deg,rgba(var(--color-primary-dynamic),0.92),rgba(var(--color-primary-dynamic),0.72))] tw:text-app-body tw:font-bold tw:tracking-[0.01em] tw:text-white tw:[box-shadow:0_4px_16px_rgba(var(--color-primary-dynamic),0.2)] tw:[transition:filter_0.15s_ease,opacity_0.15s_ease,transform_0.1s_ease] tw:hover:[&:not(:disabled)]:[transform:translateY(-1px)] tw:hover:[&:not(:disabled)]:brightness-[1.08] tw:hover:[&:not(:disabled)]:[box-shadow:0_6px_20px_rgba(var(--color-primary-dynamic),0.3)] tw:active:[&:not(:disabled)]:[transform:translateY(0)] tw:disabled:cursor-not-allowed tw:disabled:opacity-45 tw:disabled:[box-shadow:none] tw:upto-small:h-[44px]',
  submitPublishing: 'tw:pointer-events-none',
  spinner:
    'tw:size-[16px] tw:rounded-[50%] tw:border-2 tw:border-[rgba(255,255,255,0.3)] tw:![border-top-color:#fff] tw:[animation:quick-create-spin_0.6s_linear_infinite]',
  confirmingCard: 'tw:flex tw:justify-center',
  confirming: 'tw:flex tw:flex-col tw:items-center tw:gap-app-s tw:px-app-m tw:py-app-l tw:text-center',
  confirmingTitle: 'tw:m-0 tw:text-app-body tw:font-bold tw:text-app-text',
  confirmingText: 'tw:m-0 tw:max-w-[300px] tw:text-app-small tw:leading-[1.4] tw:text-app-text-subtitle',
  confirmingProgress:
    'tw:h-[4px] tw:w-[200px] tw:overflow-hidden tw:rounded-[2px] tw:bg-[rgba(var(--color-header-button-base),0.15)]',
  confirmingBar:
    'tw:h-full tw:w-[40%] tw:rounded-[2px] tw:bg-app-primary tw:[animation:quick-create-progress_1.5s_ease-in-out_infinite]',
} as const;
