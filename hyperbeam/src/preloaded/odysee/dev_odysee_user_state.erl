-module(dev_odysee_user_state).
-implements(<<"odysee-user-state@1.0">>).
-export([info/1, call/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-user-state@1.0">>).
-define(DEFAULT_COMMENT_URL, <<"https://comments.odysee.com/api/v2">>).
-define(DEFAULT_PROXY_URL, <<"https://api.na-backend.odysee.com/api/v1/proxy">>).

info(_Opts) ->
    #{ exports => [<<"call">>] }.

call(_Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    {ok, Owner} ?= authenticated_owner(Req, Opts),
                    AuthToken = auth_token(Req, Opts),
                    {ok, Payload} ?= request_payload(Req, Opts),
                    {ok, State0} ?= read_state(Owner, Opts),
                    {ok, Result, State1} ?= dispatch(Owner, AuthToken, Payload, State0, Opts),
                    ok ?= write_state(Owner, State1, Opts),
                    {ok, response(Result)}
                else
                    Error -> Error
                end
            end)
    end.

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> {error, Reason};
        _:Reason -> {error, Reason}
    end.

authenticated_owner(Req, Opts) ->
    case request_signers(Req, Opts) of
        [] ->
            {error, #{
                <<"status">> => 401,
                <<"body">> => <<"Signed request required.">>
            }};
        Signers ->
            case request_signature_valid(Req, Opts) of
                true -> {ok, owner_identity(Req, Opts, hd(Signers))};
                _ ->
                    {error, #{
                        <<"status">> => 401,
                        <<"body">> => <<"Invalid request signature.">>
                    }}
            end
    end.

owner_identity(Req, Opts, Fallback) ->
    case auth_token(Req, Opts) of
        {ok, Token} -> token_secret(Token);
        not_found -> auth_owner(Req, Opts, Fallback)
    end.

auth_owner(Req, Opts, Fallback) ->
    case first_field([<<"odysee-auth-owner">>, <<"odysee_auth_owner">>], Req, Opts) of
        not_found -> secret_owner(Req, Opts, Fallback);
        Owner -> hb_util:bin(Owner)
    end.

secret_owner(Req, Opts, Fallback) ->
    case first_field([<<"secret">>], Req, Opts) of
        not_found -> Fallback;
        Secret -> hb_util:bin(Secret)
    end.

auth_token(Req, Opts) ->
    case authorization_token(Req, Opts) of
        {ok, _Token} = Found -> Found;
        not_found -> token_field(Req, Opts)
    end.

authorization_token(Req, Opts) ->
    case first_field([<<"authorization">>], Req, Opts) of
        not_found -> not_found;
        Auth ->
            try authorization_value(hb_util:bin(Auth))
            catch _:_ -> not_found
            end
    end.

authorization_value(Auth) ->
    case binary:split(string:trim(Auth), <<" ">>) of
        [Scheme, Value0] ->
            Value = string:trim(Value0, leading),
            case hb_util:to_lower(Scheme) of
                <<"bearer">> when Value =/= <<>> -> {ok, Value};
                <<"token">> when Value =/= <<>> -> {ok, Value};
                _ -> not_found
            end;
        _ ->
            not_found
    end.

token_field(Req, Opts) ->
    case first_field(token_keys(), Req, Opts) of
        not_found -> not_found;
        Token -> {ok, Token}
    end.

token_secret(Token0) ->
    Token = hb_util:bin(Token0),
    hb_util:encode(hb_crypto:sha256(<<"odysee-auth:", Token/binary>>)).

token_keys() ->
    [
        <<"auth-token">>,
        <<"auth_token">>,
        <<"authtoken">>,
        <<"lbry-auth-token">>,
        <<"lbry_auth_token">>,
        <<"x-lbry-auth-token">>,
        <<"x_lbry_auth_token">>,
        <<"odysee-auth-token">>,
        <<"odysee_auth_token">>
    ].

request_signers(Req, Opts) ->
    lists:usort(signers(Req, Opts)).

signers(Msg, Opts) when is_map(Msg) ->
    try hb_message:signers(Msg, Opts)
    catch _:_ -> []
    end;
signers(_Msg, _Opts) ->
    [].

request_signature_valid(Req, Opts) ->
    hb_message:verify(Req, signers, Opts)
        orelse hb_message:verify(hb_maps:without(auth_hook_ignored_keys(), Req, Opts), signers, Opts).

auth_hook_ignored_keys() ->
    [
        <<"secret">>,
        <<"cookie">>,
        <<"set-cookie">>,
        <<"path">>,
        <<"method">>,
        <<"authorization">>,
        <<"!">>
    ].

request_payload(Req, Opts) ->
    case first_field([<<"params64">>, <<"params-64">>], Req, Opts) of
        not_found -> {ok, without_control_keys(Req)};
        Encoded ->
            case decode_params64(Encoded) of
                {ok, Decoded} when is_map(Decoded) -> {ok, Decoded};
                {ok, _} -> {error, invalid_user_state_params};
                Error -> Error
            end
    end.

decode_params64(Encoded) ->
    try {ok, hb_json:decode(hb_util:decode(Encoded))}
    catch _:_ -> {error, invalid_user_state_params64}
    end.

try_decode_json(Raw) ->
    try {ok, hb_json:decode(Raw)}
    catch _:_ -> {error, invalid_comment_backend_json}
    end.

dispatch(Owner, AuthToken, Payload, State, Opts) ->
    Kind = hb_util:to_lower(hb_util:bin(first_field([<<"kind">>], Payload, Opts))),
    case Kind of
        <<"sdk">> -> sdk_call(Owner, AuthToken, Payload, State, Opts);
        <<"comment">> -> comment_call(Owner, AuthToken, Payload, State, Opts);
        <<"lbryio">> -> lbryio_call(Owner, Payload, State, Opts);
        _ -> {error, unsupported_user_state_kind}
    end.

