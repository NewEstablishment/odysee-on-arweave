import React from 'react';
import Page from 'component/page';
import LbcSymbol from 'component/common/lbc-symbol';
import WalletAddress from 'component/walletAddress';
import { RECEIVE_PAGE_CLASS } from './classes';
type Props = {};
export default function ReceivePage(props: Props) {
  return (
    <Page
      noSideNavigation
      className={RECEIVE_PAGE_CLASS}
      backout={{
        backLabel: __('Done'),
        title: (
          <>
            <LbcSymbol prefix={__('Receive')} size={28} />
          </>
        ),
      }}
    >
      <WalletAddress />
    </Page>
  );
}
