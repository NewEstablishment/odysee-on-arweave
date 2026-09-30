import React from 'react';
import * as SETTINGS from 'constants/settings';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doSetClientSetting } from 'redux/actions/settings';
import { selectClientSetting } from 'redux/selectors/settings';
import { selectPrefsReady } from 'redux/selectors/sync';

type Props = {
  onEnable: () => void;
};

export default function LivestreamWebrtcOptIn({ onEnable }: Props) {
  const dispatch = useAppDispatch();
  const p2pEnabled = useAppSelector((state) => selectClientSetting(state, SETTINGS.P2P_DELIVERY));
  const dismissed = useAppSelector((state) => selectClientSetting(state, SETTINGS.P2P_OPT_IN_DISMISSED));
  const prefsReady = useAppSelector(selectPrefsReady);

  if (p2pEnabled || dismissed) return null;

  function handleEnableOnce() {
    dispatch(doSetClientSetting(SETTINGS.P2P_DELIVERY, true));
    onEnable();
  }

  function handleEnableAlways() {
    dispatch(doSetClientSetting(SETTINGS.P2P_DELIVERY, true, prefsReady));
    onEnable();
  }

  function handleDismiss() {
    dispatch(doSetClientSetting(SETTINGS.P2P_OPT_IN_DISMISSED, true, prefsReady));
  }

  return (
    <div className="tw:rounded-[8px] tw:border tw:border-[rgba(var(--color-primary-dynamic),0.15)] tw:bg-[rgba(var(--color-primary-dynamic),0.04)] tw:px-app-s tw:py-app-xs tw:[animation:webrtc-opt-in-fade_0.3s_ease]">
      <div className="tw:flex tw:items-center tw:gap-app-s tw:upto-small:flex-wrap">
        <div className="tw:flex tw:size-[32px] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-[8px] tw:bg-[rgba(var(--color-primary-dynamic),0.1)] tw:text-app-primary">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <div className="tw:min-w-0 tw:flex-1">
          <p className="tw:m-0 tw:text-app-small tw:leading-[1.3] tw:font-semibold tw:text-app-text">
            {__('P2P streaming available')}
          </p>
          <p className="tw:mt-[2px] tw:mr-0 tw:mb-0 tw:ml-0 tw:text-[11px] tw:leading-[1.4] tw:text-app-text-subtitle">
            {__('Share stream data with other viewers to reduce load. Your IP may be visible to peers.')}
          </p>
        </div>
        <div className="tw:flex tw:shrink-0 tw:gap-[6px] tw:upto-small:w-full tw:upto-small:justify-end">
          <button
            className="tw:cursor-pointer tw:whitespace-nowrap tw:rounded-[6px] tw:[border:none] tw:bg-app-primary tw:px-[12px] tw:py-[5px] tw:text-[12px] tw:font-semibold tw:text-white tw:transition-all tw:duration-150 tw:ease-[ease] tw:hover:brightness-110"
            onClick={handleEnableOnce}
          >
            {__('Try it')}
          </button>
          <button
            className="tw:cursor-pointer tw:whitespace-nowrap tw:rounded-[6px] tw:border tw:border-[rgba(var(--color-header-button-base),0.15)] tw:bg-[rgba(var(--color-header-button-base),0.06)] tw:px-[12px] tw:py-[5px] tw:text-[12px] tw:font-semibold tw:text-app-text-subtitle tw:transition-all tw:duration-150 tw:ease-[ease] tw:hover:bg-[rgba(var(--color-header-button-base),0.12)] tw:hover:text-app-text"
            onClick={handleEnableAlways}
          >
            {__('Always')}
          </button>
          <button
            className="tw:flex tw:size-[28px] tw:cursor-pointer tw:items-center tw:justify-center tw:whitespace-nowrap tw:rounded-[50%] tw:[border:none] tw:[background:none] tw:p-0 tw:text-[12px] tw:font-semibold tw:text-app-text-subtitle tw:transition-all tw:duration-150 tw:ease-[ease] tw:hover:bg-[rgba(var(--color-header-button-base),0.1)] tw:hover:text-app-text"
            onClick={handleDismiss}
            title={__('Dismiss')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
