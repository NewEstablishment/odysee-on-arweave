import * as COLLECTIONS_CONSTS from 'constants/collections';
import { createSelector } from 'reselect';
import {
  selectClaimForUri,
  selectClaimForClaimId,
  selectClaimsById,
  selectClaimIdsByUri,
  selectMyCollectionClaimIds,
  selectResolvedCollectionsById,
  selectMyCollectionClaimsById,
  selectClaimIsMineForId,
} from 'redux/selectors/claims';
import { normalizeURI, parseURI } from 'util/lbryURI';
import { createCachedSelector } from 're-reselect';
import { selectUserCreationDate } from 'redux/selectors/user';
import {
  selectIsCollectionPlayingForId,
  selectCollectionForIdIsPlayingShuffle,
  selectCollectionForIdIsPlayingLoop,
  selectCanPlaybackFileForUri,
} from 'redux/selectors/content';
import { getItemCountForCollection } from 'util/collections';
import { getClaimOutpoint, isPermanentUrl, isCanonicalUrl } from 'util/claim';
import { validNativePlaylistItem } from 'util/nativePlaylists';
import { EMPTY_OBJECT } from 'redux/selectors/empty';

const selectState = (state: State) => state.collections || EMPTY_OBJECT;

const TIMESTAMP_MS_THRESHOLD = 1e12;

const toMilliseconds = (timestamp: any): number => {
  if (!timestamp) return 0;
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > TIMESTAMP_MS_THRESHOLD ? value : value * 1000;
};

export const selectSavedCollectionIds = (state: State) => selectState(state).savedIds;
export const selectBuiltinCollections = (state: State) => selectState(state).builtin;
export const selectMyUnpublishedCollections = (state: State) => selectState(state).unpublished;
export const selectMyEditedCollections = (state: State) => selectState(state).edited;
export const selectMyCollectionsWithUnSavedChanges = (state: State) => selectState(state).unsavedChanges;
export const selectMyUpdatedCollections = (state: State) => selectState(state).updated;
export const selectCollectionItemsFetchingIds = (state: State) => selectState(state).collectionItemsFetchingIds;
export const selectQueueCollection = (state: State) => selectState(state).queue;
export const selectLastUsedCollectionIds = (state: State) => selectState(state).lastUsedCollectionIds;
export const selectIsFetchingMyCollections = (state: State) => selectState(state).isFetchingMyCollections;
export const selectCollectionIdsWithItemsResolved = (state: State) => selectState(state).resolvedIds;
export const selectThumbnailClaimsFetchingCollectionIds = (state: State) =>
  selectState(state).thumbnailClaimsFetchingCollectionIds;
export const selectCollectionSavingMap = (state: State) => selectState(state).savingById || EMPTY_OBJECT;
export const selectCollectionSaveErrorMap = (state: State) => selectState(state).saveErrorById || EMPTY_OBJECT;
export const selectCollectionIsSavingForId = (state: State, id: string) =>
  Boolean(selectCollectionSavingMap(state)[id]);
export const selectCollectionSaveErrorForId = (state: State, id: string) => selectCollectionSaveErrorMap(state)[id];
export const selectAreThumbnailClaimsFetchingForCollectionIds = (state: State, ids: string) =>
  selectThumbnailClaimsFetchingCollectionIds(state).includes(ids);
const selectCollectionIdsWithItemsResolvedSet = createSelector(
  selectCollectionIdsWithItemsResolved,
  (resolvedIds) => new Set(resolvedIds || [])
);
export const selectCollectionHasItemsResolvedForId = createCachedSelector(
  selectCollectionIdsWithItemsResolvedSet,
  (state: State, id: string) => id,
  (resolvedIdsSet, id) => resolvedIdsSet.has(id)
)((state: State, id: string) => String(id));
export const selectUnpublishedCollectionsList = createSelector(
  selectMyUnpublishedCollections,
  (unpublishedCollections) => Object.keys(unpublishedCollections)
);
export const selectCollectionSavedForId = (state: State, id: string) =>
  Boolean(selectSavedCollectionIds(state)?.includes(id));
