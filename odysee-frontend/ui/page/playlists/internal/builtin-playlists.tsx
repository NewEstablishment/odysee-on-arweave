import React from 'react';
import classnames from 'classnames';
import * as COLS from 'constants/collections';
import CollectionPreview from './collectionsListMine/internal/collectionPreview';
import SectionLabel from './collectionsListMine/internal/label';
import { useIsMobile } from 'effects/use-screensize';
import { PLAYLISTS_CLAIM_LIST_CLASS } from '../classes';

const BuiltinPlaylists = () => {
  const isMobile = useIsMobile();
  return (
    <>
      <SectionLabel label={__('Default Playlists')} />

      <ul
        className={classnames(PLAYLISTS_CLAIM_LIST_CLASS, {
          playlists: !isMobile,
        })}
        data-claim-list
      >
        {COLS.BUILTIN_PLAYLISTS_NO_QUEUE.map((playlist) => (
          <CollectionPreview collectionId={playlist} key={playlist} />
        ))}
      </ul>
    </>
  );
};

export default BuiltinPlaylists;
