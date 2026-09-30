import React from 'react';
import '../../styles/chunks/memberships.css';
import withRouteStyleBoundary from 'component/common/route-style-boundary';
import * as PAGES from 'constants/pages';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import Button from 'component/button';
import Page from 'component/page';
import HelpHub from 'component/common/help-hub';
import { useNavigate } from 'react-router-dom';
import classnames from 'classnames';
import { MEMBERSHIPS_LANDING_CLASSES } from './classes';

const MembershipsLandingPage = () => {
  const navigate = useNavigate();

  function handleNavigateToPage(page: string) {
    navigate(`/$/${page}`);
  }

  return (
    <Page className={MEMBERSHIPS_LANDING_CLASSES.page}>
      <div className={MEMBERSHIPS_LANDING_CLASSES.header}>
        <div className={MEMBERSHIPS_LANDING_CLASSES.headerContent}>
          <h1 className={MEMBERSHIPS_LANDING_CLASSES.headerTitle}>
            <Icon icon={ICONS.MEMBERSHIP} size={10} />
            {__('Memberships')}
          </h1>
        </div>
      </div>

      <div className={MEMBERSHIPS_LANDING_CLASSES.content}>
        <div className={MEMBERSHIPS_LANDING_CLASSES.panels}>
          <div
            className={classnames(MEMBERSHIPS_LANDING_CLASSES.panel, MEMBERSHIPS_LANDING_CLASSES.supporterPanel)}
            onClick={() => handleNavigateToPage(PAGES.MEMBERSHIPS_SUPPORTER)}
          >
            <div
              className={classnames(
                MEMBERSHIPS_LANDING_CLASSES.panelContent,
                MEMBERSHIPS_LANDING_CLASSES.supporterContent
              )}
            >
              <div className={MEMBERSHIPS_LANDING_CLASSES.panelCard}>
                <h2 className={MEMBERSHIPS_LANDING_CLASSES.panelTitle}>{__('Donor Portal')}</h2>
                <p className={MEMBERSHIPS_LANDING_CLASSES.tagline}>{__('Find creators you like and support them.')}</p>
                <Button
                  button="primary"
                  navigate={`/$/${PAGES.MEMBERSHIPS_SUPPORTER}`}
                  label={__('Enter Donor Portal')}
                />
              </div>
            </div>
          </div>

          <div
            className={classnames(MEMBERSHIPS_LANDING_CLASSES.panel, MEMBERSHIPS_LANDING_CLASSES.creatorPanel)}
            onClick={() => handleNavigateToPage(PAGES.CREATOR_MEMBERSHIPS)}
          >
            <div
              className={classnames(
                MEMBERSHIPS_LANDING_CLASSES.panelContent,
                MEMBERSHIPS_LANDING_CLASSES.creatorContent
              )}
            >
              <div className={MEMBERSHIPS_LANDING_CLASSES.panelCard}>
                <h2 className={MEMBERSHIPS_LANDING_CLASSES.panelTitle}>{__('Creator Portal')}</h2>
                <p className={MEMBERSHIPS_LANDING_CLASSES.tagline}>
                  {__('Create memberships and have users subscribe to them to support you.')}
                </p>
                <Button
                  button="primary"
                  navigate={`/$/${PAGES.CREATOR_MEMBERSHIPS}`}
                  label={__('Manage Memberships')}
                />
              </div>
            </div>
          </div>
        </div>
        <HelpHub
          href="https://help.odysee.tv/category-memberships/"
          image="LadyFungus"
          text={__('What are Memberships? Lady Fungus can explain it in the %help_hub%.')}
        />
      </div>
    </Page>
  );
};

export default withRouteStyleBoundary(MembershipsLandingPage, 'memberships');
