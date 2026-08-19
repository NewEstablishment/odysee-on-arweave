%%% @doc `~search@1.0': a generic full-text search device for HyperBEAM.
%%%
%%% It is not tied to any application -- it indexes whatever fields a
%%% written message carries and answers BM25-ranked full-text queries. The
%%% full-text index is SQLite FTS5, owned by the node-scoped `hb_search'
%%% server; this device is the thin surface over it.
%%%
%%% == Indexing (the `write' hook) ==
%%%
%%% Register the device as the node's `cache-write' hook handler so every
%%% message written to the cache is indexed:
%%%
%%% ```
%%% <<"on">> => #{
%%%     <<"cache-write">> =>
%%%         [#{ <<"device">> => <<"search@1.0">>, <<"path">> => <<"write">> }]
%%% }
%%% '''
%%%
%%% `hb_cache' fires the hook after each top-level write with the message
%%% in `body'; the handler derives its id. It extracts the indexable
%%% fields and casts them to the index server, returning the request
%%% unchanged so the hook is transparent. Indexing is asynchronous, so it
%%% never blocks or recurses on the write path.
%%%
%%% == Querying ==
%%%
%%% `GET /~search@1.0/query?q=<terms>&limit=<n>' runs an FTS5 `MATCH' and
%%% returns the matching message ids ranked by BM25 (lower rank = better).
%%% Callers hydrate the ids with `~cache@1.0/read', exactly as they do
%%% with `~query@1.0' path results.
%%%
%%% == Schema ==
%%%
%%% With no configuration, every scalar UTF-8 string field of a message is
%%% indexed (private, structural, and binary fields are skipped). The node
%%% option `search-schema', when set to a list of field-name binaries,
%%% restricts indexing to those fields.
-module(dev_search).
-implements(<<"search@1.0">>).
-export([info/1, query/3, write/3]).

info(_Opts) ->
    #{ exports => [<<"query">>, <<"write">>] }.

%% @doc The `write' hook handler. Indexes the written message's fields and
%% returns the request unchanged (a transparent hook).
write(_Base, Req, Opts) ->
    Msg = hb_maps:get(<<"body">>, Req, #{}, Opts),
    case is_map(Msg) andalso indexable(Msg, Opts) andalso message_id(Req, Opts) of
        Id when is_binary(Id) ->
            catch begin
                hb_search:ensure_started(Opts),
                %% A message's searchable text often sits in linked
                %% sub-messages (`value/title', tags): load them so the
                %% document carries the content, not just the link.
                hb_search:node_index(Id, loaded(Msg, Opts), schema(Opts))
            end;
        _ ->
            ok
    end,
    {ok, Req}.

loaded(Msg, Opts) ->
    try resolve_links(hb_cache:ensure_all_loaded(Msg, Opts), Opts)
    catch _:_ -> Msg
    end.

%% Evidence and product messages carry their text in sub-messages
%% referenced by `<field>+link' ids (`value+link' holds title,
%% description, tags). Read one level of those so the document contains
%% the content rather than the pointer.
resolve_links(Msg, Opts) when is_map(Msg) ->
    hb_maps:fold(
        fun(Key, Value, Acc) ->
            case link_field(Key) of
                {ok, Field} when is_binary(Value) ->
                    case hb_cache:read(Value, Opts) of
                        {ok, Sub} when is_map(Sub) ->
                            Acc#{ Field => hb_cache:ensure_all_loaded(Sub, Opts) };
                        _ ->
                            Acc
                    end;
                _ ->
                    Acc
            end
        end,
        Msg,
        Msg,
        Opts
    );
resolve_links(Msg, _Opts) ->
    Msg.

link_field(Key) when is_binary(Key) ->
    case binary:match(Key, <<"+link">>) of
        {Pos, 5} when Pos + 5 =:= byte_size(Key) ->
            {ok, binary:part(Key, 0, Pos)};
        _ ->
            not_link
    end;
link_field(_Key) ->
    not_link.

%% Every cache write reaches this hook -- including sub-messages, evidence
%% fragments and, on a node that publishes its UI, every static asset. The
%% `search-index-markers' node option names the fields that mark a message
%% as a document worth indexing (a match on any one qualifies); the empty
%% default indexes everything, which is rarely what an operator wants.
indexable(Msg, Opts) ->
    case hb_opts:get(<<"search-index-markers">>, [], Opts) of
        [] -> true;
        Markers when is_list(Markers) ->
            lists:any(fun(Key) -> hb_maps:is_key(Key, Msg, Opts) end, Markers)
    end.

%% The `cache-write' hook delivers the written message under `body' but
%% no id, so derive it: `hb_cache:write' registers the uncommitted content
%% id, which is what a reader resolves and therefore what the index must
%% be keyed by. An explicit `id' in the request still wins.
message_id(Req, Opts) ->
    case hb_maps:get(<<"id">>, Req, undefined, Opts) of
        Id when is_binary(Id) ->
            Id;
        _ ->
            case hb_maps:get(<<"body">>, Req, undefined, Opts) of
                Msg when is_map(Msg) ->
                    try hb_message:id(Msg, uncommitted, Opts)
                    catch _:_ -> undefined
                    end;
                _ ->
                    undefined
            end
    end.

%% @doc Full-text query. Returns the matching message ids as a bare list,
%% best-first (BM25; SQLite scales it negatively, so ascending rank is
%% descending relevance). Bare binaries encode inline over HTTP on every
%% node; richer per-hit maps (message link + score) get link-encoded under
%% `force-message', which a `no-store' node cannot serve back — revisit
%% that shape when hit maps can be embedded or index keys are canonical
%% message ids.
query(_Base, Req, Opts) ->
    hb_search:ensure_started(Opts),
    QueryString = hb_maps:get(<<"q">>, Req, <<>>, Opts),
    Limit = hb_util:int(hb_maps:get(<<"limit">>, Req, <<"20">>, Opts)),
    Hits = hb_search:node_query(QueryString, Limit, Opts),
    {ok, [Id || {Id, _Rank} <- Hits]}.

%% The node's field schema: a list of field names, or `all' when unset.
schema(Opts) ->
    case hb_opts:get(<<"search-schema">>, all, Opts) of
        Fields when is_list(Fields) -> Fields;
        _ -> all
    end.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

%% The write hook is transparent and must not fail when the backend is
%% absent: a cache write cannot be broken by an unavailable index.
write_is_transparent_without_backend_test() ->
    Opts = #{ <<"search-backend-url">> => <<"http://127.0.0.1:1">> },
    Req = #{
        <<"id">> => <<"msg-1">>,
        <<"body">> => #{ <<"title">> => <<"HyperBEAM search device">> }
    },
    ?assertEqual({ok, Req}, write(#{}, Req, Opts)).

%% `cache-write' delivers only `body'; the id is derived from the message
%% so the hook indexes under the same id the cache registered.
write_derives_missing_id_test() ->
    Opts = #{ <<"search-backend-url">> => <<"http://127.0.0.1:1">> },
    Msg = #{ <<"title">> => <<"derived id">> },
    Req = #{ <<"body">> => Msg },
    ?assertEqual({ok, Req}, write(#{}, Req, Opts)),
    ?assertEqual(hb_message:id(Msg, uncommitted, Opts), message_id(Req, Opts)).

live_write_then_query_test_() ->
    {timeout, 30, fun() ->
        case os:getenv("SEARCH_LIVE") of
            false -> ok;
            _ -> live_write_then_query()
        end
    end}.

live_write_then_query() ->
    Opts = #{ <<"search-index">> => <<"dev_search_test">> },
    hb_search:ensure_started(Opts),
    {ok, _} = write(#{}, #{
        <<"id">> => <<"msg-1">>,
        <<"body">> => #{ <<"title">> => <<"HyperBEAM search device">> }
    }, Opts),
    timer:sleep(1000),
    {ok, Hits} =
        query(#{}, #{ <<"q">> => <<"search">>, <<"limit">> => <<"10">> }, Opts),
    ?assert(lists:member(<<"msg-1">>, Hits)).

-endif.
