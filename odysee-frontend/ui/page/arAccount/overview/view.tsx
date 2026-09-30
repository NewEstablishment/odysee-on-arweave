import React from 'react';
import { NavLink } from 'react-router-dom';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import QRCode from 'component/common/qr-code';
import CopyableText from 'component/copyableText';
import ButtonToggle from 'component/buttonToggle';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import Symbol from 'component/common/symbol';
import Button from 'component/button';
import Spinner from 'component/spinner';
import ButtonToggleAddressActive from 'component/buttonToggleAddressActive';
import I18nMessage from 'component/i18nMessage';
import { LocalStorage } from 'util/storage';
import { useAppDispatch } from 'redux/hooks';
import { doArSend } from 'redux/actions/arwallet';
import { AR_ACCOUNT_OVERVIEW_CLASSES } from './classes';
import { AR_ACCOUNT_CARD_CLASS, AR_ACCOUNT_CARD_TITLE_CLASS, AR_ACCOUNT_PAGE_CLASSES } from '../classes';
type Props = {
  cardHeader?: any;
  wallet?: any;
  balance?: any;
  arWalletStatus?: any;
  activeArStatus?: any;
};

const sortByDateDesc = (txs) => [...txs].sort((a, b) => b.date - a.date);

const isValidArweaveAddress = (address) => /^[A-Za-z0-9_-]{43}$/.test(String(address));

