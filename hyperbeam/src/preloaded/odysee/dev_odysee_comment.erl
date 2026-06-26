%%% @doc Odysee Commentron compatibility device.
%%%
%%% This device exposes read-only Commentron rows as AO-Core messages. It keeps
%%% raw API responses beside normalized fields and preserves signature inputs
%%% for later verification against LBRY channel public keys.
-module(dev_odysee_comment).
-implements(<<"odysee-comment@1.0">>).
-export([info/1, list/3, by_id/3, normalize/3, verify_signature/3, verify_claim_signature/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-comment@1.0">>).
-define(DEFAULT_COMMENT_URL, <<"https://comments.odysee.com/api/v2">>).

%% @doc Return the public device API.
info(_Opts) ->
    #{
        exports => [
            <<"list">>,
            <<"by-id">>,
            <<"normalize">>,
            <<"verify-signature">>,
            <<"verify-claim-signature">>
        ]
    }.

%% @doc Return a normalized `comment.List' response.
list(Base, Req, Opts) ->
    safe(fun() ->
        maybe
            {ok, Result, Raw} ?= list_result(Base, Req, Opts),
            normalize_list(Result, Raw, Opts)
        else
            Error -> Error
        end
    end).

%% @doc Return a normalized `comment.ByID' response.
by_id(Base, Req, Opts) ->
    safe(fun() ->
        maybe
            {ok, Result, Raw} ?= by_id_result(Base, Req, Opts),
            normalize_by_id(Result, Raw, Opts)
        else
            Error -> Error
        end
    end).

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
                Local = local_comment_list(Params, Opts),
                case api_request(<<"comment.List">>, Params, Base, Req, Opts) of
                    {ok, Result, Raw} -> merge_local_comment_list(Local, Result, Raw, Opts);
                    Error ->
                        case Local of
                            {ok, _LocalResult, _LocalRaw} = LocalResult -> LocalResult;
                            not_found -> Error
                        end
                end
            end
    end.

by_id_result(Base, Req, Opts) ->
    case result_candidate(Base, Req, Opts) of
        {ok, _Result, _Raw} = Candidate ->
            Candidate;
        not_found ->
            maybe
                {ok, CommentID} ?= comment_id(Base, Req, Opts),
                case local_comment_by_id(CommentID, Opts) of
                    {ok, _LocalResult, _LocalRaw} = LocalResult ->
                        LocalResult;
                    not_found ->
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
            end
    end.

local_comment_list(Params, Opts) ->
    Store = hb_opts:get(store, [], Opts),
    case Store of
        [] ->
            not_found;
        _ ->
            IDs = local_comment_ids(Store, Params, Opts),
            case IDs of
                [] ->
                    not_found;
                _ ->
                    Comments = local_comments_from_ids(Store, IDs, Opts),
                    Filtered = sort_local_comments(
                        [Comment || Comment <- Comments, local_comment_matches(Params, Comment, Opts)],
                        Params,
                        Opts
                    ),
                    Page = integer_param(Params, <<"page">>, 1, Opts),
                    PageSize = integer_param(Params, <<"page_size">>, 50, Opts),
                    Total = length(Filtered),
                    Items = page_items(Filtered, Page, PageSize),
                    Result = #{
                        <<"items">> => Items,
                        <<"page">> => Page,
                        <<"page_size">> => PageSize,
                        <<"total_items">> => Total,
                        <<"total_filtered_items">> => Total,
                        <<"total_pages">> => total_pages(Total, PageSize),
                        <<"has_hidden_comments">> => false
                    },
                    {ok, Result, hb_json:encode(Result)}
            end
    end.

local_comment_by_id(CommentID, Opts) ->
    Store = hb_opts:get(store, [], Opts),
    case Store of
        [] ->
            not_found;
        _ ->
            case read_local_comment(Store, CommentID, Opts) of
                {ok, Comment} ->
                    Result = #{
                        <<"item">> => Comment,
                        <<"items">> => [Comment],
                        <<"ancestors">> => local_comment_ancestors(Store, Comment, Opts)
                    },
                    {ok, Result, hb_json:encode(Result)};
                not_found ->
                    not_found
            end
    end.

merge_local_comment_list(not_found, Result, Raw, _Opts) ->
    {ok, Result, Raw};
