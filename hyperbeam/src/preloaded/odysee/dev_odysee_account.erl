%%% @doc Narrow Odysee account/settings compatibility device.
%%%
%%% This intentionally does not restore the removed `odysee@1.0' catch-all
%%% SDK proxy. It only exposes account preference/settings methods that the
%%% frontend needs during the auth migration.
-module(dev_odysee_account).
-implements(<<"odysee-account@1.0">>).
-export([
    info/1,
    preference_get/3,
    preference_set/3,
    settings_get/3,
    settings_set/3,
    settings_clear/3,
    user_exists/3,
    user_new/3,
    user_signin/3,
    user_me/3,
    user_email_resend_token/3
]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-account@1.0">>).
-define(DEFAULT_PROXY_URL, <<"https://api.na-backend.odysee.com/api/v1/proxy">>).
-define(DEFAULT_API_URL, <<"https://api.odysee.com">>).

info(_Opts) ->
    #{
        exports => [
            <<"preference-get">>,
            <<"preference-set">>,
            <<"settings-get">>,
            <<"settings-set">>,
            <<"settings-clear">>,
            <<"user-exists">>,
            <<"user-new">>,
            <<"user-signin">>,
            <<"user-me">>,
            <<"user-email-resend-token">>
        ]
    }.

preference_get(Base, Req, Opts) -> sdk(<<"preference_get">>, Base, Req, Opts).
preference_set(Base, Req, Opts) -> sdk(<<"preference_set">>, Base, Req, Opts).
settings_get(Base, Req, Opts) -> sdk(<<"settings_get">>, Base, Req, Opts).
settings_set(Base, Req, Opts) -> sdk(<<"settings_set">>, Base, Req, Opts).
settings_clear(Base, Req, Opts) -> sdk(<<"settings_clear">>, Base, Req, Opts).
user_exists(Base, Req, Opts) -> api(<<"user">>, <<"exists">>, Base, Req, Opts).
user_new(Base, Req, Opts) -> api(<<"user">>, <<"new">>, Base, Req, Opts).
user_signin(Base, Req, Opts) -> api(<<"user">>, <<"signin">>, Base, Req, Opts).
user_me(Base, Req, Opts) -> api(<<"user">>, <<"me">>, Base, Req, Opts).
user_email_resend_token(Base, Req, Opts) -> api(<<"user_email">>, <<"resend_token">>, Base, Req, Opts).

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

api(Resource, Action, Base, Req, Opts) ->
    safe(fun() ->
        Params = api_params(Base, Req, Opts),
        Body = form_body(Params),
        Msg = #{
            <<"method">> => <<"POST">>,
            <<"path">> => api_url(Resource, Action, Base, Req, Opts),
            <<"content-type">> => <<"application/x-www-form-urlencoded">>,
            <<"body">> => Body
        },
        case hb_http:request(Msg, Opts) of
            {ok, #{ <<"body">> := RespBody, <<"status">> := Status }} when is_binary(RespBody) ->
                decode_api_body(Resource, Action, Status, RespBody, Opts);
            {ok, #{ <<"body">> := RespBody }} when is_binary(RespBody) ->
                decode_api_body(Resource, Action, 200, RespBody, Opts);
            {ok, RespBody} when is_binary(RespBody) ->
                decode_api_body(Resource, Action, 200, RespBody, Opts);
            {ok, Other} ->
                {error, {account_api_response_without_body, Other}};
            Error ->
                Error
        end
    end).

decode_api_body(Resource, Action, Status, Body, Opts) ->
    maybe
        {ok, Decoded} ?= try_decode_json(Body),
        case Status >= 200 andalso Status < 300 of
            true ->
                Result = hb_maps:get(<<"data">>, Decoded, Decoded, Opts),
                {ok, #{
                    <<"device">> => ?DEVICE,
                    <<"content-type">> => <<"application/json">>,
                    <<"resource">> => Resource,
                    <<"action">> => Action,
                    <<"body">> => Body,
                    <<"result">> => Result
                }};
            false ->
                {ok, #{
                    <<"device">> => ?DEVICE,
                    <<"status">> => Status,
                    <<"content-type">> => <<"application/json">>,
                    <<"resource">> => Resource,
                    <<"action">> => Action,
                    <<"body">> => Body,
                    <<"error">> => api_error(Decoded, Opts)
                }}
        end
    end.

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

api_params(Base, Req, Opts) ->
    BodyParams = maps:merge(body_params(Base, Opts), body_params(Req, Opts)),
    Clean = maps:merge(api_clean_map(Base), maps:merge(api_clean_map(Req), BodyParams)),
    Params0 = maps:without(api_control_keys(), Clean),
    case hb_maps:get(<<"auth_token">>, Params0, not_found, Opts) of
        not_found ->
            case find_auth_token(Req, Opts) of
                {ok, Token} -> Params0#{ <<"auth_token">> => Token };
                {error, not_found} ->
                    case find_auth_token(Base, Opts) of
                        {ok, Token} -> Params0#{ <<"auth_token">> => Token };
                        {error, not_found} -> Params0
                    end
            end;
        _Token ->
            Params0
    end.

clean_proxy_map(Msg) when is_map(Msg) ->
    maps:filter(fun(Key, _Value) -> not lists:member(Key, proxy_control_keys()) end, Msg);
clean_proxy_map(_Msg) ->
    #{}.

api_clean_map(Msg) when is_map(Msg) ->
    maps:filter(fun(Key, _Value) -> not lists:member(Key, api_control_keys()) end, Msg);
api_clean_map(_Msg) ->
    #{}.

api_control_keys() ->
    proxy_control_keys() --
        [
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

api_url(Resource, Action, Base, Req, Opts) ->
    case first_found(
        [
            {Req, <<"odysee-api-url">>},
            {Req, <<"odysee_api_url">>},
            {Base, <<"odysee-api-url">>},
            {Base, <<"odysee_api_url">>}
        ],
        Opts
    ) of
        not_found ->
            API = hb_opts:get(<<"odysee-api-url">>, ?DEFAULT_API_URL, Opts),
            <<(trim_trailing_slash(API))/binary, "/", Resource/binary, "/", Action/binary>>;
        URL ->
            URL
    end.

trim_trailing_slash(<<>>) ->
    <<>>;
trim_trailing_slash(Bin) ->
    Size = byte_size(Bin),
    case Bin of
        <<Prefix:(Size - 1)/binary, "/">> -> trim_trailing_slash(Prefix);
        _ -> Bin
    end.

form_body(Params) ->
    Pairs =
        [
            {binary_to_list(hb_util:bin(Key)), binary_to_list(form_value(Value))}
        ||
            {Key, Value} <- maps:to_list(Params),
            Value =/= undefined,
            Value =/= null,
            Value =/= not_found
        ],
    iolist_to_binary(uri_string:compose_query(Pairs)).

form_value(Value) when is_binary(Value) -> Value;
form_value(Value) when is_integer(Value) -> integer_to_binary(Value);
form_value(Value) when is_float(Value) -> float_to_binary(Value);
form_value(true) -> <<"true">>;
form_value(false) -> <<"false">>;
form_value(Value) when is_map(Value); is_list(Value) -> hb_json:encode(Value);
form_value(Value) -> hb_util:bin(Value).

api_error(Decoded, Opts) ->
    case hb_maps:get(<<"error">>, Decoded, not_found, Opts) of
        not_found ->
            hb_maps:get(<<"data">>, Decoded, Decoded, Opts);
        Error ->
            Error
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
