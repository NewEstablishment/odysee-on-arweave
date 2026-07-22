%%% @doc Odysee search device backed by a local search engine.
-module(dev_odysee_search).
-implements(<<"odysee-search@1.0">>).
-export([info/1, query/3, index/3, delete/3, status/3, schema/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-search@1.0">>).
-define(DEFAULT_BACKEND_URL, <<"http://127.0.0.1:7700">>).
-define(DEFAULT_INDEX, <<"odysee_claims">>).
-define(RECONCILE_SCHEDULE_KEY, {?MODULE, native_search_reconcile_scheduled_at}).
-define(RECONCILE_WORKER, dev_odysee_search_reconcile_worker).

info(_Opts) ->
    #{ exports => [<<"query">>, <<"index">>, <<"delete">>, <<"status">>, <<"schema">>] }.

query(Base, Req, Opts) ->
    safe(fun() ->
        _ = schedule_pending_native_search_reconcile(Opts),
        Params = params(Base, Req, Opts),
        Search = meili_search_body(Params, Opts),
        maybe
            {ok, Raw} ?= meili_post(index_path(Params, Opts, <<"/search">>), Search, Base, Req, Opts),
            {ok, Decoded} ?= try_decode_json(Raw),
            Internal = maybe_merge_legacy_claim_search(
                normalize_search_response(Decoded, Params, Opts),
                Params,
                Opts
            ),
            Result = id_only_search_response(Internal, Opts),
            ok_json(Result#{ <<"request">> => Search })
        else
            Error -> device_error(Error)
        end
    end).

index(Base, Req, Opts) ->
    safe(fun() ->
        Params = params(Base, Req, Opts),
        Docs = documents(Params, Opts),
        ok = cleanup_legacy_document_ids(Docs, Params, Base, Req, Opts),
        maybe
            {ok, Task} ?= meili_post_task(
                index_path(Params, Opts, <<"/documents?primaryKey=search_id">>),
                Docs,
                Base,
                Req,
                Opts
            ),
            ok_json(#{ <<"task">> => Task, <<"documents">> => document_count(Docs) })
        else
            Error -> device_error(Error)
        end
    end).

delete(Base, Req, Opts) ->
    safe(fun() ->
        Params = params(Base, Req, Opts),
        case ids(Params, Opts) of
            IDs when is_list(IDs), length(IDs) > 0 ->
                maybe
                    {ok, Task} ?= meili_post_task(
                        index_path(Params, Opts, <<"/documents/delete-batch">>),
                        search_ids(IDs),
                        Base,
                        Req,
                        Opts
                    ),
                    ok_json(#{ <<"task">> => Task, <<"deleted">> => IDs })
                else
                    Error -> device_error(Error)
                end;
            _ ->
                json_error(400, <<"missing id or ids">>)
        end
    end).

status(Base, Req, Opts) ->
    safe(fun() ->
        Params = params(Base, Req, Opts),
        Health =
            case meili_get(<<"/health">>, Base, Req, Opts) of
                {ok, HealthRaw} -> decode_or_raw(HealthRaw);
                Error -> Error
            end,
        Stats =
            case meili_get(index_path(Params, Opts, <<"/stats">>), Base, Req, Opts) of
                {ok, StatsRaw} -> decode_or_raw(StatsRaw);
                Error2 -> Error2
            end,
        ok_json(#{
            <<"backend">> => <<"meilisearch">>,
            <<"backend-url">> => backend_url(Base, Req, Opts),
            <<"index">> => index_name(Params, Opts),
            <<"health">> => Health,
            <<"stats">> => Stats
        })
    end).

schema(Base, Req, Opts) ->
    safe(fun() ->
        Params = params(Base, Req, Opts),
        ok_json(#{
            <<"index">> => index_name(Params, Opts),
            <<"primary-key">> => <<"search_id">>,
            <<"document-id">> => <<"immutable id for native uploads, legacy txid:vout for legacy claim outputs">>,
            <<"filterable-attributes">> => filterable_attributes(),
            <<"sortable-attributes">> => sortable_attributes(),
            <<"searchable-attributes">> => searchable_attributes(),
            <<"ranking-note">> => <<"start with Odysee-compatible text/filter search; tune ranking after legacy corpus import">>
        })
    end).

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> device_error({error, Reason});
        _:Reason -> device_error({error, Reason})
    end.

params(Base, Req, Opts) ->
    hb_cache:ensure_all_loaded(maps:merge(map_or_empty(Base), map_or_empty(Req)), Opts).

meili_search_body(Params, Opts) ->
    Body0 = #{
        <<"q">> => query_text(Params, Opts),
        <<"limit">> => page_size(Params, Opts),
        <<"offset">> => offset(Params, Opts),
        <<"attributesToRetrieve">> => attributes_to_retrieve(Params, Opts)
    },
    Body1 = maybe_put(<<"filter">>, filters(Params, Opts), Body0),
    maybe_put(<<"sort">>, sorts(Params, Opts), Body1).

normalize_search_response(Msg, Params, Opts) when is_map(Msg) ->
    Hits0 = hb_maps:get(<<"hits">>, Msg, [], Opts),
    Hits1 = filter_filename_query_hits(Hits0, Params, Opts),
    Hits = filter_stale_native_hits(Hits1, Opts),
    Limit = hb_maps:get(<<"limit">>, Msg, page_size(Params, Opts), Opts),
    Offset = hb_maps:get(<<"offset">>, Msg, offset(Params, Opts), Opts),
    Total = first_value([<<"estimatedTotalHits">>, <<"totalHits">>], Msg, Opts),
    Removed = length_or_zero(Hits0) - length_or_zero(Hits),
    #{
        <<"device">> => ?DEVICE,
        <<"backend">> => <<"meilisearch">>,
        <<"items">> => Hits,
        <<"claim-ids">> => claim_ids_from_hits(Hits, Opts),
        <<"total-items">> => max(0, value_or(Total, length_or_zero(Hits)) - Removed),
        <<"page">> => page_from_offset(Offset, Limit),
        <<"page-size">> => Limit,
        <<"raw">> => Msg#{ <<"hits">> => Hits }
    };
normalize_search_response(Other, _Params, _Opts) ->
    #{ <<"device">> => ?DEVICE, <<"backend">> => <<"meilisearch">>, <<"raw">> => Other }.

%% Search establishes order and returns locators. Product data is loaded from
%% the immutable stores by the caller; backend documents never cross this
%% boundary as claim objects.
id_only_search_response(Result, Opts) when is_map(Result) ->
    Hits = list_or_empty(hb_maps:get(<<"items">>, Result, [], Opts)),
    IDs = immutable_ids_from_hits(Hits, Opts),
    maps:without(
        [<<"raw">>, <<"claim-ids">>],
        Result#{
            <<"items">> => IDs,
            <<"ids">> => IDs,
            <<"total-items">> => max(
                length(IDs),
                value_or(hb_maps:get(<<"total-items">>, Result, not_found, Opts), length(IDs))
            )
        }
    );
id_only_search_response(Other, _Opts) ->
    Other.

immutable_ids_from_hits(Hits, Opts) when is_list(Hits) ->
    lists:filtermap(
        fun(Hit) ->
            case immutable_search_id(Hit, Opts) of
                not_found -> false;
                ID -> {true, ID}
            end
        end,
        Hits
    );
