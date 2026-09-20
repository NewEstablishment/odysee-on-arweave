%%% @doc JSON-RPC client for the legacy Odysee SDK proxy. Wraps the
%%% `claim_search', `resolve', and `transaction_show' methods, normalizing
%%% Odysee web URLs to `lbry://' form before resolution. Successful calls
%%% return `{ok, Result}'; definitive rejections (4xx, JSON-RPC errors)
%%% return `{error, Reason}'; transport faults and 5xx responses return
%%% `{failure, Reason}' so callers can distinguish "not found" from
%%% "proxy unavailable".
-module(hb_odysee_client).
-export([call/3, claim/2, claim_search/2, resolve/2, transaction_show/2, view_counts/2]).

-define(DEFAULT_PROXY_NODE, <<"https://api.na-backend.odysee.com">>).
-define(PROXY_PATH, <<"/api/v1/proxy">>).
-define(DEFAULT_PROXY_TIMEOUT, 10000).
-define(DEFAULT_API_NODE, <<"https://api.odysee.com">>).
-define(VIEW_TOKEN_KEY(Node), {?MODULE, view_token, Node}).

claim(ClaimIDOrName, Opts) ->
    case valid_claim_id(ClaimIDOrName) of
        true -> claim_search(ClaimIDOrName, Opts);
        false -> resolve(ClaimIDOrName, Opts)
    end.

claim_search(ClaimID, Opts) ->
    Params = #{
        <<"claim_ids">> => [hb_util:to_lower(ClaimID)],
        <<"page">> => 1,
        <<"page_size">> => 1,
        <<"no_totals">> => true
    },
    case call(<<"claim_search">>, Params, Opts) of
        {ok, #{ <<"items">> := [Claim | _] }} -> {ok, Claim};
        {ok, #{ <<"items">> := [] }} -> {error, not_found};
        Other -> Other
    end.

resolve(NameOrURL, Opts) ->
    URL = ensure_lbry_url(NameOrURL),
    Params = #{ <<"urls">> => [URL] },
    case call(<<"resolve">>, Params, Opts) of
        {ok, Result} ->
            case maps:get(URL, Result, undefined) of
                undefined -> {error, not_found};
                Claim -> {ok, Claim}
            end;
        Other ->
            Other
    end.

transaction_show(TxID, Opts) ->
    call(<<"transaction_show">>, #{ <<"txid">> => hb_util:to_lower(TxID) }, Opts).

%% @doc Return authoritative legacy view totals in the requested order. The
%% anonymous service token is kept in node memory only and is never written to
%% a message or store.
view_counts(ClaimIDs, Opts) when is_list(ClaimIDs) ->
    Node = hb_maps:get(<<"odysee-api-node">>, Opts, ?DEFAULT_API_NODE, Opts),
    case legacy_api_token(Node, Opts) of
        {ok, Token} ->
            legacy_view_counts(Node, Token, ClaimIDs, Opts);
        Error ->
            Error
    end.

call(Method, Params, Opts) ->
    Body =
        hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"method">> => Method,
            <<"params">> => Params,
            <<"id">> => 1
        }),
    Path = <<?PROXY_PATH/binary, "?m=", Method/binary>>,
    Node = hb_maps:get(<<"lbry-proxy-node">>, Opts, ?DEFAULT_PROXY_NODE, Opts),
    Timeout = hb_maps:get(
        <<"lbry-proxy-timeout">>,
        Opts,
        ?DEFAULT_PROXY_TIMEOUT,
        Opts
    ),
    HTTPOpts =
        Opts#{
            <<"http-client">> =>
                hb_maps:get(<<"http-client">>, Opts, hackney, Opts),
            <<"http-client-connect-timeout">> => min(Timeout, 5000),
            <<"http-client-hackney-recv-timeout">> => Timeout,
            <<"http-retry">> =>
                hb_maps:get(<<"lbry-proxy-retries">>, Opts, 0, Opts)
        },
    Request = #{
        peer => Node,
        path => Path,
        method => <<"POST">>,
        headers => #{ <<"content-type">> => <<"application/json-rpc">> },
        body => Body
    },
    case request_with_timeout(Request, HTTPOpts, Timeout) of
        {ok, 200, _Headers, RespBody} ->
            decode_proxy_response(RespBody);
        {ok, Status, _Headers, RespBody} when Status < 500 ->
            {error, {http_status, Status, RespBody}};
        {ok, Status, _Headers, RespBody} ->
            {failure, {http_status, Status, RespBody}};
        {error, Reason} ->
            {failure, Reason}
    end.

