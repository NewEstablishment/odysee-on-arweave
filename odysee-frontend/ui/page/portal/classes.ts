export const PORTAL_PAGE_CLASSES = {
  header: 'tw:relative tw:mb-app-xl tw:flex tw:rounded-app tw:bg-app-header tw:upto-small:m-app-xxs',
  image: 'tw:h-[110px] tw:rounded-[var(--border-radius)_0_0_var(--border-radius)] tw:p-app-xxs',
  meta: 'tw:p-app-m tw:upto-small:p-app-xs',
  title: 'tw:text-app-title tw:font-bold tw:upto-small:text-app-body',
  description: 'tw:upto-small:text-app-small',
  content:
    'tw:mb-app-l tw:rounded-app tw:bg-[rgba(var(--color-header-background-base),0.8)] tw:p-app-m tw:upto-small:m-app-xxs',
} as const;

export const PORTAL_THEME_CLASS = 'portal-theme-active';
