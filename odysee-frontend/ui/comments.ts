import { COMMENT_SERVER_API } from 'config';
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
import { isHyperbeamEnabled } from 'util/hyperbeamMode';

function hyperbeamOrLegacy<T>(hyperbeam: Promise<T | null>, legacy: () => Promise<T>, label: string): Promise<T> {
  if (!isHyperbeamEnabled()) return legacy();
  return hyperbeam.then((result) => {
    if (result) return result;
    throw new Error(`HyperBEAM ${label} unavailable`);
  });
}

// prettier-ignore
const Comments = {
  url: COMMENT_SERVER_API,
  enabled: Boolean(COMMENT_SERVER_API),
  moderation_block: (params: ModerationBlockParams) => hyperbeamOrLegacy(fetchHyperbeamModerationBlock(params), () => fetchCommentsApi('moderation.Block', params), 'moderation block'),
  moderation_unblock: (params: ModerationBlockParams) => hyperbeamOrLegacy(fetchHyperbeamModerationUnblock(params), () => fetchCommentsApi('moderation.UnBlock', params), 'moderation unblock'),
  moderation_block_list: (params: BlockedListArgs) => hyperbeamOrLegacy(fetchHyperbeamModerationBlockList(params), () => fetchCommentsApi('moderation.BlockedList', params), 'moderation blocked list'),
  moderation_add_delegate: (params: ModerationAddDelegateParams) => hyperbeamOrLegacy(fetchHyperbeamModerationAddDelegate(params), () => fetchCommentsApi('moderation.AddDelegate', params), 'moderation add delegate'),
  moderation_remove_delegate: (params: ModerationRemoveDelegateParams) => hyperbeamOrLegacy(fetchHyperbeamModerationRemoveDelegate(params), () => fetchCommentsApi('moderation.RemoveDelegate', params), 'moderation remove delegate'),
  moderation_list_delegates: (params: ModerationListDelegatesParams) => hyperbeamOrLegacy(fetchHyperbeamModerationListDelegates(params), () => fetchCommentsApi('moderation.ListDelegates', params), 'moderation list delegates'),
  moderation_am_i: (params: ModerationAmIParams) => hyperbeamOrLegacy(fetchHyperbeamModerationAmI(params), () => fetchCommentsApi('moderation.AmI', params), 'moderation am i'),
  comment_list: (params: CommentListParams) => hyperbeamOrLegacy(fetchHyperbeamCommentList(params), () => fetchCommentsApi('comment.List', params), 'comment list'),
  comment_abandon: (params: CommentAbandonParams) => hyperbeamOrLegacy(fetchHyperbeamCommentAbandon(params), () => fetchCommentsApi('comment.Abandon', params), 'comment abandon'),
  comment_create: (params: CommentCreateParams) => hyperbeamOrLegacy(fetchHyperbeamCommentCreate(params), () => fetchCommentsApi('comment.Create', params), 'comment create'),
  comment_by_id: (params: CommentByIdParams) => hyperbeamOrLegacy(fetchHyperbeamCommentById(params), () => fetchCommentsApi('comment.ByID', params), 'comment lookup'),
  comment_pin: (params: CommentPinParams) => hyperbeamOrLegacy(fetchHyperbeamCommentPin(params), () => fetchCommentsApi('comment.Pin', params), 'comment pin'),
  comment_edit: (params: CommentEditParams) => hyperbeamOrLegacy(fetchHyperbeamCommentEdit(params), () => fetchCommentsApi('comment.Edit', params), 'comment edit'),
  reaction_list: (params: ReactionListParams) => hyperbeamOrLegacy(fetchHyperbeamReactionList(params), () => fetchCommentsApi('reaction.List', params), 'reaction list'),
  reaction_react: (params: ReactionReactParams) => hyperbeamOrLegacy(fetchHyperbeamReactionReact(params), () => fetchCommentsApi('reaction.React', params), 'reaction react'),
  setting_list: (params: SettingsParams) => hyperbeamOrLegacy(fetchHyperbeamSettingList(params), () => fetchCommentsApi('setting.List', params), 'setting list'),
  setting_block_word: (params: BlockWordParams) => hyperbeamOrLegacy(fetchHyperbeamSettingBlockWord(params), () => fetchCommentsApi('setting.BlockWord', params), 'setting block word'),
  setting_unblock_word: (params: BlockWordParams) => hyperbeamOrLegacy(fetchHyperbeamSettingUnblockWord(params), () => fetchCommentsApi('setting.UnBlockWord', params), 'setting unblock word'),
  setting_list_blocked_words: (params: SettingsParams) => hyperbeamOrLegacy(fetchHyperbeamSettingListBlockedWords(params), () => fetchCommentsApi('setting.ListBlockedWords', params), 'setting list blocked words'),
  setting_update: (params: UpdateSettingsParams) => hyperbeamOrLegacy(fetchHyperbeamSettingUpdate(params), () => fetchCommentsApi('setting.Update', params), 'setting update'),
  setting_get: (params: SettingsParams) => hyperbeamOrLegacy(fetchHyperbeamSettingGet(params), () => fetchCommentsApi('setting.Get', params), 'setting get'),
  super_list: (params: SuperListParams) => fetchCommentsApi('comment.SuperChatList', params),
  verify_claim_signature: (params: VerifyClaimSignatureParams) =>
    hyperbeamOrLegacy(fetchHyperbeamVerifyClaimSignature(params), () => fetchCommentsApi('verify.ClaimSignature', params), 'claim signature verification'),
};

function fetchCommentsApi(method: string, params: {}) {
  if (!Comments.enabled) {
    return Promise.reject('Comments are not currently enabled.'); // eslint-disable-line
  }

  const url = `${Comments.url}?m=${method}`;
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  };
  return fetch(url, options)
    .then((res) => res.json())
    .then((res) => {
      if (res.error) {
        throw new Error(res.error.message);
      }

      return res.result;
    });
}

export default Comments;
