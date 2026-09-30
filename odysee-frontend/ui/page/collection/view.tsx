import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import React from 'react';
import CollectionItemsList from 'component/collectionItemsList';
import Page from 'component/page';
import * as PAGES from 'constants/pages';
import * as COLLECTIONS_CONSTS from 'constants/collections';
import { COLLECTION_PAGE } from 'constants/urlParams';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import CollectionEditForm from './internal/collectionPublishForm';
import CollectionHeader from './internal/collectionHeader';
import { PLAYLISTS_FIXED_BOTTOM_CLASS, PLAYLISTS_PAGE_CLASS } from '../playlists/classes';
import Spinner from 'component/spinner';
import Card from 'component/common/card';
import Button from 'component/button';
import Yrbl from 'component/yrbl';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectHasClaimForId, selectClaimForId, selectGeoRestrictionForUri } from 'redux/selectors/claims';
import {
  selectCollectionForId,
  selectBrokenUrlsForCollectionId,
  selectCollectionIsMine,
  selectHasPrivateCollectionForId,
  selectIsCollectionPrivateForId,
  selectCollectionHasItemsResolvedForId,
  selectCollectionHasUnsavedEditsForId,
} from 'redux/selectors/collections';
import { isHyperbeamSignedIn } from 'util/hyperbeamAccount';
import { EMPTY_CLASS } from 'component/common/empty-classes';
import { doResolveClaimId as doResolveClaimIdAction } from 'redux/actions/claims';
import {
  doCollectionEdit as doCollectionEditAction,
  doFetchItemsInCollection as doFetchItemsInCollectionAction,
  doRemoveFromUnsavedChangesCollectionsForCollectionId as doRemoveUnsavedAction,
} from 'redux/actions/collections';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { TAB_PANEL_CLASS } from 'component/common/tabs-classes';

