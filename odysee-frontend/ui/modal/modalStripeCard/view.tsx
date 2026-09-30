import React from 'react';
import { Modal } from 'modal/modal';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import Button from 'component/button';
import * as ICONS from 'constants/icons';
import * as PAGES from 'constants/pages';
import { useAppDispatch } from 'redux/hooks';
import { doOpenModal, doHideModal } from 'redux/actions/app';
import { SECTION_CLASSES } from 'component/common/section-classes';

type Props = {
  previousModal?: string;
  previousProps?: any;
};

const ModalStripeCard = (props: Props) => {
  const { previousModal, previousProps } = props;
  const dispatch = useAppDispatch();

  function handleGoBack() {
    dispatch(doHideModal());
    if (previousModal) dispatch(doOpenModal(previousModal, previousProps));
  }

  return (
    <Modal onAborted={() => dispatch(doHideModal())} isOpen type="card">
      <Card
        className="tw:[border:0]"
        title={__('Payment methods retired')}
        body={
          <div className={CARD_CLASSES.bodyActions}>
            <h3>{__('Card management has been retired.')}</h3>
            <p>{__('This app no longer supports Stripe-based payment method management.')}</p>
          </div>
        }
        actions={
          <div className={SECTION_CLASSES.actions}>
            <Button button="primary" label={__('Open Wallet')} icon={ICONS.WALLET} navigate={`/$/${PAGES.WALLET}`} />
            <Button button="link" label={__('Back')} onClick={handleGoBack} />
            <Button button="link" label={__('Cancel')} onClick={() => dispatch(doHideModal())} />
          </div>
        }
      />
    </Modal>
  );
};

export default ModalStripeCard;
