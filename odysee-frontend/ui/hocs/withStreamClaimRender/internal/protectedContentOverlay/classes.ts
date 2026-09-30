import { STREAM_CLAIM_OVERLAY_INTERACTIONS_CLASS } from '../../classes.ts';

export const PROTECTED_CONTENT_OVERLAY_CLASS = String.raw`tw:absolute tw:z-[5] tw:flex tw:size-full tw:flex-col tw:items-center tw:justify-center tw:rounded-app tw:bg-[rgba(0,0,0,0.5)] tw:text-white tw:[-webkit-backdrop-filter:blur(2px)] tw:[backdrop-filter:blur(4px)] tw:[&_.button]:mt-app-s tw:[&_.button]:[background-image:var(--color-odysee-gradient)] tw:upto-small:[&_span]:text-center ${STREAM_CLAIM_OVERLAY_INTERACTIONS_CLASS}`;
