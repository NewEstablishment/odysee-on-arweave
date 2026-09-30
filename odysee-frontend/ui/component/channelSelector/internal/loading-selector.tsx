import React from 'react';
import classnames from 'classnames';
import { CHANNEL_SELECTOR_CLASSES as C } from '../classes';
type Props = {
  isSelected?: boolean;
};

const LoadingSelector = (props: Props) => {
  const { isSelected } = props;
  return (
    <div
      className={classnames(C.item, {
        [C.itemSelected]: isSelected,
      })}
      data-channel-selector-item=""
      data-channel-selector-selected={isSelected ? '' : undefined}
    >
      <div className={C.text} data-channel-selector-text="">
        {__('Loading channels...')}
      </div>
    </div>
  );
};

export default LoadingSelector;
