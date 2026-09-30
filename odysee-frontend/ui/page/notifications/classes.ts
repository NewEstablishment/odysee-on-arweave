import { CLAIM_LIST_ALT_CONTROLS_WRAP_CLASS, CLAIM_LIST_HEADER_CLASS } from '../../component/claimList/classes.ts';

export const NOTIFICATIONS_PAGE_CLASSES = {
  page: 'notification-page',
  header: `${CLAIM_LIST_HEADER_CLASS} tw:upto-small:block`,
  controls: String.raw`${CLAIM_LIST_ALT_CONTROLS_WRAP_CLASS} tw:upto-small:!block tw:upto-small:text-right tw:upto-small:[&_.button]:mb-app-s tw:upto-small:[&_:is(fieldset-section,.fieldset-section)]:ml-0`,
  list: 'notification_list',
} as const;
