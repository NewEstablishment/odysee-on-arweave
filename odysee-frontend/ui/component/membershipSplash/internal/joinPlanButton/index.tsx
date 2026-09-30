import React from 'react';
import * as PAGES from 'constants/pages';
import Button from 'component/button';
import withCreditCard from 'hocs/withCreditCard';
import { MEMBERSHIP_SPLASH_CLASSES } from '../../classes';
type Props = {
  pageLocation?: string;
  interval: string;
  plan: string;
  doOpenModal?: boolean;
};

const JoinButton = (props: Props) => {
  const { pageLocation, interval, plan } = props;
  return (
    <Button
      button="primary"
      className={MEMBERSHIP_SPLASH_CLASSES.joinButton}
      label={__('Join')}
      labelClassName={MEMBERSHIP_SPLASH_CLASSES.joinButtonLabel}
      navigate={`/$/${PAGES.ODYSEE_MEMBERSHIP}?interval=${interval}&plan=${plan}&pageLocation=${pageLocation}&`}
    />
  );
};

export default withCreditCard(JoinButton);
