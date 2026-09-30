export const WALLPAPER_CLASSES = {
  background:
    'background-image tw:fixed tw:inset-0 tw:bg-app-background tw:bg-cover tw:bg-center tw:bg-no-repeat tw:[-webkit-filter:blur(23px)] tw:[filter:blur(23px)]',
  shade: 'theme tw:fixed tw:inset-0 tw:[background-image:var(--background-shade)]',
  stars:
    'stars tw:fixed tw:inset-0 tw:[&>div]:hidden tw:[&.stars-active_#stars]:block tw:[&.stars-active_#stars2]:block',
} as const;

export const WALLPAPER_PORTAL_STAR_CLASSES = {
  small: 'portal-stars__small',
  medium: 'portal-stars__medium',
} as const;

export const WALLPAPER_PORTAL_ACTIVE_CLASS = 'stars-active';
