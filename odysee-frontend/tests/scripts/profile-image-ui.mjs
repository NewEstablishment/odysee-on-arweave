// Component/selector contracts with controlled hooks and transport, not browser QA.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { validProfileMetadata } from '../../ui/util/nativeProfileRevisions.ts';
import { directImageUrl } from '../../ui/util/thumbnailProxy.ts';

const read = (name) => readFileSync(new URL(`../../ui/${name}`, import.meta.url), 'utf8');
function compile(source, imports, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    __: (value) => value,
    ...globals,
  });
  return module.exports;
}

// Execute the actual cover/avatar selectors, without unrelated Redux imports.
const claims = read('redux/selectors/claims.ts');
const selectors = claims.slice(
  claims.indexOf('export const makeSelectCoverForUri'),
  claims.indexOf('export const selectIsFetchingClaimListMine')
);
for (const base of ['http://127.0.0.1:18812', 'https://node.example']) {
  const source = `import { createSelector, makeSelectClaimForUri, getImageProxyUrl } from 'fixture';\n${selectors}`;
  const { makeSelectCoverForUri, makeSelectAvatarForUri } = compile(source, {
    fixture: {
      createSelector: (select, project) => (state) => project(select(state)),
      makeSelectClaimForUri: () => (claim) => claim,
      getImageProxyUrl: (url) => directImageUrl(url, [base], true),
    },
  });
  const channel = {
    value_type: 'channel',
    value: { cover: { url: `${base}/banner` }, thumbnail: { url: `${base}/avatar` } },
  };
  assert.equal(makeSelectCoverForUri('channel')(channel), `${base}/banner`);
  assert.equal(makeSelectCoverForUri('video')({ value: {}, signing_channel: channel }), `${base}/banner`);
  delete channel.value.cover;
  assert.equal(makeSelectAvatarForUri('channel')(channel), `${base}/avatar`, 'avatar does not require a banner');
  assert.equal(makeSelectCoverForUri('channel')(channel), undefined);
}

