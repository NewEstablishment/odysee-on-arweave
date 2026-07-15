%%% @doc A discovery engine for searching for and returning messages found in
%%% a node's cache, through supported stores.
%%% 
%%% This device supports various modes of matching, including:
%%%
%%% - `all' (default): Match all keys in the request message.
%%% - `base': Match all keys in the base message.
%%% - `only': Match only the key(s) specified in the `only' key.
%%% 
%%% The `only' key can be a binary, a map, or a list of keys. If it is a binary,
%%% it is split on commas to get a list of keys to search for. If it is a message,
%%% it is used directly as the match spec. If it is a list, it is assumed to be
%%% a list of keys that we should select from the request or base message and
%%% use as the match spec.
%%%
%%% The `return' key can be used to specify the type of data to return.
%%%
%%% - `count': Return the number of matches.
%%% - `paths': Return the paths of the matches in a list.
%%% - `messages': Return the messages associated with each match in a list.
%%% - `first-path': Return the first path of the matches.
%%% - `first-message': Return the first message of the matches.
%%% - `boolean': Return a boolean indicating whether any matches were found.
-module(dev_query).
%%% Message matching API:
-export([info/1, only/3, all/3, base/3, batch/3]).
%%% GraphQL API:
-export([graphql/3, has_results/3]).
%%% Test setup:
-export([test_setup/0]).
-include_lib("eunit/include/eunit.hrl").
-include("include/hb.hrl").

%%% Keys that should typically be excluded from searches.
-define(
    DEFAULT_EXCLUDES,
    [
        <<"path">>,
        <<"commitments">>,
        <<"return">>,
        <<"exclude">>,
        <<"only">>,
        <<"queries">>,
        <<"offset">>,
        <<"limit">>,
        <<"sort-by">>,
        <<"sort_by">>,
        <<"sort-order">>,
        <<"sort_order">>
    ]
).

info(_Opts) ->
    #{
        excludes => [<<"keys">>, <<"set">>],
        default => fun default/4
    }.

%% @doc Execute the query via GraphQL.
graphql(Req, Base, Opts) ->
    dev_query_graphql:handle(Req, Base, Opts).

%% @doc Return whether a GraphQL esponse in a message has transaction results.
%% This key is used in HB's gateway client multirequest configuration to
%% determine if the response from the node should be considered admissible.
has_results(Base, Req, Opts) ->
    JSON =
        hb_ao:get_first(
            [
                {{as, <<"message@1.0">>, Base}, <<"body">>},
                {{as, <<"message@1.0">>, Req}, <<"body">>}
            ],
            <<"{}">>,
            Opts
        ),
    Decoded = hb_json:decode(JSON),
    ?event(debug_multi, {has_results, {decoded_json, Decoded}}),
    case Decoded of
        #{ <<"data">> := #{ <<"transactions">> := #{ <<"edges">> := Nodes } } }
                when length(Nodes) > 0 ->
            {ok, true};
        _ -> {ok, false}
    end.

%% @doc Search for the keys specified in the request message.
default(_, Base, Req, Opts) ->
    all(Base, Req, Opts).

%% @doc Search the node's store for all of the keys and values in the request,
%% aside from the `commitments' and `path' keys.
all(Base, Req, Opts) ->
    match(Req, Base, Req, Opts).

%% @doc Search the node's store for all of the keys and values in the base
%% message, aside from the `commitments' and `path' keys.
base(Base, Req, Opts) ->
    match(Base, Base, Req, Opts).

%% @doc Search only for the (list of) key(s) specified in `only' in the request.
%% The `only' key can be a binary, a map, or a list of keys. See the moduledoc
%% for semantics.
only(Base, Req, Opts) ->
    case hb_maps:get(<<"only">>, Req, not_found, Opts) of
        KeyBin when is_binary(KeyBin) ->
            % The descriptor is a binary, so we split it on commas to get a
            % list of keys to search for. If there is only one key, we
            % return a list with that key.
            match(binary:split(KeyBin, <<",">>, [global]), Base, Req, Opts);
        Spec when is_map(Spec) ->
            % The descriptor is a map, so we use it as the match spec.
            match(Spec, Base, Req, Opts);
        Keys when is_list(Keys) ->
            % The descriptor is a list, so we assume that it is a list of
            % keys that we should select from the request and use as the
            % match spec.
            match(Keys, Base, Req, Opts);
        not_found ->
            % We cannot find the key to match upon. Return an error.
            {error, not_found}
    end.

