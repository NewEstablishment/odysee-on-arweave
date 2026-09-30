import { ERROR_TEXT_CLASS } from 'component/common/error-classes';
import * as MODALS from 'constants/modal_types';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Button from 'component/button';
import { BUTTON_TOGGLE_ACTIVE_CLASS, BUTTON_TOGGLE_CLASS } from 'component/button/classes';
import { Form, FormField } from 'component/common/form';
import { FIELDSET_GROUP_SMUSHED_CLASS } from 'component/common/form-components/fieldset-group-classes';
import {
  FORM_FIELD_ADDRESS_CLASS,
  FORM_FIELD_PRICE_AMOUNT_CLASS,
} from 'component/common/form-components/form-field-classes';
import validateSendTx from 'util/form-validation';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import WalletSpendableBalanceHelp from 'component/walletSpendableBalanceHelp';
import classnames from 'classnames';
import ChannelSelector from 'component/channelSelector';
import ClaimPreview from 'component/claimPreview';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectBalance } from 'redux/selectors/wallet';
import { makeSelectClaimForUri } from 'redux/selectors/claims';
import { doOpenModal } from 'redux/actions/app';
import { selectToast } from 'redux/selectors/notifications';

type Props = {
  draftTransaction: {
    address: string;
    amount: string;
  };
  setDraftTransaction: (arg0: { address: string; amount: string }) => void;
  isAddress: boolean;
  setIsAddress: (arg0: boolean) => void;
  contentUri: string;
  contentError: string;
  setEnteredContentUri: (arg0: string) => void;
  confirmed: boolean;
  setConfirmed: (arg0: boolean) => void;
  sendLabel: string;
  setSendLabel: (arg0: string) => void;
};

const WalletSend = React.memo(function WalletSend({
  draftTransaction,
  setDraftTransaction,
  isAddress,
  setIsAddress,
  contentUri,
  contentError,
  setEnteredContentUri,
  confirmed,
  setConfirmed,
  sendLabel,
  setSendLabel,
}: Props) {
  const dispatch = useAppDispatch();

  const balance = useAppSelector((state) => selectBalance(state));
  const contentClaim = useAppSelector((state) => makeSelectClaimForUri(contentUri)(state));
  const snack = useAppSelector((state) => selectToast(state));

  const [touched, setTouched] = useState({ address: false, amount: false });

  const prevConfirmedRef = useRef(confirmed);
  const prevSnackRef = useRef(snack);

  const handleClear = useCallback(() => {
    setDraftTransaction({ address: '', amount: '' });
    setConfirmed(false);
  }, [setDraftTransaction, setConfirmed]);

  useEffect(() => {
    if (!prevConfirmedRef.current && confirmed) {
      handleClear();
      setSendLabel('Sending...');
    }
    prevConfirmedRef.current = confirmed;
  }, [confirmed, handleClear, setSendLabel]);

  useEffect(() => {
    if (!prevSnackRef.current && snack) {
      setSendLabel('Send');
    }
    prevSnackRef.current = snack;
  }, [snack, setSendLabel]);

  const openModal = (modal: string, props: any) => dispatch(doOpenModal(modal, props));

  const handleSubmit = () => {
    const destination = isAddress ? draftTransaction.address : contentUri;
    const amount = draftTransaction.amount;
    const modalProps = { destination, amount, isAddress, setConfirmed };
    openModal(MODALS.CONFIRM_TRANSACTION, modalProps);
  };

  const handleBlur = (field: 'address' | 'amount') => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const validationErrors = isAddress ? validateSendTx(draftTransaction.address) : { address: '' };
  const amountValue = parseFloat(draftTransaction.amount);
  const amountError =
    amountValue === balance
      ? __('Decrease amount to account for transaction fee')
      : amountValue > balance
        ? __('Not enough Credits')
        : '';
  const formError =
    (Boolean(draftTransaction.address) && touched.address && validationErrors.address) ||
    (Boolean(draftTransaction.amount) && touched.amount && amountError) ||
    '';

  return (
    <Card
      title={__('Send Credits')}
      subtitle={__('Send Credits to your friends or favorite creators.')}
      actions={
        <div>
          <div className="section">
            <Button
              key="Address"
              label={__('Address')}
              button="alt"
              onClick={() => setIsAddress(true)}
              className={classnames(BUTTON_TOGGLE_CLASS, {
                [BUTTON_TOGGLE_ACTIVE_CLASS]: isAddress,
              })}
            />
            <Button
              key="Search"
              label={__('Search')}
              button="alt"
              onClick={() => setIsAddress(false)}
              className={classnames(BUTTON_TOGGLE_CLASS, {
                [BUTTON_TOGGLE_ACTIVE_CLASS]: !isAddress,
              })}
            />
          </div>

          <div className="section">
            {!isAddress && <ChannelSelector />}

            <Form onSubmit={handleSubmit}>
              {!isAddress && (
                <FormField
                  type="text"
                  name="search"
                  error={contentError}
                  placeholder={__('Enter a name, @username or URL')}
                  className={FORM_FIELD_ADDRESS_CLASS}
                  label={__('Recipient search')}
                  onChange={(event) => setEnteredContentUri(event.target.value)}
                  value={contentUri}
                />
              )}

              {!isAddress && (
                <fieldset-section>
                  <ClaimPreview
                    key={contentUri}
                    uri={contentUri}
                    actions={''}
                    type={'small'}
                    showNullPlaceholder
                    hideMenu
                    hideRepostLabel
                    nonClickable
                  />
                </fieldset-section>
              )}

              <fieldset-group class={FIELDSET_GROUP_SMUSHED_CLASS}>
                <FormField
                  autoFocus
                  type="number"
                  name="amount"
                  label={__('Amount')}
                  className={FORM_FIELD_PRICE_AMOUNT_CLASS}
                  affixClass="form-field--fix-no-height"
                  min={0}
                  step="any"
                  placeholder="12.34"
                  onChange={(event) =>
                    setDraftTransaction({
                      address: draftTransaction.address,
                      amount: event.target.value,
                    })
                  }
                  onBlur={() => handleBlur('amount')}
                  value={draftTransaction.amount}
                />
                {isAddress && (
                  <FormField
                    type="text"
                    name="address"
                    placeholder={'bbFxRyXXXXXXXXXXXZD8nE7XTLUxYnddTs'}
                    className={FORM_FIELD_ADDRESS_CLASS}
                    label={__('Recipient address')}
                    onChange={(event) =>
                      setDraftTransaction({
                        address: event.target.value,
                        amount: draftTransaction.amount,
                      })
                    }
                    onBlur={() => handleBlur('address')}
                    value={draftTransaction.address}
                  />
                )}
              </fieldset-group>

              <div className={CARD_CLASSES.actions}>
                <Button
                  button="primary"
                  type="submit"
                  label={__(sendLabel)}
                  disabled={
                    !(amountValue > 0.0) ||
                    amountValue >= balance ||
                    sendLabel === 'Sending...' ||
                    (isAddress ? !draftTransaction.address || validationErrors.address !== '' : !contentClaim)
                  }
                />
                {formError && <span className={ERROR_TEXT_CLASS}>{formError}</span>}
              </div>
              <WalletSpendableBalanceHelp />
            </Form>
          </div>
        </div>
      }
    />
  );
});

export default WalletSend;