request_with_timeout(Request, Opts, Timeout) ->
    Caller = self(),
    Ref = make_ref(),
    {Pid, Monitor} = spawn_monitor(fun() ->
        Caller ! {Ref, hb_http_client:request(Request, Opts)}
    end),
    receive
        {Ref, Result} ->
            erlang:demonitor(Monitor, [flush]),
            Result;
        {'DOWN', Monitor, process, Pid, Reason} ->
            {error, {http_client_exit, Reason}}
    after Timeout ->
        exit(Pid, kill),
        receive
            {'DOWN', Monitor, process, Pid, _Reason} -> ok
        end,
        {error, timeout}
    end.

decode_proxy_response(RespBody) ->
    try hb_json:decode(RespBody) of
        #{ <<"result">> := Result } -> {ok, Result};
        #{ <<"error">> := Error } -> {error, Error};
        Other -> {error, {invalid_proxy_response, Other}}
    catch
        _:_ ->
            {error, invalid_proxy_json}
    end.

legacy_api_token(Node, Opts) ->
    Key = ?VIEW_TOKEN_KEY(Node),
    case persistent_term:get(Key, undefined) of
        Token when is_binary(Token), Token =/= <<>> ->
            {ok, Token};
        _ ->
            global:trans(
                {{?MODULE, view_token, Node}, self()},
                fun() -> create_legacy_api_token(Node, Key, Opts) end
            )
    end.

create_legacy_api_token(Node, Key, Opts) ->
    case persistent_term:get(Key, undefined) of
        Token when is_binary(Token), Token =/= <<>> ->
            {ok, Token};
        _ ->
            AppID0 = <<"odyseecom", (hb_util:to_hex(crypto:strong_rand_bytes(32)))/binary>>,
            AppID = binary:part(AppID0, 0, min(66, byte_size(AppID0))),
            case legacy_api_call(
                Node,
                <<"/user/new">>,
                #{ <<"auth_token">> => <<>>, <<"language">> => <<"en">>, <<"app_id">> => AppID },
                Opts
            ) of
                {ok, #{ <<"auth_token">> := Token }} when is_binary(Token), Token =/= <<>> ->
                    persistent_term:put(Key, Token),
                    {ok, Token};
                {ok, #{ <<"data">> := #{ <<"auth_token">> := Token }}}
                        when is_binary(Token), Token =/= <<>> ->
                    persistent_term:put(Key, Token),
                    {ok, Token};
                {ok, Other} ->
                    {error, {missing_auth_token, Other}};
                Error ->
                    Error
            end
    end.

legacy_view_counts(_Node, _Token, [], _Opts) ->
    {ok, []};
legacy_view_counts(Node, Token, ClaimIDs, Opts) ->
    CSV = iolist_to_binary(lists:join(<<",">>, ClaimIDs)),
    case legacy_api_call(
        Node,
        <<"/file/view_count">>,
        #{ <<"auth_token">> => Token, <<"claim_id">> => CSV },
        Opts
    ) of
        {ok, Counts} when is_list(Counts), length(Counts) =:= length(ClaimIDs) ->
            {ok, Counts};
        {ok, Other} ->
            {error, {invalid_view_counts, Other}};
        Error ->
            Error
    end.

legacy_api_call(Node, Path, Fields, Opts) ->
    Body = uri_string:compose_query(maps:to_list(Fields)),
    Timeout = hb_maps:get(
        <<"odysee-api-timeout">>,
        Opts,
        hb_maps:get(<<"lbry-proxy-timeout">>, Opts, ?DEFAULT_PROXY_TIMEOUT, Opts),
        Opts
    ),
    HTTPOpts =
        Opts#{
            <<"http-client">> => hb_maps:get(<<"http-client">>, Opts, hackney, Opts),
            <<"http-client-connect-timeout">> => min(Timeout, 5000),
            <<"http-client-hackney-recv-timeout">> => Timeout,
            <<"http-retry">> => hb_maps:get(<<"lbry-proxy-retries">>, Opts, 0, Opts)
        },
    Request = #{
        peer => Node,
        path => Path,
        method => <<"POST">>,
        headers => #{ <<"content-type">> => <<"application/x-www-form-urlencoded">> },
        body => Body
    },
    case request_with_timeout(Request, HTTPOpts, Timeout) of
        {ok, 200, _Headers, RespBody} ->
            decode_legacy_api_response(RespBody);
        {ok, Status, _Headers, RespBody} when Status < 500 ->
            {error, {http_status, Status, RespBody}};
        {ok, Status, _Headers, RespBody} ->
            {failure, {http_status, Status, RespBody}};
        {error, Reason} ->
            {failure, Reason}
    end.

