%%% @doc `~search@1.0': a generic full-text search device for HyperBEAM.
%%%
%%% It is not tied to any application -- it indexes whatever fields a
%%% written message carries and answers BM25-ranked full-text queries. The
%%% full-text index is SQLite FTS5, owned by the node-scoped `hb_search'
%%% server; this device is the thin surface over it.
%%%
%%% == Indexing (the `write' hook) ==
%%%
%%% Register the device as the node's `write' hook handler so every
%%% message written to the cache is indexed:
%%%
%%% ```
%%% <<"on">> => #{ <<"write">> => #{ <<"device">> => <<"search@1.0">> } }
%%% '''
%%%
%%% `hb_cache' fires the hook after each top-level write with the message
%%% in `body' and its id in `id'. The handler extracts the indexable
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
    hb_search:ensure_started(Opts),
    Msg = hb_maps:get(<<"body">>, Req, #{}, Opts),
    Id = hb_maps:get(<<"id">>, Req, undefined, Opts),
    case is_map(Msg) andalso is_binary(Id) of
        true -> hb_search:node_index(Id, Msg, schema(Opts));
        false -> ok
    end,
    {ok, Req}.

%% @doc Full-text query. Returns the matching message ids, best-first.
query(_Base, Req, Opts) ->
    hb_search:ensure_started(Opts),
    QueryString = hb_maps:get(<<"q">>, Req, <<>>, Opts),
    Limit = hb_util:int(hb_maps:get(<<"limit">>, Req, <<"20">>, Opts)),
    Hits = hb_search:node_query(QueryString, Limit, Opts),
    {ok, #{ <<"ids">> => [Id || {Id, _Rank} <- Hits] }}.

%% The node's field schema: a list of field names, or `all' when unset.
schema(Opts) ->
    case hb_opts:get(<<"search-schema">>, all, Opts) of
        Fields when is_list(Fields) -> Fields;
        _ -> all
    end.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

write_then_query_test() ->
    Opts = #{ <<"search-db">> => <<":memory:">> },
    hb_search:ensure_started(Opts),
    {ok, _} = write(#{}, #{
        <<"id">> => <<"msg-1">>,
        <<"body">> => #{ <<"title">> => <<"HyperBEAM search device">>,
                         <<"description">> => <<"generic full text index">> }
    }, Opts),
    {ok, _} = write(#{}, #{
        <<"id">> => <<"msg-2">>,
        <<"body">> => #{ <<"title">> => <<"unrelated topic">> }
    }, Opts),
    timer:sleep(100),
    {ok, #{ <<"ids">> := Ids }} =
        query(#{}, #{ <<"q">> => <<"search">>, <<"limit">> => <<"10">> }, Opts),
    ?assertEqual([<<"msg-1">>], Ids).

-endif.
