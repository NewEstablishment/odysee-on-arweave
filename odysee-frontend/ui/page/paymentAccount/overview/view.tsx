import React from 'react';
import CopyableText from 'component/copyableText';
import ButtonToggle from 'component/buttonToggle';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import Symbol from 'component/common/symbol';
import { PAYMENT_ACCOUNT_CARD_CLASS, PAYMENT_ACCOUNT_CARD_TITLE_CLASS, PAYMENT_ACCOUNT_PAGE_CLASSES } from '../classes';
type Props = {
  cardHeader: () => React.ReactElement<React.ComponentProps<any>, any>;
  arWalletStatus: any;
};

function Overview(props: Props) {
  const { cardHeader, arWalletStatus } = props;
  const [transactions, setTransactions] = React.useState([]);
  React.useEffect(() => {
    (async () => {
      if (window.arweaveWallet) {
        try {
          const address = await window.arweaveWallet.getActiveAddress();
          const sent = await fetch(`https://arweave-search.goldsky.com/graphql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: `{
              transactions(
                first: 10,
                owners: ["${address}"],
                tags: [
                  { name: "Data-Protocol", values: ["ao"] },
                  { name: "Action", values: ["Transfer"] }
                  { name: "Tip_Type" } 
                ]
              ) {
                edges {
                  node {
                    id
                    recipient
                    owner { address }
                    block { timestamp height }
                    tags { name, value }
                  }
                }
              }
            }`,
            }),
          });
          const sentData = await sent.json();

          if (sentData && sentData.data && sentData.data.transactions && sentData.data.transactions.edges) {
            const transactions = sentData.data.transactions.edges;
            const newTransactions = [];

            for (let entry of transactions) {
              const transaction = entry.node;
              const row = {
                date: transaction.block.timestamp,
                action: 'sendTip',
                amount: Number(transaction.tags.find((tag) => tag.name === 'Quantity')?.value) / 1000000,
                target: transaction.tags.find((tag) => tag.name === 'Claim_ID')?.value,
              };
              newTransactions.push(row);
            }

            setTransactions(newTransactions);
          }

          const received = await fetch(`https://arweave-search.goldsky.com/graphql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: `{
              transactions(
                first: 10,
                tags: [
                  { name: "Data-Protocol", values: ["ao"] },
                  { name: "Action", values: ["Transfer"] },
                  { name: "Recipient", values: ["${address}"] }
                  { name: "Tip_Type" } 
                ]
              ) {
                edges {
                  node {
                    id
                    recipient
                    owner { address }
                    block { timestamp height }
                    tags { name, value }
                  }
                }
              }
            }`,
            }),
          });
          const receivedData = await received.json();

          if (
            receivedData &&
            receivedData.data &&
            receivedData.data.transactions &&
            receivedData.data.transactions.edges
          ) {
            const transactions = receivedData.data.transactions.edges;
            console.log('received: ', transactions);
          }
        } catch (e) {
          console.error(e);
        }
      }
    })();
  }, []);
  const address = '';
  return (
    <Card
      className={`${PAYMENT_ACCOUNT_CARD_CLASS} payment-account-overview-surface${
        !arWalletStatus ? ` ${CARD_CLASSES.disabled}` : ''
      }`}
      title={cardHeader()}
      titleClassName={PAYMENT_ACCOUNT_CARD_TITLE_CLASS}
      background
      actions={
        <>
          <h2 className={PAYMENT_ACCOUNT_PAGE_CLASSES.sectionTitle}>{__('Connected wallet')}</h2>
          <div className="tw:mt-[calc(var(--spacing-s)*-1)] tw:flex tw:w-full tw:gap-app-m tw:rounded-app tw:bg-app-background tw:p-app-s">
            <div className="tw:flex tw:flex-1 tw:items-center">
              <CopyableText copyable={address} />
            </div>
            <div className="tw:flex tw:flex-1 tw:items-center">
              <div className="tw:ml-auto tw:mr-app-xxs tw:flex tw:gap-app-l">
                {__('Allow monetization')} <ButtonToggle status />
              </div>
            </div>
          </div>
          <h2 className={PAYMENT_ACCOUNT_PAGE_CLASSES.sectionTitle}>{__('Transaction history')}</h2>
          <div className="tw:mt-[calc(var(--spacing-s)*-1)] tw:rounded-app tw:bg-app-background tw:p-app-s">
            {transactions.map((transaction, index) => {
              return (
                <div className="tw:flex tw:gap-app-s" key={index}>
                  <div>
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
                  <div className="tw:min-w-[90px]">
                    {transaction.action === 'sendTip' ? __('Send Tip') : __('Receive Tip')}
                  </div>
                  <div>{transaction.amount.toFixed(2)}</div>
                  <div>
                    <Symbol token="usdc" />
                    USDC
                  </div>
                  <div className="tw:min-w-[50px]">{transaction.action === 'sendTip' ? __('to') : __('from')}</div>
                  <div>{transaction.target}</div>
                </div>
              );
            })}
          </div>
        </>
      }
    />
  );
}

export default Overview;
