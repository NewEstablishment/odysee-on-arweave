export const TABLE_CLASS = String.raw`table tw:relative tw:w-full tw:[&_:where(th,td)]:overflow-hidden tw:[&_:where(th,td)]:p-[0.5rem] tw:[&_thead]:relative tw:[&_thead]:cursor-default tw:[&_thead_th]:[border-bottom:1px_solid_var(--color-border)] tw:[&_thead_th]:[font-size:var(--font-medium)] tw:[&_thead_th]:[color:var(--color-text)] tw:[&_tr:not(:last-of-type)_td]:[border-bottom:1px_solid_var(--color-border)] tw:[&_th]:pb-app-xxxs tw:[&_th]:text-left tw:[&_th]:text-app-xsmall tw:[&_th]:text-app-text-help`;

export const TABLE_HEADER_TEXT_CLASS = 'table__header-text tw:mr-app-s tw:w-full';

export const TABLE_ITEM_LABEL_CLASS =
  'table__item-label tw:text-[length:var(--font-multiplier-small)] tw:font-light tw:text-app-text-subtitle';

export const TABLE_WRAPPER_CLASS =
  'table__wrapper tw:overflow-x-auto tw:[.disabled_&]:h-[98px] tw:[.disabled_&]:overflow-y-hidden';

export const TABLE_CONDENSED_CLASS = String.raw`table--condensed tw:[&_td]:p-[0.5rem] tw:[&_th]:p-[0.5rem] tw:[&_td:first-of-type]:pl-0 tw:[&_th:first-of-type]:pl-0 tw:[&_td:last-of-type]:pr-0 tw:[&_th:last-of-type]:pr-0 tw:[&_tr:nth-child(2n)]:bg-transparent`;

export const TABLE_PUBLISH_PREVIEW_CLASS = String.raw`table--publish-preview tw:table-fixed tw:leading-[1.1] tw:[&_th]:[padding:0.4rem_1rem] tw:[&_td]:[padding:0.4rem_1rem] tw:[&_td:nth-of-type(1)]:w-[30%] tw:[&_td:nth-of-type(1)]:overflow-hidden tw:[&_td:nth-of-type(1)]:text-ellipsis tw:[&_td:nth-of-type(1)]:whitespace-nowrap tw:[&_td:nth-of-type(1)]:font-bold tw:[&_td:nth-of-type(2)]:max-w-[70%] tw:[&_td:nth-of-type(2)]:whitespace-normal`;
