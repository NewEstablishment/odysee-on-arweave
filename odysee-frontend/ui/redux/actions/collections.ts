import * as ACTIONS from 'constants/action_types';
import { batchActions } from 'util/batch-actions';
import { v4 as uuid } from 'uuid';
import { doResolveUris, doResolveClaimId, doResolveClaimIds } from 'redux/actions/claims';
import {
  selectClaimForClaimId,
  selectClaimForId,
  makeSelectMetadataItemForUri,
  selectHasClaimForId,
  selectResolvingIds,
  selectResolvingUris,
  selectClaimForUri,
  selectClaimsById,
} from 'redux/selectors/claims';
import {
  selectCollectionForId,
  selectResolvedCollectionForId,
  selectCollectionHasItemsResolvedForId,
  selectHasPrivateCollectionForId,
  selectIsCollectionPrivateForId,
  selectUrlsForCollectionId,
  selectCollectionSavedForId,
  selectAreCollectionItemsFetchingForId,
  selectCollectionKeyForId,
  selectCollectionForIdClaimForUriItem,
  selectAreThumbnailClaimsFetchingForCollectionIds,
  selectCollectionSaveParamsForId,
} from 'redux/selectors/collections';
import * as COLS from 'constants/collections';
import { resolveAuxParams, resolveCollectionType, getClaimIdsInCollectionClaim } from 'util/collections';
import { getClaimOutpoint, getThumbnailFromClaim } from 'util/claim';
import { doToast } from 'redux/actions/notifications';
import { fetchHyperbeamPlaylistListMine, fetchHyperbeamPlaylistSave } from 'util/hyperbeam';
const FETCH_BATCH_SIZE = 50;
const nativePlaylistSaveQueues = new Map<string, Promise<Claim | null>>();
const nativePlaylistReferenceAliases = new Map<string, string>();
const nativePlaylistSaveRevisions = new Map<string, number>();
export const doFetchCollectionListMine =
  (
    options: CollectionListOptions = {
      resolve: true,
      page: 1,
      page_size: 50,
    }
  ) =>
  async (dispatch: Dispatch) => {
    dispatch({
      type: ACTIONS.COLLECTION_LIST_MINE_STARTED,
    });

    try {
      const firstPage = await fetchHyperbeamPlaylistListMine({ ...options, page: 1 });
      const remainingPages = await Promise.all(
        Array.from({ length: Math.max(0, firstPage.total_pages - 1) }, (_, index) =>
          fetchHyperbeamPlaylistListMine({ ...options, page: index + 2 })
        )
      );
      const result = {
        ...firstPage,
        items: firstPage.items.concat(remainingPages.flatMap((page) => page.items)),
      };
      dispatch(
        batchActions(
          {
            type: ACTIONS.FETCH_CLAIM_LIST_MINE_COMPLETED,
            data: { result },
          },
          { type: ACTIONS.COLLECTION_LIST_MINE_COMPLETE }
        )
      );
      return result;
    } catch (error) {
      dispatch({ type: ACTIONS.COLLECTION_LIST_MINE_COMPLETE });
      dispatch(doToast({ message: error?.message || __('Failed to load playlists.'), isError: true }));
      return null;
    }
  };
