export const BUY_AR_CLASSES = {
  root: String.raw`card--buyAr tw:[&_.button-surface\_\_content]:flex tw:[&_.button-surface\_\_content]:justify-center`,
  wrapper: 'buyAr-wrapper tw:flex tw:w-full tw:gap-app-s tw:upto-medium:flex-col',
  card: 'buyAr-card tw:flex-1 tw:rounded-app tw:bg-app-background tw:p-app-s',
  cardHeading: 'tw:opacity-80',
  input: 'buyAr-input tw:relative tw:flex',
  inputField: 'tw:w-full tw:text-app-large',
  inputMenuButton: 'tw:absolute tw:top-0 tw:right-app-s tw:text-[var(--color-font)] tw:[&_.fiatOption]:p-0',
  select: 'tw:w-full',
  alternatives: 'card--buyAr-alternatives tw:mt-app-s',
  alternativesHeader: 'buyAr-alternatives-header tw:flex tw:w-full tw:max-w-full tw:flex-col tw:gap-app-xs',
  headerAddress: String.raw`buyAr-header-address tw:flex tw:items-center tw:gap-app-xxs tw:text-app-small tw:upto-small:flex-col tw:upto-small:[align-items:start] tw:[&_input-submit]:h-[28px] tw:[&_input-submit_input]:!h-full tw:[&_input-submit_input]:!w-[350px] tw:upto-small:[&_fieldset-section]:w-full tw:upto-small:[&_input-submit_input]:!w-full tw:upto-small:[&_input-submit_input]:!max-w-none tw:[&_button]:!h-full tw:[&_button]:![border:none] tw:[&_button]:!bg-app-background tw:[&_button]:px-[0.75rem] tw:[&_button]:py-[0.2rem] tw:[&_button:hover]:!bg-app-primary tw:[&_button:hover_.button-surface\_\_content]:![filter:none]`,
  addressLabel: 'buyAr-address-label tw:font-medium tw:opacity-80',
  disclaimer:
    'buyAr-disclaimer tw:mb-app-m tw:flex tw:items-center tw:gap-app-s tw:rounded-app tw:border-l-[4px] tw:border-l-app-primary tw:bg-app-card-highlighted tw:p-app-s',
  disclaimerIcon: 'buyAr-disclaimer-icon tw:flex tw:items-center tw:text-[#ffff00]',
  disclaimerText: 'buyAr-disclaimer-text tw:m-0 tw:text-app-small tw:opacity-90',
  section: 'buyAr-section tw:mb-app-xs tw:last-of-type:mb-0',
  sectionTitle:
    'buyAr-section-title tw:mb-app-xs tw:flex tw:items-center tw:gap-app-xs tw:text-app-large tw:font-semibold tw:text-app-text',
  sectionTitleIcon: 'tw:mb-[3px] tw:flex tw:items-center tw:justify-center',
  sectionSubtitle: 'buyAr-section-subtitle tw:mb-app-s tw:text-app-small tw:opacity-80',
  providersGrid:
    'buyAr-providers-grid tw:mb-app-xs tw:grid tw:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] tw:gap-app-s tw:upto-medium:grid-cols-[1fr]',
  providerCard:
    'buyAr-provider-card tw:block tw:rounded-app tw:bg-app-background tw:p-app-s tw:text-inherit tw:no-underline tw:hover:text-inherit tw:hover:no-underline tw:hover:[outline:2px_solid_var(--color-primary)]',
  providerContent: 'buyAr-provider-content',
  providerName:
    'buyAr-provider-name tw:m-0 tw:flex tw:items-center tw:justify-between tw:text-[length:var(--font-base)] tw:leading-[1.2] tw:font-semibold tw:text-app-text',
  providerIcon: 'tw:ml-auto! tw:opacity-60',
  providerNote:
    'buyAr-provider-note tw:mt-app-xxs tw:mr-0 tw:mb-0 tw:ml-0 tw:text-app-xsmall tw:leading-[1.3] tw:font-medium tw:text-app-primary',
  exchangesGrid:
    'buyAr-exchanges-grid tw:mb-0 tw:grid tw:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] tw:gap-app-s tw:upto-medium:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]',
  exchangeLink:
    'buyAr-exchange-link tw:flex tw:items-center tw:justify-between tw:rounded-app tw:bg-app-background tw:px-app-xs tw:py-app-s tw:text-app-small tw:font-medium tw:text-app-text tw:no-underline tw:hover:text-app-text tw:hover:no-underline tw:hover:[outline:2px_solid_var(--color-primary)]',
  exchangeIcon: 'tw:ml-auto! tw:opacity-60',
  footerNote: 'buyAr-footer-note tw:mt-app-xs tw:border-t tw:border-t-app-border tw:pt-app-xs',
  footerText: 'tw:m-0 tw:text-center tw:text-app-xsmall tw:leading-[1.4] tw:opacity-70',
  fiatOption: 'fiatOption tw:flex tw:items-center tw:gap-app-s tw:px-app-s tw:py-app-xxs',
  fiatIcon: 'fiatOption-wrapper tw:h-[20px] tw:w-[30px] tw:overflow-hidden tw:rounded-app tw:[&_svg]:size-full',
  fiatText: 'fiatOption-text',
  fiatSymbol: 'fiatOption-symbol tw:flex tw:font-extrabold',
  fiatName: 'fiatOption-name tw:mt-[-6px] tw:text-app-small tw:opacity-80',
} as const;
