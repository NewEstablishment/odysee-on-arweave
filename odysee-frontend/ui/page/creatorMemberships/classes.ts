export const MEMBERSHIPS_LANDING_CLASSES = {
  page: 'memberships-wrapper tw:mx-auto tw:w-full tw:max-w-none',
  header: String.raw`memberships-header-wrapper tw:relative tw:mt-[calc(var(--spacing-l)*-1)] tw:h-[184px] tw:min-h-[var(--cover-photo-height)] tw:w-full tw:bg-fixed tw:bg-no-repeat tw:[background-image:url('https://thumbnails.odycdn.com/optimize/s:600:0/quality:95/plain/https://thumbs.odycdn.com/9bf7e0c6e616bb988e5a19b6dfa863cd.webp')] tw:[background-position:0_0] tw:[background-size:100%] tw:before:absolute tw:before:right-0 tw:before:bottom-0 tw:before:left-0 tw:before:h-full tw:before:w-full tw:before:bg-[linear-gradient(0deg,#0d0d0d_0,transparent_65%)] tw:before:opacity-100 tw:before:content-[''] tw:small:[background-position:0_-200px] tw:medium:[background-image:url('https://thumbnails.odycdn.com/optimize/s:1600:0/quality:95/plain/https://thumbs.odycdn.com/9bf7e0c6e616bb988e5a19b6dfa863cd.webp')] tw:medium:[background-position:calc(50%_+_var(--side-nav-width--micro)/2)_calc(0%_-_60px)] tw:large:[background-position:calc(50%_+_var(--side-nav-width--micro)/2)_calc(0%_-_120px)] tw:xlarge:[background-image:url('https://static.odycdn.com/images/banner_creatorPortal.jpg')]`,
  headerContent:
    'memberships-header tw:relative tw:mx-auto tw:flex tw:h-full tw:w-[calc(100%_-_2*var(--spacing-l))] tw:max-w-[var(--page-max-width)]',
  headerTitle: String.raw`tw:mt-auto tw:mb-app-m tw:w-fit tw:rounded-app tw:bg-[linear-gradient(147deg,var(--color-primary),rgb(247,121,55))] tw:p-app-m tw:text-[xx-large] tw:font-bold tw:text-white tw:[box-shadow:0_3px_6px_0_var(--color-shadow),0_4px_10px_0_rgba(0,0,0,0.6)] tw:[&_svg]:mr-app-s tw:[&_svg]:mb-[-4px] tw:[&_svg]:size-[30px] tw:[&_svg]:text-white`,
  content:
    'memberships-content tw:relative tw:mx-auto tw:mt-app-l tw:h-full tw:w-[calc(100%_-_2*var(--spacing-l))] tw:max-w-[var(--page-max-width)]',
  panels:
    'memberships tw:relative tw:flex tw:min-h-[50vh] tw:isolate tw:upto-small:min-h-[unset] tw:upto-small:flex-col',
  panel:
    'membership-wrapper tw:group tw:h-full tw:overflow-hidden tw:upto-small:![background-position:unset] tw:upto-small:![background-size:cover]',
  supporterPanel: String.raw`supporter tw:absolute tw:inset-y-0 tw:z-[1] tw:w-3/5 tw:rounded-[var(--border-radius)_0_0_var(--border-radius)] tw:[background-image:url('https://static.odycdn.com/images/banner_DonorPortal.jpg')] tw:[background-position:20%_-190px] tw:[transition:background-position_0.4s] tw:before:absolute tw:before:inset-0 tw:before:bg-[rgba(0,208,217,0)] tw:before:[transition:background-color_0.4s] tw:before:content-[''] tw:[&:hover]:[background-position:18%_-196px] tw:[&:hover]:before:bg-[rgba(0,208,217,0.1)] tw:upto-small:relative tw:upto-small:w-full tw:upto-small:rounded-[var(--border-radius)_var(--border-radius)_0_0]`,
  creatorPanel: String.raw`memberships tw:relative tw:z-[2] tw:ml-auto tw:flex tw:min-h-[50vh] tw:w-[55%] tw:isolate tw:rounded-[0_var(--border-radius)_var(--border-radius)_0] tw:[clip-path:polygon(20%_0,100%_0,100%_100%,0_100%)] tw:[background-image:url('https://static.odycdn.com/images/banner_creatorPortal.jpg')] tw:[background-position:10%_-170px] tw:[transition:background-position_0.4s] tw:before:absolute tw:before:inset-0 tw:before:z-0 tw:before:bg-[rgba(230,25,112,0)] tw:before:[transition:background-color_0.4s] tw:before:content-[''] tw:[&:hover]:[background-position:8%_-196px] tw:[&:hover]:before:bg-[rgba(230,25,112,0.1)] tw:upto-small:min-h-[unset] tw:upto-small:w-full tw:upto-small:flex-col tw:upto-small:rounded-[0_0_var(--border-radius)_var(--border-radius)] tw:upto-small:[clip-path:unset]`,
  panelContent:
    'membership-content tw:h-full tw:w-full tw:text-center tw:[transition:background-color_0.4s] tw:upto-small:!p-[4%]',
  supporterContent: 'tw:pt-[3%] tw:pr-[16%] tw:pl-[3%]',
  creatorContent: 'tw:mt-auto tw:pr-[3%] tw:pb-[3%] tw:pl-[10%]',
  panelCard: 'tw:rounded-[50px] tw:bg-app-header tw:p-app-m',
  panelTitle: String.raw`tw:mb-app-s tw:text-app-title tw:[font-weight:var(--font-bold)] tw:after:mx-[10px] tw:after:block tw:after:h-[2px] tw:after:w-4/5 tw:after:bg-[linear-gradient(147deg,var(--color-primary),rgb(247,121,55))] tw:after:[transition:width_0.2s,margin-left_0.2s] tw:after:content-[''] tw:group-hover:after:!ml-[5%] tw:group-hover:after:!w-[90%]`,
  tagline: 'portal-tagline tw:mb-[12px] tw:ml-[4px] tw:text-[17px]',
  errorColumn: 'errorColumn tw:flex tw:flex-col',
} as const;
