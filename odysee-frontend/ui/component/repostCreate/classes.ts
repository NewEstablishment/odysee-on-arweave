export const REPOST_PREVIEW_CLASS = String.raw`repost-wrapper tw:min-w-[var(--modal-width)] tw:[&_.claim-preview\_\_wrapper--row]:p-app-xs tw:[&_.claim-preview\_\_wrapper--row_:is([data-claim-preview-description],[data-claim-preview-tags])]:hidden tw:[&_.claim-preview\_\_wrapper--row_.menu\_\_button]:top-app-xs tw:[&_.claim-preview\_\_wrapper--row_.menu\_\_button]:right-app-xs tw:upto-small:min-w-full`;

export const REPOST_ACTIONS_CLASS = `${SECTION_CLASSES.actions} ${String.raw`publish__actions tw:!gap-0 tw:[&_.button-surface--primary]:rounded-[0_var(--border-radius)_var(--border-radius)_0]`}`;
import { SECTION_CLASSES } from '../common/section-classes.ts';
