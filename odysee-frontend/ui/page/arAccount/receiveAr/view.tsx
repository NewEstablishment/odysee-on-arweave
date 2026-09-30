import React from 'react';
import I18nMessage from 'component/i18nMessage';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import ReceiveAddressLayout from 'component/receiveAddressLayout';
import Symbol from 'component/common/symbol';
import { AR_ACCOUNT_CARD_CLASS, AR_ACCOUNT_CARD_TITLE_CLASS, AR_ACCOUNT_PAGE_CLASSES } from '../classes';
type Props = {
  cardHeader: any;
  wallet: any;
  arWalletStatus: any;
};

function ReceiveAr(props: Props) {
  const { cardHeader, wallet, arWalletStatus } = props;
  return (
    <Card
      className={`${AR_ACCOUNT_CARD_CLASS}${!arWalletStatus ? ` ${CARD_CLASSES.disabled}` : ''}`}
      title={cardHeader()}
      titleClassName={AR_ACCOUNT_CARD_TITLE_CLASS}
      background
      actions={
        <ReceiveAddressLayout address={wallet?.address}>
          <div className={AR_ACCOUNT_PAGE_CLASSES.sectionContent}>
            <h2 className={AR_ACCOUNT_PAGE_CLASSES.sectionTitle}>
              <I18nMessage
                tokens={{
                  ar: (
                    <>
                      <Symbol token="ar" />
                      AR
                    </>
                  ),
                }}
              >
                This is your %ar% deposit address.
              </I18nMessage>
            </h2>
          </div>
        </ReceiveAddressLayout>
      }
    />
  );
}

export default ReceiveAr;
