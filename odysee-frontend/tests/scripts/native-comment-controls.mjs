import assert from 'node:assert/strict';
import {
  hasNativeCommentControlAuthority,
  hasNativeCommentControlCommitterAuthority,
  isNativeCommentControlEnabled,
  legacyBlockControlsToImport,
  latestNativeCommentControls,
  nativeCommentControlSignatureData,
  normalizeNativeCommentControl,
  projectNativeCommentControlState,
} from '../../ui/util/nativeCommentControls.ts';

const raw = {
  schema: 'odysee-comment-control@1.0',
  type: 'comment-control',
  control: 'pin',
  action: 'pinned',
  authority: 'owner',
  target: 'claim-a',
  'comment-id': 'comment-a',
  owner: 'channel-owner',
  actor: 'channel-owner',
  'actor-name': '@owner',
  'source-system': 'legacy-commentron',
  'event-timestamp': 100,
  'signature-scope': 'native-comment-control-v1',
};
const normalized = {
  schema: 'odysee-comment-control@1.0',
  type: 'comment-control',
  control: 'pin',
  action: 'pinned',
  authority: 'owner',
  target: 'claim-a',
  comment_id: 'comment-a',
  owner: 'channel-owner',
  actor: 'channel-owner',
  actor_name: '@owner',
  source_system: 'legacy-commentron',
  event_timestamp: 100,
  signature_scope: 'native-comment-control-v1',
};
assert.equal(nativeCommentControlSignatureData(raw), nativeCommentControlSignatureData(normalized));
assert.equal(
  nativeCommentControlSignatureData(raw),
  nativeCommentControlSignatureData({ ...raw, target: undefined, 'target-id': raw.target })
);
assert.equal(normalizeNativeCommentControl({ ...raw, target: undefined, 'target-id': raw.target }).target, raw.target);
assert.notEqual(
  nativeCommentControlSignatureData(raw),
  nativeCommentControlSignatureData({ ...raw, action: 'unpinned' })
);
assert.notEqual(
  nativeCommentControlSignatureData(raw),
  nativeCommentControlSignatureData({ ...raw, 'source-system': 'native' })
);

const controls = latestNativeCommentControls([
  { ...normalized, hyperbeam_message_id: 'a' },
  { ...normalized, action: 'unpinned', event_timestamp: 101, hyperbeam_message_id: 'b' },
  {
    ...normalized,
    control: 'visibility',
    action: 'hidden',
    authority: 'author',
    event_timestamp: 102,
    hyperbeam_message_id: 'c',
  },
  {
    ...normalized,
    control: 'visibility',
    action: 'visible',
    authority: 'owner',
    event_timestamp: 103,
    hyperbeam_message_id: 'd',
  },
  {
    ...normalized,
    control: 'block',
    action: 'blocked',
    target: 'channel-owner',
    subject: 'channel-author',
    expires_at: 200,
    event_timestamp: 104,
    hyperbeam_message_id: 'e',
  },
]);
assert.equal(isNativeCommentControlEnabled(controls.get('pin:comment-a')), false);
assert.equal(isNativeCommentControlEnabled(controls.get('visibility:author:comment-a')), true);
assert.equal(isNativeCommentControlEnabled(controls.get('visibility:owner:comment-a')), false);
assert.equal(isNativeCommentControlEnabled(controls.get('block:channel-owner:channel-author'), 199000), true);
assert.equal(isNativeCommentControlEnabled(controls.get('block:channel-owner:channel-author'), 201000), false);

const tied = latestNativeCommentControls([
  { ...normalized, action: 'pinned', event_timestamp: 200, hyperbeam_message_id: 'a' },
  { ...normalized, action: 'unpinned', event_timestamp: 200, hyperbeam_message_id: 'b' },
]);
assert.equal(isNativeCommentControlEnabled(tied.get('pin:comment-a')), false);

const ownerContext = {
  target: 'claim-a',
  owner: 'channel-owner',
  comment: {
    comment_id: 'comment-a',
    claim_id: 'claim-a',
    channel_id: 'channel-author',
  },
};
assert.equal(hasNativeCommentControlAuthority(raw, ownerContext), true);
assert.equal(
  hasNativeCommentControlAuthority({ ...raw, actor: 'channel-author', 'actor-name': '@author' }, ownerContext),
  false
);
assert.equal(
  hasNativeCommentControlAuthority(raw, {
    ...ownerContext,
    comment: { ...ownerContext.comment, parent_id: 'parent-comment' },
  }),
  false
);
assert.equal(
  hasNativeCommentControlAuthority({ ...raw, control: 'creator-like', action: 'liked' }, ownerContext),
  true
);
assert.equal(
  hasNativeCommentControlAuthority(
    {
      ...raw,
      control: 'visibility',
      action: 'hidden',
      authority: 'author',
      actor: 'channel-author',
      'actor-name': '@author',
    },
    ownerContext
  ),
  true
);
assert.equal(
  hasNativeCommentControlAuthority(
    {
      ...raw,
      control: 'visibility',
      action: 'hidden',
      authority: 'author',
      actor: 'channel-author',
      'actor-name': '@author',
      owner: 'previous-owner',
    },
    ownerContext
  ),
  true
);
assert.equal(hasNativeCommentControlAuthority({ ...raw, owner: 'previous-owner' }, ownerContext), false);
assert.equal(hasNativeCommentControlAuthority({ ...raw, control: 'visibility', action: 'hidden' }, ownerContext), true);
assert.equal(
  hasNativeCommentControlAuthority(
    {
      ...raw,
      control: 'block',
      action: 'blocked',
      target: 'channel-owner',
      subject: 'channel-author',
    },
    { target: 'claim-a', owner: 'channel-owner' }
  ),
  true
);
assert.equal(
  hasNativeCommentControlAuthority(
    {
      ...raw,
      control: 'block',
      action: 'blocked',
      target: 'channel-owner',
      subject: 'channel-author',
      actor: 'channel-author',
    },
    { target: 'claim-a', owner: 'channel-owner' }
  ),
  false
);

