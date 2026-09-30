import React from 'react';
import LbcSymbol from 'component/common/lbc-symbol';
import WunderbarSuggestion from 'component/wunderbarSuggestion';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import {
  makeSelectClaimForUri,
  selectIsUriResolving,
  makeSelectTagInClaimOrChannelForUri,
} from 'redux/selectors/claims';
import { doResolveUris } from 'redux/actions/claims';
import { parseURI } from 'util/lbryURI';
import { makeSelectWinningUriForQuery } from 'redux/selectors/search';
import { PREFERENCE_EMBED } from 'constants/tags';
import { WUNDERBAR_SUGGESTION_CLASSES } from 'component/wunderbarSuggestion/classes';
import { WUNDERBAR_TOP_SUGGESTION_CLASSES } from './classes';

type Props = {
  query: string;
};
export default function WunderbarTopSuggestion(props: Props) {
  const { query } = props;
  const dispatch = useAppDispatch();

  const uriFromQuery = `lbry://${query}`;
  const uris = React.useMemo(() => {
    const result = [uriFromQuery];
    try {
      const { isChannel } = parseURI(uriFromQuery);
      if (!isChannel) {
        const channelUriFromQuery = `lbry://@${query}`;
        result.push(channelUriFromQuery);
      }
    } catch (e) {}
    return result;
  }, [uriFromQuery, query]);

  const resolvingUris = useAppSelector((state) => uris.some((uri) => selectIsUriResolving(state, uri)));
  const winningUri = useAppSelector((state) => makeSelectWinningUriForQuery(query)(state));
  const winningClaim = useAppSelector((state) => (winningUri ? makeSelectClaimForUri(winningUri)(state) : undefined));
  const preferEmbed = useAppSelector((state) =>
    makeSelectTagInClaimOrChannelForUri(winningUri, PREFERENCE_EMBED)(state)
  );

  const stringifiedUris = JSON.stringify(uris);
  React.useEffect(() => {
    if (stringifiedUris) {
      const arrayUris = JSON.parse(stringifiedUris);

      if (arrayUris.length > 0) {
        dispatch(doResolveUris(arrayUris));
      }
    }
  }, [dispatch, stringifiedUris]);

  if (resolvingUris) {
    return (
      <div className="wunderbar__winning-claim">
        <div
          className={`${WUNDERBAR_TOP_SUGGESTION_CLASSES.label} ${WUNDERBAR_TOP_SUGGESTION_CLASSES.placeholderLabel}`}
        />

        <div className={`${WUNDERBAR_SUGGESTION_CLASSES.root} ${WUNDERBAR_TOP_SUGGESTION_CLASSES.suggestion}`}>
          <div className={WUNDERBAR_TOP_SUGGESTION_CLASSES.thumbnail} />
          <div className={WUNDERBAR_TOP_SUGGESTION_CLASSES.info} />
        </div>
        <hr className={WUNDERBAR_TOP_SUGGESTION_CLASSES.separator} />
      </div>
    );
  }

  if (!winningUri || preferEmbed) {
    return null;
  }

  return (
    <>
      <div className={WUNDERBAR_TOP_SUGGESTION_CLASSES.label}>
        <LbcSymbol prefix={__('Most Supported')} />
      </div>

      <WunderbarSuggestion uri={winningUri} />
      <hr className={WUNDERBAR_TOP_SUGGESTION_CLASSES.separator} />
    </>
  );
}
