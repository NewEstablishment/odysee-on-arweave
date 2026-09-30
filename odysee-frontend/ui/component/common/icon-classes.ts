export const ICON_HELP_CLASS = 'icon--help tw:ml-app-xs tw:text-[var(--color-subtitle)] tw:opacity-70';

export const ICON_WRAPPER_CLASS = String.raw`icon__wrapper tw:relative tw:my-0 tw:flex tw:size-[3.5rem] tw:items-center tw:justify-center tw:rounded-[1.75rem] tw:bg-[var(--color-header-background)] tw:p-[1.5rem] tw:[&_.icon]:absolute tw:[&_.icon]:stroke-[var(--color-text)]`;

export const ICON_NAME_CLASSES: Partial<Record<string, string>> = {
  BadgeAdmin: String.raw`tw:[[data-comment-meta-information]_.comment\_\_badge_&]:mb-[-2px] tw:[[data-comment-meta-information]_.comment\_\_badge_&]:size-[0.96rem]`,
  BadgeMod: String.raw`tw:[[data-comment-meta-information]_.comment\_\_badge_&]:mb-[-2px] tw:[[data-comment-meta-information]_.comment\_\_badge_&]:size-[0.96rem]`,
  BadgeSprout: String.raw`tw:[[data-comment-meta-information]_.comment\_\_badge_&]:mb-[-2px] tw:[[data-comment-meta-information]_.comment\_\_badge_&]:size-[0.96rem]`,
  DollarSign: String.raw`tw:[.media\_\_actions_&]:mr-[-4px] tw:[.media\_\_actions_&]:[transform:scale(0.8)] tw:[.media\_\_actions_&]:[stroke-width:1.5] tw:[.modal--send-tip_&]:size-[16px] tw:upto-small:[.media\_\_actions_&]:mr-0 tw:active-fullscreen-side-panel:[.media\_\_actions_&]:mr-0`,
  ExternalLink: String.raw`tw:mt-[-5px] tw:!ml-app-xxs tw:[.markdown-preview_&]:shrink-0 tw:[.markdown-preview_&]:!mb-[-1px] tw:[.comment\_\_menu-option_&]:!ml-0 tw:[.comment\_\_menu-option_[data-comment-menu-help]_&]:mt-[unset] tw:[[data-membership-payments-table]_&]:mt-[unset]`,
  Fire: String.raw`tw:relative tw:after:absolute tw:after:top-0 tw:after:right-0 tw:after:size-[20px] tw:after:bg-[red] tw:after:content-['']`,
  Heart: String.raw`tw:[.page\_\_title_&]:fill-app-background tw:[.page\_\_title_&]:!stroke-transparent tw:[[data-claim-preview-overlay-properties]_&]:text-[var(--color-transparent)] tw:[.main\_\_channelsFollowing_&]:mt-[-1.5px]`,
  Key: 'tw:[[data-file-viewer-embedded-header]_&]:mr-app-m',
  Lock: String.raw`tw:[[data-protected-content-overlay]_&]:mb-app-xxxs tw:[[data-protected-content-overlay]_&]:size-[60px] tw:[[data-protected-content-overlay]_&]:overflow-visible tw:[[data-protected-content-overlay]_&]:rounded-[50%] tw:[[data-protected-content-overlay]_&]:bg-white tw:[[data-protected-content-overlay]_&]:p-app-s tw:[[data-protected-content-overlay]_&]:text-[var(--color-fire)] tw:[[data-protected-content-overlay]_&]:[stroke-width:3]`,
  Membership: String.raw`tw:[[data-comment-meta-information]_.comment\_\_badge_&]:mb-[-2px] tw:[[data-comment-meta-information]_.comment\_\_badge_&]:size-[0.9rem]`,
  Plus: String.raw`tw:upto-small:[.media\_\_actions_&]:top-[-2px] tw:active-fullscreen-side-panel:[.media\_\_actions_&]:top-[-2px]`,
  PremiumPlus: String.raw`tw:[[data-comment-meta-information]_.comment\_\_badge_&]:mb-[-1.5px] tw:[[data-comment-meta-information]_.comment\_\_badge_&]:size-[1.2rem]`,
  Upgrade: 'tw:mt-[2px]',
  UploadCloud: String.raw`tw:[.playlist-preview\_\_wrapper_.content_.text_.title_h2_&]:ml-app-s tw:[.playlist-preview\_\_wrapper_.content_.text_.title_h2_&]:stroke-[rgb(244,44,44)]`,
};

export const ICON_WRAPPER_NAME_CLASSES: Partial<Record<string, string>> = {
  Anonymous: String.raw`tw:!bg-[var(--color-gray-1)] tw:[&_.icon]:![stroke:var(--color-black)]`,
  Eye: String.raw`tw:!bg-[var(--color-header-button)] tw:[&_.icon]:![stroke:var(--color-view-icon)]`,
  Heart: String.raw`tw:!bg-[var(--color-header-button)] tw:[&_.icon]:![fill:var(--color-follow-icon)] tw:[&_.icon]:![stroke:var(--color-follow-icon)]`,
  PremiumPlusBadge: String.raw`tw:ml-[3px] tw:!mb-[-9px] tw:!inline-block tw:!size-[22px] tw:!p-0 tw:[&>svg]:mt-[-2px]`,
};

export const ICON_MARGIN_RIGHT_CLASS = 'tw:mr-app-xs';
