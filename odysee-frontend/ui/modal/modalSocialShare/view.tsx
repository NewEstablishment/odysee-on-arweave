import React from 'react';
import { Modal } from 'modal/modal';
import FileVisibility from 'component/fileVisibility';
import SocialShare from 'component/socialShare';
import Card from 'component/common/card';
import { useAppDispatch } from 'redux/hooks';
import { doHideModal } from 'redux/actions/app';
import { SOCIAL_SHARE_CARD_CLASS } from './classes';

type Props = {
  uri: string;
  webShareable: boolean;
  collectionId?: number;
};

function ModalSocialShare(props: Props) {
  const { uri, webShareable, collectionId } = props;
  const dispatch = useAppDispatch();

  const closeModal = () => dispatch(doHideModal());

  return (
    <Modal isOpen onAborted={closeModal} type="card">
      <Card
        className={SOCIAL_SHARE_CARD_CLASS}
        title={
          <>
            {__('Share')}
            <FileVisibility uri={uri} />
          </>
        }
        actions={<SocialShare uri={uri} webShareable={webShareable} collectionId={collectionId} />}
      />
    </Modal>
  );
}

export default ModalSocialShare;
