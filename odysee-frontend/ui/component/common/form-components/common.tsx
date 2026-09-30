import { ERROR_TEXT_CLASS } from 'component/common/error-classes';
import * as React from 'react';
import Button from 'component/button';
import { FORM_FIELD_COMMENT_COUNT_CLASS } from './form-field-classes';

type CountInfoProps = {
  charCount?: number;
  textAreaMaxLength?: number;
};
export const CountInfo = (countInfoProps: CountInfoProps) => {
  const { charCount, textAreaMaxLength } = countInfoProps;
  // Keep this outside the editor status bar so callers can position it
  // consistently across textarea and markdown modes.
  const hasCharCount = charCount !== undefined && charCount >= 0;
  return (
    hasCharCount &&
    textAreaMaxLength !== undefined && (
      <span className={FORM_FIELD_COMMENT_COUNT_CLASS}>{`${charCount || '0'}/${textAreaMaxLength}`}</span>
    )
  );
};
type QuickActionProps = {
  label?: string;
  quickActionHandler?: (arg0: any) => any;
};
export const QuickAction = (quickActionProps: QuickActionProps) => {
  const { label, quickActionHandler } = quickActionProps;
  return label && quickActionHandler ? (
    <div className="form-field__quick-action tw:text-app-xsmall">
      <Button button="link" onClick={quickActionHandler} label={label} />
    </div>
  ) : null;
};
type LabelProps = {
  name: string;
  label?: any;
  errorMessage?: any;
};
export const Label = (labelProps: LabelProps) => {
  const { name, label, errorMessage } = labelProps;
  return (
    <label htmlFor={name}>{errorMessage ? <span className={ERROR_TEXT_CLASS}>{errorMessage}</span> : label}</label>
  );
};
