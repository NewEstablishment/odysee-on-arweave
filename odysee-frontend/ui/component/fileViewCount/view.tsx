import React from 'react';
import Skeleton from '@mui/material/Skeleton';

import Tooltip from 'component/common/tooltip';
import { toCompactNotation } from 'util/string';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectClaimForUri, selectClaimIdForUri, selectIsStreamPlaceholderForUri } from 'redux/selectors/claims';
import { selectViewersForId, selectIsActiveLivestreamForUri } from 'redux/selectors/livestream';
import { selectLanguage } from 'redux/selectors/settings';
import { doFetchViewCount, selectViewCountForUri } from 'lbryinc';
import { isHyperbeamUploadClaim } from 'util/claim';
type Props = {
  uri: string;
};
const RETRY_COUNT_MAX = 6;
const RETRY_INTERVAL_MS = 5000;

function FileViewCount(props: Props) {
  const { uri } = props;
  const dispatch = useAppDispatch();
  const claim = useAppSelector((state) => selectClaimForUri(state, uri));
  const claimId = useAppSelector((state) => selectClaimIdForUri(state, uri));
  const isLivestreamClaim = useAppSelector((state) => selectIsStreamPlaceholderForUri(state, uri));
  const viewCount = useAppSelector((state) => selectViewCountForUri(state, uri));
  const activeViewers = useAppSelector((state) =>
    isLivestreamClaim && claimId ? selectViewersForId(state, claimId) : undefined
  );
  const lang = useAppSelector(selectLanguage);
  const isLivestreamActive = useAppSelector((state) => isLivestreamClaim && selectIsActiveLivestreamForUri(state, uri));
  const isHyperbeamUpload = isHyperbeamUploadClaim(claim);
  const effectiveViewCount = isHyperbeamUpload ? 0 : viewCount;
  const count = isLivestreamClaim ? activeViewers || 0 : effectiveViewCount;
  const countCompact = Number.isInteger(count) ? toCompactNotation(count, lang, 10000) : null;
  const countFullResolution = Number(count).toLocaleString();
  const Placeholder = <Skeleton variant="text" animation="wave" className="file-view-count-placeholder" />;
  const retryCountRef = React.useRef(0);

  function getRegularViewCountElem() {
    if (Number.isInteger(effectiveViewCount)) {
      return effectiveViewCount !== 1
        ? __('%view_count% views', {
            view_count: countCompact,
          })
        : __('1 view');
    } else {
      return Placeholder;
    }
  }

  function getLivestreamViewCountElem() {
    if (activeViewers === undefined) {
      return Placeholder;
    } else {
      return __('%viewer_count% currently %viewer_state%', {
        viewer_count: countCompact,
        viewer_state: isLivestreamActive ? __('watching') : __('waiting'),
      });
    }
  }

  React.useEffect(() => {
    if (claimId && !isHyperbeamUpload) {
      dispatch(doFetchViewCount(claimId));
    }
  }, [claimId, dispatch, isHyperbeamUpload]);

  React.useEffect(() => {
    retryCountRef.current = 0;
  }, [claimId]);

  React.useEffect(() => {
    if (
      !claimId ||
      isHyperbeamUpload ||
      isLivestreamClaim ||
      Number.isInteger(viewCount) ||
      retryCountRef.current >= RETRY_COUNT_MAX
    ) {
      return;
    }

    const retryTimer = window.setTimeout(() => {
      retryCountRef.current += 1;
      dispatch(doFetchViewCount(claimId));
    }, RETRY_INTERVAL_MS);

    return () => window.clearTimeout(retryTimer);
  }, [claimId, dispatch, isHyperbeamUpload, isLivestreamClaim, viewCount]);
  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Tooltip title={countFullResolution} followCursor placement="top">
      <span className="media__subtitle--centered">
        {isLivestreamClaim && getLivestreamViewCountElem()}
        {!isLivestreamClaim && activeViewers === undefined && getRegularViewCountElem()}
      </span>
    </Tooltip>
  );
}

export default FileViewCount;
