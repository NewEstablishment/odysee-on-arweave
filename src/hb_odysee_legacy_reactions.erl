%%% @doc Imports authoritative legacy reaction rows as generic committed messages.
%%%
%%% This is an operator tool, not a device. Raw legacy user IDs are converted
%%% to stable HMAC references before any message or checkpoint is persisted.
%%% A full export plus the previous checkpoint produces append-only changes and
%%% one compact, node-signed summary for each affected target.
-module(hb_odysee_legacy_reactions).

-export([import_file/3, import_file/4, plan/3]).

-define(RECORD_SCHEMA, <<"odysee-legacy-reaction@1.0">>).
-define(RECORD_TYPE, <<"legacy-reaction">>).
-define(RECORD_SCOPE, <<"legacy-reaction-v1">>).
-define(SUMMARY_SCHEMA, <<"odysee-legacy-reaction-summary@1.0">>).
-define(SUMMARY_TYPE, <<"legacy-reaction-summary">>).
-define(SUMMARY_SCOPE, <<"legacy-reaction-summary-v1">>).

import_file(InputPath, SecretPath, CheckpointPath) ->
    case node_opts() of
        {ok, Opts} -> import_file(InputPath, SecretPath, CheckpointPath, Opts);
        Error -> Error
    end.

import_file(InputPath, SecretPath, CheckpointPath, Opts) ->
    maybe
        {ok, InputBytes} ?= file:read_file(InputPath),
        {ok, SecretBytes} ?= file:read_file(SecretPath),
        Secret = string:trim(SecretBytes),
        true ?= byte_size(Secret) >= 32,
        {ok, Previous} ?= read_checkpoint(CheckpointPath),
        {ok, Planned} ?= plan(hb_json:decode(InputBytes), Secret, Previous),
        ok ?= write_messages(maps:get(<<"messages">>, Planned), Opts),
        ok ?= write_checkpoint(CheckpointPath, maps:get(<<"checkpoint">>, Planned)),
        {ok, maps:without([<<"messages">>, <<"checkpoint">>], Planned)}
    else
        false -> {error, identity_secret_too_short};
        {error, _} = Error -> Error;
        Other -> {error, {legacy_reaction_import_failed, Other}}
    end.

plan(Input, Secret, Previous) when is_map(Input), is_binary(Secret), is_map(Previous) ->
    try
        SnapshotAt = positive_int(value(Input, [<<"snapshot-at">>, <<"snapshot_at">>])),
        Source = bounded_binary(value(Input, [<<"source">>], <<"legacy-odysee-db">>), 128),
        Rows0 = value(Input, [<<"reactions">>, <<"rows">>], []),
        true = is_list(Rows0),
        PreviousRecords = value(Previous, [<<"records">>], #{}),
        true = is_map(PreviousRecords),
        PreviousSnapshotAt = non_negative_int(value(Previous, [<<"snapshot-at">>, <<"snapshot_at">>], 0)),
        ok = ensure_snapshot_order(SnapshotAt, PreviousSnapshotAt),
        OwnerMappings = checkpoint_owner_mappings(PreviousRecords),
        Rows = normalize_rows(Rows0, Secret, SnapshotAt, OwnerMappings),
        Current = maps:from_list([{maps:get(<<"key">>, Row), Row} || Row <- Rows]),
        true = map_size(Current) =:= length(Rows),
        {RecordMessages, NextRecords, Affected} = record_changes(Current, PreviousRecords, SnapshotAt, Source),
        ok = ensure_same_snapshot_is_unchanged(SnapshotAt, PreviousSnapshotAt, RecordMessages),
        SummaryMessages = summary_messages(Current, Affected, SnapshotAt, Source),
        Messages = RecordMessages ++ SummaryMessages,
        {ok, #{
            <<"messages">> => Messages,
            <<"checkpoint">> => #{<<"snapshot-at">> => SnapshotAt, <<"records">> => NextRecords},
            <<"snapshot-at">> => SnapshotAt,
            <<"record-messages">> => length(RecordMessages),
            <<"summary-messages">> => length(SummaryMessages),
            <<"active-records">> => map_size(Current)
        }}
    catch
        error:{badmatch, false} -> {error, invalid_or_duplicate_rows};
        error:Reason -> {error, Reason}
    end;
