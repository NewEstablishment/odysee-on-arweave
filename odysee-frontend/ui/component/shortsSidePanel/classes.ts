export const SHORTS_SIDE_PANEL_CLASSES = {
  root: String.raw`tw:fixed tw:top-[var(--header-height)] tw:right-[-720px] tw:z-[2] tw:flex tw:h-[calc(100vh_-_var(--header-height))] tw:w-[720px] tw:!isolate tw:flex-col tw:bg-[var(--color-card-background)] tw:pt-0 tw:[box-shadow:-2px_0_10px_rgba(0,0,0,0.3)] tw:[transition:right_0.3s_cubic-bezier(0.4,0,0.2,1)] tw:supports-[height:100dvh]:h-[calc(100dvh_-_var(--header-height))] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:right-[calc(var(--shorts-viewer-width,var(--shorts-viewer-width-default))_+_40px_-_100vw)] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:w-[min(calc(100vw_-_var(--shorts-viewer-width,var(--shorts-viewer-width-default))_-_40px),640px)] tw:[@media(min-width:1020px)_and_(max-width:1400px)]:[&_.claim-preview\_\_text]:!flex-col`,
  open: 'tw:!right-0',
  closeButtonContainer: 'tw:mt-0 tw:flex tw:items-center tw:justify-end tw:px-[20px] tw:py-[5px]',
  closeButton: String.raw`tw:relative tw:w-fit tw:text-app-text tw:hover:rounded-[5px] tw:hover:[background:var(--color-button-secondary-bg-hover)] tw:[@media(max-width:1020px)]:cursor-pointer tw:[@media(max-width:1020px)]:rounded-[4px] tw:[@media(max-width:1020px)]:border-none tw:[@media(max-width:1020px)]:bg-transparent tw:[@media(max-width:1020px)]:p-app-xs tw:[@media(max-width:1020px)]:text-app-text`,
  content: 'tw:flex-1 tw:overflow-y-auto tw:p-app-m tw:scroll-smooth',
  comments: 'shorts-page__side-panel-comments tw:mt-app-l tw:pt-app-m',
  commentsTitle: 'shorts-page__side-panel-comments-title tw:mb-app-m tw:border-b tw:border-b-app-border tw:pb-app-xs',
} as const;
