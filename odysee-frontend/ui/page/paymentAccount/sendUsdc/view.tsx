/* eslint-disable */
import React from 'react';
import * as ICONS from 'constants/icons';
import classnames from 'classnames';
import { Menu, MenuList, MenuButton, MenuItem } from 'component/common/menu';
import Icon from 'component/common/icon';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import Button from 'component/button';
import Symbol from 'component/common/symbol';
import { PAYMENT_ACCOUNT_CARD_CLASS, PAYMENT_ACCOUNT_CARD_TITLE_CLASS } from '../classes';
import { CHANNEL_SELECTOR_CLASSES } from 'component/channelSelector/classes';

function SendUsdc(props: any) {
  const { cardHeader, arWalletStatus, balance } = props;
  const [canSend, setCanSend] = React.useState(false);
  const inputAmountRef = React.useRef<HTMLInputElement | null>(null);
  const inputReceivingAddressRef = React.useRef<any>();
  const networks = [
    {
      symbol: 'eth',
      label: 'Ethereum',
    },
    {
      symbol: 'bnb',
      label: 'BNB',
    },
    {
      symbol: 'base',
      label: 'Base',
    },
  ];
  const [targetNetwork, setTargetNetwork] = React.useState(networks[0]);

  function handleSetMaxAmount() {
    if (inputAmountRef && inputAmountRef.current) {
      inputAmountRef.current.value = String(balance.toFixed(8) || 0);
    }

    handleCheckForm();
  }

  function handleCheckForm() {
    const isValidEthAddress = (address) => typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address);

    const check =
      inputAmountRef.current?.value &&
      Number(inputAmountRef.current?.value) <= Number(balance) &&
      isValidEthAddress(inputReceivingAddressRef.current?.value ?? '');
    setCanSend(check);
  }

  return (
    <Card
      className={classnames(PAYMENT_ACCOUNT_CARD_CLASS, { [CARD_CLASSES.disabled]: !arWalletStatus })}
      title={cardHeader()}
      titleClassName={PAYMENT_ACCOUNT_CARD_TITLE_CLASS}
      background
      actions={
        <>
          <div className="tw:flex tw:gap-app-s">
            <div className="tw:flex tw:flex-col">
              {__('Amount')}
              <input
                ref={inputAmountRef}
                type="number"
                step="0.00000001"
                placeholder={Number(0).toFixed(8)}
                onChange={handleCheckForm}
                className="tw:w-full"
              />
              <span className="tw:mt-app-xxxs tw:text-app-xsmall" onClick={handleSetMaxAmount}>
                {__('Totally available: ')}
                {balance.toFixed(8)}
              </span>
            </div>
            <div className="tw:flex tw:flex-col">
              {__('Network')}
              <div className="network-selector">
                <Menu>
                  <MenuButton className="menu__link tw:min-w-[150px] tw:rounded-app tw:bg-app-background">
                    <Symbol token={targetNetwork.symbol} />
                    {targetNetwork.label}
                    <Icon className="tw:mr-0 tw:ml-auto" icon={ICONS.DOWN} />
                  </MenuButton>
                  <MenuList className={CHANNEL_SELECTOR_CLASSES.list}>
                    {networks.map((network, index) => {
                      return (
                        <MenuItem key={index} onSelect={() => setTargetNetwork(network)}>
                          <div
                            className={classnames(CHANNEL_SELECTOR_CLASSES.item, {
                              [CHANNEL_SELECTOR_CLASSES.itemSelected]: targetNetwork.symbol === network.symbol,
                            })}
                            data-channel-selector-item=""
                            data-channel-selector-selected={targetNetwork.symbol === network.symbol ? '' : undefined}
                          >
                            <Symbol token={network.symbol} />
                            {network.label}
                          </div>
                        </MenuItem>
                      );
                    })}
                  </MenuList>
                </Menu>
              </div>
            </div>
            <div className="tw:flex tw:flex-col">
              {__('Receiving address')}
              <input
                ref={inputReceivingAddressRef}
                type="text"
                placeholder={`0x0000000000000000000000000000000000000000`}
                onChange={handleCheckForm}
                className="tw:min-w-[450px]"
              />
            </div>
            <div className="tw:mt-[24px]">
              <Button button="primary" title={__('Send')} label={__('Send')} disabled={!canSend} />
            </div>
          </div>
        </>
      }
    />
  );
}

export default SendUsdc;
