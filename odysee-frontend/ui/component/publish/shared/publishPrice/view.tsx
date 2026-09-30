import { ERROR_TEXT_CLASS } from 'component/common/error-classes';
import React from 'react';
import { PUBLISH_DETAILS_TITLE_CLASS } from 'component/publish/shared/publish-details-classes';
import classnames from 'classnames';
import FeeBreakdown from './internal/feeBreakdown';
import Button from 'component/button';
import { FormField, FormFieldPrice } from 'component/common/form';
import FormFieldDurationCombo from 'component/formFieldDurationCombo';
import I18nMessage from 'component/i18nMessage';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import { PAYWALL } from 'constants/publish';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectPublishFormValue } from 'redux/selectors/publish';
import { doUpdatePublishForm } from 'redux/actions/publish';
import {
  doCustomerPurchaseCost as doCustomerPurchaseCostAction,
  doTipAccountStatus as doTipAccountStatusAction,
} from 'redux/actions/payments';
import { selectAccountChargesEnabled, selectArweaveDefaultAccountMonetizationEnabled } from 'redux/selectors/payments';
const FEE = {
  MIN: 0,
  MAX: 999.99,
};
const CURRENCY_OPTIONS = ['USD']; // ['USD', 'EUR']; // disable EUR until currency approach is determined.
const PRICE_ROW_CLASS_NAME = 'tw:mb-app-m tw:flex tw:flex-col tw:last:mb-0';
const PRICE_OPTION_BASE_CLASS_NAME =
  'tw:flex tw:flex-col tw:gap-app-xs tw:rounded-app tw:border tw:bg-app-card tw:p-app-s tw:text-left tw:[transition:border-color_0.15s_ease]';
const PRICE_OPTION_HEADER_CLASS_NAME =
  'tw:flex tw:items-center tw:gap-app-xs tw:text-app-small tw:font-bold tw:text-app-text tw:[&_label::before]:!bg-[rgba(var(--color-text-base),0.06)]';
const PRICE_OPTION_CONTENT_CLASS_NAME =
  'tw:mt-app-xs tw:[border-top:1px_solid_var(--color-border)] tw:pt-app-xs tw:[&_input]:![background:rgba(var(--color-text-base),0.06)] tw:[&_select]:![background:rgba(var(--color-text-base),0.06)] tw:[&_label::before]:!bg-[rgba(var(--color-text-base),0.06)]';
const PRICE_FEES_CLASS_NAME = 'tw:text-app-xxsmall tw:text-app-text-subtitle tw:italic';

type Props = {
  disabled: boolean;
};

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value), min), max);
}

function getTncRow() {
  return (
    <div className={PRICE_ROW_CLASS_NAME}>
      <div className="tw:mb-app-s tw:text-app-xsmall tw:text-app-text-subtitle tw:only:mb-0">
        <I18nMessage
          tokens={{
            paid_content_terms_and_conditions: (
              <Button
                button="link"
                href="https://help.odysee.tv/category-monetization/"
                label={__('paid-content terms and conditions')}
              />
            ),
          }}
        >
          By continuing, you accept the %paid_content_terms_and_conditions%.
        </I18nMessage>
      </div>
    </div>
  );
}

