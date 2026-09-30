export const JOIN_MEMBERSHIP_TIER_VARIABLE_CLASSES = [
  'tw:[--join-membership-tier-rgb:var(--color-membership-1)]',
  'tw:[--join-membership-tier-rgb:var(--color-membership-2)]',
  'tw:[--join-membership-tier-rgb:var(--color-membership-3)]',
  'tw:[--join-membership-tier-rgb:var(--color-membership-4)]',
  'tw:[--join-membership-tier-rgb:var(--color-membership-5)]',
  'tw:[--join-membership-tier-rgb:var(--color-membership-6)]',
] as const;

const JOIN_MEMBERSHIP_CONTEXT_CLASS = String.raw`tw:[&_h1]:mb-app-l tw:[&_h1]:hidden tw:[&_h1]:text-app-title tw:upto-small:[&_h1]:block tw:[&_:is(.section\_\_actions,.section\_\_actions--no-margin,.section\_\_actions--between,.section\_\_actions--centered)]:block tw:[&_:is(.section\_\_actions,.section\_\_actions--no-margin,.section\_\_actions--between,.section\_\_actions--centered)]:mt-app-m tw:[&_.confirm\_\_wrapper_section]:flex tw:[&_.confirm\_\_wrapper_section]:flex-col tw:[&_.confirm\_\_wrapper_section:not(:first-of-type)]:mt-app-m tw:[&_.confirm\_\_wrapper_section_span]:mt-0 tw:[&_.confirm\_\_wrapper_section_span]:inline tw:[&_.confirm\_\_wrapper_section_span]:[font-size:var(--font-base)] tw:[&_.confirm\_\_wrapper_section_span]:opacity-80 tw:[&_.confirm\_\_wrapper_section_span_.dot]:mr-app-xxs tw:[&_.confirm\_\_wrapper_section_span_.dot]:mb-[-1.5px] tw:[&_.confirm\_\_wrapper_section_span_.dot]:inline-block tw:[&_.confirm\_\_wrapper_section_span_.dot]:size-[var(--font-base)] tw:[&_.confirm\_\_wrapper_section_span_.dot]:rounded-[50%] tw:[&_:is(label,.confirm\_\_label)]:mb-app-xxs tw:[&_.help--no-card]:[font-size:var(--font-base)] tw:[&_.help--no-card]:!text-app-danger tw:[&_.card\_\_subtitle]:!leading-[1.5] tw:[&_.confirm\_\_wrapper_section:first-of-type_[data-channel-selector]]:!mb-0`;

const JOIN_MEMBERSHIP_CARD_CLASS = `${JOIN_MEMBERSHIP_CONTEXT_CLASS} ${String.raw`tw:[&_.card\_\_body]:m-[0_auto] tw:[&_.card\_\_body--no-title]:pt-0 tw:[&_.confirm\_\_value]:mt-0 tw:[&_.confirm\_\_value]:block tw:[&_.confirm\_\_value]:text-[16px] tw:[&_.confirm\_\_label]:text-[17px]`}`;

const JOIN_MEMBERSHIP_SUBSCRIPTION_CONTENT_GROUP_CLASS = String.raw`tw:mb-app-s tw:last-of-type:mb-0 tw:[&_span]:block tw:[&_span]:[font-size:var(--font-base)] tw:[&_span]:opacity-80 tw:[&_.button-surface\_\_content]:flex tw:[&_.button-surface\_\_content]:opacity-100`;

