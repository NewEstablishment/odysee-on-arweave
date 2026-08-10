import React from 'react';
import type { ElementRef } from 'react';
import * as ICONS from 'constants/icons';
import * as KEYCODES from 'constants/keycodes';
import * as COLLECTIONS_CONSTS from 'constants/collections';
import { FormField } from 'component/common/form';
import Button from 'component/button';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doPlaylistAddAndAllowPlaying } from 'redux/actions/content';
import { doToast } from 'redux/actions/notifications';
import { selectCollectionForId } from 'redux/selectors/collections';
import { selectClaimForUri } from 'redux/selectors/claims';
import { createNativePlaylist, immutableIdForClaim } from 'util/hyperbeam';

type Props = {
  uri?: string;
  sourceId?: string;
  onlyCreate?: boolean;
  closeForm: (newCollectionName?: string, newCollectionId?: string) => void;
};

function FormNewCollection(props: Props) {
  const { uri, sourceId, onlyCreate, closeForm } = props;

  const dispatch = useAppDispatch();
  const sourceCollectionName = useAppSelector((state) =>
    sourceId ? selectCollectionForId(state, sourceId)?.name : undefined
  );
  const uriClaim = useAppSelector((state) => (uri ? selectClaimForUri(state, uri) : undefined));

  const buttonref = React.useRef<any>(null);
  const [newCollectionName, setCollectionName] = React.useState(
    sourceCollectionName
      ? __('%copied_playlist_name% (copy)', {
          copied_playlist_name: sourceCollectionName,
        })
      : ''
  );

  function handleNameInput(e) {
    const { value } = e.target;
    setCollectionName(value);
  }

  async function handleAddCollection() {
    const name = newCollectionName.trim();
    let id;

    let nativeId;
    try {
      const itemId = immutableIdForClaim(uriClaim);
      nativeId = await createNativePlaylist({ title: name, items: itemId ? [itemId] : [] });
    } catch (error) {
      dispatch(
        doToast({
          message: __('Native playlist write failed — created a local-only playlist instead.'),
          isError: true,
        })
      );
    }

    dispatch(
      doPlaylistAddAndAllowPlaying({
        uri,
        collectionName: name,
        sourceId,
        createNew: true,
        nativeId,
        createCb: !sourceId
          ? undefined
          : (newId) => {
              id = newId;
            },
      })
    );
    closeForm(name, id || nativeId);
  }

  function handleKeyDown(e: React.KeyboardEvent<any>) {
    if (e.keyCode === KEYCODES.ENTER) {
      e.preventDefault();
      (buttonref as any).current.click();
    }
  }

  function handleClearNew() {
    closeForm();
  }

  return (
    <FormField
      autoFocus
      type="text"
      name="new_collection"
      label={__('New Playlist Title')}
      placeholder={__(COLLECTIONS_CONSTS.PLACEHOLDER)}
      onKeyDown={handleKeyDown}
      inputButton={
        <>
          <Button
            button="alt"
            icon={ICONS.COMPLETED}
            title={__('Confirm')}
            className="button-toggle"
            disabled={newCollectionName.trim().length === 0}
            onClick={handleAddCollection}
            ref={buttonref}
          />
          {!onlyCreate && (
            <Button
              button="alt"
              className="button-toggle"
              icon={ICONS.REMOVE}
              title={__('Cancel')}
              onClick={handleClearNew}
            />
          )}
        </>
      }
      onChange={handleNameInput}
      value={newCollectionName}
    />
  );
}

export default FormNewCollection;
