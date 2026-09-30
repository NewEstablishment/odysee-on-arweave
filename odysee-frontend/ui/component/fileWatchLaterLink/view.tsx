import * as ICONS from 'constants/icons';
import React, { useRef } from 'react';
import * as PAGES from 'constants/pages';
import Icon from 'component/common/icon';
import { BUTTON_ALT_CLASS, BUTTON_CLASS, BUTTON_CONTENT_CLASS, BUTTON_LABEL_CLASS } from 'component/button/classes';
import { FILE_ACTION_BUTTON_CLASS } from 'component/common/file-action-button-classes';
import useHover from 'effects/use-hover';
import * as COLLECTIONS_CONSTS from 'constants/collections';
import { getLocalizedNameForCollectionId } from 'util/collections';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectCollectionForIdHasClaimUrl } from 'redux/selectors/collections';
import { selectUserAuthenticated } from 'redux/selectors/user';
import { doPlaylistAddAndAllowPlaying } from 'redux/actions/content';
type Props = {
  uri: string;
  focusable: boolean;
};

function FileWatchLaterLink(props: Props) {
  const { uri, focusable = true } = props;
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const emailVerified = useAppSelector(selectUserAuthenticated);
  const hasClaimInWatchLater = useAppSelector((state) =>
    selectCollectionForIdHasClaimUrl(state, COLLECTIONS_CONSTS.WATCH_LATER_ID, uri)
  );
  const buttonRef = useRef();
  let isHovering = useHover(buttonRef);

  function handleWatchLater(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!emailVerified) {
      const redirect = `${location.pathname}${location.search || ''}`;
      navigate(`/$/${PAGES.AUTH}?redirect=${encodeURIComponent(redirect)}`);
      return;
    }

    const collectionId = COLLECTIONS_CONSTS.WATCH_LATER_ID;
    dispatch(
      doPlaylistAddAndAllowPlaying({
        uri,
        collectionName: getLocalizedNameForCollectionId(collectionId) || COLLECTIONS_CONSTS.WATCH_LATER_NAME,
        collectionId,
      })
    );
  }

  // text that will show if you keep cursor over button
  const title = hasClaimInWatchLater ? __('Remove from Watch Later') : __('Add to Watch Later');
  // label that is shown after hover
  const label = !hasClaimInWatchLater ? __('Watch Later') : __('Remove');
  return (
    <div className="claim-preview__hover-actions tw:col-start-2 tw:row-start-1">
      <button
        ref={buttonRef}
        title={title}
        aria-label={title}
        className={`${BUTTON_CLASS} ${BUTTON_ALT_CLASS} ${FILE_ACTION_BUTTON_CLASS}`}
        onClick={handleWatchLater}
        tabIndex={focusable ? 0 : -1}
        type="button"
      >
        <span className={BUTTON_CONTENT_CLASS}>
          <Icon icon={(hasClaimInWatchLater && (isHovering ? ICONS.REMOVE : ICONS.COMPLETED)) || ICONS.TIME} />
          <span dir="auto" className={BUTTON_LABEL_CLASS}>
            {label}
          </span>
        </span>
      </button>
    </div>
  );
}

export default React.memo(FileWatchLaterLink);
