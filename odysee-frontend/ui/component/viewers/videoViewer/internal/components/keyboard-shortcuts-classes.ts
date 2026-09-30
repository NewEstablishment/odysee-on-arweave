export const KEYBOARD_SHORTCUT_CLASSES = {
  action: 'tw:text-right tw:text-[rgba(255,255,255,0.7)]',
  body: 'tw:flex tw:gap-[24px]',
  card: 'tw:w-[90%] tw:max-w-[640px] tw:animate-[settings-fade-in_0.2s_ease-out] tw:rounded-app tw:bg-[rgba(28,28,28,0.95)] tw:px-[24px] tw:py-[16px] tw:text-white',
  close:
    'tw:cursor-pointer tw:rounded-app tw:border-none tw:bg-transparent tw:bg-none tw:px-[8px] tw:py-[4px] tw:text-[0.85rem] tw:text-[rgba(255,255,255,0.7)] tw:hover:bg-[rgba(255,255,255,0.1)] tw:hover:text-white',
  header:
    'tw:mb-[12px] tw:flex tw:items-center tw:justify-between tw:pb-[8px] tw:[border-bottom:1px_solid_rgba(255,255,255,0.1)]',
  item: 'tw:flex tw:items-center tw:justify-between tw:px-0 tw:py-[4px] tw:text-[0.8rem]',
  kbd: 'tw:inline-block tw:min-w-[1.5em] tw:rounded-[3px] tw:bg-[rgba(255,255,255,0.15)] tw:px-[6px] tw:py-[1px] tw:text-center tw:font-[inherit] tw:text-[0.75rem]',
  keys: 'tw:mr-[12px] tw:shrink-0',
  list: 'tw:m-0 tw:flex-1 tw:list-outside tw:list-none tw:p-0',
  overlay: 'tw:absolute tw:inset-0 tw:z-[100] tw:flex tw:items-center tw:justify-center tw:bg-[rgba(0,0,0,0.7)]',
  separator: 'tw:mx-[2px] tw:opacity-50',
  title: 'tw:text-[1rem] tw:font-semibold',
} as const;
