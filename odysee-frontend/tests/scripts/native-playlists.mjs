import assert from 'node:assert/strict';

import {
  NATIVE_PLAYLIST_SCHEMA,
  NATIVE_PLAYLIST_SIGNATURE_SCOPE,
  NATIVE_PLAYLIST_TYPE,
  activeNativePlaylists,
  collapseNativePlaylistStates,
  isNextNativePlaylistRevision,
  normalizeNativePlaylist,
  validNativePlaylistItem,
} from '../../ui/util/nativePlaylists.ts';

const owner = id('o');
const attacker = id('a');
const profileId = id('p');
const playlistRef = `${owner}.playlist-reference`;
const root = playlist({ id: id('r'), owner, ref: playlistRef, version: 'version-root-0001', updatedAt: 100 });
const duplicateRoot = { ...root, message_id: id('s') };
const conflictingRoot = { ...root, title: 'Conflicting content', message_id: id('h') };
const update = playlist({
  id: id('u'),
  owner,
  ref: playlistRef,
  version: 'version-update-01',
  revision: 1,
  previous: root.version_ref,
  updatedAt: 110,
  items: [id('1'), `${'a'.repeat(64)}:2`],
});
const deletion = playlist({
  id: id('d'),
  owner,
  ref: playlistRef,
  version: 'version-delete-01',
  revision: 2,
  previous: update.version_ref,
  updatedAt: 120,
  state: 'deleted',
  operation: 'delete',
  items: update.items,
});
const foreignRevision = playlist({
  id: id('f'),
  owner: attacker,
  ref: playlistRef,
  version: 'foreign-version-01',
  revision: 1,
  previous: root.version_ref,
  updatedAt: 115,
  allowInvalid: true,
});

assert.equal(isNextNativePlaylistRevision(root, root, update), true);
assert.equal(foreignRevision, null, 'the owner encoded in the public ref must match the verified committer');
assert.deepEqual(collapseNativePlaylistStates([deletion, update, duplicateRoot, root]), [deletion]);
assert.deepEqual(
  collapseNativePlaylistStates([conflictingRoot, root]),
  [],
  'conflicting semantic duplicates fail closed'
);
assert.deepEqual(activeNativePlaylists([deletion, update, root]), []);

const reordered = playlist({
  id: id('q'),
  owner,
  ref: playlistRef,
  version: 'version-reorder-01',
  revision: 2,
  previous: update.version_ref,
  updatedAt: 120,
  items: [...update.items].reverse(),
});
assert.deepEqual(collapseNativePlaylistStates([reordered, update, root]), [reordered]);

const fork = playlist({
  id: id('k'),
  owner,
  ref: playlistRef,
  version: 'version-fork-0001',
  revision: 1,
  previous: root.version_ref,
  updatedAt: 111,
});
assert.deepEqual(collapseNativePlaylistStates([fork, update, root]), [root], 'ambiguous same-owner forks fail closed');

const skipped = playlist({
  id: id('j'),
  owner,
  ref: playlistRef,
  version: 'version-skipped-01',
  revision: 2,
  previous: root.version_ref,
  updatedAt: 130,
});
assert.deepEqual(collapseNativePlaylistStates([skipped, root]), [root]);

const resurrection = playlist({
  id: id('z'),
  owner,
  ref: playlistRef,
  version: 'version-revive-001',
  revision: 3,
  previous: deletion.version_ref,
  updatedAt: 130,
});
assert.deepEqual(collapseNativePlaylistStates([resurrection, deletion, update, root]), [deletion]);

assert.equal(validNativePlaylistItem(id('i')), true);
assert.equal(validNativePlaylistItem(`${'b'.repeat(64)}:0`), true);
assert.equal(validNativePlaylistItem('c'.repeat(40)), false, 'mutable legacy claim IDs are not playlist locators');
assert.equal(
  normalizeNativePlaylist({
    ...root,
    'items-json': JSON.stringify(['d'.repeat(40)]),
    items: undefined,
    item_count: 1,
  }),
  null,
  'mutable IDs must be rejected during normalization'
);
assert.equal(
  normalizeNativePlaylist({ ...root, title: 'x'.repeat(201) }),
  null,
  'oversized user input must be rejected'
);
assert.equal(
  normalizeNativePlaylist({ ...root, 'thumbnail-url': 'javascript:alert(1)', thumbnail_url: undefined }),
  null,
  'unsafe thumbnail schemes must be rejected'
);
assert.ok(
  normalizeNativePlaylist({ ...root, description: 'Markdown\nwith formatting' }),
  'ordinary formatted descriptions remain valid'
);

console.log('native playlist projection tests passed');

function playlist({
  id: messageId,
  owner: messageOwner,
  ref,
  version,
  revision = 0,
  previous,
  updatedAt,
  state = 'active',
  operation = revision ? 'update' : 'create',
  items = [id('1')],
  allowInvalid = false,
}) {
  const normalized = normalizeNativePlaylist({
    schema: NATIVE_PLAYLIST_SCHEMA,
    type: NATIVE_PLAYLIST_TYPE,
    'playlist-ref': ref,
    'profile-id': profileId,
    'profile-name': 'Playlist owner',
    title: 'Native playlist',
    description: 'Stored as a signed HyperBEAM message',
    'thumbnail-url': 'https://example.com/thumbnail.jpg',
    'tags-json': JSON.stringify(['native']),
    'languages-json': JSON.stringify(['en']),
    'items-json': JSON.stringify(items),
    'item-count': items.length,
    state,
    operation,
    revision,
    'version-ref': version,
    'revision-of': revision ? ref : undefined,
    'previous-version': previous,
    'created-at': 100,
    'updated-at': updatedAt,
    'signature-scope': NATIVE_PLAYLIST_SIGNATURE_SCOPE,
    'message-id': messageId,
    'hyperbeam-owner': messageOwner,
  });
  if (!allowInvalid) assert.ok(normalized);
  return normalized;
}

function id(character) {
  return character.repeat(43);
}
