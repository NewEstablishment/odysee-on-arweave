export const MENU_CLASSES = {
  wrapper: 'menu__wrapper',
  paper: 'menu__paper',
  list: 'menu__list',
  item: 'menu__item',
  link: 'menu__link',
  header: String.raw`menu__list--header tw:!z-[100002] tw:mt-[10px] tw:origin-top tw:rounded-app tw:px-0 tw:py-app-xs tw:text-app-small tw:[--mui-background:rgb(var(--color-header-background-base))] tw:[animation:none] tw:[&_.MuiPaper-root]:!top-[calc(var(--header-height)-12px)] tw:[&_.MuiPaper-root]:![animation:menu-animate-in_var(--animation-duration)_var(--animation-style)] tw:[&_.MuiPaper-root]:![transform-origin:top_right] tw:[&_.MuiPaper-root]:![transition:none] tw:[&_.menu\_\_paper]:whitespace-nowrap tw:upto-small:[&_.MuiPaper-root]:!top-[calc(var(--header-height-mobile)-10px)] tw:upto-small:[&_.MuiPaper-root]:!right-0 tw:upto-small:[&_.MuiPaper-root]:!left-auto`,
} as const;
