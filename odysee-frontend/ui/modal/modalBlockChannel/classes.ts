export const BLOCK_MODAL_CLASSES = {
  activeChannel: String.raw`tw:flex tw:items-center tw:p-app-xs tw:[&_.channel-thumbnail]:mr-app-xs tw:[&_.channel-thumbnail]:size-[1.8rem] tw:small:ml-[calc(var(--spacing-l)*2)] tw:small:border-l tw:small:border-l-[var(--color-border)] tw:small:pl-app-m`,
  activeChannelLabel: String.raw`block-modal--active-channel-label tw:mt-0 tw:mr-app-s tw:block tw:max-w-[10rem] tw:whitespace-pre-line tw:text-app-xxsmall tw:[&_span]:mt-[-2px] tw:[&_span]:block tw:[&_span]:max-w-[150px] tw:[&_span]:overflow-hidden tw:[&_span]:text-ellipsis tw:[&_span]:whitespace-nowrap tw:[&_span]:text-app-text`,
  values: 'block-modal--values tw:ml-app-s',
} as const;
