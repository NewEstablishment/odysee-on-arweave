import * as ICONS from 'constants/icons';
import * as PAGES from 'constants/pages';
import React from 'react';
import Button from 'component/button';
import Card from 'component/common/card';
import { SECTION_CLASSES } from 'component/common/section-classes';
type Props = {
  totalTippedAmount: number;
  transactions: StripeTransactions;
};

const WalletBalance = (props: Props) => {
  const {
    // accountDetails,
    transactions,
  } = props;
  // let cardDetails = {
  //   brand: card.brand,
  //   expiryYear: card.exp_year,
  //   expiryMonth: card.exp_month,
  //   lastFour: card.last4,
  //   topOfDisplay: topOfDisplay,
  //   bottomOfDisplay: bottomOfDisplay,
  // };
  // const [detailsExpanded, setDetailsExpanded] = React.useState(false);
  const [totalCreatorsSupported, setTotalCreatorsSupported] = React.useState(false);
  // calculate how many unique users tipped
  React.useEffect(() => {
    if (transactions) {
      let channelNames = [];

      for (const transaction of transactions) {
        channelNames.push(transaction.channel_name);
      }

      let unique = [...new Set(channelNames)];
      setTotalCreatorsSupported(unique.length as any);
    }
  }, [transactions]);
  return (
    <Card
      actions={
        <>
          <h2 className={SECTION_CLASSES.titleSmall}>
            {(transactions && transactions.length) || 0}
            {__('Total Tips')}
          </h2>

          <h2 className={SECTION_CLASSES.titleSmall}>
            {totalCreatorsSupported || 0}
            {__('Creators Supported')}
          </h2>

          <div className={SECTION_CLASSES.actions}>
            <Button
              button="secondary"
              label={__('Manage Cards')}
              icon={ICONS.SETTINGS}
              navigate={`/$/${PAGES.ARACCOUNT}`}
            />
          </div>
        </>
      }
    />
  );
};

export default WalletBalance;
