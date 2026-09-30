import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { NavLink } from 'react-router-dom';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'component/common/tabs';
import { lazyImport } from 'util/lazyImport';
import { formatLbryUrlForWeb } from 'util/url';
import * as PAGES from 'constants/pages';
import * as ICONS from 'constants/icons';
import PageComponent from 'component/page';
import ChannelSelectorComponent from 'component/channelSelector';

const Page = PageComponent as React.ComponentType<any>;
const ChannelSelector = ChannelSelectorComponent as React.ComponentType<any>;
import Button from 'component/button';
import TabWrapper from './internal/tabWrapper';
import { LocalStorage } from '../../../util/storage';
import { SETTINGS } from 'constants/icons';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectActiveChannelClaim } from 'redux/selectors/app';
import { selectMyChannelClaimIds, selectMyChannelClaims } from 'redux/selectors/claims';
import { selectMySupportersList } from 'redux/selectors/memberships';
import {
  doListAllMyMembershipTiers as doListAllMyMembershipTiersAction,
  doGetMembershipSupportersList as doGetMembershipSupportersListAction,
} from 'redux/actions/memberships';
import { selectArweaveDefaultAccountMonetizationEnabled } from 'redux/selectors/payments';
import { CREATOR_MEMBERSHIP_CLASSES } from './classes';
import { SECTION_CLASSES } from 'component/common/section-classes';
const OverviewTab = lazyImport(
  () =>
    import(
      './internal/overviewTab'
      /* webpackChunkName: "overviewTab" */
    )
) as React.ComponentType<any>;
const TiersTab = lazyImport(
  () =>
    import(
      './internal/tiersTab'
      /* webpackChunkName: "tiersTab" */
    )
) as React.ComponentType<any>;
const SupportersTab = lazyImport(
  () =>
    import(
      './internal/supportersTab'
      /* webpackChunkName: "supportersTab" */
    )
) as React.ComponentType<any>;
const PaymentsTab = lazyImport(() => import('./internal/paymentsTab')) as React.ComponentType<any>;
const TAB_QUERY = 'tab';
const TABS = {
  OVERVIEW: 'overview',
  SUPPORTERS: 'supporters',
  TIERS: 'tiers',
  PAYMENTS: 'payments',
};
type Props = {};