async function saveCollectionSnapshot(
  dispatch: Dispatch,
  getState: GetState,
  collectionId: string,
  revision: number,
  options: CollectionSaveParams,
  collection: Collection
): Promise<Claim> {
  const existingClaim = selectClaimForClaimId(
    getState(),
    nativePlaylistReferenceAliases.get(collectionId) || collectionId
  );
  const items = (options.claims || []).filter((item): item is string => typeof item === 'string' && Boolean(item));

  dispatch({
    type: ACTIONS.COLLECTION_SAVE_START,
    data: { collectionId },
  });

  try {
    const collectionClaim = await fetchHyperbeamPlaylistSave({
      title: options.title || collection.title || collection.name,
      description: typeof options.description === 'string' ? options.description : undefined,
      thumbnail_url: options.thumbnail_url,
      tags: (options.tags || []).map((tag: any) => (typeof tag === 'string' ? tag : tag.name)).filter(Boolean),
      languages: options.languages || [],
      items,
      visibility: options.visibility || collection.visibility || collection.hyperbeam?.visibility || 'private',
      reference_id: existingClaim?.hyperbeam?.reference_id || nativePlaylistReferenceAliases.get(collectionId),
    });
    const savedCollection = {
      ...collection,
      id: collectionClaim.claim_id,
      name: collectionClaim.value?.title || collection.name,
      title: collectionClaim.value?.title || collection.title || collection.name,
      description: collectionClaim.value?.description,
      thumbnail: collectionClaim.value?.thumbnail,
      tags: collectionClaim.value?.tags || [],
      items,
      itemCount: items.length,
      visibility:
        (collectionClaim as any).visibility ||
        (collectionClaim as any).hyperbeam?.visibility ||
        options.visibility ||
        'private',
      createdAt: collectionClaim.meta?.creation_timestamp,
      updatedAt: collectionClaim.timestamp,
    };
    nativePlaylistReferenceAliases.set(collectionId, collectionClaim.claim_id);

    if (nativePlaylistSaveRevisions.get(collectionId) === revision) {
      dispatch({
        type: ACTIONS.DELETE_ID_FROM_LOCAL_COLLECTIONS,
        data: collectionId,
      });
    }
    dispatch({
      type: ACTIONS.COLLECTION_EDIT,
      data: {
        collectionKey: COLS.KEYS.UPDATED,
        collection: {
          id: collectionClaim.claim_id,
          updatedAt: collectionClaim.timestamp,
        },
      },
    });
    dispatch({
      type: ACTIONS.COLLECTION_SAVE_SUCCESS,
      data: {
        collectionId,
        savedCollectionId: collectionClaim.claim_id,
      },
    });
    dispatch(
      batchActions(
        {
          type: ACTIONS.FETCH_CLAIM_LIST_MINE_COMPLETED,
          data: { result: { items: [collectionClaim], page: 1, page_size: 1, total_items: 1, total_pages: 1 } },
        },
        {
          type: ACTIONS.COLLECTION_ITEMS_RESOLVE_SUCCESS,
          data: {
            resolvedCollection: savedCollection,
          },
        },
        {
          type: ACTIONS.COLLECTION_CLAIM_ITEMS_RESOLVE_COMPLETE,
          data: savedCollection,
        }
      )
    );
    return collectionClaim;
  } catch (error) {
    dispatch({
      type: ACTIONS.COLLECTION_SAVE_FAIL,
      data: { collectionId, error: error?.message || error },
    });
    dispatch(doToast({ message: error?.message || error, isError: true }));
    throw error;
  }
}

export const doCollectionSave = (collectionId: string) => async (dispatch: Dispatch, getState: GetState) => {
  let state = getState();
  let collection = selectCollectionForId(state, collectionId);
  if (!collection) throw new Error('Playlist does not exist');

  let saveParams = selectCollectionSaveParamsForId(state, collectionId);
  if (saveParams?.claims === undefined && collection.items?.length) {
    await dispatch(doFetchItemsInCollection({ collectionId }));
    state = getState();
    collection = selectCollectionForId(state, collectionId);
    saveParams = selectCollectionSaveParamsForId(state, collectionId);
  }
  if (!collection || !saveParams || !Array.isArray(saveParams.claims)) {
    const error = new Error('Playlist items could not be resolved for saving');
    dispatch({
      type: ACTIONS.COLLECTION_SAVE_FAIL,
      data: { collectionId, error: error.message },
    });
    dispatch(doToast({ message: error.message, isError: true }));
    throw error;
  }

  const revision = (nativePlaylistSaveRevisions.get(collectionId) || 0) + 1;
  nativePlaylistSaveRevisions.set(collectionId, revision);
  const previousSave = nativePlaylistSaveQueues.get(collectionId) || Promise.resolve(null);
  const queuedSave = previousSave
    .catch(() => null)
    .then(() => saveCollectionSnapshot(dispatch, getState, collectionId, revision, saveParams, collection));
  nativePlaylistSaveQueues.set(collectionId, queuedSave);

  try {
    return await queuedSave;
  } finally {
    if (nativePlaylistSaveQueues.get(collectionId) === queuedSave) nativePlaylistSaveQueues.delete(collectionId);
  }
};

