%%% @doc Odysee auth-token secret provider for `~auth-hook@1.0'.
%%%
%%% This device adapts the existing HTTP-auth generator flow to Odysee's
%%% `auth_token' cookie. The token is used only as private entropy for
%%% HyperBEAM's hosted secret/wallet flow; it is removed from the normalized
%%% request before the auth hook signs or stores anything.
-module(dev_odysee_auth).
-implements(<<"odysee-auth@1.0">>).
-export([commit/3, verify/3]).
-export([generate/3, legacy_api_headers/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEFAULT_SALT, <<"constant:odysee-auth-token">>).
-define(TOKEN_KEYS, [
    <<"auth_token">>,
    <<"odysee-auth-token">>,
    <<"x-odysee-auth-token">>,
    <<"x-lbry-auth-token">>
]).

%% @doc Commit with an HMAC key derived from the Odysee auth token.
commit(Base, Req, Opts) ->
    case generate(Base, Req, Opts) of
        {ok, Key} when is_binary(Key) ->
            proxy_commit(Base, Req, Key, Opts);
        {ok, #{ <<"secret">> := Key }} ->
            proxy_commit(Base, Req, Key, Opts);
        {ok, NormalizedReq} ->
            case hb_maps:find(<<"secret">>, NormalizedReq, Opts) of
                {ok, Key} -> proxy_commit(Base, NormalizedReq, Key, Opts);
                error -> {error, <<"No Odysee auth secret generated.">>}
            end;
        {error, _} = Error ->
            Error
    end.

proxy_commit(Base, Req, Key, Opts) ->
    hb_ao:raw(
        <<"httpsig@1.0">>,
        <<"proxy-commit">>,
        Base,
        Req#{
            <<"commitment-device">> => <<"odysee-auth@1.0">>,
            <<"secret">> => Key
        },
        Opts
    ).

%% @doc Verify an HMAC commitment against the Odysee auth token.
verify(Base, Req, Opts) ->
    case generate(Base, Req, Opts) of
        {ok, Key} when is_binary(Key) ->
            proxy_verify(Base, Req, Key, Opts);
        {ok, #{ <<"secret">> := Key }} ->
            proxy_verify(Base, Req, Key, Opts);
        {ok, NormalizedReq} ->
            case hb_maps:find(<<"secret">>, NormalizedReq, Opts) of
                {ok, Key} -> proxy_verify(Base, NormalizedReq, Key, Opts);
                error -> {error, <<"No Odysee auth secret generated.">>}
            end;
        {error, _} = Error ->
            Error
    end.

proxy_verify(Base, Req, Key, Opts) ->
    hb_ao:raw(
        <<"httpsig@1.0">>,
        <<"proxy-verify">>,
        Base,
        Req#{ <<"secret">> => Key },
        Opts
    ).

%% @doc Generate a deterministic secret from an Odysee auth token.
generate(_Msg, ReqLink, Opts) when ?IS_LINK(ReqLink) ->
    generate(_Msg, hb_cache:ensure_loaded(ReqLink, Opts), Opts);
generate(_Msg, #{ <<"secret">> := Secret }, _Opts) ->
    {ok, Secret};
generate(_Msg, Req, Opts) ->
    case find_token(Req, Opts) of
        {ok, Token} ->
            case hb_maps:get(<<"raw">>, Req, false, Opts) of
                true -> {ok, Token};
                false ->
                    case derive_key(Token, Req, Opts) of
                        {ok, Secret} ->
                            {ok, strip_token_fields(Req#{ <<"secret">> => Secret }, Opts)};
                        {error, _} = Error ->
                            Error
                    end
            end;
        {error, not_found} ->
            {error,
                #{
                    <<"status">> => 401,
                    <<"www-authenticate">> => <<"OdyseeAuthToken">>,
                    <<"details">> =>
                        <<"No Odysee auth_token cookie or token header provided.">>
                }
            }
    end.

%% @doc Return the sanitized legacy API auth carrier for Odysee API requests.
%% This intentionally forwards only the Odysee auth cookie shape expected by
%% the existing API; the token is not placed in request params or persisted.
legacy_api_headers(Base, Req, Opts) ->
    case find_token(Req, Opts) of
        {ok, Token} ->
            #{ <<"cookie">> => <<"auth_token=", Token/binary>> };
        {error, not_found} ->
            case find_token(Base, Opts) of
                {ok, Token} -> #{ <<"cookie">> => <<"auth_token=", Token/binary>> };
                {error, not_found} -> #{}
            end
    end.

find_token(Req, Opts) ->
    case find_token_header(Req, Opts) of
        {ok, Token} -> {ok, Token};
        {error, not_found} -> find_token_cookie(Req, Opts)
    end.

find_token_header(Req, Opts) ->
    find_first(?TOKEN_KEYS -- [<<"auth_token">>], Req, Opts).

find_token_cookie(Req, Opts) ->
    maybe
        {ok, Cookies} ?= extract_cookies(Req, Opts),
        {ok, Token} ?= hb_maps:find(<<"auth_token">>, Cookies, Opts),
        {ok, token_value(Token)}
    else
        _ -> {error, not_found}
    end.

find_first([], _Req, _Opts) ->
    {error, not_found};
find_first([Key | Rest], Req, Opts) ->
    case hb_maps:find(Key, Req, Opts) of
        {ok, Value} -> {ok, token_value(Value)};
        error -> find_first(Rest, Req, Opts)
    end.

token_value(#{ <<"value">> := Value }) ->
    Value;
token_value(Value) ->
    Value.

derive_key(Token, Req, Opts) ->
    Alg = hb_util:atom(hb_maps:get(<<"alg">>, Req, <<"sha256">>, Opts)),
    Salt =
        hb_maps:get(
            <<"salt">>,
            Req,
            hb_crypto:sha256(?DEFAULT_SALT),
            Opts
        ),
    Iterations = int_option(<<"iterations">>, 2 * 600_000, Req, Opts),
    KeyLength = int_option(<<"key-length">>, 64, Req, Opts),
    case hb_crypto:pbkdf2(Alg, Token, Salt, Iterations, KeyLength) of
        {ok, Key} -> {ok, hb_util:encode(Key)};
        {error, _Err} ->
            {error,
                #{
                    <<"status">> => 500,
                    <<"details">> => <<"Failed to derive Odysee auth key.">>
                }
            }
    end.

int_option(Key, Default, Req, Opts) ->
    case hb_maps:get(Key, Req, Default, Opts) of
        Value when is_integer(Value) ->
            Value;
        Value when is_binary(Value) ->
            try binary_to_integer(Value) of
                Parsed -> Parsed
            catch
                _:_ -> Default
            end;
        Value when is_list(Value) ->
            try list_to_integer(Value) of
                Parsed -> Parsed
            catch
                _:_ -> Default
            end;
        _ ->
            Default
    end.

strip_token_fields(Req, Opts) ->
    WithoutHeaders = hb_maps:without(?TOKEN_KEYS, Req, Opts),
    case extract_cookies(WithoutHeaders, Opts) of
        {ok, Cookies} ->
            SanitizedCookies = maps:without([<<"auth_token">>], Cookies),
            {ok, Reset} = reset_cookies(WithoutHeaders, Opts),
            case map_size(SanitizedCookies) of
                0 -> Reset;
                _ ->
                    {ok, Stored} = store_cookies(Reset, SanitizedCookies, Opts),
                    Stored
            end;
        _ ->
            WithoutHeaders
    end.

extract_cookies(Msg, Opts) ->
    hb_ao:raw(<<"cookie@1.0">>, <<"extract">>, Msg, #{}, Opts).

reset_cookies(Msg, Opts) ->
    hb_ao:raw(<<"cookie@1.0">>, <<"reset">>, Msg, #{}, Opts).

store_cookies(Msg, Cookies, Opts) ->
    hb_ao:raw(<<"cookie@1.0">>, <<"store">>, Msg, Cookies, Opts).

%%% Tests

generate_from_cookie_strips_token_test() ->
    Token = <<"odysee-test-token">>,
    Req = #{ <<"cookie">> => <<"auth_token=", Token/binary, "; other=kept">> },
    {ok, Normalized} =
        generate(
            #{},
            Req#{
                <<"iterations">> => 1,
                <<"key-length">> => 32
            },
            #{}
        ),
    ?assertMatch(#{ <<"secret">> := _ }, Normalized),
    ?assertEqual(error, hb_maps:find(<<"auth_token">>, Normalized, #{})),
    {ok, Cookies} = extract_cookies(Normalized, #{}),
    ?assertEqual(error, hb_maps:find(<<"auth_token">>, Cookies, #{})),
    ?assertEqual({ok, <<"kept">>}, hb_maps:find(<<"other">>, Cookies, #{})).

generate_from_header_strips_token_test() ->
    Token = <<"odysee-test-token">>,
    {ok, Normalized} =
        generate(
            #{},
            #{
                <<"x-odysee-auth-token">> => Token,
                <<"iterations">> => 1,
                <<"key-length">> => 32
            },
            #{}
        ),
    ?assertMatch(#{ <<"secret">> := _ }, Normalized),
    ?assertEqual(error, hb_maps:find(<<"x-odysee-auth-token">>, Normalized, #{})).

missing_token_challenges_test() ->
    ?assertMatch(
        {error, #{ <<"status">> := 401, <<"www-authenticate">> := _ }},
        generate(#{}, #{}, #{})
    ).

same_token_same_secret_test() ->
    Req =
        #{
            <<"x-odysee-auth-token">> => <<"same-token">>,
            <<"iterations">> => 1,
            <<"key-length">> => 32
        },
    {ok, #{ <<"secret">> := Secret1 }} = generate(#{}, Req, #{}),
    {ok, #{ <<"secret">> := Secret2 }} = generate(#{}, Req, #{}),
    ?assertEqual(Secret1, Secret2).

priv_cookie_matches_raw_cookie_secret_test() ->
    Token = <<"odysee-test-token">>,
    Req =
        #{
            <<"iterations">> => 1,
            <<"key-length">> => 32
        },
    {ok, #{ <<"secret">> := RawSecret }} =
        generate(#{}, Req#{ <<"cookie">> => <<"auth_token=", Token/binary >> }, #{}),
    PrivCookieReq =
        hb_private:set(
            Req,
            <<"cookie">>,
            #{ <<"auth_token">> => Token },
            #{}
        ),
    {ok, #{ <<"secret">> := PrivSecret }} = generate(#{}, PrivCookieReq, #{}),
    ?assertEqual(RawSecret, PrivSecret).
