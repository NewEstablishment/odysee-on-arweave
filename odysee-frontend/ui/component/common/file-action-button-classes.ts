const FILE_ACTION_SURFACE_CLASS = [
  'file-action-surface',
  String.raw`tw:[.MuiPaper-root_:is(.emote-selector\_\_items,.sticker-selector\_\_items)_&]:[background:unset]`,
  String.raw`tw:[@media(any-pointer:fine)]:[.claim-preview:hover_&_.icon]:stroke-[#f3f4f6]`,
  String.raw`tw:[.media\_\_actions_&]:bg-[unset] tw:[.media\_\_actions_&_.icon]:[transform:rotate(0deg)] tw:[.media\_\_actions_&_.icon]:[transition:transform_0.2s] tw:[.media\_\_actions_&[aria-expanded='true']]:!bg-[var(--color-header-button)] tw:[.media\_\_actions_&[aria-expanded='true']_.icon]:[transform:rotate(90deg)]`,
  String.raw`tw:upto-small:[.media\_\_actions_&]:mb-app-xxs tw:upto-small:[.media\_\_actions_&]:mr-app-xxxs tw:upto-small:[.media\_\_actions_&]:flex tw:upto-small:[.media\_\_actions_&]:items-center tw:upto-small:[.media\_\_actions_&]:justify-center tw:upto-small:[.media\_\_actions_>_&:last-child]:mr-0 tw:upto-small:[.media\_\_actions_&_.button-surface\_\_content]:justify-between tw:upto-small:[.media\_\_actions_&_.button-surface\_\_label]:[margin:0_0_0_var(--spacing-xxxs)] tw:upto-small:[.media\_\_actions_&_.button-surface\_\_label]:text-app-small`,
  String.raw`tw:active-fullscreen-side-panel:p-0 tw:active-fullscreen-side-panel:[.media\_\_actions_&]:mb-app-xxs tw:active-fullscreen-side-panel:[.media\_\_actions_&]:mr-app-xxxs tw:active-fullscreen-side-panel:[.media\_\_actions_&]:flex tw:active-fullscreen-side-panel:[.media\_\_actions_&]:items-center tw:active-fullscreen-side-panel:[.media\_\_actions_&]:justify-center tw:active-fullscreen-side-panel:[.media\_\_actions_>_&:last-child]:mr-0 tw:active-fullscreen-side-panel:[.media\_\_actions_&_.button-surface\_\_content]:justify-between tw:active-fullscreen-side-panel:[.media\_\_actions_&_.button-surface\_\_label]:[margin:0_0_0_var(--spacing-xxxs)] tw:active-fullscreen-side-panel:[.media\_\_actions_&_.button-surface\_\_label]:text-app-small`,
].join(' ');

const FILE_ACTION_MENU_CONTEXT_CLASS = String.raw`tw:upto-small:[.media\_\_actions_&]:w-[unset] tw:upto-small:[.media\_\_actions_&]:min-w-0 tw:upto-small:[.media\_\_actions_&]:grow-[0.4] tw:upto-small:[.media\_\_actions_&]:basis-0 tw:active-fullscreen-side-panel:[.media\_\_actions_&]:w-[unset]`;

export const FILE_ACTION_BUTTON_CLASS = `${FILE_ACTION_SURFACE_CLASS} file-action-surface--button`;
export const FILE_ACTION_MENU_BUTTON_CLASS = `${FILE_ACTION_SURFACE_CLASS} file-action-surface--menu ${FILE_ACTION_MENU_CONTEXT_CLASS}`;
