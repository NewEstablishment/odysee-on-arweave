import React from 'react';
import { PLAYLISTS_TABLE_CLASSES } from '../../../classes';

const TableHeader = () => (
  <table className={PLAYLISTS_TABLE_CLASSES.root}>
    <thead>
      <tr>
        <th className={PLAYLISTS_TABLE_CLASSES.playlist}>{__('Playlist')}</th>
        <th className={PLAYLISTS_TABLE_CLASSES.meta}>
          <label>{__('Meta')}</label>
          <th className={PLAYLISTS_TABLE_CLASSES.visibility}>{__('Visibility')}</th>
          <th className={PLAYLISTS_TABLE_CLASSES.createdAt}>{__('Created at')}</th>
          <th className={PLAYLISTS_TABLE_CLASSES.updatedAt}>{__('Last updated at')}</th>
        </th>
        <th className={PLAYLISTS_TABLE_CLASSES.action}>{__('Play')}</th>
      </tr>
    </thead>
  </table>
);

export default TableHeader;
