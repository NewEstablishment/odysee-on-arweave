import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { readNativeWriteBack } from '../../ui/util/nativeReadback.ts';

let reads = 0;
const delays = [];
assert.equal(
  await readNativeWriteBack(
    async () => (++reads === 3 ? 'verified' : null),
    async (ms) => delays.push(ms)
  ),
  'verified'
);
assert.deepEqual(delays, [250, 750]);
reads = 0;
assert.equal(
  await readNativeWriteBack(
    async () => {
      reads++;
      return null;
    },
    async () => {}
  ),
  null
);
assert.equal(reads, 3, 'unavailable/invalid evidence never becomes success');
await assert.rejects(
  readNativeWriteBack(async () => {
    throw new Error('fatal');
  }),
  /fatal/
);

const source = fs.readFileSync(new URL('../../ui/util/hyperbeam.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function writeNativePreference(');
const end = source.indexOf('// Null means the node rejected', start);
for (const foreign of [false, true]) {
  const writes = [];
  let snapshotReads = 0;
  let referenceReads = 0;
  const states = new Map();
  const context = {
    fetchNativePreferenceOwner: async () => 'owner',
    fetchNativePreferenceState: async () => null,
    fetchPreferenceDeviceJson: async () => ({ owner: 'owner' }),
    nativePreferencePlaintext: (value) => value,
    nativePreferenceEnvelope: (value) => value,
    nativePreferenceSnapshotMessage: (_, timestamp) => ({ timestamp }),
    nativePreferenceReferenceInitMessage: (snapshot, timestamp) => ({ snapshot, timestamp }),
    writeNativePreferenceMessage: async (message) => {
      writes.push(message);
      return writes.length === 1 ? 'snapshot' : 'reference';
    },
    nativePreferenceReferenceQueryCache: new Map(),
    nativePreferenceStateByOwner: states,
    readNativeWriteBack: (read) => readNativeWriteBack(read, async () => {}),
    fetchNativePreferenceSnapshotById: async () => {
      if (++snapshotReads < 3) return null;
      return { owner: foreign ? 'foreign' : 'owner', updated_at: writes[0].timestamp };
    },
    fetchNativePreferenceReferenceMessageById: async () => {
      if (++referenceReads < 2) return null;
      return {
        owner: 'owner',
        reference_id: 'reference',
        reference_value: 'snapshot',
        timestamp: writes[1].timestamp,
        is_init: true,
      };
    },
  };
  vm.runInNewContext(ts.transpile(source.slice(start, end) + '\nglobalThis.write = writeNativePreference;'), context);
  if (foreign) {
    await assert.rejects(context.write('shared', { theme: 'dark' }), /ownership verification/);
    assert.equal(writes.length, 1, 'foreign snapshot cannot advance the reference');
    assert.equal(states.size, 0);
  } else {
    await context.write('shared', { theme: 'dark' });
    assert.equal(writes.length, 2, 'only exact reads retry, not snapshot/reference writes');
    assert.equal(states.get('owner').preferences.shared.theme, 'dark');
  }
}

// Execute the real visibility integration; claimed profile fields never grant authority.
const visibilityStart = source.indexOf('export async function fetchHyperbeamCommentVisibility(');
const visibilityEnd = source.indexOf('export async function fetchHyperbeamHiddenComments(', visibilityStart);
for (const actor of ['owner', 'foreign', null]) {
  const writes = [];
  const context = {
    exports: {},
    fetchNativeCommentByIdRaw: async () => ({ claim_id: 'video', comment_id: 'comment' }),
    nativeCommentTargetOwner: async () => 'owner',
    activeHyperbeamAccountOwner: async () => actor,
    getHyperbeamAccount: () => ({ name: 'claimed owner' }),
    nativeCommentControlMessage: (message) => message,
    writeNativeCommentControl: async (message) => writes.push(message),
  };
  vm.runInNewContext(
    ts.transpile(source.slice(visibilityStart, visibilityEnd), { module: ts.ModuleKind.CommonJS }),
    context
  );
  const visibility = context.exports.fetchHyperbeamCommentVisibility;
  if (actor === 'owner') {
    await visibility('comment', true);
    await visibility('comment', false);
    assert.deepEqual(
      writes.map((item) => item.action),
      ['hidden', 'visible']
    );
    assert.ok(writes.every((item) => item.authority === 'owner' && item.target === 'video'));
  } else {
    await assert.rejects(visibility('comment', true), /Only the content owner/);
    assert.equal(writes.length, 0);
  }
}
const byIdStart = source.indexOf('async function fetchNativeCommentById(id:');
const byIdEnd = source.indexOf('async function fetchNativeCommentByIdRaw(', byIdStart);
for (const suppressed of [false, true]) {
  const context = {
    fetchNativeCommentByIdRaw: async (id) => ({
      comment_id: id,
      claim_id: 'video',
      parent_id: id === 'reply' ? 'root' : undefined,
    }),
    projectNativeCommentCollection: async (items) => ({
      items: items.map((item) => ({ ...item, hidden: suppressed && item.comment_id === 'root' })),
    }),
  };
  vm.runInNewContext(
    ts.transpile(source.slice(byIdStart, byIdEnd) + '\nglobalThis.read = fetchNativeCommentById;'),
    context
  );
  const reply = await context.read('reply');
  assert.equal(
    reply?.comment_id || null,
    suppressed ? null : 'reply',
    'a linked reply cannot bypass a hidden ancestor'
  );
}
console.log('Native preference readback and creator visibility integration regressions passed');
