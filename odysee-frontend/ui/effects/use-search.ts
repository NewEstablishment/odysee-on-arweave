import React from 'react';
import { fetchSearchIds } from 'util/hyperbeam';
import { hyperbeamImmutableUri } from 'util/hyperbeam-route';
import { isURIValid } from 'util/lbryURI';
import useThrottle from './use-throttle';
export default function useSearch(
  query: string,
  showMature: boolean,
  size: number = 5,
  additionalOptions: any = {},
  throttleMs: number = 500
) {
  const [results, setResults] = React.useState<Array<string> | null>();
  const [loading, setLoading] = React.useState<boolean>();
  const throttledQuery = useThrottle(query ? query.trim() : '', throttleMs);
  React.useEffect(() => {
    if (throttledQuery) {
      setLoading(true);
      setResults(null);
      let isSubscribed = true;
      fetchSearchIds(throttledQuery, size)
        .then((ids) => {
          if (isSubscribed) {
            setResults(
              ids
                .map((id) => hyperbeamImmutableUri(id))
                .filter(Boolean)
                .filter((uri) => isURIValid(uri))
            );
            setLoading(false);
          }
        })
        .catch(() => {
          setLoading(false);
        });
      return () => {
        isSubscribed = false;
      };
    }
  }, [throttledQuery, size]);
  return {
    results,
    loading,
  };
}
