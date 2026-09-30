import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import * as MODALS from 'constants/modal_types';
import React from 'react';
import Spinner from 'component/spinner';
import LbcSymbol from 'component/common/lbc-symbol';
import TxoListItem from '../transactionListTableItem';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectClaimedRewardsByTransactionId } from 'redux/selectors/rewards';
import { doOpenModal } from 'redux/actions/app';
import { selectIsFetchingTxos } from 'redux/selectors/wallet';
import { WALLET_TRANSACTION_TABLE_CLASSES } from 'page/wallet/classes';
import { TABLE_WRAPPER_CLASS } from 'component/common/table-classes';
import { EMPTY_CLASS } from 'component/common/empty-classes';
type Props = {
  emptyMessage?: string | null | undefined;
  txos: Array<Txo>;
};

function TransactionListTable(props: Props) {
  const { emptyMessage, txos } = props;
  const dispatch = useAppDispatch();
  const rewards = useAppSelector(selectClaimedRewardsByTransactionId);
  const loading = useAppSelector(selectIsFetchingTxos);
  const REVOCABLE_TYPES = ['channel', 'stream', 'repost', 'support', 'claim', 'collection'];

  function revokeClaim(tx: any, cb: (arg0: string) => void) {
    dispatch(
      doOpenModal(MODALS.CONFIRM_CLAIM_REVOKE, {
        tx,
        cb,
      })
    );
  }

  return (
    <React.Fragment>
      {!loading && !txos.length && (
        <h2 className={`${PAGE_MAIN_EMPTY_CLASS} ${EMPTY_CLASS}`}>{emptyMessage || __('No transactions.')}</h2>
      )}
      {loading && (
        <h2 className={`${PAGE_MAIN_EMPTY_CLASS} ${EMPTY_CLASS}`}>
          <Spinner delayed />
        </h2>
      )}
      {!loading && !!txos.length && (
        <div className={TABLE_WRAPPER_CLASS}>
          <table className={WALLET_TRANSACTION_TABLE_CLASSES.root}>
            <thead>
              <tr>
                <th className={WALLET_TRANSACTION_TABLE_CLASSES.date}>{__('Date')}</th>
                <th className={WALLET_TRANSACTION_TABLE_CLASSES.type}>{<>{__('Type')}</>}</th>
                <th>{__('Details')} </th>
                <th className={WALLET_TRANSACTION_TABLE_CLASSES.transaction}>{__('Transaction')}</th>
                <th className={WALLET_TRANSACTION_TABLE_CLASSES.alignRight}>
                  <LbcSymbol size={18} />
                </th>
              </tr>
            </thead>
            <tbody>
              {txos &&
                txos.map((t, i) => (
                  <TxoListItem
                    key={`${t.txid}:${t.nout}-${i}`}
                    txo={t}
                    reward={rewards && rewards[t.txid]}
                    isRevokeable={t.is_my_output && !t.is_spent && REVOCABLE_TYPES.includes(t.type)}
                    revokeClaim={revokeClaim}
                  />
                ))}
            </tbody>
          </table>
        </div>
      )}
    </React.Fragment>
  );
}

export default TransactionListTable;
