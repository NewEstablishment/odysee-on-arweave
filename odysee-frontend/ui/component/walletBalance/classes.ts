import { SECTION_CLASSES } from '../common/section-classes.ts';
import { COLUMN_CLASS } from '../common/layout-classes.ts';
import { HELP_DT_CLASS } from '../common/help-classes.ts';

export const WALLET_BALANCE_CLASSES = {
  columns:
    'columns tw:flex tw:h-full tw:flex-wrap tw:items-stretch tw:justify-between tw:gap-app-s tw:upto-small:flex-col tw:upto-small:[&>*]:w-full',
  column: `${COLUMN_CLASS} tw:relative tw:m-0 tw:inline-block tw:min-h-full tw:min-w-[380px] tw:flex-1 tw:shrink-0`,
  card: String.raw`wallet-balance-card-surface tw:h-full tw:rounded-app tw:bg-[var(--color-header-button)] tw:p-app-s tw:[&_.credit-amount]:text-app-body tw:[&_.card\_\_actions]:[align-items:end] tw:[&_.empty_.spinner]:![border:unset] tw:[&_.empty_.spinner]:![background:unset] tw:[&_.card\_\_title-section]:w-full tw:[&_.card\_\_title-section]:pt-0 tw:[&_.card\_\_title-text]:w-full tw:[&_.card\_\_subtitle]:box-content tw:[&_.card\_\_subtitle]:min-h-[48px] tw:[&_.card\_\_subtitle]:pb-app-s tw:[&_.button-surface--secondary]:bg-[var(--color-header-button)] tw:[&_.button-surface--secondary]:text-app-text tw:[&_.button-surface--secondary:hover]:text-white tw:[&_.card\_\_main-actions]:flex tw:[&_.card\_\_main-actions]:h-full tw:[&_.card\_\_main-actions]:flex-col tw:[&_.card\_\_main-actions]:gap-app-xs tw:[&_.card\_\_main-actions_div_p]:mb-app-s tw:[&_.card\_\_first-pane]:flex tw:[&_.card\_\_first-pane]:h-full tw:[&_.card\_\_first-pane]:flex-col`,
  cardTitle: String.raw`wallet-balance-card-title-surface tw:box-content tw:mt-[calc(var(--spacing-s)*-1)] tw:mr-[calc(var(--spacing-s)*-1)] tw:ml-[calc(var(--spacing-s)*-1)] tw:flex tw:min-w-full tw:items-center tw:rounded-[var(--border-radius)_var(--border-radius)_0_0] tw:bg-[var(--color-header-button)] tw:p-app-xxs tw:[&_span]:mb-[-4px] tw:[&_svg]:box-content tw:[&_svg]:mb-0 tw:[&_svg]:rounded-app tw:[&_svg]:bg-app-background tw:[&_svg]:p-[4px] tw:[&_button]:ml-auto tw:[&_button]:h-[26px] tw:[&_button]:select-none tw:[&_button]:border tw:[&_button]:border-app-text tw:[&_button]:px-app-xxs tw:[&_button]:py-0 tw:[&_button]:text-app-body tw:[&_button_span]:m-0 tw:[&_button_.icon]:ml-app-xs tw:[&_button_svg]:bg-[unset] tw:[&_button:hover]:bg-app-text tw:[&_button:hover_.button-surface\_\_label]:!text-app-text tw:[&_button:hover_.button-surface\_\_label]:![filter:invert(1)] tw:[&_button:hover_svg]:!text-app-text tw:[&_button:hover_svg]:![filter:invert(1)]`,
  sectionActions: `${SECTION_CLASSES.actions} tw:!mt-auto tw:rounded-app tw:bg-app-background tw:p-app-s`,
  sectionTitle: `${SECTION_CLASSES.titleSmall} tw:mt-0 tw:!font-semibold tw:[&_img]:mr-app-xxxxs tw:[&_img]:size-[20px]`,
  helpDt: `${HELP_DT_CLASS} tw:!mt-0 tw:!inline-block`,
  walletCheckRow: 'wallet-check-row tw:flex tw:[&_div:first-of-type]:min-w-[210px] tw:[&_img]:size-[12px]',
  link: 'link tw:font-bold tw:text-app-primary tw:hover:cursor-pointer tw:hover:text-app-secondary',
} as const;
