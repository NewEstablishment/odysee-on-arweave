import React from 'react';
import * as PAGES from 'constants/pages';
import * as ICONS from 'constants/icons';
import MarkdownPreview from 'component/common/markdown-preview';
import CollectionPrivateIcon from 'component/common/collection-private-icon';
import Skeleton from '@mui/material/Skeleton';
import Button from 'component/button';
import { useAppSelector } from 'redux/hooks';
import {
  selectCollectionDescriptionForId,
  selectCollectionForId,
  selectCountForCollectionId,
  selectSourceIdForCollectionId,
} from 'redux/selectors/collections';

type Props = {
  collectionId: string;
};

const CollectionSubtitle = (props: Props) => {
  const { collectionId } = props;
  const collection = useAppSelector((state) => selectCollectionForId(state, collectionId));
  const collectionDescription = useAppSelector((state) => selectCollectionDescriptionForId(state, collectionId));
  const collectionCount = useAppSelector((state) => selectCountForCollectionId(state, collectionId));
  const sourceId = useAppSelector((state) => selectSourceIdForCollectionId(state, collectionId));

  return (
    <div>
      {sourceId && (
        <span className="collection__subtitle">
          <Button
            iconRight={ICONS.EXTERNAL}
            label={__('View copied playlist source')}
            button="link"
            navigate={`/$/${PAGES.PLAYLIST}/${sourceId}`}
          />
        </span>
      )}

      {collectionCount || collectionCount === 0 ? (
        <span className="collection__subtitle">
          {collectionCount === 1
            ? __('1 item')
            : __('%collectionCount% items', {
                collectionCount,
              })}
        </span>
      ) : (
        <Skeleton variant="text" animation="wave" className="header__navigationItem--balanceLoading" />
      )}

      <MarkdownPreview content={collectionDescription} />

      {collection?.profileName ? (
        <span className="collection__subtitle">{collection.profileName}</span>
      ) : (
        <CollectionPrivateIcon />
      )}
    </div>
  );
};

export default CollectionSubtitle;