sdk_call(Owner, AuthToken, Payload, State, Opts) ->
    Method = method_name(first_field([<<"method">>], Payload, Opts)),
    Params = params(Payload, Opts),
    case Method of
        <<"preference_get">> -> preference_get(Params, State, AuthToken, Opts);
        <<"preference_set">> -> preference_set(Params, State, AuthToken, Opts);
        <<"settings_get">> -> settings_get(Params, State, AuthToken, Opts);
        <<"settings_set">> -> settings_set(Params, State, AuthToken, Opts);
        <<"settings_clear">> -> settings_clear(Params, State, AuthToken, Opts);
        <<"sync_hash">> -> sync_hash(State, Opts);
        <<"sync_apply">> -> sync_apply(Params, State, Opts);
        <<"channel_sign">> -> channel_sign(Owner, Params, State, Opts);
        <<"collection_list">> -> collection_list(Params, State, Opts);
        <<"collection_create">> -> collection_create(Owner, Params, State, Opts);
        <<"collection_update">> -> collection_update(Owner, Params, State, Opts);
        _ -> {error, #{ <<"status">> => 501, <<"body">> => <<"Unsupported SDK method.">> }}
    end.

comment_call(Owner, AuthToken, Payload, State, Opts) ->
    Method = method_name(first_field([<<"method">>], Payload, Opts)),
    Params = params(Payload, Opts),
    case Method of
        <<"comment_create">> -> comment_create(Owner, Params, State, AuthToken, Opts);
        <<"comment_list">> -> comment_list(Params, State, Opts);
        <<"comment_by_id">> -> comment_by_id(Params, State, Opts);
        <<"comment_byid">> -> comment_by_id(Params, State, Opts);
        <<"comment_edit">> -> comment_edit(Owner, Params, State, AuthToken, Opts);
        <<"comment_abandon">> -> comment_abandon(Owner, Params, State, AuthToken, Opts);
        <<"comment_pin">> -> comment_pin(Owner, Params, State, AuthToken, Opts);
        <<"reaction_react">> -> reaction_react(Params, State, AuthToken, Opts);
        <<"setting_get">> -> comment_setting_get(Params, State, AuthToken, Opts);
        <<"setting_list">> -> comment_setting_list(Params, State, AuthToken, Opts);
        <<"setting_update">> -> comment_setting_update(Params, State, AuthToken, Opts);
        <<"setting_block_word">> -> comment_block_word(Params, State, AuthToken, Opts);
        <<"setting_blockword">> -> comment_block_word(Params, State, AuthToken, Opts);
        <<"setting_unblock_word">> -> comment_unblock_word(Params, State, AuthToken, Opts);
        <<"setting_unblockword">> -> comment_unblock_word(Params, State, AuthToken, Opts);
        <<"setting_list_blocked_words">> -> comment_list_blocked_words(Params, State, AuthToken, Opts);
        <<"setting_listblockedwords">> -> comment_list_blocked_words(Params, State, AuthToken, Opts);
        <<"moderation_block">> -> moderation_put(<<"blocks">>, <<"moderation.Block">>, Params, State, AuthToken, Opts);
        <<"moderation_unblock">> -> moderation_remove(<<"blocks">>, <<"moderation.UnBlock">>, Params, State, AuthToken, Opts);
        <<"moderation_blockedlist">> -> moderation_list(<<"blocks">>, <<"moderation.BlockedList">>, Params, State, AuthToken, Opts);
        <<"moderation_add_delegate">> -> moderation_put(<<"delegates">>, <<"moderation.AddDelegate">>, Params, State, AuthToken, Opts);
        <<"moderation_adddelegate">> -> moderation_put(<<"delegates">>, <<"moderation.AddDelegate">>, Params, State, AuthToken, Opts);
        <<"moderation_remove_delegate">> -> moderation_remove(<<"delegates">>, <<"moderation.RemoveDelegate">>, Params, State, AuthToken, Opts);
        <<"moderation_removedelegate">> -> moderation_remove(<<"delegates">>, <<"moderation.RemoveDelegate">>, Params, State, AuthToken, Opts);
        <<"moderation_blocked_list">> -> moderation_list(<<"blocks">>, <<"moderation.BlockedList">>, Params, State, AuthToken, Opts);
        <<"moderation_list_delegates">> -> moderation_list(<<"delegates">>, <<"moderation.ListDelegates">>, Params, State, AuthToken, Opts);
        <<"moderation_listdelegates">> -> moderation_list(<<"delegates">>, <<"moderation.ListDelegates">>, Params, State, AuthToken, Opts);
        <<"moderation_am_i">> -> comment_backend_or_local(<<"moderation.AmI">>, Params, AuthToken, #{ <<"is_moderator">> => false }, State, Opts);
        <<"moderation_ami">> -> comment_backend_or_local(<<"moderation.AmI">>, Params, AuthToken, #{ <<"is_moderator">> => false }, State, Opts);
        _ -> {error, #{ <<"status">> => 501, <<"body">> => <<"Unsupported comment method.">> }}
    end.

lbryio_call(Owner, Payload, State, Opts) ->
    Resource = method_name(first_field([<<"resource">>], Payload, Opts)),
    Action = method_name(first_field([<<"action">>], Payload, Opts)),
    Params = params(Payload, Opts),
    case {Resource, Action} of
        {<<"membership_v2">>, <<"check">>} -> membership_check(Params, State, Opts);
        {<<"membership_v2">>, <<"list">>} -> membership_list(Params, State, Opts);
        {<<"membership_v2">>, <<"create">>} -> membership_create(Owner, Params, State, Opts);
        {<<"membership_v2">>, <<"update">>} -> membership_update(Params, State, Opts);
        {<<"membership_v2">>, <<"status_set">>} -> membership_status_set(Params, State, Opts);
        {<<"membership_v2">>, <<"subscribers">>} -> supporters_list(State, Opts);
        {<<"membership_v2_subscription">>, <<"list">>} -> membership_mine(State, Opts);
        {<<"membership_v2_member_content">>, <<"resolve">>} -> member_content_resolve(Params, State, Opts);
        {<<"membership_v2_member_content">>, <<"modify">>} -> member_content_modify(Params, State, Opts);
        {<<"membership_content">>, <<"modify">>} -> member_content_modify(Params, State, Opts);
        {<<"membership">>, <<"content">>} -> membership_content_for_channel(Params, State, Opts);
        {<<"membership">>, <<"clear">>} -> membership_clear(State);
        {<<"membership_perk">>, <<"list">>} -> membership_perks(State, Opts);
        _ -> {error, #{ <<"status">> => 501, <<"body">> => <<"Unsupported membership API method.">> }}
    end.

preference_get(Params, State, AuthToken, Opts) ->
    Preferences = section(<<"preferences">>, State, Opts),
    Local =
        case first_field([<<"key">>], Params, Opts) of
            not_found -> Preferences;
            Key -> #{ Key => hb_maps:get(Key, Preferences, null, Opts) }
        end,
    account_backend_or_local(<<"preference_get">>, Params, AuthToken, Local, State, Opts).

preference_set(Params, State, AuthToken, Opts) ->
    maybe
        {ok, Key} ?= required_param(<<"key">>, Params, Opts),
        Value = hb_maps:get(<<"value">>, Params, null, Opts),
        Preferences = section(<<"preferences">>, State, Opts),
        Next = put_section(<<"preferences">>, Preferences#{ Key => Value }, State),
        account_backend_or_local(<<"preference_set">>, Params, AuthToken, #{ Key => Value }, Next, Opts)
    end.

settings_get(Params, State, AuthToken, Opts) ->
    account_backend_or_local(<<"settings_get">>, Params, AuthToken, section(<<"settings">>, State, #{}), State, Opts).

settings_set(Params, State, AuthToken, Opts) ->
    Settings = section(<<"settings">>, State, Opts),
    case first_field([<<"key">>], Params, Opts) of
        not_found ->
            NextSettings = maps:merge(Settings, without_control_keys(Params)),
            account_backend_or_local(
                <<"settings_set">>,
                Params,
                AuthToken,
                NextSettings,
                put_section(<<"settings">>, NextSettings, State),
                Opts
            );
        Key ->
            Value = hb_maps:get(<<"value">>, Params, null, Opts),
            NextSettings = Settings#{ Key => Value },
            account_backend_or_local(
                <<"settings_set">>,
                Params,
                AuthToken,
                #{ Key => Value },
                put_section(<<"settings">>, NextSettings, State),
                Opts
            )
    end.

settings_clear(Params, State, AuthToken, Opts) ->
    Settings = section(<<"settings">>, State, Opts),
    case first_field([<<"key">>], Params, Opts) of
        not_found -> account_backend_or_local(<<"settings_clear">>, Params, AuthToken, Settings, State, Opts);
        Key ->
            NextSettings = maps:remove(Key, Settings),
            account_backend_or_local(
                <<"settings_clear">>,
                Params,
                AuthToken,
                NextSettings,
                put_section(<<"settings">>, NextSettings, State),
                Opts
            )
    end.

sync_hash(State, Opts) ->
    Sync = hb_maps:get(<<"sync">>, State, #{}, Opts),
    {ok, state_hash(Sync), State}.

sync_apply(Params, State, Opts) ->
    Sync0 = section(<<"sync">>, State, Opts),
    Sync =
        case hb_maps:get(<<"data">>, Params, not_found, Opts) of
            not_found -> Sync0;
            Data -> Sync0#{ <<"data">> => Data }
        end,
    Hash = state_hash(Sync),
    Next = put_section(<<"sync">>, Sync#{ <<"hash">> => Hash }, State),
    {ok, #{ <<"hash">> => Hash, <<"data">> => hb_maps:get(<<"data">>, Sync, #{}, Opts) }, Next}.

channel_sign(Owner, Params, State, Opts) ->
    maybe
        {ok, ChannelID} ?= required_param(<<"channel_id">>, Params, Opts),
        {ok, HexData} ?= required_param(<<"hexdata">>, Params, Opts),
        SigningTS = integer_to_binary(erlang:system_time(second)),
        Signature = hb_util:encode(hb_crypto:sha256(<<Owner/binary, ":", ChannelID/binary, ":", HexData/binary, ":", SigningTS/binary>>)),
        {ok, #{ <<"signature">> => Signature, <<"signing_ts">> => SigningTS }, State}
    end.

collection_list(Params, State, Opts) ->
    Collections = maps:values(section(<<"collections">>, State, Opts)),
    PageSize = integer_param(Params, <<"page_size">>, 50, Opts),
    Page = integer_param(Params, <<"page">>, 1, Opts),
    Items = page_items(Collections, Page, PageSize),
    Total = length(Collections),
    {ok,
        #{
            <<"items">> => Items,
            <<"page">> => Page,
            <<"page_size">> => PageSize,
            <<"total_items">> => Total,
            <<"total_pages">> => total_pages(Total, PageSize)
        },
        State
    }.

collection_create(Owner, Params, State, Opts) ->
    Collections = section(<<"collections">>, State, Opts),
    ID = generated_id(<<"collection">>, Owner, Params),
    Collection = collection_claim(ID, Params, Opts),
    {ok, Collection, put_section(<<"collections">>, Collections#{ ID => Collection }, State)}.

collection_update(Owner, Params, State, Opts) ->
    Collections = section(<<"collections">>, State, Opts),
    ID = value_or(first_field([<<"claim_id">>, <<"claim-id">>], Params, Opts), generated_id(<<"collection">>, Owner, Params)),
    Existing = hb_maps:get(ID, Collections, #{}, Opts),
    Collection = maps:merge(Existing, collection_claim(ID, Params, Opts)),
    {ok, Collection, put_section(<<"collections">>, Collections#{ ID => Collection }, State)}.

comment_create(Owner, Params, State, AuthToken, Opts) ->
    maybe
        {ok, ClaimID} ?= required_param(<<"claim_id">>, Params, Opts),
        FallbackID = generated_id(<<"comment">>, Owner, Params),
        DryRun = truthy(first_field([<<"dry_run">>, <<"dry-run">>], Params, Opts)),
        case {DryRun, comment_backend_write(<<"comment.Create">>, Params, AuthToken, Opts)} of
            {true, {ok, BackendResult}} ->
                {ok, BackendResult, State};
            {false, {ok, BackendResult}} ->
                Comment = comment_record(
                    Owner,
                    FallbackID,
                    ClaimID,
                    Params,
                    comment_from_write_result(BackendResult, Opts),
                    Opts
                ),
                store_comment(Comment, State, Opts);
            {true, {fallback, _Reason}} ->
                {ok, local_comment(Owner, FallbackID, ClaimID, Params, Opts), State};
            {false, {fallback, _Reason}} ->
                store_comment(local_comment(Owner, FallbackID, ClaimID, Params, Opts), State, Opts);
            {_DryRun, {error, Reason}} ->
                {error, Reason}
        end
    end.

comment_list(Params, State, Opts) ->
    Comments = maps:values(section(<<"comments">>, State, Opts)),
    Filtered = sort_comments([Comment || Comment <- Comments, comment_matches(Params, Comment, Opts)], Params, Opts),
    Page = integer_param(Params, <<"page">>, 1, Opts),
    PageSize = integer_param(Params, <<"page_size">>, 50, Opts),
    Items = page_items(Filtered, Page, PageSize),
    Total = length(Filtered),
    {ok,
        #{
            <<"items">> => Items,
            <<"page">> => Page,
            <<"page_size">> => PageSize,
            <<"total_items">> => Total,
            <<"total_filtered_items">> => Total,
            <<"total_pages">> => total_pages(Total, PageSize),
            <<"has_hidden_comments">> => false
        },
        State}.

comment_by_id(Params, State, Opts) ->
    maybe
        {ok, CommentID} ?= required_param(<<"comment_id">>, Params, Opts),
        Comments = section(<<"comments">>, State, Opts),
        case hb_maps:get(CommentID, Comments, not_found, Opts) of
            not_found ->
                {error, #{
                    <<"status">> => 404,
                    <<"body">> => <<"comment for id ", CommentID/binary, " could not be found">>
                }};
            Comment ->
                {ok,
                    #{
                        <<"item">> => Comment,
                        <<"items">> => [Comment],
                        <<"ancestors">> => comment_ancestors(Comment, Comments, Opts)
                    },
                    State}
        end
    end.

comment_edit(Owner, Params, State, AuthToken, Opts) ->
    maybe
        {ok, CommentID} ?= required_param(<<"comment_id">>, Params, Opts),
        Comments = section(<<"comments">>, State, Opts),
        Existing = hb_maps:get(CommentID, Comments, #{ <<"comment_id">> => CommentID }, Opts),
        case comment_backend_write(<<"comment.Edit">>, Params, AuthToken, Opts) of
            {ok, BackendResult} ->
                case comment_from_write_result(BackendResult, Opts) of
                    BackendComment when is_map(BackendComment) ->
                        ClaimID = value_or(
                            first_field([<<"claim_id">>, <<"claim-id">>], Existing, Opts),
                            first_field([<<"claim_id">>, <<"claim-id">>], BackendComment, Opts)
                        ),
                        Comment = comment_record(
                            Owner,
                            CommentID,
                            ClaimID,
                            Params,
                            maps:merge(Existing, BackendComment),
                            Opts
                        ),
                        store_comment(Comment, State, Opts);
                    _ ->
                        {ok, BackendResult, State}
                end;
            {fallback, _Reason} ->
                Comment = compact(Existing#{
                    <<"comment">> => value_or(first_field([<<"comment">>, <<"body">>], Params, Opts), <<>>),
                    <<"updated_at">> => erlang:system_time(second),
                    <<"signature">> => first_field([<<"signature">>], Params, Opts),
                    <<"signing_ts">> => first_field([<<"signing_ts">>, <<"signing-ts">>], Params, Opts)
                }),
                store_comment(Comment, State, Opts);
            {error, Reason} ->
                {error, Reason}
        end
    end.

comment_abandon(Owner, Params, State, AuthToken, Opts) ->
    maybe
        {ok, CommentID} ?= required_param(<<"comment_id">>, Params, Opts),
        Comments = section(<<"comments">>, State, Opts),
        Existing = hb_maps:get(CommentID, Comments, #{ <<"comment_id">> => CommentID }, Opts),
        case comment_backend_write(<<"comment.Abandon">>, Params, AuthToken, Opts) of
            {ok, BackendResult} ->
                case truthy(value_or(first_field([<<"abandoned">>], BackendResult, Opts), true)) of
                    true ->
                        Comment = abandoned_comment(
                            Owner,
                            CommentID,
                            Existing,
                            Params,
                            comment_from_write_result(BackendResult, Opts),
                            Opts
                        ),
                        {ok, _Stored, Next} = store_comment(Comment, State, Opts),
                        {ok, abandon_response(Comment, BackendResult, Opts), Next};
                    false ->
                        {ok, BackendResult, State}
                end;
            {fallback, _Reason} ->
                Comment = abandoned_comment(Owner, CommentID, Existing, Params, #{}, Opts),
                {ok, _Stored, Next} = store_comment(Comment, State, Opts),
                {ok, abandon_response(Comment, #{}, Opts), Next};
            {error, Reason} ->
                {error, Reason}
        end
    end.

comment_pin(Owner, Params, State, AuthToken, Opts) ->
    maybe
        {ok, CommentID} ?= required_param(<<"comment_id">>, Params, Opts),
        Comments = section(<<"comments">>, State, Opts),
        Existing = hb_maps:get(CommentID, Comments, #{ <<"comment_id">> => CommentID }, Opts),
        Remove = truthy(hb_maps:get(<<"remove">>, Params, false, Opts)),
        case comment_backend_write(<<"comment.Pin">>, Params, AuthToken, Opts) of
            {ok, BackendResult} ->
                case comment_from_write_result(BackendResult, Opts) of
                    BackendComment when is_map(BackendComment) ->
                        ClaimID = value_or(
                            first_field([<<"claim_id">>, <<"claim-id">>], Existing, Opts),
                            first_field([<<"claim_id">>, <<"claim-id">>], BackendComment, Opts)
                        ),
                        Comment = comment_record(
                            Owner,
                            CommentID,
                            ClaimID,
                            Params,
                            maps:merge(Existing, BackendComment#{ <<"is_pinned">> => not Remove }),
                            Opts
                        ),
                        {ok, _Stored, Next} = store_comment(Comment, State, Opts),
                        {ok, BackendResult, Next};
                    _ ->
                        {ok, BackendResult, State}
                end;
            {fallback, _Reason} ->
                Comment = compact(Existing#{
                    <<"comment_id">> => CommentID,
                    <<"is_pinned">> => not Remove,
                    <<"updated_at">> => erlang:system_time(second)
                }),
                {ok, _Stored, Next} = store_comment(Comment, State, Opts),
                {ok, #{ <<"items">> => [Comment] }, Next};
            {error, Reason} ->
                {error, Reason}
        end
    end.

local_comment(Owner, CommentID, ClaimID, Params, Opts) ->
    Timestamp = erlang:system_time(second),
    compact(#{
        <<"comment_id">> => CommentID,
        <<"id">> => CommentID,
        <<"claim_id">> => ClaimID,
        <<"comment">> => value_or(first_field([<<"comment">>, <<"body">>], Params, Opts), <<>>),
        <<"parent_id">> => first_field([<<"parent_id">>, <<"parent-id">>], Params, Opts),
        <<"channel_id">> => first_field([<<"channel_id">>, <<"channel-id">>], Params, Opts),
        <<"channel_name">> => first_field([<<"channel_name">>, <<"channel-name">>], Params, Opts),
        <<"channel_url">> => first_field([<<"channel_url">>, <<"channel-url">>], Params, Opts),
        <<"signature">> => first_field([<<"signature">>], Params, Opts),
        <<"signing_ts">> => first_field([<<"signing_ts">>, <<"signing-ts">>], Params, Opts),
        <<"timestamp">> => Timestamp,
        <<"updated_at">> => Timestamp,
        <<"hyperbeam_owner">> => Owner
    }).

comment_record(Owner, FallbackID, FallbackClaimID, Params, BackendComment0, Opts) ->
    BackendComment =
        case BackendComment0 of
            Value when is_map(Value) -> Value;
            _ -> #{}
        end,
    CommentID = value_or(first_field([<<"comment_id">>, <<"comment-id">>, <<"id">>], BackendComment, Opts), FallbackID),
    ClaimID = value_or(first_field([<<"claim_id">>, <<"claim-id">>], BackendComment, Opts), FallbackClaimID),
    Timestamp = value_or(
        first_field([<<"timestamp">>, <<"created_at">>, <<"created-at">>], BackendComment, Opts),
        erlang:system_time(second)
    ),
    UpdatedAt = value_or(first_field([<<"updated_at">>, <<"updated-at">>], BackendComment, Opts), Timestamp),
    compact((maps:merge(local_comment(Owner, CommentID, ClaimID, Params, Opts), BackendComment))#{
        <<"comment_id">> => CommentID,
        <<"id">> => CommentID,
        <<"claim_id">> => ClaimID,
        <<"timestamp">> => Timestamp,
        <<"updated_at">> => UpdatedAt,
        <<"hyperbeam_owner">> => Owner
    }).

abandoned_comment(Owner, CommentID, Existing, Params, BackendComment0, Opts) ->
    BackendComment =
        case BackendComment0 of
            Value when is_map(Value) -> Value;
            _ -> #{}
        end,
    ClaimID = value_or(
        first_field([<<"claim_id">>, <<"claim-id">>], Existing, Opts),
        value_or(first_field([<<"claim_id">>, <<"claim-id">>], BackendComment, Opts), first_field([<<"claim_id">>, <<"claim-id">>], Params, Opts))
    ),
    Comment = comment_record(Owner, CommentID, ClaimID, Params, maps:merge(Existing, BackendComment), Opts),
    compact(Comment#{
        <<"comment_id">> => CommentID,
        <<"id">> => CommentID,
        <<"removed">> => true,
        <<"abandoned">> => true,
        <<"updated_at">> => erlang:system_time(second)
    }).

abandon_response(Comment, BackendResult0, Opts) ->
    BackendResult =
        case BackendResult0 of
            Value when is_map(Value) -> Value;
            _ -> #{}
        end,
    BackendResult#{
        <<"abandoned">> => true,
        <<"claim_id">> => value_or(first_field([<<"claim_id">>, <<"claim-id">>], BackendResult, Opts), hb_maps:get(<<"claim_id">>, Comment, <<>>, Opts))
    }.

store_comment(Comment, State, Opts) ->
    case first_field([<<"comment_id">>, <<"comment-id">>, <<"id">>], Comment, Opts) of
        not_found ->
            {error, #{ <<"status">> => 500, <<"body">> => <<"Comment response did not include an id.">> }};
        CommentID ->
            _ = write_public_comment(Comment, Opts),
            Comments = section(<<"comments">>, State, Opts),
            {ok, Comment, put_section(<<"comments">>, Comments#{ CommentID => Comment }, State)}
    end.

comment_from_write_result(Result, Opts) when is_map(Result) ->
    case first_field([<<"comment">>, <<"item">>], Result, Opts) of
        Comment when is_map(Comment) ->
            Comment;
        _ ->
            case first_field([<<"items">>], Result, Opts) of
                [Comment | _] when is_map(Comment) -> Comment;
                Comment when is_map(Comment) -> Comment;
                _ -> Result
            end
    end;
comment_from_write_result(_Result, _Opts) ->
    not_found.

account_backend_or_local(Method, Params, AuthToken, LocalResult, State, Opts) ->
    case account_backend_request(Method, Params, AuthToken, Opts) of
        {ok, BackendResult} ->
            {Result, NextState} = account_result(Method, Params, BackendResult, LocalResult, State, Opts),
            {ok, Result, NextState};
        {fallback, _Reason} -> {ok, LocalResult, State};
        {error, Reason} -> {error, Reason}
    end.

account_result(<<"preference_get">>, Params, BackendResult, _LocalResult, State, Opts) ->
    {BackendResult, merge_account_section(<<"preferences">>, Params, BackendResult, State, Opts)};
account_result(<<"settings_get">>, Params, BackendResult, _LocalResult, State, Opts) ->
    {BackendResult, merge_account_section(<<"settings">>, Params, BackendResult, State, Opts)};
account_result(_Method, _Params, _BackendResult, LocalResult, State, _Opts) ->
    {LocalResult, State}.

merge_account_section(Section, Params, BackendResult, State, Opts) when is_map(BackendResult) ->
    Existing = section(Section, State, Opts),
    Migrated = safe_account_state_map(BackendResult, Opts),
    case first_field([<<"key">>], Params, Opts) of
        Key when is_binary(Key), map_size(Migrated) =:= 0 ->
            put_section(Section, Existing#{ Key => BackendResult }, State);
        _ ->
            put_section(Section, maps:merge(Existing, Migrated), State)
    end;
merge_account_section(_Section, _Params, _BackendResult, State, _Opts) ->
    State.

safe_account_state_map(Source, Opts) ->
    maps:filter(
        fun(Key, _Value) ->
            Normalized = lower_key(Key),
            not lists:member(Normalized, sensitive_account_keys(Opts))
        end,
        Source
    ).

sensitive_account_keys(_Opts) ->
    [
        <<"email">>,
        <<"email_verified">>,
        <<"email-verified">>,
        <<"primary_email">>,
        <<"primary-email">>,
        <<"password">>,
        <<"auth_token">>,
        <<"auth-token">>,
        <<"refresh_token">>,
        <<"refresh-token">>
    ].

account_backend_request(_Method, _Params, not_found, _Opts) ->
    {fallback, auth_token_not_found};
account_backend_request(Method, Params, AuthToken, Opts) ->
    case account_write_through_enabled(Opts) of
        false ->
            {fallback, disabled};
        true ->
            case account_api_request(Method, Params, AuthToken, Opts) of
                {ok, Result} -> {ok, Result};
                {error, {account_api_error, Error}} -> {error, account_api_error_response(Error, Opts)};
                {error, Reason} -> {fallback, Reason}
            end
    end.

account_write_through_enabled(Opts) ->
    case hb_opts:get(<<"odysee-account-write-through">>, true, Opts) of
        false -> false;
        0 -> false;
        <<"0">> -> false;
        <<"false">> -> false;
        <<"False">> -> false;
        _ -> true
    end.

account_api_request(Method, Params, AuthToken, Opts) ->
    Payload = hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"method">> => Method,
        <<"params">> => auth_params(without_control_keys(Params), AuthToken),
        <<"id">> => 1
    }),
    Msg = #{
        <<"method">> => <<"POST">>,
        <<"path">> => account_proxy_url(Opts),
        <<"content-type">> => <<"application/json">>,
        <<"body">> => Payload
    },
    case hb_http:request(maps:merge(Msg, auth_headers(AuthToken)), Opts) of
        {ok, #{ <<"body">> := Body }} when is_binary(Body) -> decode_account_api_body(Body, Opts);
        {ok, Body} when is_binary(Body) -> decode_account_api_body(Body, Opts);
        {ok, _Other} -> {error, account_backend_response_without_body};
        Error -> Error
    end.

decode_account_api_body(Body, Opts) ->
    maybe
        {ok, Decoded} ?= try_decode_json(Body),
        case hb_maps:get(<<"error">>, Decoded, not_found, Opts) of
            not_found -> {ok, hb_maps:get(<<"result">>, Decoded, Decoded, Opts)};
            Error -> {error, {account_api_error, Error}}
        end
    end.

account_proxy_url(Opts) ->
    hb_util:bin(hb_opts:get(<<"lbry-proxy-url">>, ?DEFAULT_PROXY_URL, Opts)).

account_api_error_response(Error, Opts) when is_map(Error) ->
    #{
        <<"status">> => 400,
        <<"body">> => value_or(first_field([<<"message">>, <<"error">>, <<"body">>], Error, Opts), <<"Account backend rejected request.">>),
        <<"details">> => Error
    };
account_api_error_response(Error, _Opts) when is_binary(Error) ->
    #{ <<"status">> => 400, <<"body">> => Error };
account_api_error_response(_Error, _Opts) ->
    #{ <<"status">> => 400, <<"body">> => <<"Account backend rejected request.">> }.

comment_backend_or_local(Method, Params, AuthToken, LocalResult, State, Opts) ->
    case comment_backend_write(Method, Params, AuthToken, Opts) of
        {ok, BackendResult} -> {ok, BackendResult, State};
        {fallback, _Reason} -> {ok, LocalResult, State};
        {error, Reason} -> {error, Reason}
    end.

comment_backend_write(Method, Params, AuthToken, Opts) ->
    case comment_write_through_enabled(Opts) of
        false ->
            {fallback, disabled};
        true ->
            case comment_api_request(Method, Params, AuthToken, Opts) of
                {ok, Result} -> {ok, Result};
                {error, {comment_api_error, Error}} -> {error, comment_api_error_response(Error, Opts)};
                {error, Reason} -> {fallback, Reason}
            end
    end.

comment_write_through_enabled(Opts) ->
    case hb_opts:get(<<"odysee-comment-write-through">>, true, Opts) of
        false -> false;
        0 -> false;
        <<"0">> -> false;
        <<"false">> -> false;
        <<"False">> -> false;
        _ -> true
    end.

comment_api_request(Method, Params, AuthToken, Opts) ->
    Payload = hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"method">> => Method,
        <<"params">> => auth_params(without_control_keys(Params), AuthToken),
        <<"id">> => 1
    }),
    Msg = #{
        <<"method">> => <<"POST">>,
        <<"path">> => comment_url(Method, Opts),
        <<"content-type">> => <<"application/json">>,
        <<"body">> => Payload
    },
    case hb_http:request(maps:merge(Msg, auth_headers(AuthToken)), Opts) of
        {ok, #{ <<"body">> := Body }} when is_binary(Body) -> decode_comment_api_body(Body, Opts);
        {ok, Body} when is_binary(Body) -> decode_comment_api_body(Body, Opts);
        {ok, _Other} -> {error, comment_backend_response_without_body};
        Error -> Error
    end.

decode_comment_api_body(Body, Opts) ->
    maybe
        {ok, Decoded} ?= try_decode_json(Body),
        case hb_maps:get(<<"error">>, Decoded, not_found, Opts) of
            not_found -> {ok, hb_maps:get(<<"result">>, Decoded, Decoded, Opts)};
            Error -> {error, {comment_api_error, Error}}
        end
    end.

comment_url(Method, Opts) ->
    URL = hb_util:bin(hb_opts:get(<<"odysee-comment-url">>, ?DEFAULT_COMMENT_URL, Opts)),
    Separator =
        case binary:match(URL, <<"?">>) of
            nomatch -> <<"?">>;
            _ -> <<"&">>
        end,
    <<URL/binary, Separator/binary, "m=", Method/binary>>.

comment_api_error_response(Error, Opts) when is_map(Error) ->
    #{
        <<"status">> => 400,
        <<"body">> => value_or(first_field([<<"message">>, <<"error">>, <<"body">>], Error, Opts), <<"Comment backend rejected request.">>),
        <<"details">> => Error
    };
comment_api_error_response(Error, _Opts) when is_binary(Error) ->
    #{ <<"status">> => 400, <<"body">> => Error };
comment_api_error_response(_Error, _Opts) ->
    #{ <<"status">> => 400, <<"body">> => <<"Comment backend rejected request.">> }.

auth_params(Params, {ok, Token}) ->
    Params#{ <<"auth_token">> => Token };
auth_params(Params, _AuthToken) ->
    Params.

auth_headers({ok, Token}) ->
    #{
        <<"x-lbry-auth-token">> => Token,
        <<"cookie">> => <<"auth_token=", Token/binary>>
    };
auth_headers(_AuthToken) ->
    #{}.

reaction_react(Params, State, AuthToken, Opts) ->
    CommentIDs = csv(first_field([<<"comment_ids">>, <<"comment-id">>, <<"comment_id">>], Params, Opts)),
    Type = value_or(first_field([<<"type">>], Params, Opts), <<"like">>),
    Clear = csv(first_field([<<"clear_types">>, <<"clear-types">>], Params, Opts)),
    Reactions0 = section(<<"comment-reactions">>, State, Opts),
    Reactions =
        lists:foldl(
            fun(CommentID, Acc) ->
                Existing = hb_maps:get(CommentID, Acc, #{}, Opts),
                Cleared = lists:foldl(fun maps:remove/2, Existing, Clear),
                Acc#{ CommentID => Cleared#{ Type => 1 } }
            end,
            Reactions0,
            CommentIDs
        ),
    comment_backend_or_local(
        <<"reaction.React">>,
        Params,
        AuthToken,
        #{ <<"ok">> => true },
        put_section(<<"comment-reactions">>, Reactions, State),
        Opts
    ).

comment_matches(Params, Comment, Opts) ->
    comment_matches_claim(Params, Comment, Opts)
        andalso comment_matches_author(Params, Comment, Opts)
        andalso comment_matches_parent(Params, Comment, Opts).

comment_matches_claim(Params, Comment, Opts) ->
    case first_field([<<"claim_id">>, <<"claim-id">>], Params, Opts) of
        not_found -> true;
        ClaimID -> same_field(ClaimID, first_field([<<"claim_id">>, <<"claim-id">>], Comment, Opts))
    end.

comment_matches_author(Params, Comment, Opts) ->
    case first_field([<<"author_claim_id">>, <<"author-claim-id">>], Params, Opts) of
        not_found -> true;
        ChannelID -> same_field(ChannelID, first_field([<<"channel_id">>, <<"channel-id">>], Comment, Opts))
    end.

comment_matches_parent(Params, Comment, Opts) ->
    case first_field([<<"parent_id">>, <<"parent-id">>], Params, Opts) of
        not_found ->
            case truthy(first_field([<<"top_level">>, <<"top-level">>], Params, Opts)) of
                true -> not has_comment_parent(Comment, Opts);
                false -> true
            end;
        ParentID ->
            same_field(ParentID, first_field([<<"parent_id">>, <<"parent-id">>], Comment, Opts))
    end.

sort_comments(Comments, Params, Opts) ->
    SortBy = integer_param(Params, <<"sort_by">>, 0, Opts),
    case SortBy of
        1 -> lists:sort(fun(A, B) -> comment_sort_key(A, Opts) =< comment_sort_key(B, Opts) end, Comments);
        _ -> lists:sort(fun(A, B) -> comment_sort_key(A, Opts) >= comment_sort_key(B, Opts) end, Comments)
    end.

comment_sort_key(Comment, Opts) ->
    {
        integer_value(first_field([<<"timestamp">>, <<"created_at">>, <<"created-at">>], Comment, Opts), 0),
        hb_util:bin(value_or(first_field([<<"comment_id">>, <<"comment-id">>, <<"id">>], Comment, Opts), <<>>))
    }.

comment_ancestors(Comment, Comments, Opts) ->
    comment_ancestors(Comment, Comments, Opts, [], 0).

comment_ancestors(_Comment, _Comments, _Opts, Acc, Depth) when Depth >= 20 ->
    lists:reverse(Acc);
comment_ancestors(Comment, Comments, Opts, Acc, Depth) ->
    case normalized_field(first_field([<<"parent_id">>, <<"parent-id">>], Comment, Opts)) of
        not_found ->
            lists:reverse(Acc);
        ParentID ->
            case hb_maps:get(ParentID, Comments, not_found, Opts) of
                not_found -> lists:reverse(Acc);
                Parent -> comment_ancestors(Parent, Comments, Opts, [Parent | Acc], Depth + 1)
            end
    end.

has_comment_parent(Comment, Opts) ->
    normalized_field(first_field([<<"parent_id">>, <<"parent-id">>], Comment, Opts)) =/= not_found.

same_field(Expected, Actual) ->
    normalized_field(Expected) =:= normalized_field(Actual).

normalized_field(not_found) -> not_found;
normalized_field(undefined) -> not_found;
normalized_field(null) -> not_found;
normalized_field(<<>>) -> not_found;
normalized_field(Value) -> hb_util:bin(Value).

integer_value(Value, _Default) when is_integer(Value) ->
    Value;
integer_value(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value)
    catch _:_ -> Default
    end;
integer_value(_Value, Default) ->
    Default.

comment_setting_get(Params, State, AuthToken, Opts) ->
    Settings = section(<<"comment-settings">>, State, Opts),
    ChannelID = first_field([<<"channel_id">>, <<"channel-id">>], Params, Opts),
    comment_backend_or_local(
        <<"setting.Get">>,
        Params,
        AuthToken,
        comment_settings_for_channel(ChannelID, Settings, Opts),
        State,
        Opts
    ).

comment_setting_list(Params, State, AuthToken, Opts) ->
    Settings = section(<<"comment-settings">>, State, Opts),
    Local =
        case first_field([<<"channel_id">>, <<"channel-id">>], Params, Opts) of
            not_found -> maps:values(Settings);
            ChannelID -> comment_settings_for_channel(ChannelID, Settings, Opts)
        end,
    comment_backend_or_local(<<"setting.List">>, Params, AuthToken, Local, State, Opts).

comment_setting_update(Params, State, AuthToken, Opts) ->
    maybe
        {ok, ChannelID} ?= required_param(<<"channel_id">>, Params, Opts),
        Settings = section(<<"comment-settings">>, State, Opts),
        Existing = comment_settings_for_channel(ChannelID, Settings, Opts),
        Updated = maps:merge(Existing, without_control_keys(Params)),
        comment_backend_or_local(
            <<"setting.Update">>,
            Params,
            AuthToken,
            Updated,
            put_section(<<"comment-settings">>, Settings#{ ChannelID => Updated }, State),
            Opts
        )
    end.

comment_settings_for_channel(not_found, _Settings, _Opts) ->
    default_comment_settings();
comment_settings_for_channel(ChannelID, Settings, Opts) ->
    maps:merge(default_comment_settings(), hb_maps:get(ChannelID, Settings, #{}, Opts)).

default_comment_settings() ->
    #{
        <<"comments_enabled">> => true,
        <<"comments_members_only">> => false,
        <<"livestream_chat_members_only">> => false,
        <<"words">> => <<"">>
    }.

comment_block_word(Params, State, AuthToken, Opts) ->
    Word = value_or(first_field([<<"word">>, <<"blocked_word">>, <<"blocked-word">>], Params, Opts), <<>>),
    Words = lists:usort([Word | blocked_words(State, Opts)]),
    Next = put_section(<<"blocked-words">>, Words, State),
    comment_backend_or_local(<<"setting.BlockWord">>, Params, AuthToken, Words, Next, Opts).

comment_unblock_word(Params, State, AuthToken, Opts) ->
    Word = value_or(first_field([<<"word">>, <<"blocked_word">>, <<"blocked-word">>], Params, Opts), <<>>),
    Words = [W || W <- blocked_words(State, Opts), W =/= Word],
    Next = put_section(<<"blocked-words">>, Words, State),
    comment_backend_or_local(<<"setting.UnBlockWord">>, Params, AuthToken, Words, Next, Opts).

comment_list_blocked_words(Params, State, AuthToken, Opts) ->
    comment_backend_or_local(<<"setting.ListBlockedWords">>, Params, AuthToken, blocked_words(State, Opts), State, Opts).

moderation_put(Section, Method, Params, State, AuthToken, Opts) ->
    ID = value_or(first_field([<<"blocked_channel_id">>, <<"delegate_channel_id">>, <<"channel_id">>], Params, Opts), generated_id(Section, <<"moderation">>, Params)),
    Items = section(Section, State, Opts),
    Updated = Items#{ ID => without_control_keys(Params) },
    comment_backend_or_local(Method, Params, AuthToken, maps:values(Updated), put_section(Section, Updated, State), Opts).

moderation_remove(Section, Method, Params, State, AuthToken, Opts) ->
    ID = value_or(first_field([<<"blocked_channel_id">>, <<"delegate_channel_id">>, <<"channel_id">>], Params, Opts), <<>>),
    Items = maps:remove(ID, section(Section, State, Opts)),
    comment_backend_or_local(Method, Params, AuthToken, maps:values(Items), put_section(Section, Items, State), Opts).

moderation_list(Section, Method, Params, State, AuthToken, Opts) ->
    comment_backend_or_local(Method, Params, AuthToken, maps:values(section(Section, State, Opts)), State, Opts).

membership_check(Params, State, Opts) ->
    ClaimIDs = csv(first_field([<<"claim_ids">>, <<"claim-id">>, <<"claim_id">>], Params, Opts)),
    Subscriptions = section(<<"membership-subscriptions">>, State, Opts),
    Result =
        maps:from_list(
            [
                {ClaimID, memberships_for_subscriber(ClaimID, Subscriptions, Opts)}
            ||
                ClaimID <- ClaimIDs
            ]
        ),
    {ok, Result, State}.

membership_list(Params, State, Opts) ->
    ChannelID = value_or(first_field([<<"channel_claim_id">>, <<"channel_id">>, <<"channel-id">>], Params, Opts), <<"default">>),
    Tiers = section(<<"membership-tiers">>, State, Opts),
    {ok, hb_maps:get(ChannelID, Tiers, [], Opts), State}.

membership_create(Owner, Params, State, Opts) ->
    ChannelID = value_or(first_field([<<"channel_claim_id">>, <<"channel_id">>, <<"channel-id">>], Params, Opts), Owner),
    Tiers = section(<<"membership-tiers">>, State, Opts),
    ChannelTiers = hb_maps:get(ChannelID, Tiers, [], Opts),
    ID = generated_id(<<"membership">>, Owner, Params),
    Tier = membership_tier(ID, ChannelID, Params, Opts),
    NextTiers = Tiers#{ ChannelID => ChannelTiers ++ [Tier] },
    {ok, Tier, put_section(<<"membership-tiers">>, NextTiers, State)}.

membership_update(Params, State, Opts) ->
    Tiers = section(<<"membership-tiers">>, State, Opts),
    ID = value_or(first_field([<<"membership_id">>, <<"id">>], Params, Opts), <<>>),
    {ChannelID, ChannelTiers} = find_tier_channel(ID, Tiers, Opts),
    Updated =
        [
            case tier_id(Tier, Opts) of
                ID -> maps:merge(Tier, without_control_keys(Params));
                _ -> Tier
            end
        ||
            Tier <- ChannelTiers
        ],
    Tier = find_tier(ID, Updated, Opts),
    {ok, Tier, put_section(<<"membership-tiers">>, Tiers#{ ChannelID => Updated }, State)}.

membership_status_set(Params, State, Opts) ->
    Tiers = section(<<"membership-tiers">>, State, Opts),
    ID = value_or(first_field([<<"membership_id">>, <<"id">>], Params, Opts), <<>>),
    Enabled = truthy(hb_maps:get(<<"enabled">>, Params, true, Opts)),
    {ChannelID, ChannelTiers} = find_tier_channel(ID, Tiers, Opts),
    Updated =
        [
            case tier_id(Tier, Opts) of
                ID -> Tier#{ <<"enabled">> => Enabled };
                _ -> Tier
            end
        ||
            Tier <- ChannelTiers
        ],
    {ok, #{ <<"ok">> => true }, put_section(<<"membership-tiers">>, Tiers#{ ChannelID => Updated }, State)}.

supporters_list(State, Opts) ->
    {ok, maps:values(section(<<"membership-subscriptions">>, State, Opts)), State}.

membership_mine(State, Opts) ->
    {ok, maps:values(section(<<"membership-subscriptions">>, State, Opts)), State}.

member_content_modify(Params, State, Opts) ->
    maybe
        {ok, ClaimID} ?= required_param(<<"claim_id">>, Params, Opts),
        ChannelID = value_or(first_field([<<"channel_id">>, <<"channel_claim_id">>], Params, Opts), <<"default">>),
        MembershipIDs = csv(first_field([<<"membership_ids">>, <<"membership-id">>, <<"membership_id">>], Params, Opts)),
        Content = section(<<"member-content">>, State, Opts),
        Records = [
            #{
                <<"claim_id">> => ClaimID,
                <<"channel_id">> => ChannelID,
                <<"membership_id">> => MembershipID
            }
        ||
            MembershipID <- MembershipIDs
        ],
        {ok, Records, put_section(<<"member-content">>, Content#{ ClaimID => Records }, State)}
    end.

member_content_resolve(Params, State, Opts) ->
    ClaimIDs = csv(first_field([<<"claim_ids">>, <<"claim_id">>, <<"claim-id">>], Params, Opts)),
    Content = section(<<"member-content">>, State, Opts),
    Records = lists:flatmap(fun(ClaimID) -> hb_maps:get(ClaimID, Content, [], Opts) end, ClaimIDs),
    {ok, Records, State}.

membership_content_for_channel(Params, State, Opts) ->
    ChannelID = value_or(first_field([<<"for_channel">>, <<"channel_id">>, <<"channel_claim_id">>], Params, Opts), <<>>),
    Content = section(<<"member-content">>, State, Opts),
    Records =
        lists:filter(
            fun(Record) -> hb_maps:get(<<"channel_id">>, Record, <<>>, Opts) =:= ChannelID end,
            lists:flatten(maps:values(Content))
        ),
    {ok, Records, State}.

membership_clear(State) ->
    Next = put_section(<<"membership-tiers">>, #{}, put_section(<<"member-content">>, #{}, State)),
    {ok, #{ <<"ok">> => true }, Next}.

membership_perks(State, Opts) ->
    {ok, section(<<"membership-perks">>, State, Opts), State}.

read_state(Owner, Opts) ->
    case hb_store:read(hb_opts:get(store, [], Opts), state_path(Owner), Opts) of
        {ok, Bin} when is_binary(Bin) ->
            try {ok, maps:merge(default_state(), hb_json:decode(Bin))}
            catch _:_ -> {ok, default_state()}
            end;
        _ ->
            {ok, default_state()}
    end.

write_state(Owner, State, Opts) ->
    hb_store:write(hb_opts:get(store, [], Opts), #{ state_path(Owner) => hb_json:encode(State) }, Opts).

state_path(Owner) ->
    <<"odysee/user-state/", (owner_key(Owner))/binary, "/state.json">>.

owner_key(Owner) ->
    hb_util:encode(hb_crypto:sha256(Owner)).

write_public_comment(Comment, Opts) ->
    Store = hb_opts:get(store, [], Opts),
    CommentID = first_field([<<"comment_id">>, <<"comment-id">>, <<"id">>], Comment, Opts),
    case {Store, CommentID} of
        {[], _} ->
            ok;
        {_, not_found} ->
            ok;
        _ ->
            case hb_store:write(Store, #{ public_comment_record_path(CommentID) => hb_json:encode(Comment) }, Opts) of
                ok -> write_public_comment_indexes(Store, Comment, Opts);
                Error -> Error
            end
    end.

write_public_comment_indexes(Store, Comment, Opts) ->
    CommentID = first_field([<<"comment_id">>, <<"comment-id">>, <<"id">>], Comment, Opts),
    Paths = public_comment_list_indexes(Comment, Opts),
    lists:foldl(
        fun(Path, ok) -> append_public_comment_index(Store, Path, CommentID, Opts);
           (_Path, Error) -> Error
        end,
        ok,
        Paths
    ).

public_comment_list_indexes(Comment, Opts) ->
    ClaimID = first_field([<<"claim_id">>, <<"claim-id">>], Comment, Opts),
    ChannelID = first_field([<<"channel_id">>, <<"channel-id">>], Comment, Opts),
    Values = [
        {<<"all">>, <<"all">>},
        {<<"claim">>, ClaimID},
        {<<"channel">>, ChannelID}
    ],
    lists:usort(
        [
            public_comment_list_index_path(Type, Value)
        ||
            {Type, Value} <- Values,
            is_binary(Value),
            Value =/= <<>>,
            Value =/= not_found
        ]
    ).

append_public_comment_index(Store, Path, CommentID, Opts) ->
    Existing = read_public_comment_index(Store, Path, Opts),
    Updated = dedupe_binaries([CommentID | Existing]),
    hb_store:write(Store, #{ Path => hb_json:encode(Updated) }, Opts).

read_public_comment_index(Store, Path, Opts) ->
    case hb_store:read(Store, Path, maps:without([<<"store">>, store], Opts)) of
        {ok, Raw} -> decode_public_comment_index(Raw);
        Raw when is_binary(Raw) -> decode_public_comment_index(Raw);
        _ -> []
    end.

decode_public_comment_index(Raw) when is_binary(Raw) ->
    try hb_json:decode(Raw) of
        IDs when is_list(IDs) -> [ID || ID <- IDs, is_binary(ID), ID =/= <<>>];
        _ -> []
    catch _:_ ->
        []
    end;
decode_public_comment_index(_Raw) ->
    [].

public_comment_record_path(CommentID) ->
    <<"odysee/comment/local/id/", (hb_util:encode(hb_crypto:sha256(CommentID)))/binary>>.

public_comment_list_index_path(Type, Value) ->
    <<"odysee/comment/local/list/", Type/binary, "/", (hb_util:encode(hb_crypto:sha256(Value)))/binary>>.

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

default_state() ->
    #{
        <<"preferences">> => #{},
        <<"settings">> => #{},
        <<"sync">> => #{},
        <<"collections">> => #{},
        <<"comments">> => #{},
        <<"comment-reactions">> => #{},
        <<"comment-settings">> => #{},
        <<"blocked-words">> => [],
        <<"blocks">> => #{},
        <<"delegates">> => #{},
        <<"membership-tiers">> => #{},
        <<"membership-subscriptions">> => #{},
        <<"member-content">> => #{},
        <<"membership-perks">> => []
    }.

response(Result) ->
    Body = #{ <<"result">> => Result },
    (cors_headers())#{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"result">> => Result,
        <<"body">> => hb_json:encode(Body)
    }.

collection_claim(ID, Params, Opts) ->
    Name = value_or(first_field([<<"name">>, <<"title">>], Params, Opts), <<"collection">>),
    Title = value_or(first_field([<<"title">>, <<"name">>], Params, Opts), Name),
    Timestamp = erlang:system_time(second),
    Claims = list_value(first_field([<<"claims">>], Params, Opts)),
    compact(#{
        <<"claim_id">> => ID,
        <<"name">> => Name,
        <<"canonical_url">> => <<"lbry://", Name/binary>>,
        <<"permanent_url">> => <<"lbry://", Name/binary>>,
        <<"short_url">> => <<"lbry://", Name/binary>>,
        <<"value_type">> => <<"collection">>,
        <<"timestamp">> => Timestamp,
        <<"meta">> => #{ <<"creation_timestamp">> => Timestamp },
        <<"value">> => compact(#{
            <<"title">> => Title,
            <<"description">> => first_field([<<"description">>], Params, Opts),
            <<"tags">> => list_value(first_field([<<"tags">>], Params, Opts)),
            <<"thumbnail">> => thumbnail_value(first_field([<<"thumbnail_url">>, <<"thumbnail">>], Params, Opts)),
            <<"claims">> => Claims
        }),
        <<"hyperbeam">> => #{ <<"device">> => ?DEVICE }
    }).

membership_tier(ID, ChannelID, Params, Opts) ->
    Name = value_or(first_field([<<"name">>], Params, Opts), <<"Membership">>),
    compact(#{
        <<"id">> => ID,
        <<"membership_id">> => ID,
        <<"channel_claim_id">> => ChannelID,
        <<"channel_id">> => ChannelID,
        <<"name">> => Name,
        <<"description">> => first_field([<<"description">>], Params, Opts),
        <<"enabled">> => true,
        <<"perks">> => list_value(first_field([<<"perks">>], Params, Opts)),
        <<"prices">> => list_value(first_field([<<"prices">>, <<"price">>], Params, Opts))
    }).

memberships_for_subscriber(ClaimID, Subscriptions, Opts) ->
    Found = [
        Sub
    ||
        Sub <- maps:values(Subscriptions),
        hb_maps:get(<<"subscriber_channel_claim_id">>, Sub, <<>>, Opts) =:= ClaimID
    ],
    case Found of
        [] -> null;
        _ -> Found
    end.

find_tier_channel(ID, Tiers, Opts) ->
    case
        lists:filter(
            fun({_ChannelID, ChannelTiers}) ->
                find_tier(ID, ChannelTiers, Opts) =/= #{}
            end,
            maps:to_list(Tiers)
        )
    of
        [{ChannelID, ChannelTiers} | _] -> {ChannelID, ChannelTiers};
        [] -> {<<"default">>, []}
    end.

find_tier(ID, Tiers, Opts) ->
    case [Tier || Tier <- Tiers, tier_id(Tier, Opts) =:= ID] of
        [Tier | _] -> Tier;
        [] -> #{}
    end.

tier_id(Tier, Opts) ->
    value_or(first_field([<<"membership_id">>, <<"id">>], Tier, Opts), <<>>).

blocked_words(State, Opts) ->
    case hb_maps:get(<<"blocked-words">>, State, [], Opts) of
        Words when is_list(Words) -> Words;
        _ -> []
    end.

section(Key, State, Opts) ->
    case hb_maps:get(Key, State, default_section(Key), Opts) of
        Value when is_map(Value) -> Value;
        Value when is_list(Value) -> Value;
        _ -> default_section(Key)
    end.

default_section(<<"blocked-words">>) -> [];
default_section(<<"membership-perks">>) -> [];
default_section(_Key) -> #{}.

put_section(Key, Value, State) ->
    State#{ Key => Value }.

params(Payload, Opts) ->
    case hb_maps:get(<<"params">>, Payload, #{}, Opts) of
        Params when is_map(Params) -> Params;
        _ -> #{}
    end.

method_name(not_found) ->
    <<>>;
method_name(Value) ->
    Normalized0 = hb_util:to_lower(hb_util:bin(Value)),
    Normalized1 = binary:replace(Normalized0, <<".">>, <<"_">>, [global]),
    Normalized2 = binary:replace(Normalized1, <<"/">>, <<"_">>, [global]),
    binary:replace(Normalized2, <<"-">>, <<"_">>, [global]).

required_param(Key, Params, Opts) ->
    case first_field([Key, dashed_key(Key)], Params, Opts) of
        not_found -> {error, {missing_required_param, Key}};
        <<>> -> {error, {missing_required_param, Key}};
        Value -> {ok, Value}
    end.

dashed_key(Key) when is_binary(Key) ->
    binary:replace(Key, <<"_">>, <<"-">>, [global]).

first_field(Keys, Msg, Opts) when is_map(Msg) ->
    case first_exact_field(Keys, Msg, Opts) of
        not_found -> first_case_insensitive_field(Keys, Msg, Opts);
        Value -> Value
    end;
first_field(_Keys, _Msg, _Opts) ->
    not_found.

first_exact_field([], _Msg, _Opts) ->
    not_found;
first_exact_field([Key | Rest], Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_exact_field(Rest, Msg, Opts);
        Value -> Value
    end.

first_case_insensitive_field(Keys, Msg, Opts) ->
    LowerKeys = [lower_key(Key) || Key <- Keys],
    first_case_insensitive_pair(LowerKeys, hb_maps:to_list(Msg, Opts)).

first_case_insensitive_pair(_Keys, []) ->
    not_found;
first_case_insensitive_pair(Keys, [{Key, Value} | Rest]) ->
    case lists:member(lower_key(Key), Keys) of
        true -> Value;
        false -> first_case_insensitive_pair(Keys, Rest)
    end.

integer_param(Params, Key, Default, Opts) ->
    case first_field([Key], Params, Opts) of
        Int when is_integer(Int) -> Int;
        Bin when is_binary(Bin) ->
            try binary_to_integer(Bin)
            catch _:_ -> Default
            end;
        _ -> Default
    end.

page_items(Items, Page, PageSize) ->
    Start = max(0, (Page - 1) * PageSize),
    lists:sublist(lists:nthtail(min(Start, length(Items)), Items), PageSize).

total_pages(_Total, PageSize) when PageSize =< 0 ->
    1;
total_pages(Total, PageSize) ->
    max(1, (Total + PageSize - 1) div PageSize).

state_hash(Value) ->
    hb_util:encode(hb_crypto:sha256(hb_json:encode(Value))).

generated_id(Type, Owner, Params) ->
    Now = integer_to_binary(erlang:unique_integer([positive, monotonic])),
    hb_util:encode(hb_crypto:sha256(<<Type/binary, ":", Owner/binary, ":", (hb_json:encode(Params))/binary, ":", Now/binary>>)).

compact(Msg) ->
    maps:filter(
        fun(_Key, Value) ->
            Value =/= not_found andalso Value =/= undefined
        end,
        Msg
    ).

without_control_keys(Msg) ->
    Control = control_keys(),
    maps:filter(
        fun(Key, _Value) -> not lists:member(lower_key(Key), Control) end,
        Msg
    ).

control_keys() ->
    [
        <<"!">>,
        <<"accept">>,
        <<"access-token">>,
        <<"access_token">>,
        <<"authorization">>,
        <<"auth-token">>,
        <<"auth_token">>,
        <<"authtoken">>,
        <<"body">>,
        <<"connection">>,
        <<"content-type">>,
        <<"cookie">>,
        <<"device">>,
        <<"host">>,
        <<"method">>,
        <<"params64">>,
        <<"params-64">>,
        <<"path">>,
        <<"priv">>,
        <<"refresh-token">>,
        <<"refresh_token">>,
        <<"user-agent">>,
        <<"x-lbry-auth-token">>,
        <<"x-odysee-auth-token">>
    ].

method(Req, Opts) ->
    hb_util:to_lower(hb_util:bin(hb_maps:get(<<"method">>, Req, <<"GET">>, Opts))).

cors_preflight_response() ->
    (cors_headers())#{
        <<"status">> => 204,
        <<"content-type">> => <<"text/plain">>,
        <<"content-length">> => 0,
        <<"body">> => <<>>
    }.

cors_headers() ->
    #{
        <<"access-control-allow-origin">> => <<"*">>,
        <<"access-control-allow-methods">> => <<"GET,HEAD,POST,OPTIONS">>,
        <<"access-control-allow-headers">> =>
            <<"Range,Content-Type,Accept,Authorization,X-Lbry-Auth-Token">>,
        <<"access-control-expose-headers">> =>
            <<"Content-Length,Content-Range,Accept-Ranges,Location,Content-Digest">>
    }.

csv(not_found) ->
    [];
csv(Value) when is_list(Value) ->
    Value;
csv(Value) when is_binary(Value) ->
    [Part || Part <- binary:split(Value, <<",">>, [global]), Part =/= <<>>];
csv(Value) ->
    [Value].

list_value(not_found) ->
    [];
list_value(Value) when is_list(Value) ->
    Value;
list_value(Value) when is_binary(Value) ->
    case binary:split(Value, <<",">>, [global]) of
        [Value] -> [Value];
        Parts -> [Part || Part <- Parts, Part =/= <<>>]
    end;
list_value(Value) ->
    [Value].

thumbnail_value(not_found) ->
    #{};
thumbnail_value(#{ <<"url">> := _ } = Thumbnail) ->
    Thumbnail;
thumbnail_value(URL) when is_binary(URL) ->
    #{ <<"url">> => URL };
thumbnail_value(_Value) ->
    #{}.

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

lower_key(Key) when is_binary(Key) ->
    hb_util:to_lower(Key);
lower_key(Key) ->
    hb_util:to_lower(hb_ao:normalize_key(Key)).

-ifdef(TEST).

preference_roundtrip_test() ->
    Opts = test_opts(),
    Req1 = signed_call(#{ <<"kind">> => <<"sdk">>, <<"method">> => <<"preference_set">>, <<"params">> => #{ <<"key">> => <<"shared">>, <<"value">> => <<"v1">> } }, Opts),
    {ok, Res1} = call(#{}, Req1, Opts),
    ?assertEqual(<<"v1">>, hb_maps:get(<<"shared">>, hb_maps:get(<<"result">>, Res1, Opts), Opts)),
    Req2 = signed_call(#{ <<"kind">> => <<"sdk">>, <<"method">> => <<"preference_get">>, <<"params">> => #{ <<"key">> => <<"shared">> } }, Opts),
    {ok, Res2} = call(#{}, Req2, Opts),
    ?assertEqual(<<"v1">>, hb_maps:get(<<"shared">>, hb_maps:get(<<"result">>, Res2, Opts), Opts)).

account_read_migration_filters_sensitive_fields_test() ->
    Opts = test_opts(),
    State0 = default_state(),
    Backend = #{
        <<"shared">> => <<"v1">>,
        <<"email">> => <<"person@example.com">>,
        <<"auth_token">> => <<"secret">>
    },
    {Result, State1} = account_result(<<"preference_get">>, #{}, Backend, #{}, State0, Opts),
    Preferences = section(<<"preferences">>, State1, Opts),
    ?assertEqual(Backend, Result),
    ?assertEqual(<<"v1">>, hb_maps:get(<<"shared">>, Preferences, Opts)),
    ?assertEqual(not_found, hb_maps:get(<<"email">>, Preferences, not_found, Opts)),
    ?assertEqual(not_found, hb_maps:get(<<"auth_token">>, Preferences, not_found, Opts)).

comment_create_edit_abandon_test() ->
    Opts = test_opts(),
    CreateReq = signed_call(
        #{
            <<"kind">> => <<"comment">>,
            <<"method">> => <<"comment.Create">>,
            <<"params">> => #{
                <<"claim_id">> => <<"claim-1">>,
                <<"comment">> => <<"hello">>,
                <<"channel_id">> => <<"chan-1">>,
                <<"channel_name">> => <<"@chan">>,
                <<"channel_url">> => <<"lbry://@chan#chan-1">>
            }
        },
        Opts
    ),
    {ok, CreateRes} = call(#{}, CreateReq, Opts),
    Comment = hb_maps:get(<<"result">>, CreateRes, Opts),
    CommentID = hb_maps:get(<<"comment_id">>, Comment, Opts),
    ?assertEqual(<<"hello">>, hb_maps:get(<<"comment">>, Comment, Opts)),
    ListReq = signed_call(
        #{
            <<"kind">> => <<"comment">>,
            <<"method">> => <<"comment.List">>,
            <<"params">> => #{ <<"claim_id">> => <<"claim-1">>, <<"top_level">> => true }
        },
        Opts
    ),
    {ok, ListRes} = call(#{}, ListReq, Opts),
    List = hb_maps:get(<<"result">>, ListRes, Opts),
    [ListedComment] = hb_maps:get(<<"items">>, List, Opts),
    ?assertEqual(1, hb_maps:get(<<"total_items">>, List, Opts)),
    ?assertEqual(CommentID, hb_maps:get(<<"comment_id">>, ListedComment, Opts)),
    ByIDReq = signed_call(
        #{
            <<"kind">> => <<"comment">>,
            <<"method">> => <<"comment.ByID">>,
            <<"params">> => #{ <<"comment_id">> => CommentID, <<"with_ancestors">> => true }
        },
        Opts
    ),
    {ok, ByIDRes} = call(#{}, ByIDReq, Opts),
    ?assertEqual(CommentID, hb_maps:get(<<"comment_id">>, hb_maps:get(<<"item">>, hb_maps:get(<<"result">>, ByIDRes, Opts), Opts), Opts)),
    case erlang:function_exported(dev_odysee_comment, list, 3) of
        true ->
            {ok, PublicListRes} = dev_odysee_comment:list(
                #{},
                #{
                    <<"claim_id">> => <<"claim-1">>,
                    <<"top_level">> => true,
                    <<"comment-url">> => <<"http://127.0.0.1:1">>
                },
                Opts
            ),
            [PublicComment] = hb_maps:get(<<"comments">>, PublicListRes, Opts),
            ?assertEqual(CommentID, hb_maps:get(<<"comment-id">>, PublicComment, Opts)),
            ?assertEqual(<<"lbry://@chan#chan-1">>, hb_maps:get(<<"channel-url">>, PublicComment, Opts)),
            {ok, PublicByIDRes} = dev_odysee_comment:by_id(#{}, #{ <<"comment_id">> => CommentID }, Opts),
            ?assertEqual(CommentID, hb_maps:get(<<"comment-id">>, PublicByIDRes, Opts));
        false ->
            ok
    end,
    EditReq = signed_call(
        #{
            <<"kind">> => <<"comment">>,
            <<"method">> => <<"comment.Edit">>,
            <<"params">> => #{ <<"comment_id">> => CommentID, <<"comment">> => <<"edited">> }
        },
        Opts
    ),
    {ok, EditRes} = call(#{}, EditReq, Opts),
    ?assertEqual(<<"edited">>, hb_maps:get(<<"comment">>, hb_maps:get(<<"result">>, EditRes, Opts), Opts)),
    DeleteReq = signed_call(
        #{
            <<"kind">> => <<"comment">>,
            <<"method">> => <<"comment.Abandon">>,
            <<"params">> => #{ <<"comment_id">> => CommentID }
        },
        Opts
    ),
    {ok, DeleteRes} = call(#{}, DeleteReq, Opts),
    ?assertEqual(true, hb_maps:get(<<"abandoned">>, hb_maps:get(<<"result">>, DeleteRes, Opts), Opts)).

collection_and_membership_state_test() ->
    Opts = test_opts(),
    CollectionReq = signed_call(
        #{
            <<"kind">> => <<"sdk">>,
            <<"method">> => <<"collection_create">>,
            <<"params">> => #{ <<"name">> => <<"my-list">>, <<"claims">> => [<<"claim-a">>] }
        },
        Opts
    ),
    {ok, CollectionRes} = call(#{}, CollectionReq, Opts),
    Collection = hb_maps:get(<<"result">>, CollectionRes, Opts),
    ?assertEqual(<<"collection">>, hb_maps:get(<<"value_type">>, Collection, Opts)),
    TierReq = signed_call(
        #{
            <<"kind">> => <<"lbryio">>,
            <<"resource">> => <<"membership_v2">>,
            <<"action">> => <<"create">>,
            <<"params">> => #{ <<"channel_claim_id">> => <<"chan-1">>, <<"name">> => <<"Gold">> }
        },
        Opts
    ),
    {ok, TierRes} = call(#{}, TierReq, Opts),
    Tier = hb_maps:get(<<"result">>, TierRes, Opts),
    ?assertEqual(<<"Gold">>, hb_maps:get(<<"name">>, Tier, Opts)),
    ListReq = signed_call(
        #{
            <<"kind">> => <<"lbryio">>,
            <<"resource">> => <<"membership_v2">>,
            <<"action">> => <<"list">>,
            <<"params">> => #{ <<"channel_claim_id">> => <<"chan-1">> }
        },
        Opts
    ),
    {ok, ListRes} = call(#{}, ListReq, Opts),
    ?assertEqual(1, length(hb_maps:get(<<"result">>, ListRes, Opts))).

call_requires_signed_request_test() ->
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        call(#{}, #{ <<"kind">> => <<"sdk">> }, test_opts())
    ).

signed_call(Payload, Opts) ->
    hb_message:commit(
        #{ <<"params64">> => hb_util:encode(hb_json:encode(Payload)) },
        Opts#{ <<"priv-wallet">> => hb_opts:get(<<"priv-wallet">>, ar_wallet:new(), Opts) }
    ).

test_opts() ->
    Timestamp = integer_to_binary(erlang:unique_integer([positive, monotonic])),
    Store = #{
        <<"store-module">> => hb_store_fs,
        <<"name">> => <<"_build/odysee-user-state-test-", Timestamp/binary>>
    },
    ok = hb_store:start(Store),
    ok = hb_store:reset(Store),
    #{
        <<"store">> => Store,
        <<"priv-wallet">> => ar_wallet:new(),
        <<"odysee-comment-write-through">> => false,
        <<"cache-control">> => [<<"no-cache">>, <<"no-store">>],
        <<"store-all-signed">> => false
    }.

-endif.
