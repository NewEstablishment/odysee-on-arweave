%%% @doc Node-scoped full-text index for HyperBEAM messages.
-module(hb_search).
-behaviour(gen_server).
-export([ensure_started/1, node_index/3, node_query/2]).
-export([start_link/1, init/1, handle_call/3, handle_cast/2, handle_info/2, terminate/2]).
-include("include/hb.hrl").

-define(SERVER, hb_search_server).
-define(DEFAULT_BACKEND_URL, <<"http://127.0.0.1:7700">>).
-define(DEFAULT_INDEX, <<"hyperbeam_messages">>).

ensure_started(Opts) ->
    Started = case whereis(?SERVER) of
        undefined ->
            case start(Opts) of
                {ok, _PID} -> ok;
                {error, {already_started, _PID}} -> ok;
                StartError -> StartError
            end;
        _PID ->
            ok
    end,
    case Started of
        ok -> gen_server:call(?SERVER, {ensure_config, search_config(Opts)});
        EnsureError -> EnsureError
    end.

node_index(ID, Fields, Schema) ->
    gen_server:cast(?SERVER, {index, ID, Fields, Schema}).

node_query(Search, Opts) ->
    case ensure_started(Opts) of
        ok -> gen_server:call(?SERVER, {query, Search}, query_timeout(Opts));
        Error -> Error
    end.

start_link(Opts) ->
    gen_server:start_link({local, ?SERVER}, ?MODULE, Opts, []).

%% Requests can lazily start the node-scoped worker. Do not link that shared
%% worker to whichever short-lived request process happened to arrive first.
start(Opts) ->
    gen_server:start({local, ?SERVER}, ?MODULE, Opts, []).

init(Opts) ->
    application:ensure_all_started(inets),
    {ok, #{
        opts => Opts,
        config => search_config(Opts),
        pending => #{},
        timer => undefined,
        inflight => undefined
    }}.

handle_cast({index, ID, Fields, Schema}, State) ->
    case search_document(ID, Fields, Schema) of
        not_found ->
            {noreply, State};
        Document ->
            {noreply, queue_document(ID, Document, State)}
    end.

