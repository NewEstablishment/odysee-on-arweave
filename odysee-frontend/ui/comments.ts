import {
  fetchHyperbeamCommentAbandon,
  fetchHyperbeamCommentById,
  fetchHyperbeamCommentCreate,
  fetchHyperbeamCommentEdit,
  fetchHyperbeamCommentList,
  fetchHyperbeamCommentPin,
  fetchHyperbeamModerationAddDelegate,
  fetchHyperbeamModerationAmI,
  fetchHyperbeamModerationBlock,
  fetchHyperbeamModerationBlockList,
  fetchHyperbeamModerationListDelegates,
  fetchHyperbeamModerationRemoveDelegate,
  fetchHyperbeamModerationUnblock,
  fetchHyperbeamReactionList,
  fetchHyperbeamReactionReact,
  fetchHyperbeamSettingBlockWord,
  fetchHyperbeamSettingGet,
  fetchHyperbeamSettingList,
  fetchHyperbeamSettingListBlockedWords,
  fetchHyperbeamSettingUnblockWord,
  fetchHyperbeamSettingUpdate,
  fetchHyperbeamVerifyClaimSignature,
} from 'util/hyperbeam';

function requireHyperbeam<T>(request: Promise<T | null>, label: string): Promise<T> {
  return request.then((result) => {
    if (result) return result;
    throw new Error(`HyperBEAM ${label} unavailable`);
  });
}

const commentListInFlight = new Map<string, Promise<CommentListResponse>>();

function commentList(params: CommentListParams): Promise<CommentListResponse> {
  const key = JSON.stringify(
    Object.keys(params)
      .sort()
      .map((name) => [name, params[name]])
  );
  const existing = commentListInFlight.get(key);
  if (existing) return existing;

  let request: Promise<CommentListResponse>;
  request = requireHyperbeam(fetchHyperbeamCommentList(params), 'comment list').finally(() => {
    if (commentListInFlight.get(key) === request) commentListInFlight.delete(key);
  });
  commentListInFlight.set(key, request);
  return request;
}

// prettier-ignore
const Comments = {
  enabled: true,
  moderation_block: (params: ModerationBlockParams) => requireHyperbeam(fetchHyperbeamModerationBlock(params), 'moderation block'),
  moderation_unblock: (params: ModerationBlockParams) => requireHyperbeam(fetchHyperbeamModerationUnblock(params), 'moderation unblock'),
  moderation_block_list: (params: BlockedListArgs) => requireHyperbeam(fetchHyperbeamModerationBlockList(params), 'moderation blocked list'),
  moderation_add_delegate: (params: ModerationAddDelegateParams) => requireHyperbeam(fetchHyperbeamModerationAddDelegate(params), 'moderation add delegate'),
  moderation_remove_delegate: (params: ModerationRemoveDelegateParams) => requireHyperbeam(fetchHyperbeamModerationRemoveDelegate(params), 'moderation remove delegate'),
  moderation_list_delegates: (params: ModerationListDelegatesParams) => requireHyperbeam(fetchHyperbeamModerationListDelegates(params), 'moderation list delegates'),
  moderation_am_i: (params: ModerationAmIParams) => requireHyperbeam(fetchHyperbeamModerationAmI(params), 'moderation am i'),
  comment_list: commentList,
  comment_abandon: (params: CommentAbandonParams) => requireHyperbeam(fetchHyperbeamCommentAbandon(params), 'comment abandon'),
  comment_create: (params: CommentCreateParams) => requireHyperbeam(fetchHyperbeamCommentCreate(params), 'comment create'),
  comment_by_id: (params: CommentByIdParams) => requireHyperbeam(fetchHyperbeamCommentById(params), 'comment lookup'),
  comment_pin: (params: CommentPinParams) => requireHyperbeam(fetchHyperbeamCommentPin(params), 'comment pin'),
  comment_edit: (params: CommentEditParams) => requireHyperbeam(fetchHyperbeamCommentEdit(params), 'comment edit'),
  reaction_list: (params: ReactionListParams) => requireHyperbeam(fetchHyperbeamReactionList(params), 'reaction list'),
  reaction_react: (params: ReactionReactParams) => requireHyperbeam(fetchHyperbeamReactionReact(params), 'reaction react'),
  setting_list: (params: SettingsParams) => requireHyperbeam(fetchHyperbeamSettingList(params), 'setting list'),
  setting_block_word: (params: BlockWordParams) => requireHyperbeam(fetchHyperbeamSettingBlockWord(params), 'setting block word'),
  setting_unblock_word: (params: BlockWordParams) => requireHyperbeam(fetchHyperbeamSettingUnblockWord(params), 'setting unblock word'),
  setting_list_blocked_words: (params: SettingsParams) => requireHyperbeam(fetchHyperbeamSettingListBlockedWords(params), 'setting blocked words'),
  setting_update: (params: UpdateSettingsParams) => requireHyperbeam(fetchHyperbeamSettingUpdate(params), 'setting update'),
  setting_get: (params: SettingsParams) => requireHyperbeam(fetchHyperbeamSettingGet(params), 'setting get'),
  super_list: (_params: SuperListParams) => Promise.reject(new Error('Native super chats are not implemented')),
  verify_claim_signature: (params: VerifyClaimSignatureParams) => requireHyperbeam(fetchHyperbeamVerifyClaimSignature(params), 'claim signature verification'),
};

export default Comments;
