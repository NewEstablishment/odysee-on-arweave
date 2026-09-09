import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeNativeUploadRevision, nativeUploadRevisionMessage } from '../../ui/util/nativeUploadRevisions.ts';
import { readVerifiedUpload } from '../../../scripts/native-upload-search.mjs';

const node = process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18811';
const meili = process.env.MEILI_URL || 'http://127.0.0.1:7711';
const index = process.env.MEILI_INDEX || 'upload_validation';
const run = promisify(execFile);
async function write(payload, cookie) {
  const response = await fetch(`${node}/id?0.%21=true&committers=all`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(payload),
  });
  assert.equal(response.ok, true, `native write: ${response.status}`);
  const id = response.headers.get('message-id');
  assert.match(id, /^[\w-]{43}$/);
  return { id, cookie: cookie || response.headers.get('set-cookie')?.split(';')[0] };
}
async function replay() {
  await run(
    process.execPath,
    ['--experimental-strip-types', '../scripts/reindex-node-uploads-to-search.mjs', '--node-url', node],
    {
      env: { ...process.env, MEILI_URL: meili, MEILI_INDEX: index },
      timeout: 90000,
    }
  );
}
async function search(q) {
  const response = await fetch(`${node}/~search@1.0/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ q, limit: 20 }),
  });
  assert.equal(response.ok, true);
  return JSON.stringify(await response.json());
}
const slug = `uploadtest${Date.now()}`;
const raw = await write({ body: 'immutable media bytes', 'content-type': 'text/plain' });
const rootPayload = {
  schema: 'odysee-upload@1.0',
  type: 'upload',
  name: slug,
  title: `${slug}original`,
  description: 'clear me',
  'content-type': 'video/mp4',
  'data-id': raw.id,
  timestamp: 100,
};
const rootWrite = await write(rootPayload, raw.cookie);
const rootRead = await readVerifiedUpload(node, rootWrite.id);
assert.ok(rootRead);
const root = normalizeNativeUploadRevision(rootRead.payload, rootWrite.id, rootRead.owner);
assert.ok(root);
const editPayload = nativeUploadRevisionMessage(
  root,
  root,
  { title: `${slug}renamed`, description: '', tags: ['test-tag'], languages: ['fr'] },
  'edit'
);
const editWrite = await write(editPayload, raw.cookie);
const editRead = await readVerifiedUpload(node, editWrite.id);
assert.ok(editRead);
const edit = normalizeNativeUploadRevision(editRead.payload, editWrite.id, editRead.owner);
assert.equal(edit.description, '');
assert.deepEqual(edit.tags, ['test-tag']);
assert.deepEqual(edit.languages, ['fr']);
const foreign = await write(nativeUploadRevisionMessage(root, edit, {}, 'delete'));
assert.notEqual((await readVerifiedUpload(node, foreign.id)).owner, root.hyperbeam_owner);
// Allow the match listener to observe the writes, then exercise the real operator replay.
await new Promise((resolve) => setTimeout(resolve, 1500));
await replay();
assert.ok((await search(`${slug}renamed`)).includes(editWrite.id));
assert.ok(!(await search(`${slug}original`)).includes(rootWrite.id));
assert.equal(
  (await readVerifiedUpload(node, rootWrite.id)).payload.title,
  `${slug}original`,
  'exact root remains unchanged'
);
await replay();
assert.ok((await search(`${slug}renamed`)).includes(editWrite.id), 'replay is idempotent');
await write(nativeUploadRevisionMessage(root, edit, {}, 'delete'), raw.cookie);
await new Promise((resolve) => setTimeout(resolve, 1500));
await replay();
assert.ok(!(await search(`${slug}renamed`)).includes(editWrite.id));
assert.equal(
  (await readVerifiedUpload(node, editWrite.id)).payload.title,
  `${slug}renamed`,
  'deletion does not remove exact history'
);
console.log(
  'live upload rename/clear, foreign delete rejection, search reconciliation, tombstone and immutable history passed'
);
