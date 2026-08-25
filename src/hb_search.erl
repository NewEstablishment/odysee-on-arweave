%%% @doc Generic full-text index for HyperBEAM messages, backed by
%%% Meilisearch. Indexes a message's scalar string fields (or the fields
%%% named by a schema) keyed by the message id, and answers relevance
%%% ranked queries. This module is the engine; the `~search@1.0' device is
%%% its surface.
%%%
%%% The backend is an HTTP service, so the connection-passing functions
%%% (`open'/`index'/`query'/`close') carry a configuration map rather than
%%% a database handle. A node runs one index through the `gen_server'
%%% interface (`ensure_started'/`node_index'/`node_query'), which keeps
%%% indexing off the caller's write path (`cast') while queries are
%%% synchronous.
%%%
%%% Node options: `search-backend-url' (default
%%% `http://127.0.0.1:7700'), `search-api-key' (optional), and
%%% `search-index' (default `hyperbeam_messages').
-module(hb_search).
-export([open/1, index/4, query/3, close/1]).
-export([ensure_started/1, node_index/3, node_query/3]).
-export([start_link/1, init/1, handle_call/3, handle_cast/2, terminate/2]).

-define(SERVER, ?MODULE).
-define(DEFAULT_URL, <<"http://127.0.0.1:7700">>).
-define(DEFAULT_INDEX, <<"hyperbeam_messages">>).

%% @doc Build the backend handle from node options and ensure the index
%% exists (creating it with `id' as primary key when absent).
open(Opts) when is_map(Opts) ->
    Conf = #{
        <<"url">> => hb_opts:get(<<"search-backend-url">>, ?DEFAULT_URL, Opts),
        <<"index">> => hb_opts:get(<<"search-index">>, ?DEFAULT_INDEX, Opts),
        <<"key">> => hb_opts:get(<<"search-api-key">>, undefined, Opts),
        <<"opts">> => Opts
    },
    _ = ensure_index(Conf),
    {ok, Conf};
open(Path) ->
    open(#{ <<"search-backend-url">> => Path }).

ensure_index(Conf = #{ <<"index">> := Index }) ->
    request(Conf, <<"POST">>, <<"/indexes">>,
        #{ <<"uid">> => Index, <<"primaryKey">> => <<"search_id">> }).

%% @doc Index a message. `Fields' is the message as a map; `Schema' is
%% `all' (index every scalar string field) or a list of field-name
%% binaries. Documents are keyed by `Id', so re-indexing replaces the
%% prior document.
index(Conf = #{ <<"index">> := Index }, Id, Fields, Schema) ->
    Indexable = indexable_fields(Fields, Schema, extra_skip_fields(Conf)),
    Content = content(Indexable),
    case string:trim(Content) of
        <<>> ->
            ok;
        _ ->
            %% The corpus importer keys documents by `search_id'
            %% (base64url sha256 of the document id) and carries the
            %% immutable locator in `id'; match that so both producers
            %% write one index.
            Doc = maps:fold(
                fun(K, V, Acc) -> Acc#{ field_name(K) => V } end,
                #{
                    <<"search_id">> => search_id(Id),
                    <<"search_group">> => Id,
                    <<"doc_id">> => Id,
                    <<"id">> => Id,
                    <<"content">> => Content
                },
                Indexable
            ),
            case
                request(
                    Conf,
                    <<"POST">>,
                    <<"/indexes/", Index/binary, "/documents">>,
                    [Doc]
                )
            of
                {ok, _} -> ok;
                Error -> Error
            end
    end.

%% @doc Full-text query. Returns `[{Id, Rank}]' ordered best-first. Rank
%% is Meilisearch's ranking score where available (higher is better), or
%% the hit's position otherwise; callers only rely on the ordering.
query(Conf = #{ <<"index">> := Index }, QueryString, Limit) ->
    Body = #{
        <<"q">> => QueryString,
        <<"limit">> => Limit,
        <<"attributesToRetrieve">> => [<<"id">>],
        <<"showRankingScore">> => true
    },
    case
        request(Conf, <<"POST">>, <<"/indexes/", Index/binary, "/search">>, Body)
    of
        {ok, #{ <<"hits">> := Hits }} when is_list(Hits) ->
            [
                {Id, maps:get(<<"_rankingScore">>, Hit, Position)}
            ||
                {Hit, Position} <- lists:zip(Hits, lists:seq(1, length(Hits))),
                is_map(Hit),
                (Id = maps:get(<<"id">>, Hit, undefined)) =/= undefined
            ];
        _ ->
            []
    end.

close(_Conf) ->
    ok.

search_id(Id) ->
    hb_util:encode(crypto:hash(sha256, Id)).

%% Meilisearch attribute names cannot contain `/' or `-'; the flattened
%% field names use both, so normalize while keeping them readable.
field_name(K) ->
    binary:replace(binary:replace(K, <<"/">>, <<"_">>, [global]),
        <<"-">>, <<"_">>, [global]).

request(#{ <<"url">> := Base, <<"key">> := Key, <<"opts">> := Opts },
        Method, Path, Body) ->
    Headers0 = #{ <<"content-type">> => <<"application/json">> },
    Headers =
        case Key of
            undefined -> Headers0;
            _ -> Headers0#{ <<"authorization">> => <<"Bearer ", Key/binary>> }
        end,
    HTTPOpts =
        Opts#{
            <<"http-client">> =>
                hb_maps:get(<<"http-client">>, Opts, httpc, Opts)
        },
    case
        hb_http_client:request(
            #{
                peer => Base,
                path => Path,
                method => Method,
                headers => Headers,
                body => hb_json:encode(Body)
            },
            HTTPOpts
        )
    of
        {ok, Status, _Headers, RespBody} when Status >= 200, Status < 300 ->
            {ok, decode(RespBody)};
        {ok, Status, _Headers, RespBody} ->
            {error, {http_status, Status, RespBody}};
        {error, Reason} ->
            {error, Reason}
    end.

