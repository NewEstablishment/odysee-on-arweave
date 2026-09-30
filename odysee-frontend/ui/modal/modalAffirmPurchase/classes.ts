export const AFFIRM_PURCHASE_CLASSES = {
  purchased: String.raw`tw:z-[9999999999] tw:mt-app-s tw:block tw:rounded-app tw:border-2 tw:border-[#009121] tw:bg-[rgba(0,145,33,0.1)] tw:p-app-s tw:font-bold tw:text-app-text tw:opacity-100 tw:[animation:display_1s_1_ease-in]`,
  purchasedSubtext: 'tw:mt-app-s tw:font-[100] tw:text-app-text',
  root: String.raw`tw:flex tw:items-center tw:[&>*:first-child]:w-3/5 tw:[&>*:first-child]:pr-app-s tw:[.modal_&_div:first-of-type]:w-[unset] tw:[.modal_&_div:last-of-type]:ml-auto tw:[.modal_&_div:last-of-type]:mr-app-xs tw:[&_.filePrice_.credit-amount]:mr-app-l tw:[&_.filePrice_.credit-amount]:!text-black`,
} as const;