export const selectSavedCollections = createSelector(
  selectResolvedCollectionsById,
  selectSavedCollectionIds,
  (resolvedCollectionsById, savedIds) => {
    const savedCollections = {};
    savedIds.forEach((savedId) => {
      const savedCollectionClaim = resolvedCollectionsById[savedId];
      if (savedCollectionClaim) savedCollections[savedId] = savedCollectionClaim;
    });
    return savedCollections;
  }
);
export const selectHasLocalCollections = createSelector(
  selectMyUnpublishedCollections,
  selectMyEditedCollections,
  selectSavedCollections,
  (unpublished, edited, saved) => {
    const unpublishedCollectionsList = Object.keys(unpublished || {}) as any;
    const editedList = Object.keys(edited || {}) as any;
    const savedList = Object.keys(saved || {}) as any;
    return unpublishedCollectionsList.length > 0 || editedList.length > 0 || savedList.length > 0;
  }
);
export const selectHasCollections = (state: State) => {
  const hasLocalCollections = selectHasLocalCollections(state);
  const publishedCollectionIds = selectMyCollectionClaimIds(state);
  return hasLocalCollections || (publishedCollectionIds && publishedCollectionIds.length > 0);
};
export const selectEditedCollectionForId = (state: State, id: string) => selectMyEditedCollections(state)[id];
export const selectCollectionHasEditsForId = (state: State, id: string) =>
  Boolean(selectEditedCollectionForId(state, id));
export const selectUnsavedChangesCollectionForId = (state: State, id: string) => {
  const unSavedCollections = selectMyCollectionsWithUnSavedChanges(state);
  return unSavedCollections ? unSavedCollections[id] : null;
};
export const selectCollectionHasUnsavedEditsForId = (state: State, id: string) =>
  Boolean(selectUnsavedChangesCollectionForId(state, id));
export const selectUpdatedCollectionForId = (state: State, id: string) => {
  const editedCollections = selectMyEditedCollections(state);
  if (editedCollections[id]) return editedCollections[id];
  const updatedCollections = selectMyUpdatedCollections(state);
  return updatedCollections[id];
};
export const selectCollectionTitleForId = (state: State, id: string) => {
  const collection = selectCollectionForId(state, id);
  return (collection && (collection.title || collection.name)) || '';
};
export const selectCollectionDescriptionForId = (state: State, id: string) => {
  const collection = selectCollectionForId(state, id);
  return collection?.description;
};
export const selectCollectionVisibilityForId = (state: State, id: string): PlaylistVisibility => {
  const collection = selectCollectionForId(state, id);
  return collection?.visibility || collection?.hyperbeam?.visibility || 'private';
};
export const selectResolvedCollectionForId = (state: State, id: string) => selectResolvedCollectionsById(state)[id];
export const selectUnpublishedCollectionForId = (state: State, id: string) => selectMyUnpublishedCollections(state)[id];
export const selectCollectionIsMine = (state: State, id: string) => {
  // Check if it's a locally-created (unpublished) collection
  const unpublished = selectUnpublishedCollectionForId(state, id);
  if (unpublished) return true;
  if (COLLECTIONS_CONSTS.BUILTIN_PLAYLISTS.includes(id)) return true;
  // Check if it's a published collection owned by the user
  const publicIds = selectMyCollectionClaimIds(state);
  if (publicIds && publicIds.includes(id)) return true;
  return selectClaimIsMineForId(state, id);
};
export const selectMyPublishedCollections = createSelector(
  selectMyCollectionClaimsById,
  selectMyEditedCollections,
  selectMyUpdatedCollections,
  (myCollections, edited, updated) => {
    const myPublishedCollections = Object.assign({}, myCollections);
    // now add in edited:
    Object.entries(edited).forEach(([id, item]) => {
      if (!updated[id]) {
        myPublishedCollections[id] = item;
      } else {
        myPublishedCollections[id] = { ...myPublishedCollections[id], updatedAt: (item as any).updatedAt };
      }
    });
    return myPublishedCollections;
  }
);
// returns published collections + local edits or update timestamps
export const selectMyPublicLocalCollections = createSelector(
  selectMyPublishedCollections,
  selectMyEditedCollections,
  selectMyUpdatedCollections,
  (myCollectionsById, edited, updated) => {
    if (!myCollectionsById) return myCollectionsById;
    const myPublicLocalCollections = {};

    for (const id in myCollectionsById) {
      const collection = myCollectionsById[id];
      const updatedCollection = updated[id];
      const editedCollection = edited[id];
      myPublicLocalCollections[id] = Object.assign({}, collection);

      if (updatedCollection) {
        Object.assign(myPublicLocalCollections[id], updatedCollection);
      } else if (editedCollection) {
        Object.assign(myPublicLocalCollections[id], editedCollection);
      }
    }

    return myPublicLocalCollections;
  }
);
export const selectAreCollectionItemsFetchingForId = (state: State, id: string) =>
  selectCollectionItemsFetchingIds(state).includes(id);
