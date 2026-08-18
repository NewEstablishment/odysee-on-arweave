import * as ICONS from 'constants/icons';
import * as MODALS from 'constants/modal_types';
import React from 'react';
import { Menu, MenuButton, MenuList, MenuItem } from 'component/common/menu';
import Icon from 'component/common/icon';
import { useIsMobile } from 'effects/use-screensize';
import * as PAGES from 'constants/pages';
import { COLLECTION_PAGE } from 'constants/urlParams';
import { useNavigate } from 'react-router-dom';
// import { ENABLE_FILE_REACTIONS } from 'config';
// import ClaimRepostButton from 'component/claimRepostButton';
import CollectionPublishButton from 'page/collection/internal/collectionActions/internal/publishButton';
// import CollectionSubtitle from '../collectionSubtitle';
import Tooltip from 'component/common/tooltip';
import Spinner from 'component/spinner';
import Button from 'component/button';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import {
  selectCollectionIsMine,
  selectCollectionIsPublishingForId,
  selectCollectionPublishErrorForId,
  selectCollectionHasEditsForId,
  selectCollectionSavedForId,
} from 'redux/selectors/collections';
import { doOpenModal } from 'redux/actions/app';
import { doToggleCollectionSavedForId, doRetryCollectionPublish } from 'redux/actions/collections';
import { doToast } from 'redux/actions/notifications';
type Props = {
  uri?: string;
  collectionId: string;
  showEdit?: boolean;
  setShowEdit?: (arg0: boolean) => void;
  isBuiltin?: boolean;
  isHeader?: boolean;
};

function CollectionHeaderActions(props: Props) {
  const { uri, collectionId, isBuiltin, showEdit, setShowEdit } = props;
  const dispatch = useAppDispatch();
  const isMyCollection = useAppSelector((state) => selectCollectionIsMine(state, collectionId));
  const isPublishing = useAppSelector((state) => selectCollectionIsPublishingForId(state, collectionId));
  const publishError = useAppSelector((state) => selectCollectionPublishErrorForId(state, collectionId));
  const collectionHasEdits = useAppSelector((state) => selectCollectionHasEditsForId(state, collectionId));
  const collectionSavedForId = useAppSelector((state) => selectCollectionSavedForId(state, collectionId));
  const navigate = useNavigate();
  const hasPublicPlaylist = Boolean(uri);
  const isNotADefaultList = collectionId !== 'watchlater' && collectionId !== 'favorites';

  async function sharePlaylist() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        dispatch(doToast({ message: __('Playlist link copied.') }));
      }
    } catch (error) {
      if (error?.name !== 'AbortError') dispatch(doToast({ message: __('Could not share playlist.'), isError: true }));
    }
  }
  return (
    <>
      <div>
        <SectionElement>
          {!isBuiltin && (
            <>
              {isMyCollection && <CollectionPublishButton uri={uri} collectionId={collectionId} showEdit={showEdit} />}
              {uri && (
                <>
                  {isPublishing && (
                    <Tooltip title={__('Publishing playlist updates in the background')} arrow={false} enterDelay={100}>
                      <div className="pending-change">
                        <Spinner />
                      </div>
                    </Tooltip>
                  )}
                  {collectionHasEdits && publishError && (
                    <Tooltip title={__('Last publish failed. Open menu to retry.')} arrow={false} enterDelay={100}>
                      <div className="pending-change">
                        <Icon icon={ICONS.WARNING} />
                      </div>
                    </Tooltip>
                  )}
                  <Button button="alt" icon={ICONS.SHARE} aria-label={__('Share playlist')} onClick={sharePlaylist} />
                </>
              )}
            </>
          )}
          <Menu>
            <MenuButton
              className="menu__button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <Icon size={20} icon={ICONS.MORE_VERTICAL} />
            </MenuButton>
            <MenuList className="menu__list">
              {isMyCollection && isNotADefaultList && !showEdit && (
                <MenuItem
                  className="comment__menu-option"
                  onSelect={() =>
                    navigate(
                      `/$/${PAGES.PLAYLIST}/${collectionId}?${COLLECTION_PAGE.QUERIES.VIEW}=${COLLECTION_PAGE.VIEWS.EDIT}`
                    )
                  }
                >
                  <div className="menu__link">
                    <Icon aria-hidden icon={ICONS.EDIT} />
                    {__('Edit')}
                  </div>
                </MenuItem>
              )}
              {isMyCollection && !isBuiltin && hasPublicPlaylist && collectionHasEdits && publishError && (
                <MenuItem
                  className="comment__menu-option"
                  onSelect={() => dispatch(doRetryCollectionPublish(collectionId))}
                >
                  <div className="menu__link">
                    <Icon aria-hidden icon={ICONS.REFRESH} />
                    {__('Retry Publish Now')}
                  </div>
                </MenuItem>
              )}
              {!isMyCollection && hasPublicPlaylist && (
                <MenuItem
                  className="comment__menu-option"
                  onSelect={() => dispatch(doToggleCollectionSavedForId(collectionId))}
                >
                  <div className="menu__link">
                    <Icon aria-hidden icon={collectionSavedForId ? ICONS.PLAYLIST_FILLED : ICONS.PLAYLIST_ADD} />
                    {collectionSavedForId ? __('Unsave') : __('Save')}
                  </div>
                </MenuItem>
              )}
              {isMyCollection && (
                <MenuItem className="comment__menu-option" onSelect={() => setShowEdit(true)}>
                  <div className="menu__link">
                    <Icon aria-hidden icon={ICONS.ARRANGE} />
                    {__('Arrange Items')}
                  </div>
                </MenuItem>
              )}
              <MenuItem
                className="comment__menu-option"
                onSelect={() =>
                  dispatch(
                    doOpenModal(MODALS.COLLECTION_CREATE, {
                      sourceId: collectionId,
                    })
                  )
                }
              >
                <div className="menu__link">
                  <Icon aria-hidden icon={ICONS.COPY} />
                  {__('Copy')}
                </div>
              </MenuItem>
              {isMyCollection && isNotADefaultList && !hasPublicPlaylist && (
                <MenuItem
                  className="comment__menu-option"
                  onSelect={() =>
                    dispatch(
                      doOpenModal(MODALS.COLLECTION_DELETE, {
                        uri,
                        collectionId,
                        redirect: `/$/${PAGES.PLAYLISTS}`,
                      })
                    )
                  }
                >
                  <div className="menu__link">
                    <Icon aria-hidden icon={ICONS.DELETE} />
                    {__('Delete')}
                  </div>
                </MenuItem>
              )}
            </MenuList>
          </Menu>
        </SectionElement>
      </div>
    </>
  );
}

type SectionProps = {
  children: any;
};

const SectionElement = (props: SectionProps) => {
  const { children } = props;
  const isMobile = useIsMobile();
  return isMobile ? children : <div className="section__actions">{children}</div>;
};

export default CollectionHeaderActions;
