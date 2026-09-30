import React from 'react';
import classnames from 'classnames';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import ButtonToggle from 'component/buttonToggle';
import { useAppSelector } from 'redux/hooks';
import { selectArweaveAddress } from 'redux/selectors/arwallet';
import { PAYMENT_ACCOUNT_CARD_CLASS, PAYMENT_ACCOUNT_CARD_TITLE_CLASS } from '../classes';
type Props = {
  cardHeader: () => React.ReactNode;
  arweaveWallets: any;
  arWalletStatus: any;
};

function ArWallets(props: Props) {
  const { cardHeader, arweaveWallets, arWalletStatus } = props;
  const activeAddress = useAppSelector(selectArweaveAddress);
  return (
    <Card
      className={`${PAYMENT_ACCOUNT_CARD_CLASS}${!arWalletStatus ? ` ${CARD_CLASSES.disabled}` : ''}`}
      title={cardHeader()}
      titleClassName={PAYMENT_ACCOUNT_CARD_TITLE_CLASS}
      background
      actions={
        <>
          <div className="tw:w-full tw:rounded-app tw:bg-app-background tw:p-app-s">
            <div className="tw:mb-app-xs tw:flex tw:w-full tw:rounded-app tw:border-b tw:border-b-[var(--color-header-button)] tw:px-app-xxs tw:py-app-xxxs tw:font-bold">
              <div className="tw:min-w-[30px]">#</div>
              <div className="tw:w-[440px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                {__('Arweave Address')}
              </div>
              <div className="tw:w-[440px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                {__('Deposit Address')}
              </div>
              <div className="tw:ml-auto tw:min-w-[86px]">{__('Status')}</div>
              <div className="tw:min-w-[86px]">{__('Connected')}</div>
            </div>
            {arweaveWallets.map((wallet, index) => {
              return (
                <div
                  key={index}
                  className={classnames('tw:flex tw:w-full tw:rounded-app tw:px-app-xxs tw:py-app-xxxs', {
                    'tw:pointer-events-none tw:opacity-60': wallet.address !== activeAddress,
                  })}
                >
                  <div className="tw:min-w-[30px]">{index + 1}</div>
                  <div className="tw:w-[440px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                    {wallet.address}
                  </div>
                  <div className="tw:w-[440px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                    {wallet.deposit_address}
                  </div>
                  <div className="tw:ml-auto tw:min-w-[86px]">
                    <ButtonToggle status={wallet.status === 'active'} />
                  </div>
                  <div className="tw:min-w-[86px]">{wallet.default.toString()}</div>
                </div>
              );
            })}
          </div>
        </>
      }
    />
  );
}

export default ArWallets;
