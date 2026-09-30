import * as React from 'react';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import { Modal } from 'modal/modal';
type InlineMessageProps = {
  title: string;
  children: React.ReactNode;
};

const InlineMessage = (props: InlineMessageProps) => {
  const { title, children } = props;
  return (
    <div className="tw:flex tw:items-center tw:rounded-app tw:border tw:border-app-primary tw:bg-[rgba(var(--color-primary-dynamic),0.06)] tw:p-app-m">
      <Icon className="tw:mr-app-m tw:shrink-0" color="#E50054" icon={ICONS.ALERT} size={32} />
      <div>
        <span>{title}</span>
        <span className="tw:inline-block tw:text-app-small tw:text-app-text-subtitle">{children}</span>
      </div>
    </div>
  );
};

export const BrowsernotificationsBlocked = () => {
  return (
    <InlineMessage title={__('Heads up: browser notifications are currently blocked in this browser.')}>
      {__('To enable push notifications please configure your browser to allow notifications on odysee.com.')}
    </InlineMessage>
  );
};
export const BrowserNotificationHints = () => {
  return (
    <InlineMessage title={__("Browser notifications aren't supported. Here's a few tips:")}>
      <ul className="tw:inline-block tw:text-app-small tw:text-app-text-subtitle">
        <li className="tw:ml-app-m">{__("Notifications aren't available when in incognito or private mode.")}</li>
        <li className="tw:ml-app-m">
          {__(
            "On Firefox, notifications won't function if cookies are set to clear on browser close. Please disable or add an exception for Odysee, then refresh."
          )}
        </li>
        <li className="tw:ml-app-m">{__('For Brave, enable google push notifications in settings.')}</li>
        <li className="tw:ml-app-m">
          {__('Check browser settings to see if notifications are disabled or otherwise restricted.')}
        </li>
      </ul>
    </InlineMessage>
  );
};
type ModalProps = {
  doHideModal: () => void;
};
export const BrowserNotificationErrorModal = (props: ModalProps) => {
  const { doHideModal } = props;
  return (
    <Modal type="card" isOpen onAborted={doHideModal}>
      <BrowserNotificationHints />
    </Modal>
  );
};