export const selectCollectionsById = createSelector(
  selectBuiltinCollections,
  selectResolvedCollectionsById,
  selectMyUnpublishedCollections,
  selectMyEditedCollections,
  selectQueueCollection,
  selectMyCollectionsWithUnSavedChanges,
  (builtin, resolved, unpublished, edited, queue, unsaved) => ({
    queue,
    ...resolved,
    ...edited,
    ...unpublished,
    ...builtin,
    ...unsaved,
  })
);
export const selectCollectionForId = createSelector(
  (state, id) => id,
  selectCollectionsById,
  (id, collectionsById) => {
    if (!id) return id;
    return collectionsById[id];
  }
);
export const selectIsCollectionBuiltInForId = (state: State, id: string) => selectBuiltinCollections(state)[id];
export const selectClaimSavedForUrl = createSelector(
  (state, url) => url,
  (state, url) => selectClaimForUri(state, url),
  selectBuiltinCollections,
  selectMyPublicLocalCollections,
  selectMyUnpublishedCollections,
  selectMyEditedCollections,
  (url, claim, bLists, myRLists, uLists, eLists) => {
    const collections = [bLists, uLists, eLists, myRLists];
    const claimId = url.match(/[a-f0-9]{40}/)?.[0];
    const locator = getClaimOutpoint(claim);
    return collections.some((list) =>
      Object.values(list).some(({ items }) =>
        items?.some((item) => item === url || item === claimId || item === locator)
      )
    );
  }
);
export const selectClaimInCollectionsForUrl = (state: State, url: string) => {
  const queue = selectQueueCollection(state);
  const claimInQueue = queue.items.some((item) => item === url);
  const claimSaved = selectClaimSavedForUrl(state, url);
  return claimSaved && claimInQueue;
};
export const makeSelectClaimMenuCollectionsForUrl = () =>
  createSelector(
    [
      selectLastUsedCollectionIds,
      selectCollectionsById,
      selectBuiltinCollections,
      selectMyUnpublishedCollections,
      selectMyEditedCollections,
      selectMyCollectionClaimIds,
      (state, url) => url,
      (state, url) => selectClaimForUri(state, url),
    ],
    (
      lastUsedCollectionIds,
      collectionsById,
      builtinCollections,
      unpublishedCollections,
      editedCollections,
      myPublishedIds,
      url,
      claim
    ) => {
      const claimId = url.match(/[a-f0-9]{40}/)?.[0];
      const locator = getClaimOutpoint(claim);
      const includesClaim = (items: Array<string> | undefined) =>
        items?.some((item) => item === url || item === claimId || item === locator);
      // Determine which collection IDs belong to the user
      const builtinIds = Object.keys(builtinCollections || {});
      const unpublishedIds = Object.keys(unpublishedCollections || {});
      const editedIds = Object.keys(editedCollections || {});
      const myCollectionIds = new Set([...builtinIds, ...unpublishedIds, ...editedIds, ...(myPublishedIds || [])]);
      const lastUsedCollections = lastUsedCollectionIds
        .filter((id) => myCollectionIds.has(id)) // Only include my collections
        .map((id) => {
          const collection = collectionsById[id];
          return collection
            ? {
                ...collection,
                hasClaim: includesClaim(collection.items),
              }
            : null;
        })
        .filter(Boolean);
      const collectionsContainingClaim = Object.entries(collectionsById)
        .filter(
          ([id, collection]: [string, any]) =>
            myCollectionIds.has(id) && // Only include my collections
            includesClaim(collection.items) &&
            !lastUsedCollections.some((lastUsedCollection: any) => lastUsedCollection.id === collection.id)
        )
        .map(([id, collection]: [string, any]) => ({ ...collection, hasClaim: true }));
      const claimMenuCollections = lastUsedCollections.concat(collectionsContainingClaim);
      return claimMenuCollections;
    }
  );
