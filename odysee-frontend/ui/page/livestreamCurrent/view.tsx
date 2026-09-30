import React from 'react';
import LivestreamList from 'component/livestreamList';
import Button from 'component/button';
import Page from 'component/page';
import Yrbl from 'component/yrbl';
import { useAppSelector } from 'redux/hooks';
import { selectUser } from 'redux/selectors/user';
import { SECTION_CLASSES } from 'component/common/section-classes';

export default function LivestreamCurrentPage() {
  const user = useAppSelector(selectUser);
  const canView = process.env.ENABLE_WIP_FEATURES || (user && user.global_mod);
  return (
    <Page>
      {canView ? (
        <LivestreamList />
      ) : (
        <Yrbl
          type="sad"
          title={__("This page isn't quite ready")}
          subtitle={__('Check back later.')}
          actions={
            <div className={SECTION_CLASSES.actions}>
              <Button button="primary" navigate="/" label={__('Go Home')} />
            </div>
          }
        />
      )}
    </Page>
  );
}
