import React from 'react';
import classnames from 'classnames';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import ButtonToggleAddressActive from 'component/buttonToggleAddressActive';
import { useAppSelector } from 'redux/hooks';
import { selectArweaveAddress } from 'redux/selectors/arwallet';
import { AR_ACCOUNT_CARD_CLASS, AR_ACCOUNT_CARD_TITLE_CLASS } from '../classes';
type Props = {
  cardHeader: any;
  arweaveWallets: any;
  activeArStatus: any;
};

function ArWallets(props: Props) {
  const { cardHeader, arweaveWallets, activeArStatus } = props;
  const activeAddress = useAppSelector(selectArweaveAddress);
  return (
    <Card
      className={`${AR_ACCOUNT_CARD_CLASS}${activeArStatus !== 'connected' ? ` ${CARD_CLASSES.disabled}` : ''}`}
      title={cardHeader()}
      titleClassName={AR_ACCOUNT_CARD_TITLE_CLASS}
      background
      actions={
        <>
          <div className="tw:w-full tw:rounded-app tw:bg-app-background tw:p-app-s">
            <div className="tw:mb-app-xs tw:flex tw:w-full tw:rounded-app tw:border-b tw:border-b-[var(--color-header-button)] tw:px-app-xxs tw:py-app-xxxs tw:font-bold">
              <div className="tw:min-w-[30px]">#</div>
              <div className="tw:w-[440px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                {__('Arweave Address')}
              </div>
              <div className="tw:ml-auto tw:min-w-[86px]">{__('Status')}</div>
              <div className="tw:flex tw:min-w-[86px] tw:items-center tw:justify-center">{__('Connected')}</div>
            </div>
            {arweaveWallets.map((wallet, index) => {
              return (
                <div
                  className={classnames('tw:flex tw:w-full tw:rounded-app tw:px-app-xxs tw:py-app-xxxs', {
                    'tw:pointer-events-none tw:opacity-60': wallet.address !== activeAddress,
                  })}
                  key={wallet.address}
                >
                  <div className="tw:min-w-[30px]">{index + 1}</div>
                  <div className="tw:w-[440px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                    {wallet.address}
                  </div>
                  <div className="tw:ml-auto tw:min-w-[86px]">
                    <ButtonToggleAddressActive address={wallet?.address} />
                  </div>
                  <div className="tw:flex tw:min-w-[86px] tw:items-center tw:justify-center">
                    {wallet.default ? (
                      <img
                        className="tw:size-[16px] tw:flex-shrink-0"
                        src="https://thumbs.odycdn.com/8ee966185b537b147fb7be4412b6bc68.webp"
                      />
                    ) : (
                      <img
                        className="tw:size-[16px] tw:flex-shrink-0"
                        src="https://thumbs.odycdn.com/bd2adbec2979b00b1fcb6794e118d5db.webp"
                      />
                    )}
                  </div>
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
