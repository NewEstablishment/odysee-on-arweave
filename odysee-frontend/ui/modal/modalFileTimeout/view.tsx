import React from 'react';
import { Modal } from 'modal/modal';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectMetadataForUri } from 'redux/selectors/claims';
import { doHideModal } from 'redux/actions/app';
import { ERROR_MODAL_LIST_CLASS } from 'modal/error-classes';

type Props = {
  uri: string;
};

export default function ModalFileTimeout(props: Props) {
  const { uri } = props;
  const dispatch = useAppDispatch();
  const metadata = useAppSelector((state) => selectMetadataForUri(state, uri));
  const title = metadata?.title;

  return (
    <Modal
      isOpen
      title={__('Unable to download')}
      contentLabel={__('Download failed')}
      onConfirmed={() => dispatch(doHideModal())}
    >
      <p className={ERROR_MODAL_LIST_CLASS}>
        {__('LBRY was unable to download the stream')}:
        <div>
          <b>{title ? `"${title}"` : uri}</b>
        </div>
      </p>
    </Modal>
  );
}
