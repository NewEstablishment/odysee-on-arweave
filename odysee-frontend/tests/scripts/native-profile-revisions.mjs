import assert from 'node:assert/strict';
import {
  normalizeProfileVersion,
  profileRevisionMessage,
  projectProfileVersion,
  validProfileMetadata,
} from '../../ui/util/nativeProfileRevisions.ts';
const id = (char) => char.repeat(43);
const root = {
  id: id('a'),
  profile_id: id('a'),
  owner: id('o'),
  revision: 0,
  previous_version: '',
  title: 'Original',
  description: '',
  avatar_id: '',
  banner_id: '',
};
const first = normalizeProfileVersion(
  profileRevisionMessage(root, { ...root, title: 'New title', description: 'Bio', avatar_id: id('i') }),
  id('b'),
  root.owner
);
assert.ok(first);
const second = normalizeProfileVersion(
  profileRevisionMessage(first, { ...first, title: 'Final', description: '', avatar_id: '' }),
  id('c'),
  root.owner
);
assert.equal(projectProfileVersion(root, [second, first]).id, second.id);
assert.equal(projectProfileVersion(root, [second]).id, root.id, 'gaps rejected');
assert.equal(projectProfileVersion(root, [{ ...first, owner: id('x') }]).id, root.id, 'foreign writer rejected');
assert.equal(projectProfileVersion(root, [{ ...first, profile_id: id('x') }]).id, root.id, 'foreign target rejected');
assert.equal(
  projectProfileVersion(root, [first, { ...second, previous_version: root.id }]).id,
  first.id,
  'stale predecessor rejected'
);
assert.equal(
  projectProfileVersion(root, [first, { ...first, id: id('d'), title: 'Fork' }, second]).id,
  root.id,
  'fork fails closed'
);
assert.equal(
  projectProfileVersion(root, [first, { ...first, id: id('d') }, { ...second, previous_version: id('d') }]).id,
  second.id,
  'commitment aliases collapse'
);
assert.equal(projectProfileVersion(root, [first]).description, 'Bio', 'exact older snapshot remains unchanged');
assert.equal(projectProfileVersion(root, [first, second]).description, '', 'explicit bio clear');
assert.equal(projectProfileVersion(root, [first, second]).avatar_id, '', 'explicit image removal');
assert.equal(root.title, 'Original');
assert.equal(validProfileMetadata({ ...root, title: '' }), false);
assert.equal(validProfileMetadata({ ...root, description: 'x'.repeat(5001) }), false);
assert.equal(validProfileMetadata({ ...root, avatar_id: 'javascript:alert(1)' }), false);
assert.equal(
  normalizeProfileVersion({ ...profileRevisionMessage(root, root), revision: 1.5 }, id('b'), root.owner),
  null
);
assert.deepEqual(
  Object.keys(profileRevisionMessage(root, root)).sort(),
  [
    'schema',
    'type',
    'profile-id',
    'previous-version',
    'revision',
    'title',
    'description',
    'avatar-id',
    'banner-id',
  ].sort(),
  'allowlisted public fields only'
);
console.log('Native profile revision tests passed');
