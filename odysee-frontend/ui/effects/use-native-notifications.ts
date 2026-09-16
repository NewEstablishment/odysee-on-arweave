import { useEffect } from 'react';
import { useAppDispatch } from 'redux/hooks';
import { doNotificationCategories, doNotificationList, doResetNativeNotifications } from 'redux/actions/notifications';
import { hyperbeamNodeEnabled } from 'util/hyperbeamDevices';

export default function useNativeNotifications(profile?: string) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (!hyperbeamNodeEnabled()) return;
    dispatch(doResetNativeNotifications(profile));
    if (!profile) return;
    dispatch(doNotificationCategories());
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (!active || pending || document.hidden) return;
      pending = true;
      try {
        await dispatch(doNotificationList());
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      dispatch(doResetNativeNotifications());
    };
  }, [dispatch, profile]);
}
