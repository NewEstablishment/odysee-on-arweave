-module(dev_odysee_user_state).
-implements(<<"odysee-user-state@1.0">>).
-export([info/1, call/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-user-state@1.0">>).

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
                    {ok, Payload} ?= request_payload(Req, Opts),
                    {ok, State0} ?= read_state(Owner, Opts),
                    {ok, Result, State1} ?= dispatch(Owner, Payload, State0, Opts),
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
            case hb_message:verify(Req, signers, Opts) of
                true -> {ok, hd(Signers)};
                _ ->
                    {error, #{
                        <<"status">> => 401,
                        <<"body">> => <<"Invalid request signature.">>
                    }}
            end
    end.

request_signers(Req, Opts) ->
    lists:usort(signers(Req, Opts)).

signers(Msg, Opts) when is_map(Msg) ->
    try hb_message:signers(Msg, Opts)
    catch _:_ -> []
    end;
signers(_Msg, _Opts) ->
    [].

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

dispatch(Owner, Payload, State, Opts) ->
    Kind = hb_util:to_lower(hb_util:bin(first_field([<<"kind">>], Payload, Opts))),
    case Kind of
        <<"sdk">> -> sdk_call(Owner, Payload, State, Opts);
        <<"comment">> -> comment_call(Owner, Payload, State, Opts);
        <<"lbryio">> -> lbryio_call(Owner, Payload, State, Opts);
        _ -> {error, unsupported_user_state_kind}
    end.

sdk_call(Owner, Payload, State, Opts) ->
    Method = method_name(first_field([<<"method">>], Payload, Opts)),
    Params = params(Payload, Opts),
    case Method of
        <<"preference_get">> -> preference_get(Params, State, Opts);
        <<"preference_set">> -> preference_set(Params, State, Opts);
        <<"settings_get">> -> settings_get(State);
        <<"settings_set">> -> settings_set(Params, State, Opts);
        <<"settings_clear">> -> settings_clear(Params, State, Opts);
        <<"sync_hash">> -> sync_hash(State, Opts);
        <<"sync_apply">> -> sync_apply(Params, State, Opts);
        <<"channel_sign">> -> channel_sign(Owner, Params, State, Opts);
        <<"collection_list">> -> collection_list(Params, State, Opts);
        <<"collection_create">> -> collection_create(Owner, Params, State, Opts);
        <<"collection_update">> -> collection_update(Owner, Params, State, Opts);
        _ -> {error, #{ <<"status">> => 501, <<"body">> => <<"Unsupported SDK method.">> }}
    end.

comment_call(Owner, Payload, State, Opts) ->
    Method = method_name(first_field([<<"method">>], Payload, Opts)),
    Params = params(Payload, Opts),
    case Method of
        <<"comment_create">> -> comment_create(Owner, Params, State, Opts);
        <<"comment_edit">> -> comment_edit(Params, State, Opts);
        <<"comment_abandon">> -> comment_abandon(Params, State, Opts);
        <<"comment_pin">> -> comment_pin(Params, State, Opts);
        <<"reaction_react">> -> reaction_react(Params, State, Opts);
        <<"setting_get">> -> comment_setting_get(Params, State, Opts);
        <<"setting_list">> -> comment_setting_list(State);
        <<"setting_update">> -> comment_setting_update(Params, State, Opts);
        <<"setting_block_word">> -> comment_block_word(Params, State, Opts);
        <<"setting_blockword">> -> comment_block_word(Params, State, Opts);
        <<"setting_unblock_word">> -> comment_unblock_word(Params, State, Opts);
        <<"setting_unblockword">> -> comment_unblock_word(Params, State, Opts);
        <<"setting_list_blocked_words">> -> comment_list_blocked_words(State, Opts);
        <<"setting_listblockedwords">> -> comment_list_blocked_words(State, Opts);
        <<"moderation_block">> -> moderation_put(<<"blocks">>, Params, State, Opts);
        <<"moderation_unblock">> -> moderation_remove(<<"blocks">>, Params, State, Opts);
        <<"moderation_blockedlist">> -> moderation_list(<<"blocks">>, State, Opts);
        <<"moderation_add_delegate">> -> moderation_put(<<"delegates">>, Params, State, Opts);
        <<"moderation_adddelegate">> -> moderation_put(<<"delegates">>, Params, State, Opts);
        <<"moderation_remove_delegate">> -> moderation_remove(<<"delegates">>, Params, State, Opts);
        <<"moderation_removedelegate">> -> moderation_remove(<<"delegates">>, Params, State, Opts);
        <<"moderation_blocked_list">> -> moderation_list(<<"blocks">>, State, Opts);
        <<"moderation_list_delegates">> -> moderation_list(<<"delegates">>, State, Opts);
        <<"moderation_listdelegates">> -> moderation_list(<<"delegates">>, State, Opts);
        <<"moderation_am_i">> -> {ok, #{ <<"is_moderator">> => false }, State};
        <<"moderation_ami">> -> {ok, #{ <<"is_moderator">> => false }, State};
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

preference_get(Params, State, Opts) ->
    Preferences = section(<<"preferences">>, State, Opts),
    case first_field([<<"key">>], Params, Opts) of
        not_found -> {ok, Preferences, State};
        Key -> {ok, #{ Key => hb_maps:get(Key, Preferences, null, Opts) }, State}
    end.

preference_set(Params, State, Opts) ->
    maybe
        {ok, Key} ?= required_param(<<"key">>, Params, Opts),
        Value = hb_maps:get(<<"value">>, Params, null, Opts),
        Preferences = section(<<"preferences">>, State, Opts),
        Next = put_section(<<"preferences">>, Preferences#{ Key => Value }, State),
        {ok, #{ Key => Value }, Next}
    end.

settings_get(State) ->
    {ok, section(<<"settings">>, State, #{}), State}.

settings_set(Params, State, Opts) ->
    Settings = section(<<"settings">>, State, Opts),
    case first_field([<<"key">>], Params, Opts) of
        not_found ->
            NextSettings = maps:merge(Settings, without_control_keys(Params)),
            {ok, NextSettings, put_section(<<"settings">>, NextSettings, State)};
        Key ->
            Value = hb_maps:get(<<"value">>, Params, null, Opts),
            NextSettings = Settings#{ Key => Value },
            {ok, #{ Key => Value }, put_section(<<"settings">>, NextSettings, State)}
    end.

settings_clear(Params, State, Opts) ->
    Settings = section(<<"settings">>, State, Opts),
    case first_field([<<"key">>], Params, Opts) of
        not_found -> {ok, Settings, State};
        Key ->
            NextSettings = maps:remove(Key, Settings),
            {ok, NextSettings, put_section(<<"settings">>, NextSettings, State)}
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

comment_create(Owner, Params, State, Opts) ->
    maybe
        {ok, ClaimID} ?= required_param(<<"claim_id">>, Params, Opts),
        CommentID = generated_id(<<"comment">>, Owner, Params),
        Timestamp = erlang:system_time(second),
        Comment = compact(#{
            <<"comment_id">> => CommentID,
            <<"id">> => CommentID,
            <<"claim_id">> => ClaimID,
            <<"comment">> => value_or(first_field([<<"comment">>, <<"body">>], Params, Opts), <<>>),
            <<"parent_id">> => first_field([<<"parent_id">>, <<"parent-id">>], Params, Opts),
            <<"channel_id">> => first_field([<<"channel_id">>, <<"channel-id">>], Params, Opts),
            <<"channel_name">> => first_field([<<"channel_name">>, <<"channel-name">>], Params, Opts),
            <<"signature">> => first_field([<<"signature">>], Params, Opts),
            <<"signing_ts">> => first_field([<<"signing_ts">>, <<"signing-ts">>], Params, Opts),
            <<"timestamp">> => Timestamp,
            <<"updated_at">> => Timestamp,
            <<"hyperbeam_owner">> => Owner
        }),
        Comments = section(<<"comments">>, State, Opts),
        Next = put_section(<<"comments">>, Comments#{ CommentID => Comment }, State),
        {ok, Comment, Next}
    end.

comment_edit(Params, State, Opts) ->
    maybe
        {ok, CommentID} ?= required_param(<<"comment_id">>, Params, Opts),
        Comments = section(<<"comments">>, State, Opts),
        Existing = hb_maps:get(CommentID, Comments, #{ <<"comment_id">> => CommentID }, Opts),
        Comment = Existing#{
            <<"comment">> => value_or(first_field([<<"comment">>, <<"body">>], Params, Opts), <<>>),
            <<"updated_at">> => erlang:system_time(second),
            <<"signature">> => first_field([<<"signature">>], Params, Opts),
            <<"signing_ts">> => first_field([<<"signing_ts">>, <<"signing-ts">>], Params, Opts)
        },
        Next = put_section(<<"comments">>, Comments#{ CommentID => compact(Comment) }, State),
        {ok, compact(Comment), Next}
    end.

comment_abandon(Params, State, Opts) ->
    maybe
        {ok, CommentID} ?= required_param(<<"comment_id">>, Params, Opts),
        Comments = section(<<"comments">>, State, Opts),
        Existing = hb_maps:get(CommentID, Comments, #{ <<"comment_id">> => CommentID }, Opts),
        Comment = compact(Existing#{
            <<"comment_id">> => CommentID,
            <<"removed">> => true,
            <<"abandoned">> => true,
            <<"updated_at">> => erlang:system_time(second)
        }),
        Next = put_section(<<"comments">>, Comments#{ CommentID => Comment }, State),
        {ok, #{ <<"abandoned">> => true, <<"claim_id">> => hb_maps:get(<<"claim_id">>, Comment, <<>>, Opts) }, Next}
    end.

comment_pin(Params, State, Opts) ->
    maybe
        {ok, CommentID} ?= required_param(<<"comment_id">>, Params, Opts),
        Comments = section(<<"comments">>, State, Opts),
        Existing = hb_maps:get(CommentID, Comments, #{ <<"comment_id">> => CommentID }, Opts),
        Remove = truthy(hb_maps:get(<<"remove">>, Params, false, Opts)),
        Comment = compact(Existing#{
            <<"comment_id">> => CommentID,
            <<"is_pinned">> => not Remove,
            <<"updated_at">> => erlang:system_time(second)
        }),
        Next = put_section(<<"comments">>, Comments#{ CommentID => Comment }, State),
        {ok, #{ <<"items">> => [Comment] }, Next}
    end.

reaction_react(Params, State, Opts) ->
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
    {ok, #{ <<"ok">> => true }, put_section(<<"comment-reactions">>, Reactions, State)}.

comment_setting_get(Params, State, Opts) ->
    Settings = section(<<"comment-settings">>, State, Opts),
    ChannelID = first_field([<<"channel_id">>, <<"channel-id">>], Params, Opts),
    {ok, hb_maps:get(ChannelID, Settings, #{}, Opts), State}.

comment_setting_list(State) ->
    {ok, maps:values(section(<<"comment-settings">>, State, #{})), State}.

comment_setting_update(Params, State, Opts) ->
    maybe
        {ok, ChannelID} ?= required_param(<<"channel_id">>, Params, Opts),
        Settings = section(<<"comment-settings">>, State, Opts),
        Existing = hb_maps:get(ChannelID, Settings, #{}, Opts),
        Updated = maps:merge(Existing, without_control_keys(Params)),
        {ok, Updated, put_section(<<"comment-settings">>, Settings#{ ChannelID => Updated }, State)}
    end.

comment_block_word(Params, State, Opts) ->
    Word = value_or(first_field([<<"word">>, <<"blocked_word">>, <<"blocked-word">>], Params, Opts), <<>>),
    Words = lists:usort([Word | blocked_words(State, Opts)]),
    Next = put_section(<<"blocked-words">>, Words, State),
    {ok, Words, Next}.

comment_unblock_word(Params, State, Opts) ->
    Word = value_or(first_field([<<"word">>, <<"blocked_word">>, <<"blocked-word">>], Params, Opts), <<>>),
    Words = [W || W <- blocked_words(State, Opts), W =/= Word],
    Next = put_section(<<"blocked-words">>, Words, State),
    {ok, Words, Next}.

comment_list_blocked_words(State, Opts) ->
    {ok, blocked_words(State, Opts), State}.

moderation_put(Section, Params, State, Opts) ->
    ID = value_or(first_field([<<"blocked_channel_id">>, <<"delegate_channel_id">>, <<"channel_id">>], Params, Opts), generated_id(Section, <<"moderation">>, Params)),
    Items = section(Section, State, Opts),
    Updated = Items#{ ID => without_control_keys(Params) },
    {ok, maps:values(Updated), put_section(Section, Updated, State)}.

moderation_remove(Section, Params, State, Opts) ->
    ID = value_or(first_field([<<"blocked_channel_id">>, <<"delegate_channel_id">>, <<"channel_id">>], Params, Opts), <<>>),
    Items = maps:remove(ID, section(Section, State, Opts)),
    {ok, maps:values(Items), put_section(Section, Items, State)}.

moderation_list(Section, State, Opts) ->
    {ok, maps:values(section(Section, State, Opts)), State}.

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
        <<"authorization">>,
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
        <<"user-agent">>,
        <<"x-lbry-auth-token">>
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
                <<"channel_name">> => <<"@chan">>
            }
        },
        Opts
    ),
    {ok, CreateRes} = call(#{}, CreateReq, Opts),
    Comment = hb_maps:get(<<"result">>, CreateRes, Opts),
    CommentID = hb_maps:get(<<"comment_id">>, Comment, Opts),
    ?assertEqual(<<"hello">>, hb_maps:get(<<"comment">>, Comment, Opts)),
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
        Opts#{ <<"priv-wallet">> => ar_wallet:new() }
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
        <<"cache-control">> => [<<"no-cache">>, <<"no-store">>],
        <<"store-all-signed">> => false
    }.

-endif.
