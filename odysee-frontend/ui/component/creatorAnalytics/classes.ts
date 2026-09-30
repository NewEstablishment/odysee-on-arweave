export const CREATOR_ANALYTICS_CLASSES = {
  actionButton: 'tw:!w-full tw:!justify-start',
  actions: 'tw:flex tw:flex-col tw:gap-app-xxs',
  channelButton:
    'tw:!h-auto tw:!w-full tw:!justify-start tw:!px-app-m tw:!py-app-s tw:hover:[&_[data-dashboard-channel-name]]:text-[var(--color-button-secondary-text-hover)] tw:hover:[&_[data-dashboard-channel-url]]:text-[var(--color-button-secondary-text-hover)]',
  channelContent: 'tw:!flex tw:!min-w-0 tw:!items-center tw:!gap-app-xs',
  channelInfo: 'tw:flex tw:min-w-0 tw:flex-col',
  channelName:
    'tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-small tw:font-semibold tw:text-[var(--color-button-secondary-text)]',
  channelUrl:
    'tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-xsmall tw:text-[var(--color-button-secondary-text)] tw:opacity-60',
  comment:
    'tw:cursor-pointer tw:rounded-[calc(var(--border-radius)/2)] tw:bg-app-background tw:p-app-xs tw:hover:bg-app-card',
  commentAuthor: 'tw:text-app-xsmall tw:font-semibold tw:text-app-text',
  commentBadge:
    'tw:mb-[2px] tw:inline-block tw:rounded-[3px] tw:bg-[rgba(244,67,54,0.15)] tw:px-[6px] tw:py-[1px] tw:text-app-xxsmall tw:font-semibold tw:text-[#f44336]',
  commentClaim:
    'tw:mt-[2px] tw:inline-block tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-xxsmall tw:text-app-text-subtitle',
  commentHeader: 'tw:mb-[2px] tw:flex tw:items-center tw:justify-between',
  comments: 'tw:flex tw:flex-col tw:gap-app-xs',
  commentText:
    'tw:m-0 tw:overflow-hidden tw:text-app-xsmall tw:leading-[1.4] tw:text-app-text-subtitle tw:[display:-webkit-box] tw:[-webkit-box-orient:vertical] tw:[-webkit-line-clamp:2]',
  commentTime: 'tw:text-app-xxsmall tw:text-app-text-subtitle',
  link: 'tw:cursor-pointer tw:hover:!text-app-primary',
  main: 'tw:flex tw:min-w-0 tw:flex-col tw:gap-app-m',
  membershipRow:
    'tw:flex tw:justify-between tw:text-app-small tw:text-app-text tw:[&>span:first-child]:text-app-text-subtitle',
  membershipSummary: 'tw:mb-app-xs tw:flex tw:flex-col tw:gap-app-xxs',
  overview: 'tw:flex tw:flex-wrap tw:gap-app-s',
  root: 'tw:flex tw:flex-col tw:gap-app-m tw:pb-app-l',
  section: 'tw:rounded-app tw:bg-[var(--color-header-button)] tw:p-app-m',
  sectionHeader: 'tw:mb-app-s tw:flex tw:items-center tw:justify-between',
  sectionTitle: 'tw:mt-0 tw:mr-0 tw:mb-app-s tw:ml-0 tw:text-app-body tw:font-bold tw:text-app-text',
  sectionTitleInline: 'tw:!mb-0',
  sections:
    'tw:grid tw:gap-app-m tw:[align-items:start] tw:[grid-template-columns:1fr_280px] tw:upto-small:grid-cols-1',
  sidebar: 'tw:flex tw:flex-col tw:gap-app-m',
  statBody: 'tw:flex tw:min-w-0 tw:flex-1 tw:flex-col',
  statCard:
    'tw:flex tw:min-w-[140px] tw:flex-1 tw:items-center tw:gap-app-s tw:rounded-app tw:bg-[var(--color-header-button)] tw:p-app-s',
  statIconBlue: 'tw:[&_.icon]:stroke-[#2196f3]',
  statIconGreen: 'tw:[&_.icon]:stroke-[#4caf50]',
  statIconRed: 'tw:[&_.icon]:stroke-[#e53935]',
  statLabel: 'tw:text-app-xsmall tw:leading-[1.2] tw:text-app-text-subtitle',
  statValue: 'tw:text-app-large tw:leading-[1.1] tw:font-bold tw:text-app-text',
  table: 'tw:w-full tw:border-collapse tw:text-app-small',
  tableCell:
    'tw:px-app-xs tw:py-app-xs tw:text-app-text tw:[border:none] tw:![border-bottom:1px_solid_rgba(var(--color-header-button-base),0.08)]',
  tableDate: 'tw:whitespace-nowrap',
  tableHeaderCell:
    'tw:px-app-xs tw:py-app-xxs tw:text-left tw:text-app-xsmall tw:font-semibold tw:tracking-[0.04em] tw:text-app-text-subtitle tw:uppercase tw:[border:none] tw:![border-bottom:1px_solid_var(--color-border)]',
  tableRow: 'tw:group tw:cursor-pointer',
  tableRowCell: 'tw:group-hover:bg-app-card',
  tableTitle: 'tw:max-w-[40vw] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap',
  tableViews: 'tw:whitespace-nowrap tw:[font-variant-numeric:tabular-nums]',
  topBadge:
    'tw:mb-app-xxs tw:inline-block tw:text-app-xxsmall tw:font-semibold tw:tracking-[0.04em] tw:text-app-text-subtitle tw:uppercase',
  topContent: 'tw:flex tw:flex-col tw:gap-app-m',
  topItem: String.raw`tw:relative tw:[&_[data-claim-preview-background]]:opacity-70 tw:hover:[&_[data-claim-preview-background]]:!opacity-100`,
  topMeta: 'tw:mt-app-xxs tw:flex tw:items-center tw:gap-app-s tw:text-app-small tw:text-app-text-subtitle',
  trend: 'tw:inline-flex tw:items-center tw:gap-[2px] tw:text-app-xsmall tw:font-semibold',
  trendDown: 'tw:text-[#f44336] tw:[&_.icon]:stroke-[#f44336]',
  trendInherited: 'tw:![color:inherit] tw:![font-size:inherit] tw:![font-weight:inherit] tw:[&_.icon]:!stroke-current',
  trendNeutral: 'tw:text-app-text-subtitle',
  trendUp: 'tw:text-[#4caf50] tw:[&_.icon]:stroke-[#4caf50]',
} as const;
