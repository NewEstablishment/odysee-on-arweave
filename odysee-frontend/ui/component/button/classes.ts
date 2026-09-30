const BUTTON_FILLED_CLASS = 'button-surface--filled';

export const BUTTON_CLASS = 'button button-surface';
export const BUTTON_PRIMARY_CLASS = `${BUTTON_FILLED_CLASS} button-surface--primary`;
export const BUTTON_SECONDARY_CLASS = `${BUTTON_FILLED_CLASS} button-surface--secondary`;
export const BUTTON_ALT_CLASS = `${BUTTON_FILLED_CLASS} button-surface--alt`;
export const BUTTON_LIQUIDASS_CLASS = `${BUTTON_FILLED_CLASS} button-surface--liquid`;
export const BUTTON_LINK_CLASS = 'button-surface--link';
export const BUTTON_INVERSE_CLASS = 'button-surface--inverse';
export const BUTTON_LARGE_ICON_CLASS = 'button-surface--large-icon';
export const BUTTON_PLAY_CLASS = 'button-surface--play';
export const BUTTON_CLOSE_CLASS = [
  'button-close-surface',
  String.raw`tw:upto-small:[.ReactModalPortal_&]:top-0 tw:upto-small:[.ReactModalPortal_&]:right-0`,
  String.raw`tw:[.MuiPaper-root_.tabs_.tab\_\_panel_&]:top-[-4px]`,
  String.raw`tw:[.ReactModal\_\_Overlay_&]:m-0 tw:upto-small:[.ReactModal\_\_Overlay_&]:size-[var(--height-input)] tw:upto-small:[.ReactModal\_\_Overlay_&]:m-app-s tw:upto-small:[.ReactModal\_\_Overlay_&]:[background:var(--color-primary)]`,
  String.raw`tw:upto-small:[.ReactModal\_\_Overlay_&_.button-surface\_\_content]:items-center tw:upto-small:[.ReactModal\_\_Overlay_&_.button-surface\_\_content]:justify-center tw:upto-small:[.ReactModal\_\_Overlay_&_.button-surface\_\_content]:text-app-primary-contrast`,
].join(' ');
export const BUTTON_FIRE_GLOW_CLASS = String.raw`tw:[animation:shortsFireButtonGlow_2s_ease-out_forwards] tw:[[data-floating-player]_&]:[animation:floatingFireBtnGlow_2s_ease-out_forwards] tw:[.embed-reactions-overlay_&]:[animation:floatingFireBtnGlow_2s_ease-out_forwards] tw:[.player-fullscreen-target:fullscreen_&]:[animation:floatingFireBtnGlow_2s_ease-out_forwards] tw:[html.ios-fullscreen_.player-fullscreen-target_&]:[animation:floatingFireBtnGlow_2s_ease-out_forwards]`;
export const BUTTON_SLIME_GLOW_CLASS = String.raw`tw:[animation:shortsSlimeButtonGlow_3s_ease-out_forwards] tw:[[data-floating-player]_&]:[animation:floatingSlimeBtnGlow_3s_ease-out_forwards] tw:[.embed-reactions-overlay_&]:[animation:floatingSlimeBtnGlow_3s_ease-out_forwards] tw:[.player-fullscreen-target:fullscreen_&]:[animation:floatingSlimeBtnGlow_3s_ease-out_forwards] tw:[html.ios-fullscreen_.player-fullscreen-target_&]:[animation:floatingSlimeBtnGlow_3s_ease-out_forwards]`;

const BUTTON_FIRE_PARTICLE_BASE_CLASS = String.raw`tw:absolute tw:left-[20%] tw:size-[2px] tw:rounded-[50%] tw:bg-[#ef5a00] tw:[filter:drop-shadow(0_0_10px_#d43322)]`;
const BUTTON_SLIME_DROP_BASE_CLASS = String.raw`tw:absolute tw:size-[5px] tw:rounded-[50%] tw:bg-[#81c554] tw:[filter:drop-shadow(0_0_10px_#d43322)]`;

