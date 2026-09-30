import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  NATIVE_PLAYLIST_SCHEMA,
  NATIVE_PLAYLIST_SIGNATURE_SCOPE,
  NATIVE_PLAYLIST_TYPE,
  immutableNativePlaylists,
  normalizeNativePlaylist,
  validNativePlaylistItem,
} from '../../ui/util/nativePlaylists.ts';

const owner = id('o');
const profileId = id('p');
const first = playlist({ id: id('a'), owner, createdAt: 100, items: [id('1')] });
const laterSave = playlist({
  id: id('b'),
  owner,
  createdAt: 110,
  items: [id('2'), `${'a'.repeat(64)}:2`],
  title: 'Later saved snapshot',
});

assert.deepEqual(
  immutableNativePlaylists([first, laterSave]),
  [laterSave, first],
  'each complete signed message remains an independently addressable playlist'
);
assert.deepEqual(
  immutableNativePlaylists([first, { ...first }]),
  [first],
  'duplicate physical reads of the same message ID are collapsed'
);
assert.notEqual(first.message_id, laterSave.message_id);
assert.deepEqual(first.items, [id('1')], 'a later save cannot mutate the previous snapshot');

const legacyRevision = playlist({
  id: id('c'),
  owner,
  createdAt: 120,
  items: [id('3')],
  extra: {
    'playlist-ref': `${owner}.old-playlist-reference`,
    'version-ref': 'old-version-reference',
    revision: 3,
    'revision-of': `${owner}.old-playlist-reference`,
    'previous-version': 'old-previous-version',
    state: 'active',
    operation: 'update',
  },
});
assert.deepEqual(
  immutableNativePlaylists([legacyRevision]),
  [legacyRevision],
  'an older active full snapshot remains readable by its immutable message ID without projecting its logical head'
);

assert.equal(
  playlist({
    id: id('d'),
    owner,
    createdAt: 130,
    allowInvalid: true,
    extra: { state: 'deleted', operation: 'delete' },
  }),
  null,
  'a legacy tombstone is not an immutable playlist snapshot'
);

assert.equal(validNativePlaylistItem(id('i')), true);
assert.equal(validNativePlaylistItem(`${'b'.repeat(64)}:0`), true);
assert.equal(validNativePlaylistItem('c'.repeat(40)), false, 'mutable legacy claim IDs are not playlist locators');
assert.equal(
  normalizeNativePlaylist({
    ...first,
    'items-json': JSON.stringify(['d'.repeat(40)]),
    items: undefined,
    item_count: 1,
  }),
  null,
  'mutable IDs must be rejected during normalization'
);
assert.equal(
  normalizeNativePlaylist({ ...first, title: 'x'.repeat(201) }),
  null,
  'oversized user input must be rejected'
);
assert.equal(
  normalizeNativePlaylist({ ...first, 'thumbnail-url': 'javascript:alert(1)', thumbnail_url: undefined }),
  null,
  'unsafe thumbnail schemes must be rejected'
);
assert.ok(
  normalizeNativePlaylist({ ...first, description: 'Markdown\nwith formatting' }),
  'ordinary formatted descriptions remain valid'
);

const collectionSelectorSource = await readFile(
  new URL('../../ui/redux/selectors/collections.ts', import.meta.url),
  'utf8'
);
assert.match(
  collectionSelectorSource,
  /resolvedCollection\?\.visibility === 'private'/,
  'a decrypted private playlist reached by a direct edit link must use the private item-resolution path'
);

console.log('native immutable playlist snapshot tests passed');

function playlist({
  id: messageId,
  owner: messageOwner,
  createdAt,
  items = [id('1')],
  title = 'Native playlist',
  extra = {},
  allowInvalid = false,
}) {
  const normalized = normalizeNativePlaylist({
    schema: NATIVE_PLAYLIST_SCHEMA,
    type: NATIVE_PLAYLIST_TYPE,
    'profile-id': profileId,
    'profile-name': 'Playlist owner',
    title,
    description: 'Stored as a signed immutable HyperBEAM message',
    'thumbnail-url': 'https://example.com/thumbnail.jpg',
    'tags-json': JSON.stringify(['native']),
    'languages-json': JSON.stringify(['en']),
    'items-json': JSON.stringify(items),
    'item-count': items.length,
    'created-at': createdAt,
    'signature-scope': NATIVE_PLAYLIST_SIGNATURE_SCOPE,
    'message-id': messageId,
    'hyperbeam-owner': messageOwner,
    ...extra,
  });
  if (!allowInvalid) assert.ok(normalized);
  return normalized;
}

function id(character) {
  return character.repeat(43);
}
