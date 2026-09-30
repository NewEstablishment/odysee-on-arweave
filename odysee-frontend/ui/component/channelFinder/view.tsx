import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import React from 'react';
import Entry from './entry/view';
import SortableList from './sortableList';
import { FormField } from 'component/common/form-components/form-field';
import { FORM_FIELD_ADDRESS_CLASS } from 'component/common/form-components/form-field-classes';
import Spinner from 'component/spinner';
import { URL } from 'config';
import * as ICONS from 'constants/icons';
import { SEARCH_MIN_CHARACTERS, SEARCH_OPTIONS } from 'constants/search';
import useSearch from 'effects/use-search';
import { getUriForSearchTerm } from 'util/search';
import { isNameValid, parseURI } from 'util/lbryURI';
import { doResolveUris } from 'redux/actions/claims';
import { doSetMentionSearchResults } from 'redux/actions/search';
import { selectClaimsByUri, selectResolvingUris } from 'redux/selectors/claims';
import { selectSubscriptionUris } from 'redux/selectors/subscriptions';
import { useAppSelector, useAppDispatch } from 'redux/hooks';

type Props = {
  selectedUris: Array<string>;
  onSelectedUrisChanged: (
    change: 'remove' | 'add' | 'reorder',
    params: {
      uri?: string;
      to?: number;
      from?: number;
    }
  ) => void;
  label?: React.ReactNode;
  placeholder?: string;
};

const CenteredSpinner = (props: {}) => (
  <div className={PAGE_MAIN_EMPTY_CLASS}>
    <Spinner />
  </div>
);

function handleKeyPress(e) {
  // We have to use 'e.key' instead of 'e.keyCode' in this event.
  // if (e.key === 'Enter' && addTagRef && addTagRef.current && addTagRef.current.click) {
  //   e.preventDefault();
  //   addTagRef.current.click();
  // }
}

