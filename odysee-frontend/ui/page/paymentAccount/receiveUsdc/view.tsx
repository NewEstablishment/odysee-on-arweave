import React from 'react';
import I18nMessage from 'component/i18nMessage';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import ReceiveAddressLayout from 'component/receiveAddressLayout';
import Symbol from 'component/common/symbol';
import { PAYMENT_ACCOUNT_CARD_CLASS, PAYMENT_ACCOUNT_CARD_TITLE_CLASS, PAYMENT_ACCOUNT_PAGE_CLASSES } from '../classes';

const DEPOSIT_ADDRESS = '0x67b573D3dA11E21Af9993c5a94C7c5cD88638F33';

function ReceiveUsdc(props: any) {
  const { cardHeader, arWalletStatus } = props;
  return (
    <Card
      className={`${PAYMENT_ACCOUNT_CARD_CLASS}${!arWalletStatus ? ` ${CARD_CLASSES.disabled}` : ''}`}
      title={cardHeader()}
      titleClassName={PAYMENT_ACCOUNT_CARD_TITLE_CLASS}
      background
      actions={
        <ReceiveAddressLayout address={DEPOSIT_ADDRESS}>
          <div className={PAYMENT_ACCOUNT_PAGE_CLASSES.sectionContent}>
            <h2 className={PAYMENT_ACCOUNT_PAGE_CLASSES.sectionTitle}>
              <I18nMessage
                tokens={{
                  usdc: (
                    <>
                      <Symbol token="usdc" />
                      USDC
                    </>
                  ),
                  bnb: (
                    <>
                      <Symbol token="bnb" />
                      BNB
                    </>
                  ),
                  base: (
                    <>
                      <Symbol token="base" />
                      Base
                    </>
                  ),
                  eth: (
                    <>
                      <Symbol token="eth" />
                      ETH
                    </>
                  ),
                }}
              >
                This is your %usdc% deposit address on the %bnb%, %base%, and %eth% chains. You can use this address to
                deposit %usdc% into your account directly from your own wallet.
              </I18nMessage>
            </h2>
            <div className={PAYMENT_ACCOUNT_PAGE_CLASSES.sectionWarning}>
              <I18nMessage
                tokens={{
                  usdc: (
                    <>
                      <Symbol token="usdc" />
                      USDC
                    </>
                  ),
                  bnb: (
                    <>
                      <Symbol token="bnb" />
                      BNB
                    </>
                  ),
                  base: (
                    <>
                      <Symbol token="base" />
                      Base
                    </>
                  ),
                  eth: (
                    <>
                      <Symbol token="eth" />
                      Ethereum
                    </>
                  ),
                }}
              >
                Be aware that at this moment, we only support %usdc% on the %bnb%, %base% and %eth% chains. Sending
                %usdc% on any other chain will result in a loss of funds.
              </I18nMessage>
            </div>
          </div>
        </ReceiveAddressLayout>
      }
    />
  );
}

export default ReceiveUsdc;
