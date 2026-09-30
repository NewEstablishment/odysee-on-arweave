import { STREAM_CLAIM_OVERLAY_INTERACTIONS_CLASS } from '../../classes.ts';

export const PAID_CONTENT_OVERLAY_CLASSES = {
  overlay: `tw:absolute tw:top-0 tw:left-0 tw:size-full tw:text-center ${STREAM_CLAIM_OVERLAY_INTERACTIONS_CLASS}`,
  body: String.raw`paid-content-overlay__body tw:z-[5] tw:flex tw:size-full tw:flex-col tw:items-center tw:justify-center tw:rounded-app tw:bg-transparent tw:text-white tw:[&_[data-purchase-button]:not([data-purchase-button-fee])]:!bg-[var(--color-fiat-payment)]`,
  prompt: 'paid-content-prompt tw:flex tw:flex-col tw:items-start',
  promptOverlay: String.raw`paid-content-prompt--overlay tw:w-[min(100%,30rem)] tw:!items-center tw:rounded-[calc(var(--border-radius)*1.5)] tw:border tw:border-[rgba(255,255,255,0.18)] tw:bg-[linear-gradient(180deg,rgba(20,20,20,0.58)_0%,rgba(20,20,20,0.78)_100%)] tw:px-app-l tw:py-app-m tw:[box-shadow:0_1.25rem_3rem_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] tw:[&_.paid-content-prompt\_\_price:last-of-type]:mb-app-m`,
  price: 'paid-content-prompt__price tw:mb-app-s tw:text-app-body tw:[&_.icon]:mr-app-xs tw:[&_.icon]:mb-[-2px]',
} as const;
