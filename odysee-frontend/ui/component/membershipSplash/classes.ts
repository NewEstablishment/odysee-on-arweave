export const MEMBERSHIP_SPLASH_CLASSES = {
  root: String.raw`tw:flex tw:flex-col tw:flex-wrap tw:justify-around tw:px-[10rem] tw:[transition:padding_0.6s] tw:[&_*::selection]:bg-black tw:[&_*::selection]:text-white tw:xlarge:mx-[-16rem] tw:xlarge:px-0 tw:upto-medium:px-[4rem] tw:upto-small:px-[unset] tw:xlarge:[.modal_&]:mx-0 tw:xlarge:[.modal_&]:px-0 tw:small:[.modal_&]:px-[unset]`,
  banner: 'tw:mb-app-xxs tw:flex tw:flex-auto tw:items-center tw:bg-[#283263] tw:upto-small:flex-col-reverse',
  bannerImage: 'tw:flex tw:w-1/2 tw:basis-1/2 tw:upto-small:w-full tw:upto-small:basis-full',
  title: String.raw`tw:inline-block tw:w-full tw:basis-1/2 tw:px-app-l tw:py-0 tw:text-[2.3vw] tw:leading-[2.8vw] tw:text-white tw:[font-weight:100] tw:upto-small:mb-[1.6rem] tw:upto-small:text-[2rem] tw:upto-small:leading-[2.1rem] tw:small:[.modal_&]:px-app-m tw:small:[.modal_&]:text-[1.6rem] tw:small:[.modal_&]:leading-[1.7rem]`,
  titleStrong: 'tw:[font-weight:900]',
  logoSection: 'tw:mb-[2rem] tw:small:[.modal_&]:mb-app-m',
  logo: 'tw:flex tw:w-[96%] tw:basis-1/2 tw:upto-small:mt-[1.6rem] tw:upto-small:basis-full tw:upto-small:[.modal_&]:mt-app-l',
  infoWrapper: 'tw:flex tw:basis-full tw:upto-small:flex-col',
  info: 'tw:relative tw:basis-[33%] tw:bg-white tw:pb-[4.2rem] tw:text-black tw:upto-small:mb-app-xxs tw:upto-small:basis-full',
  introInfo: 'tw:!p-[3%] tw:upto-small:leading-[1.5rem]',
  introTitle: String.raw`balance-text tw:text-[1vw] tw:upto-medium:text-[1.3vw] tw:upto-small:text-[0.9rem] tw:small:[.modal_&]:p-app-m tw:small:[.modal_&]:text-[0.7rem]`,
  premiumInfo: 'tw:mx-app-xxs tw:upto-small:mx-0',
  premiumPlusInfo: '',
  infoHeader: 'tw:mb-[18px]',
  premiumHeader: 'tw:bg-[#d5cee5] tw:text-[#626092]',
  premiumPlusHeader: 'tw:bg-[#ffd976] tw:text-[#c95b16]',
  infoPrice:
    'tw:flex tw:items-center tw:justify-center tw:text-[2.6vw] tw:[font-weight:900] tw:upto-small:text-[2.2rem]',
  infoPriceImage: String.raw`tw:mr-[7%] tw:inline-block tw:w-[36%] tw:xlarge:w-[33%] tw:upto-medium:w-[30%] tw:upto-small:mx-[1.4rem] tw:upto-small:w-[5rem] tw:small:[.modal_&]:mx-app-s`,
  infoPriceValue: 'tw:inline-block tw:small:[.modal_&]:text-[1.6rem]',
  infoRange: String.raw`tw:mt-[-10px] tw:text-[1rem] tw:xlarge:mt-[-1.6rem] tw:xlarge:text-[1.8rem] tw:small:[.modal_&]:mt-[-10px] tw:small:[.modal_&]:text-[0.8rem]`,
  infoContent:
    'tw:mt-[8px] tw:flex tw:items-center tw:justify-center tw:small:[.modal_&]:pl-app-xxs tw:small:[.modal_&]:text-[0.7rem]',
  infoContentIcon:
    'tw:mr-app-xs tw:w-[2rem] tw:shrink-0 tw:small:[.modal_&]:mr-app-xxs tw:small:[.modal_&]:size-[1.7rem]',
  infoContentTitle:
    'balance-text tw:w-[156px] tw:text-[1vw] tw:[font-weight:900] tw:upto-medium:text-[1.3vw] tw:upto-small:w-[300px] tw:upto-small:text-[0.9rem]',
  infoButton: String.raw`tw:absolute tw:bottom-0 tw:mx-app-m tw:mb-app-m tw:inline-block tw:w-[calc(100%_-_var(--spacing-m)*2)] tw:text-center tw:small:[.modal_&]:ml-app-xs`,
  joinButton: String.raw`tw:inline-block tw:rounded-[20px] tw:border-2 tw:border-solid tw:border-[#debca0] tw:!bg-[unset] tw:px-[20px] tw:py-[8px] tw:text-center tw:hover:!bg-[unset] tw:xlarge:mb-[3%] tw:xlarge:h-[4.8rem] tw:xlarge:rounded-[2.4rem] tw:xlarge:px-[40px] tw:xlarge:py-[18px] tw:upto-small:box-border tw:upto-small:px-[10px] tw:upto-small:py-[8px] tw:small:[.modal_&]:px-[6px] tw:small:[.modal_&]:py-[4px] tw:xlarge:[.modal_&]:mb-[3%] tw:xlarge:[.modal_&]:h-[var(--height-button)] tw:xlarge:[.modal_&]:rounded-[2.4rem]`,
  joinButtonContent: '',
  joinButtonLabel: String.raw`tw:inline-block tw:self-center tw:text-[17px] tw:leading-[2rem] tw:text-[#debca0] tw:uppercase tw:[font-weight:var(--font-weight-bold)] tw:xlarge:leading-[4rem] tw:upto-small:text-[1.2rem] tw:small:[.modal_&]:text-[0.74rem] tw:xlarge:[.modal_&]:leading-[2rem]`,
} as const;
