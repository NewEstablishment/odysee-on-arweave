%%% @doc Narrow Odysee account/settings compatibility device.
%%%
%%% This intentionally does not restore the removed `odysee@1.0' catch-all
%%% SDK proxy. It only exposes account preference/settings methods that the
%%% frontend needs during the auth migration.
-module(dev_odysee_account).
-implements(<<"odysee-account@1.0">>).
-export([info/1, preference_get/3, preference_set/3, settings_get/3, settings_set/3, settings_clear/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-account@1.0">>).
-define(DEFAULT_PROXY_URL, <<"https://api.na-backend.odysee.com/api/v1/proxy">>).

info(_Opts) ->
    #{
        exports => [
            <<"preference-get">>,
            <<"preference-set">>,
            <<"settings-get">>,
            <<"settings-set">>,
            <<"settings-clear">>
        ]
    }.

preference_get(Base, Req, Opts) -> sdk(<<"preference_get">>, Base, Req, Opts).
preference_set(Base, Req, Opts) -> sdk(<<"preference_set">>, Base, Req, Opts).
settings_get(Base, Req, Opts) -> sdk(<<"settings_get">>, Base, Req, Opts).
settings_set(Base, Req, Opts) -> sdk(<<"settings_set">>, Base, Req, Opts).
settings_clear(Base, Req, Opts) -> sdk(<<"settings_clear">>, Base, Req, Opts).

sdk(Method, Base, Req, Opts) ->
    safe(fun() ->
        Params = proxy_params(Base, Req, Opts),
        Payload = hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"method">> => Method,
            <<"params">> => Params,
            <<"id">> => 1
        }),
        Msg0 = #{
            <<"method">> => <<"POST">>,
            <<"path">> => proxy_url(Base, Req, Opts),
            <<"content-type">> => <<"application/json">>,
            <<"body">> => Payload
        },
        Msg = maps:merge(Msg0, proxy_api_headers(Base, Req, Opts)),
        case hb_http:request(Msg, Opts) of
            {ok, #{ <<"body">> := Body }} when is_binary(Body) -> decode_body(Method, Body, Opts);
            {ok, Body} when is_binary(Body) -> decode_body(Method, Body, Opts);
            {ok, Other} -> {error, {account_proxy_response_without_body, Other}};
            Error -> Error
        end
    end).

decode_body(Method, Body, Opts) ->
    maybe
        {ok, Decoded} ?= try_decode_json(Body),
        case hb_maps:get(<<"error">>, Decoded, not_found, Opts) of
            not_found ->
                Result = hb_maps:get(<<"result">>, Decoded, Decoded, Opts),
                {ok, #{
                    <<"device">> => ?DEVICE,
                    <<"content-type">> => <<"application/json">>,
                    <<"method">> => Method,
                    <<"body">> => Body,
                    <<"result">> => Result
                }};
            Error ->
                {ok, #{
                    <<"device">> => ?DEVICE,
                    <<"status">> => 400,
                    <<"content-type">> => <<"application/json">>,
                    <<"method">> => Method,
                    <<"body">> => Body,
                    <<"error">> => Error
                }}
        end
    end.

proxy_params(Base, Req, Opts) ->
    BodyParams = maps:merge(body_params(Base, Opts), body_params(Req, Opts)),
    Clean = maps:merge(clean_proxy_map(Base), maps:merge(clean_proxy_map(Req), BodyParams)),
    maps:without(proxy_control_keys(), Clean).

clean_proxy_map(Msg) when is_map(Msg) ->
    maps:filter(fun(Key, _Value) -> not lists:member(Key, proxy_control_keys()) end, Msg);
clean_proxy_map(_Msg) ->
    #{}.

proxy_control_keys() ->
    [
        <<"accept">>,
        <<"accept-bundle">>,
        <<"accept-encoding">>,
        <<"accept-language">>,
        <<"authorization">>,
        <<"body">>,
        <<"commitments">>,
        <<"connection">>,
        <<"content-length">>,
        <<"content-type">>,
        <<"cookie">>,
        <<"device">>,
        <<"host">>,
        <<"method">>,
        <<"origin">>,
        <<"path">>,
        <<"priv">>,
        <<"referer">>,
        <<"sec-ch-ua">>,
        <<"sec-ch-ua-mobile">>,
        <<"sec-ch-ua-platform">>,
        <<"sec-fetch-dest">>,
        <<"sec-fetch-mode">>,
        <<"sec-fetch-site">>,
        <<"sec-gpc">>,
        <<"signature-input">>,
        <<"user-agent">>,
        <<"x-odysee-auth-token">>,
        <<"x-lbry-auth-token">>,
        <<"odysee-auth-token">>,
        <<"auth_token">>,
        <<"auth-token">>,
        <<"access_token">>,
        <<"access-token">>,
        <<"refresh_token">>,
        <<"refresh-token">>
    ].

proxy_api_headers(Base, Req, Opts) ->
    case find_auth_token(Req, Opts) of
        {ok, Token} ->
            #{ <<"x-lbry-auth-token">> => Token };
        {error, not_found} ->
            case find_auth_token(Base, Opts) of
                {ok, Token} -> #{ <<"x-lbry-auth-token">> => Token };
                {error, not_found} -> #{}
            end
    end.

find_auth_token(Msg, Opts) ->
    AuthKeys = [<<"x-odysee-auth-token">>, <<"x-lbry-auth-token">>, <<"odysee-auth-token">>, <<"auth_token">>],
    case first_param(AuthKeys, #{}, Msg, Opts) of
        not_found ->
            case first_param(AuthKeys, #{}, body_params(Msg, Opts), Opts) of
                not_found -> find_auth_cookie(Msg, Opts);
                Token -> {ok, token_value(Token)}
            end;
        Token -> {ok, token_value(Token)}
    end.

find_auth_cookie(Msg, Opts) when is_map(Msg) ->
    case hb_maps:find(<<"cookie">>, Msg, Opts) of
        {ok, Cookie} -> token_from_cookie(hb_util:bin(Cookie));
        error -> {error, not_found}
    end;
find_auth_cookie(_Msg, _Opts) ->
    {error, not_found}.

token_from_cookie(Cookie) ->
    token_from_cookie_parts(binary:split(Cookie, <<";">>, [global])).

token_from_cookie_parts([]) ->
    {error, not_found};
token_from_cookie_parts([Part | Rest]) ->
    case binary:split(Part, <<"=">>) of
        [Name, Value] ->
            case trim_bin(Name) of
                <<"auth_token">> -> {ok, trim_bin(Value)};
                _ -> token_from_cookie_parts(Rest)
            end;
        _ ->
            token_from_cookie_parts(Rest)
    end.

token_value(#{ <<"value">> := Value }) -> hb_util:bin(Value);
token_value(Value) -> hb_util:bin(Value).

trim_bin(Bin) ->
    list_to_binary(string:trim(binary_to_list(Bin))).

proxy_url(Base, Req, Opts) ->
    case first_found(
        [
            {Req, <<"proxy-url">>},
            {Req, <<"proxy_url">>},
            {Base, <<"proxy-url">>},
            {Base, <<"proxy_url">>}
        ],
        Opts
    ) of
        not_found -> hb_opts:get(<<"lbry-proxy-url">>, ?DEFAULT_PROXY_URL, Opts);
        URL -> URL
    end.

body_params(Msg, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"body">>, Msg, not_found, Opts) of
        #{ <<"params">> := Params } when is_map(Params) ->
            Params;
        Body when is_map(Body) ->
            Body;
        Body when is_binary(Body) ->
            case try_decode_json(Body) of
                {ok, #{ <<"params">> := Params }} when is_map(Params) -> Params;
                {ok, Decoded} when is_map(Decoded) -> Decoded;
                _ -> #{}
            end;
        _ ->
            #{}
    end;
body_params(_Msg, _Opts) ->
    #{}.

first_param(Keys, Base, Req, Opts) ->
    first_found([{Req, Key} || Key <- Keys] ++ [{Base, Key} || Key <- Keys], Opts).

first_found([], _Opts) ->
    not_found;
first_found([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_found(Rest, Opts);
        Value -> Value
    end;
first_found([_ | Rest], Opts) ->
    first_found(Rest, Opts).

try_decode_json(Raw) ->
    try {ok, hb_json:decode(Raw)}
    catch _:_ -> {error, invalid_json}
    end.

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> {error, Reason};
        _:Reason -> {error, Reason}
    end.

-ifdef(TEST).

proxy_params_strips_auth_for_sdk_proxy_but_keeps_settings_test() ->
    Params = proxy_params(
        #{},
        #{
            <<"auth_token">> => <<"secret">>,
            <<"accept-bundle">> => <<"bundle">>,
            <<"connection">> => <<"keep-alive">>,
            <<"key">> => <<"theme">>,
            <<"value">> => <<"dark">>
        },
        #{}
    ),
    ?assertEqual(false, maps:is_key(<<"auth_token">>, Params)),
    ?assertEqual(false, maps:is_key(<<"accept-bundle">>, Params)),
    ?assertEqual(false, maps:is_key(<<"connection">>, Params)),
    ?assertEqual(<<"theme">>, maps:get(<<"key">>, Params)),
    ?assertEqual(<<"dark">>, maps:get(<<"value">>, Params)).

legacy_api_headers_forwards_cookie_token_test() ->
    ?assertEqual(
        #{ <<"x-lbry-auth-token">> => <<"tok">> },
        proxy_api_headers(#{}, #{ <<"cookie">> => <<"a=1; auth_token=tok; b=2">> }, #{})
    ).

legacy_api_headers_extracts_body_token_test() ->
    ?assertEqual(
        #{ <<"x-lbry-auth-token">> => <<"tok">> },
        proxy_api_headers(#{}, #{ <<"body">> => <<"{\"auth_token\":\"tok\",\"key\":\"shared\"}">> }, #{})
    ).

-endif.
