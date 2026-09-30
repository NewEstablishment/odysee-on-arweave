import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'component/common/tabs';
import { lazyImport } from 'util/lazyImport';
import { useAppSelector } from 'redux/hooks';
import { selectActiveChannelClaim } from 'redux/selectors/app';
import { selectMyChannelClaimIds, selectMyChannelClaims } from 'redux/selectors/claims';
import HelpHub from 'component/common/help-hub';
import * as PAGES from 'constants/pages';
import * as ICONS from 'constants/icons';
import Page from 'component/page';
import ChannelSelector from 'component/channelSelector';
import Spinner from 'component/spinner';
import Button from 'component/button';
import { SUPPORTER_MEMBERSHIP_CLASSES } from './classes';
import { SECTION_CLASSES } from 'component/common/section-classes';
const PledgesTab = lazyImport(
  () =>
    import(
      './pledgesTab'
      /* webpackChunkName: "pledgesTab" */
    )
);
const PaymentsTab = lazyImport(
  () =>
    import(
      './paymentsTab'
      /* webpackChunkName: "outgoingPaymentsTab" */
    )
);
const TAB_QUERY = 'tab';
const TABS = {
  OVERVIEW: 'overview',
  PAYMENTS: 'payments',
};

const SupporterArea = () => {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [allSelected, setAllSelected] = React.useState(true);

  const activeChannelClaim = useAppSelector(selectActiveChannelClaim);
  const myChannelClaims = useAppSelector(selectMyChannelClaims);
  const myChannelIds = useAppSelector(selectMyChannelClaimIds);

  const channelsToList = React.useMemo(() => {
    if (!myChannelClaims) return myChannelClaims;
    if (!activeChannelClaim) return activeChannelClaim;
    if (allSelected) return myChannelClaims;
    return [activeChannelClaim];
  }, [activeChannelClaim, allSelected, myChannelClaims]);

  if (activeChannelClaim === undefined) {
    return (
      <Page>
        <div className={PAGE_MAIN_EMPTY_CLASS}>
          <Spinner />
        </div>
      </Page>
    );
  }

  const urlParams = new URLSearchParams(search);
  // if tiers are saved, then go to balance, otherwise go to tiers
  const currentView = urlParams.get(TAB_QUERY) || TABS.OVERVIEW;
  // based on query param or default, update value which will determine which tab to show
  let tabIndex = 0;

  switch (currentView) {
    case TABS.OVERVIEW:
      tabIndex = 0;
      break;

    case TABS.PAYMENTS:
      tabIndex = 1;
      break;
  }

  function onTabChange(newTabIndex) {
    let url = `/$/${PAGES.MEMBERSHIPS_SUPPORTER}?`;

    if (newTabIndex === 0) {
      url += `${TAB_QUERY}=${TABS.OVERVIEW}`;
    } else if (newTabIndex === 1) {
      url += `${TAB_QUERY}=${TABS.PAYMENTS}`;
    }

    navigate(url);
  }

  return (
    <Page className={SUPPORTER_MEMBERSHIP_CLASSES.page}>
      <div className={SUPPORTER_MEMBERSHIP_CLASSES.header}>
        <div className={SUPPORTER_MEMBERSHIP_CLASSES.headerContent}>
          <Button
            className={SUPPORTER_MEMBERSHIP_CLASSES.headerBackButton}
            navigate={`/$/${PAGES.MEMBERSHIPS_LANDING}`}
            icon={ICONS.BACK}
            button="liquidass"
          />
          <div className={SUPPORTER_MEMBERSHIP_CLASSES.headerTitle}>{__('Donor Portal')}</div>
        </div>
      </div>
      <Tabs className={SUPPORTER_MEMBERSHIP_CLASSES.tabs} onChange={onTabChange} index={tabIndex}>
        <div className={SUPPORTER_MEMBERSHIP_CLASSES.tabWrapper}>
          <TabList className={SUPPORTER_MEMBERSHIP_CLASSES.tabList}>
            <Tab
              className={SUPPORTER_MEMBERSHIP_CLASSES.tab}
              aria-selected={tabIndex === 0}
              onClick={() => onTabChange(0)}
            >
              {__('Overview')}
            </Tab>
            <Tab
              className={SUPPORTER_MEMBERSHIP_CLASSES.tab}
              aria-selected={tabIndex === 1}
              onClick={() => onTabChange(1)}
            >
              {__('Payments')}
            </Tab>
          </TabList>
        </div>

        <TabPanels>
          <TabPanel className={SUPPORTER_MEMBERSHIP_CLASSES.tabPanel}>
            <PledgesTab />
            <HelpHub
              href="https://help.odysee.tv/category-memberships/donorportal"
              image="LadyFungus"
              text={__('What are these donations? Lady Fungus can explain it in the %help_hub%.')}
            />
          </TabPanel>

          <TabPanel className={SUPPORTER_MEMBERSHIP_CLASSES.tabPanel}>
            <>
              <span className={SECTION_CLASSES.subtitle}>{__('Membership Payments for Channel')}</span>
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
              <PaymentsTab channelsToList={channelsToList} />
            </>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Page>
  );
};

export default SupporterArea;