export const doRetryCollectionSave = (collectionId: string) => (dispatch: Dispatch) =>
  dispatch(doCollectionSave(collectionId)).catch(() => Promise.resolve());
export const doLocalCollectionCreate =
  (params: CollectionLocalCreateParams, cb?: (id: any) => void) => async (dispatch: Dispatch, getState: GetState) => {
    const { items, sourceId } = params;
    const id = uuid();

    if (sourceId) {
      const state = getState();
      const sourceCollectionItems = selectUrlsForCollectionId(state, sourceId);
      const sourceCollection = selectCollectionForId(state, sourceId);
      const sourceCollectionClaim = selectClaimForId(state, sourceId);
      const sourceDescription =
        sourceCollection.description ||
        makeSelectMetadataItemForUri(sourceCollectionClaim?.canonical_url, 'description')(state);
      const thumbnailUrl = sourceCollection.thumbnail?.url || getThumbnailFromClaim(sourceCollectionClaim);
      dispatch({
        type: ACTIONS.COLLECTION_NEW,
        data: {
          entry: {
            ...params,
            id: id,
            items: sourceCollectionItems,
            itemCount: sourceCollectionItems.length,
            description: sourceDescription,
            ...(thumbnailUrl && {
              thumbnail: {
                url: thumbnailUrl,
              },
            }),
          },
        },
      });
    } else {
      dispatch({
        type: ACTIONS.COLLECTION_NEW,
        data: {
          entry: {
            id: id,
            items: items || [],
            ...params,
          },
        },
      });
    }

    const saved = await dispatch(doCollectionSave(id));
    const savedId = saved.claim_id;
    if (cb) cb(savedId);
    return savedId;
  };
export const doCollectionDelete =
  (collectionId: string, collectionKey: string | null | undefined = undefined) =>
  async (dispatch: Dispatch, getState: GetState) => {
    const state = getState();
    const claim = selectClaimForClaimId(state, collectionId);

    if (claim) {
      throw new Error('Saved playlists are immutable and cannot be deleted yet.');
    }
    if (collectionKey) {
      dispatch({
        type: ACTIONS.COLLECTION_DELETE,
        data: { id: collectionId, collectionKey },
      });
    }
    dispatch({
      type: ACTIONS.DELETE_ID_FROM_LOCAL_COLLECTIONS,
      data: collectionId,
    });
  };
export const doToggleCollectionSavedForId = (collectionId: string) => (dispatch: Dispatch, getState: GetState) => {
  const state = getState();
  const isSaved = selectCollectionSavedForId(state, collectionId);
  dispatch(
    doToast({
      message: !isSaved ? __('Added to saved Playlists!') : __('Removed from saved Playlists.'),
    })
  );
  dispatch({
    type: ACTIONS.COLLECTION_TOGGLE_SAVE,
    data: collectionId,
  });
};

const mergeBatches = (arrayOfResults: Array<any>) => {
  let resultItems = [];
  arrayOfResults.forEach((result: any) => {
    const claims = result.items || Object.values(result).map((item: any) => item.stream || item);
    resultItems = resultItems.concat(claims);
  });
  return resultItems;
};

