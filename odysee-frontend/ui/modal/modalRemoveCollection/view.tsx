import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from 'modal/modal';
import Button from 'component/button';
import Card from 'component/common/card';
import I18nMessage from 'component/i18nMessage';
import { FormField } from 'component/common/form';
import { useAppDispatch, useAppSelector } from 'redux/hooks';
import { selectHasClaimForId } from 'redux/selectors/claims';
import { selectCollectionTitleForId, selectCollectionKeyForId } from 'redux/selectors/collections';
import { doHideModal } from 'redux/actions/app';
import { doCollectionDelete } from 'redux/actions/collections';
import { doToast } from 'redux/actions/notifications';
type Props = {
  collectionId: string;
  simplify?: boolean;
  redirect: string | null | undefined;
};

function ModalRemoveCollection(props: Props) {
  const { simplify, collectionId, redirect } = props;
  const dispatch = useAppDispatch();
  const hasClaim = useAppSelector((state) => selectHasClaimForId(state, collectionId));
  const collectionName = useAppSelector((state) => selectCollectionTitleForId(state, collectionId));
  const collectionKey = useAppSelector((state) => selectCollectionKeyForId(state, collectionId));
  const navigate = useNavigate();
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  function getBody() {
    if (simplify) {
      return (
        <>
          <p>{__('This will permanently delete the list.')}</p>
          <p>{`"${collectionName}"`}</p>
        </>
      );
    } else {
      return hasClaim ? (
        <>
          <p>{__('This will permanently delete the list.')}</p>
          <p>
            {__('Type "%list_name%" to confirm.', {
              list_name: collectionName,
            })}
          </p>
          <FormField
            value={confirmName}
            type={'text'}
            onChange={(e) => setConfirmName(e.target.value)}
            style={{
              marginBottom: 'var(--spacing-s)',
            }}
          />
        </>
      ) : (
        <I18nMessage
          tokens={{
            title: <cite>{`"${collectionName}"`}</cite>,
          }}
        >
          Are you sure you'd like to delete %title%?
        </I18nMessage>
      );
    }
  }

  return (
    <Modal isOpen contentLabel={__('Confirm Playlist Delete')} type="card" onAborted={() => dispatch(doHideModal())}>
      <Card
        title={__('Delete Playlist')}
        body={
          <>
            {getBody()}
            <p className="help error__text">{__('This action is permanent and cannot be undone')}</p>
          </>
        }
        actions={
          <div className="section__actions">
            <Button
              button="primary"
              label={deleting ? __('Deleting...') : __('Delete')}
              disabled={deleting || (!simplify && hasClaim && collectionName !== confirmName)}
              onClick={async () => {
                setDeleting(true);
                try {
                  await dispatch(doCollectionDelete(collectionId, hasClaim ? undefined : collectionKey));
                  if (redirect) navigate(redirect, { replace: true });
                  dispatch(doHideModal());
                } catch (error) {
                  setDeleting(false);
                  dispatch(doToast({ message: error?.message || __('Failed to delete playlist.'), isError: true }));
                }
              }}
            />
            <Button button="link" label={__('Cancel')} onClick={() => dispatch(doHideModal())} />
          </div>
        }
      />
    </Modal>
  );
}

export default ModalRemoveCollection;
