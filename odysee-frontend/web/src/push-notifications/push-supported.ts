import { isSupported } from 'firebase/messaging';
import { isServedFromManifest } from 'util/manifest-prefix';

export const isPushSupported = async (): Promise<boolean> => {
  if (isServedFromManifest()) return false;

  const hasServiceWorker = 'serviceWorker' in navigator;
  const hasNotifications = 'Notification' in window;
  const hasPushManager = 'PushManager' in window;

  if (!hasServiceWorker || !hasNotifications || !hasPushManager) return false;

  try {
    return await isSupported();
  } catch {}

  return false;
};
