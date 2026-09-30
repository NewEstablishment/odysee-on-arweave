import * as React from 'react';
import Page from 'component/page';
import Button from 'component/button';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import CreditCards from './credit-card-logos.png';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { HELP_CLASS } from 'component/common/help-classes';
export default function CheckoutPage() {
  return (
    <Page authPage>
      <Card
        title={__('Checkout')}
        subtitle={__('Your cart contains 1 item.')}
        body={
          <div className={`${CARD_CLASSES.inline} ${CARD_CLASSES.section} tw:bg-app-card-highlighted`}>
            <strong>{__('lbry.tv Premium - 1 month')}</strong>
            <div>$5 per month</div>
          </div>
        }
        actions={
          <div className={SECTION_CLASSES.actions}>
            <Button button="primary" label={__('Checkout')} />
            <div>
              <img
                src={CreditCards}
                style={{
                  height: '1.5rem',
                }}
              />
            </div>
            <div className={HELP_CLASS}>We will refund no questions asked within 30 days.</div>
          </div>
        }
      />
    </Page>
  );
}
