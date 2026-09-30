import React from 'react';
import * as SETTINGS from 'constants/settings';
import Button from 'component/button';
import { FormField } from 'component/common/form-components/form-field';
import { Modal } from 'modal/modal';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectClientSettings } from 'redux/selectors/settings';
import { doHideModal } from 'redux/actions/app';
import { doSetClientSetting } from 'redux/actions/settings';

export default function ModalCryptoDisclaimers() {
  const dispatch = useAppDispatch();
  const clientSettings = useAppSelector(selectClientSettings);
  const showDisclaimersLS = clientSettings[SETTINGS.CRYPTO_DISCLAIMERS];
  const [showDisclaimers, setShowDisclaimers] = React.useState(showDisclaimersLS);

  const handleShowDisclaimers = () => {
    dispatch(doSetClientSetting(SETTINGS.CRYPTO_DISCLAIMERS, !showDisclaimers, true));
    setShowDisclaimers(!showDisclaimers);
  };

  const handleSignIn = () => {
    window.wanderInstance.open();
    dispatch(doHideModal());
  };

  return (
    <Modal className="tw:max-h-[60%] tw:p-app-l" type="card" isOpen onAborted={() => dispatch(doHideModal())}>
      <h2 className="tw:mb-app-m tw:text-app-large tw:font-black">Disclaimers & Important Information</h2>
      <ul className="tw:mb-app-l tw:list-decimal">
        <li className="tw:mb-app-s">
          <b className="tw:font-black">Cryptocurrency Risk Notice</b>
          <p className="tw:text-app-small">
            Purchasing, holding, and transacting in cryptocurrencies involves significant risk. Prices are highly
            volatile and may fluctuate widely in a short period of time. You could lose some or all of your investment.
          </p>
        </li>
        <li className="tw:mb-app-s">
          <b className="tw:font-black">Third-Party Payment Processing</b>
          <p className="tw:text-app-small">
            All purchases made via card payment are processed by third-party providers. By proceeding, you acknowledge
            that you are subject to their terms of service and privacy policies. We do not control or assume
            responsibility for the actions of third-party processors.
          </p>
        </li>
        <li className="tw:mb-app-s">
          <b className="tw:font-black">No Investment Advice</b>
          <p className="tw:text-app-small">
            The information provided on this site does not constitute financial, investment, or trading advice. We do
            not make recommendations or endorsements regarding any cryptocurrency. Please consult a licensed financial
            advisor before making any investment decisions.
          </p>
        </li>
        <li className="tw:mb-app-s">
          <b className="tw:font-black">Transaction Finality</b>
          <p className="tw:text-app-small">
            All crypto transactions are irreversible. Please verify the amount and recipient details before confirming
            your purchase. We are not responsible for user errors or mistyped wallet addresses.
          </p>
        </li>
        <li className="tw:mb-app-s">
          <b className="tw:font-black">Availability & Jurisdiction</b>
          <p className="tw:text-app-small">
            Services may not be available in all regions and are subject to local laws and regulations. It is your
            responsibility to ensure that you are compliant with your local jurisdiction before buying or using
            cryptocurrency.
          </p>
        </li>
        <li className="tw:mb-app-s">
          <b className="tw:font-black">KYC/AML Requirements</b>
          <p className="tw:text-app-small">
            In some cases, identity verification may be required by the payment provider in accordance with Know Your
            Customer (KYC) and Anti-Money Laundering (AML) regulations.
          </p>
        </li>
        <li className="tw:mb-app-s">
          <b className="tw:font-black">Tax Responsibilities</b>
          <p className="tw:text-app-small">
            You are solely responsible for complying with your local tax regulations regarding crypto purchases and
            reporting. Please consult a tax professional for advice related to your jurisdiction.
          </p>
        </li>
        <li className="tw:mb-app-s">
          <b className="tw:font-black">System Availability</b>
          <p className="tw:text-app-small">
            Prices shown are estimates and may change at the time of execution. Platform access and pricing may be
            impacted by third-party service outages or blockchain congestion.
          </p>
        </li>
      </ul>

      <FormField
        type="checkbox"
        name="show_crypto_disclaimers"
        label={__("Don't show me this message again")}
        checked={!showDisclaimers}
        onChange={handleShowDisclaimers}
      />

      <Button className="tw:mt-app-m" button="primary" label={__('Sign in')} onClick={handleSignIn} />
    </Modal>
  );
}
