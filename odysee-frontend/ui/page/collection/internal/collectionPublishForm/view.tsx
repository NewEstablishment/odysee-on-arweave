import React from 'react';
import classnames from 'classnames';
import * as PAGES from 'constants/pages';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'component/common/tabs';
import { Form, Submit, FormErrors } from 'component/common/form';
import { COLLECTION_PAGE } from 'constants/urlParams';
import Button from 'component/button';
// import CollectionDeleteButton from 'component/collectionDeleteButton';
import SortButton from '../../internal/collectionActions/internal/sortButton';
import CollectionItemsList from 'component/collectionItemsList';
import Spinner from 'component/spinner';
import BusyIndicator from 'component/common/busy-indicator';
import CollectionGeneralTab from './internal/collectionGeneralTab';
import withCollectionItems from 'hocs/withCollectionItems';
import ErrorBubble from 'component/common/error-bubble';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import {
  selectCollectionForId,
  selectCollectionSaveParamsForId,
  selectCollectionHasEditsForId,
  selectHasUnavailableClaimIdsForCollectionId,
  selectCollectionHasUnsavedEditsForId,
} from 'redux/selectors/collections';
import { doCollectionEdit, doRemoveFromUnsavedChangesCollectionsForCollectionId } from 'redux/actions/collections';
import { doOpenModal } from 'redux/actions/app';
import * as MODALS from 'constants/modal_types';
import './style.scss';
export const PAGE_TAB_QUERY = `tab`;
const TAB = {
  GENERAL: 0,
  ITEMS: 1,
};

function getTabIndexFromSearch(search: string) {
  const urlParams = new URLSearchParams(search);
  return urlParams.get(COLLECTION_PAGE.QUERIES.TAB) === COLLECTION_PAGE.TABS.ITEMS ? TAB.ITEMS : TAB.GENERAL;
}

function areArraysEqual(left: Array<any> = [], right: Array<any> = []) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

