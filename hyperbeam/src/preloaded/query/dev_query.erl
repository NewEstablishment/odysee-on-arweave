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
-export([info/1, only/3, all/3, base/3]).
%%% GraphQL API:
-export([graphql/3, has_results/3]).
%%% Test setup:
-export([test_setup/0]).
-include_lib("eunit/include/eunit.hrl").
-include("include/hb.hrl").

%%% Keys that should typically be excluded from searches.
-define(
    DEFAULT_EXCLUDES,
    [<<"path">>, <<"commitments">>, <<"return">>, <<"exclude">>, <<"only">>]
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
                Opts
            );
        not_found ->
            return_matches([], ReturnType, Opts);
        {error, not_found} ->
            return_matches([], ReturnType, Opts);
        Error ->
            Error
    end.

return_matches(Matches, ReturnType, Opts) ->
    ?event({matched, {paths, Matches}}),
    case {ReturnType, Matches} of
        {<<"count">>, _} ->
            {ok, length(Matches)};
        {<<"paths">>, _} ->
            {ok, Matches};
        {<<"messages">>, _} ->
            Messages =
                lists:map(
                    fun(Path) ->
                        hb_util:ok(hb_cache:read(Path, Opts))
                    end,
                    Matches
                ),
            ?event({matched, {messages, Messages}}),
            {ok, Messages};
        {<<"boolean">>, _} ->
            {ok, Matches =/= []};
        {<<"first-path">>, [Path | _]} ->
            {ok, Path};
        {<<"first">>, [Path | _]} ->
            hb_cache:read(Path, Opts);
        {<<"first-message">>, [Path | _]} ->
            hb_cache:read(Path, Opts);
        {First, []}
                when First == <<"first-path">>;
                     First == <<"first">>;
                     First == <<"first-message">> ->
            {error, not_found}
    end.

