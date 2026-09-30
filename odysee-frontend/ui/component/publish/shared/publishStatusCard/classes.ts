export type PublishStatusVariant = 'error' | 'mandatory' | 'recommended';

export const publishStatusCardClassName =
  'tw:mt-app-s tw:rounded-app tw:bg-app-card tw:p-app-m tw:[animation:publish-status-card-in_0.25s_ease] tw:upto-small:p-app-s';

export const publishStatusHeaderClassName = 'tw:flex tw:flex-wrap tw:items-start tw:gap-app-s';
export const publishStatusTextClassName = 'tw:min-w-0 tw:flex-1';
export const publishStatusTitleClassName =
  'tw:mt-0 tw:mr-0 tw:mb-[2px] tw:ml-0 tw:text-app-body tw:font-bold tw:text-app-text';
export const publishStatusDescriptionClassName = 'tw:m-0 tw:text-app-small tw:leading-[1.4] tw:text-app-text-subtitle';
export const publishStatusBodyClassName = 'tw:mt-app-m';

const iconVariantClassNames: Record<PublishStatusVariant, string> = {
  error: 'tw:bg-[rgba(244,67,54,0.15)] tw:text-[#f44336]',
  mandatory: 'tw:bg-[rgba(255,180,0,0.15)] tw:text-[#f5a623]',
  recommended: 'tw:bg-[rgba(76,175,80,0.15)] tw:text-[#4caf50]',
};

const actionVariantClassNames: Record<PublishStatusVariant, string> = {
  error: 'tw:bg-[linear-gradient(135deg,#e53935,#c62828)] tw:text-white',
  mandatory: 'tw:bg-[linear-gradient(135deg,rgba(255,180,0,0.9),rgba(245,166,35,0.8))] tw:text-black',
  recommended: 'tw:bg-[linear-gradient(135deg,rgba(76,175,80,0.9),rgba(56,142,60,0.8))] tw:text-white',
};

export function publishStatusIconClassName(variant: PublishStatusVariant) {
  return `tw:flex tw:size-[36px] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-app ${iconVariantClassNames[variant]}`;
}

export function publishStatusActionClassName(variant: PublishStatusVariant) {
  return `tw:mt-0 tw:ml-auto tw:inline-flex tw:shrink-0 tw:cursor-pointer tw:items-center tw:gap-[6px] tw:whitespace-nowrap tw:rounded-[8px] tw:[border:none] tw:px-[20px] tw:py-[10px] tw:text-app-small tw:font-semibold tw:hover:brightness-110 tw:upto-small:w-full tw:upto-small:justify-center ${actionVariantClassNames[variant]}`;
}

export function publishStatusCheckboxClassName(variant: PublishStatusVariant) {
  const borderClassName = {
    error: 'tw:border-current',
    mandatory: 'tw:border-black',
    recommended: 'tw:border-white',
  }[variant];
  return `publish-status-checkbox-surface publish-status-checkbox-surface--${variant} tw:relative tw:m-0 tw:size-[16px] tw:min-h-[16px] tw:min-w-[16px] tw:cursor-pointer tw:appearance-none tw:rounded-[4px] tw:border-2 tw:bg-transparent tw:p-0 tw:[box-shadow:none] tw:hover:border-current tw:hover:[box-shadow:none] ${borderClassName}`;
}
