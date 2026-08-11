%%% @doc `reply-id@1.0': deliver the stored message's ID to commit-flag
%%% callers on cookie-auth nodes.
%%%
%%% A `POST /id?!&committers=all' resolves to the committed message's
%%% signed ID, but the `~cookie@1.0' secret provider appends a `set'
%%% message to the sequence (to fold its `set-cookie' into the reply), so
%%% the final result is the loaded message rather than the ID -- the
%%% caller never learns what it stored. This device rewrites that `set'
%%% message to carry the ID under `message-id' (`id' itself is a reserved
%%% device key that `set' filters), so the reply exposes it as a header.
%%%
%%% Append to the `on/request' pipeline after the auth hook:
%%%
%%% ```
%%% #{ <<"device">> => <<"reply-id@1.0">>, <<"path">> => <<"request">> }
%%% '''
%%%
%%% Persistence itself is the auth hook's job upstream: it honours
%%% `store-all-signed' for the messages it commits.
-module(dev_reply_id).
-implements(<<"reply-id@1.0">>).
-export([info/1, request/3]).

info(_Opts) ->
    #{ exports => [<<"request">>] }.

%% @doc The `on/request' pipeline handler: a transparent stage that
%% annotates the cookie provider's trailing `set' message when the
%% sequence resolves `id' on a committed message.
request(_Base, Req, Opts) ->
    Sequence = sequence_messages(hb_maps:get(<<"body">>, Req, [], Opts), Opts),
    {ok, Req#{ <<"body">> => annotate_id(Sequence, Opts) }}.

%% Merge the signed ID of the posted (first committed) message -- the
%% value the `id' step itself resolves to under `committers=all' -- into
%% the trailing `set' message.
annotate_id(Sequence, Opts) ->
    WantsId =
        lists:any(
            fun(#{ <<"path">> := <<"id">> }) -> true; (_) -> false end,
            [Msg || Msg <- Sequence, is_map(Msg)]
        ),
    case [Msg || Msg <- Sequence, is_map(Msg), is_committed(Msg, Opts)] of
        [Posted | _] when WantsId ->
            Id = hb_message:id(Posted, signed, Opts),
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

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

%% @doc A browser-style commit POST on a cookie-auth node: the reply
%% carries a cookie and exposes the stored ID, the ID reads back over
%% HTTP, and the committed message is discoverable via `~query@1.0'.
cookie_commit_post_replies_with_id_test() ->
    Hooks = hb_odysee_node:cookie_auth_hooks(#{}),
    Store = hb_test_utils:test_store(),
    Node =
        hb_http_server:start_node(#{
            <<"port">> => 0,
            <<"priv-wallet">> => ar_wallet:new(),
            <<"store">> => [Store],
            <<"match-index">> => [Store],
            <<"store-all-signed">> => true,
            <<"odysee-auth-allow-unvalidated-tokens">> => true,
            <<"odysee-auth-pbkdf2-iterations">> => 1,
            <<"odysee-auth-pbkdf2-key-length">> => 64,
            <<"on">> => Hooks
        }),
    {ok, Response} =
        hb_http:post(
            Node,
            #{
                <<"path">> => <<"/id?!=true&committers=all">>,
                <<"x-odysee-auth-token">> => <<"reply-id-probe-token">>,
                <<"reply-id-test-key">> => <<"reply-id-probe-1">>
            },
            #{}
        ),
    % A body-only reply collapses to the stored id itself; a message reply
    % carries it under `message-id'.
    ID =
        case Response of
            Bin when is_binary(Bin) -> Bin;
            _ -> hb_maps:get(<<"message-id">>, Response, not_found, #{})
        end,
    ?assert(is_binary(ID)),
    {ok, ReadBack} = hb_http:get(Node, <<"/", ID/binary>>, #{}),
    ?assertEqual(
        <<"reply-id-probe-1">>,
        hb_maps:get(<<"reply-id-test-key">>, ReadBack, not_found, #{})
    ),
    {ok, Paths} =
        hb_http:post(
            Node,
            #{
                <<"path">> => <<"/~query@1.0/only">>,
                <<"reply-id-test-key">> => <<"reply-id-probe-1">>,
                <<"only">> => [<<"reply-id-test-key">>],
                <<"return">> => <<"paths">>
            },
            #{}
        ),
    ?assert(is_binary(hb_maps:get(<<"1">>, Paths, not_found, #{}))).

-endif.
