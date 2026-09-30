export const CONTENT_ACCESS_INDICATOR_CLASSES = {
  locked: 'locked tw:[&_.icon]:text-[var(--color-fire)]',
  purchased: 'purchased',
  root: String.raw`content-access-indicator tw:!mr-app-s tw:inline-block tw:[&_.icon]:mb-[-6px] tw:[&_.icon]:size-[26px] tw:[&_.icon]:overflow-visible tw:[&_.icon]:rounded-[50%] tw:[&_.icon]:bg-app-text tw:[&_.icon]:p-[5px] tw:[&_.icon]:[stroke-width:4] tw:upto-small:!mr-app-xxs tw:upto-small:[&_.icon]:mb-[-4px] tw:upto-small:[&_.icon]:size-[22px]`,
  unlocked: 'unlocked tw:[&_.icon]:text-[var(--color-slime)]',
} as const;