plan(_, _, _) ->
    {error, invalid_input}.

ensure_snapshot_order(SnapshotAt, PreviousSnapshotAt) when SnapshotAt >= PreviousSnapshotAt -> ok;
ensure_snapshot_order(_, _) -> error(stale_snapshot).

ensure_same_snapshot_is_unchanged(SnapshotAt, SnapshotAt, [_ | _]) -> error(conflicting_snapshot_timestamp);
ensure_same_snapshot_is_unchanged(_, _, _) -> ok.

checkpoint_owner_mappings(Records) ->
    maps:fold(
        fun(_Key, Record, Mappings) when is_map(Record) ->
            UserRef = opaque_ref(value(Record, [<<"legacy-user-ref">>, <<"legacy_user_ref">>])),
            Owner = optional_owner(value(Record, [<<"native-owner">>, <<"native_owner">>], undefined)),
            enforce_owner_mapping(Owner, UserRef, Mappings);
           (_Key, _Record, _Mappings) ->
            error(invalid_checkpoint)
        end,
        #{},
        Records
    ).

normalize_rows(Rows, Secret, SnapshotAt, InitialMappings) ->
    OwnerMappings = lists:foldl(
        fun(Row, Mappings) -> collect_owner_mapping(Row, Secret, Mappings) end,
        InitialMappings,
        Rows
    ),
    [normalize_row(Row, Secret, SnapshotAt, OwnerMappings) || Row <- Rows].

collect_owner_mapping(Row, Secret, Mappings) when is_map(Row) ->
    UserRef = row_user_ref(Row, Secret),
    Owner = optional_owner(value(Row, [<<"native-owner">>, <<"native_owner">>], undefined)),
    enforce_owner_mapping(Owner, UserRef, Mappings);
collect_owner_mapping(_, _, _) ->
    error(invalid_row).

normalize_row(Row, Secret, SnapshotAt, OwnerMappings) when is_map(Row) ->
    UserRef = row_user_ref(Row, Secret),
    Target = bounded_binary(value(Row, [<<"target">>, <<"claim-id">>, <<"claim_id">>]), 1024),
    Subject = enum(value(Row, [<<"subject">>], <<"content">>), [<<"content">>, <<"comment">>]),
    Reaction = enum(value(Row, [<<"reaction">>, <<"type">>]), [<<"like">>, <<"dislike">>]),
    UpdatedAt = non_negative_int(value(Row, [<<"updated-at">>, <<"updated_at">>], SnapshotAt)),
    true = UpdatedAt =< SnapshotAt,
    ExplicitOwner = optional_owner(value(Row, [<<"native-owner">>, <<"native_owner">>], undefined)),
    NativeOwner = case ExplicitOwner of
        undefined -> maps:get({user, UserRef}, OwnerMappings, undefined);
        _ -> ExplicitOwner
    end,
    Key = digest_ref([Subject, Target, UserRef]),
    compact(#{
        <<"key">> => Key,
        <<"legacy-user-ref">> => UserRef,
        <<"target">> => Target,
        <<"subject">> => Subject,
        <<"reaction">> => Reaction,
        <<"native-owner">> => NativeOwner,
        <<"updated-at">> => UpdatedAt
    });
normalize_row(_, _, _, _) ->
    error(invalid_row).

row_user_ref(Row, Secret) ->
    UserID = bounded_binary(value(Row, [<<"user-id">>, <<"user_id">>]), 256),
    user_ref(UserID, Secret).

enforce_owner_mapping(undefined, _UserRef, Mappings) ->
    Mappings;
enforce_owner_mapping(Owner, UserRef, Mappings) ->
    case {
        maps:get({owner, Owner}, Mappings, UserRef),
        maps:get({user, UserRef}, Mappings, Owner)
    } of
        {UserRef, Owner} -> Mappings#{{owner, Owner} => UserRef, {user, UserRef} => Owner};
        _ -> error(conflicting_native_owner_mapping)
    end.

