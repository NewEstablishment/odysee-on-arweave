%%% @doc Generic full-text index for HyperBEAM messages, backed by SQLite
%%% FTS5. Indexes a message's scalar string fields (or the fields named by
%%% a schema) keyed by the message id, and answers BM25-ranked queries.
%%% This module is the engine; the `~search@1.0' device is its surface.
%%%
%%% The connection-passing functions (`open'/`index'/`query'/`close') are
%%% the pure core. A node runs a single long-lived index through the
%%% `gen_server' interface (`ensure_started'/`node_index'/`node_query'):
%%% the server owns the write connection and serializes writes, mirroring
%%% how `hb_store_lmdb' funnels a store's writes through one process. The
%%% index file is the node option `search-db' (default in-memory).
-module(hb_search).
-behaviour(gen_server).
-export([open/1, index/4, query/3, close/1]).
-export([ensure_started/1, node_index/3, node_query/3]).
-export([start_link/1, init/1, handle_call/3, handle_cast/2, terminate/2]).
-define(SERVER, hb_search_server).

%% @doc Open (creating if needed) the FTS5 index at Path. The single
%% `content' column holds the concatenated indexable field values; `fields'
%% stores the per-field values for exact filtering; `id' is the message id.
open(Path) ->
    {ok, C} = esqlite3:open(binary_to_list(iolist_to_binary(Path))),
    ok = esqlite3:exec(C,
        "CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5("
        "id UNINDEXED, content, fields UNINDEXED, "
        "tokenize='unicode61 remove_diacritics 2');"),
    {ok, C}.

%% @doc Index a message. `Fields' is the message as a map; `Schema' is
%% `all' (index every scalar string field) or a list of field-name
%% binaries. The prior row for `Id' is replaced, so re-indexing is
%% idempotent.
index(C, Id, Fields, Schema) ->
    Indexable = indexable_fields(Fields, Schema),
    Content = content(Indexable),
    esqlite3:q(C, "DELETE FROM docs WHERE id = ?;", [Id]),
    esqlite3:q(C, "INSERT INTO docs(id, content, fields) VALUES(?, ?, ?);",
        [Id, Content, fields_blob(Indexable)]),
    ok.

%% @doc Full-text query. Returns `[{Id, Rank}]' ordered best-first (BM25
%% is negative-scaled in SQLite, so ascending rank is best-first). `Limit'
%% bounds the candidate set.
query(C, QueryString, Limit) ->
    Rows = esqlite3:q(C,
        "SELECT id, bm25(docs) FROM docs WHERE docs MATCH ? "
        "ORDER BY bm25(docs) LIMIT ?;",
        [QueryString, Limit]),
    [{Id, Rank} || [Id, Rank] <- Rows].

close(C) ->
    esqlite3:close(C).

%%% Node-scoped singleton server.

%% @doc Ensure the node's index server is running, opening the index at
%% the `search-db' node option (default in-memory). Idempotent.
ensure_started(Opts) ->
    case whereis(?SERVER) of
        undefined ->
            case start_link(Opts) of
                {ok, _Pid} -> ok;
                {error, {already_started, _}} -> ok
            end;
        _Pid ->
            ok
    end.

%% @doc Index a message through the node's server. `Fields' is the message
%% map, `Schema' is `all' or a field-name list.
node_index(Id, Fields, Schema) ->
    gen_server:cast(?SERVER, {index, Id, Fields, Schema}).

%% @doc Query the node's index, returning `[{Id, Rank}]' best-first.
node_query(QueryString, Limit, _Opts) ->
    gen_server:call(?SERVER, {query, QueryString, Limit}).

start_link(Opts) ->
    gen_server:start_link({local, ?SERVER}, ?MODULE, Opts, []).

