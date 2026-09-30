import { TAB_LIST_COLLECTION_EDIT_CLASS } from '../../component/common/tabs-classes.ts';
import { TABLE_CLASS } from '../../component/common/table-classes.ts';

export const WALLET_PAGE_CLASS = 'transactionsPage-wrapper';

export const WALLET_FIAT_TRANSACTIONS_CLASS =
  'wallet__fiat-transactions tw:mt-[13px] tw:mb-[9px] tw:text-center tw:text-[13px] tw:text-[rgb(171,171,171)]';

export const WALLET_TAB_LIST_CLASS = `${TAB_LIST_COLLECTION_EDIT_CLASS} tw:[--tab-list-padding-inline:var(--spacing-xxs)] tw:[--tab-list-collection-edge:var(--spacing-xxs)]`;

export const WALLET_TRANSACTION_TABLE_CLASSES = {
  actionable: String.raw`tw:align-middle tw:whitespace-nowrap tw:[&_.button]:ml-app-m tw:[&_.button]:h-[1.5rem] tw:[&_.button]:p-app-s`,
  alignRight: 'tw:!text-right tw:[&_*]:justify-end tw:[&_*]:text-right',
  amountHeader: 'tw:w-[130px]',
  channelNameHeader: 'tw:w-[160px]',
  date: 'tw:min-w-[140px]',
  dateCell: 'tw:text-app-small',
  dateHeader: 'tw:min-w-[220px]',
  root: String.raw`${TABLE_CLASS} tw:[&_td:nth-of-type(3)_:is(a,button)]:inline-block tw:[&_td:nth-of-type(3)_:is(a,button)]:max-w-[22rem] tw:[&_td:nth-of-type(3)_:is(a,button)]:overflow-hidden tw:[&_td:nth-of-type(3)_:is(a,button)]:text-ellipsis tw:[&_td:nth-of-type(3)_:is(a,button)]:whitespace-nowrap tw:[&_td:nth-of-type(3)_:is(a,button)]:align-bottom tw:[&_td:nth-of-type(4)]:w-[15%] tw:[&_td:nth-of-type(5)]:w-[15%] tw:[&_.button-surface--secondary]:!bg-[var(--color-button-secondary-bg)] tw:[&_.button-surface--secondary:hover]:!bg-app-primary`,
  transaction: 'tw:min-w-[100px]',
  transactionTypeHeader: 'tw:max-w-[160px]',
  type: 'tw:min-w-[80px]',
} as const;

export const WALLET_TXO_RADIOS_CLASS = 'tw:!inline';

export const WALLET_TXO_EXPORT_CLASS = 'tw:hidden tw:small:block';

export const WALLET_ANNOUNCEMENT_CLASSES = {
  root: 'tmp-lbc-announcement tw:relative tw:mb-app-s tw:flex tw:w-full tw:flex-col tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-app tw:border tw:border-[rgba(78,208,205,0.507)] tw:bg-[rgba(78,208,205,0.2)] tw:p-app-s tw:upto-small:box-border tw:upto-small:[align-items:unset] tw:upto-small:pl-[100px]',
  image: 'tw:absolute tw:left-0 tw:border-r tw:border-r-[rgba(78,208,205,0.507)] tw:bg-[rgb(78,208,205)]',
  title: 'tw:flex tw:items-center tw:font-black',
  titleIcon: 'tw:mr-app-xxs tw:mb-[2px] tw:size-[20px]',
  copy: 'tw:upto-small:text-app-small',
} as const;
