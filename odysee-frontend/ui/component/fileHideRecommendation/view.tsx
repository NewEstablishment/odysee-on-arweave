import React from 'react';
import Button from 'component/button';
import { FILE_ACTION_BUTTON_CLASS } from 'component/common/file-action-button-classes';
import * as ICONS from 'constants/icons';
import { useAppDispatch } from 'redux/hooks';
import { doRemovePersonalRecommendation } from 'redux/actions/search';
type Props = {
  uri: string;
  buttonType?: string | null | undefined;
  showLabel?: boolean | null | undefined;
  focusable?: boolean;
};
export default function FileHideRecommendation(props: Props) {
  const { uri, buttonType, showLabel = false, focusable = true } = props;
  const dispatch = useAppDispatch();

  function handleClick(e) {
    dispatch(doRemovePersonalRecommendation(uri));
    e.preventDefault();
  }

  const label = __('Not interested');

  return (
    <Button
      button={buttonType || 'alt'}
      className={buttonType ? undefined : FILE_ACTION_BUTTON_CLASS}
      title={label}
      icon={ICONS.REMOVE}
      label={showLabel ? label : null}
      onClick={handleClick}
      aria-hidden={!focusable}
      tabIndex={focusable ? 0 : -1}
    />
  );
}
