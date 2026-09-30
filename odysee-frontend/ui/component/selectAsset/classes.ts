import { SECTION_CLASSES } from '../common/section-classes.ts';

export const SELECT_ASSET_CLASSES = {
  actions: `${SECTION_CLASSES.actions} ${String.raw`select-asset-actions-surface tw:[.modal_&_.checkbox]:mt-app-m tw:[.modal_&_.checkbox]:h-full tw:[.modal_&_.checkbox_label]:flex tw:[.modal_&_.checkbox_label]:items-center tw:[.modal_&_button]:ml-auto tw:[.modal_&_button]:!mr-0`}`,
  preview: 'select-asset-preview-surface tw:mb-[calc(var(--spacing-xs)*-1)] tw:[&_svg]:size-[40px]',
} as const;
