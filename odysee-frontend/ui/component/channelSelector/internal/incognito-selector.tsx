import React from 'react';
import classnames from 'classnames';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import { CHANNEL_SELECTOR_CLASSES as C } from '../classes';
type Props = {
  isSelected?: boolean;
};

const IncognitoSelector = (props: Props) => {
  const { isSelected } = props;
  return (
    <div
      className={classnames(C.item, {
        [C.itemSelected]: isSelected,
      })}
      data-channel-selector-item=""
      data-channel-selector-selected={isSelected ? '' : undefined}
    >
      <Icon sectionIcon icon={ICONS.ANONYMOUS} />
      <div className={C.text} data-channel-selector-text="">
        {__('Anonymous')}
      </div>
      {isSelected && <Icon icon={ICONS.DOWN} />}
    </div>
  );
};

export default IncognitoSelector;