export const BUTTON_FIRE_EFFECT_CLASSES = {
  glow: String.raw`button__fire-glow tw:absolute tw:bottom-app-m tw:left-app-s tw:size-px tw:opacity-0 tw:[box-shadow:4px_0_10px_10px_var(--color-glow)] tw:[animation:glowDecay_2.5s_ease-out]`,
  particles: [
    String.raw`button__fire-particle1 ${BUTTON_FIRE_PARTICLE_BASE_CLASS} tw:top-[40%] tw:right-[10%] tw:[animation:particleUp_1.5s_ease-out_0s_2_normal_both]`,
    String.raw`button__fire-particle2 ${BUTTON_FIRE_PARTICLE_BASE_CLASS} tw:top-[60%] tw:[animation:particleUp2_2s_ease-out_0s_2_normal_both]`,
    String.raw`button__fire-particle3 ${BUTTON_FIRE_PARTICLE_BASE_CLASS} tw:top-[60%] tw:[animation:particleUp3_2.2s_ease-out_0s_2_normal_both]`,
    String.raw`button__fire-particle4 ${BUTTON_FIRE_PARTICLE_BASE_CLASS} tw:top-[40%] tw:right-[10%] tw:[animation:particleUp_1.5s_ease-out_0.5s_2_normal_both]`,
    String.raw`button__fire-particle5 ${BUTTON_FIRE_PARTICLE_BASE_CLASS} tw:top-[60%] tw:[animation:particleUp2_2s_ease-out_0.75s_2_normal_both]`,
    String.raw`button__fire-particle6 ${BUTTON_FIRE_PARTICLE_BASE_CLASS} tw:top-[60%] tw:[animation:particleUp3_2.2s_ease-out_0.25s_2_normal_both]`,
  ],
} as const;

export const BUTTON_SLIME_EFFECT_CLASSES = {
  stain: String.raw`button__slime-stain tw:absolute tw:bottom-app-m tw:left-app-s tw:size-px tw:opacity-0 tw:[box-shadow:4px_0_10px_10px_var(--color-slime)] tw:[animation:glowDecay_2.5s_ease-out]`,
  drops: [
    String.raw`button__slime-drop1 ${BUTTON_SLIME_DROP_BASE_CLASS} tw:top-[40%] tw:left-[15%] tw:[animation:dropDown_1.5s_ease-out_0s_1_normal_both]`,
    String.raw`button__slime-drop2 ${BUTTON_SLIME_DROP_BASE_CLASS} tw:top-[40%] tw:left-[35%] tw:[animation:dropDown2_1.5s_ease-out_0s_1_normal_both]`,
  ],
} as const;

export const BUTTON_GROUP_HOOK = 'button-group';
export const BUTTON_GROUP_CLASS = [
  String.raw`button-group tw:flex tw:[&_.button:first-child:not(:only-child)]:mr-[1px] tw:[&_.button:first-child:not(:only-child)]:rounded-r-none tw:[&_.button:nth-child(2)]:ml-[1px] tw:[&_.button:nth-child(2)]:rounded-l-none tw:[&_.button:nth-child(2):hover]:![fill:var(--color-text)] tw:[&_:is(.file-action-surface--button,.file-action-surface--menu):first-child]:mr-app-s`,
  String.raw`tw:[.channelPage-wrapper_&_.button-surface\_\_content_.icon]:stroke-app-text`,
  String.raw`tw:[.channel\_\_quick-actions_>_&_.button]:px-app-s tw:[.channel\_\_quick-actions_>_&_.button]:py-0 tw:[.channel\_\_quick-actions_>_&_.button]:!bg-[rgba(var(--color-background-base),0.9)] tw:[.channel\_\_quick-actions_>_&:not(:last-child)]:mr-app-s`,
  String.raw`tw:[@media(max-width:1020px)]:[.claim-preview\_\_wrapper--inline_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)_&]:m-0 tw:[@media(max-width:1020px)]:[.claim-preview\_\_wrapper--inline_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)_&]:flex-1`,
  String.raw`tw:[@media(max-width:1020px)]:[.claim-preview\_\_wrapper--inline_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)_&_.button:first-of-type]:w-full tw:[@media(max-width:1020px)]:[.claim-preview\_\_wrapper--inline_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)_&_.button:first-of-type]:flex-1 tw:[@media(max-width:1020px)]:[.claim-preview\_\_wrapper--inline_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)_&_.button:last-of-type]:w-[unset]`,
  String.raw`tw:[.claim-preview--channel_.claim-preview\_\_text_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)_&_button]:bg-app-primary tw:[.claim-preview--channel_.claim-preview\_\_text_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)_&_button]:text-app-primary-contrast`,
  String.raw`tw:[.claim-preview--channel_.claim-preview\_\_text_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)_&_a.button]:bg-app-background tw:[.claim-preview--channel_.claim-preview\_\_text_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)_&_a.button]:text-app-text tw:[.claim-preview--channel_.claim-preview\_\_text_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)_&_a.button:hover]:bg-app-primary tw:[.claim-preview--channel_.claim-preview\_\_text_:is(.claim-preview\_\_actions,.claim-preview\_\_actions--header)_&_a.button:hover]:text-app-primary-contrast`,
].join(' ');

