export const VOLUME_CONTROL_CLASSES = {
  group:
    'tw:flex tw:items-center tw:rounded-[9999px] tw:[transition:background-color_0.2s_ease] tw:hover:bg-[var(--player-hover-bg)] tw:[&_.media-button--mute:hover]:!bg-transparent tw:[&_.media-button--mute:focus-visible]:!bg-transparent tw:[&:hover_.media-slider]:!w-20 tw:[&:hover_.media-slider]:mr-2 tw:[&:hover_.media-slider]:opacity-100',
  slider:
    'tw:m-0 tw:!w-0 tw:!min-w-0 tw:cursor-pointer tw:overflow-hidden tw:p-0 tw:opacity-0 tw:[transition:width_0.2s_ease,margin_0.2s_ease,opacity_0.2s_ease]',
} as const;
