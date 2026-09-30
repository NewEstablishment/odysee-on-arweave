export const NOTIFICATION_BUBBLE_CLASSES = {
  base: String.raw`notification__bubble tw:absolute tw:top-[-0.4rem] tw:right-[-0.4rem] tw:flex tw:size-[1.4rem] tw:items-center tw:justify-center tw:rounded-[50%] tw:border-[1.5px] tw:border-solid tw:border-[var(--color-background)] tw:bg-[var(--color-notification)] tw:text-app-small tw:leading-[1.4rem] tw:font-bold tw:text-white tw:[transform:scale(1)] tw:[transition:transform_0.4s] tw:[&_.notification\_\_count]:mb-[-2px] tw:upto-small:right-0`,
  hidden: 'notification__bubble-hidden tw:![transform:scale(0)]',
  inline: 'notification__bubble--inline tw:!top-[0.75rem] tw:!right-[1rem] tw:[.mobile-only_&]:!top-app-xxs',
  small: 'notification__bubble--small tw:text-app-xxsmall',
} as const;