export const BUTTON_TOGGLE_CLASS = 'button-toggle-surface';
export const BUTTON_TOGGLE_ACTIVE_CLASS = 'button-toggle-surface--active';
export const BUTTON_TOGGLE_EXPAND_MOBILE_CLASS = 'button-toggle-surface--expand-mobile';
export const BUTTON_TOGGLE_MORE_CLASS = 'button-toggle-surface--more';

const BUTTON_REACTION_CLASS = String.raw`reaction-button-surface tw:hover:[&_.button-surface\_\_label]:text-[var(--reaction-button-accent)] tw:focus-visible:[&_.button-surface\_\_label]:text-[var(--reaction-button-accent)] tw:hover:[&_.icon]:stroke-[var(--reaction-button-accent)] tw:focus-visible:[&_.icon]:stroke-[var(--reaction-button-accent)] tw:focus-visible:[box-shadow:0_0_0_2px_var(--reaction-button-accent)_inset] tw:[&.shorts-page\_\_actions-button_span]:flex tw:[&.shorts-page\_\_actions-button_span]:flex-col tw:[&.shorts-page\_\_actions-button_span]:items-center tw:[&.shorts-page\_\_actions-button_span]:justify-center`;
const BUTTON_REACTION_ACTIVE_CLASS = String.raw`reaction-button-surface--active tw:[&_.button-surface\_\_label]:text-[var(--reaction-button-accent)]`;

export const BUTTON_REACTION_LIKE_CLASS = `${BUTTON_REACTION_CLASS} reaction-button-surface--like tw:[--reaction-button-accent:var(--color-fire)]`;
export const BUTTON_REACTION_DISLIKE_CLASS = `${BUTTON_REACTION_CLASS} reaction-button-surface--dislike tw:[--reaction-button-accent:var(--color-slime)]`;
export const BUTTON_REACTION_LIKE_ACTIVE_CLASS = `${BUTTON_REACTION_ACTIVE_CLASS} tw:[&_path]:stroke-[var(--reaction-button-accent)]`;
export const BUTTON_REACTION_DISLIKE_ACTIVE_CLASS = BUTTON_REACTION_ACTIVE_CLASS;

export const BUTTON_NO_STYLE_CLASS = 'button-surface--unstyled';
export const BUTTON_DISABLED_CLASS = 'button--disabled button-surface--disabled';

export const BUTTON_CONTENT_CLASS = 'button-surface__content';
export const BUTTON_CONTENT_LEADING_CLASS = 'button-surface__content--leading';
export const BUTTON_CONTENT_TRAILING_CLASS = 'button-surface__content--trailing';

export const BUTTON_ICON_LEADING_CLASS = 'button-surface__icon button-surface__icon--leading';
export const BUTTON_ICON_TRAILING_CLASS = 'button-surface__icon button-surface__icon--trailing';

export const BUTTON_LABEL_CLASS = 'button-surface__label';
export const BUTTON_LABEL_RESERVED_CLASS = 'button__label--reserved tw:relative tw:grid';
export const BUTTON_LABEL_RESERVE_CLASS = 'button__label-reserve tw:invisible tw:[grid-area:1/1]';
export const BUTTON_LABEL_CURRENT_CLASS =
  'button__label-current tw:self-center tw:justify-self-center tw:[grid-area:1/1]';

export function getButtonVariantClass(button?: string | null) {
  switch (button) {
    case 'primary':
      return BUTTON_PRIMARY_CLASS;
    case 'secondary':
      return BUTTON_SECONDARY_CLASS;
    case 'alt':
      return BUTTON_ALT_CLASS;
    case 'inverse':
      return BUTTON_INVERSE_CLASS;
    case 'close':
      return BUTTON_CLOSE_CLASS;
    case 'link':
      return BUTTON_LINK_CLASS;
    case 'liquidass':
      return BUTTON_LIQUIDASS_CLASS;
    default:
      return button ? undefined : BUTTON_NO_STYLE_CLASS;
  }
}