const doFetchCollectionItems =
  (items: Array<any>, pageSize?: number) => async (dispatch: Dispatch, getState: GetState) => {
    const sortResults = (resultItems: Array<Claim>) => {
      const newItems: Array<Claim> = [];
      items.forEach((item) => {
        const index = resultItems.findIndex((i) =>
          [i.canonical_url, i.permanent_url, i.claim_id, getClaimOutpoint(i)].includes(item)
        );
        if (index >= 0) newItems.push(resultItems[index]);
      });
      return newItems;
    };

    try {
      const batchSize = pageSize || FETCH_BATCH_SIZE;
      const totalItems = items.length;

      // Build batch descriptors without dispatching yet
      const batches: Array<{ uris: string[]; ids: string[] }> = [];
      for (let i = 0; i < Math.ceil(totalItems / batchSize); i++) {
        const batchInitialIndex = i * batchSize;
        const batchLength = (i + 1) * batchSize;
        const batchItems = items.slice(batchInitialIndex, batchLength).filter(Boolean);
        const uris: string[] = [];
        const ids: string[] = [];
        batchItems.forEach((item) => {
          if (item.startsWith('lbry://')) {
            uris.push(item);
          } else {
            ids.push(item);
          }
        });
        batches.push({ uris, ids });
      }

      // Resolve batches sequentially to avoid flooding Redux with hundreds of
      // concurrent dispatches for large playlists (200+ items). Each batch
      // triggers RESOLVE_START/SUCCESS + membership/cost/viewcount cascades.
      const itemsInBatches = [];
      for (const batch of batches) {
        const results = await Promise.all([
          batch.uris.length > 0 ? dispatch(doResolveUris(batch.uris, true)) : null,
          batch.ids.length > 0 ? dispatch(doResolveClaimIds(batch.ids)) : null,
        ]);
        results.forEach((r) => r && itemsInBatches.push(r));
      }
      const resultItems = sortResults(mergeBatches(itemsInBatches.filter(Boolean)));
      // The resolve calls will NOT return items when they still are in a previous call's 'Processing' state.
      let itemsWereFetching = resultItems.length !== items.length;

      // Related to above. Collection with deleted items would never get "resolved: true" status.
      // Which is needed to avoid issues when editing list before all items are resolved. (Not resolved items get removed.)
      if (itemsWereFetching) {
        // Use fresh state after async batch resolution, not the stale pre-fetch state.
        const freshState = getState();
        const resolvingIds = selectResolvingIds(freshState);
        const resolvingUris = selectResolvingUris(freshState);
        const hasResolvingItems = items.some((item) => resolvingIds.includes(item) || resolvingUris.includes(item));

        if (!hasResolvingItems) {
          itemsWereFetching = false;
        }
      }

      if (resultItems && !itemsWereFetching) {
        return resultItems;
      } else {
        return null;
      }
    } catch (e) {
      return null;
    }
  };

