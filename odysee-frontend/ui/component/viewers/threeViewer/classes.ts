export const THREE_VIEWER_CLASSES = {
  root: 'file-render__viewer tw:relative tw:overflow-hidden',
  viewport:
    'tw:h-[calc(100vh_-_var(--header-height)_-_var(--spacing-m)_*_2)] tw:max-h-[var(--inline-player-max-height)]',
} as const;