export default function ChannelFinder(props: Props) {
  const { label, placeholder, selectedUris, onSelectedUrisChanged } = props;

  const dispatch = useAppDispatch();
  const claimsByUri = useAppSelector(selectClaimsByUri);
  const resolvingUris = useAppSelector(selectResolvingUris);
  const subscriptionUris = useAppSelector(selectSubscriptionUris) || [];
  const [searchTerm, setSearchTerm] = React.useState('');
  const [searchTermDebounced, setSearchTermDebounced] = React.useState('');
  // --- URL/SDK search ---
  const isUrl = isUrlBasedInput(searchTerm);
  const [uriSearchTerm, setUriSearchTerm] = React.useState('');
  const [uriSearchTermError, setUriSearchTermError] = React.useState('');
  const [isResolvingUri, setIsResolvingUri] = React.useState(false);
  const resolvedUri = claimsByUri[uriSearchTerm]?.permanent_url;
  // --- Search suggestions ---
  const additionalOptions = {
    isBackgroundSearch: false,
    [SEARCH_OPTIONS.CLAIM_TYPE]: SEARCH_OPTIONS.INCLUDE_CHANNELS,
  };
  const searchResponse = useSearch(getSearchableTerm(searchTermDebounced), false, 15, additionalOptions, 0);
  const urisStringified = JSON.stringify(searchResponse.results);
  const [showSubscriptions, setShowSubscriptions] = React.useState(false);

  // **************************************************************************
  // **************************************************************************

  const SearchSuggestions = (props: {}) => (
    <>
      {!searchResponse.loading &&
        searchTerm?.length >= SEARCH_MIN_CHARACTERS &&
        searchResponse.results &&
        searchResponse.results
          .filter((uri) => uri !== resolvedUri)
          .map((uri) => (
            <Entry
              key={uri}
              uri={uri}
              claim={claimsByUri[uri]}
              resolvingUris={resolvingUris}
              onClick={(e) => handleSuggestionClicked(uri)}
              iconRight={selectedUris.includes(uri) ? ICONS.COMPLETE : undefined}
              hideInvalid
            />
          ))}
    </>
  );

  const UriSearchResult = (props: {}) => (
    <>
      {!isResolvingUri && (
        <>
          {claimsByUri[uriSearchTerm] ? (
            <Entry
              key={claimsByUri[uriSearchTerm].permanent_url}
              uri={claimsByUri[uriSearchTerm].permanent_url}
              claim={claimsByUri[uriSearchTerm]}
              resolvingUris={resolvingUris}
              onClick={(e) => handleSuggestionClicked(claimsByUri[uriSearchTerm].permanent_url)}
              iconRight={selectedUris.includes(claimsByUri[uriSearchTerm].permanent_url) ? ICONS.COMPLETE : undefined}
              hideInvalid
            />
          ) : isUrl ? (
            <div className={PAGE_MAIN_EMPTY_CLASS}>{__('No results')}</div>
          ) : null}
        </>
      )}
    </>
  );

  const MiscSuggestions = (props: {}) => {
    const show = showSubscriptions && subscriptionUris.length > 0 && !searchResponse.loading;
    return show ? (
      <div className="tw:[&:not(:first-child)]:mt-app-m tw:[&:not(:first-child)]:[border-top:1px_solid_var(--color-border)]">
        <label className="tw:pt-app-m tw:pb-app-xxs tw:text-app-small tw:text-app-text-subtitle">
          {__('Following')}
        </label>
        {subscriptionUris.map((uri) => (
          <Entry
            key={uri}
            uri={uri}
            claim={claimsByUri[uri]}
            resolvingUris={resolvingUris}
            onClick={(e) => handleSuggestionClicked(uri)}
            iconRight={selectedUris.includes(uri) ? ICONS.COMPLETE : undefined}
            hideInvalid
          />
        ))}
      </div>
    ) : null;
  };

  // **************************************************************************
  // **************************************************************************
  function isUrlBasedInput(str) {
    return str.startsWith(`${URL}`) || str.startsWith('lbry://');
  }

  function getSearchableTerm(term) {
    // This should be moved into `useSearch`
    return searchTerm && searchTerm.length >= SEARCH_MIN_CHARACTERS ? searchTerm : '';
  }

  function handleSuggestionClicked(uri: string) {
    onSelectedUrisChanged(selectedUris.includes(uri) ? 'remove' : 'add', {
      uri,
    });
  }

  function handleSelectedItemClicked(uri) {
    onSelectedUrisChanged('remove', {
      uri,
    });
  }

  function handleSelectedItemDragged(result) {
    const { source, destination } = result;
    onSelectedUrisChanged('reorder', {
      from: source.index,
      to: destination.index,
    });
  }

  // **************************************************************************
  // **************************************************************************
  // -- Debounce searchTerm
  React.useEffect(() => {
    if (searchTermDebounced !== searchTerm) {
      const timer = setTimeout(() => {
        setSearchTermDebounced(searchTerm);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [searchTerm, searchTermDebounced]);
  // -- Resolve and store search results
  React.useEffect(() => {
    const uris = searchResponse.results;

    if (searchTermDebounced && uris && uris.length > 0) {
      dispatch(doResolveUris(uris, true));
      dispatch(doSetMentionSearchResults(searchTermDebounced, uris));
    } // 1. urisStringified covers 'searchResponse.results' (should be in sync).
    // 2. Ignore functions as they won't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urisStringified, searchTermDebounced]);
  // -- URI-based results
  React.useEffect(() => {
    setUriSearchTermError('');
    setUriSearchTerm('');

    if (searchTermDebounced) {
      // QoL: Try to resolve even in LH mode; term can be close to a url, e.g. "miko:f" or "@miko:f".
      const term = isUrl
        ? searchTermDebounced
        : `lbry://${!searchTermDebounced.startsWith('@') ? '@' : ''}${searchTermDebounced}`;
      const [uri, error] = getUriForSearchTerm(term);

      if (error) {
        setUriSearchTermError(error);
      } else if (uri.length > 'lbry://'.length) {
        try {
          const { streamName, channelName, isChannel } = parseURI(uri);

          if (!isChannel && streamName && isNameValid(streamName)) {
            setUriSearchTermError(__('Not a valid channel URL'));
          } else if (isChannel && channelName && isNameValid(channelName)) {
            setUriSearchTerm(uri);
            setIsResolvingUri(true);
            dispatch(doResolveUris([uri], true)).finally(() => setIsResolvingUri(false));
          }
        } catch (e) {
          setUriSearchTermError(e.message);
        }
      }
    } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUrl, searchTermDebounced]);
  // --- Resolve subscriptions
  React.useEffect(() => {
    dispatch(doResolveUris(subscriptionUris, true)); // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount
  }, []);

  // **************************************************************************
  // **************************************************************************
  if (!selectedUris || !onSelectedUrisChanged) {
    console.error('ChannelFinder: missing parameters'); // eslint-disable-line no-console

    return null;
  }

  return (
    <div className="tw:py-app-m tw:upto-small:py-app-xs">
      <div>
        <div>
          <FormField
            type="text"
            name="search_term"
            className={FORM_FIELD_ADDRESS_CLASS}
            label={label}
            placeholder={`\u{1F50E} ${placeholder || __('Enter channel name or URL')}`}
            value={searchTerm}
            error={isUrl && uriSearchTermError}
            onKeyPress={(e) => handleKeyPress(e)}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>
      <div className="tw:flex tw:px-app-xs tw:py-app-s tw:upto-small:flex-col">
        <div className="tw:h-[40vh] tw:w-1/2 tw:overflow-auto tw:rounded-app tw:bg-[var(--color-header-button)] tw:px-app-s tw:py-app-xs tw:upto-small:h-[30vh] tw:upto-small:w-full">
          {searchResponse.loading || isResolvingUri ? (
            <CenteredSpinner />
          ) : (
            <>
              {uriSearchTerm && <UriSearchResult />}
              {!isUrl && <SearchSuggestions />}
              <MiscSuggestions />
            </>
          )}
        </div>
        <div className="tw:ml-app-s tw:h-[40vh] tw:w-1/2 tw:flex-grow tw:overflow-auto tw:rounded-app tw:bg-[var(--color-header-button)] tw:px-app-s tw:py-app-xs tw:upto-small:mt-app-s tw:upto-small:ml-0 tw:upto-small:h-[30vh] tw:upto-small:w-full">
          <div className="tw:mb-app-xs tw:self-end tw:[border-bottom:1px_solid_var(--color-border)] tw:pb-app-xs tw:text-app-text-subtitle">
            {__('Selected channels')}
          </div>
          <SortableList
            list={selectedUris}
            onGetElemAtIndex={(uri, index) => (
              <Entry
                key={uri}
                uri={uri}
                claim={claimsByUri[uri]}
                resolvingUris={resolvingUris}
                onClick={(e) => handleSelectedItemClicked(uri)}
                iconRight={ICONS.DELETE}
                iconRightOnHoverOnly
                iconRightErrorColor
              />
            )}
            onDragEnd={handleSelectedItemDragged}
          />
        </div>
      </div>
      <div className="tw:pl-app-xs">
        <FormField
          type="checkbox"
          name="suggest_followed_channels"
          label={__('Suggest followed channels')}
          checked={showSubscriptions}
          onChange={() => setShowSubscriptions((prev) => !prev)}
        />
      </div>
    </div>
  );
}