export const doFetchItemsInCollection =
  (params: { collectionId: string; pageSize?: number }) => async (dispatch: Dispatch, getState: GetState) => {
    let state = getState();
    const { collectionId, pageSize } = params;
    const isAlreadyFetching = selectAreCollectionItemsFetchingForId(state, collectionId);
    if (isAlreadyFetching) return Promise.resolve();
    dispatch({
      type: ACTIONS.COLLECTION_ITEMS_RESOLVE_START,
      data: collectionId,
    });
    const isPrivate = selectHasPrivateCollectionForId(state, collectionId);
    const hasClaim = selectHasClaimForId(state, collectionId);

    // -- Resolve collections:
    if (!isPrivate && hasClaim === undefined) {
      await dispatch(
        doResolveClaimId(collectionId, true, {
          include_is_my_output: true,
        })
      ).finally(() => {
        // get the state after claimSearch
        state = getState();
      });
    }

    if (!isPrivate && hasClaim === null) {
      return dispatch({
        type: ACTIONS.COLLECTION_ITEMS_RESOLVE_FAIL,
        data: collectionId,
      });
    }

    let promisedCollectionItemsFetch, collectionItems;

    if (isPrivate) {
      const collection = selectCollectionForId(state, collectionId);

      if (collection.items.length > 0) {
        promisedCollectionItemsFetch = collection.items && dispatch(doFetchCollectionItems(collection.items, pageSize));
      } else {
        const collectionKey = selectCollectionKeyForId(state, collectionId);
        return dispatch({
          type: ACTIONS.COLLECTION_ITEMS_RESOLVE_SUCCESS,
          data: {
            resolvedCollection: { ...collection, items: [], itemCount: 0, key: collectionKey },
          },
        });
      }
    } else {
      const claim = selectClaimForClaimId(state, collectionId);
      const claimIds = getClaimIdsInCollectionClaim(claim);
      promisedCollectionItemsFetch = claimIds && dispatch(doFetchCollectionItems(claimIds, pageSize));
    }

    // -- Await results:
    if (promisedCollectionItemsFetch) {
      collectionItems = await promisedCollectionItemsFetch;
    }

    if (!collectionItems || collectionItems?.length === undefined) {
      return dispatch({
        type: ACTIONS.COLLECTION_ITEMS_RESOLVE_FAIL,
        data: collectionId,
      });
    }

    const collection = selectCollectionForId(state, collectionId);
    const collectionKey = selectCollectionKeyForId(state, collectionId);

    if (isPrivate) {
      const newItems = collectionItems.map((item) => item.permanent_url);
      const newPrivateCollection = { ...collection, items: newItems, key: collectionKey };
      return dispatch({
        type: ACTIONS.COLLECTION_ITEMS_RESOLVE_SUCCESS,
        data: {
          resolvedCollection: newPrivateCollection,
        },
      });
    } else {
      const claim = selectClaimForClaimId(state, collectionId);
      const { value } = claim;
      const { tags } = value || {};
      const claimIds = getClaimIdsInCollectionClaim(claim) || [];
      const valueTypes = new Set<string>();
      const streamTypes = new Set<string>();
      const newItems: Array<string> = [];

      const resolvedById: Record<string, any> = {};
      collectionItems.forEach((item: any) => {
        resolvedById[item.claim_id] = item;
        const locator = getClaimOutpoint(item);
        if (locator) resolvedById[locator] = item;
      });

      claimIds.forEach((claimId) => {
        const collectionItem = resolvedById[claimId];

        if (collectionItem) {
          newItems.push(claimId);
          valueTypes.add(collectionItem.value_type);
          if (collectionItem.value && collectionItem.value.stream_type) {
            streamTypes.add(collectionItem.value.stream_type);
          }
        } else {
          // Preserve unavailable entries so they don't silently disappear from the playlist UI.
          newItems.push(claimId);
        }
      });
      const collectionType = resolveCollectionType(tags, valueTypes, streamTypes);
      const newStoreCollectionClaim = {
        ...collection,
        items: newItems,
        itemCount: newItems.length,
        type: collectionType,
        ...resolveAuxParams(collectionType, claim),
      };
      return dispatch(
        batchActions(
          {
            type: ACTIONS.COLLECTION_ITEMS_RESOLVE_SUCCESS,
            data: {
              resolvedCollection: newStoreCollectionClaim,
            },
          },
          {
            type: ACTIONS.COLLECTION_CLAIM_ITEMS_RESOLVE_COMPLETE,
            data: newStoreCollectionClaim,
          }
        )
      );
    }
  };
export const doFetchThumbnailClaimsForCollectionIds =
  (params: { collectionIds: Array<any>; pageSize?: number }) => async (dispatch: Dispatch, getState: GetState) => {
    let state = getState();
    const { collectionIds, pageSize } = params;
    const collectionIdsStr = collectionIds.toString();
    const isAlreadyFetching = selectAreThumbnailClaimsFetchingForCollectionIds(state, collectionIdsStr);
    if (isAlreadyFetching) return Promise.resolve();
    dispatch({
      type: ACTIONS.COLLECTION_THUMBNAIL_CLAIMS_RESOLVE_START,
      data: collectionIdsStr,
    });
    const allClaimIds = new Set<string>();
    collectionIds.forEach((collectionId) => {
      const collection = selectCollectionForId(state, collectionId);

      if (collection && collection.items) {
        const thumbnailClaims = collection.items.slice(0, 3);
        thumbnailClaims.forEach((claimId) => allClaimIds.add(claimId));
      }
    });
    return await dispatch(doFetchCollectionItems(Array.from(allClaimIds), pageSize)).finally(() =>
      dispatch({
        type: ACTIONS.COLLECTION_THUMBNAIL_CLAIMS_RESOLVE_COMPLETE,
        data: collectionIdsStr,
      })
    );
  };