batch(Base, Req, Opts) ->
    case batch_queries(hb_maps:get(<<"queries">>, Req, not_found, Opts), Opts) of
        {ok, Queries} ->
            case batch_results(Queries, Base, Opts, []) of
                {ok, Results} ->
                    {ok, #{
                        <<"content-type">> => <<"application/json">>,
                        <<"body">> => hb_json:encode(Results)
                    }};
                Error -> Error
            end;
        Error -> Error
    end.

batch_queries(Queries, _Opts) when is_list(Queries) ->
    {ok, Queries};
batch_queries(Queries, Opts) when is_map(Queries) ->
    try {ok, hb_util:numbered_keys_to_list(Queries, Opts)}
    catch _:_ -> {error, invalid_queries}
    end;
batch_queries(_Queries, _Opts) ->
    {error, invalid_queries}.

batch_results([], _Base, _Opts, Results) ->
    {ok, lists:reverse(Results)};
batch_results([Query | Rest], Base, Opts, Results) when is_map(Query) ->
    case only(Base, normalize_batch_query(Query, Opts), Opts) of
        {ok, Result} -> batch_results(Rest, Base, Opts, [Result | Results]);
        Error -> Error
    end;
batch_results(_Queries, _Base, _Opts, _Results) ->
    {error, invalid_query}.

normalize_batch_query(Query, Opts) ->
    case hb_maps:get(<<"only">>, Query, not_found, Opts) of
        Only when is_map(Only) ->
            case hb_util:is_ordered_list(Only, Opts) of
                true -> Query#{ <<"only">> => hb_util:numbered_keys_to_list(Only, Opts) };
                false -> Query
            end;
        _ -> Query
    end.

%% @doc Match the request against the base message, using the keys to select
%% the values from the request and (if not found) the values from the base
%% message.
match(Keys, Base, Req, Opts) when is_list(Keys) ->
    UserSpec =
        maps:from_list(
            lists:filtermap(
                fun(Key) ->
                    % Search for the value in the request. If not found,
                    % look in the base message.
                    Value =
                        hb_maps:get(
                            Key,
                            Req,
                            hb_maps:get(Key, Base, not_found, Opts),
                            Opts
                        ),
                    if Value == not_found -> false;
                    true -> {true, {Key, Value}}
                    end
                end,
                Keys
            )
        ),
    match(UserSpec, Base, Req, Opts);
match(UserSpec, _Base, Req, Opts) ->
    ?event({matching, {spec, UserSpec}}),
    FilteredSpec =
        hb_maps:without(
            hb_maps:get(<<"exclude">>, Req, ?DEFAULT_EXCLUDES, Opts),
            UserSpec
        ),
    ReturnType = hb_maps:get(<<"return">>, Req, <<"paths">>, Opts),
    ?event({matching, {spec, FilteredSpec}, {return, ReturnType}}),
    case hb_cache:match(FilteredSpec, Opts) of
        {ok, RawMatches} ->
            return_matches(
                dedupe_query_matches(RawMatches, Opts),
                ReturnType,
                Req,
                Opts
            );
        not_found ->
            return_matches([], ReturnType, Req, Opts);
        {error, not_found} ->
            return_matches([], ReturnType, Req, Opts);
        Error ->
            Error
    end.

return_matches(AllMatches, <<"count">>, _Req, _Opts) ->
    {ok, length(AllMatches)};
return_matches(AllMatches, <<"boolean">>, _Req, _Opts) ->
    {ok, AllMatches =/= []};
return_matches(AllMatches, ReturnType, Req, Opts) ->
    Ordered = order_query_matches(AllMatches, Req, Opts),
    Matches = paginate_query_matches(Ordered, Req, Opts),
    ?event({matched, {paths, Matches}}),
    case ReturnType of
        <<"paths">> ->
            {ok, Matches};
        <<"messages">> ->
            Messages = [hb_util:ok(hb_cache:read(Path, Opts)) || Path <- Matches],
            ?event({matched, {messages, Messages}}),
            {ok, Messages};
        <<"first-path">> ->
            first_path(Matches);
        <<"first">> ->
            first_message(Matches, Opts);
        <<"first-message">> ->
            first_message(Matches, Opts);
        _ ->
            {error, {unsupported_return, ReturnType}}
    end.

