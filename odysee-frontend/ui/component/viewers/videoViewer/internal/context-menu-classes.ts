export const CONTEXT_MENU_CLASSES = {
  check: 'tw:shrink-0 tw:text-[0.85rem] tw:opacity-85',
  icon: 'tw:size-[14px] tw:shrink-0 tw:opacity-85',
  item: 'tw:flex tw:w-full tw:cursor-pointer tw:items-center tw:gap-[8px] tw:rounded-[4px] tw:border-none tw:bg-transparent tw:bg-none tw:px-[12px] tw:py-[7px] tw:text-left tw:text-inherit tw:![font-size:inherit] tw:disabled:cursor-default tw:disabled:opacity-40 tw:[&:hover:not(:disabled)]:bg-[rgba(255,255,255,0.08)]',
  label: 'tw:flex-1',
  root: 'tw:fixed tw:z-[2147483647] tw:min-w-[220px] tw:animate-[odysee-ctx-fade-in_0.08s_ease-out] tw:select-none tw:rounded-[6px] tw:![border:1px_solid_rgba(255,255,255,0.08)] tw:bg-[rgba(20,22,28,0.55)] tw:p-[4px] tw:text-[0.82rem] tw:text-white tw:[-webkit-backdrop-filter:blur(18px)_saturate(140%)] tw:[box-shadow:0_12px_32px_rgba(0,0,0,0.45)]',
  separator: 'tw:mx-[6px] tw:my-[4px] tw:h-[1px] tw:bg-[rgba(255,255,255,0.08)]',
} as const;
