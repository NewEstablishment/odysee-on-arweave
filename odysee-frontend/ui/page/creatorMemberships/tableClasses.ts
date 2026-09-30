const MEMBERSHIP_TABLE_SHELL_CLASS = String.raw`tw:[&_.channel-thumbnail.channel-thumbnail--xxsmall]:[transform:translate(-150%,125%)] tw:small:[&_thead_tr_th]:p-[0.8rem] tw:small:[&_thead_tr_th]:whitespace-nowrap tw:[&_tbody_tr:hover]:bg-[rgba(var(--color-header-background-base),0.2)]`;

const MEMBERSHIP_TABLE_BASE_CLASS = String.raw`${MEMBERSHIP_TABLE_SHELL_CLASS} tw:[&_.table_thead_th]:[border-bottom:2px_solid_rgba(var(--color-primary-static),0.4)] tw:[&_.table_tbody_tr_td]:p-[0.8rem] tw:[&_.table_tbody_tr_td]:![border-bottom:2px_solid_rgba(var(--color-primary-static),0.4)] tw:upto-small:!overflow-x-auto tw:upto-small:[&_.table_.channelName-header]:min-w-[180px] tw:upto-small:[&_.table_thead_tr_th]:whitespace-nowrap tw:upto-small:[&_.table_tbody_tr_td]:whitespace-nowrap tw:upto-small:[&_.table_tbody_tr_td]:!p-[0.6rem] tw:upto-small:[&_.table_tbody_tr_td]:!pr-0`;

const MEMBERSHIP_PAYMENTS_TABLE_BASE_CLASS = String.raw`${MEMBERSHIP_TABLE_SHELL_CLASS} tw:[&_label]:ml-app-s tw:[&_label]:text-app-xsmall tw:[&_label]:text-[rgba(var(--color-text-base),0.6)] tw:[&_.table_thead_th]:[border-bottom:2px_solid_rgba(var(--color-primary-static),0.4)] tw:[&_.table_tbody_tr_td]:p-[0.8rem] tw:[&_.table_tbody_tr_td]:![border-bottom:2px_solid_rgba(var(--color-primary-static),0.4)] tw:[&_button.button]:float-right tw:[&_button.button]:rounded-app tw:upto-small:!overflow-x-auto tw:upto-small:[&_.table_.channelName-header]:min-w-[180px] tw:upto-small:[&_.table_thead_tr_th]:whitespace-nowrap tw:upto-small:[&_.table_tbody_tr_td]:whitespace-nowrap tw:upto-small:[&_.table_tbody_tr_td]:!p-[0.6rem] tw:upto-small:[&_.table_tbody_tr_td]:!pr-0`;

export const CREATOR_MEMBERSHIP_TABLE_CLASS = String.raw`${MEMBERSHIP_TABLE_BASE_CLASS} tw:[&_.table]:mb-[28px] tw:[&_.table_.button-surface--secondary]:!rounded-app tw:[&_.table_.button-surface--alt]:bg-[linear-gradient(147deg,var(--color-primary),rgb(247,121,55))] tw:[&_.table_.button-surface--alt]:text-white tw:[&_.table_.button-surface--alt:hover]:text-white`;

export const CREATOR_MEMBERSHIP_PAYMENTS_TABLE_CLASS = `${MEMBERSHIP_PAYMENTS_TABLE_BASE_CLASS} tw:mb-[28px]`;

export const SUPPORTER_MEMBERSHIP_TABLE_CLASS = String.raw`${MEMBERSHIP_TABLE_BASE_CLASS} tw:[&_.table_.button-surface--alt]:bg-[linear-gradient(147deg,var(--color-primary),rgb(247,121,55))] tw:[&_.table_.button-surface--alt]:text-white tw:[&_.table_.button-surface--alt:hover]:text-white`;

export const SUPPORTER_MEMBERSHIP_PAYMENTS_TABLE_CLASS = String.raw`${MEMBERSHIP_PAYMENTS_TABLE_BASE_CLASS} tw:[&_.table_.button-surface--primary]:bg-[linear-gradient(147deg,var(--color-primary),rgb(247,121,55))] tw:[&_.table_.button-surface--primary]:text-white tw:[&_.table_.button-surface--primary:hover]:text-white`;

export const MEMBERSHIP_TABLE_CHANNEL_CELL_CLASS = String.raw`tw:w-[50px] tw:!pr-0 tw:[&_[data-channel-thumbnail-image]]:absolute tw:[&_[data-channel-thumbnail-image]]:top-0 tw:[&_[data-channel-thumbnail-image]]:h-full tw:[&_.channel-thumbnail--xxsmall]:ml-[10px]`;
export const MEMBERSHIP_TABLE_PAGE_CLASS = 'tw:w-[60px]';