first_path([Path | _]) ->
    {ok, Path};
first_path([]) ->
    {error, not_found}.

first_message([Path | _], Opts) ->
    hb_cache:read(Path, Opts);
first_message([], _Opts) ->
    {error, not_found}.

order_query_matches(Matches, Req, Opts) ->
    case first_query_param([<<"sort-by">>, <<"sort_by">>], Req, not_found, Opts) of
        not_found ->
            lists:sort(fun query_path_less/2, Matches);
        SortBy ->
            Direction = query_sort_direction(Req, Opts),
            Annotated =
                [
                    {Path, query_sort_value(Path, SortBy, Opts)}
                ||
                    Path <- Matches
                ],
            [Path || {Path, _} <- lists:sort(fun(A, B) -> query_sort_less(A, B, Direction) end, Annotated)]
    end.

query_path_less(PathA, PathB) ->
    hb_path:to_binary(PathA) < hb_path:to_binary(PathB).

query_sort_value(Path, SortBy, Opts) ->
    case hb_cache:read(Path, Opts) of
        {ok, Msg} when is_map(Msg) ->
            case hb_maps:get(
                SortBy,
                hb_cache:ensure_all_loaded(Msg, Opts),
                not_found,
                Opts
            ) of
                not_found -> not_found;
                Value -> normalize_sort_value(Value)
            end;
        _ ->
            not_found
    end.

normalize_sort_value(Value) when is_integer(Value); is_float(Value) ->
    {number, Value};
normalize_sort_value(Value) when is_binary(Value) ->
    case numeric_binary(Value) of
        {ok, Number} -> {number, Number};
        error -> {binary, Value}
    end;
normalize_sort_value(Value) when is_atom(Value) ->
    {atom, Value};
normalize_sort_value(Value) ->
    {term, Value}.

numeric_binary(Value) ->
    try {ok, binary_to_integer(Value)}
    catch
        _:_ ->
            try {ok, binary_to_float(Value)}
            catch _:_ -> error
            end
    end.

query_sort_less({PathA, not_found}, {PathB, not_found}, _Direction) ->
    hb_path:to_binary(PathA) < hb_path:to_binary(PathB);
query_sort_less({_PathA, not_found}, {_PathB, _ValueB}, _Direction) ->
    false;
query_sort_less({_PathA, _ValueA}, {_PathB, not_found}, _Direction) ->
    true;
query_sort_less({PathA, Value}, {PathB, Value}, _Direction) ->
    hb_path:to_binary(PathA) < hb_path:to_binary(PathB);
query_sort_less({_PathA, ValueA}, {_PathB, ValueB}, desc) ->
    ValueA > ValueB;
query_sort_less({_PathA, ValueA}, {_PathB, ValueB}, asc) ->
    ValueA < ValueB.

query_sort_direction(Req, Opts) ->
    Value = first_query_param([<<"sort-order">>, <<"sort_order">>], Req, <<"asc">>, Opts),
    case string:lowercase(hb_util:bin(Value)) of
        <<"desc">> -> desc;
        <<"descending">> -> desc;
        _ -> asc
    end.

paginate_query_matches(Matches, Req, Opts) ->
    Offset = non_negative_query_integer(hb_maps:get(<<"offset">>, Req, 0, Opts), 0),
    AfterOffset = drop_query_matches(Matches, Offset),
    case hb_maps:get(<<"limit">>, Req, not_found, Opts) of
        not_found -> AfterOffset;
        LimitValue ->
            Limit = non_negative_query_integer(LimitValue, 0),
            lists:sublist(AfterOffset, Limit)
    end.

drop_query_matches(Matches, 0) ->
    Matches;
drop_query_matches([], _Offset) ->
    [];
drop_query_matches([_ | Rest], Offset) ->
    drop_query_matches(Rest, Offset - 1).

non_negative_query_integer(Value, _Default) when is_integer(Value), Value >= 0 ->
    Value;
non_negative_query_integer(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value) of
        Integer when Integer >= 0 -> Integer;
        _ -> Default
    catch
        _:_ -> Default
    end;
non_negative_query_integer(_Value, Default) ->
    Default.

