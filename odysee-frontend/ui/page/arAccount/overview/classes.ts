export const AR_ACCOUNT_OVERVIEW_CLASSES = {
  root: 'card--overview',
  optionsWrapper: 'payment-options-wrapper tw:flex tw:w-full tw:gap-app-m tw:upto-medium:flex-col',
  optionsCard: 'payment-options-card tw:flex tw:h-full tw:flex-1 tw:flex-col tw:gap-app-s',
  options: 'payment-options tw:flex tw:w-full tw:flex-1 tw:flex-col',
  option: String.raw`payment-option tw:flex tw:flex-1 tw:flex-col tw:[&_fieldset-section]:w-full tw:[&_fieldset-section_.form-field--copyable]:bg-[var(--color-header-button)] tw:[&_[data-qr-code]]:size-[200px] tw:[&_[data-qr-code]_canvas]:!size-full`,
  contentOption: String.raw`payment-option tw:flex-1 tw:justify-center tw:[.payment-options_&]:flex tw:[.payment-options_&]:flex-col tw:[&_fieldset-section]:w-full tw:[&_fieldset-section_.form-field--copyable]:bg-[var(--color-header-button)] tw:[&_[data-qr-code]]:size-[200px] tw:[&_[data-qr-code]_canvas]:!size-full`,
  monetization:
    'payment-option__monetization tw:mb-app-s tw:flex tw:items-center tw:gap-app-l tw:rounded-app tw:bg-[var(--color-header-button)] tw:p-app-xs tw:last-of-type:mb-0',
  labels: 'payment-option__labels tw:flex tw:flex-col',
  labelsDescription: 'tw:inline-block tw:text-app-xsmall tw:opacity-60',
  content:
    'payment-options-content tw:flex tw:h-full tw:w-full tw:flex-col tw:gap-app-s tw:rounded-[var(--border-radius)_0_var(--border-radius)_var(--border-radius)] tw:bg-app-background tw:p-app-s',
  wallet:
    'payment-option__wallet tw:flex tw:items-center tw:rounded-app tw:bg-[var(--color-header-button)] tw:p-app-xs tw:upto-small:flex-col',
  walletInfo: 'payment-option__wallet-info tw:flex-1',
  walletInfoDescription: 'tw:text-app-xsmall tw:opacity-60',
  walletButton: String.raw`payment-option__wallet-button tw:flex tw:w-fit tw:[&_.button]:ml-app-s tw:upto-small:w-full tw:upto-small:[&_.button]:mt-app-s tw:upto-small:[&_.button]:mr-auto tw:upto-small:[&_.button]:ml-[unset]`,
  sendRow: 'sendAr-row tw:flex tw:h-full tw:w-full tw:flex-col',
  sendField: 'tw:flex tw:w-full tw:flex-col',
  sendTotal: 'sendAr__total tw:mb-app-s tw:flex tw:w-full',
  sendTotalValue: 'tw:ml-auto tw:cursor-pointer tw:text-app-xsmall',
  sendLabel: 'sendArLabel tw:flex tw:w-full tw:items-center',
  sendInput: 'tw:ml-auto tw:w-full tw:bg-[var(--color-header-button)]',
  sendAction: 'sendAr-row__send tw:mt-auto tw:upto-medium:mt-app-m',
  history:
    'transaction-history tw:mt-[calc(var(--spacing-s)*-1)] tw:flex tw:flex-col tw:rounded-app tw:bg-app-background tw:p-app-s tw:[&_.spinner]:mx-auto',
  historyRow:
    'transaction-history__row tw:flex tw:w-full tw:items-center tw:gap-app-s tw:[grid-template-columns:1fr_1fr_1fr_1fr] tw:upto-medium:text-app-small tw:upto-small:!text-app-xxsmall',
  historyDate: 'transaction-history__date tw:w-[140px] tw:min-w-[90px]',
  historyAction: 'transaction-history__action tw:w-[60px] tw:min-w-[60px] tw:upto-medium:min-w-[40px]',
  historyAmount: 'transaction-history__amount tw:w-[70px] tw:min-w-[70px] tw:upto-medium:min-w-[44px]',
  historyToken: 'transaction-history__token tw:w-[56px] tw:min-w-[56px] tw:upto-medium:min-w-[30px]',
  historySymbol: 'tw:upto-medium:mr-0! tw:upto-medium:[&_svg]:size-[12px]',
  historyDirection: 'transaction-history__direction tw:w-[40px] tw:min-w-[40px] tw:upto-medium:min-w-[20px]',
  historyTarget: 'transaction-history__target tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap',
  historyViewblock:
    'transaction-history__viewblock tw:ml-auto tw:shrink-0 tw:[&_img]:size-[14px] tw:[&_img]:rounded-[50%]',
} as const;
