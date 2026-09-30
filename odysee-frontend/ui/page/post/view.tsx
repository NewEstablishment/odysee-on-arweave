import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import React from 'react';
import PostForm from 'component/publish/post/postForm';
import Page from 'component/page';
import YrblWalletEmpty from 'component/yrblWalletEmpty';
import Spinner from 'component/spinner';
import { useAppSelector } from 'redux/hooks';
import { selectBalance } from 'redux/selectors/wallet';
import { selectFetchingMyChannels } from 'redux/selectors/claims';

function PostPage() {
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
        <PostForm disabled={balance < 0.01} />
      )}
    </Page>
  );
}

export default PostPage;