first_query_param([], _Req, Default, _Opts) ->
    Default;
first_query_param([Key | Rest], Req, Default, Opts) ->
    case hb_maps:get(Key, Req, not_found, Opts) of
        not_found -> first_query_param(Rest, Req, Default, Opts);
        Value -> Value
    end.

dedupe_query_matches(Matches, Opts) ->
    {_, DedupedRev} =
        lists:foldl(
            fun(Path, {Seen, Acc}) ->
                case query_match_identity(Path, Opts) of
                    query_control ->
                        {Seen, Acc};
                    {Key, CanonicalPath} ->
                        case maps:is_key(Key, Seen) of
                            true ->
                                {Seen, Acc};
                            false ->
                                {maps:put(Key, true, Seen), [CanonicalPath | Acc]}
                        end
                end
            end,
            {#{}, []},
            Matches
        ),
    lists:reverse(DedupedRev).

query_match_identity(Path, Opts) ->
    case hb_cache:read(Path, Opts) of
        {ok, Msg} when is_map(Msg) ->
            Loaded = hb_cache:ensure_all_loaded(Msg, Opts),
            case is_query_control_message(Loaded, Opts) of
                true -> query_control;
                false ->
                    Payload =
                        hb_message:uncommitted_deep(
                            hb_private:reset(Loaded),
                            Opts
                        ),
                    {
                        hb_message:id(Payload, none, Opts#{ <<"linkify-mode">> => discard }),
                        hb_message:id(Loaded, #{}, Opts#{ <<"linkify-mode">> => discard })
                    }
            end;
        _ ->
            {Path, Path}
    end.

is_query_control_message(Msg, Opts) ->
    lists:any(
        fun(Key) -> hb_maps:get(Key, Msg, not_found, Opts) =/= not_found end,
        [<<"only">>, <<"queries">>]
    ).

%%% Tests

%% @doc Return test options with a test store.
test_setup() ->
    Store = hb_test_utils:test_store(),
    Opts = #{ <<"store">> => Store, <<"priv-wallet">> => ar_wallet:new() },
    % Write a simple message.
    hb_cache:write(
        #{
            <<"basic">> => <<"binary-value">>,
            <<"basic-2">> => <<"binary-value-2">>
        },
        Opts
    ),
    % Write a nested and committed message.
    hb_cache:write(
        hb_message:commit(
            #{
                <<"test-key">> => <<"test-value">>,
                <<"test-key-2">> => <<"test-value-2">>,
                <<"nested">> => Nested = #{
                    <<"test-key-3">> => <<"test-value-3">>,
                    <<"test-key-4">> => <<"test-value-4">>
                }
            },
            Opts
        ),
        Opts
    ),
    % Write a list message with complex keys.
    hb_cache:write([<<"a">>, 2, ok], Opts),
    {ok, Opts, #{ <<"nested">> => hb_message:id(Nested, all, Opts) }}.

%% @doc Search for and find a basic test key.
basic_test() ->
    {ok, Opts, _} = test_setup(),
    {ok, [ID]} = hb_ao:resolve(<<"~query@1.0/all?basic=binary-value">>, Opts),
    {ok, Read} = hb_cache:read(ID, Opts),
    ?assertEqual(<<"binary-value">>, hb_maps:get(<<"basic">>, Read)),
    ?assertEqual(<<"binary-value-2">>, hb_maps:get(<<"basic-2">>, Read)),
    {ok, [Msg]} =
        hb_ao:resolve(
            <<"~query@1.0/all?basic-2=binary-value-2&return=messages">>,
            Opts
        ),
    ?assertEqual(<<"binary-value-2">>, hb_maps:get(<<"basic-2">>, Msg)),
    ok.

%% @doc Ensure that we can search for and match only a single key.
only_test() ->
    {ok, Opts, _} = test_setup(),
    {ok, [Msg]} =
        hb_ao:resolve(
            <<"~query@1.0/only=basic&basic=binary-value&wrong=1&return=messages">>,
            Opts
        ),
    ?assertEqual(<<"binary-value">>, hb_maps:get(<<"basic">>, Msg)),
    ok.

batch_test() ->
    {ok, Opts, _} = test_setup(),
    PathsQuery = #{
        <<"only">> => [<<"basic">>],
        <<"basic">> => <<"binary-value">>,
        <<"return">> => <<"paths">>
    },
    CountQuery = PathsQuery#{ <<"return">> => <<"count">> },
    {ok, #{ <<"body">> := Body }} = batch(
        #{},
        #{ <<"queries">> => hb_util:list_to_numbered_message([PathsQuery, CountQuery]) },
        Opts
    ),
    [Paths, 1] = hb_json:decode(Body),
    ?assertEqual(1, length(Paths)).

