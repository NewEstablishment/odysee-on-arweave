import React from 'react';
import Button from 'component/button';
import CollectionSelectItem from './internal/collectionSelectItem';
import FormNewCollection from 'component/formNewCollection';
import * as COLS from 'constants/collections';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import Spinner from 'component/spinner';
import { getLocalizedNameForCollectionId, getTitleForCollection } from 'util/collections';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import {
  selectCollectionsById,
  selectMyPublishedCollections,
  selectMyUnpublishedCollections,
  selectIsFetchingMyCollections,
} from 'redux/selectors/collections';
import { doFetchCollectionListMine, doFetchThumbnailClaimsForCollectionIds } from 'redux/actions/collections';
import { PLAYLIST_PICKER_CLASSES } from './classes';
type Props = {
  uri: string;
};

type PlaylistOption = {
  collectionId: string;
  icon: string;
};

const THUMBNAIL_PREFETCH_LIMIT = 24;

const ClaimCollectionAdd = (props: Props) => {
  const { uri } = props;
  const dispatch = useAppDispatch();
  const published = useAppSelector(selectMyPublishedCollections);
  const unpublished = useAppSelector(selectMyUnpublishedCollections);
  const collectionsById = useAppSelector(selectCollectionsById);
  const fetchingMine = useAppSelector(selectIsFetchingMyCollections);
  const [addNewCollection, setAddNewCollection] = React.useState(false);
  const [searchText, setSearchText] = React.useState('');

  React.useEffect(() => {
    if (fetchingMine === undefined) {
      dispatch(doFetchCollectionListMine());
    }
  }, [dispatch, fetchingMine]);

  const normalizedSearchText = searchText.trim().toLowerCase();
  const getCollectionLabel = React.useCallback(
    (collectionId: string) =>
      getLocalizedNameForCollectionId(collectionId) || getTitleForCollection(collectionsById[collectionId]) || '',
    [collectionsById]
  );

  const playlistOptions = React.useMemo(() => {
    const options: Array<PlaylistOption> = [];
    const seenIds = new Set<string>();
    const addOption = (collectionId: string, icon: string) => {
      const collection = collectionsById[collectionId];
      if (!collectionId || seenIds.has(collectionId) || collection?.type === COLS.COL_TYPES.FEATURED_CHANNELS) {
        return;
      }

      const label = getCollectionLabel(collectionId);
      if (normalizedSearchText && !label.toLowerCase().includes(normalizedSearchText)) {
        return;
      }

      seenIds.add(collectionId);
      options.push({ collectionId, icon });
    };
    const sortByTitle = (firstId: string, secondId: string) =>
      getCollectionLabel(firstId).localeCompare(getCollectionLabel(secondId), undefined, {
        sensitivity: 'base',
        numeric: true,
      });

    COLS.BUILTIN_PLAYLISTS.forEach((collectionId) =>
      addOption(collectionId, COLS.PLAYLIST_ICONS[collectionId] || ICONS.PLAYLIST)
    );
    Object.keys(unpublished || {})
      .sort(sortByTitle)
      .forEach((collectionId) => addOption(collectionId, ICONS.LOCK));
    Object.keys(published || {})
      .sort(sortByTitle)
      .forEach((collectionId) => addOption(collectionId, ICONS.PLAYLIST));

    return options;
  }, [collectionsById, getCollectionLabel, normalizedSearchText, published, unpublished]);

  const thumbnailCollectionIdsKey = JSON.stringify(
    playlistOptions.slice(0, THUMBNAIL_PREFETCH_LIMIT).map(({ collectionId }) => collectionId)
  );

  React.useEffect(() => {
    const collectionIds = JSON.parse(thumbnailCollectionIdsKey) as Array<string>;
    if (fetchingMine === false && collectionIds.length > 0) {
      dispatch(doFetchThumbnailClaimsForCollectionIds({ collectionIds }));
    }
  }, [dispatch, fetchingMine, thumbnailCollectionIdsKey]);

  return (
    <section className={PLAYLIST_PICKER_CLASSES.panel} aria-labelledby="playlist-picker-title">
      <header className={PLAYLIST_PICKER_CLASSES.header}>
        <h2 id="playlist-picker-title" className={PLAYLIST_PICKER_CLASSES.title}>
          {__('Save to...')}
        </h2>
      </header>

      {fetchingMine !== false ? (
        <div className={PLAYLIST_PICKER_CLASSES.loading}>
          <Spinner />
        </div>
      ) : (
        <>
          <label className={PLAYLIST_PICKER_CLASSES.search}>
            <Icon icon={ICONS.SEARCH} className={PLAYLIST_PICKER_CLASSES.searchIcon} size={20} />
            <input
              aria-label={__('Search playlists')}
              autoComplete="off"
              className={PLAYLIST_PICKER_CLASSES.searchInput}
              name="playlist_search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              type="search"
              placeholder={__('Search playlists')}
            />
          </label>

          {playlistOptions.length > 0 ? (
            <ul className={PLAYLIST_PICKER_CLASSES.list}>
              {playlistOptions.map(({ collectionId, icon }) => (
                <CollectionSelectItem collectionId={collectionId} uri={uri} key={collectionId} icon={icon} />
              ))}
            </ul>
          ) : (
            <div className={PLAYLIST_PICKER_CLASSES.empty}>{__('No matching playlists')}</div>
          )}
        </>
      )}

      <footer className={PLAYLIST_PICKER_CLASSES.footer}>
        {addNewCollection ? (
          <div className={PLAYLIST_PICKER_CLASSES.createForm}>
            <FormNewCollection uri={uri} closeForm={() => setAddNewCollection(false)} />
          </div>
        ) : (
          <Button
            className={PLAYLIST_PICKER_CLASSES.newButton}
            icon={ICONS.ADD}
            iconSize={20}
            label={__('New Playlist')}
            onClick={() => setAddNewCollection(true)}
          />
        )}
      </footer>
    </section>
  );
};

export default ClaimCollectionAdd;
