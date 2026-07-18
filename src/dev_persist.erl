%%% @doc `persist@1.0': store hook-committed request messages in the
%%% node's cache.
%%%
%%% A node's `store-all-signed' option only persists messages that arrive
%%% signed on the wire: it runs at HTTP decode time, before the request
%%% hooks. A message that becomes signed through the `~auth-hook@1.0'
%%% pipeline (for example a browser `POST /id?!=true' committed with a
%%% cookie-derived user wallet) is therefore never stored -- the caller
%%% receives an ID that no node can serve.
%%%
%%% This device closes that gap at the node-configuration layer. Append it
%%% to the `on/request' pipeline after the auth hook:
%%%
%%% ```
%%% #{ <<"device">> => <<"persist@1.0">>, <<"path">> => <<"request">> }
%%% '''
%%%
%%% Each message in the (post-hook) sequence that carries commitments is
%%% written to the node's cache, making it readable by its committed ID
%%% and discoverable via `~query@1.0'. Uncommitted messages are untouched,
%%% so requests the auth hook declined to sign persist nothing.
-module(dev_persist).
-implements(<<"persist@1.0">>).
-export([info/1, request/3]).

info(_Opts) ->
    #{ exports => [<<"request">>] }.

%% @doc The `on/request' pipeline handler. Writes every committed message
%% in the sequence to the node's cache. When the request resolves `id',
%% the stored id is also merged into the cookie provider's trailing `set'
%% message: that step replaces the bare id result with the loaded message
%% (to deliver `set-cookie'), so without the annotation the caller of a
%% `POST /id?!=true' would never learn the id of what it stored.
request(_Base, Req, Opts) ->
    Sequence = sequence_messages(hb_maps:get(<<"body">>, Req, [], Opts), Opts),
    lists:foreach(fun(Msg) -> persist(Msg, Opts) end, Sequence),
    {ok, Req#{ <<"body">> => annotate_id(Sequence, Opts) }}.

%% Merge the id of the posted (first committed) message into the trailing
%% `set' message when the sequence contains an `id' step, under
%% `message-id' (`id' itself is a reserved device key that `set' filters).
%% The id used is the full content id -- the value the `id' step produces.
annotate_id(Sequence, Opts) ->
    WantsId =
        lists:any(
            fun(#{ <<"path">> := <<"id">> }) -> true; (_) -> false end,
            [M || M <- Sequence, is_map(M)]
        ),
    case [M || M <- Sequence, is_map(M), is_committed(M, Opts)] of
        [Posted | _] when WantsId ->
            Id = hb_message:id(Posted, uncommitted, Opts),
            [
                case Msg of
                    #{ <<"path">> := <<"set">>, <<"set-cookie">> := _ } ->
                        Msg#{ <<"message-id">> => Id };
                    _ ->
                        Msg
                end
            ||
                Msg <- Sequence
            ];
        _ ->
            Sequence
    end.

is_committed(Msg, Opts) ->
    map_size(hb_maps:get(<<"commitments">>, Msg, #{}, Opts)) > 0.

%% The hook body is the request's message sequence: a list in-memory, an
%% ordered-list message after TABM conversion, or a single message.
sequence_messages(Sequence, _Opts) when is_list(Sequence) -> Sequence;
sequence_messages(Sequence, Opts) when is_map(Sequence) ->
    case hb_util:is_ordered_list(Sequence, Opts) of
        true -> hb_util:message_to_ordered_list(Sequence, Opts);
        false -> [Sequence]
    end;
sequence_messages(_Sequence, _Opts) -> [].

persist(Msg, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"commitments">>, Msg, #{}, Opts) of
        Commitments when map_size(Commitments) > 0 ->
            {ok, Path} = hb_cache:write(Msg, Opts),
            link_ids(Msg, Path, Opts);
        _ ->
            ok
    end;
persist(_Msg, _Opts) ->
    ok.

%% The write registers the committed-view content id and each commitment
%% id, but a caller holds the ids the resolver hands out: the full content
%% id (uncommitted keys included -- what resolving `id' returns) and the
%% committed id. Alias both to the stored path so reads by any identity
%% the caller can observe resolve to the message.
link_ids(Msg, Path, Opts) ->
    lists:foreach(
        fun(Id) when is_binary(Id), Id =/= Path ->
                hb_store:link(#{ Id => Path }, Opts);
            (_) ->
                ok
        end,
        [
            hb_message:id(Msg, uncommitted, Opts),
            hb_message:id(Msg, signed, Opts)
        ]
    ).

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

%% @doc A browser-style `POST /id?!=true' on a cookie-auth node: the
%% response carries a cookie, the returned ID reads back over HTTP, and
%% the committed message is discoverable via `~query@1.0'.
cookie_commit_post_persists_test() ->
    Hooks = hb_odysee_node:cookie_auth_hooks(#{}),
    Store = hb_test_utils:test_store(),
    Node =
        hb_http_server:start_node(#{
            <<"port">> => 0,
            <<"priv-wallet">> => ar_wallet:new(),
            <<"store">> => [Store],
            <<"match-index">> => [Store],
            <<"on">> => Hooks
        }),
    {ok, Response} =
        hb_http:post(
            Node,
            #{
                <<"path">> => <<"/id?!=true">>,
                <<"persist-test-key">> => <<"persist-probe-1">>
            },
            #{}
        ),
    % The cookie provider's trailing `set' step folds the set-cookie into
    % the response message; the stored id rides along under `message-id'.
    ID = hb_maps:get(<<"message-id">>, Response, not_found, #{}),
    ?assert(is_binary(ID)),
    {ok, ReadBack} = hb_http:get(Node, <<"/", ID/binary>>, #{}),
    ?assertEqual(
        <<"persist-probe-1">>,
        hb_maps:get(<<"persist-test-key">>, ReadBack, not_found, #{})
    ),
    % Discoverable via `~query@1.0', in the shape the UI queries with.
    {ok, Paths} =
        hb_http:post(
            Node,
            #{
                <<"path">> => <<"/~query@1.0/only">>,
                <<"persist-test-key">> => <<"persist-probe-1">>,
                <<"only">> => [<<"persist-test-key">>],
                <<"return">> => <<"paths">>
            },
            #{}
        ),
    ?assert(is_binary(hb_maps:get(<<"1">>, Paths, not_found, #{}))).

-endif.
