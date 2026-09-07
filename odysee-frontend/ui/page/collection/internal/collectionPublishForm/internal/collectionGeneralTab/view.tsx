import React from 'react';
import { FF_MAX_CHARS_IN_DESCRIPTION } from 'constants/form-field';
import * as THUMBNAIL_STATUSES from 'constants/thumbnail_upload_statuses';
import * as TAGS from 'constants/tags';
import { FormField } from 'component/common/form';
import { FormContext } from 'component/common/form-components/form';
import TagsSelect from 'component/tagsSelect';
import Card from 'component/common/card';
import { lazyImport } from 'util/lazyImport';
import './style.scss';
const SelectThumbnail = lazyImport(
  () =>
    import(
      'component/selectThumbnail'
      /* webpackChunkName: "selectThumbnail" */
    )
);
const TAGS_LIMIT = 5;
function normalizeTag(tag: any) {
  if (typeof tag === 'string') return { name: tag };
  return tag;
}

type Props = {
  collectionId: string;
  initialVisibility: PlaylistVisibility;
  formParams: any;
  setThumbnailError: (error: string | null | undefined) => void;
  updateFormParams: (obj: any) => void;
};

function CollectionGeneralTab(props: Props) {
  const { collectionId, initialVisibility, formParams, setThumbnailError, updateFormParams } = props;
  const { title, description, thumbnail_url: thumbnailUrl, tags, visibility = 'private' } = formParams;
  const { updateFormErrors } = React.useContext(FormContext);
  const selectedTags = React.useMemo(() => (tags || []).map(normalizeTag).filter((tag) => tag?.name), [tags]);
  const [thumbStatus, setThumbStatus] = React.useState<string | undefined>();
  const [thumbError, setThumbError] = React.useState<string | undefined>();

  function handleUpdateThumbnail(update: Record<string, string>) {
    const { thumbnail_url: url, thumbnail_status: status, thumbnail_error: error } = update;

    if (url?.length >= 0) {
      const newParams =
        url.length === 0
          ? {
              thumbnail_url: undefined,
            }
          : update;
      updateFormParams({ thumbnail_url: newParams.thumbnail_url });
      setThumbStatus(undefined);
      setThumbError(undefined);
    } else {
      if (status) {
        setThumbStatus(status);
      } else {
        setThumbError(error);
      }
    }
  }

  React.useEffect(() => {
    const thumbnailError =
      thumbError && thumbStatus !== THUMBNAIL_STATUSES.COMPLETE
        ? __('Invalid thumbnail')
        : thumbStatus === THUMBNAIL_STATUSES.IN_PROGRESS
          ? __('Please wait for thumbnail to finish uploading')
          : undefined;
    setThumbnailError(thumbnailError);
    updateFormErrors('thumbnail', thumbnailError); // eslint-disable-next-line react-hooks/exhaustive-deps -- ignore updateFormErrors
  }, [setThumbnailError, thumbError, thumbStatus]);
  return (
    <div className="card card--background collection-edit__wrapper">
      <div className="collection__title">
        <h2>{__('Title')}</h2>
        <FormField
          type="text"
          name="collection_title"
          placeholder={__('My Awesome Playlist')}
          value={title || ''}
          onChange={(e) =>
            updateFormParams({
              title: e.target.value || '',
            })
          }
        />
      </div>

      <fieldset-section>
        <SelectThumbnail
          {...({
            thumbnailParam: thumbnailUrl,
            thumbnailParamError: thumbError,
            thumbnailParamStatus: thumbStatus,
            updateThumbnailParams: handleUpdateThumbnail,
            optional: true,
          } as any)}
        />
      </fieldset-section>

      <h2>{__('Description')}</h2>
      <FormField
        type="markdown"
        name="collection_description"
        value={(typeof description === 'string' && description) || ''}
        onChange={(value) =>
          updateFormParams({
            description: value || '',
          })
        }
        textAreaMaxLength={FF_MAX_CHARS_IN_DESCRIPTION}
      />

      <h2
        className="card__title"
        style={{
          marginTop: 'var(--spacing-l)',
        }}
      >
        {__('Tags')}
      </h2>
      <Card
        background
        body={
          <div className="publish-row">
            <TagsSelect
              suggestMature={false}
              disableAutoFocus
              hideHeader
              label={__('Selected Tags')}
              empty={__('No tags added')}
              excludedControlTags={
                [
                  TAGS.DISABLE_COMMENTS_TAG,
                  TAGS.DISABLE_DOWNLOAD_BUTTON_TAG,
                  TAGS.DISABLE_REACTIONS_COMMENTS_TAG,
                  TAGS.DISABLE_SLIMES_COMMENTS_TAG,
                ] as any
              }
              limitSelect={TAGS_LIMIT}
              help={__(
                "Add tags that are relevant to your content so those who're looking for it can find it more easily. If your content is best suited for mature audiences, ensure it is tagged 'mature'."
              )}
              placeholder={__('gaming, crypto')}
              onSelect={(newTags) => {
                const validatedTags = [];
                newTags.forEach((newTag) => {
                  if (!selectedTags.some((tag) => tag.name === newTag.name)) {
                    validatedTags.push(newTag);
                  }
                });
                updateFormParams({
                  tags: [...selectedTags, ...validatedTags],
                });
              }}
              onRemove={(clickedTag) => {
                const newTags = selectedTags.filter((tag) => tag.name !== clickedTag.name);
                updateFormParams({
                  tags: newTags,
                });
              }}
              tagsChosen={selectedTags}
            />
          </div>
        }
      />

      <h2
        className="card__title"
        style={{
          marginTop: 'var(--spacing-l)',
        }}
      >
        {__('Visibility')}
      </h2>
      <Card
        background
        body={
          <>
            <FormField
              type="checkbox"
              name="collection_public"
              label={initialVisibility === 'public' ? __('Public playlist') : __('Make this playlist public')}
              checked={visibility === 'public'}
              disabled={initialVisibility === 'public'}
              onChange={() =>
                updateFormParams({
                  visibility: visibility === 'public' ? 'private' : 'public',
                })
              }
            />
            <p className="help">
              {initialVisibility === 'public'
                ? __('This playlist is public. Its published history cannot be made private.')
                : visibility === 'public'
                  ? __('Saving will publish the decrypted playlist. This cannot be reversed.')
                  : __('Only your signed-in account can decrypt this playlist and its items.')}
            </p>
          </>
        }
      />
    </div>
  );
}

export default CollectionGeneralTab;