export const selectCollectionForIdHasClaimUrl = (state: State, id: string, uri: string) =>
  Boolean(selectCollectionForIdClaimForUriItem(state, id, uri));
export const selectItemsForCollectionId = createCachedSelector(
  (state: State, id: string) => {
    const collection = selectCollectionForId(state, id);
    return collection?.items;
  },
  // -- sanitize -- > in case non-urls got added into a collection: only select string types
  // to avoid general app errors trying to use its uri
  (items) => items && items.filter((item) => typeof item === 'string')
)((state, id) => String(id));
export const selectBrokenUrlsForCollectionId = createCachedSelector(
  (state: State, id: string) => {
    const collection = selectCollectionForId(state, id);
    return collection?.items;
  },
  // Allows removing non-standard uris from a collection
  (items) => items && items.filter((item) => typeof item !== 'string')
)((state, id) => String(id));
export const selectFirstItemUrlForCollection = (state: State, id: string) => {
  const items = selectItemsForCollectionId(state, id);
  const firstItem = items && items[0];
  if (!firstItem) return null;
  if (isPermanentUrl(firstItem) || isCanonicalUrl(firstItem)) return firstItem;
  const claim = selectClaimForClaimId(state, firstItem) || selectClaimsByImmutableLocator(state)[firstItem];
  return claim ? claim.permanent_url || claim.canonical_url || null : null;
};
export const selectCollectionLengthForId = (state: State, id: string) => {
  const urls = selectItemsForCollectionId(state, id);
  return urls?.length || 0;
};
export const selectCollectionIsEmptyForId = (state: State, id: string) => {
  const length = selectCollectionLengthForId(state, id);
  return length === 0;
};
export const selectAreBuiltinCollectionsEmpty = (state: State) => {
  const notEmpty = COLLECTIONS_CONSTS.BUILTIN_PLAYLISTS.some((collectionKey) => {
    if (collectionKey !== COLLECTIONS_CONSTS.QUEUE_ID) {
      const length = selectCollectionLengthForId(state, collectionKey);
      return length > 0;
    }
  });
  return !notEmpty;
};
export const selectThumbnailForCollectionId = (state: State, id: string) => {
  const collection = selectCollectionForId(state, id);
  return collection && collection.thumbnail?.url;
};
export const selectUpdatedAtForCollectionId = createSelector(
  selectCollectionForId,
  selectUserCreationDate,
  selectUpdatedCollectionForId,
  (collection, userCreatedAt, updated) => {
    const isBuiltin = COLLECTIONS_CONSTS.BUILTIN_PLAYLISTS.includes(collection?.id);
    const collectionUpdatedAt = toMilliseconds(
      updated?.updatedAt || collection?.updatedAt || collection?.createdAt || 0
    );
    // Built-in lists don't have chain timestamps.
    if (!collectionUpdatedAt && isBuiltin) return toMilliseconds(userCreatedAt);
    if (!collectionUpdatedAt) return 0;
    return collectionUpdatedAt;
  }
);
export const selectCreatedAtForCollectionId = createSelector(
  selectCollectionForId,
  (state: State, id: string) => id,
  selectUserCreationDate,
  (collection, id, userCreatedAt) => {
    const isBuiltin = COLLECTIONS_CONSTS.BUILTIN_PLAYLISTS.includes(id);
    if (isBuiltin) return toMilliseconds(userCreatedAt);
    return toMilliseconds(collection?.createdAt || 0);
  }
);
export const selectCountForCollectionId = (state: State, id: string) =>
  getItemCountForCollection(selectCollectionForId(state, id));
