export const HELP_TEXT_CLASS = String.raw`tw:mt-app-s tw:block tw:text-app-xsmall tw:text-app-text tw:[.block-modal--values_&]:text-app-xsmall tw:[.block-modal--values_&]:italic tw:[.card\_\_main-actions_&]:text-[rgba(var(--color-text-base),0.7)] tw:[.card\_\_main-actions_&_.icon]:mb-[2px] tw:[.card\_\_main-actions_&_.icon]:size-[12px] tw:small:text-app-small`;

const HELP_CALLOUT_CONTEXT_CLASS = String.raw`tw:[dd_&]:mt-app-s tw:[dd_&]:mb-0 tw:[dd_&]:text-left`;

export const HELP_CLASS = `help ${HELP_TEXT_CLASS}`;

export const HELP_WARNING_CLASS = String.raw`help--warning ${HELP_TEXT_CLASS} ${HELP_CALLOUT_CONTEXT_CLASS} tw:mb-app-s tw:rounded-app tw:border tw:border-app-primary tw:bg-[rgba(var(--color-primary-dynamic),0.1)] tw:p-app-s`;

export const HELP_NOTICE_CLASS = String.raw`help--notice ${HELP_TEXT_CLASS} ${HELP_CALLOUT_CONTEXT_CLASS} tw:mb-app-s tw:rounded-app tw:border tw:border-app-border tw:bg-app-card-highlighted tw:p-app-s tw:[&_ul]:m-0 tw:upto-small:[box-shadow:0px_0px_0px_1px_var(--color-primary)_inset] tw:upto-small:[.main--livestream_:is(.card-stack,.card-stack--spacing-m)_&]:!m-app-xs`;

export const HELP_INLINE_CLASS = String.raw`help--inline ${HELP_TEXT_CLASS} tw:!mt-0 tw:!mb-0 tw:[&_.icon--help]:!top-[3px]`;

export const HELP_CARD_ACTIONS_CLASS = `help--card-actions ${HELP_TEXT_CLASS} tw:!mt-app-m`;

export const HELP_ERROR_CLASS = `help--error ${HELP_TEXT_CLASS}`;

export const HELP_DT_CLASS = `help--dt ${HELP_TEXT_CLASS}`;

export const FORM_FIELD_HELP_CLASS = String.raw`form-field__help ${HELP_TEXT_CLASS} tw:!text-[rgba(var(--color-text-base),0.8)] tw:opacity-80 tw:[&_:is(input,select)]:w-full tw:[&+:is(.checkbox,.radio)]:mt-app-l`;
