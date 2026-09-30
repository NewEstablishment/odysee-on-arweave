export const LIVESTREAM_METRICS_CLASSES = {
  base: 'tw:[font-variant-numeric:tabular-nums]',
  compact: 'tw:flex tw:flex-wrap tw:items-center tw:gap-[6px] tw:px-0 tw:py-[4px]',
  chip: 'tw:inline-flex tw:h-[22px] tw:items-center tw:gap-[3px] tw:whitespace-nowrap tw:rounded-[4px] tw:bg-[rgba(var(--color-header-button-base),0.08)] tw:px-[8px] tw:py-0 tw:text-[11px] tw:font-semibold tw:text-app-text-subtitle',
  healthDot: 'tw:size-[7px] tw:shrink-0 tw:rounded-[50%]',
  healthGood: 'tw:bg-[#34d399] tw:[box-shadow:0_0_6px_rgba(52,211,153,0.6)]',
  healthUnknown: 'tw:bg-[rgba(255,255,255,0.35)]',
  overlay: 'tw:pointer-events-none tw:inline-flex tw:items-center tw:gap-app-xxs',
  viewersBadge:
    'tw:inline-flex tw:h-[24px] tw:items-center tw:gap-[4px] tw:rounded-[4px] tw:bg-[rgba(0,0,0,0.45)] tw:px-[8px] tw:py-0 tw:text-[11px] tw:font-bold tw:text-white tw:backdrop-blur-[8px]',
  sourceBadge:
    'tw:inline-flex tw:h-[24px] tw:items-center tw:rounded-[4px] tw:bg-[rgba(0,0,0,0.35)] tw:px-[8px] tw:py-0 tw:text-[11px] tw:font-semibold tw:text-[rgba(255,255,255,0.85)] tw:backdrop-blur-[8px]',
  full: 'tw:rounded-[10px] tw:border tw:border-[rgba(var(--color-header-button-base),0.3)] tw:[background:linear-gradient(135deg,rgba(var(--color-primary-dynamic),0.04),transparent_60%),rgba(var(--color-header-button-base),0.07)] tw:px-app-m tw:py-app-s tw:backdrop-blur-[8px]',
  fullOffline: 'tw:!p-app-m tw:text-center tw:opacity-60',
  offlineLabel: 'tw:text-app-small tw:font-semibold tw:text-app-text-subtitle',
  fullHeader: 'tw:mb-app-s tw:flex tw:items-center tw:justify-between',
  fullViewers: 'tw:flex tw:items-center tw:gap-[6px] tw:text-app-text',
  fullViewerCount: 'tw:text-app-large tw:font-extrabold tw:text-app-text',
  fullViewerLabel: 'tw:text-app-small tw:font-medium tw:text-app-text-subtitle',
  fullSource:
    'tw:inline-flex tw:h-[24px] tw:items-center tw:rounded-[6px] tw:border tw:border-[rgba(var(--color-header-button-base),0.3)] tw:bg-[rgba(var(--color-header-button-base),0.25)] tw:px-[10px] tw:py-0 tw:text-[11px] tw:font-bold tw:tracking-[0.04em] tw:text-app-text tw:uppercase',
  fullGrid: 'tw:grid tw:grid-cols-3 tw:gap-app-xs tw:upto-small:grid-cols-2',
  fullStat:
    'tw:flex tw:flex-col tw:gap-[2px] tw:rounded-app tw:border tw:border-[rgba(var(--color-header-button-base),0.15)] tw:bg-[rgba(var(--color-header-button-base),0.1)] tw:px-app-s tw:py-app-xs',
  fullStatLabel: 'tw:text-[10px] tw:font-bold tw:tracking-[0.05em] tw:text-app-text-subtitle tw:uppercase',
  fullStatValue: 'tw:text-app-small tw:font-semibold tw:text-app-text',
  fullStatSub: 'tw:ml-[6px] tw:text-[11px] tw:font-medium tw:text-app-text-subtitle',
  card: 'tw:rounded-[12px] tw:border tw:border-[rgba(var(--color-header-button-base),0.35)] tw:[background:linear-gradient(135deg,rgba(var(--color-primary-dynamic),0.05),transparent_60%),rgba(var(--color-header-button-base),0.08)] tw:p-app-m',
  cardOffline: 'tw:opacity-70',
  cardHeader: 'tw:mb-app-s tw:flex tw:items-center tw:gap-app-xs',
  cardDot: 'tw:size-[8px] tw:shrink-0 tw:rounded-[50%]',
  cardDotLive:
    'tw:bg-[#34d399] tw:[animation:stream-metrics-pulse_1.5s_ease-in-out_infinite] tw:[box-shadow:0_0_8px_rgba(52,211,153,0.5)]',
  cardDotOffline: 'tw:bg-[rgba(var(--color-header-button-base),0.5)]',
  cardTitle: 'tw:text-app-body tw:font-bold tw:text-app-text',
  cardSource:
    'tw:inline-flex tw:h-[22px] tw:items-center tw:rounded-[4px] tw:bg-[rgba(var(--color-header-button-base),0.2)] tw:px-[8px] tw:py-0 tw:text-[11px] tw:font-bold tw:tracking-[0.04em] tw:text-app-text-subtitle tw:uppercase',
  cardViewers:
    'tw:ml-auto tw:inline-flex tw:items-center tw:gap-[5px] tw:text-[15px] tw:font-extrabold tw:text-app-text',
  cardOfflineText: 'tw:m-0 tw:text-app-small tw:text-app-text-subtitle',
  cardGrid: 'tw:grid tw:grid-cols-3 tw:gap-app-xs tw:upto-small:grid-cols-2',
  cardStat:
    'tw:flex tw:flex-col tw:gap-[2px] tw:rounded-app tw:border tw:border-[rgba(var(--color-header-button-base),0.15)] tw:bg-[rgba(var(--color-header-button-base),0.1)] tw:px-app-s tw:py-app-xs',
  cardStatWide: 'tw:col-span-2',
  cardStatLabel: 'tw:text-[10px] tw:font-bold tw:tracking-[0.05em] tw:text-app-text-subtitle tw:uppercase',
  cardStatValue: 'tw:text-app-small tw:font-semibold tw:text-app-text',
} as const;
