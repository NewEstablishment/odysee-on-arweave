export const MOBILE_TOUCH_OVERLAY_CLASSES = {
  root: String.raw`odysee-touch-overlay tw:absolute tw:inset-0 tw:z-[1] tw:flex tw:items-center tw:justify-center tw:upto-small:[[data-floating-player]_&]:!hidden`,
  center: 'tw:z-[2] tw:flex tw:items-center tw:justify-center tw:gap-3',
  playButton:
    'tw:flex tw:size-16 tw:items-center tw:justify-center tw:rounded-[50%] tw:[border:none] tw:[background:var(--player-overlay-bg)] tw:p-0 tw:text-white tw:[&_svg]:block',
  playIcon: 'tw:ml-1',
  skipButton: String.raw`tw:flex tw:size-[42px] tw:items-center tw:justify-center tw:rounded-[50%] tw:[border:none] tw:[background:var(--player-overlay-bg)] tw:text-white tw:[.shorts-page\_\_container~.video-js-parent_&]:hidden tw:[html:has(.shorts-page)_&]:hidden`,
  skipDisabled: 'tw:opacity-30',
} as const;
