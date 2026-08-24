import * as ICONS from 'constants/icons';
import { useNavigate } from 'react-router-dom';
import { COLLECTION_PAGE as CP } from 'constants/urlParams';
import React from 'react';
import FileActionButton from 'component/common/file-action-button';
import { useAppSelector } from 'redux/hooks';
import {
  selectCollectionHasEditsForId,
  selectCollectionLengthForId,
  selectCollectionIsPublishingForId,
  selectCollectionPublishErrorForId,
} from 'redux/selectors/collections';
type Props = {
  uri?: string;
  collectionId: string;
  showEdit?: boolean;
};

function CollectionPublishButton(props: Props) {
  const { uri, collectionId, showEdit } = props;
  const collectionHasEdits = useAppSelector((state) => selectCollectionHasEditsForId(state, collectionId));
  const collectionLength = useAppSelector((state) => selectCollectionLengthForId(state, collectionId));
  const isPublishing = useAppSelector((state) => selectCollectionIsPublishingForId(state, collectionId));
  const publishError = useAppSelector((state) => selectCollectionPublishErrorForId(state, collectionId));
  const navigate = useNavigate();
  if (collectionLength === 0) return null;
  const label = isPublishing
    ? __('Publishing...')
    : publishError && collectionHasEdits
      ? __('Retry Publish')
      : uri
        ? __('Publish Snapshot')
        : __('Publish');
  return (
    <FileActionButton
      title={label}
      label={label}
      className={collectionHasEdits ? 'button--warning' : ''}
      onClick={() => navigate(`?${CP.QUERIES.VIEW}=${CP.VIEWS.PUBLISH}`)}
      icon={ICONS.PUBLISH}
      iconSize={18}
      disabled={showEdit || isPublishing}
    />
  );
}

export default CollectionPublishButton;