record_changes(Current, Previous, SnapshotAt, Source) ->
    {ActiveMessages, ActiveRecords, ActiveAffected} = maps:fold(
        fun(Key, Row, {Messages, Records, Affected}) ->
            case maps:get(Key, Previous, undefined) of
                undefined ->
                    Entry = next_entry(Row, undefined, <<"active">>, SnapshotAt),
                    {[record_message(Entry, Source) | Messages], Records#{Key => Entry}, add_target(Row, Affected)};
                Prior ->
                    case same_active_state(Row, Prior) of
                        true -> {Messages, Records#{Key => Prior}, Affected};
                        false ->
                            Entry = next_entry(Row, Prior, <<"active">>, SnapshotAt),
                            {[record_message(Entry, Source) | Messages], Records#{Key => Entry}, add_target(Row, Affected)}
                    end
            end
        end,
        {[], #{}, #{}},
        Current
    ),
    maps:fold(
        fun(Key, Prior, {Messages, Records, Affected}) ->
            case maps:is_key(Key, Current) of
                true -> {Messages, Records, Affected};
                false ->
                    case maps:get(<<"state">>, Prior, <<"active">>) of
                        <<"removed">> -> {Messages, Records#{Key => Prior}, Affected};
                        _ ->
                            Entry = next_entry(Prior, Prior, <<"removed">>, SnapshotAt),
                            {[record_message(Entry, Source) | Messages], Records#{Key => Entry}, add_target(Prior, Affected)}
                    end
            end
        end,
        {lists:reverse(ActiveMessages), ActiveRecords, ActiveAffected},
        Previous
    ).

same_active_state(Row, Prior) ->
    maps:get(<<"state">>, Prior, <<"active">>) =:= <<"active">> andalso
        maps:get(<<"reaction">>, Row) =:= maps:get(<<"reaction">>, Prior) andalso
        maps:get(<<"native-owner">>, Row, undefined) =:= maps:get(<<"native-owner">>, Prior, undefined).

next_entry(Row, undefined, State, SnapshotAt) ->
    ReactionRef = digest_ref([<<"reaction">>, maps:get(<<"key">>, Row)]),
    with_version(Row#{
        <<"reaction-ref">> => ReactionRef,
        <<"revision">> => 0,
        <<"state">> => State,
        <<"event-timestamp">> => maps:get(<<"updated-at">>, Row, SnapshotAt)
    }, SnapshotAt);
next_entry(Row, Prior, State, SnapshotAt) ->
    with_version(Row#{
        <<"reaction-ref">> => maps:get(<<"reaction-ref">>, Prior),
        <<"revision">> => maps:get(<<"revision">>, Prior) + 1,
        <<"revision-of">> => maps:get(<<"reaction-ref">>, Prior),
        <<"previous-version">> => maps:get(<<"version-ref">>, Prior),
        <<"state">> => State,
        <<"event-timestamp">> => case State of
            <<"removed">> -> SnapshotAt;
            _ -> maps:get(<<"updated-at">>, Row, SnapshotAt)
        end
    }, SnapshotAt).

with_version(Entry, SnapshotAt) ->
    Version = digest_ref([
        maps:get(<<"key">>, Entry),
        integer_to_binary(maps:get(<<"revision">>, Entry)),
        maps:get(<<"reaction">>, Entry),
        maps:get(<<"state">>, Entry),
        integer_to_binary(maps:get(<<"event-timestamp">>, Entry)),
        integer_to_binary(SnapshotAt),
        maps:get(<<"native-owner">>, Entry, <<>>)
    ]),
    Entry#{<<"version-ref">> => Version}.

record_message(Entry, Source) ->
    compact(maps:merge(
        maps:with([
            <<"legacy-user-ref">>, <<"target">>, <<"subject">>, <<"reaction">>,
            <<"native-owner">>, <<"reaction-ref">>, <<"version-ref">>,
            <<"revision-of">>, <<"previous-version">>, <<"revision">>,
            <<"state">>, <<"event-timestamp">>
        ], Entry),
        #{
            <<"schema">> => ?RECORD_SCHEMA,
            <<"type">> => ?RECORD_TYPE,
            <<"operation">> => case maps:get(<<"state">>, Entry) of
                <<"active">> -> <<"set">>;
                <<"removed">> -> <<"remove">>
            end,
            <<"source">> => Source,
            <<"signature-scope">> => ?RECORD_SCOPE
        }
    )).

summary_messages(Current, Affected, SnapshotAt, Source) ->
    lists:map(
        fun({Subject, Target}) ->
            Rows = lists:sort(fun(A, B) -> maps:get(<<"key">>, A) =< maps:get(<<"key">>, B) end, [
                Row
             || Row <- maps:values(Current),
                maps:get(<<"subject">>, Row) =:= Subject,
                maps:get(<<"target">>, Row) =:= Target
            ]),
            Like = length([ok || Row <- Rows, maps:get(<<"reaction">>, Row) =:= <<"like">>]),
            Dislike = length(Rows) - Like,
            Linked = [
                #{<<"owner">> => Owner, <<"reaction">> => maps:get(<<"reaction">>, Row)}
             || Row <- Rows,
                Owner <- [maps:get(<<"native-owner">>, Row, undefined)],
                Owner =/= undefined
            ],
            #{
                <<"schema">> => ?SUMMARY_SCHEMA,
                <<"type">> => ?SUMMARY_TYPE,
                <<"target">> => Target,
                <<"subject">> => Subject,
                <<"like">> => Like,
                <<"dislike">> => Dislike,
                <<"linked-reactions">> => Linked,
                <<"snapshot-at">> => SnapshotAt,
                <<"source">> => Source,
                <<"signature-scope">> => ?SUMMARY_SCOPE
            }
        end,
        lists:sort(maps:keys(Affected))
    ).

add_target(Row, Targets) ->
    Targets#{{maps:get(<<"subject">>, Row), maps:get(<<"target">>, Row)} => true}.

write_messages([], _Opts) -> ok;
write_messages([Message | Rest], Opts) ->
    Signed = hb_message:commit(Message, Opts),
    case hb_cache:write(Signed, Opts) of
        {ok, _} -> write_messages(Rest, Opts);
        Error -> Error
    end.

read_checkpoint(Path) ->
    case file:read_file(Path) of
        {ok, Bytes} ->
            try {ok, hb_json:decode(Bytes)} catch _:_ -> {error, invalid_checkpoint} end;
        {error, enoent} -> {ok, #{<<"records">> => #{}}};
        Error -> Error
    end.

write_checkpoint(Path, Checkpoint) ->
    ok = filelib:ensure_dir(Path),
    Temp = <<(iolist_to_binary(Path))/binary, ".tmp">>,
    case file:write_file(Temp, hb_json:encode(Checkpoint), [binary, sync]) of
        ok -> file:rename(Temp, Path);
        Error -> Error
    end.

node_opts() ->
    try
        Env = hb_opts:default_message_with_env(),
        ConfigPath = hb_opts:get(hb_config_location, <<"config.flat">>, Env),
        {ok, Config} = hb_opts:load(ConfigPath, Env),
        KeyPath = hb_opts:get(priv_key_location, <<"hyperbeam-key.json">>, Config),
        Wallet = hb:wallet(KeyPath),
        ServerID = hb_util:human_id(ar_wallet:to_address(Wallet)),
        hb_http_server:get_opts(#{<<"http-server">> => ServerID})
    of
        Opts when is_map(Opts) -> {ok, Opts};
        Other -> {error, {invalid_node_options, Other}}
    catch
        Class:Reason -> {error, {Class, Reason}}
    end.

user_ref(UserID, Secret) ->
    base64url(crypto:mac(hmac, sha256, Secret, <<"legacy-reaction-user-v1", 0, UserID/binary>>)).

digest_ref(Parts) ->
    base64url(crypto:hash(sha256, lists:join(<<0>>, Parts))).

base64url(Bytes) ->
    Encoded = binary:replace(binary:replace(base64:encode(Bytes), <<"+">>, <<"-">>, [global]), <<"/">>, <<"_">>, [global]),
    binary:replace(Encoded, <<"=">>, <<>>, [global]).

optional_owner(undefined) -> undefined;
optional_owner(<<>>) -> undefined;
optional_owner(Owner0) ->
    Owner = opaque_ref(Owner0),
    Owner.

opaque_ref(Value) ->
    Owner = bounded_binary(Value, 43),
    true = byte_size(Owner) =:= 43,
    true = lists:all(fun is_base64url/1, binary:bin_to_list(Owner)),
    Owner.

is_base64url(Char) ->
    (Char >= $A andalso Char =< $Z) orelse
        (Char >= $a andalso Char =< $z) orelse
        (Char >= $0 andalso Char =< $9) orelse Char =:= $_ orelse Char =:= $-.

bounded_binary(Value, Max) when is_binary(Value), byte_size(Value) > 0, byte_size(Value) =< Max -> Value;
bounded_binary(Value, Max) when is_list(Value) -> bounded_binary(unicode:characters_to_binary(Value), Max);
bounded_binary(_, _) -> error(invalid_string).

enum(Value, Allowed) ->
    Binary = bounded_binary(Value, 32),
    true = lists:member(Binary, Allowed),
    Binary.

positive_int(Value) ->
    Int = non_negative_int(Value),
    true = Int > 0,
    Int.

non_negative_int(Value) when is_integer(Value), Value >= 0 -> Value;
non_negative_int(Value) when is_binary(Value) ->
    Int = binary_to_integer(Value),
    true = Int >= 0,
    Int;
non_negative_int(_) -> error(invalid_integer).

value(Map, Keys) -> value(Map, Keys, undefined).
value(_Map, [], Default) -> Default;
value(Map, [Key | Rest], Default) ->
    case maps:find(Key, Map) of
        {ok, Value} -> Value;
        error -> value(Map, Rest, Default)
    end.

compact(Map) -> maps:filter(fun(_Key, Value) -> Value =/= undefined end, Map).

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

initial_switch_and_removal_plan_test() ->
    Secret = <<"01234567890123456789012345678901">>,
    Owner = <<"ooooooooooooooooooooooooooooooooooooooooooo">>,
    Initial = #{
        <<"snapshot-at">> => 200,
        <<"reactions">> => [
            #{<<"user-id">> => <<"private-user-1">>, <<"claim-id">> => <<"claim-a">>, <<"reaction">> => <<"like">>, <<"updated-at">> => 100, <<"native-owner">> => Owner},
            #{<<"user-id">> => <<"private-user-2">>, <<"claim-id">> => <<"claim-a">>, <<"reaction">> => <<"dislike">>, <<"updated-at">> => 110}
        ]
    },
    {ok, First} = plan(Initial, Secret, #{}),
    ?assertEqual(2, maps:get(<<"record-messages">>, First)),
    ?assertEqual(1, maps:get(<<"summary-messages">>, First)),
    [Summary] = [M || M = #{<<"schema">> := ?SUMMARY_SCHEMA} <- maps:get(<<"messages">>, First)],
    ?assertEqual(1, maps:get(<<"like">>, Summary)),
    ?assertEqual(1, maps:get(<<"dislike">>, Summary)),
    ?assertEqual([#{<<"owner">> => Owner, <<"reaction">> => <<"like">>}], maps:get(<<"linked-reactions">>, Summary)),
    ?assertEqual(nomatch, binary:match(hb_json:encode(maps:get(<<"checkpoint">>, First)), <<"private-user">>)),

    {ok, Unchanged} = plan(Initial, Secret, maps:get(<<"checkpoint">>, First)),
    ?assertEqual([], maps:get(<<"messages">>, Unchanged)),
    ?assertEqual(
        {error, stale_snapshot},
        plan(Initial#{<<"snapshot-at">> => 199}, Secret, maps:get(<<"checkpoint">>, First))
    ),
    SameTimestampChanged = Initial#{
        <<"reactions">> => [
            #{<<"user-id">> => <<"private-user-1">>, <<"claim-id">> => <<"claim-a">>, <<"reaction">> => <<"dislike">>, <<"updated-at">> => 100, <<"native-owner">> => Owner}
        ]
    },
    ?assertEqual(
        {error, conflicting_snapshot_timestamp},
        plan(SameTimestampChanged, Secret, maps:get(<<"checkpoint">>, First))
    ),

    Changed = #{
        <<"snapshot-at">> => 300,
        <<"reactions">> => [
            #{<<"user-id">> => <<"private-user-1">>, <<"claim-id">> => <<"claim-a">>, <<"reaction">> => <<"dislike">>, <<"updated-at">> => 250, <<"native-owner">> => Owner}
        ]
    },
    {ok, Second} = plan(Changed, Secret, maps:get(<<"checkpoint">>, First)),
    ?assertEqual(2, maps:get(<<"record-messages">>, Second)),
    ?assertEqual(1, maps:get(<<"summary-messages">>, Second)),
    Records = [M || M = #{<<"schema">> := ?RECORD_SCHEMA} <- maps:get(<<"messages">>, Second)],
    ?assert(lists:any(fun(M) -> maps:get(<<"state">>, M) =:= <<"removed">> end, Records)),
    ?assert(lists:any(fun(M) -> maps:get(<<"reaction">>, M) =:= <<"dislike">> andalso maps:get(<<"state">>, M) =:= <<"active">> end, Records)).

conflicting_identity_mapping_is_rejected_test() ->
    Secret = <<"01234567890123456789012345678901">>,
    Owner = <<"ooooooooooooooooooooooooooooooooooooooooooo">>,
    Input = #{<<"snapshot-at">> => 200, <<"reactions">> => [
        #{<<"user-id">> => <<"user-1">>, <<"claim-id">> => <<"a">>, <<"reaction">> => <<"like">>, <<"native-owner">> => Owner},
        #{<<"user-id">> => <<"user-2">>, <<"claim-id">> => <<"b">>, <<"reaction">> => <<"like">>, <<"native-owner">> => Owner}
    ]},
    ?assertEqual({error, conflicting_native_owner_mapping}, plan(Input, Secret, #{})),
    Owner2 = <<"ppppppppppppppppppppppppppppppppppppppppppp">>,
    Reverse = #{<<"snapshot-at">> => 200, <<"reactions">> => [
        #{<<"user-id">> => <<"user-1">>, <<"claim-id">> => <<"a">>, <<"reaction">> => <<"like">>, <<"native-owner">> => Owner},
        #{<<"user-id">> => <<"user-1">>, <<"claim-id">> => <<"b">>, <<"reaction">> => <<"like">>, <<"native-owner">> => Owner2}
    ]},
    ?assertEqual({error, conflicting_native_owner_mapping}, plan(Reverse, Secret, #{})),

    {ok, First} = plan(#{<<"snapshot-at">> => 200, <<"reactions">> => [
        #{<<"user-id">> => <<"user-1">>, <<"claim-id">> => <<"a">>, <<"reaction">> => <<"like">>, <<"native-owner">> => Owner},
        #{<<"user-id">> => <<"user-1">>, <<"claim-id">> => <<"b">>, <<"reaction">> => <<"dislike">>}
    ]}, Secret, #{}),
    [InheritedSummary] = [M || M = #{<<"schema">> := ?SUMMARY_SCHEMA, <<"target">> := <<"b">>} <- maps:get(<<"messages">>, First)],
    ?assertEqual(
        [#{<<"owner">> => Owner, <<"reaction">> => <<"dislike">>}],
        maps:get(<<"linked-reactions">>, InheritedSummary)
    ),
    Persisted = #{<<"snapshot-at">> => 250, <<"reactions">> => [
        #{<<"user-id">> => <<"user-1">>, <<"claim-id">> => <<"a">>, <<"reaction">> => <<"like">>},
        #{<<"user-id">> => <<"user-1">>, <<"claim-id">> => <<"b">>, <<"reaction">> => <<"dislike">>}
    ]},
    {ok, PersistedPlan} = plan(Persisted, Secret, maps:get(<<"checkpoint">>, First)),
    ?assertEqual([], maps:get(<<"messages">>, PersistedPlan)),
    Remapped = #{<<"snapshot-at">> => 300, <<"reactions">> => [
        #{<<"user-id">> => <<"user-1">>, <<"claim-id">> => <<"a">>, <<"reaction">> => <<"like">>, <<"native-owner">> => Owner2}
    ]},
    ?assertEqual(
        {error, conflicting_native_owner_mapping},
        plan(Remapped, Secret, maps:get(<<"checkpoint">>, PersistedPlan))
    ).

-endif.
