import React from 'react';
import classnames from 'classnames';
import { COL_TYPES } from 'constants/collections';
import { getLocalizedNameForCollectionId } from 'util/collections';
import Icon from 'component/common/icon';
import OptimizedImage from 'component/optimizedImage';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import {
  selectCollectionForId,
  selectCollectionForIdHasClaimUrl,
  selectCollectionLengthForId,
  selectFirstItemUrlForCollection,
  selectIsCollectionPrivateForId,
  selectThumbnailForCollectionId,
} from 'redux/selectors/collections';
import { selectClaimIsPendingForId, selectThumbnailForUri } from 'redux/selectors/claims';
import { doPlaylistAddAndAllowPlaying } from 'redux/actions/content';
import * as ICONS from 'constants/icons';
import { PLAYLIST_PICKER_CLASSES } from '../../classes';
type Props = {
  icon: string;
  uri: string;
  collectionId: string;
};

function CollectionSelectItem(props: Props) {
  const { icon, uri, collectionId } = props;
  const dispatch = useAppDispatch();
  const collection = useAppSelector((state) => selectCollectionForId(state, collectionId));
  const collectionHasClaim = useAppSelector((state) => selectCollectionForIdHasClaimUrl(state, collectionId, uri));
  const collectionPending = useAppSelector((state) => selectClaimIsPendingForId(state, collectionId));
  const collectionLength = useAppSelector((state) => selectCollectionLengthForId(state, collectionId));
  const isPrivate = useAppSelector((state) => selectIsCollectionPrivateForId(state, collectionId));
  const collectionThumbnail = useAppSelector((state) => selectThumbnailForCollectionId(state, collectionId));
  const firstItemUrl = useAppSelector((state) => selectFirstItemUrlForCollection(state, collectionId));
  const firstItemThumbnail = useAppSelector((state) =>
    firstItemUrl ? selectThumbnailForUri(state, firstItemUrl) : undefined
  );
  const id = collection?.id || collectionId;
  const name = getLocalizedNameForCollectionId(id) || collection?.name || collection?.title || id;
  const thumbnail = collectionThumbnail || firstItemThumbnail;
  const [failedThumbnail, setFailedThumbnail] = React.useState<string | undefined>();
  const showThumbnail = Boolean(thumbnail && thumbnail !== failedThumbnail);
  const itemCountLabel =
    collectionLength === 1
      ? __('1 item')
      : __('%collection_count% items', {
          collection_count: collectionLength,
        });
  const stateLabel = collectionHasClaim
    ? __('In %collection%', { collection: name })
    : __('Add to %collection%', { collection: name });

  function handleChange() {
    dispatch(
      doPlaylistAddAndAllowPlaying({
        uri,
        collectionId: id,
        collectionName: name,
      })
    );
  }

  if (collection?.type === COL_TYPES.FEATURED_CHANNELS) {
    return null;
  }

  return (
    <li className={PLAYLIST_PICKER_CLASSES.item}>
      <button
        aria-label={stateLabel}
        aria-pressed={collectionHasClaim}
        className={classnames(PLAYLIST_PICKER_CLASSES.row, {
          [PLAYLIST_PICKER_CLASSES.rowSelected]: collectionHasClaim,
        })}
        disabled={collectionPending}
        onClick={handleChange}
        type="button"
      >
        <span className={PLAYLIST_PICKER_CLASSES.preview} aria-hidden>
          {showThumbnail && thumbnail ? (
            <OptimizedImage
              src={thumbnail}
              width={176}
              quality={85}
              loading="lazy"
              className={PLAYLIST_PICKER_CLASSES.previewImage}
              onError={() => setFailedThumbnail(thumbnail)}
            />
          ) : (
            <Icon icon={icon} className={PLAYLIST_PICKER_CLASSES.previewIcon} size={24} />
          )}
        </span>

        <span className={PLAYLIST_PICKER_CLASSES.copy}>
          <span className={PLAYLIST_PICKER_CLASSES.itemTitle} title={name}>
            {name}
          </span>
          <span className={PLAYLIST_PICKER_CLASSES.metadata}>
            <span className={PLAYLIST_PICKER_CLASSES.privacy}>
              {isPrivate && <Icon icon={ICONS.LOCK} className={PLAYLIST_PICKER_CLASSES.privacyIcon} size={12} />}
              {isPrivate ? __('Private') : __('Public')}
            </span>
            <span aria-hidden>&middot;</span>
            <span className={PLAYLIST_PICKER_CLASSES.itemCount}>{itemCountLabel}</span>
          </span>
        </span>

        <span
          className={classnames(PLAYLIST_PICKER_CLASSES.indicator, {
            [PLAYLIST_PICKER_CLASSES.indicatorSelected]: collectionHasClaim,
          })}
          aria-hidden
        >
          <Icon icon={collectionHasClaim ? ICONS.COMPLETE : ICONS.ADD} size={20} />
        </span>
      </button>
    </li>
  );
}

export default CollectionSelectItem;