type Props = {
  collectionId: string;
  onDoneForId?: (arg0: any) => any;
  useIds?: boolean;
  collectionHasItemsResolved?: boolean;
};
const CollectionEditForm = (props: Props) => {
  const { collectionId, onDoneForId, collectionHasItemsResolved } = props;
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { search } = useLocation();
  const collectionParams = useAppSelector((state) => selectCollectionSaveParamsForId(state, collectionId));
  const collectionHasEdits = useAppSelector((state) => selectCollectionHasEditsForId(state, collectionId));
  const collectionHasUnSavedEdits = useAppSelector((state) =>
    selectCollectionHasUnsavedEditsForId(state, collectionId)
  );
  const currentCollection = useAppSelector((state) => selectCollectionForId(state, collectionId));
  const hasUnavailableClaims = useAppSelector((state) =>
    selectHasUnavailableClaimIdsForCollectionId(state, collectionId)
  );
  const effectiveSearch = search || (typeof window !== 'undefined' && window.location ? window.location.search : '');
  const tabIndexFromUrl = getTabIndexFromSearch(effectiveSearch);
  const [thumbailError, setThumbnailError] = React.useState<string | undefined>();
  const initialParams = React.useRef(collectionParams);
  const [formParams, setFormParams] = React.useState<Record<string, any>>(collectionParams || {});
  const [optimisticTabIndex, setOptimisticTabIndex] = React.useState<number | null>(null);
  const [showItemsSpinner, setShowItemsSpinner] = React.useState(false);
  const [savePending, setSavePending] = React.useState(false);
  const tabIndex = optimisticTabIndex ?? tabIndexFromUrl;
  const collectionHasStoredItems = Boolean(currentCollection?.items?.length);
  const shouldResolveCollectionItems = collectionHasStoredItems && !collectionHasItemsResolved;
  const itemError = shouldResolveCollectionItems
    ? __('Playlist items are still loading. Please try again in a moment.')
    : hasUnavailableClaims
      ? __('Remove unavailable items before saving this playlist.')
      : undefined;
  const hasChanges =
    collectionHasEdits ||
    collectionHasUnSavedEdits ||
    JSON.stringify(initialParams.current) !== JSON.stringify(formParams);

  function navigateToCollectionView(savedCollectionId = collectionId) {
    if (onDoneForId) {
      onDoneForId(savedCollectionId);
    } else {
      const target = `/$/${PAGES.PLAYLIST}/${savedCollectionId}`;
      navigate(target, { replace: true });
    }
  }

  const updateFormParams = React.useCallback((newParams: {}) => {
    setFormParams((prevParams) => ({ ...prevParams, ...newParams }));
  }, []);

  const syncTabToUrl = React.useCallback(
    (nextTabIndex: number) => {
      const nextParams = new URLSearchParams(effectiveSearch);

      if (nextTabIndex === TAB.ITEMS) {
        nextParams.set(COLLECTION_PAGE.QUERIES.TAB, COLLECTION_PAGE.TABS.ITEMS);
      } else {
        nextParams.delete(COLLECTION_PAGE.QUERIES.TAB);
      }

      navigate(`?${nextParams.toString()}`, { replace: true });
    },
    [effectiveSearch, navigate]
  );

  async function handleSubmitForm() {
    if (shouldResolveCollectionItems || hasUnavailableClaims) return;
    if (!hasChanges) return navigateToCollectionView();
    const trimmedParams = { ...formParams };
    if (trimmedParams.title) trimmedParams.title = trimmedParams.title.trim();
    if (collectionHasItemsResolved && currentCollection?.items) {
      trimmedParams.claims = currentCollection.items.filter((item) => typeof item === 'string');
    }
    setFormParams(trimmedParams);

    const convertsPrivatePlaylistToPublic =
      (initialParams.current?.visibility || currentCollection?.visibility || 'private') === 'private' &&
      trimmedParams.visibility === 'public';
    if (convertsPrivatePlaylistToPublic) {
      dispatch(
        doOpenModal(MODALS.CONFIRM, {
          title: __('Make this playlist public?'),
          body: __(
            'The decrypted title, description, thumbnail, tags, and item list will be published. Public history cannot be made private again.'
          ),
          checkboxLabel: __('I understand this cannot be reversed'),
          labelOk: __('Make Public'),
          onConfirm: (closeModal) => {
            closeModal();
            void persistForm(trimmedParams);
          },
        })
      );
      return;
    }

    await persistForm(trimmedParams);
  }

  async function persistForm(trimmedParams: Record<string, any>) {
    setSavePending(true);
    try {
      const saved = await dispatch(doCollectionEdit(collectionId, trimmedParams));
      if (saved) {
        dispatch(doRemoveFromUnsavedChangesCollectionsForCollectionId(collectionId));
        navigateToCollectionView(saved.claim_id || collectionId);
      }
    } catch {
      return;
    } finally {
      setSavePending(false);
    }
  }

  function handleCancelButton() {
    dispatch(doRemoveFromUnsavedChangesCollectionsForCollectionId(collectionId));
    navigateToCollectionView();
  }

  function onTabChange(newTabIndex) {
    if (tabIndex !== newTabIndex) {
      setOptimisticTabIndex(newTabIndex);
      syncTabToUrl(newTabIndex);
      setShowItemsSpinner(false);
    }
  }

  React.useEffect(() => {
    if (optimisticTabIndex !== null && optimisticTabIndex === tabIndexFromUrl) {
      setOptimisticTabIndex(null);
    }
  }, [optimisticTabIndex, tabIndexFromUrl]);

  React.useEffect(() => {
    if (collectionParams) {
      if (!initialParams.current) {
        initialParams.current = collectionParams;
        setFormParams(collectionParams);
        return;
      }
      // Keep claims in formParams up to date
      setFormParams((prevParams) => {
        if (areArraysEqual(prevParams.claims, collectionParams.claims)) {
          return prevParams;
        }

        return {
          ...prevParams,
          claims: collectionParams.claims,
        };
      });
    }
  }, [collectionParams]);

  return (
    <Form
      className="main--contained collection-edit-form__wrapper"
      onSubmit={handleSubmitForm}
      errors={{
        ...(itemError
          ? {
              items: itemError,
            }
          : {}),
        ...(thumbailError
          ? {
              thumbnail: thumbailError,
            }
          : {}),
      }}
      disableSubmitOnEnter
    >
      <Tabs onChange={onTabChange} index={tabIndex}>
        <TabList className="tabs__list--collection-edit-page">
          <Tab>{__('General')}</Tab>
          <Tab>
            {__('Items')}
            {showItemsSpinner && <Spinner type="small" />}
          </Tab>
        </TabList>

        <TabPanels>
          <TabPanel>
            {tabIndex === TAB.GENERAL && (
              <CollectionGeneralTab
                collectionId={collectionId}
                initialVisibility={currentCollection?.visibility || 'private'}
                formParams={formParams}
                setThumbnailError={setThumbnailError}
                updateFormParams={updateFormParams}
              />
            )}
          </TabPanel>

          <TabPanel>
            {tabIndex === TAB.ITEMS && (
              <>
                <div className={classnames('collection-actions')}>
                  <SortButton collectionId={collectionId} />
                </div>
                <CollectionItemsList
                  collectionId={collectionId}
                  {...({ empty: __('This playlist has no items.'), showEdit: true, isEditPreview: true } as any)}
                />
              </>
            )}
          </TabPanel>
        </TabPanels>
      </Tabs>

      {hasUnavailableClaims && <ErrorBubble>{__('Remove unavailable items before saving this playlist.')}</ErrorBubble>}

      <div className="section__actions">
        <Submit
          {...({
            button: 'primary',
            disabled:
              !collectionParams || savePending || shouldResolveCollectionItems || hasUnavailableClaims || !hasChanges,
            label: savePending ? <BusyIndicator message={__('Saving')} /> : __('Save'),
          } as any)}
        />
        <Button button="link" label={__('Cancel')} onClick={handleCancelButton} />
      </div>

      <FormErrors />

      <p className="help">
        {__('Saving commits a new immutable snapshot while keeping this playlist link unchanged.')}
      </p>
    </Form>
  );
};

export default withCollectionItems(CollectionEditForm);
