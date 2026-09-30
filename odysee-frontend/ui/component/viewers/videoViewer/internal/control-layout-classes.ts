export const CONTROL_LAYOUT_CLASSES = {
  casting: 'tw:!opacity-100 tw:!scale-100 tw:!filter-none tw:!delay-0',
  row: 'tw:flex tw:items-center tw:justify-between tw:!gap-0 tw:!p-0 tw:!bottom-[var(--spacing-xs)] tw:![inset-inline:var(--spacing-xs)] tw:[&:not([data-visible])]:!scale-100',
  leftGroup: 'tw:flex tw:min-w-0 tw:items-center tw:gap-[0.15rem]',
  side: 'tw:flex tw:items-center tw:gap-[0.075rem] tw:rounded-[9999px] tw:p-[0.175rem]',
  left: String.raw`tw:[&_.media-time]:h-[34px] tw:[&_.media-time]:cursor-pointer tw:[&_.media-time]:gap-[3px] tw:[&_.media-time]:rounded-[9999px] tw:[&_.media-time]:px-2 tw:[&_.media-time]:py-0 tw:[&_.media-time]:ml-[2px] tw:[&_.media-time]:[container:none] tw:[&_.media-time]:[flex:0_0_auto] tw:[&_.media-time]:[transition:background-color_0.2s_ease] tw:[&_.media-time:hover]:bg-[var(--player-hover-bg)] tw:[&_.media-time_.media-time\_\_value:first-child]:!block`,
  popoverOpen: 'tw:!z-[12] tw:!pointer-events-auto tw:!opacity-100',
} as const;
