export const SWIPEABLE_DRAWER_CLASSES = {
  header: String.raw`swipeable-drawer__header tw:visible tw:absolute tw:inset-x-0 tw:top-[-120px] tw:h-[120px] tw:rounded-t-[12px] tw:border-t tw:border-t-app-border tw:bg-app-background tw:backdrop-blur-[4px] tw:[-webkit-backdrop-filter:blur(4px)] tw:[&_.button-close-surface]:!top-[2px] tw:[&_.button-close-surface]:!right-[2px] tw:[&_span]:text-app-text tw:[&_svg]:text-app-text`,
  puller:
    'swipeable-drawer__puller tw:absolute tw:top-[8px] tw:left-[calc(50%-15px)] tw:h-[6px] tw:w-[30px] tw:rounded-[3px] tw:bg-app-text',
  headerContent: String.raw`swipeable-drawer__header-content tw:flex tw:items-center tw:justify-between tw:text-app-small tw:[&_h2:not(.card\_\_title)]:mt-app-s tw:[&_h2:not(.card\_\_title)]:p-app-s`,
  headerActions: String.raw`swipeable-drawer__header-actions tw:flex tw:[&_button]:p-[0.3rem] tw:[&_button:not(:last-child)]:mr-app-xxs tw:[&_.menu\_\_button]:opacity-100`,
  expand: String.raw`swipeable-drawer__expand-button tw:my-app-xxs tw:w-full tw:!rounded-app tw:pl-app-xxs tw:[--button-surface-primary-bg:var(--color-header-button)] tw:[&_.button-surface\_\_content_.icon]:stroke-app-text tw:[&_.button-surface\_\_content_.button-surface\_\_label]:text-app-text`,
  expandFixed:
    'fixed tw:fixed tw:top-[unset] tw:bottom-0 tw:z-[9999] tw:!m-0 tw:border-t tw:border-t-[var(--color-header-button)]',
} as const;