function Overview(props: Props) {
  const { cardHeader, wallet, balance, arWalletStatus, activeArStatus } = props;
  const dispatch = useAppDispatch();
  const [transactions, setTransactions] = React.useState(null);
  const [canSend, setCanSend] = React.useState(false);
  const [showQR, setShowQR] = React.useState(LocalStorage.getItem('WANDER_QR') === 'true');
  const inputAmountRef = React.useRef<any>();
  const inputReceivingAddressRef = React.useRef<any>();
  const walletType = LocalStorage.getItem('WALLET_TYPE');
  React.useEffect(() => {
    (async () => {
      if (window.arweaveWallet && activeArStatus === 'connected') {
        try {
          const address = await window.arweaveWallet.getActiveAddress();
          const senderTransactions = await fetch('https://arweave-search.goldsky.com/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: `{
                transactions(
                  owners: ["${address}"],
                ) { 
                  edges { 
                    node { 
                      id
                      recipient
                      quantity { ar }
                      owner { address }
                      block { timestamp height }
                      tags { name, value }
                    }
                  }
                }
              }`,
            }),
          });
          const receiverTransactions = await fetch('https://arweave-search.goldsky.com/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: `{
                transactions(
                  recipients: ["${address}"],
                ) { 
                  edges { 
                    node { 
                      id
                      recipient
                      quantity { ar }
                      owner { address }
                      block { timestamp height }
                      tags { name, value }
                    }
                  }
                }
              }`,
            }),
          });
          const receivedDataA = await senderTransactions.json();
          const receivedDataB = await receiverTransactions.json();
          const transactionsA = receivedDataA.data?.transactions?.edges || [];
          const transactionsB = receivedDataB.data?.transactions?.edges || [];
          const transactions = [...transactionsA, ...transactionsB];

          if (transactions) {
            const newTransactions = [];

            for (let entry of transactions) {
              const transaction = entry.node;
              const row = {
                txId: transaction.id,
                date: transaction.block.timestamp,
                action: transaction.recipient === address ? 'receiveTip' : 'sendTip',
                amount: Number(transaction.quantity.ar),
                target: transaction.recipient === address ? transaction.owner.address : transaction.recipient,
              };
              if (row.target && row.amount > 0) newTransactions.push(row);
            }

            setTransactions(sortByDateDesc(newTransactions));
          }
        } catch (e) {
          console.log(e);
        }
      }
    })();
  }, [activeArStatus, balance]);
  React.useEffect(() => {
    LocalStorage.setItem('WANDER_QR', String(showQR));
  }, [showQR]);

  function handleCheckForm() {
    const amountInput = inputAmountRef.current;
    const addressInput = inputReceivingAddressRef.current;
    const amountCursor = amountInput?.selectionStart;
    const addressCursor = addressInput?.selectionStart;
    const rawAmount = amountInput?.value;
    const rawAddress = addressInput?.value;
    const trimmedAmount = rawAmount && rawAmount.replace(/\s/g, '');
    const trimmedAddress = rawAddress && rawAddress.replace(/\s/g, '');

    if (rawAmount !== trimmedAmount && amountInput) {
      amountInput.value = trimmedAmount;
      amountInput.setSelectionRange(
        Number(amountCursor) - (Number(rawAmount?.length) - Number(trimmedAmount?.length)),
        Number(amountCursor) - (Number(rawAmount?.length) - Number(trimmedAmount?.length))
      );
    }

    if (rawAddress !== trimmedAddress && addressInput) {
      addressInput.value = trimmedAddress;
      addressInput.setSelectionRange(
        Number(addressCursor) - (Number(rawAddress?.length) - Number(trimmedAddress?.length)),
        Number(addressCursor) - (Number(rawAddress?.length) - Number(trimmedAddress?.length))
      );
    }

    const check =
      trimmedAmount &&
      Number(trimmedAmount) <= Number(balance.ar) &&
      isValidArweaveAddress(trimmedAddress) &&
      trimmedAddress !== wallet.address;
    setCanSend(check);
  }

  function handleSetMaxAmount() {
    inputAmountRef.current && (inputAmountRef.current.value = balance.ar);
    handleCheckForm();
  }

  const handleSendClick = () => {
    const recipientAddress = inputReceivingAddressRef.current?.value?.trim();
    const amountAr = Number(inputAmountRef?.current?.value);
    if (!recipientAddress || !amountAr) return;
    dispatch(doArSend(recipientAddress, amountAr));
  };

  return (
    <Card
      className={`${AR_ACCOUNT_CARD_CLASS} ${AR_ACCOUNT_OVERVIEW_CLASSES.root}${
        activeArStatus !== 'connected' ? ` ${CARD_CLASSES.disabled}` : ''
      }`}
      title={cardHeader()}
      titleClassName={AR_ACCOUNT_CARD_TITLE_CLASS}
      background
      actions={
        <>
          <div className={AR_ACCOUNT_OVERVIEW_CLASSES.optionsWrapper}>
            <div className={AR_ACCOUNT_OVERVIEW_CLASSES.optionsCard}>
              <div className={AR_ACCOUNT_OVERVIEW_CLASSES.options}>
                <h2 className={AR_ACCOUNT_PAGE_CLASSES.sectionTitle}>{__('Receive')}</h2>
                <div className={AR_ACCOUNT_OVERVIEW_CLASSES.content}>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.contentOption}>
                    {/* <div className="sendArLabel">{__('Address')}</div> */}
                    <CopyableText copyable={wallet?.address} />
                  </div>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.monetization}>
                    {__('Show QR code')}{' '}
                    <ButtonToggle
                      status={showQR}
                      setStatus={() => setShowQR(!showQR)}
                      className="tw:ml-auto tw:min-w-[40px]"
                      tone="address"
                    />
                  </div>
                </div>
              </div>
              <div className={AR_ACCOUNT_OVERVIEW_CLASSES.options}>
                <h2 className={AR_ACCOUNT_PAGE_CLASSES.sectionTitle}>
                  <I18nMessage
                    tokens={{
                      learnMore: (
                        <div className={AR_ACCOUNT_PAGE_CLASSES.learnMore}>
                          <Icon className={AR_ACCOUNT_PAGE_CLASSES.learnMoreIcon} icon={ICONS.INFO} />
                          <a
                            className={AR_ACCOUNT_PAGE_CLASSES.learnMoreLink}
                            href="https://help.odysee.tv/category-monetization"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {__('Learn more')}
                          </a>
                        </div>
                      ),
                    }}
                  >
                    Monetization %learnMore%
                  </I18nMessage>
                </h2>
                <div className={AR_ACCOUNT_OVERVIEW_CLASSES.content}>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.contentOption}>
                    <div className={AR_ACCOUNT_OVERVIEW_CLASSES.monetization}>
                      <div className={AR_ACCOUNT_OVERVIEW_CLASSES.labels}>
                        <h3>{__('Allow monetization')}</h3>
                        <span className={AR_ACCOUNT_OVERVIEW_CLASSES.labelsDescription}>
                          Turning this on enables your channel(s) to receive tips and setup memberships.
                        </span>
                      </div>
                      <ButtonToggleAddressActive address={wallet?.address} className="tw:ml-auto tw:min-w-[40px]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {showQR && (
              <div className={AR_ACCOUNT_OVERVIEW_CLASSES.options}>
                <h2 className={AR_ACCOUNT_PAGE_CLASSES.sectionTitle}>{__('QR Code')}</h2>
                <div className={AR_ACCOUNT_OVERVIEW_CLASSES.content}>
                  <div className={`${AR_ACCOUNT_OVERVIEW_CLASSES.contentOption} tw:items-center`}>
                    {wallet && wallet.address && <QRCode value={wallet.address} />}
                  </div>
                </div>
              </div>
            )}

            <div className={AR_ACCOUNT_OVERVIEW_CLASSES.options}>
              <h2 className={AR_ACCOUNT_PAGE_CLASSES.sectionTitle}>{__('Send')}</h2>
              <div className={AR_ACCOUNT_OVERVIEW_CLASSES.content}>
                <div className={AR_ACCOUNT_OVERVIEW_CLASSES.contentOption}>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.sendRow}>
                    <div className={`sendAr-row__amount ${AR_ACCOUNT_OVERVIEW_CLASSES.sendField}`}>
                      <div className={AR_ACCOUNT_OVERVIEW_CLASSES.sendLabel}>{__('Amount')}</div>
                      <input
                        className={AR_ACCOUNT_OVERVIEW_CLASSES.sendInput}
                        ref={inputAmountRef}
                        type="number"
                        step="0.00000001"
                        placeholder={Number(0).toFixed(8)}
                        onChange={handleCheckForm}
                      />
                    </div>
                    <div className={AR_ACCOUNT_OVERVIEW_CLASSES.sendTotal} onClick={handleSetMaxAmount}>
                      <span className={AR_ACCOUNT_OVERVIEW_CLASSES.sendTotalValue}>
                        {__('Totally available: ')} {balance.ar.toFixed(8)}
                      </span>
                    </div>

                    <div className={`sendAr-row__receiver ${AR_ACCOUNT_OVERVIEW_CLASSES.sendField}`}>
                      <div className={AR_ACCOUNT_OVERVIEW_CLASSES.sendLabel}>{__('Receiving address')}</div>
                      <input
                        className={AR_ACCOUNT_OVERVIEW_CLASSES.sendInput}
                        ref={inputReceivingAddressRef}
                        type="text"
                        placeholder={`00000000000000000000000000000000000000000`}
                        onChange={handleCheckForm}
                      />
                    </div>
                    <div className={AR_ACCOUNT_OVERVIEW_CLASSES.sendAction}>
                      <Button
                        button="primary"
                        title={__('Send')}
                        label={__('Send')}
                        disabled={!canSend || arWalletStatus?.sending}
                        onClick={handleSendClick}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {walletType !== 'NATIVE_WALLET' && (
            <div>
              <h2 className={AR_ACCOUNT_PAGE_CLASSES.sectionTitle}>
                <I18nMessage
                  tokens={{
                    learnMore: (
                      <div className={AR_ACCOUNT_PAGE_CLASSES.learnMore}>
                        <Icon className={AR_ACCOUNT_PAGE_CLASSES.learnMoreIcon} icon={ICONS.INFO} />
                        <a
                          className={AR_ACCOUNT_PAGE_CLASSES.learnMoreLink}
                          href="https://help.odysee.tv/category-monetization/wander"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {__('Learn more')}
                        </a>
                      </div>
                    ),
                  }}
                >
                  Connected wallet %learnMore%
                </I18nMessage>
              </h2>
              <div className={AR_ACCOUNT_OVERVIEW_CLASSES.content}>
                <div className={AR_ACCOUNT_OVERVIEW_CLASSES.contentOption}>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.wallet}>
                    <div className={AR_ACCOUNT_OVERVIEW_CLASSES.walletInfo}>
                      {/* <h3>{__('Warning')}</h3> */}
                      <span className={AR_ACCOUNT_OVERVIEW_CLASSES.walletInfoDescription}>
                        We highly recommend backing up your wallet and its recovery file, and storing both somewhere
                        safe. In the Wallet, go to Account › Backup to generate a QR code you can scan to sign in on
                        other devices. We never see your wallet or recovery file, so if you lose them we can’t restore
                        your account.
                      </span>
                    </div>
                    <div className={AR_ACCOUNT_OVERVIEW_CLASSES.walletButton}>
                      <Button
                        button="primary"
                        label={__('Open wallet')}
                        icon={ICONS.WANDER}
                        onClick={() => window.wanderInstance.open()}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <h2 className={AR_ACCOUNT_PAGE_CLASSES.sectionTitle}>
            {__('Transaction history')}
            <NavLink to={`wallet?tab=fiat-payment-history&currency=fiat&transactionType=tips`}>Tip history</NavLink>
          </h2>
          <div className={AR_ACCOUNT_OVERVIEW_CLASSES.history}>
            {!transactions ? (
              <Spinner type="small" />
            ) : (
              transactions.map((transaction, index) => (
                <div key={index} className={AR_ACCOUNT_OVERVIEW_CLASSES.historyRow}>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.historyDate}>
                    {new Date(transaction.date * 1000)
                      .toLocaleString('en-US', {
                        month: '2-digit',
                        day: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })
                      .replace(',', '')}
                  </div>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.historyAction}>
                    {transaction.action === 'sendTip' ? __('Send') : __('Receive')}
                  </div>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.historyAmount}>{transaction.amount.toFixed(6)}</div>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.historyToken}>
                    <Symbol className={AR_ACCOUNT_OVERVIEW_CLASSES.historySymbol} token="ar" />
                  </div>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.historyDirection}>
                    {transaction.action === 'sendTip' ? __('to') : __('from')}
                  </div>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.historyTarget}>{transaction.target}</div>
                  <div className={AR_ACCOUNT_OVERVIEW_CLASSES.historyViewblock}>
                    <a href={`https://viewblock.io/arweave/tx/${transaction.txId}`} target="_blank" rel="noreferrer">
                      <img src="https://thumbs.odycdn.com/ea5d40b35d7355f25d0199ed4832f77b.webp" />
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      }
    />
  );
}

export default Overview;
