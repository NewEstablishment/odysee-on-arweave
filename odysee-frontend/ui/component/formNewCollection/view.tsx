import React from 'react';
import type { ElementRef } from 'react';
import * as ICONS from 'constants/icons';
import * as KEYCODES from 'constants/keycodes';
import * as COLLECTIONS_CONSTS from 'constants/collections';
import { FormField } from 'component/common/form';
import Button from 'component/button';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doPlaylistAddAndAllowPlaying } from 'redux/actions/content';
import { selectCollectionForId } from 'redux/selectors/collections';

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

  const buttonref = React.useRef<any>(null);
  const [newCollectionName, setCollectionName] = React.useState(
    sourceCollectionName
      ? __('%copied_playlist_name% (copy)', {
          copied_playlist_name: sourceCollectionName,
        })
      : ''
  );
  const [saving, setSaving] = React.useState(false);
  const [isPublic, setIsPublic] = React.useState(false);

  function handleNameInput(e) {
    const { value } = e.target;
    setCollectionName(value);
  }

  async function handleAddCollection() {
    const name = newCollectionName.trim();
    setSaving(true);
    try {
      const id = await dispatch(
        doPlaylistAddAndAllowPlaying({
          uri,
          collectionName: name,
          sourceId,
          createNew: true,
          visibility: isPublic ? 'public' : 'private',
        })
      );
      closeForm(name, id);
    } catch {
      return;
    } finally {
      setSaving(false);
    }
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
    <div>
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
              disabled={saving || newCollectionName.trim().length === 0}
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
      <FormField
        type="checkbox"
        name="new_collection_public"
        label={__('Make this playlist public')}
        checked={isPublic}
        disabled={saving}
        onChange={() => setIsPublic((current) => !current)}
      />
      <p className="help">
        {isPublic
          ? __('Anyone with the link can view this playlist. Public playlist history cannot be made private later.')
          : __(
              'Private by default. The title, description, thumbnail, tags, and items are encrypted for your account.'
            )}
      </p>
    </div>
  );
}

export default FormNewCollection;
