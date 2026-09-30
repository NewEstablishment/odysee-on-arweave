const AUTOPLAY_TIMER_LINK_CONTENT_CLASS = String.raw`tw:[&_:is(.button-surface--link,.tab,.footer\_\_link,.button--uri-indicator,[data-comment-time],.comment\_\_action)_.button-surface\_\_content]:![align-items:normal] tw:[&_.markdown-preview_a_.button-surface\_\_content]:![align-items:normal] tw:[.markdown-preview_&_a_.button-surface\_\_content]:![align-items:normal]`;

export const AUTOPLAY_COUNTDOWN_CLASSES = {
  container: String.raw`content__autoplay-countdown tw:relative tw:flex tw:!h-full tw:w-full tw:flex-row tw:items-center tw:justify-center tw:rounded-t-app tw:bg-[var(--color-black)] tw:bg-[length:100%] tw:bg-center tw:bg-no-repeat tw:text-[var(--color-white)] tw:cursor-default tw:before:float-left tw:before:!pt-[unset] tw:before:content-[''] tw:after:block tw:after:clear-both tw:after:content-[''] tw:[.shorts\_\_viewer_&]:hidden tw:[.file-page\_\_video-container_&]:aspect-video tw:[.file-page\_\_video-container_&]:max-h-[var(--desktop-portrait-player-max-height)] tw:[&_[data-file-viewer-embedded-title]]:text-[0.875rem] tw:[&_[data-file-viewer-embedded-title]]:leading-[1.2] tw:[&_[data-file-viewer-overlay-logo]]:pl-0 tw:[&_[data-file-viewer-overlay-logo]_:is(.icon,[data-embed-overlay-logo],svg)]:!h-[24px] tw:[&_[data-file-viewer-overlay-logo]_:is(.icon,[data-embed-overlay-logo],svg)]:!w-auto tw:[&_[data-file-viewer-overlay-logo]_:is(.icon,[data-embed-overlay-logo],svg)]:max-w-none`,
  containerDraggable: 'draggable tw:cursor-grab',
  containerPlaying: 'playing tw:!absolute tw:z-[3]',
  root: 'tw:flex tw:w-full tw:flex-col tw:items-center tw:justify-center',
  secondary: String.raw`tw:upto-small:[[data-file-render-video]_&]:!mb-0`,
  timer: String.raw`tw:w-full tw:text-center tw:text-app-small ${AUTOPLAY_TIMER_LINK_CONTENT_CLASS}`,
  counter: String.raw`tw:mt-app-m tw:!text-white tw:upto-small:[[data-file-render-video]_&]:!mt-app-xxs`,
  button: String.raw`tw:inline-block tw:size-[86px] tw:rounded-[50%] tw:border-[3px] tw:border-solid tw:border-transparent tw:[transform:rotate(45deg)] tw:[transition:border_1s] tw:[&_.button]:bg-transparent tw:[&_.button]:[transform:rotate(-45deg)] tw:[&_.button:hover]:bg-app-primary`,
  progress: [
    '',
    'tw:border-white',
    'tw:border-t-white tw:border-r-white tw:border-b-white',
    'tw:border-t-white tw:border-r-white',
    'tw:border-t-white',
  ],
} as const;
