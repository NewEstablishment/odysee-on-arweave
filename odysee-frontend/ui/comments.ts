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

function hyperbeamOnly<T>(hyperbeam: Promise<T | null>, label: string): Promise<T> {
  return hyperbeam.then((result) => {
    if (result !== null && result !== undefined) return result;
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
  request = hyperbeamOnly(fetchHyperbeamCommentList(params), 'comment list').finally(() => {
    if (commentListInFlight.get(key) === request) commentListInFlight.delete(key);
  });
  commentListInFlight.set(key, request);
  return request;
}

// prettier-ignore
const Comments = {
  moderation_block: (params: ModerationBlockParams) => hyperbeamOnly(fetchHyperbeamModerationBlock(params), 'moderation block'),
  moderation_unblock: (params: ModerationBlockParams) => hyperbeamOnly(fetchHyperbeamModerationUnblock(params), 'moderation unblock'),
  moderation_block_list: (params: BlockedListArgs) => hyperbeamOnly(fetchHyperbeamModerationBlockList(params), 'moderation blocked list'),
  moderation_add_delegate: (params: ModerationAddDelegateParams) => hyperbeamOnly(fetchHyperbeamModerationAddDelegate(params), 'moderation add delegate'),
  moderation_remove_delegate: (params: ModerationRemoveDelegateParams) => hyperbeamOnly(fetchHyperbeamModerationRemoveDelegate(params), 'moderation remove delegate'),
  moderation_list_delegates: (params: ModerationListDelegatesParams) => hyperbeamOnly(fetchHyperbeamModerationListDelegates(params), 'moderation list delegates'),
  moderation_am_i: (params: ModerationAmIParams) => hyperbeamOnly(fetchHyperbeamModerationAmI(params), 'moderation am i'),
  comment_list: commentList,
  comment_abandon: (params: CommentAbandonParams) => hyperbeamOnly(fetchHyperbeamCommentAbandon(params), 'comment abandon'),
  comment_create: (params: CommentCreateParams) => hyperbeamOnly(fetchHyperbeamCommentCreate(params), 'comment create'),
  comment_by_id: (params: CommentByIdParams) => hyperbeamOnly(fetchHyperbeamCommentById(params), 'comment lookup'),
  comment_pin: (params: CommentPinParams) => hyperbeamOnly(fetchHyperbeamCommentPin(params), 'comment pin'),
  comment_edit: (params: CommentEditParams) => hyperbeamOnly(fetchHyperbeamCommentEdit(params), 'comment edit'),
  reaction_list: (params: ReactionListParams) => hyperbeamOnly(fetchHyperbeamReactionList(params), 'reaction list'),
  reaction_react: (params: ReactionReactParams) => hyperbeamOnly(fetchHyperbeamReactionReact(params), 'reaction react'),
  setting_list: (params: SettingsParams) => hyperbeamOnly(fetchHyperbeamSettingList(params), 'setting list'),
  setting_block_word: (params: BlockWordParams) => hyperbeamOnly(fetchHyperbeamSettingBlockWord(params), 'setting block word'),
  setting_unblock_word: (params: BlockWordParams) => hyperbeamOnly(fetchHyperbeamSettingUnblockWord(params), 'setting unblock word'),
  setting_list_blocked_words: (params: SettingsParams) => hyperbeamOnly(fetchHyperbeamSettingListBlockedWords(params), 'setting list blocked words'),
  setting_update: (params: UpdateSettingsParams) => hyperbeamOnly(fetchHyperbeamSettingUpdate(params), 'setting update'),
  setting_get: (params: SettingsParams) => hyperbeamOnly(fetchHyperbeamSettingGet(params), 'setting get'),
  super_list: (_params: SuperListParams) => Promise.reject(new Error('Native super chats are not implemented')),
  verify_claim_signature: (params: VerifyClaimSignatureParams) =>
    hyperbeamOnly(fetchHyperbeamVerifyClaimSignature(params), 'claim signature verification'),
};

export default Comments;
