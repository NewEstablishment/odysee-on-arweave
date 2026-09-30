import { PAGE_MAIN_EMPTY_CLASS, PAGE_TITLE_CLASS } from 'component/page/classes';
import React from 'react';
import ClaimList from 'component/claimList';
import Page from 'component/page';
import Button from 'component/button';
import classnames from 'classnames';
import Icon from 'component/common/icon';
import { ICON_HELP_CLASS } from 'component/common/icon-classes';
import Spinner from 'component/spinner';
import * as ICONS from 'constants/icons';
import * as MODALS from 'constants/modal_types';
import { YRBL_SAD_IMG_URL } from 'config';
import { getThumbnailCdnUrl } from 'util/thumbnail';
import Tooltip from 'component/common/tooltip';
import useClaimListInfiniteScroll from 'effects/use-claimList-infinite-scroll';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectWatchHistoryUris } from 'redux/selectors/content';
import { doOpenModal } from 'redux/actions/app';
import { doClearContentHistoryAll } from 'redux/actions/content';
import { doResolveUris } from 'redux/actions/claims';
import { selectUserAuthenticated } from 'redux/selectors/user';
import { selectFetchingRemoteHistory } from 'redux/selectors/content';
import { doFetchViewHistory } from 'redux/actions/content';
import { CLAIM_LIST_ALT_CONTROLS_WRAP_CLASS, CLAIM_LIST_HEADER_CLASS } from 'component/claimList/classes';
import { EMPTY_CLASS } from 'component/common/empty-classes';
export const PAGE_SIZE = 30;
// ****************************************************************************
// WatchHistoryPage
// ****************************************************************************

export default function WatchHistoryPage() {
  const dispatch = useAppDispatch();
  const historyUris = useAppSelector(selectWatchHistoryUris);
  const isAuthenticated = useAppSelector(selectUserAuthenticated);
  const fetchingRemoteHistory = useAppSelector(selectFetchingRemoteHistory);

  const doResolveUrisFn = React.useCallback(
    (uris: Array<string>, returnCachedClaims: boolean, resolveReposts: boolean) => {
      dispatch(doResolveUris(uris, returnCachedClaims, resolveReposts));
    },
    [dispatch]
  );
  const { uris, page, isLoadingPage, bumpPage } = useClaimListInfiniteScroll(
    historyUris,
    doResolveUrisFn,
    PAGE_SIZE,
    true
  );

  // Re-fetch remote history when visiting the page, but only if we haven't fetched recently (5 min cooldown)
  const REFETCH_COOLDOWN_MS = 5 * 60 * 1000;
  React.useEffect(() => {
    if (isAuthenticated) {
      const store = window.store;
      const state = store && store.getState();
      const lastFetched = state && state.content && state.content.remoteHistoryLastFetched;
      if (!lastFetched || Date.now() - lastFetched > REFETCH_COOLDOWN_MS) {
        dispatch(doFetchViewHistory());
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function clearHistory() {
    dispatch(
      doOpenModal(MODALS.CONFIRM, {
        title: __('Clear History'),
        subtitle: __('Watch history will be cleared from this device.'),
        onConfirm: (closeModal: () => void) => {
          dispatch(doClearContentHistoryAll());
          closeModal();
        },
      })
    );
  }

  const historyInfoText = isAuthenticated
    ? __('Your watch history syncs across devices for the last 30 days. Older history is kept locally on this device.')
    : __('Your watch history is only saved locally on this device. Sign in to sync across devices.');

  return (
    <Page className="watch-history-surface">
      <div className={classnames('section card-stack')}>
        <div className={CLAIM_LIST_HEADER_CLASS} data-claim-list-header>
          <h1 className={PAGE_TITLE_CLASS}>
            <Icon icon={ICONS.WATCH_HISTORY} className="tw:mr-app-s" />
            <label>{__('Watch History')}</label>
            <Tooltip title={historyInfoText}>
              <Button className={ICON_HELP_CLASS} icon={ICONS.HELP} iconSize={14} />
            </Tooltip>
          </h1>

          <div className={CLAIM_LIST_ALT_CONTROLS_WRAP_CLASS}>
            {fetchingRemoteHistory && (
              <span className="tw:mr-app-s tw:flex tw:items-center tw:gap-app-xs tw:text-app-small tw:text-app-text-subtitle">
                <Spinner type="small" />
                <span>{__('Syncing history...')}</span>
              </span>
            )}
            {uris.length > 0 && (
              <Button
                title={__('Clear History')}
                button="primary"
                label={__('Clear History')}
                onClick={() => clearHistory()}
              />
            )}
          </div>
        </div>
        {isAuthenticated && uris.length > 0 && (
          <div className="tw:mb-app-s tw:flex tw:items-center tw:gap-app-xs tw:rounded-app tw:bg-app-header tw:px-app-s tw:py-app-xs tw:text-app-xsmall tw:text-app-text-subtitle">
            <Icon icon={ICONS.INFO} size={16} />
            <span>
              {__('Synced history is available for the last 30 days. Older history is only stored on this device.')}
            </span>
          </div>
        )}
        {uris.length > 0 && (
          <ClaimList
            uris={uris.slice(0, (page + 1) * PAGE_SIZE)}
            onScrollBottom={bumpPage}
            page={page + 1}
            pageSize={PAGE_SIZE}
            loading={isLoadingPage}
            useLoadingSpinner
            inWatchHistory
          />
        )}
        {uris.length === 0 && (
          <div className="tw:text-center">
            <img src={getThumbnailCdnUrl({ thumbnail: YRBL_SAD_IMG_URL }) || undefined} />
            <h2 className={`${PAGE_MAIN_EMPTY_CLASS} ${EMPTY_CLASS} tw:mt-0`}>{__('Nothing here')}</h2>
          </div>
        )}
        {uris.length === 0 && fetchingRemoteHistory && (
          <div className="tw:p-app-l tw:text-center">
            <Spinner type="small" />
            <p className="tw:mt-app-s">{__('Loading watch history from your account...')}</p>
          </div>
        )}
      </div>
    </Page>
  );
}
