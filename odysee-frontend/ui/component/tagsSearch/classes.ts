const TAGS_LAYOUT_CLASS = String.raw`tw:flex tw:min-w-0 tw:flex-wrap tw:gap-app-xs tw:[&_.ul--no-style]:max-h-full tw:[&_.ul--no-style]:!overflow-y-scroll tw:[&_.ul--no-style::-webkit-scrollbar]:!bg-app-border`;

export const TAGS_LIST_CLASS = `tags ${TAGS_LAYOUT_CLASS}`;

export const TAGS_SEARCH_CLASSES = {
  controlTags: String.raw`tw:[columns:270px_3] tw:gap-app-l tw:[&&_.checkbox]:mt-0 tw:[&_.checkbox]:mb-app-s tw:[&_.checkbox]:break-inside-avoid`,
  input: String.raw`tw:h-[var(--input-height)] tw:max-w-[20rem] tw:px-app-s tw:py-[calc(var(--spacing-xxs)+1px)] tw:[.settings-row\_\_value_&]:!max-w-none`,
  removeList: `tags--remove ${TAGS_LAYOUT_CLASS}`,
  root: String.raw`tags__input-wrapper tw:[&>:is(fieldset-section,.fieldset-section)>:is(label,.confirm\_\_label)]:mt-app-l tw:[&>:is(fieldset-section,.fieldset-section)>:is(label,.confirm\_\_label)]:text-app-body tw:[&_.checkbox]:mt-app-s tw:[&_.checkbox_:is(label,.confirm\_\_label)]:[font-size:var(--font-base)] tw:[&_.checkbox_:is(label,.confirm\_\_label)]:font-normal tw:[&_.form-field\_\_hint_svg]:mb-[2px] tw:[&_.form-field\_\_hint_span]:flex tw:[&_.form-field\_\_hint_span]:content-center tw:[&_.form-field\_\_hint_.button-surface\_\_label]:ml-app-xxs`,
} as const;
