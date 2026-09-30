import React from 'react';
import classnames from 'classnames';
import { NavLink } from 'react-router-dom';
// @ts-ignore
import { useArStatus } from 'effects/use-ar-status';
import { useAppDispatch, useAppSelector } from 'redux/hooks';
import { doArConnect } from 'redux/actions/arwallet';
import { selectFullAPIArweaveAccounts } from 'redux/selectors/payments';

export default function WalletStatus() {
  const dispatch = useAppDispatch();
  const arweaveWallets = useAppSelector(selectFullAPIArweaveAccounts);
  const { activeArStatus } = useArStatus();
  return arweaveWallets && activeArStatus !== 'connected' ? (
    <div
      className={classnames(
        'tw:mb-app-m tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-app-s tw:rounded-app tw:p-app-s tw:[backdrop-filter:blur(4px)] tw:[transition:background_0.4s,border_0.4s]',
        {
          'tw:border tw:border-app-text-error tw:bg-[rgba(218,4,4,0.1)]':
            activeArStatus !== 'authenticating' && activeArStatus !== 'authenticated',
          'tw:border tw:border-[rgb(231,150,6)] tw:bg-[rgba(218,218,4,0.2)]': activeArStatus === 'authenticating',
          'tw:border-2 tw:border-[rgba(0,255,64,0.6)] tw:bg-[rgba(0,255,21,0.2)]': activeArStatus === 'authenticated',
        }
      )}
    >
      {activeArStatus === 'not-authenticated' ? (
        arweaveWallets.length > 0 ? (
          <>
            <p className="tw:text-center">{__('To use AR on Odysee, you need to be signed into Wander.')}</p>
            <NavLink className="tw:cursor-pointer tw:text-app-primary" to="/$/wallet">
              Wallet settings
            </NavLink>
          </>
        ) : (
          <>
            <p className="tw:text-center">
              {__(
                'To use AR on Odysee, you need to create and/or sign into Wander – a cryptocurrency wallet compatible with AR.'
              )}{' '}
              <a
                href="https://help.odysee.tv/category-monetization/setup"
                target="_blank"
                rel="noopener noreferrer"
                className="tw:cursor-pointer tw:font-bold tw:text-app-primary tw:hover:text-app-secondary"
              >
                {__('Learn more')}
              </a>
            </p>
            <NavLink className="tw:cursor-pointer tw:text-app-primary" to="/$/wallet">
              Wallet settings
            </NavLink>
          </>
        )
      ) : activeArStatus === 'authenticated' ? (
        <>
          <p className="tw:text-center">{__('To use AR on Odysee, the Wander wallet must be connected.')}</p>
          <div>
            <a
              className="tw:cursor-pointer tw:font-bold tw:text-app-primary tw:hover:text-app-secondary"
              onClick={() => dispatch(doArConnect())}
            >
              Connect now
            </a>
            <span> or </span>
            <a
              className="tw:cursor-pointer tw:font-bold tw:text-app-primary tw:hover:text-app-secondary"
              onClick={() => window.wanderInstance.open()}
            >
              change login
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="tw:text-center">{__('Odysee is signing you in to your Wander wallet. Please wait...')}</p>
          <a className="tw:cursor-pointer tw:text-app-primary" onClick={() => window.wanderInstance.open()}>
            Show status
          </a>
        </>
      )}
    </div>
  ) : null;
}
