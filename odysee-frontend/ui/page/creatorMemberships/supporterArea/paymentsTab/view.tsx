import React from 'react';
import PaymentRow from './internal/paymentRow';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doMembershipFetchOutgoingPayments } from 'redux/actions/memberships';
import {
  selectMembershipTxOutgoing,
  selectMembershipTxOutgoingFetching,
  selectMembershipTxOutgoingError,
} from 'redux/selectors/memberships';
import { SUPPORTER_MEMBERSHIP_PAYMENTS_TABLE_CLASS } from '../../tableClasses';
import { WALLET_FIAT_TRANSACTIONS_CLASS } from 'page/wallet/classes';
import { TABLE_CLASS } from 'component/common/table-classes';
interface IProps {
  channelsToList?: Array<Claim>;
}

function PaymentsTab(props: IProps) {
  const { channelsToList } = props;
  const dispatch = useAppDispatch();
  const transactions = useAppSelector(selectMembershipTxOutgoing);
  React.useEffect(() => {
    dispatch(doMembershipFetchOutgoingPayments());
  }, [dispatch]);
  const channelIdsToList = channelsToList && channelsToList.map((c) => c.claim_id);
  const transactionsToList = (
    channelIdsToList && channelIdsToList.length
      ? transactions.filter((t) => channelIdsToList.includes(t.subscriber_channel_claim_id))
      : transactions
  ).sort((a, b) => new Date(b.initiated_at).getTime() - new Date(a.initiated_at).getTime());
  return (
    <>
      <div className={SUPPORTER_MEMBERSHIP_PAYMENTS_TABLE_CLASS} data-membership-payments-table>
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              <th className="date-header">{__('Date')}</th> {/* completed_at */}
              <th className="channelName-header">{<>{__('Receiving Channel')}</>}</th> {/* */}
              <th className="channelName-header">{<>{__('Sending Channel')}</>}</th> {/* */}
              <th>{__('Membership')} </th> {/* */}
              <th className="payment-txid">{__('Transaction')} </th>
              <th className="amount-header">{__('Amount')} </th> {/* */}
              <th className="amount-header">{__('Status')} </th> {/* */}
            </tr>
          </thead>
          <tbody>
            {transactionsToList &&
              transactionsToList.map((transaction) => {
                return <PaymentRow key={transaction.transaction_id} transaction={transaction} />;
              })}
          </tbody>
        </table>
        {transactions.length === 0 && <p className={WALLET_FIAT_TRANSACTIONS_CLASS}>{__('No Membership Payments')}</p>}
      </div>
    </>
  );
}

export default PaymentsTab;
