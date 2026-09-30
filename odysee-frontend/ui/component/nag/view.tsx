import { v4 as uuid } from 'uuid';
import * as ICONS from 'constants/icons';
import classnames from 'classnames';
import React from 'react';
import Button from 'component/button';
import { useAppDispatch } from 'redux/hooks';
import { doUpdateVisibleNagIds } from 'redux/actions/notifications';
import { NAG_CLASSES } from './classes';

type Props = {
  message: string | React.ReactNode;
  action?: React.ReactNode;
  closeTitle?: string;
  actionText?: string;
  href?: string;
  type?: string;
  inline?: boolean;
  relative?: boolean;
  onClick?: () => void;
  onClose?: () => void;
};
export default function Nag(props: Props) {
  const {
    message,
    action: customAction,
    closeTitle,
    actionText,
    href,
    onClick,
    onClose,
    type,
    inline,
    relative,
  } = props;
  const dispatch = useAppDispatch();
  const buttonProps = onClick
    ? {
        onClick,
      }
    : href
      ? {
          href,
        }
      : null;
  React.useEffect(() => {
    const id = uuid();
    dispatch(doUpdateVisibleNagIds(id, true));
    return () => {
      dispatch(doUpdateVisibleNagIds(id, false));
    }; // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, []);
  return (
    <div
      className={classnames(NAG_CLASSES.root, {
        [NAG_CLASSES.helpful]: type === 'helpful',
        [NAG_CLASSES.error]: type === 'error',
        [NAG_CLASSES.inline]: inline,
        [NAG_CLASSES.relative]: relative,
      })}
    >
      <div className={NAG_CLASSES.message}>{message}</div>

      {customAction}

      {buttonProps && (
        <Button
          className={classnames(NAG_CLASSES.button, {
            [NAG_CLASSES.buttonHelpful]: type === 'helpful',
            [NAG_CLASSES.buttonError]: type === 'error',
          })}
          {...buttonProps}
        >
          {actionText}
        </Button>
      )}

      {onClose && (
        <Button
          className={classnames(NAG_CLASSES.button, NAG_CLASSES.close, {
            [NAG_CLASSES.buttonHelpful]: type === 'helpful',
            [NAG_CLASSES.buttonError]: type === 'error',
          })}
          title={closeTitle}
          icon={ICONS.REMOVE}
          onClick={onClose}
        />
      )}
    </div>
  );
}