decode(Body) ->
    try hb_json:decode(Body) catch _:_ -> #{} end.

%%% Node-scoped singleton server.

%% @doc Ensure the node's index server is running against the configured
%% backend. Idempotent.
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
    {ok, Conf} = open(Opts),
    {ok, #{ <<"conn">> => Conf }}.

handle_cast({index, Id, Fields, Schema}, State = #{ <<"conn">> := C }) ->
    catch index(C, Id, Fields, Schema),
    {noreply, State}.

handle_call({query, QueryString, Limit}, _From, State = #{ <<"conn">> := C }) ->
    Result = try query(C, QueryString, Limit) catch _:_ -> [] end,
    {reply, Result, State}.

terminate(_Reason, _State) ->
    ok.

%% Select the fields to index. `all' takes every binary-valued field that
%% is not private, structural, or identifier-shaped, flattening one level
%% of nested text (`value/title', tag lists, ...) so evidence messages
%% index their human-readable content rather than their plumbing; a schema
%% list restricts to named fields.
indexable_fields(Fields, Schema) ->
    indexable_fields(Fields, Schema, []).

indexable_fields(Fields, all, Skip) ->
    case ordered_list_message(Fields) of
        true -> #{};
        false -> indexable_all(Fields, Skip)
    end;
indexable_fields(Fields, Schema, _Skip) when is_list(Schema) ->
    maps:filter(
        fun(K, V) -> is_binary(V) andalso lists:member(K, Schema) end,
        Fields
    ).

%% The fields a message keeps for its own bookkeeping differ per domain:
%% a claim's `txid' or `sd-hash' is noise here, but the engine cannot know
%% that. Operators name theirs through `search-skip-fields'; the engine
%% only knows the HyperBEAM plumbing every message carries.
extra_skip_fields(#{ <<"opts">> := Opts }) ->
    case hb_opts:get(<<"search-skip-fields">>, [], Opts) of
        Fields when is_list(Fields) -> Fields;
        _ -> []
    end;
extra_skip_fields(_Conf) ->
    [].

%% Ordered lists encode as messages whose keys are all indices; their
%% values are structural (key names, ids), not searchable text.
ordered_list_message(Fields) when map_size(Fields) > 0 ->
    lists:all(
        fun(K) -> re:run(K, <<"^[0-9]+$">>, [{capture, none}]) =:= match end,
        maps:keys(Fields)
    );
ordered_list_message(_Fields) ->
    false.

indexable_all(Fields, Skip) ->
    maps:filter(
        fun(_K, V) -> is_binary(V) end,
        maps:fold(
            fun(K, V, Acc) ->
                case skip_field(K, Skip) of
                    true -> Acc;
                    false -> flatten_field(K, V, Acc, Skip)
                end
            end,
            #{},
            Fields
        )
    ).

flatten_field(K, V, Acc, _Skip) when is_binary(V) ->
    case identifier_shaped(V) of
        true -> Acc;
        false -> Acc#{ K => V }
    end;
flatten_field(K, V, Acc, Skip) when is_map(V) ->
    maps:fold(
        fun(SubK, SubV, InnerAcc) ->
            case skip_field(SubK, Skip) of
                true -> InnerAcc;
                false ->
                    flatten_field(<<K/binary, "/", SubK/binary>>, SubV, InnerAcc, Skip)
            end
        end,
        Acc,
        V
    );
flatten_field(K, V, Acc, _Skip) when is_list(V) ->
    Text = [Item || Item <- V, is_binary(Item), not identifier_shaped(Item)],
    case Text of
        [] -> Acc;
        _ -> Acc#{ K => iolist_to_binary(lists:join(<<" ">>, Text)) }
    end;
flatten_field(_K, _V, Acc, _Skip) ->
    Acc.

%% Identifier-shaped strings (hashes, ids, signatures, keys) are noise in a
%% full-text index: long, spaceless hex or base64url runs.
identifier_shaped(V) when byte_size(V) >= 32 ->
    binary:match(V, <<" ">>) =:= nomatch andalso
        re:run(V, <<"^[0-9A-Za-z_:=+/-]+$">>, [{capture, none}]) =:= match;
identifier_shaped(_V) ->
    false.

skip_field(Key, Skip) ->
    lists:member(Key, Skip) orelse skip_field(Key).

%% Structural fields every HyperBEAM message carries. Domain fields belong
%% in `search-skip-fields', not here.
skip_field(<<"commitments">>) -> true;
skip_field(<<"priv">>) -> true;
skip_field(<<"id">>) -> true;
skip_field(<<"ids">>) -> true;
skip_field(<<"signature">>) -> true;
skip_field(<<"signature-input">>) -> true;
skip_field(<<"public-key">>) -> true;
skip_field(<<"keyid">>) -> true;
skip_field(<<"hashpath">>) -> true;
skip_field(<<"committed">>) -> true;
skip_field(<<"commitment-device">>) -> true;
skip_field(<<"type">>) -> true;
skip_field(<<"status">>) -> true;
skip_field(<<"device">>) -> true;
skip_field(<<"content-type">>) -> true;
skip_field(<<"ao-types">>) -> true;
skip_field(K) -> binary:part(K, 0, min(5, byte_size(K))) =:= <<"priv.">>.

content(Indexable) ->
    Values = [V || {_K, V} <- lists:sort(maps:to_list(Indexable)), printable(V)],
    iolist_to_binary(lists:join(<<" ">>, Values)).

%% Only index text that is valid UTF-8 (skip raw binary payloads).
printable(V) when is_binary(V) ->
    case unicode:characters_to_binary(V, utf8, utf8) of
        V -> true;
        _ -> false
    end;
printable(_) -> false.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

%% Field selection is the engine's own logic and runs without a backend.
%% The round-trip tests need a Meilisearch instance and are gated on
%% `SEARCH_LIVE=1' (see `search-backend-url').

indexable_fields_selects_text_test() ->
    Indexable =
        indexable_fields(
            #{ <<"title">> => <<"Café verification tutorial"/utf8>>,
               <<"description">> => <<"how to verify a claim">>,
               <<"commitments">> => #{ <<"x">> => <<"y">> },
               <<"raw">> => <<0, 1, 2, 255>>,
               <<"priv">> => <<"secret">> },
            all
        ),
    %% Structural and private fields are dropped at selection; non-UTF8
    %% payloads survive selection but are excluded from indexed content.
    ?assertEqual(
        [<<"description">>, <<"raw">>, <<"title">>],
        lists:sort(maps:keys(Indexable))
    ),
    Content = content(Indexable),
    ?assertNotEqual(nomatch, binary:match(Content, <<"verify">>)),
    ?assertEqual(nomatch, binary:match(Content, <<"secret">>)),
    ?assertEqual(nomatch, binary:match(Content, <<0, 1, 2, 255>>)).

operator_skip_fields_are_dropped_test() ->
    Fields =
        #{ <<"title">> => <<"real words here">>,
           <<"nout">> => <<"0">>,
           <<"claim-op">> => <<"create">> },
    %% The engine keeps domain fields it was not told about...
    ?assertEqual(
        [<<"claim-op">>, <<"nout">>, <<"title">>],
        lists:sort(maps:keys(indexable_fields(Fields, all)))
    ),
    %% ...and drops exactly the ones the operator named.
    ?assertEqual(
        [<<"title">>],
        maps:keys(
            indexable_fields(Fields, all, [<<"nout">>, <<"claim-op">>])
        )
    ).

schema_restricts_indexed_fields_test() ->
    Indexable =
        indexable_fields(
            #{ <<"title">> => <<"visible">>, <<"description">> => <<"hidden">> },
            [<<"title">>]
        ),
    ?assertEqual([<<"title">>], maps:keys(Indexable)),
    ?assertEqual(<<"visible">>, content(Indexable)).

identifier_fields_are_not_indexed_test() ->
    Indexable =
        indexable_fields(
            #{ <<"title">> => <<"real words here">>,
               <<"locator">> =>
                   <<"be2fccad7acac782af0acafd90f474329e05dee6e03ce20cb5c7763a0ea3d237">> },
            all
        ),
    ?assertEqual([<<"title">>], maps:keys(Indexable)).

field_name_is_backend_safe_test() ->
    ?assertEqual(<<"value_title">>, field_name(<<"value/title">>)),
    ?assertEqual(<<"claim_name">>, field_name(<<"claim-name">>)).

live_index_and_query_test_() ->
    {timeout, 30, fun() ->
        case os:getenv("SEARCH_LIVE") of
            false -> ok;
            _ -> live_index_and_query()
        end
    end}.

live_index_and_query() ->
    Index = <<"hb_search_test">>,
    {ok, Conf} = open(#{ <<"search-index">> => Index }),
    ok = index(Conf, <<"id-a">>, #{ <<"title">> => <<"cafe verification">> }, all),
    ok = index(Conf, <<"id-b">>, #{ <<"title">> => <<"green tea">> }, all),
    timer:sleep(1000),
    Ids = [Id || {Id, _} <- query(Conf, <<"verification">>, 10)],
    ?assert(lists:member(<<"id-a">>, Ids)),
    ?assertNot(lists:member(<<"id-b">>, Ids)),
    ok = close(Conf).

-endif.
