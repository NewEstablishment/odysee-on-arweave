import ChannelThumbnail from 'component/channelThumbnail';
import React from 'react';
import MembershipBadge from 'component/membershipBadge';
import twemoji from 'twemoji';
import { useAppSelector } from 'redux/hooks';
import { selectClaimForUri } from 'redux/selectors/claims';
import { formatLbryChannelName } from 'util/url';
import { getClaimTitle, getChannelIdFromClaim } from 'util/claim';
import { selectUserOdyseeMembership } from 'redux/selectors/memberships';
import { EMOTE_CLASS } from 'component/common/emote-classes';
import { TEXTAREA_SUGGESTION_CLASSES } from './classes';
type Props = {
  emote?: any;
  uri?: string;
  emoji?: string;
};
export default function TextareaSuggestionsItem(props: Props) {
  const { emote, uri, ...autocompleteProps } = props;
  const claim = useAppSelector((state) => (uri ? selectClaimForUri(state, uri) : undefined));
  const odyseeMembership = useAppSelector((state) => selectUserOdyseeMembership(state, getChannelIdFromClaim(claim)));
  const claimLabel = claim ? formatLbryChannelName(claim.canonical_url) : undefined;
  const claimTitle = claim ? getClaimTitle(claim) : undefined;

  const Twemoji = ({ emoji }) => (
    <span
      dangerouslySetInnerHTML={{
        __html: twemoji.parse(emoji, {
          folder: 'svg',
          ext: '.svg',
        }),
      }}
    />
  );

  if (emote) {
    const { name: value, url, unicode } = emote;
    return (
      <div {...autocompleteProps}>
        {unicode ? (
          <div className={EMOTE_CLASS}>
            <Twemoji emoji={unicode} />
          </div>
        ) : (
          <img className={EMOTE_CLASS} src={url} />
        )}

        <div className={TEXTAREA_SUGGESTION_CLASSES.label}>
          <span
            className={`${TEXTAREA_SUGGESTION_CLASSES.title} ${TEXTAREA_SUGGESTION_CLASSES.value} textarea-suggestion__value--emote`}
          >
            {value}
          </span>
        </div>
      </div>
    );
  }

  if (claimLabel) {
    const value = claimLabel;
    return (
      <div {...autocompleteProps}>
        <ChannelThumbnail className={TEXTAREA_SUGGESTION_CLASSES.thumbnail} xsmall uri={uri} />

        <div className={TEXTAREA_SUGGESTION_CLASSES.label}>
          <span className={TEXTAREA_SUGGESTION_CLASSES.title}>{claimTitle || value}</span>
          <span className={TEXTAREA_SUGGESTION_CLASSES.value}>
            {value}
            {odyseeMembership && <MembershipBadge membershipName={odyseeMembership} />}
          </span>
        </div>
      </div>
    );
  }

  return null;
}
