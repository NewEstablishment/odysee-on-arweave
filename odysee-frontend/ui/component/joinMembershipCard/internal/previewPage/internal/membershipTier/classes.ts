const MEMBERSHIP_TIER_LAYOUT_CLASS =
  'tw:relative tw:flex tw:flex-col tw:overflow-hidden tw:rounded-app tw:bg-[rgba(var(--color-header-button-base),0.6)] tw:pb-app-xxl tw:[flex-basis:calc(33%_-_var(--spacing-l))] tw:[transition:max-height_0.3s] tw:upto-small-plus:[flex-basis:66%]';

const MEMBERSHIP_TIER_COPY_CLASS =
  'tw:[&_h2]:text-app-large tw:[&_h3]:mt-app-l tw:[&_h3]:text-app-body tw:[&_h3]:font-bold';

const MEMBERSHIP_TIER_HEADER_TYPOGRAPHY_CLASS = 'tw:text-app-large tw:font-bold';

const MEMBERSHIP_TIER_INFO_CLASS = String.raw`tw:[&_.membership-tier\_\_infos]:overflow-hidden tw:[&_.membership-tier\_\_infos]:p-app-m tw:[&_.membership-tier\_\_infos_:is(label,.confirm\_\_label)]:block tw:[&_.membership-tier\_\_infos_:is(label,.confirm\_\_label)]:text-app-body tw:[&_.membership-tier\_\_infos_span]:flex tw:[&_.membership-tier\_\_infos_span]:[font-size:var(--font-base)] tw:[&_.membership-tier\_\_infos_span]:opacity-80`;

const MEMBERSHIP_TIER_COLOR_CLASS = String.raw`tw:[&_*::selection]:!bg-[rgba(var(--join-membership-tier-rgb),1)] tw:[&_.button-surface--primary]:[--button-surface-primary-bg:rgba(var(--join-membership-tier-rgb),1)]`;

export const MEMBERSHIP_TIER_CLASSES = {
  root: String.raw`${MEMBERSHIP_TIER_LAYOUT_CLASS} ${MEMBERSHIP_TIER_COPY_CLASS} ${MEMBERSHIP_TIER_INFO_CLASS} ${MEMBERSHIP_TIER_COLOR_CLASS} tw:[&_.button-surface--primary]:!my-app-m tw:[&_.button-surface--primary]:!mx-0`,
  header: String.raw`${MEMBERSHIP_TIER_HEADER_TYPOGRAPHY_CLASS} tw:relative tw:h-[4.5rem] tw:w-full tw:bg-[rgba(var(--join-membership-tier-rgb),1)] tw:bg-[url('/img/spaceman_pattern.png')] tw:bg-[length:34px] tw:p-app-m`,
  headerTypography: MEMBERSHIP_TIER_HEADER_TYPOGRAPHY_CLASS,
  headerName: String.raw`tw:inline-block tw:h-[2.6rem] tw:max-w-full tw:overflow-hidden tw:rounded-app tw:bg-app-header tw:p-app-xxs tw:text-ellipsis tw:whitespace-nowrap tw:[line-clamp:1] tw:[-webkit-line-clamp:1] tw:upto-small:max-w-[calc(100%_-_var(--spacing-xl))]`,
  infoLastSubtitle: 'section__subtitle--join-membership__perk tw:last:mb-0',
  headerMenuButton: String.raw`tw:absolute tw:top-app-m tw:right-app-m tw:rounded-[50%] tw:bg-app-header tw:p-app-s tw:opacity-100 tw:[&_.icon]:[transform:rotate(0deg)] tw:[&_.icon]:[transition:transform_0.4s] tw:hover:[&_.icon]:stroke-[rgba(var(--join-membership-tier-rgb),1)] tw:[&[aria-expanded='true']_.icon]:[transform:rotate(90deg)] tw:[&[aria-expanded='true']_.icon]:stroke-[rgba(var(--join-membership-tier-rgb),1)]`,
  perks: String.raw`membership-tier__perks tw:m-[0_auto] tw:flex tw:flex-col tw:list-none tw:[&_p]:text-left tw:[&_img]:hidden`,
  perksList: String.raw`tw:flex tw:h-full tw:flex-col tw:list-none tw:![list-style-position:inside] tw:[&>div]:h-full`,
  perksItem: String.raw`tw:![margin-left:var(--membership-tier-perk-offset,1.3em)] tw:mr-0 tw:mt-0 tw:![list-style-position:inside] tw:[&::before]:ml-[-1.3em] tw:[&::before]:inline-block tw:[&::before]:w-[1.3em] tw:[&::before]:text-[#ffc800] tw:[&::before]:[content:'\2605']`,
  perksRootList: 'tw:![list-style-position:outside]',
  perksItemTierColor: String.raw`tw:[&::before]:!text-[rgba(var(--join-membership-tier-rgb),1)]`,
  perksItemMuted: 'tw:[font-size:var(--font-base)] tw:opacity-80',
  editor: String.raw`tw:mb-app-l tw:!pb-0 tw:[&_.membership-tier\_\_perks-content]:mt-app-s tw:[&_:is(label,.confirm\_\_label)]:mt-app-s tw:[&_:is(label,.confirm\_\_label):first-of-type]:mt-0`,
  lastOfFive:
    'tw:[@media(min-width:900px)_and_(max-width:1150px)]:col-start-1 tw:[@media(min-width:900px)_and_(max-width:1150px)]:col-end-3 tw:[@media(min-width:900px)_and_(max-width:1150px)]:w-1/2',
} as const;
