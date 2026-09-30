import { BUTTON_LINK_CLASS } from './button/classes.ts';
import { HELP_TEXT_CLASS } from './common/help-classes.ts';

export const FOOTER_CLASSES = {
  root: 'footer tw:m-auto tw:flex tw:max-w-[80%] tw:flex-col tw:items-center tw:justify-center tw:p-app-xl tw:text-app-small tw:opacity-0 tw:[animation-name:app-fade-in] tw:[animation-duration:2s] tw:[animation-delay:2s] tw:[animation-fill-mode:forwards] tw:upto-small:mb-app-xl tw:upto-small:max-w-full tw:upto-small:p-app-m tw:upto-small:pl-app-s',
  links: String.raw`tw:flex tw:flex-col tw:flex-wrap tw:items-center tw:justify-center tw:[&_.button-surface\_\_label]:text-[var(--color-text-help)] tw:[&_.footer\_\_link]:mb-0 tw:[&_.footer\_\_link]:ml-0 tw:[&_.footer\_\_link_.button_.button-surface\_\_label]:text-[rgba(var(--color-text-base),0.8)] tw:[&_.footer\_\_link_.button:hover_.button-surface\_\_label]:text-[rgba(var(--color-text-base),1)] tw:small:flex-row tw:small:[&_.footer\_\_link]:mx-app-s`,
  link: `footer__link ${BUTTON_LINK_CLASS} ${HELP_TEXT_CLASS} tw:mb-app-s tw:!text-[var(--color-link)] tw:hover:!text-[var(--color-link-hover)]`,
} as const;

export const PORTAL_FOOTER_CLASS = String.raw`tw:[&_.button-surface\_\_label]:!text-white`;
export const SHORTS_FOOTER_CLASS = 'tw:!hidden';
