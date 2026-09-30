export const MEMBERSHIP_OVERVIEW_CLASSES = {
  stats: 'membership-overview-stats tw:mb-app-l tw:grid tw:grid-cols-3 tw:gap-app-m tw:upto-small:grid-cols-1',
  stat: 'membership-overview-stat tw:rounded-app tw:border tw:border-app-border tw:bg-app-header tw:px-app-l tw:py-app-m',
  statLabel: 'tw:mb-app-s tw:block tw:text-app-small tw:font-bold tw:text-app-text-subtitle',
  statValue: 'tw:text-app-large tw:leading-[1.1] tw:text-app-primary',
  list: 'membership-overview-list tw:mb-[28px] tw:grid tw:gap-app-s',
  listHeader: String.raw`membership-overview-list__header tw:grid tw:grid-cols-[minmax(220px,1fr)_minmax(90px,0.35fr)_minmax(150px,0.5fr)_56px_48px] tw:items-center tw:gap-app-s tw:px-app-l tw:pt-0 tw:pb-app-xs tw:text-app-xsmall tw:font-bold tw:text-app-text-subtitle tw:upto-small:hidden`,
  listHeaderMetric: 'tw:text-right',
  channel: String.raw`membership-overview-channel tw:grid tw:grid-cols-[minmax(220px,1fr)_minmax(90px,0.35fr)_minmax(150px,0.5fr)_56px_48px] tw:items-center tw:gap-app-s tw:rounded-app tw:border tw:border-app-border tw:bg-app-header tw:px-app-l tw:py-app-m tw:[transition:background-color_var(--animation-duration)_var(--animation-style),border-color_var(--animation-duration)_var(--animation-style)] tw:[&:focus-within]:border-app-link tw:[&:focus-within]:bg-[rgba(var(--color-header-background-base),0.55)] tw:hover:border-app-link tw:hover:bg-[rgba(var(--color-header-background-base),0.55)] tw:[&_.button-surface--alt]:bg-[linear-gradient(147deg,var(--color-primary),rgb(247,121,55))] tw:[&_.button-surface--alt]:text-white tw:[&_.button-surface--alt:hover]:text-white tw:upto-small:grid-cols-[1fr_auto_auto] tw:upto-small:gap-x-app-s tw:upto-small:gap-y-app-xs`,
  select: String.raw`membership-overview-channel__select tw:col-span-3 tw:grid tw:min-w-0 tw:cursor-pointer tw:grid-cols-[minmax(220px,1fr)_minmax(90px,0.35fr)_minmax(150px,0.5fr)] tw:items-center tw:gap-app-s tw:[border:0] tw:[background:none] tw:p-0 tw:text-left tw:text-inherit tw:focus:outline-none tw:upto-small:col-[1/-1] tw:upto-small:grid-cols-[1fr_auto_auto]`,
  identity: String.raw`membership-overview-channel__identity tw:flex tw:min-w-0 tw:items-center tw:gap-app-s tw:font-bold tw:[&_.channel-thumbnail]:mr-0 tw:[&_.channel-thumbnail]:flex-[0_0_auto] tw:upto-small:col-[1/-1]`,
  metric:
    'membership-overview-channel__metric tw:text-right tw:font-bold tw:text-app-text tw:upto-small:grid tw:upto-small:gap-app-xxs tw:upto-small:text-left',
  metricLabel: 'tw:hidden tw:upto-small:block tw:upto-small:text-app-xsmall tw:upto-small:text-app-text-subtitle',
  action:
    'membership-overview-channel__action tw:flex tw:justify-end tw:[&_.button]:m-0 tw:[&_.button]:h-[36px] tw:[&_.button]:min-w-[36px]',
} as const;