function PublishPrice(props: Props) {
  const { disabled } = props;
  const dispatch = useAppDispatch();
  const paywall = useAppSelector((state) => selectPublishFormValue(state, 'paywall')) || PAYWALL.FREE;
  const fiatPurchaseEnabled = useAppSelector((state) => selectPublishFormValue(state, 'fiatPurchaseEnabled'));
  const fiatPurchaseFee = useAppSelector((state) => selectPublishFormValue(state, 'fiatPurchaseFee'));
  const fiatRentalEnabled = useAppSelector((state) => selectPublishFormValue(state, 'fiatRentalEnabled'));
  const fiatRentalFee = useAppSelector((state) => selectPublishFormValue(state, 'fiatRentalFee'));
  const fiatRentalExpiration = useAppSelector((state) => selectPublishFormValue(state, 'fiatRentalExpiration'));
  const chargesEnabled = useAppSelector((state) => selectAccountChargesEnabled(state));
  const memberRestrictionOn = useAppSelector((state) => selectPublishFormValue(state, 'memberRestrictionOn'));
  const visibility = useAppSelector((state) => selectPublishFormValue(state, 'visibility'));
  const monetizationStatus = useAppSelector((state) => selectArweaveDefaultAccountMonetizationEnabled(state));
  const updatePublishForm = (value: UpdatePublishState) => dispatch(doUpdatePublishForm(value));
  const doCustomerPurchaseCost = (cost: number) => dispatch(doCustomerPurchaseCostAction(cost));
  const paymentDisallowed = visibility !== 'public';
  const bankAccountNotFetched = chargesEnabled === undefined;
  // If it's only restricted, the price can be added externally, and they won't be able to change it
  const restrictedWithoutPrice = paywall === PAYWALL.FREE && memberRestrictionOn;

  function sanitizeFee(name) {
    const feeLookup = {
      fiatPurchaseFee: fiatPurchaseFee,
      fiatRentalFee: fiatRentalFee,
    };
    const f = feeLookup[name];

    if (f && Number.isFinite(f.amount)) {
      updatePublishForm({
        [name]: { ...f, amount: clamp(f.amount.toFixed(2), FEE.MIN, FEE.MAX) },
      });
    }
  }

  function sanitizeDuration() {
    if (Number.isFinite(fiatRentalExpiration.value)) {
      updatePublishForm({
        fiatRentalExpiration: {
          ...fiatRentalExpiration,
          value: clamp(fiatRentalExpiration.value.toFixed(2), 1, 99999),
        },
      });
    }
  }

  function getRestrictionWarningRow() {
    return (
      <div className={PRICE_ROW_CLASS_NAME}>
        <div className={ERROR_TEXT_CLASS}>
          {__('You already have content restrictions enabled, disable them first in order to set a price.')}
        </div>
      </div>
    );
  }

  React.useEffect(() => {
    if (bankAccountNotFetched) {
      dispatch(doTipAccountStatusAction());
    }
  }, [bankAccountNotFetched, dispatch]);

  const isPaid = paywall === PAYWALL.FIAT || paywall === PAYWALL.SDK;

  if (paymentDisallowed) {
    return (
      <div>
        <h3 className={PUBLISH_DETAILS_TITLE_CLASS}>{__('Price')}</h3>
        <p className="tw:text-app-small tw:text-[var(--color-text-warning)]">
          {__('Payment options are not available for Unlisted or Scheduled content.')}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className={PUBLISH_DETAILS_TITLE_CLASS}>{__('Price')}</h3>

      {restrictedWithoutPrice && getRestrictionWarningRow()}

      <FormField
        type="checkbox"
        name="content_paid"
        label={__('Enable paid content (Purchase / Rent)')}
        checked={isPaid}
        disabled={disabled || !monetizationStatus || restrictedWithoutPrice}
        onChange={() => {
          if (isPaid) {
            updatePublishForm({ paywall: PAYWALL.FREE, fiatPurchaseEnabled: false, fiatRentalEnabled: false });
          } else {
            updatePublishForm({ paywall: PAYWALL.FIAT });
          }
        }}
      />

      <div className="tw:mt-app-s tw:grid tw:grid-cols-[repeat(3,1fr)] tw:gap-app-s tw:upto-tablet:grid-cols-[repeat(2,1fr)] tw:upto-tablet:gap-app-xs tw:upto-xxsmall:grid-cols-[1fr]">
        <button
          type="button"
          className={classnames(
            PRICE_OPTION_BASE_CLASS_NAME,
            !fiatPurchaseEnabled && !fiatRentalEnabled ? 'tw:border-app-primary' : 'tw:border-app-border',
            'tw:cursor-pointer tw:hover:border-app-primary'
          )}
          onClick={() => updatePublishForm({ paywall: PAYWALL.FREE })}
        >
          <div className={PRICE_OPTION_HEADER_CLASS_NAME}>
            <Icon icon={ICONS.UNLOCK} size={18} />
            <span>{__('Free')}</span>
          </div>
          <p className="tw:m-0 tw:text-app-xsmall tw:leading-[1.4] tw:text-app-text-subtitle">
            {__('Anyone can view this content.')}
          </p>
        </button>

        <div
          className={classnames(
            PRICE_OPTION_BASE_CLASS_NAME,
            isPaid && fiatPurchaseEnabled ? 'tw:border-app-primary' : 'tw:border-app-border',
            isPaid ? 'tw:cursor-pointer tw:hover:border-app-primary' : 'tw:cursor-default tw:opacity-40'
          )}
          onClick={() => {
            if (!isPaid) return;
            const next = !fiatPurchaseEnabled;
            const updates: any = { paywall: PAYWALL.FIAT, fiatPurchaseEnabled: next };
            if (!next && !fiatRentalEnabled) updates.paywall = PAYWALL.FREE;
            updatePublishForm(updates);
          }}
        >
          <div className={PRICE_OPTION_HEADER_CLASS_NAME}>
            <FormField
              type="checkbox"
              name="purchase_toggle"
              checked={fiatPurchaseEnabled}
              disabled={!isPaid}
              onChange={() => {
                updatePublishForm({ paywall: PAYWALL.FIAT, fiatPurchaseEnabled: !fiatPurchaseEnabled });
              }}
              label={__('Purchase')}
            />
          </div>
          <p className="tw:m-0 tw:text-app-xsmall tw:leading-[1.4] tw:text-app-text-subtitle">
            {__('One-time purchase with USD.')}
          </p>
          {paywall === PAYWALL.FIAT && fiatPurchaseEnabled && (
            <div className={PRICE_OPTION_CONTENT_CLASS_NAME} onClick={(e) => e.stopPropagation()}>
              <FormFieldPrice
                name="fiat_purchase_fee"
                min={0.01}
                price={fiatPurchaseFee}
                onChange={(fee) => updatePublishForm({ fiatPurchaseFee: fee })}
                onBlur={() => sanitizeFee('fiatPurchaseFee')}
                currencies={CURRENCY_OPTIONS}
              />
              <div className={PRICE_FEES_CLASS_NAME}>
                <FeeBreakdown
                  amount={fiatPurchaseFee.amount}
                  currency={fiatPurchaseFee.currency}
                  doCustomerPurchaseCost={doCustomerPurchaseCost}
                />
              </div>
            </div>
          )}
        </div>

        <div
          className={classnames(
            PRICE_OPTION_BASE_CLASS_NAME,
            isPaid && fiatRentalEnabled ? 'tw:border-app-primary' : 'tw:border-app-border',
            isPaid ? 'tw:cursor-pointer tw:hover:border-app-primary' : 'tw:cursor-default tw:opacity-40'
          )}
          onClick={() => {
            if (!isPaid) return;
            const next = !fiatRentalEnabled;
            const updates: any = { paywall: PAYWALL.FIAT, fiatRentalEnabled: next };
            if (!next && !fiatPurchaseEnabled) updates.paywall = PAYWALL.FREE;
            updatePublishForm(updates);
          }}
        >
          <div className={PRICE_OPTION_HEADER_CLASS_NAME}>
            <FormField
              type="checkbox"
              name="rental_toggle"
              checked={fiatRentalEnabled}
              disabled={!isPaid}
              onChange={() => {
                updatePublishForm({ paywall: PAYWALL.FIAT, fiatRentalEnabled: !fiatRentalEnabled });
              }}
              label={__('Rent')}
            />
          </div>
          <p className="tw:m-0 tw:text-app-xsmall tw:leading-[1.4] tw:text-app-text-subtitle">
            {__('Rent for a limited time with USD.')}
          </p>
          {paywall === PAYWALL.FIAT && fiatRentalEnabled && (
            <div className={PRICE_OPTION_CONTENT_CLASS_NAME} onClick={(e) => e.stopPropagation()}>
              <FormFieldPrice
                name="fiat_rental_fee"
                min={0.01}
                price={fiatRentalFee}
                onChange={(fee) => updatePublishForm({ fiatRentalFee: fee })}
                onBlur={() => sanitizeFee('fiatRentalFee')}
                currencies={CURRENCY_OPTIONS}
              />
              <FormFieldDurationCombo
                label={__('Duration')}
                name="fiat_rental_expiration"
                min={1}
                duration={fiatRentalExpiration}
                onChange={(duration) => updatePublishForm({ fiatRentalExpiration: duration })}
                onBlur={() => sanitizeDuration()}
                units={['months', 'weeks', 'days', 'hours']}
              />
              <div className={PRICE_FEES_CLASS_NAME}>
                <FeeBreakdown
                  amount={fiatRentalFee.amount}
                  currency={fiatRentalFee.currency}
                  doCustomerPurchaseCost={doCustomerPurchaseCost}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {(fiatPurchaseEnabled || fiatRentalEnabled) && getTncRow()}
    </div>
  );
}

export default PublishPrice;
