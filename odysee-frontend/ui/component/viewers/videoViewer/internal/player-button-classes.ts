export const PLAYER_BUTTON_CLASSES = {
  active: 'tw:!bg-[var(--color-primary)] tw:hover:!bg-[var(--color-primary)]',
  cast: 'tw:[[data-floating-shorts-player]_&]:!hidden',
  castActive: 'tw:text-[var(--color-primary)]',
  hdBadge:
    'tw:absolute tw:top-[3px] tw:right-0 tw:rounded-[2px] tw:bg-[var(--color-primary)] tw:px-[2px] tw:py-[1px] tw:text-[0.5rem] tw:leading-none tw:font-bold tw:tracking-[0.02em] tw:text-white',
  settingsIcon:
    'tw:![transition:transform_0.4s_ease] tw:[.media-button--settings.media-button--settings-open_&]:[transform:rotate(45deg)]',
  settings: 'media-button--settings tw:relative tw:[[data-floating-shorts-player]_&]:!hidden',
  settingsOpen: 'media-button--settings-open',
  theaterButton: String.raw`tw:[[data-floating-shorts-player]_&]:!hidden tw:[.shorts\_\_viewer_&]:!hidden tw:[:fullscreen_&]:!hidden tw:[html.ios-fullscreen_&]:!hidden tw:upto-small:!hidden`,
  theaterIcon: 'tw:inline-block tw:size-[18px]',
} as const;