immutable_ids_from_hits(_Hits, _Opts) ->
    [].

immutable_search_id(Hit, Opts) when is_map(Hit) ->
    case first_value(
        [
            <<"immutable_id">>,
            <<"immutable-id">>,
            <<"legacy_outpoint">>,
            <<"legacy-outpoint">>,
            <<"doc_id">>,
            <<"doc-id">>
        ],
        Hit,
        Opts
    ) of
        ID when is_binary(ID), ID =/= <<>> -> ID;
        _ -> native_claim_id(Hit, Opts)
    end;
immutable_search_id(ID, _Opts) when is_binary(ID), ID =/= <<>> ->
    ID;
immutable_search_id(_Hit, _Opts) ->
    not_found.

native_claim_id(Hit, Opts) ->
    case {
        native_hit(Hit, Opts),
        first_value([<<"claim_id">>, <<"claim-id">>], Hit, Opts)
    } of
        {true, ID} when is_binary(ID), ID =/= <<>> -> ID;
        _ -> not_found
    end.

maybe_merge_legacy_claim_search(Result, Params, Opts) ->
    case first_value([<<"channel_ids">>, <<"channel-ids">>, <<"channel_id">>, <<"channel-id">>], Params, Opts) of
        not_found ->
            Result;
        _ ->
            case hb_ao:raw(<<"odysee-claim@1.0">>, <<"search">>, #{}, legacy_claim_search_params(Params, Opts), Opts) of
                {ok, Legacy0} ->
                    Legacy = search_result_payload(Legacy0, Opts),
                    merge_legacy_search_result(Result, Legacy, Params, Opts);
                _ ->
                    Result
            end
    end.

legacy_claim_search_params(Params, Opts) ->
    maps:without(
        [<<"backend-url">>, <<"backend_url">>, <<"meili-url">>, <<"meili_url">>, <<"api-key">>, <<"api_key">>, <<"meili-key">>, <<"meili_key">>, <<"search-index">>, <<"search_index">>, <<"meili-index">>, <<"meili_index">>],
        Params#{
            <<"page_size">> => page_size(Params, Opts),
            <<"page">> => page(Params, Opts)
        }
    ).

search_result_payload(Msg, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"result">>, Msg, not_found, Opts) of
        Result when is_map(Result) -> Result;
        _ -> Msg
    end;
search_result_payload(Msg, _Opts) ->
    Msg.

merge_legacy_search_result(Result, Legacy, Params, Opts) when is_map(Legacy) ->
    NativeItems = list_or_empty(hb_maps:get(<<"items">>, Result, [], Opts)),
    LegacyItems = list_or_empty(hb_maps:get(<<"items">>, Legacy, [], Opts)),
    Items = sort_search_items(unique_search_items(LegacyItems ++ NativeItems, Opts), Params, Opts),
    Result#{
        <<"items">> => Items,
        <<"claim-ids">> => claim_ids_from_hits(Items, Opts),
        <<"total-items">> => max(value_or(hb_maps:get(<<"total-items">>, Result, not_found, Opts), 0), length(Items)),
        <<"legacy-items">> => length(LegacyItems)
    };
merge_legacy_search_result(Result, _Legacy, _Params, _Opts) ->
    Result.

list_or_empty(Value) when is_list(Value) -> Value;
list_or_empty(_Value) -> [].

unique_search_items(Items, Opts) ->
    {Unique, _Seen} =
        lists:foldl(
            fun(Item, {Acc, Seen}) ->
                Key = search_item_key(Item, Opts),
                case sets:is_element(Key, Seen) of
                    true -> {Acc, Seen};
                    false -> {[Item | Acc], sets:add_element(Key, Seen)}
                end
            end,
            {[], sets:new([{version, 2}])},
            Items
        ),
    lists:reverse(Unique).

search_item_key(Item, Opts) when is_map(Item) ->
    first_value([<<"claim_id">>, <<"claim-id">>, <<"immutable_id">>, <<"immutable-id">>, <<"doc_id">>, <<"doc-id">>], Item, <<"">>, Opts);
search_item_key(Item, _Opts) ->
    hb_util:bin(Item).

sort_search_items(Items, Params, Opts) ->
    case normalize_sorts(list_value(value_or(first_value([<<"sort">>, <<"sort_by">>, <<"sort-by">>, <<"order_by">>, <<"order-by">>, <<"order">>], Params, Opts), [<<"release_time">>])), Params, Opts) of
        [Sort | _] -> sort_search_items_by(Sort, Items, Opts);
        [] -> Items
    end.

sort_search_items_by(<<"release_time:asc">>, Items, Opts) ->
    lists:sort(fun(A, B) -> item_time(A, Opts) =< item_time(B, Opts) end, Items);
sort_search_items_by(<<"release_time:desc">>, Items, Opts) ->
    lists:sort(fun(A, B) -> item_time(A, Opts) >= item_time(B, Opts) end, Items);
sort_search_items_by(<<"created_at:asc">>, Items, Opts) ->
    lists:sort(fun(A, B) -> item_time(A, Opts) =< item_time(B, Opts) end, Items);
sort_search_items_by(<<"created_at:desc">>, Items, Opts) ->
    lists:sort(fun(A, B) -> item_time(A, Opts) >= item_time(B, Opts) end, Items);
sort_search_items_by(_Sort, Items, _Opts) ->
    Items.

item_time(Item, Opts) when is_map(Item) ->
    parse_int(first_value([<<"release_time">>, <<"release-time">>, <<"timestamp">>, <<"transaction_time">>, <<"transaction-time">>, <<"created_at">>, <<"created-at">>], Item, Opts), 0);
item_time(_Item, _Opts) ->
    0.

filter_filename_query_hits(Hits, Params, Opts) when is_list(Hits) ->
    Terms = filename_query_terms(query_text(Params, Opts)),
    case Terms of
        [] -> Hits;
        _ -> [Hit || Hit <- Hits, filename_hit_matches(Hit, Terms, Opts)]
    end;
filter_filename_query_hits(Hits, _Params, _Opts) ->
    Hits.

filename_query_terms(Query0) ->
    Query = hb_util:bin(Query0),
    case binary:match(Query, [<<".">>, <<"_">>]) of
        nomatch -> [];
        _ ->
            Terms = [
                Term
             || Term <- binary:split(normalized_search_text(Query), <<" ">>, [global]),
                byte_size(Term) >= 2,
                not lists:member(Term, [<<"mp4">>, <<"mkv">>, <<"mov">>, <<"webm">>, <<"avi">>])
            ],
            case length(Terms) >= 2 of
                true -> Terms;
                false -> []
            end
    end.

filename_hit_matches(Hit, Terms, Opts) ->
    Text = normalized_search_text(
        join_with(
            [
                hit_text(<<"title">>, Hit, Opts),
                hit_text(<<"name">>, Hit, Opts),
                hit_text(<<"source_name">>, Hit, Opts),
                hit_text(<<"searchable_name">>, Hit, Opts),
                hit_text(<<"stripped_name">>, Hit, Opts),
                hit_text(<<"description">>, Hit, Opts)
            ],
            <<" ">>
        )
    ),
    lists:all(fun(Term) -> binary:match(Text, Term) =/= nomatch end, Terms).

