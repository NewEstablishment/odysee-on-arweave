%%% @doc Odysee Commentron compatibility device.
%%%
%%% This device exposes read-only Commentron rows as AO-Core messages. It keeps
%%% raw API responses beside normalized fields and preserves signature inputs
%%% for later verification against LBRY channel public keys.
-module(dev_odysee_comment).
-implements(<<"odysee-comment@1.0">>).
-export([
    info/1,
    list/3,
    super_list/3,
    by_id/3,
    create/3,
    edit/3,
    pin/3,
    abandon/3,
    reaction_react/3,
    setting_get/3,
    setting_list/3,
    setting_update/3,
    setting_block_word/3,
    setting_unblock_word/3,
    setting_list_blocked_words/3,
    moderation_block/3,
    moderation_unblock/3,
    moderation_block_list/3,
    moderation_add_delegate/3,
    moderation_remove_delegate/3,
    moderation_list_delegates/3,
    moderation_am_i/3,
    normalize/3,
    verify_signature/3,
    verify_claim_signature/3
]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-comment@1.0">>).
-define(DEFAULT_COMMENT_URL, <<"https://comments.odysee.tv/api/v2">>).

%% @doc Return the public device API.
info(_Opts) ->
    #{
        exports => [
            <<"list">>,
            <<"super-list">>,
            <<"by-id">>,
            <<"create">>,
            <<"edit">>,
            <<"pin">>,
            <<"abandon">>,
            <<"reaction-react">>,
            <<"setting-get">>,
            <<"setting-list">>,
            <<"setting-update">>,
            <<"setting-block-word">>,
            <<"setting-unblock-word">>,
            <<"setting-list-blocked-words">>,
            <<"moderation-block">>,
            <<"moderation-unblock">>,
            <<"moderation-block-list">>,
            <<"moderation-add-delegate">>,
            <<"moderation-remove-delegate">>,
            <<"moderation-list-delegates">>,
            <<"moderation-am-i">>,
            <<"normalize">>,
            <<"verify-signature">>,
            <<"verify-claim-signature">>
        ]
    }.

%% @doc Return a normalized `comment.List' response. Native comments stored
%% on this node (matched by their uniform `target' -- an immutable id or a
%% claim id) are merged ahead of the Commentron rows; when Commentron cannot
%% answer (e.g. native-only content with no claim id), the native set is the
%% whole response.
list(Base, Req, Opts) ->
    safe(fun() ->
        Native = native_comments_for_request(Base, Req, Opts),
        case list_result(Base, Req, Opts) of
            {ok, Result, Raw} ->
                Merged = merge_native_items(Native, Result, Opts),
                normalize_list(Merged, merged_raw_body(Native, Merged, Raw), Opts);
            _Error when Native =/= [] ->
                Merged = #{
                    <<"items">> => Native,
                    <<"total_items">> => length(Native),
                    <<"total_filtered_items">> => length(Native),
                    <<"page">> => 1,
                    <<"total_pages">> => 1
                },
                normalize_list(Merged, merged_raw_body(Native, Merged, <<"{}">>), Opts);
            Error ->
                Error
        end
    end).

%% The HTTP layer serves the message's `body', so merged native comments
%% must be re-encoded into it -- otherwise browser callers reading the raw
%% Commentron payload never see them.
merged_raw_body([], _Merged, Raw) ->
    Raw;
merged_raw_body(_Native, Merged, Raw) ->
    Envelope =
        case try_decode_json(Raw) of
            {ok, Decoded} when is_map(Decoded) ->
                case maps:is_key(<<"result">>, Decoded) of
                    true -> Decoded#{ <<"result">> => Merged };
                    false -> #{ <<"jsonrpc">> => <<"2.0">>, <<"result">> => Merged }
                end;
            _ ->
                #{ <<"jsonrpc">> => <<"2.0">>, <<"result">> => Merged }
        end,
    hb_json:encode(Envelope).

super_list(Base, Req, Opts) -> commentron(<<"comment.SuperChatList">>, Base, Req, Opts).

%% @doc Return a normalized `comment.ByID' response. Native comment ids are
%% cache message ids, so they are looked up locally first; anything else
%% falls through to Commentron.
by_id(Base, Req, Opts) ->
    safe(fun() ->
        case native_comment_by_id(Base, Req, Opts) of
            {ok, Comment} ->
                normalize_single_comment(
                    Comment,
                    hb_json:encode(#{
                        <<"jsonrpc">> => <<"2.0">>,
                        <<"result">> => #{ <<"item">> => Comment, <<"ancestors">> => [] }
                    }),
                    Opts
                );
            not_found ->
                maybe
                    {ok, Result, Raw} ?= by_id_result(Base, Req, Opts),
                    normalize_by_id(Result, Raw, Opts)
                else
                    Error -> Error
                end
        end
    end).

%% @doc Create a comment. Requests carrying a `target' (the uniform match
%% field from the 2026-07-29 direction: the content's immutable id, or its
%% claim id for legacy videos) are stored natively on this node -- the
%% comment id IS the cache message id, so `GET /<comment-id>' returns the
%% comment verifiably. Requests without a target keep proxying to
%% Commentron until the client migrates.
create(Base, Req, Opts) ->
    case native_target(Base, Req, Opts) of
        {ok, Target} -> native_create(Target, Base, Req, Opts);
        not_found -> commentron(<<"comment.Create">>, Base, Req, Opts)
    end.
edit(Base, Req, Opts) -> commentron(<<"comment.Edit">>, Base, Req, Opts).
pin(Base, Req, Opts) -> commentron(<<"comment.Pin">>, Base, Req, Opts).
abandon(Base, Req, Opts) -> commentron(<<"comment.Abandon">>, Base, Req, Opts).
reaction_react(Base, Req, Opts) -> commentron(<<"reaction.React">>, Base, Req, Opts).
setting_get(Base, Req, Opts) -> commentron(<<"setting.Get">>, Base, Req, Opts).
setting_list(Base, Req, Opts) -> commentron(<<"setting.List">>, Base, Req, Opts).
setting_update(Base, Req, Opts) -> commentron(<<"setting.Update">>, Base, Req, Opts).
setting_block_word(Base, Req, Opts) -> commentron(<<"setting.BlockWord">>, Base, Req, Opts).
setting_unblock_word(Base, Req, Opts) -> commentron(<<"setting.UnBlockWord">>, Base, Req, Opts).
setting_list_blocked_words(Base, Req, Opts) -> commentron(<<"setting.ListBlockedWords">>, Base, Req, Opts).
moderation_block(Base, Req, Opts) -> commentron(<<"moderation.Block">>, Base, Req, Opts).
moderation_unblock(Base, Req, Opts) -> commentron(<<"moderation.UnBlock">>, Base, Req, Opts).
moderation_block_list(Base, Req, Opts) -> commentron(<<"moderation.BlockedList">>, Base, Req, Opts).
moderation_add_delegate(Base, Req, Opts) -> commentron(<<"moderation.AddDelegate">>, Base, Req, Opts).
moderation_remove_delegate(Base, Req, Opts) -> commentron(<<"moderation.RemoveDelegate">>, Base, Req, Opts).
moderation_list_delegates(Base, Req, Opts) -> commentron(<<"moderation.ListDelegates">>, Base, Req, Opts).
moderation_am_i(Base, Req, Opts) -> commentron(<<"moderation.AmI">>, Base, Req, Opts).

commentron(Method, Base, Req, Opts) ->
    safe(fun() ->
        case proxy_params(Base, Req, Opts) of
            {ok, Params} ->
                case api_request(Method, Params, Base, Req, Opts) of
                    {ok, Result, Raw} ->
                        {ok, #{
                            <<"device">> => ?DEVICE,
                            <<"content-type">> => <<"application/json">>,
                            <<"method">> => Method,
                            <<"body">> => Raw,
                            <<"result">> => Result
                        }};
                    {error, {comment_api_error, Error, Raw}} ->
                        {ok, #{
                            <<"device">> => ?DEVICE,
                            <<"status">> => 400,
                            <<"content-type">> => <<"application/json">>,
                            <<"method">> => Method,
                            <<"body">> => Raw,
                            <<"error">> => Error
                        }};
                    Error ->
                        Error
                end;
            Error ->
                Error
        end
    end).

%% --- Native comments -------------------------------------------------------
%%
%% Native comments are cache messages on this node. Their `target' is the
%% uniform match field: the content's immutable id for native uploads, or
%% the claim id for legacy videos. The comment id is the cache message id.

native_target(Base, Req, Opts) ->
    Keys = [<<"target">>, <<"target-id">>, <<"target_id">>, <<"immutable-id">>, <<"immutable_id">>],
    Direct = first_param(Keys, Base, Req, Opts),
    Found =
        case Direct of
            Value when is_binary(Value), Value =/= <<>> ->
                Value;
            _ ->
                % Browser calls carry their params in a JSON body.
                case proxy_params(Base, Req, Opts) of
                    {ok, Params} -> first_value(Keys, Params, Opts);
                    _ -> not_found
                end
        end,
    case Found of
        Target when is_binary(Target), Target =/= <<>> -> {ok, Target};
        _ -> not_found
    end.

