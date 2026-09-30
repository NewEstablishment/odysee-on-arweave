export const PLAYER_SKIN_CLASSES = {
  root: String.raw`odysee-skin tw:[--player-surface-bg:oklch(0%_0_0deg_/_0.4)] tw:[--player-overlay-bg:oklch(20%_0_0deg_/_0.65)] tw:[--player-hover-bg:oklch(from_currentColor_l_c_h_/_0.1)] tw:[--media-border-radius:var(--border-radius)] tw:[--media-border-color:transparent] tw:[--media-surface-inner-border-color:transparent] tw:[--media-surface-outer-border-color:transparent] tw:[--media-surface-background-color:var(--player-overlay-bg)] tw:[&_video]:size-full tw:[&_video]:object-contain tw:[[data-floating-player]_&]:[isolation:auto] tw:[[data-embed-wrapper]_&]:[--media-border-radius:0]`,
  casting: 'odysee-skin--casting tw:[--player-surface-bg:oklch(0.25_0_0_/_0.6)]',
  mobileControls: String.raw`tw:[&.odysee-skin]:[--media-border-radius:0] tw:[&.odysee-skin]:[--media-surface-background-color:var(--player-overlay-bg)]`,
  mobileOverlay: 'tw:hidden',
  portrait: 'odysee-skin--portrait tw:!aspect-[9/16] tw:!w-auto tw:mx-auto',
} as const;
