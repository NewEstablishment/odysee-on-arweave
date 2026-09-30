import React from 'react';
import HelpHub from 'component/common/help-hub';
import ChannelOverview from './internal/channelOverview';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectMyChannelClaims } from 'redux/selectors/claims';
import {
  selectMyTotalSupportersAmount,
  selectMyTotalMonthlyIncome,
  selectPreviousMonthlyIncome,
} from 'redux/selectors/memberships';
import { doSetActiveChannel } from 'redux/actions/app';
import { MEMBERSHIP_OVERVIEW_CLASSES } from './classes';
type Props = {
  onChannelSelect: () => void;
};

function OverviewTab(props: Props) {
  const { onChannelSelect } = props;
  const dispatch = useAppDispatch();
  const myChannelClaims = useAppSelector(selectMyChannelClaims);
  const totalSupportersAmount = useAppSelector(selectMyTotalSupportersAmount);
  const totalMonthlyIncome = useAppSelector(selectMyTotalMonthlyIncome);
  const previousMonthlyIncome = useAppSelector(selectPreviousMonthlyIncome);

  function selectChannel(channelClaim) {
    dispatch(doSetActiveChannel(channelClaim.claim_id, true));
    onChannelSelect();
  }

  return (
    <>
      <div className={MEMBERSHIP_OVERVIEW_CLASSES.stats}>
        <div className={MEMBERSHIP_OVERVIEW_CLASSES.stat}>
          <span className={MEMBERSHIP_OVERVIEW_CLASSES.statLabel}>{__('Total Supporters')}</span>
          <strong className={MEMBERSHIP_OVERVIEW_CLASSES.statValue}>{totalSupportersAmount}</strong>
        </div>
        <div className={MEMBERSHIP_OVERVIEW_CLASSES.stat}>
          <span className={MEMBERSHIP_OVERVIEW_CLASSES.statLabel}>{__('Income Last Month')}</span>
          <strong className={MEMBERSHIP_OVERVIEW_CLASSES.statValue}>${(previousMonthlyIncome / 100).toFixed(2)}</strong>
        </div>
        <div className={MEMBERSHIP_OVERVIEW_CLASSES.stat}>
          <span className={MEMBERSHIP_OVERVIEW_CLASSES.statLabel}>{__('Projected Monthly Income')}</span>
          <strong className={MEMBERSHIP_OVERVIEW_CLASSES.statValue}>${(totalMonthlyIncome / 100).toFixed(2)}</strong>
        </div>
      </div>

      <div className={MEMBERSHIP_OVERVIEW_CLASSES.list}>
        <div className={MEMBERSHIP_OVERVIEW_CLASSES.listHeader}>
          <span>{__('Channel Name')}</span>
          <span className={MEMBERSHIP_OVERVIEW_CLASSES.listHeaderMetric}>{__('Supporters')}</span>
          <span className={MEMBERSHIP_OVERVIEW_CLASSES.listHeaderMetric}>{__('Estimated Monthly Income')}</span>
          <span>{__('Page')}</span>
          <span>{__('URL')}</span>
        </div>

        {myChannelClaims.map((channelClaim: ChannelClaim) => (
          <div key={channelClaim.claim_id} className={MEMBERSHIP_OVERVIEW_CLASSES.channel}>
            <ChannelOverview channelClaim={channelClaim} onSelect={() => selectChannel(channelClaim)} />
          </div>
        ))}
      </div>

      <HelpHub
        href="https://help.odysee.tv/category-memberships/"
        image="Spaceman"
        text={__(
          'Want to increase your channel growth? Spaceman has whipped up some marketing concepts in the %help_hub%.'
        )}
      />
    </>
  );
}

export default OverviewTab;