native_create(Target, Base, Req, Opts) ->
    safe(fun() ->
        maybe
            {ok, _Owner} ?= native_owner(Base, Req, Opts),
            {ok, Params} ?= proxy_params(Base, Req, Opts),
            {ok, Body} ?= required_first([<<"comment">>, <<"body">>, <<"text">>], Params, Opts),
            Message = native_comment_message(Target, Body, Params),
            % Commit with the node wallet so the comment id is a committed
            % id, not an uncommitted cache hash acting as identity.
            {ok, CommentID} ?= hb_cache:write(hb_message:commit(Message, Opts), Opts),
            Comment = native_comment_row(CommentID, Message),
            {ok, #{
                <<"device">> => ?DEVICE,
                <<"content-type">> => <<"application/json">>,
                <<"method">> => <<"comment.Create">>,
                <<"native">> => true,
                <<"comment-id">> => CommentID,
                % Commentron-shaped envelope: the HTTP layer serves `body'.
                <<"body">> =>
                    hb_json:encode(#{ <<"jsonrpc">> => <<"2.0">>, <<"result">> => Comment }),
                <<"result">> => Comment
            }}
        else
            Error -> Error
        end
    end).

%% Comment writes arrive through the same-origin auth proxy, which vouches
%% for the session by injecting the Odysee auth token -- the same trust the
%% Commentron proxy path runs on (`find_auth_token' is what that path uses).
%% Identity is anchored to a digest of the token when present, or to a
%% verified request signer otherwise; the raw token is never stored.
native_owner(Base, Req, Opts) ->
    Token =
        case find_auth_token(Req, Opts) of
            {ok, ReqToken} -> {ok, ReqToken};
            {error, not_found} -> find_auth_token(Base, Opts)
        end,
    case Token of
        {ok, Found} ->
            {ok, hb_util:encode(hb_crypto:sha256(<<"odysee-auth:", Found/binary>>))};
        {error, not_found} ->
            case native_signers(Req, Opts) of
                [Signer | _] ->
                    case hb_message:verify(Req, signers, Opts) of
                        true -> {ok, Signer};
                        _ -> {error, #{ <<"status">> => 401, <<"body">> => <<"Invalid request signature.">> }}
                    end;
                [] ->
                    {error, #{ <<"status">> => 401, <<"body">> => <<"Authenticated request required.">> }}
            end
    end.

native_signers(Msg, Opts) ->
    try lists:usort(hb_message:signers(Msg, Opts))
    catch _:_ -> []
    end.

%% The message shape mirrors `nativeCommentMessage' in the browser client
%% exactly (schema/type/target/parent/state selectors plus row fields), so
%% comments written here and comments written by the client's cache-write
%% path are one corpus, discovered through the same match index.
native_comment_message(Target, Body, Params) ->
    ChannelID = param_value([<<"channel_id">>, <<"channel-id">>], Params),
    ParentID = param_value([<<"parent_id">>, <<"parent-id">>], Params),
    Optional = [
        {<<"author">>, ChannelID},
        {<<"channel-id">>, ChannelID},
        {<<"claim-id">>, param_value([<<"claim_id">>, <<"claim-id">>], Params)},
        {<<"parent-id">>, ParentID},
        {<<"channel-name">>, param_value([<<"channel_name">>, <<"channel-name">>], Params)},
        {<<"channel-signature">>, param_value([<<"signature">>, <<"channel-signature">>], Params)},
        {<<"signing-ts">>, param_value([<<"signing_ts">>, <<"signing-ts">>], Params)},
        {<<"sticker">>, param_value([<<"sticker">>], Params)},
        {<<"support-amount">>, param_value([<<"support_amount">>, <<"support-amount">>, <<"amount">>], Params)}
    ],
    lists:foldl(
        fun put_optional/2,
        #{
            <<"schema">> => ?DEVICE,
            <<"type">> => <<"comment">>,
            <<"target">> => Target,
            <<"parent">> => parent_or_root(ParentID),
            <<"state">> => <<"active">>,
            <<"comment">> => Body,
            <<"timestamp">> => erlang:system_time(second),
            <<"replies">> => 0,
            <<"is-pinned">> => false
        },
        Optional
    ).

parent_or_root(not_found) -> <<"root">>;
parent_or_root(ParentID) -> ParentID.

param_value(Keys, Params) ->
    case first_value(Keys, Params, #{}) of
        Value when is_binary(Value), Value =/= <<>> -> Value;
        _ -> not_found
    end.

%% Present a native comment message in the Commentron row shape so one
%% normalization path serves both sources.
native_comment_row(CommentID, Message) ->
    Target = maps:get(<<"target">>, Message, <<>>),
    Parent =
        case maps:get(<<"parent-id">>, Message, not_found) of
            not_found ->
                case maps:get(<<"parent">>, Message, <<"root">>) of
                    <<"root">> -> not_found;
                    ParentID -> ParentID
                end;
            ParentID ->
                ParentID
        end,
    Optional = [
        {<<"parent_id">>, Parent},
        {<<"channel_id">>, first_present([<<"channel-id">>, <<"author">>], Message)},
        {<<"channel_name">>, maps:get(<<"channel-name">>, Message, not_found)},
        {<<"signature">>, maps:get(<<"channel-signature">>, Message, not_found)},
        {<<"signing_ts">>, maps:get(<<"signing-ts">>, Message, not_found)},
        {<<"sticker">>, maps:get(<<"sticker">>, Message, not_found)},
        {<<"support_amount">>, maps:get(<<"support-amount">>, Message, not_found)},
        {<<"is_pinned">>, maps:get(<<"is-pinned">>, Message, not_found)},
        {<<"replies">>, maps:get(<<"replies">>, Message, not_found)}
    ],
    lists:foldl(
        fun put_optional/2,
        #{
            <<"comment_id">> => CommentID,
            <<"comment">> => maps:get(<<"comment">>, Message, <<>>),
            <<"claim_id">> => maps:get(<<"claim-id">>, Message, Target),
            <<"target">> => Target,
            <<"timestamp">> => integer_value_or(maps:get(<<"timestamp">>, Message, 0), 0),
            <<"is_hidden">> => false,
            <<"native">> => true
        },
        Optional
    ).

first_present([], _Message) ->
    not_found;
first_present([Key | Rest], Message) ->
    case maps:get(Key, Message, not_found) of
        not_found -> first_present(Rest, Message);
        Value -> Value
    end.

integer_value_or(Value, _Default) when is_integer(Value) -> Value;
integer_value_or(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value)
    catch _:_ -> Default
    end;
integer_value_or(_Value, Default) -> Default.

%% Gather the native comments for a list request: match on every target
%% form the caller supplies (explicit target/immutable id and claim id), so
%% legacy-anchored and native-anchored comments surface together.
native_comments_for_request(Base, Req, Opts) ->
    Targets0 = [
        case native_target(Base, Req, Opts) of
            {ok, Target} -> Target;
            not_found -> not_found
        end,
        case first_param([<<"claim-id">>, <<"claim_id">>], Base, Req, Opts) of
            ClaimID when is_binary(ClaimID), ClaimID =/= <<>> -> ClaimID;
            _ -> not_found
        end
    ],
    Targets = lists:usort([Target || Target <- Targets0, Target =/= not_found]),
    Rows =
        lists:flatmap(
            fun(Target) ->
                % Native comments anchor on `target' (the uniform field), but
                % ones targeting an immutable id also carry the legacy
                % `claim-id' when known -- match both so legacy-keyed pages
                % surface them too.
                native_comment_rows(#{ <<"target">> => Target }, Opts) ++
                    native_comment_rows(#{ <<"claim-id">> => Target }, Opts)
            end,
            Targets
        ),
    filter_native_rows(dedupe_native_rows(Rows), Base, Req, Opts).

%% Discover native comments through the query device's match index -- the
%% same selectors the browser client queries with.
native_comment_rows(Selector, Opts) ->
    Query =
        Selector#{
            <<"schema">> => ?DEVICE,
            <<"type">> => <<"comment">>,
            <<"state">> => <<"active">>
        },
    Request =
        Query#{
            <<"only">> => maps:keys(Query),
            <<"return">> => <<"paths">>,
            <<"cache-control">> => [<<"no-store">>, <<"no-cache">>]
        },
    Paths =
        case catch hb_ao:raw(<<"query@1.0">>, <<"only">>, #{}, Request, Opts) of
            {ok, Found} when is_list(Found) -> Found;
            {ok, Found} when is_map(Found) -> indexed_paths(Found, Opts);
            _ -> []
        end,
    lists:filtermap(
        fun(Path) ->
            ID = hb_path:to_binary(Path),
            case native_comment_read(ID, Opts) of
                {ok, Message} -> {true, native_comment_row(ID, Message)};
                not_found -> false
            end
        end,
        Paths
    ).

indexed_paths(Map, Opts) ->
    Keys = lists:sort([Key || Key <- hb_maps:keys(Map, Opts), is_numeric_key(Key)]),
    [hb_maps:get(Key, Map, <<>>, Opts) || Key <- Keys].

is_numeric_key(Key) when is_integer(Key) -> true;
is_numeric_key(Key) when is_binary(Key) ->
    try _ = binary_to_integer(Key), true
    catch _:_ -> false
    end;
is_numeric_key(_Key) -> false.

native_comment_read(ID, Opts) ->
    try hb_cache:read(ID, Opts) of
        {ok, Msg0} when is_map(Msg0) ->
            Msg = hb_cache:ensure_all_loaded(Msg0, Opts),
            Schema = hb_maps:get(<<"schema">>, Msg, not_found, Opts),
            Type = hb_maps:get(<<"type">>, Msg, not_found, Opts),
            case {Schema, Type} of
                {?DEVICE, <<"comment">>} -> {ok, Msg};
                _ -> not_found
            end;
        _ -> not_found
    catch _:_ ->
        not_found
    end.

native_comment_by_id(Base, Req, Opts) ->
    case comment_id(Base, Req, Opts) of
        {ok, CommentID} ->
            case native_comment_read(CommentID, Opts) of
                {ok, Message} -> {ok, native_comment_row(CommentID, Message)};
                not_found -> not_found
            end;
        _ ->
            not_found
    end.

dedupe_native_rows(Rows) ->
    {Deduped, _Seen} =
        lists:foldl(
            fun(Row, {Acc, Seen}) ->
                ID = maps:get(<<"comment_id">>, Row, <<>>),
                case sets:is_element(ID, Seen) of
                    true -> {Acc, Seen};
                    false -> {[Row | Acc], sets:add_element(ID, Seen)}
                end
            end,
            {[], sets:new()},
            Rows
        ),
    lists:reverse(Deduped).

%% Honor the threading filters Commentron applies server-side.
filter_native_rows(Rows, Base, Req, Opts) ->
    ParentID =
        case first_param([<<"parent-id">>, <<"parent_id">>], Base, Req, Opts) of
            Parent when is_binary(Parent), Parent =/= <<>> -> Parent;
            _ -> not_found
        end,
    TopLevel = truthy(first_param([<<"top-level">>, <<"top_level">>], Base, Req, Opts)),
    lists:filter(
        fun(Row) ->
            RowParent = maps:get(<<"parent_id">>, Row, not_found),
            case {ParentID, TopLevel} of
                {not_found, true} -> RowParent =:= not_found;
                {not_found, _} -> true;
                {_, _} -> RowParent =:= ParentID
            end
        end,
        Rows
    ).

truthy(true) -> true;
truthy(<<"true">>) -> true;
truthy(1) -> true;
truthy(<<"1">>) -> true;
truthy(_) -> false.

%% Native rows are prepended (they are this node's newest state) and the
%% totals adjusted so pagination maths stay coherent.
merge_native_items([], Result, _Opts) ->
    Result;
merge_native_items(Native, Result, Opts) when is_list(Result) ->
    merge_native_items(Native, #{ <<"items">> => Result }, Opts);
merge_native_items(Native, Result, Opts) when is_map(Result) ->
    Items =
        case first_value([<<"items">>, <<"comments">>], Result, Opts) of
            not_found -> [];
            Existing when is_list(Existing) -> Existing;
            Existing -> [Existing]
        end,
    NativeIDs = [maps:get(<<"comment_id">>, Row, <<>>) || Row <- Native],
    Kept =
        lists:filter(
            fun(Item) when is_map(Item) ->
                ID = first_value([<<"comment_id">>, <<"comment-id">>, <<"id">>], Item, Opts),
                not lists:member(ID, NativeIDs);
               (_Item) -> true
            end,
            Items
        ),
    Merged = Native ++ Kept,
    Added = length(Merged) - length(Items),
    Result#{
        <<"items">> => Merged,
        <<"total_items">> => bump_total(first_value([<<"total_items">>, <<"total-items">>], Result, Opts), Added),
        <<"total_filtered_items">> =>
            bump_total(first_value([<<"total_filtered_items">>, <<"total-filtered-items">>], Result, Opts), Added)
    }.

bump_total(not_found, Added) -> Added;
bump_total(Total, Added) when is_integer(Total) -> Total + Added;
bump_total(Total, Added) when is_binary(Total) ->
    try binary_to_integer(Total) + Added
    catch _:_ -> Added
    end;
bump_total(_Total, Added) -> Added.

%% ---------------------------------------------------------------------------

%% @doc Normalize supplied comment data without fetching.
normalize(Base, Req, Opts) ->
    safe(fun() ->
        case result_candidate(Base, Req, Opts) of
            {ok, Result, Raw} ->
                case result_kind(Result, Opts) of
                    list -> normalize_list(Result, Raw, Opts);
                    by_id -> normalize_by_id(Result, Raw, Opts);
                    comment -> normalize_single_comment(Result, Raw, Opts)
                end;
            not_found ->
                {error, comment_not_found}
        end
    end).

%% @doc Verify a Commentron `verify.Signature' payload.
verify_signature(Base, Req, Opts) ->
    safe(fun() ->
        maybe
            {ok, ChannelID} ?= required_param([<<"channel-id">>, <<"channel_id">>], Base, Req, Opts),
            {ok, Data} ?= signature_data(Base, Req, Opts),
            {ok, Signature} ?= required_param([<<"signature">>], Base, Req, Opts),
            {ok, SigningTS} ?= required_param([<<"signing-ts">>, <<"signing_ts">>], Base, Req, Opts),
            {ok, PublicKey} ?= public_key_for_signature(Base, Req, ChannelID, Opts),
            {ok, IsValid} ?= verify_comment_signature(
                ChannelID,
                Data,
                Signature,
                SigningTS,
                PublicKey
            ),
            {ok, signature_response(IsValid)}
        else
            Error -> Error
        end
    end).

%% @doc Verify a Commentron `verify.ClaimSignature' payload.
verify_claim_signature(Base, Req, Opts) ->
    safe(fun() ->
        maybe
            {ok, ClaimID} ?= required_param([<<"claim-id">>, <<"claim_id">>], Base, Req, Opts),
            {ok, ChannelID} ?= required_param([<<"channel-id">>, <<"channel_id">>], Base, Req, Opts),
            {ok, Signature} ?= required_param([<<"signature">>], Base, Req, Opts),
            {ok, SigningTS} ?= required_param([<<"signing-ts">>, <<"signing_ts">>], Base, Req, Opts),
            {ok, PublicKey} ?= public_key_for_signature(Base, Req, ChannelID, Opts),
            {ok, IsValid} ?= verify_comment_signature(
                ChannelID,
                ClaimID,
                Signature,
                SigningTS,
                PublicKey
            ),
            {ok, signature_response(IsValid)}
        else
            Error -> Error
        end
    end).

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> {error, Reason};
        _:Reason -> {error, Reason}
    end.

list_result(Base, Req, Opts) ->
    case result_candidate(Base, Req, Opts) of
        {ok, _Result, _Raw} = Candidate ->
            Candidate;
        not_found ->
            maybe
                {ok, Params} ?= list_params(Base, Req, Opts),
                api_request(<<"comment.List">>, Params, Base, Req, Opts)
            end
    end.

by_id_result(Base, Req, Opts) ->
    case result_candidate(Base, Req, Opts) of
        {ok, _Result, _Raw} = Candidate ->
            Candidate;
        not_found ->
            maybe
                {ok, CommentID} ?= comment_id(Base, Req, Opts),
                Params0 = #{ <<"comment_id">> => CommentID },
                Params =
                    put_optional(
                        {<<"with_ancestors">>, first_found(
                            [
                                {Req, <<"with-ancestors">>},
                                {Req, <<"with_ancestors">>},
                                {Base, <<"with-ancestors">>},
                                {Base, <<"with_ancestors">>}
                            ],
                            Opts
                        )},
                        Params0
                    ),
                api_request(<<"comment.ByID">>, Params, Base, Req, Opts)
            end
    end.

result_candidate(Base, Req, Opts) ->
    Candidates = [
        {Req, <<"result">>},
        {Req, <<"comment-result">>},
        {Req, <<"comment_result">>},
        {Req, <<"comments">>},
        {Req, <<"items">>},
        {Req, <<"item">>},
        {Req, <<"comment">>},
        {Req, <<"body">>},
        {Base, <<"result">>},
        {Base, <<"comment-result">>},
        {Base, <<"comment_result">>},
        {Base, <<"comments">>},
        {Base, <<"items">>},
        {Base, <<"item">>},
        {Base, <<"comment">>},
        {Base, <<"body">>}
    ],
    candidate_from_fields(Candidates, Opts).

candidate_from_fields([], _Opts) ->
    not_found;
candidate_from_fields([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> candidate_from_fields(Rest, Opts);
        Value ->
            case candidate_from_value(Value, Opts) of
                {ok, _Result, _Raw} = Candidate -> Candidate;
                not_found -> candidate_from_fields(Rest, Opts)
            end
    end;
candidate_from_fields([_ | Rest], Opts) ->
    candidate_from_fields(Rest, Opts).

candidate_from_value(Value, Opts) when is_binary(Value) ->
    case try_decode_json(Value) of
        {ok, Decoded} -> decoded_candidate(Decoded, Value, Opts);
        _ -> not_found
    end;
candidate_from_value(Value, Opts) ->
    decoded_candidate(Value, hb_json:encode(Value), Opts).

decoded_candidate(Msg, Raw, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"result">>, Msg, not_found, Opts) of
        not_found ->
            case recognizable_result(Msg, Opts) of
                true -> {ok, Msg, Raw};
                false -> not_found
            end;
        Result ->
            {ok, Result, Raw}
    end;
decoded_candidate(Items, Raw, _Opts) when is_list(Items) ->
    {ok, #{ <<"items">> => Items }, Raw};
decoded_candidate(_Msg, _Raw, _Opts) ->
    not_found.

recognizable_result(Msg, Opts) ->
    has_any([<<"items">>, <<"item">>, <<"comments">>, <<"comment">>], Msg, Opts)
        orelse first_value([<<"comment_id">>, <<"comment-id">>, <<"id">>], Msg, Opts) =/= not_found.

result_kind(Result, Opts) when is_map(Result) ->
    case has_any([<<"items">>, <<"comments">>], Result, Opts) of
        true -> list;
        false ->
            case first_value([<<"comment_id">>, <<"comment-id">>, <<"id">>], Result, Opts) of
                not_found ->
                    case has_any([<<"item">>, <<"comment">>, <<"ancestors">>], Result, Opts) of
                        true -> by_id;
                        false -> comment
                    end;
                _CommentID ->
                    comment
            end
    end;
result_kind(Result, _Opts) when is_list(Result) ->
    list;
result_kind(_Result, _Opts) ->
    comment.

normalize_list(Result, Raw, Opts) when is_list(Result) ->
    normalize_list(#{ <<"items">> => Result }, Raw, Opts);
normalize_list(Result, Raw, Opts) ->
    maybe
        {ok, Comments} ?= normalize_comments(list_items(Result, Opts), Opts),
        Msg0 = #{
            <<"device">> => ?DEVICE,
            <<"content-type">> => <<"application/json">>,
            <<"body">> => Raw,
            <<"comments">> => Comments,
            <<"comment-ids">> => [hb_maps:get(<<"comment-id">>, Comment, not_found, Opts) || Comment <- Comments]
        },
        Optional = [
            {<<"total-items">>, first_value([<<"total_items">>, <<"total-items">>], Result, Opts)},
            {<<"total-filtered-items">>,
                first_value([<<"total_filtered_items">>, <<"total-filtered-items">>], Result, Opts)},
            {<<"total-pages">>, first_value([<<"total_pages">>, <<"total-pages">>], Result, Opts)},
            {<<"page">>, first_value([<<"page">>], Result, Opts)},
            {<<"page-size">>, first_value([<<"page_size">>, <<"page-size">>], Result, Opts)}
        ],
        {ok, lists:foldl(fun put_optional/2, Msg0, Optional)}
    end.

normalize_by_id(Result, Raw, Opts) when is_map(Result) ->
    case first_value([<<"comment_id">>, <<"comment-id">>, <<"id">>], Result, Opts) of
        not_found ->
            maybe
                {ok, Comment} ?= normalize_comment(by_id_item(Result, Opts), Opts),
                {ok, Ancestors} ?= normalize_comments(
                    first_value([<<"ancestors">>], Result, Opts),
                    Opts
                ),
                Msg0 = #{
                    <<"device">> => ?DEVICE,
                    <<"content-type">> => <<"application/json">>,
                    <<"body">> => Raw,
                    <<"comment">> => Comment,
                    <<"comment-id">> => hb_maps:get(<<"comment-id">>, Comment, not_found, Opts),
                    <<"ancestors">> => Ancestors
                },
                {ok, copy_comment_refs(Comment, Msg0, Opts)}
            end;
        _CommentID ->
            normalize_single_comment(Result, Raw, Opts)
    end;
normalize_by_id(Comment, Raw, Opts) ->
    normalize_single_comment(Comment, Raw, Opts).

normalize_single_comment(Comment, Raw, Opts) ->
    maybe
        {ok, Norm} ?= normalize_comment(Comment, Opts),
        Msg0 = #{
            <<"device">> => ?DEVICE,
            <<"content-type">> => <<"application/json">>,
            <<"body">> => Raw,
            <<"comment">> => Norm,
            <<"comment-id">> => hb_maps:get(<<"comment-id">>, Norm, not_found, Opts)
        },
        {ok, copy_comment_refs(Norm, Msg0, Opts)}
    end.

list_items(Result, Opts) ->
    case first_value([<<"items">>, <<"comments">>], Result, Opts) of
        not_found -> [];
        Items -> Items
    end.

by_id_item(Result, Opts) ->
    case first_value([<<"item">>, <<"comment">>, <<"items">>], Result, Opts) of
        [Item | _] -> Item;
        Item -> Item
    end.

normalize_comments(not_found, _Opts) ->
    {ok, []};
normalize_comments(Comments, Opts) when is_list(Comments) ->
    normalize_comments(Comments, Opts, []);
normalize_comments(Comment, Opts) when is_map(Comment) ->
    maybe
        {ok, Norm} ?= normalize_comment(Comment, Opts),
        {ok, [Norm]}
    end;
normalize_comments(_Comments, _Opts) ->
    {error, invalid_comments}.

normalize_comments([], _Opts, Acc) ->
    {ok, lists:reverse(Acc)};
normalize_comments([Comment | Rest], Opts, Acc) ->
    maybe
        {ok, Norm} ?= normalize_comment(Comment, Opts),
        normalize_comments(Rest, Opts, [Norm | Acc])
    end.

normalize_comment(Comment, Opts) when is_map(Comment) ->
    maybe
        {ok, CommentID} ?= required_first([<<"comment_id">>, <<"comment-id">>, <<"id">>], Comment, Opts),
        Text = first_value([<<"comment">>, <<"body">>, <<"text">>], Comment, Opts),
        Msg0 = #{
            <<"device">> => ?DEVICE,
            <<"source">> => Comment,
            <<"comment-id">> => CommentID,
            <<"comment-store-path">> => <<"odysee/comment/", CommentID/binary>>
        },
        Optional = [
            {<<"comment">>, Text},
            {<<"claim-id">>, first_value([<<"claim_id">>, <<"claim-id">>], Comment, Opts)},
            {<<"parent-id">>, first_value([<<"parent_id">>, <<"parent-id">>], Comment, Opts)},
            {<<"channel-id">>, first_value([<<"channel_id">>, <<"channel-id">>], Comment, Opts)},
            {<<"channel-name">>, first_value([<<"channel_name">>, <<"channel-name">>], Comment, Opts)},
            {<<"channel-url">>, first_value([<<"channel_url">>, <<"channel-url">>], Comment, Opts)},
            {<<"public-key">>,
                first_value(
                    [<<"public_key">>, <<"public-key">>, <<"channel_public_key">>, <<"channel-public-key">>],
                    Comment,
                    Opts
                )},
            {<<"timestamp">>, first_value([<<"timestamp">>, <<"created_at">>, <<"created-at">>], Comment, Opts)},
            {<<"updated-at">>, first_value([<<"updated_at">>, <<"updated-at">>], Comment, Opts)},
            {<<"signature">>, first_value([<<"signature">>], Comment, Opts)},
            {<<"signing-ts">>, first_value([<<"signing_ts">>, <<"signing-ts">>], Comment, Opts)},
            {<<"is-pinned">>, first_value([<<"is_pinned">>, <<"is-pinned">>], Comment, Opts)},
            {<<"replies">>, first_value([<<"replies">>], Comment, Opts)},
            {<<"support-amount">>, first_value([<<"support_amount">>, <<"support-amount">>], Comment, Opts)},
            {<<"support-tx-id">>, first_value([<<"support_tx_id">>, <<"support-tx-id">>], Comment, Opts)},
            {<<"sticker">>, first_value([<<"sticker">>], Comment, Opts)},
            {<<"mentioned-channels">>,
                first_value([<<"mentioned_channels">>, <<"mentioned-channels">>], Comment, Opts)},
            {<<"removed">>, first_value([<<"removed">>, <<"abandoned">>], Comment, Opts)},
            {<<"hidden">>, first_value([<<"hidden">>, <<"is_hidden">>, <<"is-hidden">>], Comment, Opts)},
            {<<"blocked">>, first_value([<<"blocked">>, <<"is_blocked">>, <<"is-blocked">>], Comment, Opts)},
            {<<"moderation">>, moderation_fields(Comment, Opts)}
        ],
        with_signature_context(
            add_comment_store_refs(lists:foldl(fun put_optional/2, Msg0, Optional), Opts),
            Text,
            Opts
        )
    end;
normalize_comment(_Comment, _Opts) ->
    {error, invalid_comment}.

copy_comment_refs(Comment, Msg, Opts) ->
    lists:foldl(
        fun(Key, Acc) ->
            put_optional({Key, hb_maps:get(Key, Comment, not_found, Opts)}, Acc)
        end,
        Msg,
        [
            <<"claim-id">>,
            <<"channel-id">>,
            <<"channel-name">>,
            <<"comment-store-path">>,
            <<"claim-store-path">>,
            <<"channel-store-path">>
        ]
    ).

add_comment_store_refs(Msg, Opts) ->
    Msg1 =
        put_optional(
            {<<"claim-store-path">>, store_path(<<"claim-id">>, <<"odysee/claim-id/">>, Msg, Opts)},
            Msg
        ),
    put_optional(
        {<<"channel-store-path">>, store_path(<<"channel-id">>, <<"odysee/channel/">>, Msg1, Opts)},
        Msg1
    ).

store_path(Key, Prefix, Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        ID when is_binary(ID) -> <<Prefix/binary, ID/binary>>;
        _ -> not_found
    end.

with_signature_context(Msg, not_found, _Opts) ->
    {ok, Msg};
with_signature_context(Msg, Text, Opts) ->
    case hb_maps:get(<<"signature">>, Msg, not_found, Opts) of
        not_found ->
            {ok, Msg};
        _Signature ->
            SignedMsg = Msg#{
                <<"signed-field">> => <<"comment">>,
                <<"signed-message">> => Text
            },
            {ok, SignedMsg#{
                <<"signature-verification">> => signature_verification_status(SignedMsg, Text, Opts)
            }}
    end.

signature_verification_status(Msg, Text, Opts) ->
    case comment_signature_verification(Msg, Text, Opts) of
        {ok, true} -> <<"valid">>;
        {ok, false} -> <<"invalid">>;
        {error, public_key_not_found} -> <<"not-verified">>;
        {error, {missing, _Key}} -> <<"not-verified">>;
        {error, _Reason} -> <<"invalid">>
    end.

comment_signature_verification(Msg, Text, Opts) ->
    maybe
        {ok, ChannelID} ?= required_first([<<"channel-id">>], Msg, Opts),
        {ok, Signature} ?= required_first([<<"signature">>], Msg, Opts),
        {ok, SigningTS} ?= required_first([<<"signing-ts">>], Msg, Opts),
        {ok, PublicKey} ?= public_key_from_message(Msg, Opts),
        verify_comment_signature(ChannelID, Text, Signature, SigningTS, PublicKey)
    end.

moderation_fields(Comment, Opts) ->
    Fields = [
        {<<"mod-channel-id">>, first_value([<<"mod_channel_id">>, <<"mod-channel-id">>], Comment, Opts)},
        {<<"mod-channel-name">>, first_value([<<"mod_channel_name">>, <<"mod-channel-name">>], Comment, Opts)},
        {<<"creator-channel-id">>,
            first_value([<<"creator_channel_id">>, <<"creator-channel-id">>], Comment, Opts)},
        {<<"creator-channel-name">>,
            first_value([<<"creator_channel_name">>, <<"creator-channel-name">>], Comment, Opts)},
        {<<"blocked-channel-id">>,
            first_value([<<"blocked_channel_id">>, <<"blocked-channel-id">>], Comment, Opts)},
        {<<"blocked-by-channel-id">>,
            first_value([<<"blocked_by_channel_id">>, <<"blocked-by-channel-id">>], Comment, Opts)}
    ],
    case lists:foldl(fun put_optional/2, #{}, Fields) of
        Empty when map_size(Empty) =:= 0 -> not_found;
        Moderation -> Moderation
    end.

list_params(Base, Req, Opts) ->
    Params0 =
        params_from(
            [
                {<<"page">>, [<<"page">>]},
                {<<"page_size">>, [<<"page-size">>, <<"page_size">>]},
                {<<"claim_id">>, [<<"claim-id">>, <<"claim_id">>]},
                {<<"author_claim_id">>, [<<"author-claim-id">>, <<"author_claim_id">>]},
                {<<"parent_id">>, [<<"parent-id">>, <<"parent_id">>]},
                {<<"top_level">>, [<<"top-level">>, <<"top_level">>]},
                {<<"channel_id">>, [<<"channel-id">>, <<"channel_id">>]},
                {<<"channel_name">>, [<<"channel-name">>, <<"channel_name">>]},
                {<<"sort_by">>, [<<"sort-by">>, <<"sort_by">>]},
                {<<"is_protected">>, [<<"is-protected">>, <<"is_protected">>]},
                {<<"requestor_channel_id">>,
                    [<<"requestor-channel-id">>, <<"requestor_channel_id">>, <<"requester-channel-id">>]},
                {<<"requestor_channel_name">>,
                    [<<"requestor-channel-name">>, <<"requestor_channel_name">>, <<"requester-channel-name">>]},
                {<<"signature">>, [<<"signature">>]},
                {<<"signing_ts">>, [<<"signing-ts">>, <<"signing_ts">>]},
                {<<"environment">>, [<<"environment">>]}
            ],
            Base,
            Req,
            Opts
        ),
    case maps:is_key(<<"claim_id">>, Params0) orelse maps:is_key(<<"author_claim_id">>, Params0) of
        true ->
            {ok, Params0};
        false ->
            maybe
                {ok, ClaimID} ?= claim_id(Base, Req, Opts),
                {ok, Params0#{ <<"claim_id">> => ClaimID }}
            end
    end.

proxy_params(Base, Req, Opts) ->
    BodyParams =
        case first_found([{Req, <<"body">>}, {Base, <<"body">>}], Opts) of
            Raw when is_binary(Raw) ->
                case try_decode_json(Raw) of
                    {ok, #{ <<"params">> := Params }} when is_map(Params) -> Params;
                    {ok, Params} when is_map(Params) -> Params;
                    _ -> #{}
                end;
            Params when is_map(Params) -> Params;
            _ -> #{}
        end,
    {ok, strip_proxy_params(maps:merge(clean_proxy_map(Base), maps:merge(clean_proxy_map(Req), BodyParams)))}.

clean_proxy_map(Msg) when is_map(Msg) ->
    maps:filter(
        fun(Key, _Value) ->
            not lists:member(Key, proxy_control_keys())
        end,
        Msg
    );
clean_proxy_map(_Msg) ->
    #{}.

strip_proxy_params(Params) ->
    maps:without(proxy_control_keys(), Params).

proxy_control_keys() ->
    [
        <<"accept">>,
        <<"accept-bundle">>,
        <<"accept-encoding">>,
        <<"accept-language">>,
        <<"authorization">>,
        <<"body">>,
        <<"commitments">>,
        <<"connection">>,
        <<"content-length">>,
        <<"content-type">>,
        <<"cookie">>,
        <<"device">>,
        <<"host">>,
        <<"method">>,
        <<"origin">>,
        <<"path">>,
        <<"priv">>,
        <<"referer">>,
        <<"sec-ch-ua">>,
        <<"sec-ch-ua-mobile">>,
        <<"sec-ch-ua-platform">>,
        <<"sec-fetch-dest">>,
        <<"sec-fetch-mode">>,
        <<"sec-fetch-site">>,
        <<"sec-gpc">>,
        <<"signature-input">>,
        <<"user-agent">>,
        <<"x-odysee-auth-token">>,
        <<"x-lbry-auth-token">>,
        <<"odysee-auth-token">>,
        <<"auth_token">>,
        <<"auth-token">>,
        <<"access_token">>,
        <<"access-token">>,
        <<"refresh_token">>,
        <<"refresh-token">>
    ].

params_from(Mappings, Base, Req, Opts) ->
    lists:foldl(
        fun({OutKey, Keys}, Params) ->
            case first_param(Keys, Base, Req, Opts) of
                not_found -> Params;
                Value -> Params#{ OutKey => Value }
            end
        end,
        #{},
        Mappings
    ).

first_param([], _Base, _Req, _Opts) ->
    not_found;
first_param([Key | Rest], Base, Req, Opts) ->
    case first_found([{Req, Key}, {Base, Key}], Opts) of
        not_found -> first_param(Rest, Base, Req, Opts);
        Value -> Value
    end.

claim_id(Base, Req, Opts) ->
    case first_param([<<"claim-id">>, <<"claim_id">>], Base, Req, Opts) of
        not_found -> claim_id_from_claim_or_uri(Base, Req, Opts);
        ClaimID -> {ok, ClaimID}
    end.

claim_id_from_claim_or_uri(Base, Req, Opts) ->
    case first_claim(Base, Req, Opts) of
        Claim when is_map(Claim) ->
            required_first([<<"claim_id">>, <<"claim-id">>], Claim, Opts);
        not_found ->
            case first_param([<<"uri">>, <<"url">>], Base, Req, Opts) of
                not_found -> {error, claim_id_not_found};
                _URI ->
                    maybe
                        {ok, ClaimMsg} ?= hb_ao:raw(<<"odysee-claim@1.0">>, <<"resolve">>, Base, Req, Opts),
                        required_first([<<"claim-id">>, <<"claim_id">>], ClaimMsg, Opts)
                    end
            end
    end.

first_claim(Base, Req, Opts) ->
    case first_found([{Req, <<"claim">>}, {Base, <<"claim">>}], Opts) of
        not_found -> not_found;
        ClaimMsg when is_map(ClaimMsg) -> hb_maps:get(<<"claim">>, ClaimMsg, ClaimMsg, Opts);
        _ -> not_found
    end.

comment_id(Base, Req, Opts) ->
    case first_param([<<"comment-id">>, <<"comment_id">>, <<"id">>], Base, Req, Opts) of
        not_found -> {error, comment_id_not_found};
        CommentID -> {ok, CommentID}
    end.

signature_data(Base, Req, Opts) ->
    case first_param([<<"data-hex">>, <<"data_hex">>], Base, Req, Opts) of
        not_found ->
            required_param([<<"data">>, <<"comment">>, <<"signed-message">>], Base, Req, Opts);
        DataHex ->
            decode_hex(DataHex)
    end.

public_key_for_signature(Base, Req, ChannelID, Opts) ->
    case public_key_from_message(Req, Opts) of
        {ok, PublicKey} ->
            {ok, PublicKey};
        {error, _} ->
            case public_key_from_message(Base, Opts) of
                {ok, PublicKey} -> {ok, PublicKey};
                {error, _} -> public_key_from_channel(Base, Req, ChannelID, Opts)
            end
    end.

public_key_from_message(Msg, Opts) when is_map(Msg) ->
    case first_value(public_key_keys(), Msg, Opts) of
        not_found ->
            case first_value([<<"value">>, <<"channel">>, <<"signing-channel">>, <<"signing_channel">>], Msg, Opts) of
                Nested when is_map(Nested) -> public_key_from_message(Nested, Opts);
                _ -> {error, public_key_not_found}
            end;
        PublicKey ->
            {ok, PublicKey}
    end;
public_key_from_message(_Msg, _Opts) ->
    {error, public_key_not_found}.

public_key_keys() ->
    [<<"public-key">>, <<"public_key">>, <<"channel-public-key">>, <<"channel_public_key">>].

public_key_from_channel(Base, Req, ChannelID, Opts) ->
    case channel_public_key_from_url(Base, Req, Opts) of
        {ok, PublicKey} -> {ok, PublicKey};
        {error, _} -> channel_public_key_from_parts(Base, Req, ChannelID, Opts)
    end.

channel_public_key_from_url(Base, Req, Opts) ->
    case first_param([<<"channel-url">>, <<"channel_url">>, <<"channel-uri">>, <<"channel_uri">>], Base, Req, Opts) of
        not_found ->
            {error, public_key_not_found};
        ChannelURI ->
            case hb_ao:raw(<<"odysee-channel@1.0">>, <<"channel">>, #{}, #{ <<"uri">> => ChannelURI }, Opts) of
                {ok, ChannelMsg} -> public_key_from_message(ChannelMsg, Opts);
                Error -> Error
            end
    end.

channel_public_key_from_parts(Base, Req, ChannelID, Opts) ->
    case first_param([<<"channel-name">>, <<"channel_name">>], Base, Req, Opts) of
        not_found ->
            {error, public_key_not_found};
        ChannelName ->
            ChannelReq = #{
                <<"claim-name">> => ChannelName,
                <<"claim-id">> => ChannelID
            },
            case hb_ao:raw(<<"odysee-channel@1.0">>, <<"channel">>, #{}, ChannelReq, Opts) of
                {ok, ChannelMsg} -> public_key_from_message(ChannelMsg, Opts);
                Error -> Error
            end
    end.

verify_comment_signature(ChannelID, Data, Signature, SigningTS, PublicKey) ->
    maybe
        {ok, ChannelIDBytes} ?= decode_hex(ChannelID),
        {ok, SignatureDER} ?= signature_der(Signature),
        {ok, PublicKeyPoint} ?= public_key_point(PublicKey),
        SignatureData = <<
            (hb_util:bin(SigningTS))/binary,
            (reverse_binary(ChannelIDBytes))/binary,
            (hb_util:bin(Data))/binary
        >>,
        verify_ecdsa(SignatureData, SignatureDER, PublicKeyPoint)
    end.

verify_ecdsa(SignatureData, SignatureDER, PublicKeyPoint) ->
    try {ok, crypto:verify(ecdsa, sha256, SignatureData, SignatureDER, [PublicKeyPoint, secp256k1])}
    catch
        _:_ -> {ok, false}
    end.

signature_der(Signature) ->
    maybe
        {ok, SignatureBytes} ?= decode_hex(Signature),
        case SignatureBytes of
            <<R:32/binary, S:32/binary>> ->
                DER = public_key:der_encode(
                    'ECDSA-Sig-Value',
                    {'ECDSA-Sig-Value', binary:decode_unsigned(R), binary:decode_unsigned(S)}
                ),
                {ok, DER};
            _ ->
                {error, invalid_signature}
        end
    end.

public_key_point(PublicKey) ->
    maybe
        {ok, PublicKeyBytes} ?= public_key_bytes(PublicKey),
        case byte_size(PublicKeyBytes) of
            Size when Size =:= 33 orelse Size =:= 65 ->
                {ok, PublicKeyBytes};
            _ ->
                der_public_key_point(PublicKeyBytes)
        end
    end.

public_key_bytes(PublicKey) when is_binary(PublicKey) ->
    case decode_hex(PublicKey) of
        {ok, Bytes} -> {ok, Bytes};
        {error, _} -> {ok, PublicKey}
    end;
public_key_bytes(PublicKey) ->
    public_key_bytes(hb_util:bin(PublicKey)).

der_public_key_point(PublicKeyBytes) ->
    try public_key:der_decode('SubjectPublicKeyInfo', PublicKeyBytes) of
        {'SubjectPublicKeyInfo', _Algorithm, Point} -> {ok, Point};
        _ -> {error, invalid_public_key}
    catch
        _:_ -> {error, invalid_public_key}
    end.

decode_hex(Hex) ->
    try {ok, binary:decode_hex(hb_util:bin(Hex))}
    catch
        _:_ -> {error, invalid_hex}
    end.

reverse_binary(Bin) ->
    list_to_binary(lists:reverse(binary_to_list(Bin))).

signature_response(IsValid) ->
    #{
        <<"device">> => ?DEVICE,
        <<"content-type">> => <<"application/json">>,
        <<"is-valid">> => IsValid
    }.

api_request(Method, Params, Base, Req, Opts) ->
    LegacyParams = legacy_api_params(Params, Base, Req, Opts),
    Payload = hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"method">> => Method,
        <<"params">> => LegacyParams,
        <<"id">> => 1
    }),
    Msg = #{
        <<"method">> => <<"POST">>,
        <<"path">> => comment_url(Method, Base, Req, Opts),
        <<"content-type">> => <<"application/json">>,
        <<"body">> => Payload
    },
    AuthedMsg = maps:merge(Msg, legacy_api_headers(Base, Req, Opts)),
    case hb_http:request(AuthedMsg, Opts) of
        {ok, #{ <<"body">> := Body }} when is_binary(Body) -> decode_api_body(Body, Opts);
        {ok, Body} when is_binary(Body) -> decode_api_body(Body, Opts);
        {ok, Other} -> {error, {comment_response_without_body, Other}};
        Error -> Error
    end.

decode_api_body(Body, Opts) ->
    maybe
        {ok, Decoded} ?= try_decode_json(Body),
        case hb_maps:get(<<"error">>, Decoded, not_found, Opts) of
            not_found -> {ok, hb_maps:get(<<"result">>, Decoded, Decoded, Opts), Body};
            Error -> {error, {comment_api_error, Error, Body}}
        end
    end.

comment_url(Method, Base, Req, Opts) ->
    URL =
        case first_found(
            [
                {Req, <<"comment-url">>},
                {Req, <<"comment_url">>},
                {Base, <<"comment-url">>},
                {Base, <<"comment_url">>}
            ],
            Opts
        ) of
            not_found -> hb_opts:get(<<"odysee-comment-url">>, ?DEFAULT_COMMENT_URL, Opts);
            Found -> Found
        end,
    Separator =
        case binary:match(URL, <<"?">>) of
            nomatch -> <<"?">>;
            _ -> <<"&">>
        end,
    <<URL/binary, Separator/binary, "m=", Method/binary>>.

required_first(Keys, Map, Opts) ->
    case first_value(Keys, Map, Opts) of
        not_found -> {error, {missing, hd(Keys)}};
        Value -> {ok, Value}
    end.

required_param(Keys, Base, Req, Opts) ->
    case first_param(Keys, Base, Req, Opts) of
        not_found -> {error, {missing, hd(Keys)}};
        Value -> {ok, Value}
    end.

first_value([], _Map, _Opts) ->
    not_found;
first_value([Key | Rest], Map, Opts) when is_map(Map) ->
    case hb_maps:get(Key, Map, not_found, Opts) of
        not_found -> first_value(Rest, Map, Opts);
        Value -> Value
    end;
first_value(_Keys, _Map, _Opts) ->
    not_found.

first_found([], _Opts) ->
    not_found;
first_found([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_found(Rest, Opts);
        Value -> Value
    end;
first_found([_ | Rest], Opts) ->
    first_found(Rest, Opts).

has_any([], _Map, _Opts) ->
    false;
has_any([Key | Rest], Map, Opts) ->
    case hb_maps:get(Key, Map, not_found, Opts) of
        not_found -> has_any(Rest, Map, Opts);
        _ -> true
    end.

put_optional({_Key, not_found}, Msg) -> Msg;
put_optional({Key, Value}, Msg) -> Msg#{ Key => Value }.

legacy_api_headers(Base, Req, Opts) ->
    case find_auth_token(Req, Opts) of
        {ok, Token} ->
            #{ <<"cookie">> => <<"auth_token=", Token/binary>> };
        {error, not_found} ->
            case find_auth_token(Base, Opts) of
                {ok, Token} -> #{ <<"cookie">> => <<"auth_token=", Token/binary>> };
                {error, not_found} -> #{}
            end
    end.

legacy_api_params(Params, Base, Req, Opts) ->
    case find_auth_token(Req, Opts) of
        {ok, Token} ->
            Params#{ <<"auth_token">> => Token };
        {error, not_found} ->
            case find_auth_token(Base, Opts) of
                {ok, Token} -> Params#{ <<"auth_token">> => Token };
                {error, not_found} -> Params
            end
    end.

find_auth_token(Msg, Opts) ->
    case first_found(
        [{Msg, Key} || Key <- [<<"x-odysee-auth-token">>, <<"x-lbry-auth-token">>, <<"odysee-auth-token">>, <<"auth_token">>]],
        Opts
    ) of
        not_found -> find_auth_cookie(Msg, Opts);
        Token -> {ok, token_value(Token)}
    end.

find_auth_cookie(Msg, Opts) when is_map(Msg) ->
    case hb_maps:find(<<"cookie">>, Msg, Opts) of
        {ok, Cookie} -> token_from_cookie(hb_util:bin(Cookie));
        error -> {error, not_found}
    end;
find_auth_cookie(_Msg, _Opts) ->
    {error, not_found}.

token_from_cookie(Cookie) ->
    token_from_cookie_parts(binary:split(Cookie, <<";">>, [global])).

token_from_cookie_parts([]) ->
    {error, not_found};
token_from_cookie_parts([Part | Rest]) ->
    case binary:split(Part, <<"=">>) of
        [Name, Value] ->
            case trim_bin(Name) of
                <<"auth_token">> -> {ok, trim_bin(Value)};
                _ -> token_from_cookie_parts(Rest)
            end;
        _ ->
            token_from_cookie_parts(Rest)
    end.

token_value(#{ <<"value">> := Value }) ->
    hb_util:bin(Value);
token_value(Value) ->
    hb_util:bin(Value).

trim_bin(Bin) ->
    list_to_binary(string:trim(binary_to_list(Bin))).

try_decode_json(Raw) ->
    try {ok, hb_json:decode(Raw)}
    catch _:_ -> {error, invalid_json}
    end.

-ifdef(TEST).

list_result_normalizes_comments_test() ->
    Result = #{
        <<"items">> => [comment(), reply_comment()],
        <<"total_items">> => 2,
        <<"total_filtered_items">> => 2,
        <<"total_pages">> => 1
    },
    {ok, Msg} = list(#{}, #{ <<"result">> => Result }, #{}),
    Comments = hb_maps:get(<<"comments">>, Msg, #{}),
    ?assertEqual([<<"c1">>, <<"c2">>], hb_maps:get(<<"comment-ids">>, Msg, #{})),
    ?assertEqual(2, hb_maps:get(<<"total-items">>, Msg, #{})),
    ?assertEqual(<<"Science.">>, hb_maps:get(<<"comment">>, hd(Comments), #{})),
    ?assertEqual(<<"not-verified">>, hb_maps:get(<<"signature-verification">>, hd(Comments), #{})).

list_result_accepts_raw_json_test() ->
    Raw = hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"result">> => #{ <<"items">> => [comment()], <<"total_items">> => 1 },
        <<"id">> => 1
    }),
    {ok, Msg} = list(#{}, #{ <<"body">> => Raw }, #{}),
    ?assertEqual(Raw, hb_maps:get(<<"body">>, Msg, #{})),
    ?assertEqual([<<"c1">>], hb_maps:get(<<"comment-ids">>, Msg, #{})).

by_id_normalizes_item_and_ancestors_test() ->
    Result = #{ <<"item">> => reply_comment(), <<"ancestors">> => [comment()] },
    {ok, Msg} = by_id(#{}, #{ <<"result">> => Result }, #{}),
    ?assertEqual(<<"c2">>, hb_maps:get(<<"comment-id">>, Msg, #{})),
    ?assertEqual(<<"c1">>, hb_maps:get(<<"parent-id">>, hb_maps:get(<<"comment">>, Msg, #{}), #{})),
    ?assertEqual(1, length(hb_maps:get(<<"ancestors">>, Msg, #{}))).

by_id_accepts_raw_comment_result_test() ->
    {ok, Msg} = by_id(#{}, #{ <<"result">> => comment() }, #{}),
    ?assertEqual(<<"c1">>, hb_maps:get(<<"comment-id">>, Msg, #{})).

normalize_single_comment_test() ->
    {ok, Msg} = normalize(#{}, #{ <<"comment">> => comment() }, #{}),
    Norm = hb_maps:get(<<"comment">>, Msg, #{}),
    ?assertEqual(<<"c1">>, hb_maps:get(<<"comment-id">>, Norm, #{})),
    ?assertEqual(<<"comment">>, hb_maps:get(<<"signed-field">>, Norm, #{})).

verify_signature_accepts_commentron_vector_test() ->
    Vector = commentron_vector(),
    {ok, Msg} = verify_signature(#{}, Vector#{
        <<"data-hex">> => <<"6e69636565">>
    }, #{}),
    ?assertEqual(true, hb_maps:get(<<"is-valid">>, Msg, #{})).

verify_signature_rejects_tampered_data_test() ->
    Vector = commentron_vector(),
    {ok, Msg} = verify_signature(#{}, Vector#{
        <<"data">> => <<"tampered">>
    }, #{}),
    ?assertEqual(false, hb_maps:get(<<"is-valid">>, Msg, #{})).

normalize_verifies_comment_with_public_key_test() ->
    Vector = commentron_vector(),
    Comment = Vector#{
        <<"comment_id">> => <<"vector-1">>,
        <<"comment">> => <<"nicee">>
    },
    {ok, Msg} = normalize(#{}, #{ <<"comment">> => Comment }, #{}),
    Norm = hb_maps:get(<<"comment">>, Msg, #{}),
    ?assertEqual(<<"valid">>, hb_maps:get(<<"signature-verification">>, Norm, #{})).

list_requires_claim_or_author_for_fetch_test() ->
    ?assertEqual({error, claim_id_not_found}, list(#{}, #{}, #{})).

list_params_do_not_expose_auth_token_test() ->
    {ok, Params} = list_params(
        #{},
        #{
            <<"claim-id">> => <<"claim-1">>,
            <<"x-odysee-auth-token">> => <<"token-1">>,
            <<"auth_token">> => <<"token-2">>,
            <<"cookie">> => <<"auth_token=token-3">>
        },
        #{}
    ),
    ?assertEqual(#{ <<"claim_id">> => <<"claim-1">> }, Params).

legacy_api_headers_forwards_odysee_auth_token_test() ->
    ?assertEqual(
        #{ <<"cookie">> => <<"auth_token=token-1">> },
        legacy_api_headers(#{}, #{ <<"x-odysee-auth-token">> => <<"token-1">> }, #{})
    ).

legacy_api_headers_extracts_auth_cookie_test() ->
    ?assertEqual(
        #{ <<"cookie">> => <<"auth_token=token-2">> },
        legacy_api_headers(#{}, #{ <<"cookie">> => <<"other=1; auth_token=token-2; x=3">> }, #{})
    ).

legacy_api_params_forwards_odysee_auth_token_test() ->
    ?assertEqual(
        #{ <<"claim_id">> => <<"claim-1">>, <<"auth_token">> => <<"token-1">> },
        legacy_api_params(
            #{ <<"claim_id">> => <<"claim-1">> },
            #{},
            #{ <<"x-odysee-auth-token">> => <<"token-1">> },
            #{}
        )
    ).

proxy_params_strips_transport_metadata_test() ->
    {ok, Params} = proxy_params(
        #{},
        #{
            <<"auth_token">> => <<"secret">>,
            <<"accept-bundle">> => <<"bundle">>,
            <<"connection">> => <<"keep-alive">>,
            <<"channel_id">> => <<"channel-1">>,
            <<"claim_id">> => <<"claim-1">>,
            <<"comment">> => <<"hello">>
        },
        #{}
    ),
    ?assertEqual(false, maps:is_key(<<"auth_token">>, Params)),
    ?assertEqual(false, maps:is_key(<<"accept-bundle">>, Params)),
    ?assertEqual(false, maps:is_key(<<"connection">>, Params)),
    ?assertEqual(<<"channel-1">>, maps:get(<<"channel_id">>, Params)),
    ?assertEqual(<<"claim-1">>, maps:get(<<"claim_id">>, Params)),
    ?assertEqual(<<"hello">>, maps:get(<<"comment">>, Params)).

commentron_vector() ->
    #{
        <<"channel-id">> => <<"7fadfe1d0dce928350137a13497b6fc36627cf45">>,
        <<"channel_id">> => <<"7fadfe1d0dce928350137a13497b6fc36627cf45">>,
        <<"public-key">> =>
            <<"3056301006072a8648ce3d020106052b8104000a03420004e0743cfa62857d1d7bda9ca6ba0ec3325902866e6442f51a9da2b143bc0ba40cda532e483e1a8a48c84b4b9dc16a117b2f9763d518db50d8fed2b818937ef8b1">>,
        <<"signature">> =>
            <<"fe35046bd949fc89037d64ac3558fea859022a166558b459b6883acafa15ca9ec567ca23e7b4ae19e4dbc3f92aac30a132315db7abcb03c15c61662fb9f49458">>,
        <<"signing-ts">> => <<"1582846386">>,
        <<"signing_ts">> => <<"1582846386">>,
        <<"data">> => <<"nicee">>
    }.

comment() ->
    #{
        <<"comment_id">> => <<"c1">>,
        <<"claim_id">> => <<"claim-1">>,
        <<"channel_id">> => <<"channel-1">>,
        <<"channel_name">> => <<"@veritasium">>,
        <<"channel_url">> => <<"lbry://@veritasium#f">>,
        <<"comment">> => <<"Science.">>,
        <<"timestamp">> => 1710000000,
        <<"signature">> => <<"signature-bytes">>,
        <<"signing_ts">> => <<"1710000000">>,
        <<"replies">> => 1,
        <<"is_pinned">> => false
    }.

reply_comment() ->
    (comment())#{
        <<"comment_id">> => <<"c2">>,
        <<"parent_id">> => <<"c1">>,
        <<"comment">> => <<"Reply.">>,
        <<"signature">> => <<"reply-signature">>
    }.

native_test_opts() ->
    % Match-capable store: native comment discovery goes through the query
    % device's reverse-index match, which lmdb supports.
    Store = hb_test_utils:test_store(hb_store_lmdb),
    ok = hb_store:start(Store),
    ok = hb_store:reset(Store),
    #{
        <<"store">> => Store,
        <<"cache-control">> => [<<"no-cache">>, <<"no-store">>],
        <<"store-all-signed">> => false,
        % Native comments are committed with the node wallet before caching.
        <<"priv-wallet">> => ar_wallet:new()
    }.

%% Commentron endpoint that fails fast, so list tests exercise the
%% native-only merge branch instead of the network.
-define(DEAD_COMMENTRON, <<"http://127.0.0.1:1/api/v2">>).

native_create_requires_auth_test() ->
    Opts = native_test_opts(),
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        create(#{}, #{ <<"target">> => <<"native-target">>, <<"comment">> => <<"hi">> }, Opts)
    ).

native_create_list_and_by_id_roundtrip_test() ->
    Opts = native_test_opts(),
    Target = <<"07be6a81bc3ac539284f030b2a353b64ed277ed0ea1916456293217b74460b87:0">>,
    ClaimID = <<"50d246f7044d7ab368f300ef1d07955c0d71ceeb">>,
    {ok, Created} =
        create(
            #{},
            #{
                <<"x-odysee-auth-token">> => <<"test-token">>,
                <<"target">> => Target,
                <<"claim_id">> => ClaimID,
                <<"comment">> => <<"hello native">>,
                <<"channel_id">> => <<"fb364ef587872515f545a5b4b3182b58073f230f">>,
                <<"channel_name">> => <<"@veritasium">>
            },
            Opts
        ),
    ?assertEqual(true, hb_maps:get(<<"native">>, Created, Opts)),
    Comment = hb_maps:get(<<"result">>, Created, Opts),
    CommentID = hb_maps:get(<<"comment_id">>, Comment, Opts),
    ?assertEqual(<<"hello native">>, hb_maps:get(<<"comment">>, Comment, Opts)),
    ?assertEqual(Target, hb_maps:get(<<"target">>, Comment, Opts)),

    % Comments surface when listing by the uniform target...
    {ok, ByTarget} =
        list(#{}, #{ <<"target">> => Target, <<"comment-url">> => ?DEAD_COMMENTRON }, Opts),
    ?assertEqual([CommentID], hb_maps:get(<<"comment-ids">>, ByTarget, Opts)),
    % ...and in the raw `body' payload, which is what the HTTP layer serves.
    BodyEnvelope = hb_json:decode(hb_maps:get(<<"body">>, ByTarget, Opts)),
    BodyItems = maps:get(<<"items">>, maps:get(<<"result">>, BodyEnvelope)),
    ?assertEqual(1, length(BodyItems)),
    ?assertEqual(<<"hello native">>, maps:get(<<"comment">>, hd(BodyItems))),
    % ...and when listing by the legacy claim id it was also anchored to.
    {ok, ByClaim} =
        list(#{}, #{ <<"claim-id">> => ClaimID, <<"comment-url">> => ?DEAD_COMMENTRON }, Opts),
    ?assertEqual([CommentID], hb_maps:get(<<"comment-ids">>, ByClaim, Opts)),

    % The comment id is a message id: by-id serves it locally.
    {ok, ByID} = by_id(#{}, #{ <<"comment_id">> => CommentID }, Opts),
    Norm = hb_maps:get(<<"comment">>, ByID, Opts),
    ?assertEqual(CommentID, hb_maps:get(<<"comment-id">>, Norm, Opts)),
    ?assertEqual(<<"hello native">>, hb_maps:get(<<"comment">>, Norm, Opts)),
    ?assertEqual(
        <<"@veritasium">>,
        hb_maps:get(<<"channel-name">>, Norm, Opts)
    ).

native_create_without_target_stays_on_proxy_path_test() ->
    Opts = native_test_opts(),
    % No target -> Commentron proxy; the dead endpoint proves no native
    % record is created and the legacy path was chosen.
    Result =
        create(
            #{},
            #{
                <<"x-odysee-auth-token">> => <<"test-token">>,
                <<"claim_id">> => <<"50d246f7044d7ab368f300ef1d07955c0d71ceeb">>,
                <<"comment">> => <<"legacy path">>,
                <<"comment-url">> => ?DEAD_COMMENTRON
            },
            Opts
        ),
    ?assertMatch({error, _}, Result).

native_list_honors_threading_filters_test() ->
    Opts = native_test_opts(),
    Target = <<"native-thread-target">>,
    Authed = #{ <<"x-odysee-auth-token">> => <<"test-token">> },
    {ok, ParentRes} =
        create(#{}, Authed#{ <<"target">> => Target, <<"comment">> => <<"parent">> }, Opts),
    ParentID = hb_maps:get(<<"comment-id">>, ParentRes, Opts),
    {ok, _ReplyRes} =
        create(
            #{},
            Authed#{
                <<"target">> => Target,
                <<"comment">> => <<"reply">>,
                <<"parent_id">> => ParentID
            },
            Opts
        ),
    {ok, TopLevel} =
        list(
            #{},
            #{
                <<"target">> => Target,
                <<"top-level">> => true,
                <<"comment-url">> => ?DEAD_COMMENTRON
            },
            Opts
        ),
    ?assertEqual([ParentID], hb_maps:get(<<"comment-ids">>, TopLevel, Opts)),
    {ok, Replies} =
        list(
            #{},
            #{
                <<"target">> => Target,
                <<"parent-id">> => ParentID,
                <<"comment-url">> => ?DEAD_COMMENTRON
            },
            Opts
        ),
    RepliesNorm = hb_maps:get(<<"comments">>, Replies, Opts),
    ?assertEqual(1, length(RepliesNorm)),
    ?assertEqual(<<"reply">>, hb_maps:get(<<"comment">>, hd(RepliesNorm), Opts)).

-endif.
