import React from 'react';
import classnames from 'classnames';
import { ENABLE_UI_NOTIFICATIONS, FAVICON, FAVICON_NOTIFICATION } from 'config';
import { buildUnseenCountStr } from 'util/notifications';
import { useAppSelector } from 'redux/hooks';
import { selectUnseenNotificationCount } from 'redux/selectors/notifications';
import { selectUser } from 'redux/selectors/user';
import { NOTIFICATION_BUBBLE_CLASSES as C } from './classes';
type Props = {
  inline?: boolean;
};
export default function NotificationBubble(props: Props) {
  const { inline = false } = props;
  const unseenCount = useAppSelector(selectUnseenNotificationCount);
  const user = useAppSelector(selectUser);
  const notificationsEnabled = ENABLE_UI_NOTIFICATIONS || (user && user.experimental_ui);

  if (!notificationsEnabled) {
    return null;
  }

  var favicon = document.querySelector('link[rel="icon"]');

  if (favicon) {
    if (unseenCount > 0) {
      (favicon as HTMLLinkElement).href = FAVICON_NOTIFICATION;
    } else {
      (favicon as HTMLLinkElement).href = FAVICON;
    }
  }

  return (
    <span
      className={classnames(C.base, {
        [C.inline]: inline,
        [C.hidden]: unseenCount === 0,
      })}
    >
      <span
        className={classnames('notification__count', {
          [C.small]: unseenCount > 9,
        })}
      >
        {buildUnseenCountStr(unseenCount)}
      </span>
    </span>
  );
}
