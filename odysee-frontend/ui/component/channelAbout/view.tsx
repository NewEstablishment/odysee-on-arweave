import React, { Fragment } from 'react';
import DeferredMarkdown from 'component/common/deferredMarkdown';
import ClaimTags from 'component/claimTags';
import CreditAmount from 'component/common/credit-amount';
import Button from 'component/button';
import * as PAGES from 'constants/pages';
import DateTime from 'component/dateTime';
import YoutubeBadge from 'component/youtubeBadge';
import SUPPORTED_LANGUAGES from 'constants/supported_languages';
import { makeSelectMetadataItemForUri, makeSelectClaimForUri } from 'redux/selectors/claims';
import { selectUser } from 'redux/selectors/user';
import { useAppSelector } from 'redux/hooks';
import { CARD_CLASSES } from 'component/common/card-classes';
import { MEDIA_INFO_TEXT_CLASS, MEDIA_INFO_TEXT_CONSTRAINED_CLASS } from 'component/common/media-classes';

type Props = {
  uri: string;
};

const formatEmail = (email: string) => {
  if (email) {
    const protocolRegex = new RegExp('^mailto:', 'i');
    const protocol = protocolRegex.exec(email);
    return protocol ? email : `mailto:${email}`;
  }

  return null;
};

const formatWebsite = (website: string) => {
  if (!website) {
    return null;
  }

  return /^(https?:)?\/\//i.test(website) ? website : `https://${website}`;
};

function ChannelAbout(props: Props) {
  const { uri } = props;

  const claim = useAppSelector((state) => makeSelectClaimForUri(uri)(state));
  const description = useAppSelector((state) => makeSelectMetadataItemForUri(uri, 'description')(state));
  const website = useAppSelector((state) => makeSelectMetadataItemForUri(uri, 'website_url')(state));
  const email = useAppSelector((state) => makeSelectMetadataItemForUri(uri, 'email')(state));
  const languages = useAppSelector((state) => makeSelectMetadataItemForUri(uri, 'languages')(state));
  const user = useAppSelector(selectUser);
  const claimId = claim && claim.claim_id;
  const canView = user && user.global_mod;
  return (
    <div className="card">
      <section className={`section ${CARD_CLASSES.section}`}>
        <Fragment>
          {description && (
            <>
              <label>{__('Description')}</label>
              <div className={`${MEDIA_INFO_TEXT_CLASS} ${MEDIA_INFO_TEXT_CONSTRAINED_CLASS}`}>
                <DeferredMarkdown content={description} />
              </div>
            </>
          )}
          {email && (
            <Fragment>
              <label>{__('Contact')}</label>
              <div className={MEDIA_INFO_TEXT_CLASS}>
                <a href={formatEmail(email) || undefined}>{email}</a>
              </div>
            </Fragment>
          )}
          {website && (
            <Fragment>
              <label>{__('Site')}</label>
              <div className={MEDIA_INFO_TEXT_CLASS}>
                <a href={formatWebsite(website) || undefined} target="_blank" rel="noopener noreferrer">
                  {website}
                </a>
              </div>
            </Fragment>
          )}

          <label>{__('Tags')}</label>
          <div className={MEDIA_INFO_TEXT_CLASS}>
            <ClaimTags uri={uri} type="large" />
          </div>

          {languages && languages.length && (
            <>
              <label>{__('Languages')}</label>
              <div className={MEDIA_INFO_TEXT_CLASS}>
                {languages.reduce((acc, lang, i) => {
                  return acc + `${SUPPORTED_LANGUAGES[lang] || lang} `;
                }, '')}
              </div>
            </>
          )}

          {claim.meta?.claims_in_channel && (
            <>
              <label>{__('Total Uploads')}</label>
              <div className={MEDIA_INFO_TEXT_CLASS}>{claim.meta?.claims_in_channel}</div>
            </>
          )}

          <label>{__('Last Updated')}</label>
          <div className={MEDIA_INFO_TEXT_CLASS}>
            <DateTime timeAgo uri={uri} />
          </div>

          <label>{__('URL')}</label>
          <div className={MEDIA_INFO_TEXT_CLASS}>
            <div className={`${MEDIA_INFO_TEXT_CLASS} ${MEDIA_INFO_TEXT_CONSTRAINED_CLASS}`}>{claim.canonical_url}</div>
          </div>

          <label>{__('Claim ID')}</label>
          <div className={MEDIA_INFO_TEXT_CLASS}>
            <div className={`${MEDIA_INFO_TEXT_CLASS} ${MEDIA_INFO_TEXT_CONSTRAINED_CLASS}`}>{claim.claim_id}</div>
          </div>

          <label>{__('Staked Credits')}</label>
          <div className={MEDIA_INFO_TEXT_CLASS}>
            <CreditAmount amount={parseFloat(claim.amount) + parseFloat(claim.meta.support_amount)} precision={8} />{' '}
            <Button
              button="link"
              label={__('view other claims at lbry://%name%', {
                name: claim.name,
              })}
              navigate={`/$/${PAGES.TOP}?name=${claim.name}`}
            />
          </div>
          {canView && <YoutubeBadge channelClaimId={claimId} />}
        </Fragment>
      </section>
    </div>
  );
}

export default ChannelAbout;
