export const WUNDERBAR_CLAIM_PROPERTY_OVERLAY_CLASS = String.raw`tw:absolute tw:right-app-xxs tw:bottom-app-xxs tw:z-[2] tw:rounded-app tw:bg-[var(--color-black)] tw:p-[0.3rem] tw:opacity-70 tw:[&_[data-claim-preview-overlay-properties]]:text-[var(--color-white)]`;

export const WUNDERBAR_SUGGESTION_CLASSES = {
  channel: String.raw`tw:[&_.channel-thumbnail]:mr-app-xs tw:[&_.channel-thumbnail]:size-[2.8125rem] tw:[&_.channel-thumbnail_:is(.ff-canvas,.freezeframe-img)]:size-full tw:[&_.channel-thumbnail_:is(.ff-canvas,.freezeframe-img)]:rounded-[50%] tw:small:[&_.channel-thumbnail]:mr-app-s`,
  label: 'wunderbar__suggestion-label tw:min-w-0 tw:whitespace-nowrap tw:text-app-small',
  name: 'wunderbar__suggestion-name tw:mt-0 tw:w-full tw:overflow-hidden tw:text-ellipsis tw:text-app-text',
  root: String.raw`wunderbar__suggestion tw:ml-app-m tw:flex tw:items-center tw:py-app-s tw:[&_.media\_\_thumb]:mr-app-s tw:[&_.media\_\_thumb]:h-[calc(5rem*0.5625)] tw:[&_.media\_\_thumb]:w-[5rem] tw:[&_.media\_\_thumb]:shrink-0 tw:[&_.media\_\_thumb]:overflow-hidden tw:small:ml-app-s`,
  title: 'wunderbar__suggestion-title tw:overflow-hidden tw:text-ellipsis',
} as const;