const CreatorArea = (props: Props) => {
  const dispatch = useAppDispatch();
  const activeChannelClaim = useAppSelector(selectActiveChannelClaim);
  const myChannelIds = useAppSelector(selectMyChannelClaimIds);
  const myChannelClaims = useAppSelector(selectMyChannelClaims);
  const supportersList = useAppSelector(selectMySupportersList);
  const monetizationEnabled = useAppSelector(selectArweaveDefaultAccountMonetizationEnabled);
  const doListAllMyMembershipTiers = () => dispatch(doListAllMyMembershipTiersAction());
  const doGetMembershipSupportersList = () => dispatch(doGetMembershipSupportersListAction());
  const navigate = useNavigate();

  const [allSelected, setAllSelected] = React.useState(false);
  const [ackInfo, setAckInfo] = React.useState(true);

  const handleAckArPaymentsInfo = (value: boolean) => setAckInfo(value);

  const disabledMessage = __('Monetization is not enabled. Please set up your wallet first.');

  const channelsToList = allSelected ? myChannelClaims : activeChannelClaim ? [activeChannelClaim] : null;
  const previewChannelClaim = activeChannelClaim || myChannelClaims?.[0];
  const { search } = useLocation();
  const urlParams = new URLSearchParams(search);
  // if tiers are saved, then go to balance, otherwise go to tiers
  const currentView = urlParams.get(TAB_QUERY) || TABS.OVERVIEW;
  // based on query param or default, update value which will determine which tab to show
  let tabIndex = 0;

  switch (currentView) {
    case TABS.OVERVIEW:
      tabIndex = 0;
      break;

    case TABS.SUPPORTERS:
      tabIndex = 1;
      break;

    case TABS.TIERS:
      tabIndex = 2;
      break;

    case TABS.PAYMENTS:
      tabIndex = 3;
      break;
  }

  function onTabChange(newTabIndex: number) {
    let url = `/$/${PAGES.CREATOR_MEMBERSHIPS}?`;

    if (newTabIndex === 0) {
      url += `${TAB_QUERY}=${TABS.OVERVIEW}`;
    } else if (newTabIndex === 1) {
      url += `${TAB_QUERY}=${TABS.SUPPORTERS}`;
    } else if (newTabIndex === 2) {
      url += `${TAB_QUERY}=${TABS.TIERS}`;
    } else if (newTabIndex === 3) {
      url += `${TAB_QUERY}=${TABS.PAYMENTS}`;
    }

    navigate(url);
  }

  React.useEffect(() => {
    if (myChannelClaims) {
      doListAllMyMembershipTiers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fetch after channel claims resolve.
  }, [myChannelClaims]);

  React.useEffect(() => {
    if (supportersList === undefined) {
      doGetMembershipSupportersList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fetch when supporters have not resolved.
  }, [supportersList]);

  const onChannelOverviewSelect = () => {
    setAllSelected(false);
    onTabChange(1);
  };

  const switchToTiersTab = () => onTabChange(2);

  return (
    <Page className={CREATOR_MEMBERSHIP_CLASSES.page}>
      <div className={CREATOR_MEMBERSHIP_CLASSES.header}>
        <div className={CREATOR_MEMBERSHIP_CLASSES.headerContent}>
          <Button
            className={CREATOR_MEMBERSHIP_CLASSES.headerBackButton}
            navigate={`/$/${PAGES.MEMBERSHIPS_LANDING}`}
            icon={ICONS.BACK}
            button="liquidass"
          />
          <div className={CREATOR_MEMBERSHIP_CLASSES.headerTitle}>{__('Creator Portal')}</div>
        </div>
        <div className={CREATOR_MEMBERSHIP_CLASSES.headerActions}>
          <Button
            button={'secondary'}
            label={!ackInfo ? 'X' : 'Help'}
            onClick={() => {
              handleAckArPaymentsInfo(!ackInfo);
            }}
          />
        </div>
      </div>
      {!ackInfo && (
        <div className={CREATOR_MEMBERSHIP_CLASSES.explainer}>
          <h1>New Payments Info</h1>
          <div>
            <p>
              {__(
                'Once you connect a new payment wallet, your subscribers will have one week to renew their membership.'
              )}
            </p>
            <p>
              {' '}
              {__('You can now edit your existing tiers with a lower price, down to $0.1. Cannot make it higher.')}
            </p>
            <p>
              {__(
                'If you need help bulk re-setting up members only content after adding new tiers or making changes, email us at hello@odysee.com'
              )}
            </p>
          </div>
          <Button
            button={'primary'}
            label={'Got it'}
            onClick={() => {
              handleAckArPaymentsInfo(true);
            }}
          />
        </div>
      )}

      <Tabs className={CREATOR_MEMBERSHIP_CLASSES.tabs} onChange={onTabChange} index={tabIndex}>
        <div className={CREATOR_MEMBERSHIP_CLASSES.tabWrapper}>
          <TabList className={CREATOR_MEMBERSHIP_CLASSES.tabList}>
            <Tab
              className={CREATOR_MEMBERSHIP_CLASSES.tab}
              aria-selected={tabIndex === 0}
              onClick={() => onTabChange(0)}
            >
              {__('Overview')}
            </Tab>
            <Tab
              className={CREATOR_MEMBERSHIP_CLASSES.tab}
              aria-selected={tabIndex === 1}
              onClick={() => onTabChange(1)}
            >
              {__('My Supporters')}
            </Tab>
            <Tab
              className={CREATOR_MEMBERSHIP_CLASSES.tab}
              aria-selected={tabIndex === 2}
              onClick={() => onTabChange(2)}
            >
              {__('My Tiers')}
            </Tab>
            <Tab
              className={CREATOR_MEMBERSHIP_CLASSES.tab}
              aria-selected={tabIndex === 3}
              onClick={() => onTabChange(3)}
            >
              {__('Payments')}
            </Tab>
          </TabList>
        </div>

        <TabPanels>
          <TabPanel className={CREATOR_MEMBERSHIP_CLASSES.tabPanel}>
            <TabWrapper
              switchToTiersTab={switchToTiersTab}
              component={
                <>
                  {!monetizationEnabled && (
                    <div className={CREATOR_MEMBERSHIP_CLASSES.help}>
                      <p>{disabledMessage}</p>
                      <NavLink to="/$/wallet">Set up wallet</NavLink>
                    </div>
                  )}
                  <OverviewTab onChannelSelect={onChannelOverviewSelect} />
                </>
              }
            />
          </TabPanel>

          <TabPanel className={CREATOR_MEMBERSHIP_CLASSES.tabPanel}>
            <TabWrapper
              switchToTiersTab={switchToTiersTab}
              component={
                <>
                  {!monetizationEnabled && (
                    <div className={CREATOR_MEMBERSHIP_CLASSES.help}>
                      <p>{disabledMessage}</p>
                      <NavLink to="/$/wallet">Set up wallet</NavLink>
                    </div>
                  )}
                  <span className={SECTION_CLASSES.subtitle}>{__('Choose what channel to list supporters for')}</span>
                  <ChannelSelector
                    hideAnon
                    allOptionProps={{
                      onSelectAll: () => setAllSelected(true),
                      isSelected: allSelected,
                    }}
                    onChannelSelect={() => setAllSelected(false)}
                  />

                  <SupportersTab channelsToList={channelsToList} switchToTiersTab={switchToTiersTab} />
                </>
              }
            />
          </TabPanel>

          <TabPanel className={CREATOR_MEMBERSHIP_CLASSES.tabPanel}>
            <TabWrapper
              component={
                <>
                  {!monetizationEnabled && (
                    <div className={CREATOR_MEMBERSHIP_CLASSES.help}>
                      <p>{disabledMessage}</p>
                      <NavLink to="/$/wallet">Set up wallet</NavLink>
                    </div>
                  )}
                  <div className={CREATOR_MEMBERSHIP_CLASSES.tierHeader}>
                    <div className={CREATOR_MEMBERSHIP_CLASSES.tierSelector}>
                      <span className={SECTION_CLASSES.subtitle}>{__('Choose what channel to manage tiers for')}</span>
                      <ChannelSelector
                        hideAnon
                        onChannelSelect={() => {
                          setAllSelected(false);
                        }}
                      />
                    </div>

                    <div className={CREATOR_MEMBERSHIP_CLASSES.tierPreview}>
                      <span className={SECTION_CLASSES.subtitle}>{__('Preview your tiers')}</span>
                      <br />
                      <Button
                        navigate={`${formatLbryUrlForWeb(previewChannelClaim?.canonical_url)}?view=membership`}
                        label={__('See Your Memberships')}
                        icon={ICONS.BACK}
                        button="secondary"
                      />
                    </div>
                  </div>

                  <TiersTab />
                </>
              }
            />
          </TabPanel>
          <TabPanel className={CREATOR_MEMBERSHIP_CLASSES.tabPanel}>
            <TabWrapper
              component={
                <>
                  {!monetizationEnabled && (
                    <div className={CREATOR_MEMBERSHIP_CLASSES.help}>
                      <p>{disabledMessage}</p>
                      <NavLink to="/$/wallet">Set up wallet</NavLink>
                    </div>
                  )}
                  <div className={CREATOR_MEMBERSHIP_CLASSES.tierHeader}>
                    <div className={CREATOR_MEMBERSHIP_CLASSES.tierSelector}>
                      <span className={SECTION_CLASSES.subtitle}>{__('Memberships for Channel...')}</span>
                      <ChannelSelector
                        channelIds={myChannelIds}
                        hideCreateNew
                        allOptionProps={{
                          onSelectAll: () => setAllSelected(true),
                          isSelected: allSelected,
                        }}
                        hideAnon
                        onChannelSelect={() => setAllSelected(false)}
                      />
                    </div>
                  </div>

                  <PaymentsTab channelsToList={channelsToList} />
                </>
              }
            />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Page>
  );
};

export default CreatorArea;
