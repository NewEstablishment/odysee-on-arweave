import React from 'react';
import { CollectionsListContext } from 'page/playlists/internal/collectionsListMine/view';

const FilteredTextLabel = () => {
  const { totalLength, searchText, filteredCollectionsLength, isFetchingCollections } =
    React.useContext(CollectionsListContext);
  if (isFetchingCollections) {
    return <div className="tw:p-0 tw:pb-app-m tw:text-app-text">{__('Loading playlists...')}</div>;
  }
  if (!searchText) return null;
  return (
    <div className="tw:p-0 tw:pb-app-m tw:text-app-text">
      {__(
        filteredCollectionsLength > 1
          ? 'Showing %filtered% results of %total%'
          : 'Showing %filtered% result of %total%',
        {
          filtered: filteredCollectionsLength,
          total: totalLength,
        }
      )}
      {' (' + __('filtered') + ') '}
    </div>
  );
};

export default FilteredTextLabel;
