import * as ICONS from 'constants/icons';
import { SITE_NAME } from 'config';
import React from 'react';
import ButtonTransaction from 'component/common/transaction-link';
import CreditAmount from 'component/common/credit-amount';
import DateTime from 'component/dateTime';
import Button from 'component/button';
import Spinner from 'component/spinner';
import { toCapitalCase } from 'util/string';
import { buildURI, parseURI } from 'util/lbryURI';
import { WALLET_TRANSACTION_TABLE_CLASSES } from 'page/wallet/classes';
import * as TXO from 'constants/txo_list';
import * as ABANDON_STATES from 'constants/abandon_states';
import UriIndicator from 'component/uriIndicator';
import { useAppSelector } from 'redux/hooks';
import { selectClaimForClaimId } from 'redux/selectors/claims';
import { TABLE_ITEM_LABEL_CLASS } from 'component/common/table-classes';
import { EMPTY_CLASS } from 'component/common/empty-classes';
type Props = {
  txo: Txo;
  revokeClaim: (arg0: Txo, arg1: (arg0: string) => void) => void;
  isRevokeable: boolean;
  reward:
    | {
        reward_title: string;
      }
    | null
    | undefined;
};

function TransactionListTableItem(props: Props) {
  const { reward, txo, isRevokeable, revokeClaim } = props;
  const [abandonState, setAbandonState] = React.useState(ABANDON_STATES.READY);
  const signingChannelClaimId = txo && txo.signing_channel && txo.signing_channel.channel_id;
  const signingChannel = useAppSelector((state) => selectClaimForClaimId(state, signingChannelClaimId));

  function abandonClaim() {
    revokeClaim(txo, (newAbandonState) => setAbandonState(newAbandonState));
  }

  function getLink(type: string, tip: boolean, valueType: string) {
    if (type === 'claim' && valueType !== 'repost') {
      return null;
    }

    if (abandonState === ABANDON_STATES.PENDING) {
      return <Spinner type={'small'} />;
    }

    if (tip && type === TXO.SUPPORT) {
      return (
        <Button
          disabled={abandonState === ABANDON_STATES.DONE}
          button="secondary"
          icon={ICONS.UNLOCK}
          onClick={abandonClaim}
          title={__('Unlock tip')}
        />
      );
    }

    const abandonTitle = type === TXO.SUPPORT ? 'Abandon Support' : 'Abandon Claim';
    return (
      <Button
        disabled={abandonState === ABANDON_STATES.DONE}
        button="secondary"
        icon={ICONS.DELETE}
        onClick={abandonClaim}
        title={__(abandonTitle)}
      />
    );
  }

  const {
    amount,
    claim_id: claimId,
    normalized_name: txoListName,
    timestamp,
    txid,
    type,
    value_type: valueType,
    is_my_input: isMyInput,
    is_my_output: isMyOutput,
  } = txo;
  const isLbryViewReward =
    txo.signing_channel &&
    (txo.signing_channel.channel_id === '74562a01e5836c04040b80bf1f4d685fec02cc90' ||
      txo.signing_channel.channel_id === '7d0b0f83a195fd1278e1944ddda4cda8d9c01a56');
  const name = txoListName;
  const isMinus = (type === 'support' || type === 'payment' || type === 'other') && isMyInput && !isMyOutput;
  const isTip = type === 'support' && ((isMyInput && !isMyOutput) || (!isMyInput && isMyOutput));
  const date = new Date(timestamp * 1000);
  // Ensure the claim name exists and is valid
  let uri;
  let claimName;

  try {
    if (name.startsWith('@')) {
      ({ claimName } = parseURI(name));
      uri = buildURI(
        {
          channelName: claimName,
          channelClaimId: claimId,
        },
        true
      );
    } else {
      ({ claimName } = parseURI(name));
      uri = buildURI(
        {
          streamName: claimName,
          streamClaimId: claimId,
        },
        true
      );
    }
  } catch (e) {}

  const dateFormat = {
    month: 'short' as const,
    day: 'numeric' as const,
    year: 'numeric' as const,
  };
  const forClaim = name && claimId;
  return (
    <tr>
      <td className={WALLET_TRANSACTION_TABLE_CLASSES.dateCell}>
        {timestamp ? (
          <div>
            <DateTime date={date} type="date" formatOptions={dateFormat} />
            <div className={TABLE_ITEM_LABEL_CLASS}>
              <DateTime date={date} type="time" />
            </div>
          </div>
        ) : (
          <span className={EMPTY_CLASS}>{__('Pending')}</span>
        )}
      </td>
      <td className={WALLET_TRANSACTION_TABLE_CLASSES.actionable}>
        <span>
          {(isTip && __('Tip')) ||
            (type === 'support' && !isTip && __('Support --[noun; transaction type]--')) ||
            (valueType && ((valueType === 'stream' && __('Upload')) || __(toCapitalCase(valueType)))) ||
            (type && __(toCapitalCase(type)))}
        </span>{' '}
        {isRevokeable && getLink(type, isTip, valueType)}
      </td>
      <td>
        {forClaim && <Button button="link" navigate={uri} label={claimName} disabled={!date} />}
        {!forClaim && reward && <span>{reward.reward_title}</span>}
        {isLbryViewReward && (
          <div className={TABLE_ITEM_LABEL_CLASS}>
            {__('%SITE_NAME% view Credit', {
              SITE_NAME,
            })}
          </div>
        )}
        {isTip && signingChannel && !isLbryViewReward && (
          <div className={TABLE_ITEM_LABEL_CLASS}>
            <UriIndicator uri={signingChannel && signingChannel.permanent_url} link showAtSign />
          </div>
        )}
        {isTip && !signingChannel && !isLbryViewReward && <div className={TABLE_ITEM_LABEL_CLASS}>Anonymous</div>}
      </td>

      <td>
        <ButtonTransaction id={txid} />
      </td>
      <td className={WALLET_TRANSACTION_TABLE_CLASSES.alignRight}>
        <CreditAmount
          showPlus={isMinus}
          amount={isMinus ? Number(0 - Number(amount)) : Number(amount)}
          precision={8}
          showLBC={false}
        />
      </td>
    </tr>
  );
}

export default TransactionListTableItem;