query_control_messages_excluded_test() ->
    {ok, Opts, _} = test_setup(),
    hb_cache:write(
        #{
            <<"basic">> => <<"binary-value">>,
            <<"only">> => [<<"basic">>],
            <<"return">> => <<"count">>
        },
        Opts
    ),
    {ok, 1} = only(
        #{},
        #{
            <<"basic">> => <<"binary-value">>,
            <<"only">> => [<<"basic">>],
            <<"return">> => <<"count">>
        },
        Opts
    ).

%% @doc Ensure that we can specify multiple keys to match.
multiple_test() ->
    {ok, Opts, _} = test_setup(),
    {ok, [Msg]} =
        hb_ao:resolve(
            <<
                "~query@1.0/only=basic,basic-2",
                "&basic=binary-value&basic-2=binary-value-2",
                "&return=messages"
            >>,
            Opts
        ),
    ?assertEqual(<<"binary-value">>, hb_maps:get(<<"basic">>, Msg)),
    ?assertEqual(<<"binary-value-2">>, hb_maps:get(<<"basic-2">>, Msg)),
    ok.

%% @doc Search for and find a nested test key.
nested_test() ->
    {ok, Opts, _} = test_setup(),
    {ok, [MsgWithNested]} =
        hb_ao:resolve(
            <<"~query@1.0/all?test-key=test-value&return=messages">>,
            Opts
        ),
    ?assert(hb_maps:is_key(<<"nested">>, MsgWithNested, Opts)),
    Nested = hb_maps:get(<<"nested">>, MsgWithNested, undefined, Opts),
    ?assertEqual(<<"test-value-3">>, hb_maps:get(<<"test-key-3">>, Nested, Opts)),
    ?assertEqual(<<"test-value-4">>, hb_maps:get(<<"test-key-4">>, Nested, Opts)),
    ok.

%% @doc Search for and find a list message with typed elements.
list_test() ->
    {ok, Opts, _} = test_setup(),
    {ok, [Msg]} =
        hb_ao:resolve(
            <<"~query@1.0/all?2+integer=2&3+atom=ok&return=messages">>,
            Opts
        ),
    ?assertEqual([<<"a">>, 2, ok], Msg),
    ok.

%% @doc Ensure user's can opt not to specify a key to resolve, instead specifying
%% only the matchable keys in the message.
return_key_test() ->
    {ok, Opts, _} = test_setup(),
    {ok, [ID]} =
        hb_ao:resolve(
            <<"~query@1.0/basic=binary-value">>,
            Opts
        ),
    {ok, Msg} = hb_cache:read(ID, Opts),
    ?assertEqual(<<"binary-value">>, hb_maps:get(<<"basic">>, Msg, Opts)),
    ok.

%% @doc Validate the functioning of various return types.
return_types_test() ->
    {ok, Opts, _} = test_setup(),
    {ok, [Msg]} =
        hb_ao:resolve(
            <<"~query@1.0/basic=binary-value&return=messages">>,
            Opts
        ),
    ?assertEqual(<<"binary-value">>, hb_maps:get(<<"basic">>, Msg, Opts)),
    ?assertEqual(
        {ok, 1},
        hb_ao:resolve(
            <<"~query@1.0/basic=binary-value&return=count">>,
            Opts
        )
    ),
    ?assertEqual(
        {ok, true},
        hb_ao:resolve(
            <<"~query@1.0/basic=binary-value&return=boolean">>,
            Opts
        )
    ),
    ?assertEqual(
        {ok, <<"binary-value">>},
        hb_ao:resolve(
            <<"~query@1.0/basic=binary-value&return=first-message/basic">>,
            Opts
        )
    ),
    ok.

