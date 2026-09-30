import React from 'react';
import classnames from 'classnames';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import ChannelThumbnail from 'component/channelThumbnail';
import ChannelTitle from 'component/channelTitle';
import MembershipBadge from 'component/membershipBadge';
import { useAppSelector } from 'redux/hooks';
import { selectClaimUriForId } from 'redux/selectors/claims';
import { selectUserOdyseeMembership } from 'redux/selectors/memberships';
import { CHANNEL_SELECTOR_CLASSES as C } from '../../classes';

type Props = {
  channelId: string;
  isSelected?: boolean;
};

const ChannelListItem = (props: Props) => {
  const { channelId, isSelected = false } = props;

  const uri = useAppSelector((state) => selectClaimUriForId(state, channelId));
  const odyseeMembership = useAppSelector((state) => selectUserOdyseeMembership(state, channelId));
  return (
    <div
      className={classnames(C.item, {
        [C.itemSelected]: isSelected,
      })}
      data-channel-selector-item=""
      data-channel-selector-selected={isSelected ? '' : undefined}
    >
      <ChannelThumbnail className={C.itemThumbnail} uri={uri} hideStakedIndicator xsmall noLazyLoad />
      <ChannelTitle uri={uri} />
      {odyseeMembership && <MembershipBadge membershipName={odyseeMembership} />}
      {isSelected && <Icon icon={ICONS.DOWN} />}
    </div>
  );
};

export default ChannelListItem;
