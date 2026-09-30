export const FIELDSET_GROUP_CLASS =
  'fieldset-group tw:flex tw:flex-row tw:[&:not(.fieldset-group--smushed)]:justify-between';

export const FIELDSET_GROUP_SMUSHED_CLASS = [
  FIELDSET_GROUP_CLASS,
  'fieldset-group--smushed tw:justify-start',
  String.raw`tw:[&_:is(fieldset-section,.fieldset-section)]:m-0 tw:[&_:is(fieldset-section,.fieldset-section)]:w-auto`,
  String.raw`tw:[&_:is(fieldset-section,.fieldset-section)+:is(fieldset-section,.fieldset-section)]:mt-0`,
  String.raw`tw:[&_:is(fieldset-section,.fieldset-section):first-child_:is(input,select)]:[border-right:none] tw:[&_:is(fieldset-section,.fieldset-section):first-child_:is(input,select)]:rounded-tr-none tw:[&_:is(fieldset-section,.fieldset-section):first-child_:is(input,select)]:rounded-br-none`,
  String.raw`tw:[&_:is(fieldset-section,.fieldset-section):nth-of-type(2)_:is(input,select)]:rounded-tl-none tw:[&_:is(fieldset-section,.fieldset-section):nth-of-type(2)_:is(input,select)]:rounded-bl-none`,
].join(' ');

export const FIELDSET_GROUP_DISABLED_PREFIX_CLASS = [
  FIELDSET_GROUP_SMUSHED_CLASS,
  'fieldset-group--disabled-prefix tw:items-end',
  String.raw`tw:[&_:is(label,.confirm\_\_label)]:min-h-[18px] tw:[&_:is(label,.confirm\_\_label)]:w-0 tw:[&_:is(label,.confirm\_\_label)]:overflow-visible tw:[&_:is(label,.confirm\_\_label)]:whitespace-nowrap`,
  String.raw`tw:[&_:is(fieldset-section,.fieldset-section):first-child]:max-w-[40%]`,
  String.raw`tw:[&_:is(fieldset-section,.fieldset-section):first-child_.form-field\_\_prefix]:h-[var(--height-input)] tw:[&_:is(fieldset-section,.fieldset-section):first-child_.form-field\_\_prefix]:overflow-hidden tw:[&_:is(fieldset-section,.fieldset-section):first-child_.form-field\_\_prefix]:rounded-tl-app tw:[&_:is(fieldset-section,.fieldset-section):first-child_.form-field\_\_prefix]:rounded-bl-app tw:[&_:is(fieldset-section,.fieldset-section):first-child_.form-field\_\_prefix]:bg-app-border tw:[&_:is(fieldset-section,.fieldset-section):first-child_.form-field\_\_prefix]:p-[0.5rem] tw:[&_:is(fieldset-section,.fieldset-section):first-child_.form-field\_\_prefix]:text-[rgba(var(--color-text-base),0.7)] tw:[&_:is(fieldset-section,.fieldset-section):first-child_.form-field\_\_prefix]:text-ellipsis tw:[&_:is(fieldset-section,.fieldset-section):first-child_.form-field\_\_prefix]:whitespace-nowrap tw:[&_:is(fieldset-section,.fieldset-section):first-child_.form-field\_\_prefix]:[border-right-color:var(--color-input-prefix-border)]`,
  String.raw`tw:[&_:is(fieldset-section,.fieldset-section):last-child]:w-full tw:[&_:is(fieldset-section,.fieldset-section):last-child_:is(label,.confirm\_\_label)]:w-full tw:[&_:is(fieldset-section,.fieldset-section):last-child_:is(label,.confirm\_\_label)]:whitespace-normal`,
].join(' ');

export const FIELDSET_GROUP_PAGINATE_CLASS = [
  FIELDSET_GROUP_SMUSHED_CLASS,
  'fieldgroup--paginate tw:mt-app-l tw:items-end tw:!justify-center tw:pb-app-l',
  String.raw`tw:[&_:is(fieldset-section,.fieldset-section)_input]:!mb-[5px] tw:[&_:is(fieldset-section,.fieldset-section)_input]:ml-app-s`,
].join(' ');
