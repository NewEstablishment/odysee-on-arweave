import React from 'react';
import classnames from 'classnames';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import ChannelThumbnail from 'component/channelThumbnail';
import ChannelTitle from 'component/channelTitle';
import MembershipBadge from 'component/membershipBadge';
import { useAppSelector } from 'redux/hooks';
import { selectClaimUriForId, selectMyChannelClaimsById } from 'redux/selectors/claims';
import { selectUserOdyseeMembership } from 'redux/selectors/memberships';
import { hyperbeamImmutableUriFromClaim } from 'util/hyperbeam-route';

type Props = {
  channelId: string;
  isSelected?: boolean;
};

const ChannelListItem = (props: Props) => {
  const { channelId, isSelected = false } = props;

  const resolvedUri = useAppSelector((state) => selectClaimUriForId(state, channelId));
  const ownedChannel = useAppSelector((state) => selectMyChannelClaimsById(state)?.[channelId]);
  const odyseeMembership = useAppSelector((state) => selectUserOdyseeMembership(state, channelId));
  const uri = ownedChannel?.permanent_url || hyperbeamImmutableUriFromClaim(ownedChannel) || resolvedUri;
  const title = ownedChannel?.value?.title || ownedChannel?.name;
  const thumbnail = ownedChannel?.value?.thumbnail?.url;

  return (
    <div
      className={classnames('channel-selector__item', {
        'channel-selector__item--selected': isSelected,
      })}
    >
      <ChannelThumbnail uri={uri} thumbnailPreview={thumbnail} hideStakedIndicator xsmall noLazyLoad />
      {title ? <div className="claim-preview__title">{title}</div> : <ChannelTitle uri={uri} />}
      {odyseeMembership && <MembershipBadge membershipName={odyseeMembership} />}
      {isSelected && <Icon icon={ICONS.DOWN} />}
    </div>
  );
};

export default ChannelListItem;
