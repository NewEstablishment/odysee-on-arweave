export const SHORTS_MOBILE_PANEL_CLASS = String.raw`shorts-mobile-panel tw:fixed tw:top-[calc(50vh_-_25px)] tw:right-[10px] tw:z-[10000] tw:size-[50px] tw:pointer-events-none tw:[&_.claim-tile\_\_info]:flex tw:[&_.claim-tile\_\_info]:!flex-col tw:[&_.claim-preview\_\_actions]:!ml-[-80px] tw:[&_.claim-preview\_\_actions]:w-full tw:[&_:is([data-claim-preview-membership],.button-group)]:w-1/2 tw:[&_.claim-preview\_\_wrapper_.claim-preview--channel_.claim-preview\_\_text_.claim-preview\_\_actions]:!mt-[10px] tw:[@media(max-width:1020px)]:[&_.claim-preview\_\_wrapper_.claim-preview--channel_.claim-preview\_\_text_.claim-preview\_\_actions]:w-[calc(100%+3.8rem+2*var(--spacing-xs))] tw:[@media(min-width:1021px)]:hidden`;

export const SHORTS_MOBILE_PANEL_OPEN_CLASS = 'shorts-mobile-panel--modal-open tw:!inset-0 tw:!h-auto tw:!w-auto';

export const SHORTS_MOBILE_PANEL_BACKDROP_CLASS =
  'shorts-mobile-panel__backdrop tw:fixed tw:inset-0 tw:z-[10002] tw:flex tw:items-end tw:justify-center tw:bg-[rgba(0,0,0,0.7)] tw:pointer-events-auto tw:[-webkit-backdrop-filter:blur(4px)]';

export const SHORTS_MOBILE_PANEL_BACKDROP_CLOSING_CLASS = String.raw`shorts-mobile-panel__backdrop--closing tw:[&_.shorts-mobile-panel\_\_modal]:[animation:slideDownModal_0.25s_cubic-bezier(0.55,0.055,0.675,0.19)_forwards] tw:motion-reduce:[&_.shorts-mobile-panel\_\_modal]:[animation-duration:0.15s] tw:motion-reduce:[&_.shorts-mobile-panel\_\_modal]:[transition-duration:0.15s]`;

export const SHORTS_MOBILE_PANEL_MODAL_CLASS =
  'shorts-mobile-panel__modal tw:flex tw:max-h-[60vh] tw:w-full tw:max-w-[100vw] tw:[transform:translateY(0)] tw:flex-col tw:rounded-t-[16px] tw:border tw:border-app-border tw:bg-app-card tw:[box-shadow:0_-4px_20px_rgba(0,0,0,0.3)] tw:[animation:slideUpModal_0.3s_cubic-bezier(0.25,0.46,0.45,0.94)] tw:[@media(max-width:768px)_and_(orientation:landscape)]:max-h-[90vh] tw:motion-reduce:[animation-duration:0.15s] tw:motion-reduce:[transition-duration:0.15s]';

export const SHORTS_MOBILE_PANEL_MODAL_CLOSING_CLASS =
  'shorts-mobile-panel__modal--closing tw:[animation:slideDownModal_0.25s_cubic-bezier(0.55,0.055,0.675,0.19)_forwards] tw:motion-reduce:[animation-duration:0.15s] tw:motion-reduce:[transition-duration:0.15s]';

export const SHORTS_MOBILE_PANEL_HEADER_CLASS =
  'shorts-mobile-panel__header tw:relative tw:shrink-0 tw:rounded-t-[16px] tw:border-b tw:border-b-app-border tw:bg-app-header tw:px-app-m tw:py-app-s tw:[@media(max-width:768px)_and_(orientation:landscape)]:py-app-xs';

export const SHORTS_MOBILE_PANEL_DRAG_HANDLE_CLASS =
  'shorts-mobile-panel__drag-handle tw:mx-auto tw:mt-0 tw:mb-[12px] tw:h-[4px] tw:w-[40px] tw:cursor-grab tw:touch-none tw:select-none tw:rounded-[2px] tw:bg-app-text-subtitle tw:opacity-60 tw:active:cursor-grabbing tw:[@media(max-width:768px)_and_(orientation:landscape)]:mb-app-xs';

export const SHORTS_MOBILE_PANEL_TITLE_CLASS = String.raw`shorts-mobile-panel__title-section tw:flex tw:items-center tw:justify-between tw:gap-app-m tw:[&_h3]:m-0 tw:[&_h3]:flex-1 tw:[&_h3]:[font-size:var(--font-base)] tw:[&_h3]:font-bold tw:[&_h3]:text-app-text`;

export const SHORTS_MOBILE_PANEL_CLOSE_BUTTON_CLASS = String.raw`shorts-mobile-panel__close-button tw:flex tw:!size-[32px] tw:!min-h-[32px] tw:!min-w-[32px] tw:shrink-0 tw:cursor-pointer tw:!items-center tw:!justify-center tw:!rounded-[50%] tw:![border:none] tw:!bg-[var(--color-button-secondary-bg)] tw:!text-app-text tw:[transition:background-color_0.2s_ease] tw:[&_.icon]:!text-app-text tw:[&:hover]:!bg-[var(--color-button-secondary-bg-hover)]`;

export const SHORTS_MOBILE_PANEL_CONTENT_CLASS =
  'shorts-mobile-panel__content tw:max-h-[calc(85vh_-_80px)] tw:flex-1 tw:overflow-x-hidden tw:overflow-y-auto tw:p-app-m tw:[-webkit-overflow-scrolling:touch] tw:scroll-smooth tw:[@media(max-width:768px)_and_(orientation:landscape)]:max-h-[calc(90vh_-_70px)]';

export const SHORTS_MOBILE_PANEL_FILE_SECTION_CLASS = 'shorts-mobile-panel__file-section tw:mb-app-l';

export const SHORTS_MOBILE_PANEL_COMMENTS_CLASS = String.raw`shorts-mobile-panel__comments-section tw:[&_h4]:mt-0 tw:[&_h4]:mr-0 tw:[&_h4]:mb-app-m tw:[&_h4]:ml-0 tw:[&_h4]:border-b tw:[&_h4]:border-b-app-border tw:[&_h4]:pb-app-xs tw:[&_h4]:text-app-small tw:[&_h4]:font-bold tw:[&_h4]:tracking-[0.5px] tw:[&_h4]:text-app-text tw:[&_h4]:uppercase tw:[&_.comments]:max-h-none tw:[&_.comments_.comment]:mb-app-s tw:[&_.comments_.comment]:rounded-[8px] tw:[&_.comments_.comment]:border tw:[&_.comments_.comment]:border-app-border tw:[&_.comments_.comment]:bg-app-card-highlighted tw:[&_.comments_.comment]:p-app-s tw:[&_.comments_.comment:hover]:bg-app-card`;
