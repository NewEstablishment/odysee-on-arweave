import React from 'react';
import ClaimCollectionAdd from './internal/claimCollectionAdd';
import { Modal } from 'modal/modal';
import { useAppDispatch } from 'redux/hooks';
import { doHideModal } from 'redux/actions/app';
import { PLAYLIST_PICKER_CLASSES } from './internal/claimCollectionAdd/classes';
type Props = {
  uri: string;
};

const ModalClaimCollectionAdd = (props: Props) => {
  const { uri } = props;
  const dispatch = useAppDispatch();
  const hideModal = () => dispatch(doHideModal());
  return (
    <Modal
      isOpen
      type="card"
      className={PLAYLIST_PICKER_CLASSES.modal}
      contentLabel={__('Save to playlist')}
      onAborted={hideModal}
    >
      <ClaimCollectionAdd uri={uri} />
    </Modal>
  );
};

export default ModalClaimCollectionAdd;