// Has private === either is private or is public with private edits
export const selectHasPrivateCollectionForId = (state: State, id: string) => {
  const unpublishedCollection = selectUnpublishedCollectionForId(state, id);
  const resolvedCollection = selectResolvedCollectionForId(state, id);
  if (unpublishedCollection) return true;
  if (COLLECTIONS_CONSTS.BUILTIN_PLAYLISTS.includes(id)) return true;
  if (resolvedCollection?.visibility === 'private' || resolvedCollection?.hyperbeam?.visibility === 'private') {
    return true;
  }

  if (selectCollectionHasEditsForId(state, id) || selectCollectionHasUnsavedEditsForId(state, id)) return true;

  return false;
};
// Is private === only private (doesn't include public with private edits)
export const selectIsCollectionPrivateForId = (state: State, id: string) =>
  Boolean(
    selectUnpublishedCollectionForId(state, id) ||
    COLLECTIONS_CONSTS.BUILTIN_PLAYLISTS.includes(id) ||
    selectResolvedCollectionForId(state, id)?.visibility === 'private' ||
    selectResolvedCollectionForId(state, id)?.hyperbeam?.visibility === 'private'
  );
export const selectClaimIdsForCollectionId = createSelector(
  selectHasPrivateCollectionForId,
  selectItemsForCollectionId,
  selectClaimIdsByUri,
  selectClaimsById,
  (isPrivate, items, byUri, byId) => {
    if (!items || !isPrivate) return items;
    const ids = new Set<string | null>();
    const notFetched = items.some((item) => {
      if (validNativePlaylistItem(item)) {
        ids.add(item);
        return false;
      }
      const claimId = byUri[normalizeURI(item)];

      if (claimId === undefined) {
        return true;
      }

      if (claimId === null) {
        ids.add(null);
        return false;
      }

      const locator = getClaimOutpoint(byId[claimId]);
      ids.add(locator && validNativePlaylistItem(locator) ? locator : null);
    });
    if (notFetched) return undefined;
    return Array.from(ids);
  }
);
export const selectHasUnavailableClaimIdsForCollectionId = createSelector(
  selectClaimIdsForCollectionId,
  (claimIds) => claimIds && claimIds.includes(null)
);
export const selectCollectionSaveParamsForId = createCachedSelector(
  selectCollectionForId,
  selectCollectionTitleForId,
  selectClaimIdsForCollectionId,
  (collection, collectionTitle, collectionClaimIds) => {
    const claims = collectionClaimIds && collectionClaimIds.filter(Boolean);
    if (!collection) return undefined;
    return {
      name: collectionTitle,
      title: collectionTitle,
      description: collection.description,
      thumbnail_url: collection.thumbnail?.url,
      claims,
      tags: collection.tags || [],
      languages: collection.languages || [],
      visibility: collection.visibility || collection.hyperbeam?.visibility || 'private',
    };
  }
)((state: State, collectionId: string) => collectionId);
const _prevCollectionUrls = new Map<string, Array<string>>();
const selectClaimsByImmutableLocator = createSelector(selectClaimsById, (claimsById) => {
  const claimsByLocator: Record<string, Claim> = {};
  Object.values(claimsById || {}).forEach((claim: Claim | null | undefined) => {
    const locator = getClaimOutpoint(claim);
    if (locator) claimsByLocator[locator] = claim;
  });
  return claimsByLocator;
});
export const selectUrlsForCollectionId = createCachedSelector(
  (state, collectionId) => collectionId,
  (state, collectionId, itemCount) => itemCount,
  selectItemsForCollectionId,
  selectClaimsById,
  selectClaimsByImmutableLocator,
  (collectionId, itemCount, items, claimsById, claimsByLocator) => {
    if (!items) return items;
    const uris: string[] = [];
    let notFetched;
    items.forEach((item) => {
      if (isPermanentUrl(item) || isCanonicalUrl(item)) {
        uris.push(item);
      } else {
        const claim = claimsById[item] || claimsByLocator[item];

        if (claim) {
          const uri = claim.permanent_url || claim.canonical_url;
          if (uri) uris.push(uri);
        } else if (claim === undefined) {
          notFetched = true;
        }
        // claim === null → resolved as abandoned/deleted; skip so consumers never receive a raw claim ID as a URI.
      }
    });

    if (notFetched && (!Number.isInteger(itemCount) || itemCount > uris.length)) {
      return undefined;
    }

    const result = uris;
    const key = `${collectionId}:${itemCount}`;
    const prev = _prevCollectionUrls.get(key);
    if (prev && prev.length === result.length && prev.every((u, i) => u === result[i])) {
      return prev;
    }
    _prevCollectionUrls.set(key, result);
    return result;
  }
)((state, url, itemCount) => `${String(url)}:${String(itemCount)}`);
export const selectFirstPlayableUrlForCollectionId = createCachedSelector(
  selectUrlsForCollectionId,
  (state) => state,
  (uris, state) => (uris ? uris.find((uri) => selectCanPlaybackFileForUri(state, uri)) : undefined)
)((state, collectionId) => String(collectionId));
export const selectUrlsForCollectionIdNonDeleted = createCachedSelector(
  selectUrlsForCollectionId,
  (state, collectionId) => collectionId,
  (state) => state,
  (uris, collectionId, state) => {
    if (!uris) return uris;
    return uris.filter((uri) => {
      const claim = selectClaimForUri(state, uri, false);
      // Keep unresolved entries for now to avoid false negatives while claims are still loading.
      if (claim === undefined) return true;
      return claim !== null && claim.value_type !== 'deleted';
    });
  }
)((state, collectionId) => String(collectionId));
export const selectCountForCollectionIdNonDeleted = createCachedSelector(selectUrlsForCollectionIdNonDeleted, (uris) =>
  uris ? uris.length : uris
)((state, collectionId) => String(collectionId));
export const selectCollectionForIdClaimForUriItem = createCachedSelector(
  (state: State, id: string, uri: string) => uri,
  (state: State, id: string, uri: string) => selectClaimForUri(state, uri),
  (state: State, id: string) => selectUrlsForCollectionId(state, id),
  (state: State, id: string) => selectItemsForCollectionId(state, id),
  (uri, claim, collectionUrls, collectionItems) => {
    const items = collectionUrls || collectionItems;
    if (!items) return items;
    if (items.includes(uri)) return uri;
    if (!claim) return false;
    const permanentUri = claim.permanent_url;
    if (items.includes(permanentUri)) return permanentUri;
    const canonicalUri = claim.canonical_url;
    if (items.includes(canonicalUri)) return canonicalUri;
    const locator = getClaimOutpoint(claim);
    if (locator && items.includes(locator)) return locator;

    try {
      const { streamClaimId: claimId } = parseURI(uri);
      if (items.includes(claimId)) return claimId;
    } catch (error) {}

    return false;
  }
)((state, id, uri) => `${id}:${uri}`);
export const selectCollectionTypeForId = (state: State, id: string) => {
  const collection = selectCollectionForId(state, id);
  return collection?.type;
};
export const selectSourceIdForCollectionId = (state: State, id: string) => {
  const collection = selectCollectionForId(state, id);
  return collection && collection.sourceId;
};
export const selectCollectionKeyForId = (state: State, id: string) => {
  if (id === COLLECTIONS_CONSTS.QUEUE_ID) return COLLECTIONS_CONSTS.QUEUE_ID;
  if (selectUnpublishedCollectionForId(state, id)) return COLLECTIONS_CONSTS.KEYS.UNPUBLISHED;
  if (selectEditedCollectionForId(state, id)) return COLLECTIONS_CONSTS.KEYS.EDITED;
  if (COLLECTIONS_CONSTS.BUILTIN_PLAYLISTS.includes(id)) return COLLECTIONS_CONSTS.KEYS.BUILTIN;
  if (selectUpdatedCollectionForId(state, id)) return COLLECTIONS_CONSTS.KEYS.UPDATED;
  return undefined;
};
export const selectFirstPlayingCollectionIndexForId = (state: State, collectionId: string) => {
  const collectionIsPlaying = selectIsCollectionPlayingForId(state, collectionId);
  if (!collectionIsPlaying) return collectionIsPlaying;
  const playingCollectionShuffleUrls = selectCollectionForIdIsPlayingShuffle(state, collectionId);
  const collectionUrls = selectUrlsForCollectionId(state, collectionId);
  const urls = playingCollectionShuffleUrls || collectionUrls;
  return urls && urls[0];
};
export const selectIndexForUrlInCollectionForId = createCachedSelector(
  selectCollectionForIdClaimForUriItem,
  (state: State, id: string) => selectUrlsForCollectionId(state, id),
  (uriItem, collectionUrls) => {
    const index = collectionUrls && collectionUrls.findIndex((uri) => uri === uriItem);
    if (index > -1) return index;
    return null;
  }
)((state, id, uri) => `${id}:${uri}`);
export const selectIndexForUriInPlayingCollectionForId = createCachedSelector(
  selectCollectionForIdClaimForUriItem,
  (state: State, id: string) => selectUrlsForCollectionIdNonDeleted(state, id),
  selectCollectionForIdIsPlayingShuffle,
  (uriItem, collectionUrls, playingCollectionShuffleUrls) => {
    const uris = playingCollectionShuffleUrls
      ? playingCollectionShuffleUrls.filter((uri) => collectionUrls?.includes(uri))
      : collectionUrls;
    const index = uris && uris.findIndex((uri) => uri === uriItem);
    if (index > -1) return index;
    return null;
  }
)((state, id, uri) => `${id}:${uri}`);
export const selectIsLastCollectionItemForIdAndUri = (state: State, collectionId: string, uri: string) => {
  const index = selectIndexForUriInPlayingCollectionForId(state, collectionId, uri);
  const length = selectCountForCollectionIdNonDeleted(state, collectionId);
  return index === length - 1;
};
export const selectPreviousUriForUriInPlayingCollectionForId = createCachedSelector(
  selectUrlsForCollectionIdNonDeleted,
  selectIndexForUriInPlayingCollectionForId,
  selectCollectionForIdIsPlayingShuffle,
  selectCollectionForIdIsPlayingLoop,
  (collectionUrls, currentIndex, playingCollectionShuffleUrls, isLooped) => {
    if (currentIndex === null) return null;
    const uris = playingCollectionShuffleUrls
      ? playingCollectionShuffleUrls.filter((uri) => collectionUrls?.includes(uri))
      : collectionUrls;

    if (!uris?.length) return null;

    if (currentIndex === 0 && isLooped) {
      return uris[uris.length - 1];
    }

    return uris[currentIndex - 1];
  }
)((state, url, id) => `${String(url)}:${String(id)}`);
export const selectNextUriForUriInPlayingCollectionForId = createCachedSelector(
  selectUrlsForCollectionIdNonDeleted,
  selectIndexForUriInPlayingCollectionForId,
  selectCollectionForIdIsPlayingShuffle,
  selectCollectionForIdIsPlayingLoop,
  (collectionUrls, currentIndex, playingCollectionShuffleUrls, isLooped) => {
    if (currentIndex === null) return null;
    const uris = playingCollectionShuffleUrls
      ? playingCollectionShuffleUrls.filter((uri) => collectionUrls?.includes(uri))
      : collectionUrls;

    if (!uris?.length) return null;

    if (currentIndex === uris.length - 1 && isLooped) {
      return uris[0];
    }

    const nextListUri = uris[currentIndex + 1];
    if (nextListUri) return nextListUri;
    return null;
  }
)((state, url, id) => `${String(url)}:${String(id)}`);
