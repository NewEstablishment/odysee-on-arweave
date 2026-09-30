import React from 'react';
import Page from 'component/page';
import WalletSwap from 'component/walletSwap';
import { SWAP_PAGE_CLASS } from './classes';
type Props = {};
export default function SwapPage(props: Props) {
  return (
    <Page
      noSideNavigation
      className={SWAP_PAGE_CLASS}
      backout={{
        backLabel: __('Done'),
        title: __('Swap Crypto'),
      }}
    >
      <WalletSwap />
    </Page>
  );
}