export const JOIN_MEMBERSHIP_CLASSES = {
  card: JOIN_MEMBERSHIP_CARD_CLASS,
  contextPerk: 'section__subtitle--join-membership__perk tw:text-start tw:![list-style-position:inside]',
  modalCard: String.raw`tw:[&_.button-surface--link]:!ml-0 tw:[&_.dot]:bg-[rgba(var(--join-membership-tier-rgb),1)] tw:[&_*::selection]:!bg-[rgba(var(--join-membership-tier-rgb),1)] tw:[&_.membership-tier\_\_perks_li::before]:text-[rgba(var(--join-membership-tier-rgb),1)] tw:[&_.button-surface--primary]:[--color-primary:rgba(var(--join-membership-tier-rgb),1)] tw:[&_.button-surface--link_.button-surface\_\_content_.button-surface\_\_label]:!text-[rgba(var(--join-membership-tier-rgb),1)]`,
  empty: String.raw`tw:[&_*::selection]:!bg-app-primary tw:[&_.button-surface--primary]:[--button-surface-primary-bg:rgba(var(--color-primary-dynamic),1)] tw:[&_h2]:pt-app-s tw:[&_h2]:mb-app-s tw:[&_h2]:text-app-large tw:[&_h2]:font-bold tw:[&_.button]:mt-app-m tw:[&_p]:mr-app-s`,
  modalHeader: String.raw`tw:mb-app-l tw:h-[108px] tw:[&_.channel-thumbnail]:float-left tw:[&_.channel-thumbnail]:mr-app-m tw:[&_.channel-thumbnail]:size-[108px] tw:[&_h2]:font-bold tw:[&_h3]:text-app-title tw:[&_p]:text-app-small tw:[&_p]:opacity-80 tw:upto-small:h-[158px] tw:upto-small:[&_h2]:pt-app-l tw:upto-small:[&_h3]:pb-app-l tw:upto-xsmall:[&_.channel-thumbnail]:mt-app-m tw:upto-xsmall:[&_.channel-thumbnail]:mr-app-s tw:upto-xsmall:[&_.channel-thumbnail]:size-[74px] tw:upto-xsmall:[&_h3]:pb-app-s tw:upto-xxsmall:mb-app-s tw:upto-xxsmall:h-[138px] tw:upto-xxsmall:[&_.channel-thumbnail]:mt-0 tw:upto-xxsmall:[&_.channel-thumbnail]:mr-app-s tw:upto-xxsmall:[&_.channel-thumbnail]:size-[44px] tw:upto-xxsmall:[&_h2]:pt-0 tw:upto-xxsmall:[&_h2]:[font-size:var(--font-base)] tw:upto-xxsmall:[&_h3]:pb-app-s tw:upto-xxsmall:[&_h3]:text-app-body tw:upto-xxsmall:[&_h3]:font-bold`,
  modalContent: String.raw`tw:[&_h2]:hidden tw:[&_.membership-tier\_\_perks]:mt-app-m tw:[&_.membership-tier\_\_perks]:mb-app-l tw:[&_.membership-tier\_\_perks]:flex tw:[&_.membership-tier\_\_perks]:w-full tw:[&_.membership-tier\_\_perks]:flex-row tw:[&_.membership-tier\_\_perks]:overflow-hidden tw:[&_.membership-tier\_\_perks]:rounded-app tw:[&_.membership-tier\_\_perks]:border-2 tw:[&_.membership-tier\_\_perks]:border-app-border tw:[&_.membership-tier\_\_perks]:bg-[var(--color-header-background)] tw:[&_.membership-tier\_\_perks]:p-app-xs tw:[&_.membership-tier\_\_perks_.membership-tier\_\_perks-content]:ml-app-s tw:[&_li:nth-of-type(1)]:[--membership-tier-perk-offset:27px] tw:[&_li:nth-of-type(2)]:[--membership-tier-perk-offset:34px] tw:[&_li:nth-of-type(3)]:[--membership-tier-perk-offset:41px] tw:[&_li:nth-of-type(4)]:[--membership-tier-perk-offset:48px] tw:[&_li:nth-of-type(5)]:[--membership-tier-perk-offset:55px] tw:[&_li:nth-of-type(6)]:[--membership-tier-perk-offset:62px]`,
  modalTabs: 'tw:mb-app-s tw:hover:[&_.button-toggle-surface]:!opacity-100',
  tab: 'tw:grid tw:grid-cols-3 tw:[justify-content:left] tw:gap-app-l tw:[@media(max-width:899.999px)]:grid-cols-1 tw:[@media(min-width:900px)_and_(max-width:1150px)]:grid-cols-2',
  subscriptionCard: JOIN_MEMBERSHIP_CONTEXT_CLASS,
  subscriptionBody: 'tw:max-w-full tw:overflow-hidden tw:rounded-app tw:bg-[var(--color-header-background)]',
  subscriptionHeader: String.raw`tw:bg-[rgba(var(--join-membership-tier-rgb),1)] tw:[background-image:url('/img/spaceman_pattern.png')] tw:[background-size:34px] tw:p-app-m`,
  subscriptionHeaderName:
    'tw:rounded-app tw:bg-[var(--color-header-background)] tw:p-app-xxs tw:[font-size:var(--font-body)]',
  subscriptionMenuButton: String.raw`tw:float-right tw:mt-[calc(var(--spacing-xxs)*-1)] tw:rounded-[50%] tw:bg-[var(--color-header-background)] tw:p-app-s tw:opacity-100 tw:[&_.icon]:[transform:rotate(0deg)] tw:[&_.icon]:[transition:transform_0.4s] tw:[&[aria-expanded='true']_.icon]:[transform:rotate(90deg)] tw:hover:[&_.icon]:stroke-[rgba(var(--join-membership-tier-rgb),1)]`,
  subscriptionContent:
    'tw:mb-app-l tw:box-border tw:rounded-b-app tw:bg-[rgba(var(--color-header-button-base),0.6)] tw:p-app-m',
  subscriptionContentGroup: JOIN_MEMBERSHIP_SUBSCRIPTION_CONTENT_GROUP_CLASS,
  subscriptionPerk:
    'tw:[font-size:var(--font-base)] tw:opacity-80 tw:[&::before]:!text-[rgba(var(--join-membership-tier-rgb),1)]',
  subscriptionActions: `${JOIN_MEMBERSHIP_SUBSCRIPTION_CONTENT_GROUP_CLASS} tw:mt-app-l tw:flex`,
  subscriptionActionButton: 'tw:float-right',
  tierMenu: String.raw`tw:[&_.menu\_\_item[data-selected]]:!bg-[rgba(var(--join-membership-tier-rgb),1)] tw:[&_.menu\_\_item[data-selected]_.menu\_\_link]:![background-color:unset]`,
  tierButton: String.raw`tw:mr-app-xxxs tw:mb-app-xxxs tw:rounded-app tw:opacity-60 tw:transition-opacity tw:duration-200 tw:ease-[ease] tw:![border:2px_solid_rgba(var(--join-membership-tier-rgb),0.6)] tw:!bg-[rgba(var(--join-membership-tier-rgb),0.2)] tw:[&_.button-surface\_\_label]:!text-[rgba(var(--color-text-base),0.7)] tw:[&_.icon]:hidden tw:hover:!bg-[rgba(var(--join-membership-tier-rgb),1)] tw:hover:[&_.button-surface\_\_label]:!text-white`,
  tierButtonActive: String.raw`tw:[--color-button-toggle-bg-active:rgba(var(--join-membership-tier-rgb),1)] tw:!bg-[rgba(var(--join-membership-tier-rgb),1)] tw:!opacity-100 tw:[&_.button-surface\_\_label]:!text-white`,
  tierButtonNoAccess: String.raw`no-access-button tw:[--button-toggle-icon-stroke:red] tw:[&_.icon]:!inline-block tw:[&_.icon]:overflow-visible tw:[&_.icon]:rounded-[50%] tw:[&_.icon]:!bg-black tw:[&_.icon]:p-[4px] tw:[&_.icon]:!stroke-[red] tw:[&_.icon]:stroke-[4px] tw:[&_.icon]:![transform:scale(1.4)]`,
  tierButtonAccess: String.raw`access-button tw:[--button-toggle-icon-stroke:#91f92d] tw:[&_.icon]:!inline-block tw:[&_.icon]:overflow-visible tw:[&_.icon]:rounded-[50%] tw:[&_.icon]:!bg-black tw:[&_.icon]:p-[4px] tw:[&_.icon]:!stroke-[#91f92d] tw:[&_.icon]:stroke-[4px] tw:[&_.icon]:![transform:scale(1.4)]`,
  tierActions: 'tw:absolute tw:bottom-app-m tw:left-app-m tw:[&_button.button]:!m-0',
  totalPrice:
    'tw:!opacity-100 tw:font-[1000] tw:[@media(max-width:900px)]:!block tw:[@media(max-width:900px)]:mb-app-xxs tw:[@media(max-width:900px)]:[&_span]:!block tw:[@media(max-width:900px)]:[&_span]:mb-app-xxs tw:[@media(max-width:900px)]:[&_span]:!opacity-60 tw:[@media(max-width:900px)]:[&_.hide-on-mobile]:!hidden',
  detailsHeader: 'tw:hidden',
  detailsInfo: String.raw`tw:mt-app-m tw:[&_span]:opacity-80 tw:[&_.membership-tier\_\_perks]:!mb-0`,
  detailsDescription: 'tw:mb-app-s tw:block tw:[overflow-wrap:anywhere] tw:whitespace-pre-line',
  tabItem: 'tw:mb-app-m',
  tabHeader: 'tw:mb-app-m tw:items-center tw:text-center',
  moon: String.raw`tw:float-left tw:mt-[-56px] tw:mb-[-76px] tw:ml-[-40px] tw:h-[260px] tw:w-[42%] tw:rounded-[var(--border-radius)_0_0_var(--border-radius)] tw:bg-cover tw:[background-image:url('https://static.odycdn.com/images/moon.png')] tw:[background-position:-5px_-10px] tw:[transform:rotate(-16deg)]`,
  tierDescription:
    'tw:[display:-webkit-box] tw:[line-clamp:10] tw:[-webkit-line-clamp:10] tw:[-webkit-box-orient:vertical] tw:max-h-[300px] tw:overflow-y-scroll tw:[word-break:break-word] tw:whitespace-pre-line',
  modalAction: 'join-membership__modal-action tw:mt-app-l',
} as const;
