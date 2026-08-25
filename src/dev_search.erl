%%% @doc `~search@1.0': a generic full-text search device for HyperBEAM.
%%%
%%% It is not tied to any application -- it indexes whatever fields a
%%% written message carries and answers relevance-ranked full-text queries.
%%% The index is owned by Meilisearch and accessed by the node-scoped
%%% `hb_search' server; this device is the thin surface over it.
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
%%% `GET /~search@1.0/query?q=<terms>&limit=<n>' runs a Meilisearch query and
%%% returns the matching message ids in backend ranking order.
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
%% `search-index-markers' node option names what marks a message as a
%% document worth indexing (a match on any one marker qualifies); the empty
%% default indexes everything, which is rarely what an operator wants.
%%
%% A marker is either a field name, which matches on presence alone, or
%% `#{field => Name, values => [...]}', which additionally requires the
%% field to hold one of the listed values. Presence is too coarse where one
%% field names several kinds of record: every native Odysee message carries
%% a `schema', but a subscription or an auth record has no business in a
%% search index.
indexable(Msg, Opts) ->
    case hb_opts:get(<<"search-index-markers">>, [], Opts) of
        [] -> true;
        Markers when is_list(Markers) ->
            lists:any(fun(Marker) -> marks(Marker, Msg, Opts) end, Markers)
    end.

marks(Marker, Msg, Opts) when is_map(Marker) ->
    Field = hb_maps:get(<<"field">>, Marker, undefined, Opts),
    Values = hb_maps:get(<<"values">>, Marker, [], Opts),
    is_binary(Field) andalso
        lists:member(hb_maps:get(Field, Msg, undefined, Opts), Values);
marks(Field, Msg, Opts) when is_binary(Field) ->
    hb_maps:is_key(Field, Msg, Opts);
marks(_Marker, _Msg, _Opts) ->
    false.

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
%% best-first in Meilisearch ranking order. Bare binaries encode inline over HTTP on every
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

%% Presence markers match any message carrying the field; value markers
%% narrow that to named kinds, so private records sharing the field stay
%% out of the index.
markers_match_on_presence_test() ->
    Opts = #{ <<"search-index-markers">> => [<<"claim-name">>] },
    ?assert(indexable(#{ <<"claim-name">> => <<"a-claim">> }, Opts)),
    ?assertNot(indexable(#{ <<"schema">> => <<"odysee-upload@1.0">> }, Opts)).

markers_match_on_value_test() ->
    Opts =
        #{
            <<"search-index-markers">> =>
                [#{
                    <<"field">> => <<"schema">>,
                    <<"values">> => [<<"odysee-upload@1.0">>]
                }]
        },
    ?assert(indexable(#{ <<"schema">> => <<"odysee-upload@1.0">> }, Opts)),
    ?assertNot(indexable(#{ <<"schema">> => <<"odysee-auth@1.0">> }, Opts)),
    ?assertNot(indexable(#{ <<"schema">> => <<"odysee-subscription@1.0">> }, Opts)),
    ?assertNot(indexable(#{ <<"title">> => <<"no schema at all">> }, Opts)).

%% The node's own configuration is the thing that has to be right.
node_markers_admit_products_only_test() ->
    Opts = hb_odysee_node:upload_opts(#{}),
    Admitted =
        [
            #{ <<"schema">> => <<"odysee-upload@1.0">> },
            #{ <<"schema">> => <<"odysee-channel@1.0">> },
            #{ <<"schema">> => <<"odysee-playlist@1.0">> },
            #{ <<"schema">> => <<"odysee-comment@1.0">> },
            #{ <<"claim-name">> => <<"a-legacy-claim">> }
        ],
    Refused =
        [
            #{ <<"schema">> => <<"odysee-auth@1.0">> },
            #{ <<"schema">> => <<"odysee-subscription@1.0">> },
            #{ <<"schema">> => <<"odysee-reaction@1.0">> },
            #{ <<"schema">> => <<"odysee-comment-control@1.0">> },
            #{ <<"content-type">> => <<"application/javascript">> }
        ],
    [?assert(indexable(Msg, Opts)) || Msg <- Admitted],
    [?assertNot(indexable(Msg, Opts)) || Msg <- Refused],
    ok.

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
