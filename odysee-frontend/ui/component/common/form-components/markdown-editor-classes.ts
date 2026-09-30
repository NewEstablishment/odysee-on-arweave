export const MARKDOWN_EDITOR_CLASSES = {
  root: String.raw`tw:overflow-hidden tw:rounded-app tw:text-[var(--color-input)] tw:[--markdown-editor-max-height:32rem] tw:[.comment-create_&]:mt-[4px] tw:[.comment-create_&]:bg-[var(--color-input-bg)]`,
  textarea: String.raw`tw:w-full tw:min-h-[20rem] tw:max-h-[var(--markdown-editor-max-height)] tw:resize-y tw:overflow-x-hidden tw:overflow-y-auto tw:border-none tw:bg-transparent tw:p-app-s tw:leading-[1.55] tw:text-[var(--color-input)] tw:whitespace-pre-wrap tw:break-words tw:[word-break:break-word] tw:placeholder:text-[var(--color-input-placeholder)] tw:placeholder:opacity-50 tw:focus:[box-shadow:none] tw:focus:outline-none tw:focus-visible:[box-shadow:none] tw:focus-visible:outline-none`,
  preview: String.raw`tw:w-full tw:min-h-[20rem] tw:max-h-[var(--markdown-editor-max-height)] tw:overflow-auto tw:bg-transparent tw:p-app-s tw:text-[var(--color-input)] tw:[&_.markdown-preview]:min-h-full`,
} as const;

export const MARKDOWN_EDITOR_STATUSBAR_CLASS =
  'tw:flex tw:flex-wrap tw:justify-end tw:gap-app-s tw:rounded-app tw:bg-[rgba(var(--color-header-background-base),0.5)] tw:px-app-s tw:py-app-xs tw:text-app-xsmall tw:text-[var(--color-input-label)]';

export const MARKDOWN_EDITOR_TOOLBAR_CLASS =
  'tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-app-s tw:border-b tw:border-b-[var(--color-input-border)] tw:bg-app-border tw:p-[0.5rem] tw:text-[rgba(var(--color-text-base),0.7)]';

export const MARKDOWN_EDITOR_TOOLBAR_GROUP_CLASS = 'tw:flex tw:flex-wrap tw:items-center tw:gap-app-xxs';

export const MARKDOWN_EDITOR_TOOLBAR_BUTTON_CLASS =
  'tw:h-[2rem] tw:min-w-[2rem] tw:rounded-app tw:border-none tw:bg-app-background tw:px-app-xs tw:py-0 tw:text-app-xsmall tw:font-[var(--font-weight-bold)] tw:text-[var(--color-header-link)] tw:hover:bg-app-primary tw:hover:text-app-primary-contrast tw:focus-visible:bg-app-primary tw:focus-visible:text-app-primary-contrast tw:disabled:cursor-default tw:disabled:opacity-[0.35]';
