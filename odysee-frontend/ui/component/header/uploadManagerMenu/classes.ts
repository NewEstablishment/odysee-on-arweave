export const UPLOAD_MANAGER_CLASSES = {
  actionButton:
    'tw:flex tw:size-[28px] tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[50%] tw:![border:none] tw:bg-transparent tw:text-app-text-subtitle tw:hover:bg-[var(--color-header-button)] tw:hover:text-app-text',
  entry:
    'upload-manager-entry-surface tw:group/upload-manager-entry tw:relative tw:flex tw:w-[440px] tw:!overflow-hidden tw:[border-top:1px_solid_var(--color-header-background)] tw:bg-[var(--color-header-button)] tw:p-app-s tw:first:[border-top:none] tw:hover:cursor-pointer tw:hover:bg-[rgba(var(--color-header-background-base),1)]',
  icon: String.raw`upload-manager-icon-surface tw:relative tw:z-[1] tw:mt-0 tw:mr-app-s tw:ml-0 tw:[&_.icon\_\_wrapper]:!size-[2rem] tw:[&_.icon\_\_wrapper]:text-app-text`,
  iconReady: String.raw`upload-manager-icon-ready-surface tw:[&_.icon\_\_wrapper]:!bg-[var(--color-notification)] tw:[&_.icon\_\_wrapper_.icon]:!text-white tw:[&_.icon\_\_wrapper_.icon]:![stroke:#fff]`,
  pauseIcon:
    "tw:flex tw:gap-[3px] tw:before:h-[12px] tw:before:w-[3px] tw:before:rounded-[1px] tw:before:bg-current tw:before:content-[''] tw:after:h-[12px] tw:after:w-[3px] tw:after:rounded-[1px] tw:after:bg-current tw:after:content-['']",
} as const;
