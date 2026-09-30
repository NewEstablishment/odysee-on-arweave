import React from 'react';
import classnames from 'classnames';
import Symbol from 'component/common/symbol';
import { Menu, MenuButton, MenuList, MenuItem } from 'component/common/menu';
import * as ICONS from 'constants/icons';
import * as MODALS from 'constants/modal_types';
import Icon from 'component/common/icon';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doOpenModal as doOpenModalAction } from 'redux/actions/app';
import {
  doDeactivateMembershipForId as doDeactivateMembershipForIdAction,
  doMembershipList as doMembershipListAction,
} from 'redux/actions/memberships';
import { doToast as doToastAction } from 'redux/actions/notifications';
import { selectArweaveExchangeRates } from 'redux/selectors/arwallet';
import { JOIN_MEMBERSHIP_CLASSES, JOIN_MEMBERSHIP_TIER_VARIABLE_CLASSES } from 'component/joinMembershipCard/classes';
import { MEMBERSHIP_TIER_CLASSES } from 'component/joinMembershipCard/internal/previewPage/internal/membershipTier/classes';
type Props = {
  membership: CreatorMembership;
  index: number;
  hasSubscribers: boolean | null | undefined;
  addEditingId: () => void;
  removeMembership: () => void;
};

function MembershipTier(props: Props) {
  const { membership, index, hasSubscribers, addEditingId, removeMembership } = props;
  const dispatch = useAppDispatch();
  const exchangeRate = useAppSelector(selectArweaveExchangeRates);
  const doOpenModal = (modalId: string, modalProps: {}) => dispatch(doOpenModalAction(modalId, modalProps));
  const doToast = (params: ToastParams) => dispatch(doToastAction(params));
  const doDeactivateMembershipForId = (membershipId: number | null | undefined) =>
    dispatch(doDeactivateMembershipForIdAction(membershipId));
  const doMembershipList = (params: MembershipListParams) => dispatch(doMembershipListAction(params));
  const tierVariableClass = JOIN_MEMBERSHIP_TIER_VARIABLE_CLASSES[index];
  return (
    <>
      <div className={MEMBERSHIP_TIER_CLASSES.header}>
        <span className={MEMBERSHIP_TIER_CLASSES.headerName}>
          {`${membership.name} ${membership.enabled ? '' : __('(Disabled)')}`}
        </span>
        {membership.enabled === true && (
          <Menu>
            <MenuButton className={classnames('menu__button', MEMBERSHIP_TIER_CLASSES.headerMenuButton)}>
              <Icon size={18} icon={ICONS.SETTINGS} />
            </MenuButton>

            <MenuList className={classnames('menu__list', JOIN_MEMBERSHIP_CLASSES.tierMenu, tierVariableClass)}>
              <MenuItem className="comment__menu-option" onSelect={addEditingId}>
                <div className="menu__link">
                  <Icon size={16} icon={ICONS.EDIT} />
                  {__('Edit Tier')}
                </div>
              </MenuItem>

              <MenuItem
                className="comment__menu-option"
                onSelect={() =>
                  hasSubscribers
                    ? doToast({
                        message: __('This membership has active subscribers and cannot be deleted.'),
                        isError: true,
                      })
                    : doOpenModal(MODALS.CONFIRM, {
                        title: __('Confirm Membership Deletion'),
                        subtitle: __('Are you sure you want to delete yor "%membership_name%" membership?', {
                          membership_name: membership.name,
                        }),
                        busyMsg: __('Deleting your membership...'),
                        onConfirm: (closeModal, setIsBusy) => {
                          setIsBusy(true);
                          doDeactivateMembershipForId(membership.membership_id)
                            .then(() => {
                              setIsBusy(false);
                              doToast({
                                message: __('Your membership was successfully deleted.'),
                              });
                              removeMembership();
                              closeModal();
                              doMembershipList({
                                channel_claim_id: membership.channel_claim_id ?? '',
                              });
                            })
                            .catch(() => setIsBusy(false));
                        },
                      })
                }
              >
                <div className="menu__link">
                  <Icon size={16} icon={ICONS.DELETE} />
                  {__('Delete Tier')}
                </div>
              </MenuItem>
            </MenuList>
          </Menu>
        )}
      </div>

      <div className="membership-tier__infos">
        {membership.description && (
          <span className={JOIN_MEMBERSHIP_CLASSES.detailsDescription}>{membership.description}</span>
        )}
        <label>{__('Pledge')}</label>
        <span>
          ${(Number(membership?.prices[0].amount) / 100).toFixed(2)} (
          <Symbol
            token="ar"
            amount={Number((Number(membership?.prices[0].amount) / 100).toFixed(2)) / exchangeRate.ar}
          />
          )
        </span>{' '}
        {/* the ui basically supports monthly right now */}
        <div className={MEMBERSHIP_TIER_CLASSES.perks}>
          <div className="membership-tier__perks-content">
            <label>{__('Odysee Perks')}</label>
            <ul className={MEMBERSHIP_TIER_CLASSES.perksList}>
              {membership.perks &&
                membership.perks.map((tierPerk, i) => (
                  <li
                    className={classnames(
                      MEMBERSHIP_TIER_CLASSES.perksItem,
                      MEMBERSHIP_TIER_CLASSES.perksItemTierColor,
                      MEMBERSHIP_TIER_CLASSES.perksItemMuted
                    )}
                    key={i}
                  >
                    {__(tierPerk.description)}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

export default MembershipTier;
