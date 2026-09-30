export const ODYSEE_PREMIUM_CLASSES = {
  explanation: String.raw`premium-explanation-surface tw:mb-[21px] tw:[&_.icon--ChevronDown]:size-[24px] tw:[&_.icon--ChevronUp]:size-[24px] tw:[&_.icon--ChevronUp]:mt-[-2px] tw:[&_.icon--ChevronUp]:mb-[2px] tw:[&_.card\_\_main-actions]:mb-[15px] tw:[&_.button-close-surface]:mt-[3px] tw:[&_.button-close-surface]:w-[34px] tw:[&_.section\_\_subtitle]:mb-[25px] tw:[&_li]:ml-app-l`,
  info: 'membership_info tw:text-app-small',
  option: String.raw`premium-option-surface tw:mb-app-m tw:rounded-app tw:bg-[rgba(var(--color-header-button-base),0.6)] tw:p-app-m tw:[&_.button]:max-w-full`,
  subtitle: 'membership_subtitle tw:mb-app-s tw:text-app-small tw:text-app-text-subtitle',
  title: String.raw`odysee-premium-title membership_title tw:mt-app-l tw:text-[18px] tw:font-bold tw:first-of-type:mt-0 tw:[&_.comment\_\_badge]:ml-app-s tw:[&_.comment\_\_badge_svg]:size-[2rem] tw:[&_.comment\_\_badge_.icon]:mb-[-6px]`,
} as const;
