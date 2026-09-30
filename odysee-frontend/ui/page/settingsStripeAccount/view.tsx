import React from 'react';
import Button from 'component/button';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import Page from 'component/page';
import * as ICONS from 'constants/icons';
import * as PAGES from 'constants/pages';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { TABLE_HEADER_TEXT_CLASS } from 'component/common/table-classes';

const StripeAccountConnection = () => {
  return (
    <Page
      noFooter
      noSideNavigation
      settingsPage
      className="card-stack"
      backout={{
        title: __('Legacy Payout Settings'),
        backLabel: __('Back'),
      }}
    >
      <Card
        title={<div className={TABLE_HEADER_TEXT_CLASS}>{__('Fiat payout accounts retired')}</div>}
        background
        isBodyList
        body={
          <div className={CARD_CLASSES.bodyActions}>
            <h3 className="tw:mb-app-xs">{__('Stripe-based payout accounts are no longer supported.')}</h3>
            <p>
              {__(
                'If you still have legacy fiat payout data attached to your account, it is now read-only and no longer managed from this app.'
              )}
            </p>
            <p>{__('Use wallet and Arweave account flows for any active creator payout setup.')}</p>
          </div>
        }
        actions={
          <div className={SECTION_CLASSES.actions}>
            <Button button="secondary" label={__('Open Wallet')} icon={ICONS.WALLET} navigate={`/$/${PAGES.WALLET}`} />
            <Button
              button="primary"
              icon={ICONS.AR}
              label={__('Open Arweave Account')}
              navigate={`/$/${PAGES.ARACCOUNT}`}
            />
          </div>
        }
      />
    </Page>
  );
};

export default StripeAccountConnection;
