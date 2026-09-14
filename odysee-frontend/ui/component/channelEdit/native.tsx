import React from 'react';
import Card from 'component/common/card';
import Button from 'component/button';
import { FormField } from 'component/common/form';
import { fetchHyperbeamProfile, fetchHyperbeamProfileSave } from 'util/hyperbeam';
import { hyperbeamNodeBase } from 'util/hyperbeamDevices';
import { validProfileMetadata, type ProfileMetadata } from 'util/nativeProfileRevisions';
import { uploadProfileImage } from 'services/profileImageUpload';
import { useAppDispatch, useAppSelector } from 'redux/hooks';
import { selectClaimForUri } from 'redux/selectors/claims';
import { doResolveUri } from 'redux/actions/claims';

export default function NativeProfileEditor({ uri, onDone }: { uri: string; onDone?: () => void }) {
  const dispatch = useAppDispatch();
  const claim = useAppSelector((state) => selectClaimForUri(state, uri));
  const id = claim?.claim_id;
  const [profile, setProfile] = React.useState<any>(null);
  const [metadata, setMetadata] = React.useState<ProfileMetadata>({
    title: '',
    description: '',
    avatar_id: '',
    banner_id: '',
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [reload, setReload] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    setProfile(null);
    setError('');
    if (!id || claim?.hyperbeam?.profile_historical) return;
    fetchHyperbeamProfile(id)
      .then((loaded) => {
        if (!active) return;
        if (!loaded.is_my_output) throw new Error('Only the profile owner can edit this profile.');
        setProfile(loaded);
        setMetadata({
          title: loaded.value.title,
          description: loaded.value.description,
          avatar_id: loaded.hyperbeam.avatar_id,
          banner_id: loaded.hyperbeam.banner_id,
        });
      })
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [id, reload, claim?.hyperbeam?.profile_historical]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await fetchHyperbeamProfileSave(id, profile.hyperbeam.profile_version, metadata);
      await dispatch(doResolveUri(uri, false));
      onDone?.();
    } catch (err) {
      setError(err.message || 'Profile save failed. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  async function imageChange(file: File | undefined, key: 'avatar_id' | 'banner_id') {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const imageId = await uploadProfileImage(file);
      setMetadata((current) => ({ ...current, [key]: imageId }));
    } catch (err) {
      setError(err.message || 'Image upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={__('Edit profile')}
      body={
        <>
          <p>
            {__(
              'Your channel handle and existing links stay the same. Profile updates and images are public; previous versions remain available.'
            )}
          </p>
          {error && (
            <p role="alert" className="error__text">
              {error}
            </p>
          )}
          {!profile ? (
            <Button button="link" label={__('Reload profile')} onClick={() => setReload((value) => value + 1)} />
          ) : (
            <>
              <FormField
                name="profile_display_name"
                label={__('Display name')}
                type="text"
                maxLength={200}
                value={metadata.title}
                disabled={busy}
                onChange={(event) => setMetadata({ ...metadata, title: event.target.value })}
              />
              <FormField
                name="profile_bio"
                label={__('Bio')}
                type="textarea"
                maxLength={5000}
                value={metadata.description}
                disabled={busy}
                onChange={(event) => setMetadata({ ...metadata, description: event.target.value })}
              />
              {(['avatar_id', 'banner_id'] as const).map((key) => (
                <div key={key} className="section">
                  <label htmlFor={`profile_${key}`}>{key === 'avatar_id' ? __('Avatar') : __('Banner')}</label>
                  {metadata[key] && (
                    <img
                      alt={key === 'avatar_id' ? __('Avatar preview') : __('Banner preview')}
                      src={`${hyperbeamNodeBase()}/${metadata[key]}`}
                      style={{ maxWidth: '100%', maxHeight: 180 }}
                    />
                  )}
                  <input
                    id={`profile_${key}`}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={(event) => {
                      void imageChange(event.target.files?.[0], key);
                      event.target.value = '';
                    }}
                  />
                  {metadata[key] && (
                    <Button
                      button="link"
                      label={key === 'avatar_id' ? __('Remove avatar') : __('Remove banner')}
                      disabled={busy}
                      onClick={() => setMetadata({ ...metadata, [key]: '' })}
                    />
                  )}
                </div>
              ))}
              <p>
                {__(
                  'PNG, JPEG or WebP, up to 5 MB. Image uploads are public immediately; Save applies them to your profile.'
                )}
              </p>
            </>
          )}
        </>
      }
      actions={
        <div className="section__actions">
          <Button
            button="primary"
            label={busy ? __('Saving...') : __('Save profile')}
            disabled={busy || !profile || !validProfileMetadata(metadata)}
            onClick={save}
          />
          <Button button="link" label={__('Cancel')} disabled={busy} onClick={onDone} />
          {error && profile && (
            <Button
              button="link"
              label={__('Reload profile')}
              disabled={busy}
              onClick={() => setReload((value) => value + 1)}
            />
          )}
        </div>
      }
    />
  );
}
