import React from 'react';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import Counter from 'component/counter';
import classnames from 'classnames';
import {
  SYMBOL_ICON_CLASS,
  SYMBOL_ICON_TITLE_CLASS,
  SYMBOL_WRAPPER_CHAIN_CLASS,
  SYMBOL_WRAPPER_CLASS,
  SYMBOL_WRAPPER_DEFAULT_CLASS,
  SYMBOL_WRAPPER_INLINE_CLASS,
} from './symbol-classes';
type Props = {
  className?: string;
  withText?: boolean;
  isTitle?: boolean;
  size?: number;
  amount?: string | number;
  token?: string;
  chain?: string;
  precision?: number;
  counter?: boolean;
  inline?: boolean;
  postfix?: any;
  badge?: boolean;
  noFormat?: boolean;
};

const Symbol = (props: Props) => {
  const {
    token,
    chain,
    amount = null,
    precision = 8,
    size,
    isTitle = false,
    counter = false,
    inline = false,
    className,
  } = props;
  const displayAmount = (Number(amount) >= 0 ? Number(amount) : 0).toFixed(precision);
  const displayLabel = token !== 'wallet' && !!token ? ` ${token.toUpperCase()}` : token === 'wallet' ? ' USD' : null;
  return (
    <>
      <div
        className={classnames(
          SYMBOL_WRAPPER_CLASS,
          {
            [SYMBOL_WRAPPER_DEFAULT_CLASS]: !chain && !inline,
            [SYMBOL_WRAPPER_CHAIN_CLASS]: chain && !inline,
            [SYMBOL_WRAPPER_INLINE_CLASS]: inline,
          },
          className
        )}
      >
        <Icon
          icon={token ? ICONS[token.toUpperCase()] : ICONS.LBC}
          size={isTitle ? 22 : size}
          className={classnames(SYMBOL_ICON_CLASS, {
            [SYMBOL_ICON_TITLE_CLASS]: isTitle,
          })}
        />
        {chain && <Icon icon={ICONS[chain.toUpperCase()]} />}
      </div>
      <span>
        {amount !== null && (counter ? <Counter value={displayAmount} precision={precision} /> : displayAmount)}
        {displayLabel}
      </span>
    </>
  );
};

export default Symbol;
