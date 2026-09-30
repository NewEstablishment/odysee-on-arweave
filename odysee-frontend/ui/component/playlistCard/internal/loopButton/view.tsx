import * as ICONS from 'constants/icons';
import React from 'react';
import Button from 'component/button';
import { BUTTON_TOGGLE_ACTIVE_CLASS, BUTTON_TOGGLE_CLASS } from 'component/button/classes';
import classnames from 'classnames';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectListIsLoopedForId } from 'redux/selectors/content';
import { doToggleLoopList } from 'redux/actions/content';

type Props = {
  id: string;
};

const LoopButton = (props: Props) => {
  const { id } = props;
  const dispatch = useAppDispatch();
  const loop = useAppSelector((state) => selectListIsLoopedForId(state, id));
  return (
    <Button
      button="alt"
      className={classnames(BUTTON_TOGGLE_CLASS, 'tw:bg-[unset]', {
        [BUTTON_TOGGLE_ACTIVE_CLASS]: loop,
      })}
      title={__('Loop')}
      icon={ICONS.REPEAT}
      onClick={() =>
        dispatch(
          doToggleLoopList({
            collectionId: id,
          })
        )
      }
    />
  );
};

export default LoopButton;
