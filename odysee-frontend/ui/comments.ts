import { COMMENT_SERVER_API } from 'config';
import {
  fetchHyperbeamCommentById,
  fetchHyperbeamCommentList,
  fetchHyperbeamReactionList,
  fetchHyperbeamVerifyClaimSignature,
} from 'util/hyperbeam';
import { isHyperbeamEnabled } from 'util/hyperbeamMode';
import { callHyperbeamComment } from 'services/hyperbeamUserState';

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
  moderation_block: (params: ModerationBlockParams) => hyperbeamOrLegacy(callHyperbeamComment('moderation.Block', params), () => fetchCommentsApi('moderation.Block', params), 'moderation block'),
  moderation_unblock: (params: ModerationBlockParams) => hyperbeamOrLegacy(callHyperbeamComment('moderation.UnBlock', params), () => fetchCommentsApi('moderation.UnBlock', params), 'moderation unblock'),
  moderation_block_list: (params: BlockedListArgs) => hyperbeamOrLegacy(callHyperbeamComment('moderation.BlockedList', params), () => fetchCommentsApi('moderation.BlockedList', params), 'moderation block list'),
  moderation_add_delegate: (params: ModerationAddDelegateParams) => hyperbeamOrLegacy(callHyperbeamComment('moderation.AddDelegate', params), () => fetchCommentsApi('moderation.AddDelegate', params), 'moderation add delegate'),
  moderation_remove_delegate: (params: ModerationRemoveDelegateParams) => hyperbeamOrLegacy(callHyperbeamComment('moderation.RemoveDelegate', params), () => fetchCommentsApi('moderation.RemoveDelegate', params), 'moderation remove delegate'),
  moderation_list_delegates: (params: ModerationListDelegatesParams) => hyperbeamOrLegacy(callHyperbeamComment('moderation.ListDelegates', params), () => fetchCommentsApi('moderation.ListDelegates', params), 'moderation delegates'),
  moderation_am_i: (params: ModerationAmIParams) => hyperbeamOrLegacy(callHyperbeamComment('moderation.AmI', params), () => fetchCommentsApi('moderation.AmI', params), 'moderation status'),
  comment_list: (params: CommentListParams) => hyperbeamOrLegacy(fetchHyperbeamCommentList(params), () => fetchCommentsApi('comment.List', params), 'comment list'),
  comment_abandon: (params: CommentAbandonParams) => hyperbeamOrLegacy(callHyperbeamComment('comment.Abandon', params), () => fetchCommentsApi('comment.Abandon', params), 'comment abandon'),
  comment_create: (params: CommentCreateParams) => hyperbeamOrLegacy(callHyperbeamComment('comment.Create', params), () => fetchCommentsApi('comment.Create', params), 'comment create'),
  comment_by_id: (params: CommentByIdParams) => hyperbeamOrLegacy(fetchHyperbeamCommentById(params), () => fetchCommentsApi('comment.ByID', params), 'comment lookup'),
  comment_pin: (params: CommentPinParams) => hyperbeamOrLegacy(callHyperbeamComment('comment.Pin', params), () => fetchCommentsApi('comment.Pin', params), 'comment pin'),
  comment_edit: (params: CommentEditParams) => hyperbeamOrLegacy(callHyperbeamComment('comment.Edit', params), () => fetchCommentsApi('comment.Edit', params), 'comment edit'),
  reaction_list: (params: ReactionListParams) => hyperbeamOrLegacy(fetchHyperbeamReactionList(params), () => fetchCommentsApi('reaction.List', params), 'reaction list'),
  reaction_react: (params: ReactionReactParams) => hyperbeamOrLegacy(callHyperbeamComment('reaction.React', params), () => fetchCommentsApi('reaction.React', params), 'reaction update'),
  setting_list: (params: SettingsParams) => hyperbeamOrLegacy(callHyperbeamComment('setting.List', params), () => fetchCommentsApi('setting.List', params), 'comment settings list'),
  setting_block_word: (params: BlockWordParams) => hyperbeamOrLegacy(callHyperbeamComment('setting.BlockWord', params), () => fetchCommentsApi('setting.BlockWord', params), 'comment block word'),
  setting_unblock_word: (params: BlockWordParams) => hyperbeamOrLegacy(callHyperbeamComment('setting.UnBlockWord', params), () => fetchCommentsApi('setting.UnBlockWord', params), 'comment unblock word'),
  setting_list_blocked_words: (params: SettingsParams) => hyperbeamOrLegacy(callHyperbeamComment('setting.ListBlockedWords', params), () => fetchCommentsApi('setting.ListBlockedWords', params), 'comment blocked words'),
  setting_update: (params: UpdateSettingsParams) => hyperbeamOrLegacy(callHyperbeamComment('setting.Update', params), () => fetchCommentsApi('setting.Update', params), 'comment settings update'),
  setting_get: (params: SettingsParams) => hyperbeamOrLegacy(callHyperbeamComment('setting.Get', params), () => fetchCommentsApi('setting.Get', params), 'comment settings get'),
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