const slots = [];
const effects = [];
let cursor = 0;
const React = {
  Fragment: 'fragment',
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState(initial) {
    const key = cursor++;
    if (!(key in slots)) slots[key] = initial;
    return [
      slots[key],
      (next) => {
        slots[key] = typeof next === 'function' ? next(slots[key]) : next;
      },
    ];
  },
  useRef(initial) {
    const key = cursor++;
    if (!(key in slots)) slots[key] = { current: initial };
    return slots[key];
  },
  useEffect(effect) {
    if (effects.length === 0) effects.push(effect);
  },
};
const profile = {
  claim_id: 'r'.repeat(43),
  is_my_output: true,
  value: { title: 'Profile', description: '' },
  hyperbeam: { profile_version: 'r'.repeat(43), avatar_id: '', banner_id: '' },
};
const writes = [];
let finishUpload;
let rejectUpload;
let failSave = false;
let done = 0;
const Editor = compile(read('component/channelEdit/native.tsx'), {
  react: React,
  'component/common/card': 'Card',
  'component/button': 'Button',
  'component/common/form': { FormField: 'Field' },
  'util/hyperbeam': {
    fetchHyperbeamProfile: async () => profile,
    fetchHyperbeamProfileSave: async (id, previous, metadata) => {
      writes.push({ id, previous, ...metadata });
      if (failSave) throw new Error('503');
      return { ...profile, hyperbeam: { ...profile.hyperbeam, profile_version: 'v'.repeat(43) } };
    },
  },
  'util/hyperbeamDevices': { hyperbeamNodeBase: () => 'http://127.0.0.1:18812' },
  'util/nativeProfileRevisions': { validProfileMetadata },
  'services/profileImageUpload': {
    uploadProfileImage: () =>
      new Promise((resolve, reject) => {
        finishUpload = resolve;
        rejectUpload = reject;
      }),
  },
  'redux/hooks': { useAppDispatch: () => async () => {}, useAppSelector: (select) => select({}) },
  'redux/selectors/claims': { selectClaimForUri: () => profile },
  'redux/actions/claims': { doResolveUri: () => ({}) },
}).default;
const render = () => {
  cursor = 0;
  return Editor({ uri: 'profile', onDone: () => done++ });
};
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...Object.values(tree.props || {}).flatMap(nodes)];
}
const button = (label) => nodes(render()).find((node) => node.type === 'Button' && node.props.label === label).props;
const input = () => nodes(render()).find((node) => node.props?.id === 'profile_avatar_id').props;
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
render();
effects[0]();
await flush();
const beforeUploadSave = button('Save profile');
input().onChange({ target: { files: [{}], value: 'fixture.png' } });
assert.equal(button('Save profile').disabled, true);
assert.equal(button('Save profile')['aria-busy'], true);
assert.ok(JSON.stringify(render()).includes('Uploading image. Please wait before saving.'));
await beforeUploadSave.onClick();
assert.equal(writes.length, 0, 'stale click handler cannot save during upload');
finishUpload('i'.repeat(43));
await flush();
assert.equal(button('Save profile').disabled, false);
const save = button('Save profile').onClick;
await Promise.all([save(), save()]);
assert.equal(writes.length, 1, 'first enabled click saves once, duplicate concurrent click does not');
assert.equal(writes[0].avatar_id, 'i'.repeat(43));
assert.equal(done, 1);
button('Remove avatar').onClick();
await button('Save profile').onClick();
assert.equal(writes.at(-1).avatar_id, '');
assert.equal(writes.at(-1).previous, 'v'.repeat(43));
input().onChange({ target: { files: [{}], value: 'fixture.png' } });
rejectUpload(new Error('offline'));
await flush();
assert.equal(button('Save profile').disabled, false);
assert.ok(JSON.stringify(render()).includes('offline'));
input().onChange({ target: { files: [{}], value: 'fixture.png' } });
finishUpload('j'.repeat(43));
await flush();
failSave = true;
await button('Save profile').onClick();
assert.ok(JSON.stringify(render()).includes('503'));
failSave = false;
await button('Save profile').onClick();
assert.equal(writes.at(-1).avatar_id, 'j'.repeat(43), 'retry keeps staged image without reload');
const publish = read('redux/actions/publish.ts');
const editStart = publish.indexOf('export const doPrepareEdit =');
const editSource = publish.slice(
  editStart,
  publish.indexOf('// ---------------------------------------------------------------------------', editStart)
);
for (const native of [true, false]) {
  const events = [];
  const { doPrepareEdit } = compile(
    editSource,
    {},
    {
      assert,
      RENDER_MODES: { MARKDOWN: 'markdown' },
      PUBLISH_TYPES: { FILE: 'file', POST: 'post', LIVESTREAM: 'livestream' },
      PUBLISH_PATH_MAP: { file: 'upload' },
      makeSelectFileRenderModeForUri: () => () => 'video',
      isStreamPlaceholderClaim: () => false,
      THUMBNAIL_STATUSES: { MANUAL: 'manual' },
      CC_LICENSES: [],
      NONE: 'none',
      PUBLIC_DOMAIN: 'public',
      COPYRIGHT: 'copyright',
      OTHER: 'other',
      isClaimNsfw: () => false,
      parseRentalTag: () => null,
      parsePurchaseTag: () => null,
      PAYWALL: { FREE: 'free' },
      MEMBERS_ONLY_CONTENT_TAG: 'members',
      VISIBILITY_TAGS: { UNLISTED: 'unlisted', PRIVATE: 'private' },
      SCHEDULED_TAGS: { HIDE: 'hidden', SHOW: 'show' },
      doSetIncognito: () => ({ type: 'incognito' }),
      ACTIONS: { DO_PREPARE_EDIT: 'prepare' },
      hyperbeamUploadEnabled: () => native,
      doClearPlayingUri: () => ({ type: 'clear-playback' }),
      navigateTo: (url) => events.push(url),
    }
  );
  await doPrepareEdit(
    { name: 'video', claim_id: 'id', value: { tags: [] } },
    'uri',
    ''
  )(
    (action) => events.push(action.type),
    () => ({})
  );
  assert.deepEqual(
    events,
    native ? ['incognito', 'prepare', 'clear-playback', '/$/upload'] : ['incognito', 'prepare', '/$/upload']
  );
}
console.log(
  'PASS: actual cover/avatar selectors and profile component upload/save/retry contracts (mock hooks/transport, not browser acceptance).'
);
