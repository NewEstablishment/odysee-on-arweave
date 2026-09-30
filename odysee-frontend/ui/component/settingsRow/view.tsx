import React from 'react';
import Button from 'component/button';
import * as PAGES from 'constants/pages';
import classnames from 'classnames';
import { SETTINGS_ROW_CLASSES } from './classes';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { HELP_WARNING_CLASS } from 'component/common/help-classes';
type Props = {
  title?: string | React.ReactNode;
  subtitle?: string | React.ReactNode;
  warning?: string;
  multirow?: boolean;
  // Displays the Value widget(s) below the Label instead of on the right.
  useVerticalSeparator?: boolean;
  // Show a separator line between Label and Value. Useful when there are multiple Values.
  disabled?: boolean;
  highlighted?: boolean;
  membersOnly?: boolean;
  children?: React.ReactNode;
};
export default function SettingsRow(props: Props) {
  const { title, subtitle, warning, multirow, useVerticalSeparator, disabled, highlighted, membersOnly, children } =
    props;
  return (
    <div
      className={classnames('card__main-actions', SETTINGS_ROW_CLASSES.root, {
        [SECTION_CLASSES.actionsBetween]: !multirow,
        [SETTINGS_ROW_CLASSES.disabled]: disabled,
        [SETTINGS_ROW_CLASSES.highlighted]: highlighted,
      })}
    >
      <div className={SETTINGS_ROW_CLASSES.title}>
        <span>
          {title}
          {membersOnly && (
            <Button className={SETTINGS_ROW_CLASSES.membersOnly} navigate={`/$/${PAGES.ODYSEE_MEMBERSHIP}`}>
              {'PREMIUM'}
            </Button>
          )}
        </span>
        {subtitle && <p className={SETTINGS_ROW_CLASSES.subtitle}>{subtitle}</p>}
      </div>
      {warning && <div className={HELP_WARNING_CLASS}>{warning}</div>}
      <div
        className={classnames(SETTINGS_ROW_CLASSES.value, {
          [SETTINGS_ROW_CLASSES.valueMultirow]: multirow,
          [SETTINGS_ROW_CLASSES.valueVerticalSeparator]: useVerticalSeparator,
          [SETTINGS_ROW_CLASSES.valueNonClickable]: disabled,
        })}
      >
        {children}
      </div>
    </div>
  );
}
