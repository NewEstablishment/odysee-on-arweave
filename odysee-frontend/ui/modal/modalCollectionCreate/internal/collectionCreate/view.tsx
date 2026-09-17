import React from 'react';
import * as PAGES from 'constants/pages';
import Card from 'component/common/card';
import FormNewCollection from 'component/formNewCollection';
import { useAppDispatch } from 'redux/hooks';
import { doToast } from 'redux/actions/notifications';
type Props = {
  sourceId?: string;
  closeModal: () => void;
};

const CollectionCreate = (props: Props) => {
  const { sourceId, closeModal } = props;
  const dispatch = useAppDispatch();

  function handleClose(newCollectionName: string, newCollectionId: string) {
    closeModal();
    let linkParams = {};

    if (sourceId && newCollectionId) {
      linkParams = {
        linkText: __('View Page'),
        linkTarget: `/$/${PAGES.PLAYLIST}/${newCollectionId}`,
      };
    }

    dispatch(
      doToast({
        message: __('Successfully created "%playlist_name%"', {
          playlist_name: newCollectionName,
        }),
        ...linkParams,
      })
    );
  }

  return (
    <Card
      singlePane
      title={sourceId ? __('Copy Playlist') : __('Create a Playlist')}
      subtitle={
        sourceId
          ? __('The copied playlist is saved to HyperBEAM immediately and remains editable through its stable link.')
          : __('Create the playlist once; later changes are saved to HyperBEAM automatically.')
      }
      actions={<FormNewCollection closeForm={handleClose} onlyCreate sourceId={sourceId} />}
    />
  );
};

export default CollectionCreate;