decode_legacy_api_response(RespBody) ->
    try hb_json:decode(RespBody) of
        #{ <<"success">> := true, <<"data">> := Data } -> {ok, Data};
        #{ <<"success">> := false } = Error -> {error, Error};
        Other -> {error, {invalid_legacy_api_response, Other}}
    catch
        _:_ -> {error, invalid_legacy_api_json}
    end.

ensure_lbry_url(<<"lbry://", _/binary>> = URL) ->
    URL;
ensure_lbry_url(<<"http://", _/binary>> = URL) ->
    web_url_to_lbry(URL);
ensure_lbry_url(<<"https://", _/binary>> = URL) ->
    web_url_to_lbry(URL);
ensure_lbry_url(Name) when is_binary(Name) ->
    <<"lbry://", Name/binary>>.

web_url_to_lbry(URL) ->
    case uri_string:parse(URL) of
        #{host := Host, path := Path} when is_binary(Host), is_binary(Path) ->
            case odysee_host(Host) of
                true -> odysee_path_to_lbry(Path);
                false -> URL
            end;
        _ ->
            URL
    end.

odysee_host(Host0) ->
    Host = hb_util:to_lower(Host0),
    Host == <<"odysee.com">> orelse
        Host == <<"lbry.tv">> orelse
        has_suffix(Host, <<".odysee.com">>) orelse
        has_suffix(Host, <<".lbry.tv">>).

has_suffix(Bin, Suffix) when byte_size(Bin) > byte_size(Suffix) ->
    binary:part(Bin, byte_size(Bin) - byte_size(Suffix), byte_size(Suffix)) == Suffix;
has_suffix(_, _) ->
    false.

odysee_path_to_lbry(<<"/", Path/binary>>) when byte_size(Path) > 0 ->
    Parts = binary:split(Path, <<"/">>, [global]),
    LBRYParts =
        lists:map(
            fun(Part) ->
                unicode:characters_to_binary(
                    uri_string:percent_decode(
                        claim_separator_to_hash(Part)
                    )
                )
            end,
            Parts
        ),
    <<"lbry://", (join_path(LBRYParts))/binary>>;
odysee_path_to_lbry(_) ->
    <<"lbry://">>.

join_path([]) ->
    <<>>;
join_path([Part]) ->
    Part;
join_path([Part | Rest]) ->
    <<Part/binary, "/", (join_path(Rest))/binary>>.