export const doSortCollectionByKey =
  (collectionId: string, sortByKey: string, sortOrder: string) => async (dispatch: Dispatch, getState: GetState) => {
    let state = getState();
    let collection: Collection = selectCollectionForId(state, collectionId);

    if (!collection) return false;

    if (collection.items?.length && !selectCollectionHasItemsResolvedForId(state, collectionId)) {
      await dispatch(
        doFetchItemsInCollection({
          collectionId,
        })
      );
      state = getState();
      collection = selectCollectionForId(state, collectionId);
    }

    if (!collection?.items) return false;

    // Get claims or return the uri/claimId if not resolved
    const claimsById = selectClaimsById(state);
    const claimsByLocator = new Map<string, Claim>();
    Object.values(claimsById || {}).forEach((claim: Claim | null | undefined) => {
      const locator = getClaimOutpoint(claim);
      if (locator) claimsByLocator.set(locator, claim);
    });
    const claimEntries = collection.items.map((item) => {
      const claim = selectClaimForUri(state, item) || selectClaimForClaimId(state, item) || claimsByLocator.get(item);
      return {
        claim: claim || item,
        item,
      };
    });
    // Save unresolved uris
    const resolvedClaimEntries = claimEntries.filter(({ claim }) => claim && typeof claim !== 'string');
    const unresolvedItems = claimEntries
      .filter(({ claim }) => !claim || typeof claim === 'string')
      .map(({ item }) => item)
      .filter(Boolean);
    const sortedClaims = [...resolvedClaimEntries].sort(({ claim: a }, { claim: b }) => {
      if (sortByKey === COLS.SORT_KEYS.RELEASED_AT) {
        const keyA = a?.value?.release_time || a?.meta?.creation_timestamp || 0;
        const keyB = b?.value?.release_time || b?.meta?.creation_timestamp || 0;

        if (sortOrder === COLS.SORT_ORDER.ASC) {
          return keyB - keyA;
        } else if (sortOrder === COLS.SORT_ORDER.DESC) {
          return keyA - keyB;
        }
      }

      if (sortByKey === COLS.SORT_KEYS.NAME) {
        const keyA = a?.value?.title || a?.meta?.name || 'A';
        const keyB = b?.value?.title || b?.meta?.name || 'A';

        if (sortOrder === COLS.SORT_ORDER.ASC) {
          return keyB.localeCompare(keyA, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
        } else if (sortOrder === COLS.SORT_ORDER.DESC) {
          return keyA.localeCompare(keyB, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
        }
      }

      return 0;
    });
    let sortedUris = sortedClaims.map(({ claim }) => claim?.permanent_url || claim?.canonical_url || claim?.claim_id);
    sortedUris = sortedUris.concat(unresolvedItems);
    return dispatch({
      type: ACTIONS.COLLECTION_EDIT,
      data: {
        collectionKey: COLS.KEYS.UNSAVED_CHANGES,
        collection: { ...collection, items: sortedUris, itemCount: sortedUris.length },
      },
    });
  };
export const doCollectionEdit =
  (collectionId: string, params: CollectionEditParams) => async (dispatch: Dispatch, getState: GetState) => {
    let state = getState();
    let collection: Collection = selectCollectionForId(state, collectionId);

    if (!collection) {
      dispatch(
        doToast({
          message: __('Collection does not exist.'),
          isError: true,
        })
      );
      return false;
    }

    const isPublic = Boolean(selectResolvedCollectionForId(state, collectionId));
    const isPrivateVersion = selectHasPrivateCollectionForId(state, collectionId);
    const { uris, remove, replace, order, type, isPreview } = params;
    let hasItemsResolved = selectCollectionHasItemsResolvedForId(state, collectionId);
    const collectionHasStoredItems = Boolean(collection.items && collection.items.length);
    const changesNeedExistingItems = !uris && !remove && !replace && !order;
    const shouldResolveExistingItems =
      collectionHasStoredItems && !hasItemsResolved && (!isPrivateVersion || changesNeedExistingItems);

    if (shouldResolveExistingItems) {
      await dispatch(
        doFetchItemsInCollection({
          collectionId,
        })
      );
      state = getState();
      collection = selectCollectionForId(state, collectionId);
      hasItemsResolved = selectCollectionHasItemsResolvedForId(state, collectionId);
    }

    if (shouldResolveExistingItems && !hasItemsResolved) {
      dispatch(
        doToast({
          message: __('Failed to resolve collection items. Please try again.'),
          isError: true,
        })
      );
      return false;
    }

    let collectionUrls = selectUrlsForCollectionId(state, collectionId);

    if (!collectionUrls && collection && collection.items && collection.items.length) {
      await dispatch(
        doFetchItemsInCollection({
          collectionId,
        })
      );
      state = getState();
      collection = selectCollectionForId(state, collectionId);
      collectionUrls = selectUrlsForCollectionId(state, collectionId);
    }

    const fallbackItems =
      collection && collection.items ? collection.items.filter((item) => typeof item === 'string') : [];
    const currentUrls = (collectionUrls || fallbackItems).concat();
    const currentUrlsSet = new Set(currentUrls);
    let newItems = currentUrls;

    // Passed uris to add/remove:
    if (uris) {
      if (replace) {
        newItems = uris;
      } else if (remove) {
        const urisToFilter = uris.map((uri) => selectCollectionForIdClaimForUriItem(state, collectionId, uri));
        // Filters (removes) the passed uris from the current list items
        newItems = currentUrls.filter((uri) => uri && (!uris || !urisToFilter.includes(uri)));
      } else {
        // Pushes (adds to the end) the passed uris to the current list items
        // (only if item not already in currentUrls, avoid duplicates)
        uris.forEach((url) => !currentUrlsSet.has(url) && newItems.push(url));
      }
    } else if (remove) {
      // no uris and remove === true: clear the list
      newItems = [];
    }

    // Passed an ordering to change: (doesn't need the uris here since
    // the items are already on the list)
    if (order) {
      const reorderItems = newItems.concat();
      const [movedItem] = reorderItems.splice(order.from, 1);
      reorderItems.splice(order.to, 0, movedItem);
      newItems = reorderItems;
    }

    const isQueue = collectionId === COLS.QUEUE_ID;
    const title = params.title || params.name;
    dispatch({
      // -- queue specific action prevents attempting to sync settings and throwing errors on unauth users
      type: isQueue ? ACTIONS.QUEUE_EDIT : ACTIONS.COLLECTION_EDIT,
      data: {
        collectionKey: isPreview
          ? COLS.KEYS.UNSAVED_CHANGES
          : isPublic
            ? COLS.KEYS.EDITED
            : selectCollectionKeyForId(state, collectionId),
        collection: {
          ...collection,
          items: newItems,
          itemCount: newItems.length,
          // this means pass description even if undefined or null, but not if it's not passed at all, so it can be deleted
          ...('description' in params
            ? {
                description: params.description,
              }
            : {}),
          ...('tags' in params
            ? {
                tags: params.tags,
              }
            : {}),
          ...(title
            ? {
                name: title,
                title,
              }
            : {}),
          ...(type
            ? {
                type,
              }
            : {}),
          ...('visibility' in params
            ? {
                visibility: params.visibility,
              }
            : {}),
          ...(params.thumbnail_url
            ? {
                thumbnail: {
                  url: params.thumbnail_url,
                },
              }
            : {}),
        },
      },
    });

    if (isPreview || COLS.BUILTIN_PLAYLISTS.includes(collectionId)) return true;
    return dispatch(doCollectionSave(collectionId));
  };
export const doRemoveFromUnsavedChangesCollectionsForCollectionId = (id: string) => (dispatch: Dispatch) => {
  dispatch({
    type: ACTIONS.COLLECTION_DELETE,
    data: {
      id,
      collectionKey: 'unsavedChanges',
    },
  });
};
export const doClearQueueList = () => (dispatch: Dispatch, getState: GetState) =>
  dispatch({
    type: ACTIONS.QUEUE_CLEAR,
  });