init(Opts) ->
    Path = hb_opts:get(<<"search-db">>, <<":memory:">>, Opts),
    {ok, C} = open(Path),
    {ok, #{ <<"conn">> => C }}.

handle_cast({index, Id, Fields, Schema}, State = #{ <<"conn">> := C }) ->
    catch index(C, Id, Fields, Schema),
    {noreply, State}.

handle_call({query, QueryString, Limit}, _From, State = #{ <<"conn">> := C }) ->
    Result = try query(C, QueryString, Limit) catch _:_ -> [] end,
    {reply, Result, State}.

terminate(_Reason, #{ <<"conn">> := C }) ->
    catch close(C),
    ok.

%% Select the fields to index. `all' takes every binary-valued field that
%% is not private or structural; a schema list restricts to named fields.
indexable_fields(Fields, all) ->
    maps:filter(
        fun(K, V) -> is_binary(V) andalso not skip_field(K) end,
        Fields
    );
indexable_fields(Fields, Schema) when is_list(Schema) ->
    maps:filter(
        fun(K, V) -> is_binary(V) andalso lists:member(K, Schema) end,
        Fields
    ).

skip_field(<<"commitments">>) -> true;
skip_field(<<"priv">>) -> true;
skip_field(<<"id">>) -> true;
skip_field(K) -> binary:part(K, 0, min(5, byte_size(K))) =:= <<"priv.">>.

content(Indexable) ->
    Values = [V || {_K, V} <- lists:sort(maps:to_list(Indexable)), printable(V)],
    iolist_to_binary(lists:join(<<" ">>, Values)).

fields_blob(Indexable) ->
    iolist_to_binary(lists:join(<<"\n">>,
        [<<K/binary, "=", V/binary>> || {K, V} <- lists:sort(maps:to_list(Indexable)), printable(V)])).

%% Only index text that is valid UTF-8 (skip raw binary payloads).
printable(V) when is_binary(V) ->
    case unicode:characters_to_binary(V, utf8, utf8) of
        V -> true;
        _ -> false
    end;
printable(_) -> false.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

index_and_query_test() ->
    {ok, C} = open(":memory:"),
    ok = index(C, <<"id-a">>,
        #{ <<"title">> => <<"Café verification tutorial"/utf8>>,
           <<"description">> => <<"how to verify a claim">>,
           <<"commitments">> => #{ <<"x">> => <<"y">> } }, all),
    ok = index(C, <<"id-b">>,
        #{ <<"title">> => <<"Green tea benefits">>,
           <<"description">> => <<"healthy morning drink">> }, all),
    ok = index(C, <<"id-c">>,
        #{ <<"title">> => <<"Cafe latte recipe">>,
           <<"description">> => <<"coffee verification">> }, all),
    %% Diacritic-folded match hits both accented and plain forms, ranked.
    CafeIds = [Id || {Id, _} <- query(C, <<"cafe">>, 10)],
    ?assert(lists:member(<<"id-a">>, CafeIds)),
    ?assert(lists:member(<<"id-c">>, CafeIds)),
    ?assertNot(lists:member(<<"id-b">>, CafeIds)),
    %% OR queries.
    VerifyIds = [Id || {Id, _} <- query(C, <<"verify OR verification">>, 10)],
    ?assert(lists:member(<<"id-a">>, VerifyIds)),
    ?assert(lists:member(<<"id-c">>, VerifyIds)),
    ok = close(C).

reindex_is_idempotent_test() ->
    {ok, C} = open(":memory:"),
    ok = index(C, <<"id-a">>, #{ <<"title">> => <<"cafe one">> }, all),
    ok = index(C, <<"id-a">>, #{ <<"title">> => <<"tea two">> }, all),
    ?assertEqual([], query(C, <<"cafe">>, 10)),
    ?assertEqual([<<"id-a">>], [Id || {Id, _} <- query(C, <<"tea">>, 10)]),
    ok = close(C).

schema_restricts_indexed_fields_test() ->
    {ok, C} = open(":memory:"),
    ok = index(C, <<"id-a">>,
        #{ <<"title">> => <<"visible">>, <<"description">> => <<"hidden">> },
        [<<"title">>]),
    ?assertEqual([<<"id-a">>], [Id || {Id, _} <- query(C, <<"visible">>, 10)]),
    ?assertEqual([], query(C, <<"hidden">>, 10)),
    ok = close(C).

skips_binary_and_private_fields_test() ->
    {ok, C} = open(":memory:"),
    ok = index(C, <<"id-a">>,
        #{ <<"title">> => <<"searchable">>,
           <<"raw">> => <<0, 1, 2, 255>>,
           <<"priv">> => <<"secret">> }, all),
    ?assertEqual([<<"id-a">>], [Id || {Id, _} <- query(C, <<"searchable">>, 10)]),
    ?assertEqual([], query(C, <<"secret">>, 10)),
    ok = close(C).

-endif.
