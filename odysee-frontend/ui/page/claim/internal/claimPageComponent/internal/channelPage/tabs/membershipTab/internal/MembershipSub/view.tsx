import React from 'react';
import classnames from 'classnames';
import { Menu, MenuButton, MenuItem, MenuList } from 'component/common/menu';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import Card from 'component/common/card';
import Button from 'component/button';
import { formatDateToMonthAndDay } from 'util/time';
import * as MODALS from 'constants/modal_types';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectIndexForCreatorMembership } from 'redux/selectors/memberships';
import { selectChannelClaimIdForUri } from 'redux/selectors/claims';
import { selectArweaveTipDataForId } from 'redux/selectors/payments';
import { doOpenCancelationModalForMembership } from 'redux/actions/memberships';
import { doOpenModal } from 'redux/actions/app';
import { JOIN_MEMBERSHIP_CLASSES, JOIN_MEMBERSHIP_TIER_VARIABLE_CLASSES } from 'component/joinMembershipCard/classes';
import { MEMBERSHIP_TIER_CLASSES } from 'component/joinMembershipCard/internal/previewPage/internal/membershipTier/classes';

interface IProps {
  uri: string;
  membershipSub: MembershipSub;
}

function MembershipSubscribed(props: IProps) {
  const { uri, membershipSub } = props;
  const dispatch = useAppDispatch();
  const channelClaimId = useAppSelector((state) => selectChannelClaimIdForUri(state, uri));
  const membershipId = membershipSub ? membershipSub.membership.id : undefined;
  const membershipIndex = useAppSelector((state) =>
    selectIndexForCreatorMembership(state, channelClaimId, membershipId)
  );
  const tipsEnabled = useAppSelector((state) => selectArweaveTipDataForId(state, channelClaimId));

  if (!membershipSub) {
    return null;
  }

  const tierVariableClass = JOIN_MEMBERSHIP_TIER_VARIABLE_CLASSES[membershipIndex];
  const now = new Date();
  const subscriptionEndDate = membershipSub.subscription.ends_at;
  const subscriptionRenewalDate = membershipSub.subscription.earliest_renewal_at;
  const formattedEndOfMembershipDate = formatDateToMonthAndDay(new Date(subscriptionEndDate));
  const formattedRenewalMembershipDate = formatDateToMonthAndDay(new Date(subscriptionRenewalDate));
  const perks = membershipSub.perks;
  const isActive = membershipSub.subscription.is_active === true;
  const isCanceled = membershipSub.subscription.status === 'canceled';
  const pending = membershipSub?.payments && membershipSub.payments.some((p) => p.status === 'submitted');
  console.log('membershipSub', membershipSub);
  const canRenew =
    membershipSub.subscription.earliest_renewal_at &&
    now > new Date(membershipSub.subscription.earliest_renewal_at) &&
    !pending;
  return (
    <>
      <Card
        className={JOIN_MEMBERSHIP_CLASSES.subscriptionCard}
        body={
          <>
            <div className={classnames(JOIN_MEMBERSHIP_CLASSES.subscriptionBody, tierVariableClass)}>
              <div className={JOIN_MEMBERSHIP_CLASSES.subscriptionHeader}>
                <span className={JOIN_MEMBERSHIP_CLASSES.subscriptionHeaderName}>{membershipSub.membership.name}</span>

                {isActive && !isCanceled && (
                  <Menu>
                    <MenuButton className={classnames('menu__button', JOIN_MEMBERSHIP_CLASSES.subscriptionMenuButton)}>
                      <Icon size={18} icon={ICONS.SETTINGS} />
                    </MenuButton>
                    <MenuList className={classnames('menu__list', JOIN_MEMBERSHIP_CLASSES.tierMenu, tierVariableClass)}>
                      <MenuItem
                        className="comment__menu-option"
                        onSelect={() => dispatch(doOpenCancelationModalForMembership(membershipSub))}
                      >
                        <div className="menu__link">
                          <Icon size={16} icon={ICONS.DELETE} /> {__('Cancel Membership')}
                        </div>
                      </MenuItem>
                    </MenuList>
                  </Menu>
                )}
                {isCanceled && (
                  <Menu>
                    <MenuButton className={classnames('menu__button', JOIN_MEMBERSHIP_CLASSES.subscriptionMenuButton)}>
                      <Icon size={18} icon={ICONS.SETTINGS} />
                    </MenuButton>
                    <MenuList className={classnames('menu__list', JOIN_MEMBERSHIP_CLASSES.tierMenu, tierVariableClass)}>
                      <MenuItem
                        className="comment__menu-option"
                        onSelect={() => dispatch(doOpenCancelationModalForMembership(membershipSub))}
                      >
                        <div className="menu__link">
                          <Icon size={16} icon={ICONS.REFRESH} /> {__('Restore Membership')}
                        </div>
                      </MenuItem>
                    </MenuList>
                  </Menu>
                )}
              </div>

              <div className={JOIN_MEMBERSHIP_CLASSES.subscriptionContent}>
                <div className={JOIN_MEMBERSHIP_CLASSES.subscriptionContentGroup}>
                  <label>{__('Creator revenue')}</label>
                  <span>${(membershipSub.subscription.current_price.amount / 100).toFixed(2)}</span>

                  <label>{__('Total Monthly Cost')}</label>
                  <span>{`$${(membershipSub.subscription.current_price.amount / 100).toFixed(2)}`}</span>

                  <label>{__('Description')}</label>
                  <span>{membershipSub.membership.description}</span>
                </div>

                {perks && (
                  <div
                    className={classnames(
                      MEMBERSHIP_TIER_CLASSES.perks,
                      JOIN_MEMBERSHIP_CLASSES.subscriptionContentGroup
                    )}
                  >
                    <label>{__('Odysee Perks')}</label>

                    <ul className={MEMBERSHIP_TIER_CLASSES.perksList}>
                      {perks.map((tierPerk, i) => (
                        <li
                          key={i}
                          className={classnames(
                            MEMBERSHIP_TIER_CLASSES.perksItem,
                            JOIN_MEMBERSHIP_CLASSES.subscriptionPerk
                          )}
                        >
                          {__(tierPerk.name)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className={JOIN_MEMBERSHIP_CLASSES.subscriptionActions}>
                  {tipsEnabled &&
                    (isActive && !isCanceled ? (
                      canRenew ? (
                        <Button
                          className={JOIN_MEMBERSHIP_CLASSES.subscriptionActionButton}
                          icon={ICONS.MEMBERSHIP}
                          button="primary"
                          label={__('Renew for $%membership_price% this month', {
                            membership_price: (membershipSub.subscription.current_price.amount / 100).toFixed(
                              membershipSub?.subscription.current_price.amount < 100 ? 2 : 0
                            ), // tiers
                          })}
                          onClick={() => {
                            dispatch(
                              doOpenModal(MODALS.JOIN_MEMBERSHIP, {
                                uri,
                                membershipIndex: membershipIndex,
                                passedTierIndex: membershipIndex,
                                isChannelTab: true,
                                isRenewal: true,
                              })
                            );
                          }}
                          disabled={false}
                        />
                      ) : (
                        <label>
                          {pending
                            ? __('Renewal being processed')
                            : __('You can renew this membership on or after %renewal_date%', {
                                renewal_date: formattedRenewalMembershipDate,
                              })}
                        </label>
                      )
                    ) : (
                      <label>
                        {__('Your cancelled membership will end on %end_date%.', {
                          end_date: formattedEndOfMembershipDate,
                        })}
                      </label>
                    ))}
                  {!tipsEnabled && (
                    <div>Enjoy this legacy membership while the creator onboards the new tip system</div>
                  )}
                </div>
              </div>
            </div>
          </>
        }
      />
    </>
  );
}

export default MembershipSubscribed;