http_test() ->
    {ok, Opts, _} = test_setup(),
    Node = hb_http_server:start_node(Opts),
    {ok, Msg} =
        hb_http:get(
            Node,
            <<"~query@1.0/only=basic&basic=binary-value?return=first">>,
            Opts
        ),
    ?assertEqual(<<"binary-value">>, hb_maps:get(<<"basic">>, Msg, Opts)),
    ok.

empty_query_results_test() ->
    {ok, Opts, _} = test_setup(),
    Req = native_comment_query(<<"missing-target">>, <<"paths">>),
    ?assertEqual({ok, []}, only(#{}, Req, Opts)),
    ?assertEqual({ok, 0}, only(#{}, Req#{ <<"return">> => <<"count">> }, Opts)),
    ?assertEqual({ok, false}, only(#{}, Req#{ <<"return">> => <<"boolean">> }, Opts)),
    ?assertEqual(
        {error, not_found},
        only(#{}, Req#{ <<"return">> => <<"first-path">> }, Opts)
    ).

native_comment_query_ids_sort_and_paginate_test() ->
    Store = hb_test_utils:test_store(),
    Opts = #{ <<"store">> => [Store], <<"priv-wallet">> => ar_wallet:new() },
    Target = <<"video-1">>,
    write_signed_comment(Target, <<"older">>, 10, Opts),
    write_signed_comment(Target, <<"newer">>, 20, Opts),
    write_signed_comment(<<"video-2">>, <<"other">>, 30, Opts),
    Req = native_comment_query(Target, <<"paths">>),
    {ok, Paths} = only(#{}, Req, Opts),
    ?assertEqual(2, length(Paths)),
    ?assert(lists:all(fun is_binary/1, Paths)),
    [Newest, Older] = [hb_util:ok(hb_cache:read(Path, Opts)) || Path <- Paths],
    ?assertEqual(<<"newer">>, hb_maps:get(<<"comment">>, Newest, Opts)),
    ?assertEqual(<<"older">>, hb_maps:get(<<"comment">>, Older, Opts)),
    ?assertEqual({ok, 2}, only(#{}, Req#{ <<"return">> => <<"count">> }, Opts)),
    ?assertEqual(
        {ok, 2},
        only(
            #{},
            Req#{ <<"return">> => <<"count">>, <<"offset">> => 1, <<"limit">> => 0 },
            Opts
        )
    ),
    ?assertEqual(
        {ok, true},
        only(
            #{},
            Req#{ <<"return">> => <<"boolean">>, <<"offset">> => 2, <<"limit">> => 0 },
            Opts
        )
    ),
    {ok, [OlderPath]} = only(
        #{},
        Req#{ <<"offset">> => 1, <<"limit">> => 1 },
        Opts
    ),
    {ok, OlderAgain} = hb_cache:read(OlderPath, Opts),
    ?assertEqual(<<"older">>, hb_maps:get(<<"comment">>, OlderAgain, Opts)).

native_comment_query_stable_tie_order_test() ->
    Store = hb_test_utils:test_store(),
    Opts = #{ <<"store">> => [Store], <<"priv-wallet">> => ar_wallet:new() },
    Target = <<"tied-video">>,
    write_signed_comment(Target, <<"tie-a">>, 42, Opts),
    write_signed_comment(Target, <<"tie-b">>, 42, Opts),
    {ok, Paths} = only(#{}, native_comment_query(Target, <<"paths">>), Opts),
    ?assertEqual(lists:sort(Paths), Paths).

query_default_order_and_missing_sort_value_test() ->
    Store = hb_test_utils:test_store(),
    Opts = #{ <<"store">> => [Store], <<"priv-wallet">> => ar_wallet:new() },
    Target = <<"partially-sorted-video">>,
    write_signed_comment(Target, <<"no timestamp">>, not_found, Opts),
    write_signed_comment(Target, <<"older">>, 10, Opts),
    write_signed_comment(Target, <<"newer">>, 20, Opts),
    Req = native_comment_query(Target, <<"paths">>),
    {ok, SortedPaths} = only(#{}, Req, Opts),
    ?assertEqual(
        [<<"newer">>, <<"older">>, <<"no timestamp">>],
        [
            hb_maps:get(<<"comment">>, hb_util:ok(hb_cache:read(Path, Opts)), Opts)
        ||
            Path <- SortedPaths
        ]
    ),
    {ok, DefaultPaths} = only(
        #{},
        maps:without([<<"sort-by">>, <<"sort-order">>], Req),
        Opts
    ),
    ?assertEqual(
        lists:sort(DefaultPaths),
        DefaultPaths
    ).

native_comment_query_active_state_test() ->
    Store = hb_test_utils:test_store(),
    Opts = #{ <<"store">> => [Store], <<"priv-wallet">> => ar_wallet:new() },
    Target = <<"stateful-video">>,
    {ok, ActivePath} = write_signed_comment(Target, <<"visible">>, 10, Opts),
    SignedDeleted = hb_message:commit(
        #{
            <<"schema">> => <<"odysee-comment@1.0">>,
            <<"type">> => <<"comment">>,
            <<"target">> => Target,
            <<"parent">> => <<"root">>,
            <<"state">> => <<"deleted">>,
            <<"author">> => <<"channel-1">>,
            <<"comment">> => <<"hidden">>,
            <<"timestamp">> => 20
        },
        Opts
    ),
    {ok, _DeletedPath} = hb_cache:write(SignedDeleted, Opts),
    ?assertEqual(
        {ok, [ActivePath]},
        only(#{}, native_comment_query(Target, <<"paths">>), Opts)
    ).

native_comment_query_returns_message_id_test() ->
    Store = hb_test_utils:test_store(),
    Opts = #{ <<"store">> => [Store], <<"priv-wallet">> => ar_wallet:new() },
    Target = <<"canonical-id-video">>,
    {ok, MessageID} = write_signed_comment(Target, <<"canonical comment">>, 42, Opts),
    ?assertEqual(
        {ok, [MessageID]},
        only(#{}, native_comment_query(Target, <<"paths">>), Opts)
    ),
    {ok, Stored} = hb_cache:read(MessageID, Opts),
    ?assertEqual(<<"canonical comment">>, hb_maps:get(<<"comment">>, Stored, Opts)).

native_comment_query_lmdb_persistence_test() ->
    Store = hb_test_utils:test_store(hb_store_lmdb, <<"native-comment-query">>),
    Opts = #{ <<"store">> => [Store], <<"priv-wallet">> => ar_wallet:new() },
    Target = <<"persistent-video">>,
    hb_store:start(Store),
    try
        write_signed_comment(Target, <<"persistent comment">>, 42, Opts),
        Req = native_comment_query(Target, <<"paths">>),
        {ok, [BeforeRestart]} = only(#{}, Req, Opts),
        ok = hb_store:stop(Store),
        hb_store:start(Store),
        {ok, [AfterRestart]} = only(#{}, Req, Opts),
        ?assertEqual(BeforeRestart, AfterRestart),
        {ok, Stored} = hb_cache:read(AfterRestart, Opts),
        ?assertEqual(<<"persistent comment">>, hb_maps:get(<<"comment">>, Stored, Opts)),
        StoredWithCommitments = hb_cache:read_all_commitments(Stored, Opts),
        ?assertNotEqual([], hb_message:signers(StoredWithCommitments, Opts))
    after
        hb_store:stop(Store),
        hb_store:reset(Store)
    end.

native_comment_query(Target, ReturnType) ->
    #{
        <<"only">> => [<<"type">>, <<"target">>, <<"parent">>, <<"state">>],
        <<"type">> => <<"comment">>,
        <<"target">> => Target,
        <<"parent">> => <<"root">>,
        <<"state">> => <<"active">>,
        <<"return">> => ReturnType,
        <<"sort-by">> => <<"timestamp">>,
        <<"sort-order">> => <<"desc">>
    }.

write_signed_comment(Target, Comment, Timestamp, Opts) ->
    Message0 =
        #{
            <<"schema">> => <<"odysee-comment@1.0">>,
            <<"type">> => <<"comment">>,
            <<"target">> => Target,
            <<"parent">> => <<"root">>,
            <<"state">> => <<"active">>,
            <<"author">> => <<"channel-1">>,
            <<"comment">> => Comment
        },
    Message = case Timestamp of
        not_found -> Message0;
        _ -> Message0#{ <<"timestamp">> => Timestamp }
    end,
    Signed = hb_message:commit(
        Message,
        Opts
    ),
    {ok, _} = hb_cache:write(Signed, Opts),
    {ok, hb_message:id(Signed, #{}, Opts)}.