const verifiedOwnerControl = {
  ...raw,
  hyperbeam_owner: 'account-owner',
  hyperbeam_commitment_verification: 'verified',
};
assert.equal(
  hasNativeCommentControlCommitterAuthority(verifiedOwnerControl, {
    targetOwner: 'account-owner',
    comment: { ...ownerContext.comment, hyperbeam_owner: 'account-author' },
  }),
  true
);
assert.equal(
  hasNativeCommentControlCommitterAuthority(verifiedOwnerControl, {
    targetOwner: 'attacker',
    comment: { ...ownerContext.comment, hyperbeam_owner: 'account-author' },
  }),
  false
);
const verifiedAuthorControl = {
  ...verifiedOwnerControl,
  control: 'visibility',
  action: 'hidden',
  authority: 'author',
  actor: 'channel-author',
  hyperbeam_owner: 'account-author',
};
assert.equal(
  hasNativeCommentControlCommitterAuthority(verifiedAuthorControl, {
    targetOwner: 'account-owner',
    comment: { ...ownerContext.comment, hyperbeam_owner: 'account-author' },
  }),
  true
);
assert.equal(
  hasNativeCommentControlCommitterAuthority(
    { ...verifiedAuthorControl, hyperbeam_commitment_verification: 'unverified' },
    {
      targetOwner: 'account-owner',
      comment: { ...ownerContext.comment, hyperbeam_owner: 'account-author' },
    }
  ),
  false
);

const projected = projectNativeCommentControlState(ownerContext.comment, 'channel-owner', controls);
assert.deepEqual(projected, {
  removed: true,
  hidden: false,
  blocked: false,
  is_pinned: false,
  creator_liked: false,
});
const activeProjection = projectNativeCommentControlState(
  ownerContext.comment,
  'channel-owner',
  latestNativeCommentControls([
    { ...normalized, hyperbeam_message_id: 'pin' },
    {
      ...normalized,
      control: 'creator-like',
      action: 'liked',
      hyperbeam_message_id: 'heart',
    },
    {
      ...normalized,
      control: 'block',
      action: 'unblocked',
      target: 'channel-owner',
      subject: 'channel-author',
      hyperbeam_message_id: 'unblock',
    },
  ])
);
assert.deepEqual(activeProjection, {
  removed: false,
  hidden: false,
  blocked: false,
  is_pinned: true,
  creator_liked: true,
});
const blockedProjection = projectNativeCommentControlState(
  ownerContext.comment,
  'channel-owner',
  latestNativeCommentControls([
    { ...normalized, hyperbeam_message_id: 'pin' },
    {
      ...normalized,
      control: 'block',
      action: 'blocked',
      target: 'channel-owner',
      subject: 'channel-author',
      hyperbeam_message_id: 'block',
    },
  ])
);
assert.deepEqual(blockedProjection, {
  removed: false,
  hidden: false,
  blocked: true,
  is_pinned: false,
  creator_liked: false,
});

assert.deepEqual(
  legacyBlockControlsToImport(
    [
      {
        blocked_channel_id: 'legacy-only',
        blocked_channel_name: '@legacy',
        ban_remaining: 60,
      },
      {
        blocked_channel_id: 'native-history',
        blocked_channel_name: '@native',
      },
      {
        blocked_channel_id: 'inactive',
        blocked_channel_name: '@inactive',
        blocked: false,
      },
    ],
    [{ blocked_channel_id: 'native-history', blocked: false }],
    100000
  ),
  [{ subject: 'legacy-only', subject_name: '@legacy', expires_at: 160 }]
);
assert.deepEqual(
  legacyBlockControlsToImport(
    [
      {
        blocked_channel_id: 'dated',
        blocked_channel_name: '@dated',
        blocked_at: '1970-01-01T00:01:40.000Z',
        banned_for: 60,
      },
    ],
    [],
    100000
  ),
  [{ subject: 'dated', subject_name: '@dated', expires_at: 160 }]
);

console.log('native comment control tests passed');