claim_separator_to_hash(Part) ->
    case binary:matches(Part, <<":">>) of
        [] ->
            Part;
        Matches ->
            {Pos, 1} = lists:last(Matches),
            <<Name:Pos/binary, ":", ClaimID/binary>> = Part,
            <<Name/binary, "#", ClaimID/binary>>
    end.

valid_claim_id(ClaimID) ->
    hb_odysee_util:valid_hex(ClaimID, 20).

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

claim_search_uses_minimal_proxy_request_test() ->
    ClaimID = <<"64bdbe210b3d9ba616f3a197ea3e0388e360f5e8">>,
    Claim = #{ <<"claim_id">> => ClaimID },
    Response =
        hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"result">> => #{ <<"items">> => [Claim] },
            <<"id">> => 1
        }),
    {ok, Server, Handle} = hb_mock_server:start([
        {"/api/v1/proxy", proxy, {200, Response}}
    ]),
    try
        {ok, Claim} =
            claim_search(
                ClaimID,
                #{ <<"lbry-proxy-node">> => Server, <<"http-client">> => httpc }
            ),
        [Req] = hb_mock_server:get_requests(Handle, proxy),
        ?assertEqual(<<"m=claim_search">>, maps:get(<<"qs">>, Req)),
        Sent = hb_json:decode(maps:get(<<"body">>, Req)),
        Params = maps:get(<<"params">>, Sent),
        ?assertEqual([ClaimID], maps:get(<<"claim_ids">>, Params)),
        ?assertEqual(true, maps:get(<<"no_totals">>, Params)),
        ?assertEqual(1, maps:get(<<"page_size">>, Params))
    after
        hb_mock_server:stop(Handle)
    end.

proxy_timeout_is_enforced_test() ->
    SlowResponse = fun(_Req) ->
        timer:sleep(250),
        {200, <<"{}">>}
    end,
    {ok, Server, Handle} = hb_mock_server:start([
        {"/api/v1/proxy", proxy, SlowResponse}
    ]),
    try
        Started = erlang:monotonic_time(millisecond),
        Result = call(
            <<"claim_search">>,
            #{},
            #{
                <<"lbry-proxy-node">> => Server,
                <<"lbry-proxy-timeout">> => 50,
                <<"http-client">> => httpc
            }
        ),
        Elapsed = erlang:monotonic_time(millisecond) - Started,
        ?assertMatch({failure, _}, Result),
        ?assert(Elapsed < 200)
    after
        hb_mock_server:stop(Handle)
    end.

resolve_uses_lbry_url_test() ->
    URL = <<"lbry://sample#abc">>,
    Claim = #{ <<"permanent_url">> => URL },
    Response =
        hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"result">> => #{ URL => Claim },
            <<"id">> => 1
        }),
    {ok, Server, Handle} = hb_mock_server:start([
        {"/api/v1/proxy", proxy, {200, Response}}
    ]),
    try
        ?assertEqual(
            {ok, Claim},
            resolve(
                URL,
                #{ <<"lbry-proxy-node">> => Server, <<"http-client">> => httpc }
            )
        )
    after
        hb_mock_server:stop(Handle)
    end.

resolve_converts_odysee_web_url_test() ->
    URL = <<"https://odysee.com/@channel:abc/video:def">>,
    LBRYURL = <<"lbry://@channel#abc/video#def">>,
    Claim = #{ <<"canonical_url">> => LBRYURL },
    Response =
        hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"result">> => #{ LBRYURL => Claim },
            <<"id">> => 1
        }),
    {ok, Server, Handle} = hb_mock_server:start([
        {"/api/v1/proxy", proxy, {200, Response}}
    ]),
    try
        ?assertEqual(
            {ok, Claim},
            resolve(
                URL,
                #{ <<"lbry-proxy-node">> => Server, <<"http-client">> => httpc }
            )
        )
    after
        hb_mock_server:stop(Handle)
    end.

-endif.
