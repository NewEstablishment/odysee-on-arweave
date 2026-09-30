import * as ICONS from 'constants/icons';
import React from 'react';
import Button from 'component/button';
import { BUTTON_TOGGLE_ACTIVE_CLASS, BUTTON_TOGGLE_CLASS } from 'component/button/classes';
import classnames from 'classnames';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectListIsShuffledForId } from 'redux/selectors/content';
import { doToggleShuffleList } from 'redux/actions/content';

type Props = {
  url: string;
  id: string;
};

const ShuffleButton = (props: Props) => {
  const { url, id } = props;
  const dispatch = useAppDispatch();
  const shuffle = useAppSelector((state) => selectListIsShuffledForId(state, id));
  return (
    <Button
      button="alt"
      className={classnames(BUTTON_TOGGLE_CLASS, 'tw:bg-[unset]', {
        [BUTTON_TOGGLE_ACTIVE_CLASS]: shuffle,
      })}
      title={__('Shuffle')}
      icon={ICONS.SHUFFLE}
      onClick={() =>
        dispatch(
          doToggleShuffleList({
            currentUri: url,
            collectionId: id,
          })
        )
      }
    />
  );
};

export default ShuffleButton;
