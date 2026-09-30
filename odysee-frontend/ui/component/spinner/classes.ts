export const SPINNER_CLASS = String.raw`spinner tw:m-app-s tw:h-[40px] tw:w-[50px] tw:text-center tw:text-[10px] tw:[.empty_&]:m-0 tw:[.empty_&]:h-[var(--height-input)] tw:[.empty_&]:w-full tw:[.empty_&]:max-w-[unset] tw:[.empty_&]:rounded-app tw:[.empty_&]:border-2 tw:[.empty_&]:border-solid tw:[.empty_&]:border-app-border tw:[.empty_&]:bg-[var(--color-input-bg)] tw:[[data-claim-list-header]_&]:ml-app-m tw:[[data-claim-preview-pending]_.claim-preview-info_.confirming-change_&]:m-0 tw:[[data-claim-preview-pending]_.claim-preview-info_.confirming-change_&_.rect]:bg-[var(--color-spinner-light)] tw:[.playlist-preview\_\_wrapper_.pending-change_&]:h-[16px] tw:[.comments_&]:[background:unset] tw:[.comments_&]:[border:unset] tw:[.comment\_\_replies-loading_&]:m-0 tw:[.comment\_\_replies-loading--more_&]:m-0 tw:[.comment\_\_replies-loading_&_.rect]:!bg-app-link tw:[.button-surface--primary_&]:h-[30px] tw:[.button-surface--primary_&_.rect]:bg-app-primary-contrast`;

export const SPINNER_VARIANT_CLASSES = {
  dark: 'spinner--dark tw:[&_.rect]:bg-[var(--color-spinner-dark)]',
  light: 'spinner--light tw:[&_.rect]:bg-[var(--color-spinner-light)]',
  small: 'spinner--small tw:inline-block tw:!h-[10px] tw:[&_.rect]:w-[3px]',
} as const;

const SPINNER_RECT_CLASS =
  'rect tw:mx-[2px] tw:inline-block tw:h-full tw:w-[6px] tw:animate-[sk-stretchdelay_1.2s_infinite_ease-in-out]';

export const SPINNER_RECT_CLASSES = [
  `${SPINNER_RECT_CLASS} rect1`,
  `${SPINNER_RECT_CLASS} rect2 tw:[animation-delay:-1.1s]`,
  `${SPINNER_RECT_CLASS} rect3 tw:[animation-delay:-1s]`,
  `${SPINNER_RECT_CLASS} rect4 tw:[animation-delay:-0.9s]`,
  `${SPINNER_RECT_CLASS} rect5 tw:[animation-delay:-0.8s]`,
] as const;

export const SPINNER_AREA_CENTERED_CLASS = 'tw:text-center';
