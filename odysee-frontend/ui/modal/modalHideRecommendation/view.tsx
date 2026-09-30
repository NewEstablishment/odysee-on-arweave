import React from 'react';
import Button from 'component/button';
import ClaimPreview from 'component/claimPreview';
import Card from 'component/common/card';
import { FormField } from 'component/common/form-components/form-field';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { Modal } from 'modal/modal';
import { useAppDispatch } from 'redux/hooks';
import { doHideModal } from 'redux/actions/app';
type Props = {
  uri: string;
  onConfirm: (hideChannel: boolean) => void;
};
export default function ModalHideRecommendation(props: Props) {
  const { uri, onConfirm } = props;
  const dispatch = useAppDispatch();
  const hideModal = () => dispatch(doHideModal());
  const [hideChannel, setHideChannel] = React.useState(false);

  function handleOnClick() {
    if (onConfirm) {
      onConfirm(hideChannel);
    }

    hideModal();
  }

  return (
    <Modal isOpen type="card" onAborted={hideModal}>
      <Card
        title={__('Not interested')}
        body={<ClaimPreview uri={uri} hideMenu hideActions nonClickable type="inline" properties={false} />}
        actions={
          <>
            <div className={SECTION_CLASSES.checkbox}>
              <FormField
                type="checkbox"
                name="hide_channel"
                label={__("Also, don't recommend channel")}
                checked={hideChannel}
                onChange={() => setHideChannel(!hideChannel)}
              />
            </div>
            <div className={SECTION_CLASSES.actions}>
              <Button button="primary" label={__('Submit')} onClick={handleOnClick} />
              <Button button="link" label={__('Cancel')} onClick={hideModal} />
            </div>
          </>
        }
      />
    </Modal>
  );
}
