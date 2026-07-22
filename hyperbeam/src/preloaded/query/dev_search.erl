%%% @doc Generic full-text discovery for HyperBEAM messages.
-module(dev_search).
-implements(<<"search@1.0">>).
-export([info/1, query/3, write/3]).
-include_lib("eunit/include/eunit.hrl").

info(_Opts) ->
    #{exports => [<<"query">>, <<"write">>]}.

write(Base, Req, Opts) ->
    SearchOpts = search_opts(Base, Opts),
    Msg = hb_maps:get(<<"body">>, Req, not_found, Opts),
    ID = hb_maps:get(<<"id">>, Req, not_found, Opts),
    case is_map(Msg) andalso is_binary(ID) andalso hb_search:ensure_started(SearchOpts) =:= ok of
        true -> hb_search:node_index(ID, Msg, schema(Base, Opts));
        false -> ok
    end,
    {ok, Req}.

query(Base, Req, Opts) ->
    Search = search_body(Req, Opts),
    case hb_search:node_query(Search, search_opts(Base, Opts)) of
        {ok, Result} ->
            {ok, Result#{
                <<"limit">> => maps:get(<<"limit">>, Search),
                <<"offset">> => maps:get(<<"offset">>, Search)
            }};
        Error ->
            Error
    end.

search_body(Req, Opts) ->
    Body0 = #{
        <<"q">> => hb_util:bin(hb_maps:get(<<"q">>, Req, <<>>, Opts)),
        <<"limit">> => bounded_int(hb_maps:get(<<"limit">>, Req, 20, Opts), 20, 1, 100),
        <<"offset">> => bounded_int(hb_maps:get(<<"offset">>, Req, 0, Opts), 0, 0, 1000000),
        <<"attributesToRetrieve">> => [<<"id">>]
    },
    Body1 = maybe_put(<<"filter">>, hb_maps:get(<<"filter">>, Req, not_found, Opts), Body0),
    maybe_put(<<"sort">>, sort_value(hb_maps:get(<<"sort">>, Req, not_found, Opts)), Body1).

schema(Base, Opts) ->
    case hb_maps:get(
        <<"search-schema">>,
        Base,
        hb_opts:get(<<"search-schema">>, all, Opts),
        Opts
    ) of
        Fields when is_list(Fields) -> Fields;
        <<"all">> -> all;
        _ -> all
    end.

search_opts(Base, Opts) ->
    lists:foldl(
        fun(Key, Acc) ->
            case hb_maps:get(Key, Base, not_found, Opts) of
                not_found -> Acc;
                Value -> Acc#{Key => Value}
            end
        end,
        Opts,
        [
            <<"search-api-key">>,
            <<"search-backend-url">>,
            <<"search-batch-size">>,
            <<"search-connect-timeout">>,
            <<"search-flush-ms">>,
            <<"search-index">>,
            <<"search-max-pending">>,
            <<"search-max-retries">>,
            <<"search-recv-timeout">>,
            <<"search-retry-ms">>,
            <<"search-schema">>,
            <<"search-task-poll-ms">>,
            <<"search-task-timeout">>
        ]
    ).

sort_value(not_found) -> not_found;
sort_value(Value) when is_list(Value) -> Value;
sort_value(Value) when is_binary(Value) -> [Value];
sort_value(_Value) -> not_found.

maybe_put(_Key, not_found, Map) -> Map;
maybe_put(_Key, [], Map) -> Map;
maybe_put(Key, Value, Map) -> Map#{Key => Value}.

bounded_int(Value, Default, Min, Max) ->
    min(Max, max(Min, parse_int(Value, Default))).

parse_int(Value, _Default) when is_integer(Value) -> Value;
parse_int(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value)
    catch
        _:_ -> Default
    end;
parse_int(_Value, Default) -> Default.

-ifdef(TEST).

search_body_is_id_only_and_paginated_test() ->
    Body = search_body(
        #{
            <<"q">> => <<"verification">>,
            <<"limit">> => <<"25">>,
            <<"offset">> => 50,
            <<"filter">> => <<"type = comment">>,
            <<"sort">> => <<"timestamp:desc">>
        },
        #{}
    ),
    ?assertEqual(<<"verification">>, maps:get(<<"q">>, Body)),
    ?assertEqual(25, maps:get(<<"limit">>, Body)),
    ?assertEqual(50, maps:get(<<"offset">>, Body)),
    ?assertEqual([<<"id">>], maps:get(<<"attributesToRetrieve">>, Body)),
    ?assertEqual([<<"timestamp:desc">>], maps:get(<<"sort">>, Body)).

invalid_write_hook_request_is_transparent_test() ->
    Req = #{<<"body">> => <<"raw bytes">>},
    {ok, Req} = write(#{}, Req, #{}).

search_opts_forwards_task_wait_configuration_test() ->
    Opts = search_opts(
        #{
            <<"search-task-poll-ms">> => 7,
            <<"search-task-timeout">> => 12000
        },
        #{}
    ),
    ?assertEqual(7, maps:get(<<"search-task-poll-ms">>, Opts)),
    ?assertEqual(12000, maps:get(<<"search-task-timeout">>, Opts)).

-endif.