hit_text(Key, Hit, Opts) ->
    case hb_maps:get(Key, Hit, <<>>, Opts) of
        Value when is_binary(Value) -> Value;
        Value when is_integer(Value) -> integer_to_binary(Value);
        Value when is_float(Value) -> hb_util:bin(io_lib:format("~p", [Value]));
        _ -> <<>>
    end.

normalized_search_text(Value0) ->
    Value = hb_util:to_lower(hb_util:bin(Value0)),
    lists:foldl(
        fun(Sep, Acc) -> binary:replace(Acc, Sep, <<" ">>, [global]) end,
        Value,
        [<<".">>, <<"_">>, <<"-">>, <<"(">>, <<")">>, <<"[">>, <<"]">>, <<"/">>, <<"\\">>]
    ).

filter_stale_native_hits(Hits, Opts) when is_list(Hits) ->
    case native_upload_ids(Opts) of
        all -> Hits;
        UploadIDs ->
            [
                Hit
             || Hit <- Hits,
                not native_hit(Hit, Opts) orelse sets:is_element(hit_id(Hit, Opts), UploadIDs)
            ]
    end;
filter_stale_native_hits(Hits, _Opts) ->
    Hits.

native_upload_ids(Opts) ->
    Store = hb_opts:get(store, [], Opts),
    case hb_store:read(Store, native_upload_list_path(), maps:without([<<"store">>, store], Opts)) of
        {ok, Bin} when is_binary(Bin) -> native_upload_ids_from_json(Bin);
        Bin when is_binary(Bin) -> native_upload_ids_from_json(Bin);
        _ ->
            all
    end.

native_upload_ids_from_json(Bin) ->
    try hb_json:decode(Bin) of
        IDs when is_list(IDs) ->
            sets:from_list([hb_util:bin(ID) || ID <- IDs, is_binary(ID), ID =/= <<>>], [{version, 2}]);
        #{ <<"ids">> := IDs } when is_list(IDs) ->
            sets:from_list([hb_util:bin(ID) || ID <- IDs, is_binary(ID), ID =/= <<>>], [{version, 2}]);
        _ ->
            all
    catch
        _:_ -> all
    end.

native_upload_list_path() ->
    <<"odysee/upload/list/all/", (hb_util:encode(hb_crypto:sha256(<<"all">>)))/binary>>.

reconcile_pending_native_search(Opts) ->
    try
        case hb_ao:raw(
            <<"odysee-upload@1.0">>,
            <<"reconcile">>,
            #{},
            #{ <<"limit">> => hb_opts:get(<<"odysee-search-reconcile-limit">>, 20, Opts) },
            Opts
        ) of
            {ok, _} -> ok;
            Error -> Error
        end
    catch
        Class:Reason -> {error, {Class, Reason}}
    end.

%% Search availability should help drain derivative indexing failures, but a
%% public query must not synchronously replay the queue or start one replay per
%% concurrent request. Schedule at most one node-local replay per interval and
%% keep it off the query latency path.
schedule_pending_native_search_reconcile(Opts) ->
    Interval = clamp_int(
        hb_opts:get(<<"odysee-search-reconcile-interval-ms">>, 5000, Opts),
        5000,
        1000,
        300000
    ),
    global:trans(
        {{?MODULE, native_search_reconcile_scheduler}, self()},
        fun() ->
            Now = erlang:monotonic_time(millisecond),
            Last = persistent_term:get(?RECONCILE_SCHEDULE_KEY, Now - Interval),
            case Now - Last >= Interval andalso whereis(?RECONCILE_WORKER) =:= undefined of
                true ->
                    start_pending_native_search_reconcile(Now, Opts);
                false ->
                    ok
            end
        end,
        [node()]
    ).

start_pending_native_search_reconcile(Now, Opts) ->
    Worker = spawn(fun() ->
        receive
            {reconcile, WorkerOpts} ->
                _ = reconcile_pending_native_search(WorkerOpts),
                ok;
            stop ->
                ok
        end
    end),
    case catch register(?RECONCILE_WORKER, Worker) of
        true ->
            persistent_term:put(?RECONCILE_SCHEDULE_KEY, Now),
            Worker ! {reconcile, Opts},
            ok;
        _ ->
            Worker ! stop,
            ok
    end.

native_hit(Hit, Opts) when is_map(Hit) ->
    first_value([<<"source_system">>, <<"source-system">>], Hit, Opts) =:= <<"hyperbeam-native">>;
native_hit(_Hit, _Opts) ->
    false.

hit_id(Hit, Opts) when is_map(Hit) ->
    case first_value([<<"immutable_id">>, <<"immutable-id">>, <<"claim_id">>, <<"claim-id">>, <<"doc_id">>, <<"doc-id">>], Hit, Opts) of
        not_found -> <<>>;
        ID -> hb_util:bin(ID)
    end;
hit_id(_Hit, _Opts) ->
    <<>>.

meili_get(Path, Base, Req, Opts) ->
    meili_request(<<"GET">>, Path, <<>>, Base, Req, Opts).

meili_post(Path, Body, Base, Req, Opts) ->
    meili_request(<<"POST">>, Path, hb_json:encode(Body), Base, Req, Opts).

meili_post_task(Path, Body, Base, Req, Opts) ->
    maybe
        {ok, Raw} ?= meili_post(Path, Body, Base, Req, Opts),
        {ok, Submitted} ?= try_decode_json(Raw),
        TaskUID ?= meili_task_uid(Submitted),
        wait_for_meili_task(TaskUID, erlang:monotonic_time(millisecond), Base, Req, Opts)
    else
        not_found -> {error, invalid_meilisearch_task};
        Error -> Error
    end.

wait_for_meili_task(TaskUID, StartedAt, Base, Req, Opts) ->
    Timeout = clamp_int(
        hb_opts:get(<<"odysee-search-task-timeout">>, 10000, Opts),
        10000,
        1,
        300000
    ),
    case erlang:monotonic_time(millisecond) - StartedAt > Timeout of
        true ->
            {error, {meilisearch_task_timeout, TaskUID}};
        false ->
            maybe
                {ok, Raw} ?= meili_get(<<"/tasks/", (integer_to_binary(TaskUID))/binary>>, Base, Req, Opts),
                {ok, Task} ?= try_decode_json(Raw),
                wait_for_meili_task_status(TaskUID, StartedAt, Task, Base, Req, Opts)
            else
                Error -> Error
            end
    end.

wait_for_meili_task_status(_TaskUID, _StartedAt, Task, _Base, _Req, _Opts)
        when is_map(Task), map_get(<<"status">>, Task) =:= <<"succeeded">> ->
    {ok, Task};
wait_for_meili_task_status(TaskUID, StartedAt, Task, Base, Req, Opts) when is_map(Task) ->
    case hb_maps:get(<<"status">>, Task, not_found, Opts) of
        <<"enqueued">> -> wait_for_meili_task_after_delay(TaskUID, StartedAt, Base, Req, Opts);
        <<"processing">> -> wait_for_meili_task_after_delay(TaskUID, StartedAt, Base, Req, Opts);
        <<"failed">> -> {error, {meilisearch_task_failed, TaskUID, hb_maps:get(<<"error">>, Task, Task, Opts)}};
        <<"canceled">> -> {error, {meilisearch_task_canceled, TaskUID, hb_maps:get(<<"error">>, Task, Task, Opts)}};
        _ -> {error, {invalid_meilisearch_task, Task}}
    end;
