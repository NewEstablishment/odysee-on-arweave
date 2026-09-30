export const UPCOMING_CLAIMS_CLASSES = {
  counter:
    'tw:ml-app-xs tw:flex tw:size-[20px] tw:justify-center tw:rounded-[50%] tw:bg-app-background tw:text-app-xsmall',
  root: String.raw`tw:[transition:min-height_0.2s,height_0.2s] tw:[&_.button-surface\_\_content]:w-full tw:[&_.button-surface\_\_content:hover]:cursor-pointer`,
  grid: 'tw:h-[342px] tw:min-h-[342px] tw:upto-small:h-auto tw:upto-small:min-h-0 tw:upto-small:!mb-app-xl tw:xlarge:h-[400px] tw:xlarge:min-h-[400px] tw:xxlarge:h-[500px] tw:xxlarge:min-h-[500px]',
  list: 'tw:[.channelPage-wrapper_&]:mb-app-m',
  extended: String.raw`tw:h-[684px] tw:min-h-[684px] tw:[&[data-upcoming-list]]:h-auto tw:upto-small:h-auto tw:upto-small:min-h-0 tw:xlarge:h-[800px] tw:xlarge:min-h-[800px] tw:xxlarge:h-[1000px] tw:xxlarge:min-h-[1000px]`,
  closed: 'tw:!h-0 tw:!min-h-0',
  visibility: String.raw`tw:mt-[-9px] tw:ml-auto tw:flex tw:h-[var(--height-button)] tw:items-center tw:rounded-app tw:bg-[var(--color-header-button)] tw:px-app-m tw:py-0 tw:[&_.icon]:mr-app-xs tw:[&_.icon]:stroke-app-text tw:[&_span]:mt-[2px] tw:[&_span]:text-app-small tw:[&_span]:font-bold tw:[&_span]:text-app-text tw:hover:cursor-pointer tw:hover:bg-app-primary tw:hover:[&_.icon]:stroke-app-primary-contrast tw:hover:[&_span]:text-app-primary-contrast`,
} as const;