merge_local_comment_list({ok, LocalResult, _LocalRaw}, Result, _Raw, Opts) ->
    PublicItems = list_items(Result, Opts),
    PublicIDs = [local_comment_id(Comment, Opts) || Comment <- PublicItems],
    LocalItems = list_items(LocalResult, Opts),
    LocalOnly = [
        Comment
    ||
        Comment <- LocalItems,
        local_comment_id(Comment, Opts) =/= not_found,
        not lists:member(local_comment_id(Comment, Opts), PublicIDs)
    ],
    case LocalOnly of
        [] ->
            {ok, Result, hb_json:encode(Result)};
        _ ->
            Items = LocalOnly ++ PublicItems,
            Page = integer_value(first_value([<<"page">>], Result, Opts), 1),
            PageSize = integer_value(first_value([<<"page_size">>, <<"page-size">>], Result, Opts), length(Items)),
            PublicTotal = integer_value(first_value([<<"total_items">>, <<"total-items">>], Result, Opts), length(PublicItems)),
            PublicFiltered = integer_value(
                first_value([<<"total_filtered_items">>, <<"total-filtered-items">>], Result, Opts),
                PublicTotal
            ),
            Total = PublicTotal + length(LocalOnly),
            FilteredTotal = PublicFiltered + length(LocalOnly),
            Merged = Result#{
                <<"items">> => Items,
                <<"page">> => Page,
                <<"page_size">> => PageSize,
                <<"total_items">> => Total,
                <<"total_filtered_items">> => FilteredTotal,
                <<"total_pages">> => total_pages(Total, PageSize)
            },
            {ok, Merged, hb_json:encode(Merged)}
    end.

local_comment_ids(Store, Params, Opts) ->
    Paths = local_comment_index_paths(Params, Opts),
    dedupe_binaries(lists:flatmap(fun(Path) -> read_local_comment_index(Store, Path, Opts) end, Paths)).

local_comment_index_paths(Params, Opts) ->
    case normalized_field(first_value([<<"claim_id">>, <<"claim-id">>], Params, Opts)) of
        ClaimID when is_binary(ClaimID) ->
            [local_comment_list_index_path(<<"claim">>, ClaimID)];
        not_found ->
            case normalized_field(
                first_value([<<"author_claim_id">>, <<"author-claim-id">>, <<"channel_id">>, <<"channel-id">>], Params, Opts)
            ) of
                ChannelID when is_binary(ChannelID) ->
                    [local_comment_list_index_path(<<"channel">>, ChannelID)];
                not_found ->
                    [local_comment_list_index_path(<<"all">>, <<"all">>)]
            end
    end.

local_comments_from_ids(Store, IDs, Opts) ->
    lists:filtermap(
        fun(ID) ->
            case read_local_comment(Store, ID, Opts) of
                {ok, Comment} -> {true, Comment};
                not_found -> false
            end
        end,
        IDs
    ).

read_local_comment(Store, CommentID, Opts) ->
    case hb_store:read(Store, local_comment_record_path(CommentID), maps:without([<<"store">>, store], Opts)) of
        {ok, Raw} -> decode_local_comment(Raw);
        Raw when is_binary(Raw) -> decode_local_comment(Raw);
        _ -> not_found
    end.

decode_local_comment(Raw) when is_binary(Raw) ->
    try hb_json:decode(Raw) of
        Comment when is_map(Comment) -> {ok, Comment};
        _ -> not_found
    catch _:_ ->
        not_found
    end;
decode_local_comment(_Raw) ->
    not_found.

read_local_comment_index(Store, Path, Opts) ->
    case hb_store:read(Store, Path, maps:without([<<"store">>, store], Opts)) of
        {ok, Raw} -> decode_local_comment_index(Raw);
        Raw when is_binary(Raw) -> decode_local_comment_index(Raw);
        _ -> []
    end.

decode_local_comment_index(Raw) when is_binary(Raw) ->
    try hb_json:decode(Raw) of
        IDs when is_list(IDs) -> [ID || ID <- IDs, is_binary(ID), ID =/= <<>>];
        _ -> []
    catch _:_ ->
        []
    end;
decode_local_comment_index(_Raw) ->
    [].

local_comment_matches(Params, Comment, Opts) ->
    local_comment_matches_claim(Params, Comment, Opts)
        andalso local_comment_matches_author(Params, Comment, Opts)
        andalso local_comment_matches_parent(Params, Comment, Opts).

local_comment_matches_claim(Params, Comment, Opts) ->
    case normalized_field(first_value([<<"claim_id">>, <<"claim-id">>], Params, Opts)) of
        not_found -> true;
        ClaimID -> ClaimID =:= normalized_field(first_value([<<"claim_id">>, <<"claim-id">>], Comment, Opts))
    end.

local_comment_matches_author(Params, Comment, Opts) ->
    case normalized_field(first_value([<<"author_claim_id">>, <<"author-claim-id">>], Params, Opts)) of
        not_found -> true;
        ChannelID -> ChannelID =:= normalized_field(first_value([<<"channel_id">>, <<"channel-id">>], Comment, Opts))
    end.

local_comment_matches_parent(Params, Comment, Opts) ->
    case normalized_field(first_value([<<"parent_id">>, <<"parent-id">>], Params, Opts)) of
        not_found ->
            case truthy(first_value([<<"top_level">>, <<"top-level">>], Params, Opts)) of
                true -> not has_comment_parent(Comment, Opts);
                false -> true
            end;
        ParentID ->
            ParentID =:= normalized_field(first_value([<<"parent_id">>, <<"parent-id">>], Comment, Opts))
    end.

