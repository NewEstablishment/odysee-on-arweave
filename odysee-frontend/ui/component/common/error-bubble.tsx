import React from 'react';
import { ERROR_BUBBLE_CLASS } from './error-classes';
type Props = {
  title?: string;
  subtitle?: string;
  action?: any;
  children?: string;
  className?: string;
};

const ErrorBubble = (props: Props) => {
  const { children, title, subtitle, action } = props;
  const actionWithHook = React.isValidElement(action)
    ? React.cloneElement(action as React.ReactElement<any>, { 'data-error-bubble-action': true })
    : action;

  if (title && subtitle && action) {
    return (
      <div className={ERROR_BUBBLE_CLASS}>
        <div>
          <label>{title}</label>
          <span>{subtitle}</span>
        </div>
        {actionWithHook}
      </div>
    );
  }

  if (!children) {
    return null;
  }

  return <span className={ERROR_BUBBLE_CLASS}>{children}</span>;
};

export default ErrorBubble;