handle_call({ensure_config, Config}, _From, State = #{config := Config}) ->
    {reply, ok, State};
handle_call({ensure_config, _Config}, _From, State) ->
    {reply, {error, search_configuration_mismatch}, State};
handle_call({query, Search}, _From, State = #{opts := Opts}) ->
    Reply =
        case request(<<"POST">>, index_path(Opts, <<"/search">>), Search, Opts) of
            {ok, Raw} -> decode_search_response(Raw);
            Error -> Error
        end,
    {reply, Reply, State}.

handle_info({flush, Ref}, State = #{timer := {Ref, _Timer}}) ->
    {noreply, start_flush(State#{timer => undefined})};
handle_info({flush, _Ref}, State) ->
    {noreply, State};
handle_info({flush_result, Ref, Result}, State = #{inflight := {Ref, Batch}}) ->
    case Result of
        {ok, _} ->
            {noreply, schedule_flush(State#{inflight => undefined})};
        Error ->
            ?event(warning, {search_index_flush_failed, {result, Error}}),
            {noreply, retry_batch(Batch, State#{inflight => undefined})}
    end;
handle_info({flush_result, _Ref, _Result}, State) ->
    {noreply, State};
handle_info(_Info, State) ->
    {noreply, State}.

terminate(_Reason, _State) ->
    ok.

queue_document(ID, Document, State = #{pending := Pending, opts := Opts}) ->
    MaxPending = positive_int(hb_opts:get(<<"search-max-pending">>, 10000, Opts), 10000),
    case maps:is_key(ID, Pending) orelse map_size(Pending) < MaxPending of
        true ->
            Pending1 = Pending#{ID => {Document, 0}},
            maybe_flush(State#{pending => Pending1});
        false ->
            ?event(warning, {search_index_queue_full, {max_pending, MaxPending}}),
            State
    end.

maybe_flush(State = #{pending := Pending, opts := Opts, inflight := Inflight}) ->
    BatchSize = positive_int(hb_opts:get(<<"search-batch-size">>, 500, Opts), 500),
    case map_size(Pending) >= BatchSize andalso Inflight =:= undefined of
        true ->
            schedule_flush(State, 0);
        false ->
            schedule_flush(State)
    end.

schedule_flush(State) ->
    Opts = maps:get(opts, State),
    Delay = non_negative_int(hb_opts:get(<<"search-flush-ms">>, 50, Opts), 50),
    schedule_flush(State, Delay).

schedule_flush(State = #{pending := Pending, timer := Timer, inflight := Inflight}, Delay) ->
    case map_size(Pending) > 0 andalso Timer =:= undefined andalso Inflight =:= undefined of
        true ->
            Ref = make_ref(),
            TimerRef = erlang:send_after(Delay, self(), {flush, Ref}),
            State#{timer => {Ref, TimerRef}};
        false ->
            State
    end.

start_flush(State = #{inflight := Inflight}) when Inflight =/= undefined ->
    State;
start_flush(State = #{pending := Pending}) when map_size(Pending) =:= 0 ->
    State;
start_flush(State = #{pending := Pending, opts := Opts}) ->
    BatchSize = positive_int(hb_opts:get(<<"search-batch-size">>, 500, Opts), 500),
    {Batch, Rest} = split_batch(maps:to_list(Pending), BatchSize),
    Documents = [Document || {_ID, {Document, _Attempt}} <- Batch],
    Ref = make_ref(),
    Server = self(),
    spawn(fun() ->
        Result =
            try index_documents(Documents, Opts)
            catch
                Type:Reason -> {error, {Type, Reason}}
            end,
        Server ! {flush_result, Ref, Result}
    end),
    State#{pending => maps:from_list(Rest), inflight => {Ref, Batch}}.

index_documents(Documents, Opts) ->
    case request(
        <<"POST">>,
        index_path(Opts, <<"/documents?primaryKey=search_id">>),
        Documents,
        Opts
    ) of
        {ok, Raw} -> wait_for_task_response(Raw, Opts);
        Error -> Error
    end.

wait_for_task_response(Raw, Opts) ->
    case task_uid(Raw) of
        not_found -> {ok, Raw};
        TaskUID -> wait_for_task(TaskUID, erlang:monotonic_time(millisecond), Opts)
    end.

wait_for_task(TaskUID, StartedAt, Opts) ->
    Timeout = positive_int(hb_opts:get(<<"search-task-timeout">>, 10000, Opts), 10000),
    case erlang:monotonic_time(millisecond) - StartedAt > Timeout of
        true ->
            {error, {search_task_timeout, TaskUID}};
        false ->
            case request(<<"GET">>, <<"/tasks/", (integer_to_binary(TaskUID))/binary>>, <<>>, Opts) of
                {ok, Raw} ->
                    case task_status(Raw) of
                        succeeded -> {ok, Raw};
                        enqueued -> wait_for_task_after_delay(TaskUID, StartedAt, Opts);
                        processing -> wait_for_task_after_delay(TaskUID, StartedAt, Opts);
                        {failed, Error} -> {error, {search_task_failed, TaskUID, Error}};
                        {canceled, Error} -> {error, {search_task_canceled, TaskUID, Error}};
                        invalid -> {error, {invalid_search_task_response, Raw}}
                    end;
                Error -> Error
            end
    end.

wait_for_task_after_delay(TaskUID, StartedAt, Opts) ->
    Delay = positive_int(hb_opts:get(<<"search-task-poll-ms">>, 100, Opts), 100),
    timer:sleep(Delay),
    wait_for_task(TaskUID, StartedAt, Opts).

task_uid(Raw) ->
    case decode_json_map(Raw) of
        {ok, Msg} ->
            case maps:get(<<"taskUid">>, Msg, maps:get(<<"uid">>, Msg, not_found)) of
                UID when is_integer(UID), UID >= 0 -> UID;
                _ -> not_found
            end;
        _ -> not_found
    end.

task_status(Raw) ->
    case decode_json_map(Raw) of
        {ok, Msg} ->
            Error = maps:get(<<"error">>, Msg, Msg),
            case maps:get(<<"status">>, Msg, not_found) of
                <<"succeeded">> -> succeeded;
                <<"enqueued">> -> enqueued;
                <<"processing">> -> processing;
                <<"failed">> -> {failed, Error};
                <<"canceled">> -> {canceled, Error};
                _ -> invalid
            end;
        _ -> invalid
    end.

decode_json_map(Raw) ->
    try hb_json:decode(Raw) of
        Msg when is_map(Msg) -> {ok, Msg};
        _ -> {error, invalid_json}
    catch
        _:_ -> {error, invalid_json}
    end.

retry_batch(Batch, State = #{pending := Pending, opts := Opts}) ->
    MaxRetries = non_negative_int(hb_opts:get(<<"search-max-retries">>, 3, Opts), 3),
    MaxPending = positive_int(hb_opts:get(<<"search-max-pending">>, 10000, Opts), 10000),
    {Pending1, RetryAttempt, Dropped} = lists:foldl(
        fun({ID, {Document, Attempt}}, {Acc, MaxAttempt, DropCount}) ->
            NextAttempt = Attempt + 1,
            case maps:is_key(ID, Acc) of
                true ->
                    {Acc, MaxAttempt, DropCount};
                false when NextAttempt =< MaxRetries, map_size(Acc) < MaxPending ->
                    {Acc#{ID => {Document, NextAttempt}}, max(MaxAttempt, NextAttempt), DropCount};
                false ->
                    {Acc, MaxAttempt, DropCount + 1}
            end
        end,
        {Pending, 0, 0},
        Batch
    ),
    case Dropped > 0 of
        true -> ?event(warning, {search_index_documents_dropped, {count, Dropped}});
        false -> ok
    end,
    case RetryAttempt of
        0 ->
            schedule_flush(State#{pending => Pending1});
        _ ->
            BaseDelay = positive_int(hb_opts:get(<<"search-retry-ms">>, 100, Opts), 100),
            Delay = BaseDelay * (1 bsl min(RetryAttempt - 1, 10)),
            schedule_flush(State#{pending => Pending1}, Delay)
    end.

split_batch(Items, Limit) ->
    split_batch(Items, Limit, []).

split_batch(Rest, 0, Acc) ->
    {lists:reverse(Acc), Rest};
split_batch([], _Limit, Acc) ->
    {lists:reverse(Acc), []};
split_batch([Item | Rest], Limit, Acc) ->
    split_batch(Rest, Limit - 1, [Item | Acc]).

search_document(ID, Fields, Schema) when is_binary(ID), is_map(Fields) ->
    Indexable = indexable_fields(Fields, Schema),
    case map_size(Indexable) of
        0 -> not_found;
        _ ->
            maps:merge(
                Indexable,
                #{
                    <<"id">> => ID,
                    <<"search_id">> => hb_util:encode(crypto:hash(sha256, ID))
                }
            )
    end;
search_document(_ID, _Fields, _Schema) ->
    not_found.

indexable_fields(Fields, all) ->
    maps:filter(fun indexable_field/2, Fields);
indexable_fields(Fields, Schema) when is_list(Schema) ->
    Allowed = [hb_util:bin(Key) || Key <- Schema],
    maps:filter(
        fun(Key, Value) ->
            lists:member(Key, Allowed) andalso indexable_field(Key, Value)
        end,
        Fields
    );
indexable_fields(Fields, _Schema) ->
    indexable_fields(Fields, all).

indexable_field(Key, Value) ->
    indexable_value(Key, Value) andalso not skip_field(Key).

indexable_value(Key, Value) when is_binary(Key), is_binary(Value) ->
    printable(Value);
indexable_value(Key, Value) when is_binary(Key), is_integer(Value) ->
    true;
indexable_value(Key, Value) when is_binary(Key), is_float(Value) ->
    true;
indexable_value(Key, Value)
        when is_binary(Key), (Value =:= true orelse Value =:= false) ->
    true;
indexable_value(_Key, _Value) ->
    false.

skip_field(<<"commitment">>) -> true;
skip_field(<<"commitments">>) -> true;
skip_field(<<"id">>) -> true;
skip_field(<<"priv">>) -> true;
skip_field(<<"raw">>) -> true;
skip_field(<<"search_id">>) -> true;
skip_field(<<"signature">>) -> true;
skip_field(<<"signature-input">>) -> true;
skip_field(Key) ->
    byte_size(Key) >= 5 andalso binary:part(Key, 0, 5) =:= <<"priv.">>.

printable(Value) ->
    try unicode:characters_to_binary(Value, utf8, utf8) of
        Value -> true;
        _ -> false
    catch
        _:_ -> false
    end.

request(Method, Path, Body, Opts) ->
    URL = binary_to_list(<<(backend_url(Opts))/binary, Path/binary>>),
    Headers = [
        {"accept", "application/json"},
        {"content-type", "application/json"}
        | authorization_header(Opts)
    ],
    HTTPOpts = [
        {connect_timeout, hb_opts:get(<<"search-connect-timeout">>, 1000, Opts)},
        {timeout, hb_opts:get(<<"search-recv-timeout">>, 2000, Opts)}
    ],
    Encoded = hb_json:encode(Body),
    HTTPRequest = case Method of
        <<"GET">> -> {URL, Headers};
        _ -> {URL, Headers, "application/json", Encoded}
    end,
    case httpc:request(
        method_atom(Method),
        HTTPRequest,
        HTTPOpts,
        [{body_format, binary}]
    ) of
        {ok, {{_, Status, _}, _Headers, Response}} when Status >= 200, Status < 300 ->
            {ok, Response};
        {ok, {{_, Status, _}, _Headers, Response}} ->
            {error, #{<<"status">> => Status, <<"body">> => Response}};
        {error, Reason} ->
            {error, Reason}
    end.

decode_search_response(Raw) ->
    try hb_json:decode(Raw) of
        Response when is_map(Response) ->
            Hits = maps:get(<<"hits">>, Response, []),
            IDs = [
                ID
            || Hit <- Hits,
                is_map(Hit),
                ID <- [maps:get(<<"id">>, Hit, not_found)],
                is_binary(ID)
            ],
            {ok, #{
                <<"ids">> => IDs,
                <<"total">> => search_total(Response, length(IDs))
            }};
        _ ->
            {error, invalid_search_response}
    catch
        _:_ -> {error, invalid_search_response}
    end.

search_total(Response, Default) ->
    maps:get(
        <<"estimatedTotalHits">>,
        Response,
        maps:get(<<"totalHits">>, Response, Default)
    ).

index_path(Opts, Suffix) ->
    <<"/indexes/", (index_name(Opts))/binary, Suffix/binary>>.

index_name(Opts) ->
    hb_util:bin(hb_opts:get(<<"search-index">>, ?DEFAULT_INDEX, Opts)).

backend_url(Opts) ->
    trim_trailing_slash(
        hb_util:bin(
            hb_opts:get(
                <<"search-backend-url">>,
                hb_opts:get(<<"odysee-search-backend-url">>, ?DEFAULT_BACKEND_URL, Opts),
                Opts
            )
        )
    ).

search_config(Opts) ->
    APIKey = hb_util:bin(
        hb_opts:get(
            <<"search-api-key">>,
            hb_opts:get(<<"odysee-search-api-key">>, <<>>, Opts),
            Opts
        )
    ),
    #{
        backend_url => backend_url(Opts),
        index => index_name(Opts),
        api_key_hash => crypto:hash(sha256, APIKey),
        batch_size => positive_int(hb_opts:get(<<"search-batch-size">>, 500, Opts), 500),
        connect_timeout => hb_opts:get(<<"search-connect-timeout">>, 1000, Opts),
        flush_ms => non_negative_int(hb_opts:get(<<"search-flush-ms">>, 50, Opts), 50),
        max_pending => positive_int(hb_opts:get(<<"search-max-pending">>, 10000, Opts), 10000),
        max_retries => non_negative_int(hb_opts:get(<<"search-max-retries">>, 3, Opts), 3),
        recv_timeout => hb_opts:get(<<"search-recv-timeout">>, 2000, Opts),
        retry_ms => positive_int(hb_opts:get(<<"search-retry-ms">>, 100, Opts), 100),
        task_poll_ms => positive_int(hb_opts:get(<<"search-task-poll-ms">>, 100, Opts), 100),
        task_timeout => positive_int(hb_opts:get(<<"search-task-timeout">>, 10000, Opts), 10000)
    }.

authorization_header(Opts) ->
    case hb_opts:get(
        <<"search-api-key">>,
        hb_opts:get(<<"odysee-search-api-key">>, <<>>, Opts),
        Opts
    ) of
        <<>> -> [];
        Key -> [{"authorization", binary_to_list(<<"Bearer ", (hb_util:bin(Key))/binary>>)}]
    end.

method_atom(<<"GET">>) -> get;
method_atom(<<"POST">>) -> post.

query_timeout(Opts) ->
    hb_opts:get(<<"search-recv-timeout">>, 2000, Opts) + 1000.

positive_int(Value, _Default) when is_integer(Value), Value > 0 -> Value;
positive_int(_Value, Default) -> Default.

non_negative_int(Value, _Default) when is_integer(Value), Value >= 0 -> Value;
non_negative_int(_Value, Default) -> Default.

trim_trailing_slash(<<>>) -> <<>>;
trim_trailing_slash(Bin) ->
    case byte_size(Bin) > 1 andalso binary:last(Bin) =:= $/ of
        true -> trim_trailing_slash(binary:part(Bin, 0, byte_size(Bin) - 1));
        false -> Bin
    end.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

indexable_fields_skip_structural_and_binary_test() ->
    Fields = indexable_fields(
        #{
            <<"title">> => <<"Searchable">>,
            <<"signature">> => <<"secret">>,
            <<"priv.token">> => <<"secret">>,
            <<"raw">> => <<0, 255>>,
            <<"count">> => 1,
            <<"score">> => 1.5,
            <<"visible">> => true
        },
        all
    ),
    ?assertEqual(
        #{
            <<"title">> => <<"Searchable">>,
            <<"count">> => 1,
            <<"score">> => 1.5,
            <<"visible">> => true
        },
        Fields
    ).

schema_restricts_indexed_fields_test() ->
    Fields = indexable_fields(
        #{<<"title">> => <<"Visible">>, <<"description">> => <<"Hidden">>},
        [<<"title">>]
    ),
    ?assertEqual(#{<<"title">> => <<"Visible">>}, Fields).

schema_cannot_enable_private_fields_test() ->
    Fields = indexable_fields(
        #{<<"title">> => <<"Visible">>, <<"priv.token">> => <<"Secret">>},
        [<<"title">>, <<"priv.token">>]
    ),
    ?assertEqual(#{<<"title">> => <<"Visible">>}, Fields).

search_document_preserves_exact_id_test() ->
    ID = <<"transaction:7">>,
    Document = search_document(ID, #{<<"title">> => <<"Indexed">>}, all),
    ?assertEqual(ID, maps:get(<<"id">>, Document)),
    ?assertNotEqual(ID, maps:get(<<"search_id">>, Document)).

search_document_ids_are_collision_safe_test() ->
    First = search_document(<<"abc:def">>, #{<<"title">> => <<"First">>}, all),
    Second = search_document(<<"abc_def">>, #{<<"title">> => <<"Second">>}, all),
    ?assertNotEqual(maps:get(<<"search_id">>, First), maps:get(<<"search_id">>, Second)).

search_config_normalizes_defaults_and_rejects_target_changes_test() ->
    Default = search_config(#{}),
    Explicit = search_config(#{
        <<"search-backend-url">> => <<"http://127.0.0.1:7700/">>,
        <<"search-index">> => <<"hyperbeam_messages">>
    }),
    OtherIndex = search_config(#{<<"search-index">> => <<"other">>}),
    ?assertEqual(Default, Explicit),
    ?assertNotEqual(Default, OtherIndex),
    ?assertEqual(false, maps:is_key(search_api_key, Default)).

meilisearch_task_response_test() ->
    ?assertEqual(42, task_uid(hb_json:encode(#{ <<"taskUid">> => 42 }))),
    ?assertEqual(not_found, task_uid(hb_json:encode(#{ <<"status">> => <<"succeeded">> }))),
    ?assertEqual(succeeded, task_status(hb_json:encode(#{ <<"status">> => <<"succeeded">> }))),
    ?assertEqual(processing, task_status(hb_json:encode(#{ <<"status">> => <<"processing">> }))),
    ?assertMatch(
        {failed, _},
        task_status(hb_json:encode(#{ <<"status">> => <<"failed">>, <<"error">> => #{ <<"code">> => <<"bad">> } }))
    ),
    ?assertEqual(invalid, task_status(<<"not-json">>)).

queue_coalesces_newer_document_test() ->
    State0 = #{
        opts => #{<<"search-flush-ms">> => 60000},
        pending => #{},
        timer => undefined,
        inflight => undefined
    },
    State1 = queue_document(<<"id">>, #{<<"title">> => <<"Old">>}, State0),
    State2 = queue_document(<<"id">>, #{<<"title">> => <<"New">>}, State1),
    {Document, 0} = maps:get(<<"id">>, maps:get(pending, State2)),
    ?assertEqual(<<"New">>, maps:get(<<"title">>, Document)),
    cancel_timer(State2).

retry_does_not_replace_newer_pending_document_test() ->
    Older = #{<<"title">> => <<"Old">>},
    Newer = #{<<"title">> => <<"New">>},
    State0 = #{
        opts => #{<<"search-flush-ms">> => 60000},
        pending => #{<<"id">> => {Newer, 0}},
        timer => undefined,
        inflight => undefined
    },
    State1 = retry_batch([{<<"id">>, {Older, 0}}], State0),
    ?assertEqual({Newer, 0}, maps:get(<<"id">>, maps:get(pending, State1))),
    cancel_timer(State1).

retry_is_bounded_test() ->
    State0 = #{
        opts => #{<<"search-max-retries">> => 1},
        pending => #{},
        timer => undefined,
        inflight => undefined
    },
    State1 = retry_batch([{<<"id">>, {#{<<"title">> => <<"Old">>}, 1}}], State0),
    ?assertEqual(#{}, maps:get(pending, State1)).

cancel_timer(#{timer := {_Ref, TimerRef}}) ->
    erlang:cancel_timer(TimerRef),
    ok;
cancel_timer(_State) ->
    ok.

decode_search_response_returns_ids_only_test() ->
    Raw = hb_json:encode(#{
        <<"hits">> => [
            #{<<"id">> => <<"first">>, <<"title">> => <<"Private backend data">>},
            #{<<"id">> => <<"second">>}
        ],
        <<"estimatedTotalHits">> => 2
    }),
    {ok, Result} = decode_search_response(Raw),
    ?assertEqual([<<"first">>, <<"second">>], maps:get(<<"ids">>, Result)),
    ?assertEqual(false, maps:is_key(<<"hits">>, Result)).

-endif.
