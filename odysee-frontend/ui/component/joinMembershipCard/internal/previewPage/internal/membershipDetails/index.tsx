import React from 'react';
import classnames from 'classnames';
import WalletStatus from 'component/walletStatus';
import { useArStatus } from 'effects/use-ar-status';
import { JOIN_MEMBERSHIP_CLASSES } from '../../../../classes';
import { MEMBERSHIP_TIER_CLASSES } from '../membershipTier/classes';
type Props = {
  membership: CreatorMembership;
  headerAction?: any;
  unlockableTierIds?: Array<number>;
  userHasACreatorMembership?: boolean;
  isChannelTab?: boolean;
  membersOnly?: boolean;
  isLivestream?: boolean | null | undefined;
};

const MembershipDetails = (props: Props) => {
  const {
    membership,
    headerAction,
    unlockableTierIds,
    userHasACreatorMembership,
    isChannelTab,
    membersOnly,
    isLivestream,
  } = props;
  const { activeArStatus } = useArStatus();
  const selectedMembershipName = membership.name;
  const membershipIsUnlockable = !userHasACreatorMembership && new Set(unlockableTierIds).has(membership.membership_id);

  let accessText = __(
    membersOnly
      ? !isLivestream
        ? 'This membership does not give you access to the members-only comment section.'
        : 'This membership does not give you access to the members-only chat mode.'
      : 'This Tier does not grant you access to the currently selected content.'
  );

  if (userHasACreatorMembership) {
    accessText = __("You can't upgrade or downgrade plans at the moment, coming soon!");
  } else if (membershipIsUnlockable) {
    // This is the green alert, only used to prevent the modal from moving when moving tiers from one that
    // has access to one that doesn't
    accessText = __(
      membersOnly
        ? !isLivestream
          ? 'This membership gives you access to the members-only comment section.'
          : 'This membership gives you access to the members-only chat mode.'
        : 'This membership gives you access to the current content.'
    );
  }

  return (
    <>
      {unlockableTierIds && (
        <div
          className={classnames(
            'tw:mb-app-s tw:rounded-app tw:border-2 tw:p-app-s',
            membershipIsUnlockable
              ? 'tw:border-[rgba(0,255,64,0.6)] tw:bg-[rgba(0,255,21,0.2)]'
              : 'tw:border-[rgba(255,0,0,0.6)] tw:bg-[rgba(255,0,0,0.2)]'
          )}
        >
          <p className="tw:text-center">{accessText}</p>
        </div>
      )}

      {activeArStatus !== 'connected' && !isChannelTab ? (
        <WalletStatus />
      ) : (
        <>
          {!isChannelTab && (
            <div className="tw:mb-[calc(var(--spacing-s)*-1)] tw:max-w-full tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
              {selectedMembershipName}
            </div>
          )}

          <section
            className={classnames(
              isChannelTab ? MEMBERSHIP_TIER_CLASSES.header : MEMBERSHIP_TIER_CLASSES.headerTypography,
              {
                [JOIN_MEMBERSHIP_CLASSES.detailsHeader]: !isChannelTab,
              }
            )}
          >
            <span className={isChannelTab ? MEMBERSHIP_TIER_CLASSES.headerName : undefined}>{membership.name}</span>
          </section>

          <section
            className={classnames('membership-tier__infos', !isChannelTab && JOIN_MEMBERSHIP_CLASSES.detailsInfo)}
          >
            <span className={JOIN_MEMBERSHIP_CLASSES.detailsDescription}>{membership.description}</span>
            <label>{__('Pledge')}</label>
            <span
              style={{
                display: 'flex',
              }}
            >
              ${(Number(membership?.prices[0].amount) / 100).toFixed(2)}
            </span>

            <div className={MEMBERSHIP_TIER_CLASSES.perks}>
              <div className={JOIN_MEMBERSHIP_CLASSES.moon} />
              <div className="membership-tier__perks-content">
                {membership.perks && membership.perks.length > 0 ? (
                  <>
                    <label>{__('Perks')}</label>
                    <ul className={MEMBERSHIP_TIER_CLASSES.perksList}>
                      {membership.perks.map((tierPerk, i) => (
                        <li
                          className={classnames(
                            MEMBERSHIP_TIER_CLASSES.perksItem,
                            MEMBERSHIP_TIER_CLASSES.perksItemTierColor,
                            MEMBERSHIP_TIER_CLASSES.perksItemMuted
                          )}
                          key={i}
                        >
                          {__(tierPerk.name)}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <label>{__('No Perks...')}</label>
                )}
              </div>
            </div>
          </section>

          {headerAction && <section className={JOIN_MEMBERSHIP_CLASSES.tierActions}>{headerAction}</section>}
        </>
      )}
    </>
  );
};

export default MembershipDetails;