type Props = {
  collectionId?: string;
};
const CollectionPage = (props: Props) => {
  const dispatch = useAppDispatch();
  const { collectionId: routeCollectionId = '' } = useParams();
  const collectionId = props.collectionId || routeCollectionId;
  const claim = useAppSelector((state) => selectClaimForId(state, collectionId));
  const geoRestriction = useAppSelector((state) => selectGeoRestrictionForUri(state, claim?.permanent_url));
  const hasClaim = useAppSelector((state) => selectHasClaimForId(state, collectionId));
  const collection = useAppSelector((state) => selectCollectionForId(state, collectionId));
  const brokenUrls = useAppSelector((state) => selectBrokenUrlsForCollectionId(state, collectionId));
  const isCollectionMine = useAppSelector((state) => selectCollectionIsMine(state, collectionId));
  const hasPrivate = useAppSelector((state) => selectHasPrivateCollectionForId(state, collectionId));
  const isPrivate = useAppSelector((state) => selectIsCollectionPrivateForId(state, collectionId));
  const collectionHasItemsResolved = useAppSelector((state) =>
    selectCollectionHasItemsResolvedForId(state, collectionId)
  );
  const collectionHasUnsavedEdits = useAppSelector((state) =>
    selectCollectionHasUnsavedEditsForId(state, collectionId)
  );
  const isAuthenticated = isHyperbeamSignedIn();
  const navigate = useNavigate();
  const { search, state, pathname } = useLocation();
  const isEmbedPath = pathname && pathname.startsWith('/$/embed');
  const { showEdit: pageShowEdit } = state || {};
  const [showEdit, setShowEdit] = React.useState(pageShowEdit);
  const [saving, setSaving] = React.useState(false);
  const [unavailableUris, setUnavailable] = React.useState(brokenUrls || []);
  const { name } = collection || {};
  const urlParams = new URLSearchParams(search);
  const editing = urlParams.get(COLLECTION_PAGE.QUERIES.VIEW) === COLLECTION_PAGE.VIEWS.EDIT;
  const [forceCollectionView, setForceCollectionView] = React.useState(false);
  const editPage = editing && !forceCollectionView;
  const isBuiltin = COLLECTIONS_CONSTS.BUILTIN_PLAYLISTS.includes(collectionId);
  const isResolvingCollection = hasClaim === undefined;
  const shouldPromptSignIn = IS_WEB && editPage && !isAuthenticated;
  const collectionHasStoredItems = Boolean(collection?.items?.length);
  const shouldResolveCollectionItems = collectionHasStoredItems && !collectionHasItemsResolved;

  React.useEffect(() => {
    if (editing) {
      setForceCollectionView(false);
    }
  }, [editing]);

  async function saveChanges() {
    if (!collectionHasUnsavedEdits && !shouldResolveCollectionItems) {
      return;
    }

    if (shouldResolveCollectionItems) {
      dispatch(doFetchItemsInCollectionAction({ collectionId }));
      return;
    }

    setSaving(true);
    try {
      const saved = await dispatch(
        doCollectionEditAction(collectionId, {
          isPreview: false,
        })
      );
      if (saved) {
        dispatch(doRemoveUnsavedAction(collectionId));
        setShowEdit(false);
        if (saved.claim_id && saved.claim_id !== collectionId) {
          navigate(`/$/${PAGES.PLAYLIST}/${saved.claim_id}`, { replace: true });
        }
      }
    } catch {
      return;
    } finally {
      setSaving(false);
    }
  }

  function clearChanges() {
    dispatch(doRemoveUnsavedAction(collectionId));
    setShowEdit(false);
  }

  React.useEffect(() => {
    if (!isPrivate) {
      dispatch(
        doResolveClaimIdAction(collectionId, true, {
          include_is_my_output: true,
        })
      );
    }
  }, [collectionId, dispatch, isPrivate]);

  React.useEffect(() => {
    if (shouldResolveCollectionItems) {
      dispatch(doFetchItemsInCollectionAction({ collectionId }));
    }
  }, [collectionId, dispatch, shouldResolveCollectionItems]);

  if (claim?.hyperbeam?.deleted) {
    return (
      <Page noSideNavigation={isEmbedPath}>
        <div className={PAGE_MAIN_EMPTY_CLASS}>
          <h1>{__('Playlist deleted')}</h1>
          <p>{__('This playlist was deleted by its owner. Previously shared snapshots may still be available.')}</p>
        </div>
      </Page>
    );
  }

  if (geoRestriction) {
    return (
      <Page noSideNavigation={isEmbedPath}>
        <div className={PAGE_MAIN_EMPTY_CLASS}>
          <Yrbl
            title={__('Content unavailable')}
            subtitle={geoRestriction.message ? __(geoRestriction.message) : ''}
            type="sad"
            alwaysShow
          />
        </div>
      </Page>
    );
  }

  if (shouldPromptSignIn) {
    const redirect = encodeURIComponent(`${pathname}${search}`);
    return <Navigate replace to={`/$/${PAGES.AUTH_SIGNIN}?redirect=${redirect}`} />;
  }

  if (!hasPrivate && isResolvingCollection) {
    return (
      <div className={PAGE_MAIN_EMPTY_CLASS}>
        <Spinner />
      </div>
    );
  }

  if (!collection && !isResolvingCollection) {
    return (
      <Page noSideNavigation={isEmbedPath}>
        <div className={`${PAGE_MAIN_EMPTY_CLASS} ${EMPTY_CLASS}`}>{__('Nothing here')}</div>
      </Page>
    );
  }

  if (editPage && !isBuiltin && isCollectionMine) {
    const getPagePath = (id) => `/$/${PAGES.PLAYLIST}/${id}`;

    const doReturnForId = (id) => {
      setForceCollectionView(true);
      navigate(getPagePath(id), { replace: true });
    };
    const closeEditView = () => {
      dispatch(doRemoveUnsavedAction(collectionId));
      window.location.assign(getPagePath(collectionId));
    };

    return (
      <Page
        noFooter
        noSideNavigation
        backout={{
          backNavDefault: `/$/${PAGES.PLAYLIST}/${collectionId}`,
          onBack: closeEditView,
          title: __('Editing') + ' ' + name,
        }}
      >
        <CollectionEditForm collectionId={collectionId} onDoneForId={doReturnForId} useIds />
      </Page>
    );
  }

  return (
    <Page className={PLAYLISTS_PAGE_CLASS} noSideNavigation={isEmbedPath}>
      <div className="section card-stack">
        <CollectionHeader
          collection={collection}
          showEdit={showEdit}
          setShowEdit={setShowEdit}
          unavailableUris={unavailableUris}
          setUnavailable={setUnavailable}
        />

        <CollectionItemsList
          collectionId={collectionId}
          showEdit={showEdit}
          isEditPreview
          unavailableUris={unavailableUris}
          showNullPlaceholder
        />
      </div>
      {showEdit && (
        <div className={PLAYLISTS_FIXED_BOTTOM_CLASS}>
          <Card
            className={`card--after-tabs ${TAB_PANEL_CLASS}`}
            actions={
              <>
                <div className={SECTION_CLASSES.actions}>
                  <Button
                    button="primary"
                    label={shouldResolveCollectionItems ? __('Loading') : saving ? __('Saving...') : __('Save')}
                    onClick={saveChanges}
                    disabled={saving || shouldResolveCollectionItems || !collectionHasUnsavedEdits}
                  />
                  <Button button="link" label={__('Cancel')} onClick={clearChanges} />
                </div>
              </>
            }
          />
        </div>
      )}
    </Page>
  );
};

export default CollectionPage;
