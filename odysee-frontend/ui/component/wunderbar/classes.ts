import { HEADER_ICON_BASE_CLASSES, HEADER_ICON_SURFACE_CLASSES } from '../header/classes.ts';

const WUNDERBAR_CONTROL_LAYOUT_CLASS = String.raw`tw:relative tw:z-[1] tw:flex tw:h-[var(--height-input)] tw:cursor-text tw:items-center tw:pl-app-s tw:text-app-small tw:[&>.icon]:absolute tw:[&>.icon]:top-0 tw:[&>.icon]:left-app-s tw:[&>.icon]:z-[1] tw:[&>.icon]:h-full tw:[&>.icon]:stroke-[var(--color-input-placeholder)] tw:small:p-0 tw:upto-small:[&>.icon]:left-[22px]`;
const WUNDERBAR_INPUT_LAYOUT_CLASS = String.raw`tw:h-[var(--height-input)] tw:w-full tw:min-w-0 tw:items-center tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:rounded-app tw:[border:0] tw:bg-[var(--color-header-button)] tw:pr-app-l tw:pl-[2.2rem] tw:text-[var(--color-input)] tw:[-webkit-app-region:no-drag] tw:focus:[box-shadow:0_0_0_var(--form-control-ring-width)_var(--color-primary)_inset]`;

export const WUNDERBAR_CLASS = `wunderbar ${WUNDERBAR_CONTROL_LAYOUT_CLASS}`;

export const WUNDERBAR_INLINE_CLASS = `${String.raw`wunderbar--inline`} ${WUNDERBAR_CONTROL_LAYOUT_CLASS} ${String.raw`tw:mr-0 tw:[flex:0] tw:[&_fieldset-section]:w-[15rem] tw:[&_.fieldset-section]:w-[15rem] tw:upto-small:mx-0 tw:upto-small:my-app-xxs tw:upto-small:pl-0 tw:upto-small:[&_.icon]:!left-[11px]`}`;

export const WUNDERBAR_INPUT_CLASS = `wunderbar__input ${WUNDERBAR_INPUT_LAYOUT_CLASS}`;

export const WUNDERBAR_INPUT_INLINE_CLASS = `wunderbar__input--inline ${WUNDERBAR_INPUT_LAYOUT_CLASS} tw:upto-small:absolute tw:upto-small:top-0`;

export const WUNDERBAR_MOBILE_SEARCH_CLASS = String.raw`wunderbar__mobile-search ${HEADER_ICON_BASE_CLASSES} ${HEADER_ICON_SURFACE_CLASSES} tw:upto-small:mr-app-s! tw:[&_.button-surface\_\_label]:text-[var(--color-input-placeholder)] tw:[&_.button-surface\_\_label]:opacity-40 tw:hover:[&_.button-surface\_\_label]:text-app-text`;

export const WUNDERBAR_WRAPPER_CLASS = String.raw`wunderbar__wrapper tw:mr-app-s tw:max-w-[30rem] tw:flex-1`;

export const WUNDERBAR_CLEAR_CLASS = String.raw`wunderbar__clear tw:absolute tw:right-app-s tw:p-0 tw:[background:unset]! tw:[&_.icon]:[transform:rotate(0deg)] tw:[&_.icon]:[transition:transform_0.2s] tw:hover:[&_.icon]:[transform:rotate(90deg)] tw:hover:[&_.icon]:stroke-app-primary tw:upto-small:top-[3px] tw:upto-small:right-[75px]`;
