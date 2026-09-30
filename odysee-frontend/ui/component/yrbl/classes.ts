export const YRBL_CLASSES = {
  alwaysShow: 'tw:block',
  content: 'tw:max-w-[400px]',
  image: 'tw:h-[10rem] tw:small:mr-[calc(var(--spacing-xl)*2)] tw:small:block tw:small:h-[20rem]',
  root: String.raw`tw:flex tw:flex-col tw:flex-wrap tw:items-center tw:justify-center tw:text-left tw:small:flex-row tw:upto-small:[.channelsPage-wrapper_&]:mt-app-l tw:[&_:is(.section\_\_actions,.section\_\_actions--centered,.section\_\_actions--between,.section\_\_actions--no-margin)]:flex-wrap tw:[&_:is(.section\_\_actions,.section\_\_actions--centered,.section\_\_actions--between,.section\_\_actions--no-margin)>*]:mb-app-s`,
} as const;
