import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import React from 'react';
import UploadForm from 'component/publish/upload/uploadForm';
import Page from 'component/page';
import YrblWalletEmpty from 'component/yrblWalletEmpty';
import Spinner from 'component/spinner';
import { useAppSelector } from 'redux/hooks';
import { selectFetchingMyChannels } from 'redux/selectors/claims';
import { selectBalance } from 'redux/selectors/wallet';

function UploadPage() {
  const balance = useAppSelector(selectBalance);
  const fetchingChannels = useAppSelector(selectFetchingMyChannels);

  return (
    <Page noFooter>
      {balance < 0.01 && <YrblWalletEmpty />}
      {balance >= 0.01 && fetchingChannels ? (
        <div className={PAGE_MAIN_EMPTY_CLASS}>
          <Spinner />
        </div>
      ) : (
        <UploadForm disabled={balance < 0.01} />
      )}
    </Page>
  );
}

export default UploadPage;
