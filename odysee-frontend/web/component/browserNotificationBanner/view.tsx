import React from 'react';
import * as ICONS from 'constants/icons';
import useBrowserNotifications from '$web/component/browserNotificationSettings/use-browser-notifications';
import Icon from 'component/common/icon';
import Button from 'component/button';
import usePersistedState from 'effects/use-persisted-state';
import { BROWSER_NOTIFICATION_NOTICE_CLASS } from 'component/browserNotificationBanner/classes';
export const BrowserNotificationBanner = () => {
  const { pushInitialized, pushSupported, pushEnabled, pushPermission, pushToggle, pushErrorModal } =
    useBrowserNotifications();
  const [hasAcknowledgedPush, setHasAcknowledgedPush] = usePersistedState('push-nag', false);

  if (!pushInitialized || !pushSupported || pushEnabled || pushPermission === 'denied' || hasAcknowledgedPush) {
    return null;
  }

  const handleClose = () => setHasAcknowledgedPush(true);

  return (
    <>
      <div className={BROWSER_NOTIFICATION_NOTICE_CLASS}>
        <div className="tw:flex tw:items-center">
          <Icon className="tw:mr-app-m tw:shrink-0" icon={ICONS.NOTIFICATION} size={32} />
          <p>
            <strong>{__('Realtime push notifications straight to your browser.')}</strong>
            <br />
            <span className="tw:inline-block tw:text-app-small tw:text-app-text-subtitle">
              {__("Don't miss another notification again.")}
            </span>
          </p>
        </div>
        <div className="tw:flex tw:items-center tw:upto-small:mt-app-l">
          <Button
            className="tw:mr-app-m"
            button="primary"
            title={__('Enable Push Notifications')}
            label={__('Enable Push Notifications')}
            onClick={pushToggle}
          />
          <Button button="close" title={__('Dismiss')} icon={ICONS.REMOVE} onClick={handleClose} />
        </div>
      </div>
      {pushErrorModal()}
    </>
  );
};
export default BrowserNotificationBanner;