wait_for_meili_task_status(_TaskUID, _StartedAt, Task, _Base, _Req, _Opts) ->
    {error, {invalid_meilisearch_task, Task}}.

wait_for_meili_task_after_delay(TaskUID, StartedAt, Base, Req, Opts) ->
    Delay = clamp_int(
        hb_opts:get(<<"odysee-search-task-poll-ms">>, 100, Opts),
        100,
        1,
        10000
    ),
    timer:sleep(Delay),
    wait_for_meili_task(TaskUID, StartedAt, Base, Req, Opts).

meili_task_uid(Task) when is_map(Task) ->
    case maps:get(<<"taskUid">>, Task, maps:get(<<"uid">>, Task, not_found)) of
        UID when is_integer(UID), UID >= 0 -> UID;
        _ -> not_found
    end;
meili_task_uid(_Task) ->
    not_found.

meili_request(Method, Path, Body, Base, Req, Opts) ->
    application:ensure_all_started(inets),
    URL = binary_to_list(<<(backend_url(Base, Req, Opts))/binary, Path/binary>>),
    Headers = [
        {"accept", "application/json"},
        {"content-type", "application/json"}
        | authorization_header(Base, Req, Opts)
    ],
    HTTPOpts = [
        {connect_timeout, hb_opts:get(<<"odysee-search-connect-timeout">>, 1000, Opts)},
        {timeout, hb_opts:get(<<"odysee-search-recv-timeout">>, 2000, Opts)}
    ],
    Opts0 = [{body_format, binary}],
    Request =
        case Method of
            <<"GET">> -> {URL, Headers};
            _ -> {URL, Headers, "application/json", Body}
        end,
    case httpc:request(method_atom(Method), Request, HTTPOpts, Opts0) of
        {ok, {{_, Status, _}, _RespHeaders, RespBody}} when Status >= 200, Status < 300 ->
            {ok, RespBody};
        {ok, {{_, Status, _}, _RespHeaders, RespBody}} ->
            {error, #{ <<"status">> => Status, <<"body">> => RespBody }};
        {error, Reason} ->
            {error, Reason}
    end.

method_atom(<<"GET">>) -> get;
method_atom(<<"POST">>) -> post.

backend_url(Base, Req, Opts) ->
    trim_trailing_slash(
        value_or(
            first_value([<<"backend-url">>, <<"backend_url">>, <<"meili-url">>, <<"meili_url">>], maps:merge(map_or_empty(Base), map_or_empty(Req)), Opts),
            hb_opts:get(<<"odysee-search-backend-url">>, ?DEFAULT_BACKEND_URL, Opts)
        )
    ).

authorization_header(Base, Req, Opts) ->
    case value_or(
        first_value([<<"api-key">>, <<"api_key">>, <<"meili-key">>, <<"meili_key">>], maps:merge(map_or_empty(Base), map_or_empty(Req)), Opts),
        hb_opts:get(<<"odysee-search-api-key">>, <<>>, Opts)
    ) of
        <<>> -> [];
        Key -> [{"authorization", binary_to_list(<<"Bearer ", (hb_util:bin(Key))/binary>>)}]
    end.

index_path(Params, Opts, Suffix) ->
    <<"/indexes/", (index_name(Params, Opts))/binary, Suffix/binary>>.

index_name(Params, Opts) ->
    hb_util:bin(value_or(first_value([<<"search-index">>, <<"search_index">>, <<"meili-index">>, <<"meili_index">>], Params, Opts), ?DEFAULT_INDEX)).

query_text(Params, Opts) ->
    hb_util:bin(value_or(first_value([<<"q">>, <<"query">>, <<"s">>, <<"text">>], Params, Opts), <<"">>)).

page_size(Params, Opts) ->
    clamp_int(first_value([<<"limit">>, <<"page_size">>, <<"page-size">>, <<"size">>], Params, Opts), 20, 1, 100).

offset(Params, Opts) ->
    case first_value([<<"offset">>, <<"from">>], Params, Opts) of
        not_found ->
            (page(Params, Opts) - 1) * page_size(Params, Opts);
        Value ->
            clamp_int(Value, 0, 0, 1000000)
    end.

page(Params, Opts) ->
    clamp_int(first_value([<<"page">>], Params, Opts), 1, 1, 1000000).

attributes_to_retrieve(Params, Opts) ->
    case first_value([<<"attributes">>, <<"attributes-to-retrieve">>, <<"attributes_to_retrieve">>], Params, Opts) of
        not_found -> [<<"*">>];
        Value -> list_value(Value)
    end.

filters(Params, Opts) ->
    Parts = lists:flatten([
        visibility_filters(Params, Opts),
        enum_filter(<<"claim_id">>, first_value([<<"claim_ids">>, <<"claim-ids">>, <<"claim_id">>, <<"claim-id">>], Params, Opts)),
        enum_filter(<<"channel_claim_id">>, first_value([<<"channel_ids">>, <<"channel-ids">>, <<"channel_id">>, <<"channel-id">>], Params, Opts)),
        enum_filter(<<"claim_type">>, claim_type_value(first_value([<<"claim_type">>, <<"claim-type">>, <<"claimType">>], Params, Opts))),
        enum_filter(<<"media_type">>, media_type_value(media_type_param(Params, Opts))),
        enum_filter(<<"content_type">>, content_type_value(first_value([<<"content_type">>, <<"content-type">>, <<"contentType">>], Params, Opts))),
        enum_filter(<<"language">>, first_value([<<"language">>], Params, Opts)),
        nsfw_filter(Params, Opts),
        free_filter(first_value([<<"free_only">>, <<"free-only">>], Params, Opts)),
        tag_filter(<<"tags">>, first_value([<<"any_tags">>, <<"any-tags">>], Params, Opts), <<"OR">>),
        tag_filter(<<"tags">>, first_value([<<"all_tags">>, <<"all-tags">>], Params, Opts), <<"AND">>),
        tag_filter(<<"tags">>, first_value([<<"not_tags">>, <<"not-tags">>], Params, Opts), <<"NOT">>),
        release_time_filter(Params, Opts),
        time_filter(<<"created_at">>, first_value([<<"created_at">>, <<"created-at">>], Params, Opts)),
        duration_filters(Params, Opts)
    ]),
    join_filters(Parts).

visibility_filters(Params, Opts) ->
    case truthy(first_value([<<"include_expired">>, <<"include-expired">>], Params, Opts)) of
        true -> hidden_tag_filters(Params, Opts);
        false -> [<<"bid_state != \"Expired\"">>, <<"bid_state != \"Spent\"">> | hidden_tag_filters(Params, Opts)]
    end.

hidden_tag_filters(Params, Opts) ->
    case truthy(first_value([<<"include_hidden">>, <<"include-hidden">>], Params, Opts)) of
        true -> [];
        false ->
            [
                <<"NOT tags = \"c:unlisted\"">>,
                <<"NOT tags = \"c:private\"">>,
                <<"NOT tags = \"c:scheduled:hide\"">>,
                <<"NOT tags = \"c:scheduled:show\"">>
            ]
    end.

claim_type_value(not_found) ->
    not_found;
claim_type_value(Value) ->
    [claim_type_one(Item) || Item <- list_value(Value)].

claim_type_one(<<"file">>) -> <<"stream">>;
claim_type_one(<<"files">>) -> <<"stream">>;
claim_type_one(<<"stream">>) -> <<"stream">>;
claim_type_one(<<"streams">>) -> <<"stream">>;
claim_type_one(<<"channel">>) -> <<"channel">>;
claim_type_one(<<"channels">>) -> <<"channel">>;
claim_type_one(<<"list">>) -> <<"claimlist">>;
claim_type_one(<<"collection">>) -> <<"claimlist">>;
claim_type_one(<<"collections">>) -> <<"claimlist">>;
claim_type_one(Value) -> hb_util:bin(Value).

claim_types(Params, Opts) ->
    case claim_type_value(first_value([<<"claim_type">>, <<"claim-type">>, <<"claimType">>], Params, Opts)) of
        not_found -> not_found;
        Types -> Types
    end.

stream_only_search(Params, Opts) ->
    case claim_types(Params, Opts) of
        not_found ->
            true;
        Types ->
            lists:member(<<"stream">>, Types) andalso not lists:member(<<"channel">>, Types)
    end.

channel_only_search(Params, Opts) ->
    case claim_types(Params, Opts) of
        [<<"channel">>] -> true;
        _ -> false
    end.

media_type_param(Params, Opts) ->
    case stream_only_search(Params, Opts) of
        false ->
            not_found;
        true ->
            case first_value([<<"stream_types">>, <<"stream-types">>, <<"media_type">>, <<"media-type">>, <<"mediaType">>], Params, Opts) of
                not_found -> media_type_booleans(Params, Opts);
                Value -> Value
            end
    end.

media_type_booleans(Params, Opts) ->
    Values = lists:filtermap(
        fun({Key, Type}) ->
            case truthy(first_value([Key], Params, Opts)) of
                true -> {true, Type};
                false -> false
            end
        end,
        [
            {<<"audio">>, <<"audio">>},
            {<<"video">>, <<"video">>},
            {<<"text">>, <<"text">>},
            {<<"image">>, <<"image">>},
            {<<"application">>, <<"application">>},
            {<<"model">>, <<"model">>},
            {<<"binary">>, <<"binary">>}
        ]
    ),
    case Values of
        [] -> not_found;
        _ -> Values
    end.

media_type_value(not_found) ->
    not_found;
media_type_value(Value) ->
    [media_type_one(Item) || Item <- list_value(Value)].

media_type_one(<<"text">>) -> <<"text">>;
media_type_one(<<"application">>) -> <<"application">>;
media_type_one(<<"audio">>) -> <<"audio">>;
media_type_one(<<"video">>) -> <<"video">>;
media_type_one(<<"image">>) -> <<"image">>;
media_type_one(<<"cad">>) -> <<"cad">>;
media_type_one(<<"model">>) -> <<"model">>;
media_type_one(<<"document">>) -> <<"text">>;
media_type_one(<<"binary">>) -> <<"application">>;
media_type_one(Value) -> hb_util:bin(Value).

content_type_value(not_found) ->
    not_found;
content_type_value(<<"application/json">>) ->
    not_found;
content_type_value(Value) ->
    Value.

nsfw_filter(Params, Opts) ->
    case first_value([<<"include_mature">>, <<"include-mature">>, <<"includeMature">>, <<"nsfw">>], Params, Opts) of
        not_found ->
            [<<"nsfw = 0">>];
        Value ->
            case truthy(Value) of
                true -> [];
                false -> [<<"nsfw = 0">>]
            end
    end.

free_filter(not_found) ->
    [];
free_filter(Value) ->
    case truthy(Value) of
        true -> [<<"fee = 0">>];
        false -> []
    end.

duration_filters(Params, Opts) ->
    case stream_only_search(Params, Opts) of
        false ->
            [];
        true ->
            lists:flatten([
                range_filter(<<"duration">>, <<">=">>, first_value([<<"min_duration">>, <<"min-duration">>, <<"duration_gte">>, <<"duration-gte">>], Params, Opts)),
                range_filter(<<"duration">>, <<"<=">>, first_value([<<"max_duration">>, <<"max-duration">>, <<"duration_lte">>, <<"duration-lte">>], Params, Opts))
            ])
    end.

range_filter(_Field, _Op, not_found) ->
    [];
range_filter(Field, Op, Value) ->
    [<<Field/binary, " ", Op/binary, " ", (number_filter(Value))/binary>>].

sorts(Params, Opts) ->
    case first_value([<<"sort">>, <<"sort_by">>, <<"sort-by">>, <<"order_by">>, <<"order-by">>, <<"order">>], Params, Opts) of
        not_found -> default_sorts(Params, Opts);
        Value -> normalize_sorts(list_value(Value), Params, Opts)
    end.

default_sorts(Params, Opts) ->
    case first_value([<<"claim_type">>, <<"claim-type">>, <<"claimType">>], Params, Opts) of
        <<"channel">> -> default_popularity_sorts();
        <<"file">> -> default_popularity_sorts();
        <<"stream">> -> default_popularity_sorts();
        not_found -> default_mixed_sorts();
        Value ->
            Types = [claim_type_one(Item) || Item <- list_value(Value)],
            case lists:member(<<"channel">>, Types) andalso lists:any(fun(Type) -> Type =/= <<"channel">> end, Types) of
                true -> default_mixed_sorts();
                false -> default_popularity_sorts()
            end
    end.

default_mixed_sorts() ->
    [
        <<"is_channel:desc">>,
        <<"recency_rank:desc">>,
        <<"has_thumbnail:desc">>,
        <<"search_rank:desc">>,
        <<"effective_amount:desc">>,
        <<"release_time:desc">>
    ].

default_popularity_sorts() ->
    [
        <<"recency_rank:desc">>,
        <<"has_thumbnail:desc">>,
        <<"search_rank:desc">>,
        <<"effective_amount:desc">>,
        <<"release_time:desc">>
    ].

normalize_sorts(Values) ->
    normalize_sorts(Values, #{}, #{}).

normalize_sorts(Values, Params, Opts) ->
    lists:filtermap(fun(Value) -> normalize_sort(Value, Params, Opts) end, Values).

normalize_sort(Value) ->
    normalize_sort(Value, #{}, #{}).

normalize_sort(Value, Params, Opts) ->
    Bin = hb_util:bin(Value),
    case Bin of
        <<"trending_group">> -> {true, <<"search_rank:desc">>};
        <<"trending_mixed">> -> {true, <<"search_rank:desc">>};
        <<"-", Field/binary>> -> {true, <<(sort_field(Field, Params, Opts))/binary, ":desc">>};
        <<"^", Field/binary>> -> {true, <<(sort_field(Field, Params, Opts))/binary, ":asc">>};
        <<"+", Field/binary>> -> {true, <<(sort_field(Field, Params, Opts))/binary, ":asc">>};
        <<>> -> false;
        Field -> {true, <<(sort_field(Field, Params, Opts))/binary, ":desc">>}
    end.

sort_field(Field) ->
    sort_field(Field, #{}, #{}).

sort_field(<<"release_time">>, Params, Opts) ->
    case channel_only_search(Params, Opts) of
        true -> <<"created_at">>;
        false -> <<"release_time">>
    end;
sort_field(<<"creation_timestamp">>, _Params, _Opts) -> <<"created_at">>;
sort_field(<<"activation_height">>, _Params, _Opts) -> <<"created_at">>;
sort_field(<<"amount">>, _Params, _Opts) -> <<"effective_amount">>;
sort_field(<<"effective_amount">>, _Params, _Opts) -> <<"effective_amount">>;
sort_field(<<"created_at">>, _Params, _Opts) -> <<"created_at">>;
sort_field(<<"transaction_time">>, _Params, _Opts) -> <<"transaction_time">>;
sort_field(<<"name">>, _Params, _Opts) -> <<"name">>;
sort_field(Field, _Params, _Opts) ->
    Field.

enum_filter(_Field, not_found) ->
    [];
enum_filter(Field, Value) ->
    Values = list_value(Value),
    case Values of
        [] -> [];
        [Single] -> [<<Field/binary, " = ", (quote_filter(Single))/binary>>];
        _ -> [<<Field/binary, " IN [", (join_quoted(Values))/binary, "]">>]
    end.

tag_filter(_Field, not_found, _Mode) ->
    [];
tag_filter(Field, Value, <<"OR">>) ->
    Parts = [<<Field/binary, " = ", (quote_filter(Tag))/binary>> || Tag <- list_value(Value)],
    case Parts of [] -> []; _ -> [paren(join_with(Parts, <<" OR ">>))] end;
tag_filter(Field, Value, <<"AND">>) ->
    [<<Field/binary, " = ", (quote_filter(Tag))/binary>> || Tag <- list_value(Value)];
tag_filter(Field, Value, <<"NOT">>) ->
    [<<"NOT ", Field/binary, " = ", (quote_filter(Tag))/binary>> || Tag <- list_value(Value)].

time_filter(_Field, not_found) ->
    [];
time_filter(Field, Value) ->
    Bin = hb_util:bin(Value),
    case Bin of
        <<">=", Rest/binary>> -> [<<Field/binary, " >= ", (number_filter(Rest))/binary>>];
        <<"<=", Rest/binary>> -> [<<Field/binary, " <= ", (number_filter(Rest))/binary>>];
        <<">", Rest/binary>> -> [<<Field/binary, " > ", (number_filter(Rest))/binary>>];
        <<"<", Rest/binary>> -> [<<Field/binary, " < ", (number_filter(Rest))/binary>>];
        <<>> -> [];
        _ -> [<<Field/binary, " = ", (number_filter(Bin))/binary>>]
    end.

release_time_filter(Params, Opts) ->
    case first_value([<<"release_time">>, <<"release-time">>], Params, Opts) of
        not_found -> time_filter_value(time_filter_field(Params, Opts), first_value([<<"time_filter">>, <<"time-filter">>], Params, Opts));
        Value -> time_filter(<<"release_time">>, Value)
    end.

time_filter_value(not_found) ->
    time_filter_value(<<"release_time">>, not_found).

time_filter_value(_Field, not_found) ->
    [];
time_filter_value(Field, Value) ->
    Now = erlang:system_time(second),
    Cutoff =
        case hb_util:bin(Value) of
            <<"lasthour">> -> Now - 3600;
            <<"today">> -> Now - 86400;
            <<"thisweek">> -> Now - (7 * 86400);
            <<"thismonth">> -> Now - (31 * 86400);
            <<"thisyear">> -> Now - (366 * 86400);
            <<"day">> -> Now - 86400;
            <<"week">> -> Now - (7 * 86400);
            <<"month">> -> Now - (31 * 86400);
            <<"year">> -> Now - (366 * 86400);
            <<"all">> -> not_found;
            <<"default">> -> not_found;
            _ -> not_found
        end,
    case Cutoff of
        not_found -> [];
        _ -> [<<Field/binary, " >= ", (integer_to_binary(Cutoff))/binary>>]
    end.

time_filter_field(Params, Opts) ->
    case channel_only_search(Params, Opts) of
        true -> <<"created_at">>;
        false -> <<"release_time">>
    end.

join_filters([]) -> not_found;
join_filters(Parts) -> join_with(Parts, <<" AND ">>).

documents(Params, Opts) ->
    case first_value([<<"documents">>, <<"items">>], Params, Opts) of
        not_found ->
            case first_value([<<"document">>, <<"item">>, <<"claim">>], Params, Opts) of
                not_found -> erlang:error({error, <<"missing document or documents">>});
                Doc -> [normalize_document(Doc, Opts)]
            end;
        Docs when is_list(Docs) ->
            [normalize_document(Doc, Opts) || Doc <- Docs];
        Doc ->
            [normalize_document(Doc, Opts)]
    end.

normalize_document(Doc, Opts) when is_map(Doc) ->
    case first_value([<<"doc_id">>, <<"doc-id">>, <<"immutable_id">>, <<"immutable-id">>, <<"txid">>, <<"claim_id">>, <<"claim-id">>], Doc, Opts) of
        not_found -> Doc;
        ID ->
            DocID = hb_util:bin(ID),
            Doc#{ <<"doc_id">> => DocID, <<"search_id">> => search_id(DocID) }
    end;
normalize_document(Other, _Opts) ->
    erlang:error({error, {invalid_document, Other}}).

search_id(ID) ->
    hb_util:encode(crypto:hash(sha256, hb_util:bin(ID))).

legacy_search_id(ID) ->
    << <<(search_id_char(Char))>> || <<Char>> <= hb_util:bin(ID) >>.

search_id_char(Char) when Char >= $a, Char =< $z -> Char;
search_id_char(Char) when Char >= $A, Char =< $Z -> Char;
search_id_char(Char) when Char >= $0, Char =< $9 -> Char;
search_id_char($_) -> $_;
search_id_char($-) -> $-;
search_id_char(_) -> $_.

search_ids(IDs) ->
    lists:usort(
        lists:flatmap(
            fun(ID) -> [search_id(ID), legacy_search_id(ID)] end,
            IDs
        )
    ).

cleanup_legacy_document_ids(Docs, Params, Base, Req, Opts) ->
    IDs = lists:usort([
        legacy_search_id(ID)
     || Doc <- Docs,
        ID <- [first_value([<<"doc_id">>, <<"doc-id">>], Doc, Opts)],
        ID =/= not_found
    ]),
    case IDs of
        [] ->
            ok;
        _ ->
            case meili_post_task(
                index_path(Params, Opts, <<"/documents/delete-batch">>),
                IDs,
                Base,
                Req,
                Opts
            ) of
                {ok, _} -> ok;
                Error ->
                    ?event(warning, {odysee_search_legacy_id_cleanup_failed, {result, Error}}),
                    ok
            end
    end.

ids(Params, Opts) ->
    case first_value([<<"ids">>, <<"doc_ids">>, <<"doc-ids">>], Params, Opts) of
        not_found ->
            case first_value([<<"id">>, <<"doc_id">>, <<"doc-id">>], Params, Opts) of
                not_found -> [];
                ID -> [hb_util:bin(ID)]
            end;
        IDs ->
            [hb_util:bin(ID) || ID <- list_value(IDs)]
    end.

ok_json(Result) ->
    Body = hb_json:encode(#{ <<"result">> => Result }),
    {ok, #{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"result">> => Result,
        <<"body">> => Body
    }}.

json_error(Status, Message) ->
    Body = hb_json:encode(#{ <<"error">> => Message }),
    {ok, #{
        <<"device">> => ?DEVICE,
        <<"status">> => Status,
        <<"content-type">> => <<"application/json">>,
        <<"error">> => Message,
        <<"body">> => Body
    }}.

device_error({error, #{ <<"status">> := Status, <<"body">> := Body }}) ->
    json_error(Status, #{ <<"backend-status">> => Status, <<"backend-body">> => Body });
device_error({error, invalid_json}) ->
    json_error(502, <<"search backend returned invalid json">>);
device_error({error, Reason}) ->
    json_error(503, #{ <<"backend">> => <<"meilisearch">>, <<"reason">> => error_reason(Reason) });
device_error(Reason) ->
    json_error(500, #{ <<"reason">> => error_reason(Reason) }).

error_reason(Reason) when is_atom(Reason) ->
    atom_to_binary(Reason);
error_reason(Reason) when is_binary(Reason) ->
    Reason;
error_reason(Reason) when is_map(Reason) ->
    Reason;
error_reason(Reason) ->
    hb_util:bin(io_lib:format("~p", [Reason])).

decode_or_raw(Raw) ->
    case try_decode_json(Raw) of
        {ok, Decoded} -> Decoded;
        _ -> Raw
    end.

try_decode_json(Raw) ->
    try {ok, hb_json:decode(Raw)}
    catch _:_ -> {error, invalid_json}
    end.

first_value(Keys, Msg, Opts) ->
    first_value(Keys, Msg, not_found, Opts).

first_value([], _Msg, Default, _Opts) ->
    Default;
first_value([Key | Rest], Msg, Default, Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_value(Rest, Msg, Default, Opts);
        Value -> Value
    end;
first_value(_Keys, _Msg, Default, _Opts) ->
    Default.

maybe_put(_Key, not_found, Map) ->
    Map;
maybe_put(_Key, [], Map) ->
    Map;
maybe_put(Key, Value, Map) ->
    Map#{ Key => Value }.

value_or(not_found, Default) -> Default;
value_or(undefined, Default) -> Default;
value_or(Value, _Default) -> Value.

map_or_empty(Map) when is_map(Map) -> Map;
map_or_empty(_Value) -> #{}.

list_value(Value) when is_list(Value) -> Value;
list_value(Value) when is_binary(Value) ->
    case binary:split(Value, <<",">>, [global]) of
        [Value] -> [Value];
        Values -> [trim(V) || V <- Values, trim(V) =/= <<>>]
    end;
list_value(Value) -> [Value].

clamp_int(Value, Default, Min, Max) ->
    Int = parse_int(Value, Default),
    min(Max, max(Min, Int)).

parse_int(not_found, Default) -> Default;
parse_int(Value, _Default) when is_integer(Value) -> Value;
parse_int(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value)
    catch _:_ -> Default
    end;
parse_int(_Value, Default) -> Default.

truthy(true) -> true;
truthy(1) -> true;
truthy(<<"1">>) -> true;
truthy(<<"true">>) -> true;
truthy(<<"yes">>) -> true;
truthy(_) -> false.

page_from_offset(_Offset, 0) -> 1;
page_from_offset(Offset, Limit) when is_integer(Offset), is_integer(Limit) ->
    (Offset div Limit) + 1;
page_from_offset(_Offset, _Limit) -> 1.

document_count(Docs) when is_list(Docs) -> length(Docs);
document_count(_Doc) -> 1.

claim_ids_from_hits(Hits, Opts) when is_list(Hits) ->
    lists:filtermap(
        fun(Hit) when is_map(Hit) ->
            case first_value([<<"claim_id">>, <<"claim-id">>], Hit, Opts) of
                not_found -> false;
                ClaimID -> {true, hb_util:bin(ClaimID)}
            end;
           (_Hit) ->
            false
        end,
        Hits
    );
claim_ids_from_hits(_Hits, _Opts) ->
    [].

length_or_zero(List) when is_list(List) -> length(List);
length_or_zero(_Value) -> 0.

quote_filter(Value) ->
    Escaped = binary:replace(hb_util:bin(Value), <<"\"">>, <<"\\\"">>, [global]),
    <<"\"", Escaped/binary, "\"">>.

number_filter(Value) ->
    trim(hb_util:bin(Value)).

join_quoted(Values) ->
    join_with([quote_filter(Value) || Value <- Values], <<", ">>).

join_with([], _Sep) -> <<>>;
join_with([One], _Sep) -> One;
join_with([One | Rest], Sep) ->
    lists:foldl(fun(Part, Acc) -> <<Acc/binary, Sep/binary, Part/binary>> end, One, Rest).

paren(Value) ->
    <<"(", Value/binary, ")">>.

trim(Value) ->
    trim_right(trim_left(hb_util:bin(Value))).

trim_left(<<C, Rest/binary>>) when C =< $\s -> trim_left(Rest);
trim_left(Bin) -> Bin.

trim_right(Bin) ->
    Size = byte_size(Bin),
    case Size of
        0 -> Bin;
        _ ->
            Last = binary:at(Bin, Size - 1),
            case Last =< $\s of
                true -> trim_right(binary:part(Bin, 0, Size - 1));
                false -> Bin
            end
    end.

trim_trailing_slash(<<>>) ->
    <<>>;
trim_trailing_slash(Bin0) ->
    Bin = hb_util:bin(Bin0),
    Size = byte_size(Bin),
    case Size > 1 andalso binary:at(Bin, Size - 1) =:= $/ of
        true -> trim_trailing_slash(binary:part(Bin, 0, Size - 1));
        false -> Bin
    end.

filterable_attributes() ->
    [
        <<"doc_id">>,
        <<"claim_id">>,
        <<"immutable_id">>,
        <<"channel_claim_id">>,
        <<"bid_state">>,
        <<"claim_type">>,
        <<"content_type">>,
        <<"media_type">>,
        <<"tags">>,
        <<"language">>,
        <<"nsfw">>,
        <<"fee">>,
        <<"release_time">>,
        <<"created_at">>,
        <<"transaction_time">>,
        <<"duration">>,
        <<"height">>,
        <<"width">>,
        <<"claim_count">>,
        <<"claim_cnt">>,
        <<"channel_claim_count">>,
        <<"is_channel">>,
        <<"has_thumbnail">>,
        <<"has_channel">>,
        <<"is_controlling">>,
        <<"recency_rank">>,
        <<"source_system">>
    ].

sortable_attributes() ->
    [
        <<"is_channel">>,
        <<"search_rank">>,
        <<"recency_rank">>,
        <<"has_thumbnail">>,
        <<"is_controlling">>,
        <<"release_time">>,
        <<"created_at">>,
        <<"transaction_time">>,
        <<"effective_amount">>,
        <<"certificate_amount">>,
        <<"view_count">>,
        <<"view_cnt">>,
        <<"sub_cnt">>,
        <<"claim_count">>,
        <<"claim_cnt">>,
        <<"channel_claim_count">>,
        <<"duration">>
    ].

searchable_attributes() ->
    [
        <<"title">>,
        <<"name">>,
        <<"source_name">>,
        <<"channel_name">>,
        <<"searchable_name">>,
        <<"stripped_name">>,
        <<"tags">>,
        <<"description">>
    ].

meili_search_body_test() ->
    Body = meili_search_body(#{
        <<"s">> => <<"space cats">>,
        <<"page">> => 2,
        <<"page_size">> => 10,
        <<"claim_ids">> => [<<"a">>, <<"b">>],
        <<"claimType">> => <<"file">>,
        <<"mediaType">> => <<"video">>,
        <<"nsfw">> => false,
        <<"free_only">> => true,
        <<"min_duration">> => 30,
        <<"max_duration">> => 300,
        <<"any_tags">> => <<"science,education">>,
        <<"order_by">> => [<<"release_time">>, <<"-effective_amount">>]
    }, #{}),
    ?assertEqual(<<"space cats">>, maps:get(<<"q">>, Body)),
    ?assertEqual(10, maps:get(<<"limit">>, Body)),
    ?assertEqual(10, maps:get(<<"offset">>, Body)),
    ?assertEqual([<<"release_time:desc">>, <<"effective_amount:desc">>], maps:get(<<"sort">>, Body)),
    ?assertMatch(#{ <<"filter">> := _ }, Body),
    Filter = maps:get(<<"filter">>, Body),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"claim_type = \"stream\"">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"media_type = \"video\"">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"nsfw = 0">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"fee = 0">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"duration >= 30">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"duration <= 300">>)).

channel_search_ignores_file_only_filters_test() ->
    Body = meili_search_body(#{
        <<"s">> => <<"test">>,
        <<"claimType">> => <<"channel">>,
        <<"video">> => true,
        <<"min_duration">> => 60,
        <<"max_duration">> => 600,
        <<"time_filter">> => <<"today">>,
        <<"sort_by">> => <<"release_time">>,
        <<"nsfw">> => true
    }, #{}),
    Filter = maps:get(<<"filter">>, Body),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"claim_type = \"channel\"">>)),
    ?assertEqual(nomatch, binary:match(Filter, <<"media_type">>)),
    ?assertEqual(nomatch, binary:match(Filter, <<"duration">>)),
    ?assertEqual(nomatch, binary:match(Filter, <<"nsfw">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"created_at >= ">>)),
    ?assertEqual([<<"created_at:desc">>], maps:get(<<"sort">>, Body)).

mixed_search_ignores_stale_media_filters_test() ->
    Body = meili_search_body(#{
        <<"s">> => <<"test">>,
        <<"claimType">> => <<"file,channel">>,
        <<"video">> => true,
        <<"nsfw">> => false
    }, #{}),
    Filter = maps:get(<<"filter">>, Body),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"claim_type IN [\"stream\", \"channel\"]">>)),
    ?assertEqual(nomatch, binary:match(Filter, <<"media_type">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"nsfw = 0">>)).

normalize_search_response_test() ->
    Msg = #{
        <<"hits">> => [#{ <<"claim_id">> => <<"abc">>, <<"title">> => <<"A">> }],
        <<"estimatedTotalHits">> => 1,
        <<"limit">> => 20,
        <<"offset">> => 0
    },
    Result = normalize_search_response(Msg, #{}, #{}),
    ?assertEqual([<<"abc">>], maps:get(<<"claim-ids">>, Result)),
    ?assertEqual(1, maps:get(<<"total-items">>, Result)).

id_only_search_response_test() ->
    LegacyID = <<"4bf53de1ef6237336665bd82d92655ed899baf878f61e2a9755d0512189cd9f7:0">>,
    NativeClaimID = <<"-tMJ3RquAH-t4dg00tp0iQIcPNe0GOiB1UN22a4HNZA">>,
    NativeRecordID = <<"record-id-for-native-upload">>,
    Internal = #{
        <<"device">> => ?DEVICE,
        <<"backend">> => <<"meilisearch">>,
        <<"items">> => [
            #{
                <<"claim_id">> => <<"561e81203abc61676daf5d360295c9a8a0bdb373">>,
                <<"immutable_id">> => LegacyID,
                <<"title">> => <<"legacy title must not escape">>
            },
            #{
                <<"claim_id">> => NativeClaimID,
                <<"doc_id">> => NativeClaimID,
                <<"immutable_id">> => NativeRecordID,
                <<"source_system">> => <<"hyperbeam-native">>,
                <<"title">> => <<"native title must not escape">>
            }
        ],
        <<"claim-ids">> => [<<"mutable">>],
        <<"raw">> => #{ <<"hits">> => [#{ <<"title">> => <<"private backend document">> }] },
        <<"total-items">> => 2
    },
    Result = id_only_search_response(Internal, #{}),
    ?assertEqual([LegacyID, NativeRecordID], maps:get(<<"items">>, Result)),
    ?assertEqual([LegacyID, NativeRecordID], maps:get(<<"ids">>, Result)),
    ?assertEqual(false, maps:is_key(<<"raw">>, Result)),
    ?assertEqual(false, maps:is_key(<<"claim-ids">>, Result)).

index_name_ignores_ui_index_param_test() ->
    ?assertEqual(?DEFAULT_INDEX, index_name(#{ <<"index">> => 0 }, #{})),
    ?assertEqual(<<"alternate">>, index_name(#{ <<"search-index">> => <<"alternate">> }, #{})).

search_id_test() ->
    ID = <<"abc-XYZ_123:0">>,
    ?assertEqual(hb_util:encode(crypto:hash(sha256, ID)), search_id(ID)),
    ?assertEqual(<<"abc-XYZ_123_0">>, legacy_search_id(ID)).

search_ids_are_collision_safe_and_delete_legacy_keys_test() ->
    First = <<"abc:def">>,
    Second = <<"abc_def">>,
    ?assertNotEqual(search_id(First), search_id(Second)),
    ?assertEqual(legacy_search_id(First), legacy_search_id(Second)),
    DeleteIDs = search_ids([First, Second]),
    ?assert(lists:member(search_id(First), DeleteIDs)),
    ?assert(lists:member(search_id(Second), DeleteIDs)),
    ?assert(lists:member(legacy_search_id(First), DeleteIDs)).

meilisearch_task_uid_test() ->
    ?assertEqual(7, meili_task_uid(#{ <<"taskUid">> => 7 })),
    ?assertEqual(8, meili_task_uid(#{ <<"uid">> => 8 })),
    ?assertEqual(not_found, meili_task_uid(#{ <<"taskUid">> => <<"7">> })).

native_upload_ids_use_durable_global_list_test() ->
    UploadIDs = native_upload_ids_from_json(
        hb_json:encode([<<"record-a">>, <<"record-b">>])
    ),
    ?assert(sets:is_element(<<"record-a">>, UploadIDs)),
    ?assert(sets:is_element(<<"record-b">>, UploadIDs)),
    ?assertNot(sets:is_element(<<"deleted-record">>, UploadIDs)).
