import * as ICONS from 'constants/icons';
import React from 'react';
import classnames from 'classnames';
import Icon from 'component/common/icon';
import { LBC_SYMBOL_CLASS } from './lbc-symbol-classes';

type Props = {
  withText?: boolean;
  isTitle?: boolean;
  size?: number;
  prefix?: string | number | React.ReactNode;
  postfix?: string | number | React.ReactNode;
};

const LbcSymbol = (props: Props) => {
  const { prefix, postfix, size, isTitle = false } = props;
  return (
    <>
      {prefix}
      <Icon
        icon={ICONS.LBC}
        size={isTitle ? 22 : size}
        className={classnames(LBC_SYMBOL_CLASS, {
          'tw:ml-[4px]': prefix,
          'tw:mr-app-xxxxs': postfix,
          'tw:mb-[4px]': isTitle,
        })}
      />
      <span>{postfix}</span>
    </>
  );
};

export default LbcSymbol;