dedupe_query_matches(Matches, Opts) ->
    {_, DedupedRev} =
        lists:foldl(
            fun(Path, {Seen, Acc}) ->
                Key = query_match_key(Path, Opts),
                case maps:is_key(Key, Seen) of
                    true ->
                        {Seen, Acc};
                    false ->
                        {maps:put(Key, true, Seen), [Path | Acc]}
                end
            end,
            {#{}, []},
            Matches
        ),
    lists:reverse(DedupedRev).

query_match_key(Path, Opts) ->
    case hb_cache:read(Path, Opts) of
        {ok, Msg} when is_map(Msg) ->
            CanonicalMsg =
                hb_message:uncommitted_deep(
                    hb_private:reset(hb_cache:ensure_all_loaded(Msg, Opts)),
                    Opts
                ),
            hb_message:id(CanonicalMsg, none, Opts#{ <<"linkify-mode">> => discard });
        _ ->
            Path
    end.

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

empty_results_test() ->
    with_query_store(
        <<"empty-results">>,
        fun(Opts) ->
            BaseReq = #{
                <<"only">> => [<<"phase-4-probe">>],
                <<"phase-4-probe">> => <<"missing">>
            },
            ?assertEqual(
                {ok, []},
                only(#{}, BaseReq#{ <<"return">> => <<"paths">> }, Opts)
            ),
            ?assertEqual(
                {ok, []},
                only(#{}, BaseReq#{ <<"return">> => <<"messages">> }, Opts)
            ),
            ?assertEqual(
                {ok, 0},
                only(#{}, BaseReq#{ <<"return">> => <<"count">> }, Opts)
            ),
            ?assertEqual(
                {ok, false},
                only(#{}, BaseReq#{ <<"return">> => <<"boolean">> }, Opts)
            ),
            lists:foreach(
                fun(ReturnType) ->
                    ?assertEqual(
                        {error, not_found},
                        only(
                            #{},
                            BaseReq#{ <<"return">> => ReturnType },
                            Opts
                        )
                    )
                end,
                [<<"first-path">>, <<"first">>, <<"first-message">>]
            )
        end
    ).

signed_post_query_hydration_test() ->
    with_query_store(
        <<"signed-post-query">>,
        fun(Opts) ->
            Auth = <<"Basic ", (base64:encode(<<"phase4:test">>))/binary>>,
            Node =
                hb_http_server:start_node(
                    Opts#{
                        <<"store-all-signed">> => true,
                        <<"on">> => #{
                            <<"request">> => #{
                                <<"device">> => <<"auth-hook@1.0">>,
                                <<"path">> => <<"request">>,
                                <<"when">> => #{ <<"keys">> => [<<"!">>] },
                                <<"secret-provider">> => #{
                                    <<"device">> => <<"http-auth@1.0">>,
                                    <<"access-control">> => #{
                                        <<"device">> => <<"http-auth@1.0">>
                                    }
                                }
                            }
                        }
                    }
                ),
            Fields = #{
                <<"schema">> => <<"phase-4-query@1.0">>,
                <<"type">> => <<"generic-record">>,
                <<"phase-4-probe">> => <<"signed-post-query">>,
                <<"value">> => <<"stable">>
            },
            WriteReq =
                Fields#{
                    <<"path">> => <<"/id?!=true">>,
                    <<"authorization">> => Auth,
                    <<"accept">> => <<"application/json">>,
                    <<"accept-bundle">> => false
                },
            {ok, FirstResponse} = hb_http:post(Node, WriteReq, #{}),
            FirstID = explicit_response_id(FirstResponse),
            {ok, SecondResponse} = hb_http:post(Node, WriteReq, #{}),
            ?assertEqual(FirstID, explicit_response_id(SecondResponse)),
            QueryReq =
                Fields#{
                    <<"only">> => maps:keys(Fields),
                    <<"return">> => <<"paths">>
                },
            ?assertEqual({ok, [FirstID]}, only(#{}, QueryReq, Opts)),
            {ok, Stored} = hb_cache:read(FirstID, Opts),
            Loaded = hb_cache:ensure_all_loaded(Stored, Opts),
            lists:foreach(
                fun({Key, Value}) ->
                    ?assertEqual(Value, hb_maps:get(Key, Loaded, Opts))
                end,
                maps:to_list(Fields)
            ),
            WithCommitments = hb_cache:read_all_commitments(Stored, Opts),
            ?assertNotEqual([], hb_message:signers(WithCommitments, Opts)),
            [Store] = hb_opts:get(store, [], Opts),
            ok = hb_store:stop(Store),
            ok = hb_store:start(Store),
            ?assertEqual({ok, [FirstID]}, only(#{}, QueryReq, Opts)),
            {ok, Restarted} = hb_cache:read(FirstID, Opts),
            ?assertEqual(
                <<"stable">>,
                hb_maps:get(
                    <<"value">>,
                    hb_cache:ensure_all_loaded(Restarted, Opts),
                    Opts
                )
            )
        end
    ).

dedupe_preserves_first_path_order_test() ->
    with_query_store(
        <<"dedupe-order">>,
        fun(Opts) ->
            First = hb_message:commit(#{ <<"record">> => <<"first">> }, Opts),
            Second = hb_message:commit(#{ <<"record">> => <<"second">> }, Opts),
            {ok, FirstCanonical} = hb_cache:write(First, Opts),
            {ok, SecondCanonical} = hb_cache:write(Second, Opts),
            FirstAlias = hb_message:id(First, signed, Opts),
            SecondAlias = hb_message:id(Second, signed, Opts),
            ?assertNotEqual(FirstCanonical, FirstAlias),
            ?assertNotEqual(SecondCanonical, SecondAlias),
            ?assertEqual(
                [FirstAlias, SecondCanonical],
                dedupe_query_matches(
                    [FirstAlias, FirstCanonical, SecondCanonical, SecondAlias],
                    Opts
                )
            )
        end
    ).

with_query_store(Tag, Test) ->
    Store = hb_test_utils:test_store(hb_store_lmdb, Tag),
    ok = hb_store:start(Store),
    Opts = #{
        <<"store">> => [Store],
        <<"match-index">> => [Store],
        <<"priv-wallet">> => ar_wallet:new()
    },
    try Test(Opts)
    after
        hb_store:stop(Store),
        hb_store:reset(Store)
    end.

explicit_response_id(Response) when is_binary(Response) ->
    case normalize_response_id(Response) of
        {ok, ID} -> ID;
        error ->
            try explicit_response_id(hb_json:decode(Response))
            catch _:_ -> erlang:error({missing_explicit_write_id, Response})
            end
    end;
explicit_response_id(Response) when is_map(Response) ->
    Candidates =
        [
            hb_maps:get(Key, Response, not_found, #{})
        ||
            Key <- [<<"id">>, <<"path">>, <<"read-path">>, <<"body">>]
        ],
    case lists:filtermap(
        fun(Candidate) ->
            case normalize_response_id(Candidate) of
                {ok, ID} -> {true, ID};
                error -> false
            end
        end,
        Candidates
    ) of
        [ID | _] -> ID;
        [] -> erlang:error({missing_explicit_write_id, Response})
    end.

normalize_response_id(<<"/", ID/binary>>) when ?IS_ID(ID) ->
    {ok, ID};
normalize_response_id(ID) when ?IS_ID(ID) ->
    {ok, ID};
normalize_response_id(_Candidate) ->
    error.
