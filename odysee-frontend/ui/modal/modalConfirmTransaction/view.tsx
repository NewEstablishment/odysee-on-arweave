import React from 'react';
import Button from 'component/button';
import { Form } from 'component/common/form';
import { Modal } from 'modal/modal';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import { CONFIRM_VALUE_CLASS, CONFIRM_WRAPPER_CLASS } from 'component/common/confirm-classes';
import LbcSymbol from 'component/common/lbc-symbol';
import ClaimPreview from 'component/claimPreview';
import { useAppDispatch, useAppSelector } from 'redux/hooks';
import { selectClaimForUri } from 'redux/selectors/claims';
import { selectActiveChannelClaim, selectIncognito } from 'redux/selectors/app';
import { doHideModal } from 'redux/actions/app';
import { doSendDraftTransaction, doSendTip } from 'redux/actions/wallet';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { HELP_CLASS } from 'component/common/help-classes';

type TipParams = {
  amount: number;
  claim_id: string;
  channel_id?: string;
};

type Props = {
  destination: string;
  amount: number;
  isAddress: boolean;
  setConfirmed: (arg0: boolean) => void;
};

function ModalConfirmTransaction(props: Props) {
  const { destination, amount, isAddress, setConfirmed } = props;
  const dispatch = useAppDispatch();
  const claim = useAppSelector((state) => selectClaimForUri(state, destination)) as StreamClaim;
  const activeChannelClaim = useAppSelector(selectActiveChannelClaim);
  const incognito = useAppSelector(selectIncognito);

  const closeModal = () => dispatch(doHideModal());
  const activeChannelUrl = activeChannelClaim && activeChannelClaim.canonical_url;

  function onConfirmed() {
    if (!isAddress) {
      const claimId = claim && claim.claim_id;
      const tipParams: TipParams = {
        amount: amount,
        claim_id: claimId,
        channel_id: (!incognito && activeChannelClaim && activeChannelClaim.claim_id) || undefined,
      };
      dispatch(doSendTip(tipParams, false, undefined, undefined));
    } else {
      dispatch(doSendDraftTransaction(destination, amount));
    }

    setConfirmed(true);
    closeModal();
  }

  const title = __('Confirm Transaction');

  return (
    <Modal isOpen contentLabel={title} type="card" onAborted={closeModal}>
      <Form onSubmit={() => onConfirmed()}>
        <Card
          title={title}
          body={
            <div className={`section ${CARD_CLASSES.inline} ${CONFIRM_WRAPPER_CLASS}`}>
              <div className="section">
                <div className="confirm__label">{__('Sending')}</div>
                <div className={CONFIRM_VALUE_CLASS}>{<LbcSymbol postfix={amount} size={22} />}</div>

                {!isAddress && <div className="confirm__label">{__('From --[the tip sender]--')}</div>}
                {!isAddress && (
                  <div className={CONFIRM_VALUE_CLASS}>
                    {incognito ? (
                      'Anonymous'
                    ) : (
                      <ClaimPreview
                        key={activeChannelUrl}
                        uri={activeChannelUrl}
                        actions={''}
                        type={'small'}
                        hideMenu
                        hideRepostLabel
                      />
                    )}
                  </div>
                )}

                <div className="confirm__label">{__('To --[the tip recipient]--')}</div>
                <div className={CONFIRM_VALUE_CLASS}>
                  {!isAddress ? (
                    <ClaimPreview
                      key={destination}
                      uri={destination}
                      actions={''}
                      type={'small'}
                      hideMenu
                      hideRepostLabel
                    />
                  ) : (
                    destination
                  )}
                </div>
              </div>
            </div>
          }
          actions={
            <>
              <div className={SECTION_CLASSES.actions}>
                <Button autoFocus button="primary" label={__('Send')} onClick={() => onConfirmed()} />
                <Button button="link" label={__('Cancel')} onClick={closeModal} />
              </div>
              <p className={HELP_CLASS}>{__('Once the transaction is sent, it cannot be reversed.')}</p>
            </>
          }
        />
      </Form>
    </Modal>
  );
}

export default ModalConfirmTransaction;
