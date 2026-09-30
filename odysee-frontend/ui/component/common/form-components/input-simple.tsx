import * as React from 'react';
import { Label } from './common';
import { FORM_RADIO_CLASS } from './form-field-classes';
type InputSimpleProps = {
  name: string;
  type: string;
  label?: any;
};
export const InputSimple = (inputSimpleProps: InputSimpleProps) => {
  const { name, type, label, ...inputProps } = inputSimpleProps;
  return (
    <>
      <input id={name} type={type} {...inputProps} />
      <Label name={name} label={label} />
    </>
  );
};
type BlockWrapProps = {
  blockWrap: boolean;
  children?: any;
};
export const BlockWrapWrapper = (blockWrapProps: BlockWrapProps) => {
  const { blockWrap, children } = blockWrapProps;
  return blockWrap ? (
    <fieldset-section class={FORM_RADIO_CLASS}>{children}</fieldset-section>
  ) : (
    <span className={FORM_RADIO_CLASS}>{children}</span>
  );
};
