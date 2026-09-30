import CreditAmount from 'component/common/credit-amount';
import Symbol from '../common/symbol';
import I18nMessage from 'component/i18nMessage';
import React from 'react';
import { useAppSelector } from 'redux/hooks';
import { selectBalance } from 'redux/selectors/wallet';
import { selectArweaveBalance, selectArweaveConnecting, selectArweaveExchangeRates } from 'redux/selectors/arwallet';
import { HELP_CLASS } from 'component/common/help-classes';

const SPENDABLE_HELP_CLASS = 'tw:mt-app-xxs tw:block tw:text-app-small';

type Props = {
  asset?: string;
  inline?: boolean;
};

function WalletSpendableBalanceHelp(props: Props) {
  const { asset = 'lbc', inline } = props;
  const LBCBalance = useAppSelector(selectBalance);
  const USDCBalance = useAppSelector(selectArweaveBalance).usdc;
  const ARBalance = useAppSelector(selectArweaveBalance).ar;
  const dollarsPerAr = useAppSelector(selectArweaveExchangeRates).ar;
  const arConnecting = useAppSelector(selectArweaveConnecting);
  const dollars = ARBalance * dollarsPerAr;
  const dollarsRounded = Number(dollars.toFixed(2));

  const getMessage = (text: string) =>
    asset === 'lbc' ? (
      <I18nMessage
        tokens={{
          LBCBalance: <CreditAmount amount={LBCBalance} precision={4} showLBC={!inline} />,
        }}
      >
        {text}
      </I18nMessage>
    ) : asset === 'usdc' ? (
      <I18nMessage
        tokens={{
          USDCBalance: <Symbol amount={USDCBalance} token="usdc" precision={2} />,
        }}
      >
        {text}
      </I18nMessage>
    ) : (
      /* asset === 'ar' */
      <I18nMessage
        tokens={{
          ConvertedBalance: dollarsRounded,
          ARBalance: <Symbol amount={ARBalance} token="ar" precision={2} />,
        }}
      >
        {text}
      </I18nMessage>
    );

  if (asset === 'lbc') {
    return !LBCBalance ? null : inline ? (
      <span className={SPENDABLE_HELP_CLASS}>{getMessage('%LBCBalance% available')}</span>
    ) : (
      <div className={HELP_CLASS}>{getMessage('Your immediately spendable balance is %LBCBalance%.')}</div>
    );
  } else if (asset === 'usdc') {
    return arConnecting ? (
      <span className={HELP_CLASS}>{__('Connecting...')}</span>
    ) : USDCBalance ? (
      <span className={SPENDABLE_HELP_CLASS}>{getMessage('%USDCBalance% available.')}</span>
    ) : (
      <div className={HELP_CLASS}>{getMessage('Your immediately spendable balance is %USDCBalance%.')}</div>
    );
  } else if (asset === 'ar') {
    return arConnecting ? (
      <span className={HELP_CLASS}>{__('Connecting...')}</span>
    ) : ARBalance ? (
      <span className={SPENDABLE_HELP_CLASS}>{getMessage('$%ConvertedBalance% (%ARBalance%) available.')}</span>
    ) : (
      <div className={HELP_CLASS}>{getMessage('Your immediately spendable balance is %ARBalance%.')}</div>
    );
  }
}

export default WalletSpendableBalanceHelp;