sort_local_comments(Comments, Params, Opts) ->
    SortBy = integer_param(Params, <<"sort_by">>, 0, Opts),
    case SortBy of
        1 -> lists:sort(fun(A, B) -> comment_sort_key(A, Opts) =< comment_sort_key(B, Opts) end, Comments);
        _ -> lists:sort(fun(A, B) -> comment_sort_key(A, Opts) >= comment_sort_key(B, Opts) end, Comments)
    end.

comment_sort_key(Comment, Opts) ->
    {
        integer_value(first_value([<<"timestamp">>, <<"created_at">>, <<"created-at">>], Comment, Opts), 0),
        hb_util:bin(value_or(first_value([<<"comment_id">>, <<"comment-id">>, <<"id">>], Comment, Opts), <<>>))
    }.

local_comment_ancestors(Store, Comment, Opts) ->
    local_comment_ancestors(Store, Comment, Opts, [], 0).

local_comment_ancestors(_Store, _Comment, _Opts, Acc, Depth) when Depth >= 20 ->
    lists:reverse(Acc);
local_comment_ancestors(Store, Comment, Opts, Acc, Depth) ->
    case normalized_field(first_value([<<"parent_id">>, <<"parent-id">>], Comment, Opts)) of
        not_found ->
            lists:reverse(Acc);
        ParentID ->
            case read_local_comment(Store, ParentID, Opts) of
                {ok, Parent} -> local_comment_ancestors(Store, Parent, Opts, [Parent | Acc], Depth + 1);
                not_found -> lists:reverse(Acc)
            end
    end.

has_comment_parent(Comment, Opts) ->
    normalized_field(first_value([<<"parent_id">>, <<"parent-id">>], Comment, Opts)) =/= not_found.

local_comment_id(Comment, Opts) ->
    normalized_field(first_value([<<"comment_id">>, <<"comment-id">>, <<"id">>], Comment, Opts)).

local_comment_record_path(CommentID) ->
    <<"odysee/comment/local/id/", (hb_util:encode(hb_crypto:sha256(CommentID)))/binary>>.

local_comment_list_index_path(Type, Value) ->
    <<"odysee/comment/local/list/", Type/binary, "/", (hb_util:encode(hb_crypto:sha256(Value)))/binary>>.

page_items(Items, Page, PageSize) ->
    Offset = max(0, (Page - 1) * PageSize),
    case Offset >= length(Items) of
        true -> [];
        false -> lists:sublist(lists:nthtail(Offset, Items), PageSize)
    end.

total_pages(Total, _PageSize) when Total =< 0 ->
    0;
total_pages(Total, PageSize) when PageSize =< 0 ->
    Total;
total_pages(Total, PageSize) ->
    (Total + PageSize - 1) div PageSize.

integer_param(Params, Key, Default, Opts) ->
    integer_value(hb_maps:get(Key, Params, Default, Opts), Default).

integer_value(Value, _Default) when is_integer(Value) ->
    Value;
integer_value(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value)
    catch _:_ -> Default
    end;
integer_value(_Value, Default) ->
    Default.

dedupe_binaries(Values) ->
    {Items, _Seen} =
        lists:foldl(
            fun(Value, {Acc, Seen}) ->
                case is_binary(Value) andalso Value =/= <<>> andalso not lists:member(Value, Seen) of
                    true -> {[Value | Acc], [Value | Seen]};
                    false -> {Acc, Seen}
                end
            end,
            {[], []},
            Values
        ),
    lists:reverse(Items).

normalized_field(not_found) -> not_found;
normalized_field(undefined) -> not_found;
normalized_field(null) -> not_found;
normalized_field(<<>>) -> not_found;
normalized_field(Value) -> hb_util:bin(Value).

truthy(true) -> true;
truthy(<<"true">>) -> true;
truthy(<<"1">>) -> true;
truthy(1) -> true;
truthy(_Value) -> false.

value_or(not_found, Default) -> Default;
value_or(undefined, Default) -> Default;
value_or(<<>>, Default) -> Default;
value_or(null, Default) -> Default;
value_or(Value, _Default) -> Value.

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
            <<"comment-ids">> => [hb_maps:get(<<"comment-id">>, Comment, Opts) || Comment <- Comments]
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
                    <<"comment-id">> => hb_maps:get(<<"comment-id">>, Comment, Opts),
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
            <<"comment-id">> => hb_maps:get(<<"comment-id">>, Norm, Opts)
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
        <<"is-valid">> => IsValid,
        <<"is_valid">> => IsValid
    }.

api_request(Method, Params, Base, Req, Opts) ->
    Payload = hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"method">> => Method,
        <<"params">> => Params,
        <<"id">> => 1
    }),
    Msg = #{
        <<"method">> => <<"POST">>,
        <<"path">> => comment_url(Method, Base, Req, Opts),
        <<"content-type">> => <<"application/json">>,
        <<"body">> => Payload
    },
    case hb_http:request(Msg, Opts) of
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
            Error -> {error, {comment_api_error, Error}}
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
    ?assertEqual(true, hb_maps:get(<<"is-valid">>, Msg, #{})),
    ?assertEqual(true, hb_maps:get(<<"is_valid">>, Msg, #{})).

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

-endif.
