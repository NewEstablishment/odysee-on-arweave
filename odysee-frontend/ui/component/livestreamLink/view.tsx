import React from 'react';
import { PAGE_TITLE_CLASS } from 'component/page/classes';
import { useNavigate } from 'react-router-dom';
import { formatLbryUrlForWeb } from 'util/url';
import * as ICONS from 'constants/icons';
import Card from 'component/common/card';
import ClaimPreview from 'component/claimPreview';
import Icon from 'component/common/icon';
import { useAppDispatch } from 'redux/hooks';
import { doResolveUri } from 'redux/actions/claims';
import { LIVESTREAM_LINK_CLASS } from './classes';
import { CLAIM_PREVIEW_LIVE_WRAPPER_CLASS } from 'component/claimPreview/classes';

type Props = {
  title?: string;
  claimUri?: string;
  uri?: string;
};

const LivestreamLink = (props: Props) => {
  const { claimUri, title = null } = props;
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  React.useEffect(() => {
    if (claimUri) {
      dispatch(doResolveUri(claimUri));
    }
  }, [claimUri, dispatch]);
  if (!claimUri) return null;
  return (
    <Card
      className={`${LIVESTREAM_LINK_CLASS} ${CLAIM_PREVIEW_LIVE_WRAPPER_CLASS}`}
      title={
        <div className={PAGE_TITLE_CLASS}>
          <Icon icon={ICONS.LIVESTREAM_MONOCHROME} />
          <span>{title || __('Live stream in progress')}</span>
        </div>
      }
      onClick={() => navigate(formatLbryUrlForWeb(claimUri))}
    >
      <ClaimPreview uri={claimUri} type="inline" hideMenu />
    </Card>
  );
};

export default LivestreamLink;
