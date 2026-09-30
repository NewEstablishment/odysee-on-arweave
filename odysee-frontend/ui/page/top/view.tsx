import React from 'react';
import classnames from 'classnames';
import Page from 'component/page';
import ClaimListDiscover from 'component/claimListDiscover';
import ClaimEffectiveAmount from 'component/claimEffectiveAmount';
import SearchTopClaim from 'component/searchTopClaim';
import * as CS from 'constants/claim_search';
import Button from 'component/button';
import { BUTTON_TOGGLE_ACTIVE_CLASS, BUTTON_TOGGLE_CLASS } from 'component/button/classes';
import * as MODALS from 'constants/modal_types';
import { useLocation } from 'react-router-dom';
import { useAppDispatch } from 'redux/hooks';
import { doBeginPublish } from 'redux/actions/publish';
import { doOpenModal } from 'redux/actions/app';
import { TOP_SEARCH_LINKS_CLASS } from './classes';
import { CLAIM_PREVIEW_CUSTOM_PROPERTIES_CLASS } from 'component/claimPreview/classes';
import { CLAIM_SEARCH_MENU_GROUP_CLASS } from 'component/claimListHeader/classes';
import { EMPTY_CENTERED_CLASS } from 'component/common/empty-classes';
import { HELP_INLINE_CLASS } from 'component/common/help-classes';

function TopPage() {
  const dispatch = useAppDispatch();
  const { search } = useLocation();
  const urlParams = new URLSearchParams(search);
  const name = urlParams.get('name') || '';
  const [channelActive, setChannelActive] = React.useState(false);
  // if the query was actually '@name', still offer repost for 'name'
  const queryName = name && name[0] === '@' ? name.slice(1) : name;

  if (!name) {
    return (
      <Page className="topPage-wrapper">
        <div className={EMPTY_CENTERED_CLASS}>{__('No results')}</div>
      </Page>
    );
  }

  return (
    <Page className="topPage-wrapper">
      <SearchTopClaim query={name} hideLink setChannelActive={setChannelActive} isSearching={false} />
      <ClaimListDiscover
        tileLayout={false}
        name={channelActive ? `@${queryName}` : queryName}
        defaultFreshness={CS.FRESH_ALL}
        defaultOrderBy={CS.ORDER_BY_TOP}
        streamType={CS.CONTENT_ALL}
        meta={
          <div className={TOP_SEARCH_LINKS_CLASS}>
            <Button
              button="secondary"
              onClick={() => dispatch(doOpenModal(MODALS.REPOST, {}))}
              label={__('Repost Here')}
            />
            <Button
              button="secondary"
              onClick={() => dispatch(doBeginPublish('file', queryName))}
              label={__('Publish Here')}
            />
          </div>
        }
        includeSupportAction
        renderProperties={(claim) => (
          <span className={CLAIM_PREVIEW_CUSTOM_PROPERTIES_CLASS} data-claim-preview-custom-properties>
            {claim.meta.is_controlling && <span className={HELP_INLINE_CLASS}>{__('Currently winning')}</span>}
            <ClaimEffectiveAmount uri={(claim as any).repost_url || claim.canonical_url} />
          </span>
        )}
        header={
          <div className={CLAIM_SEARCH_MENU_GROUP_CLASS}>
            <Button
              label={queryName}
              button="alt"
              onClick={() => setChannelActive(false)}
              className={classnames(BUTTON_TOGGLE_CLASS, {
                [BUTTON_TOGGLE_ACTIVE_CLASS]: !channelActive,
              })}
            />
            <Button
              label={`@${queryName}`}
              button="alt"
              onClick={() => setChannelActive(true)}
              className={classnames(BUTTON_TOGGLE_CLASS, {
                [BUTTON_TOGGLE_ACTIVE_CLASS]: channelActive,
              })}
            />
          </div>
        }
      />
    </Page>
  );
}

export default TopPage;
