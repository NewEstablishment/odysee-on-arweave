%%% @doc Odysee auth-token secret provider for `~auth-hook@1.0'.
%%%
%%% This device adapts the existing HTTP-auth generator flow to Odysee's
%%% `auth_token' cookie. The token is used only as private entropy for
%%% HyperBEAM's hosted secret/wallet flow; it is removed from the normalized
%%% request before the auth hook signs or stores anything.
%%%
%%% Odysee mints many session tokens per account (one per installation/login),
%%% all resolving to a single account. The node-hosted wallet is the
%%% per-ACCOUNT identity that owns a user's mutable state, so when an account
%%% source is configured the secret is derived from the account a session
%%% belongs to, not from the session token itself. Two sources are supported:
%%% the `odysee-session-accounts' node option (a `token => account-id' map,
%%% an offline stand-in for `user/me'), and the `odysee-account-api' node
%%% option (an Odysee internal-apis base URL; the token is resolved with a
%%% real `user/me' call and the account is the returned user id). When either
%%% source is configured, a token neither can vouch for is rejected (401; an
%%% unreachable API is 502, never a silent fallback). When no source is
%%% configured every session resolves to itself, preserving per-session
%%% wallets. The PBKDF2 input is domain-separated (`odysee-account:' vs
%%% `odysee-token:' prefixes) so an account identifier and a raw token can
%%% never collide in the derived keyspace.
-module(dev_odysee_auth).
-implements(<<"odysee-auth@1.0">>).
-export([commit/3, verify/3]).
-export([generate/3, legacy_api_headers/3]).
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
generate(_Msg, ReqLink, Opts) when is_tuple(ReqLink) andalso element(1, ReqLink) == link ->
    generate(_Msg, hb_cache:ensure_loaded(ReqLink, Opts), Opts);
generate(_Msg, #{ <<"secret">> := Secret }, _Opts) ->
    {ok, Secret};
generate(_Msg, Req, Opts) ->
    case find_token(Req, Opts) of
        {ok, Token} ->
            case hb_maps:get(<<"raw">>, Req, false, Opts) of
                true -> {ok, Token};
                false ->
                    case derive_secret(Token, Req, Opts) of
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

%% @doc Resolve the session token to its owning identity, then derive the
%% secret from that identity so every session of an account shares one wallet.
derive_secret(Token, Req, Opts) ->
    case resolve_account(Token, Opts) of
        {ok, {account, Account}} ->
            derive_key(account, Account, Req, Opts);
        {ok, {token, SelfToken}} ->
            derive_key(token, SelfToken, Req, Opts);
        {error, unknown} ->
            {error,
                #{
                    <<"status">> => 401,
                    <<"details">> => <<"Unknown Odysee session token.">>
                }
            };
        {error, unavailable} ->
            {error,
                #{
                    <<"status">> => 502,
                    <<"details">> =>
                        <<"The Odysee account API could not be reached "
                            "to validate the session token.">>
                }
            }
    end.

%% @doc Resolve a session token to the account that owns it. Sources, in order:
%% 1. The node's `odysee-session-accounts' option: a `token => account-id' map
%%    (an offline stand-in for the Odysee `user/me' lookup).
%% 2. On a map miss, the node's `odysee-account-api' option: the base URL of an
%%    Odysee internal-apis deployment. The token is resolved with a real
%%    `user/me' call; the account identity is the user id from the response.
%% 3. With neither source able to vouch for the token: rejected
%%    (`{error, unknown}') if either source is configured, else the token
%%    resolves to itself, preserving per-session behaviour on unconfigured
%%    nodes.
resolve_account(Token, Opts) ->
    Accounts = hb_opts:get(<<"odysee-session-accounts">>, #{}, Opts),
    case hb_maps:find(Token, Accounts, Opts) of
        {ok, Account} ->
            {ok, {account, hb_util:bin(Account)}};
        error ->
            case hb_opts:get(<<"odysee-account-api">>, not_configured, Opts) of
                not_configured ->
                    case hb_maps:size(Accounts, Opts) of
                        0 -> {ok, {token, Token}};
                        _ -> {error, unknown}
                    end;
                Endpoint ->
                    resolve_account_via_api(Endpoint, Token, Opts)
            end
    end.

%% @doc Resolve a token to its account with a `user/me' call against an Odysee
%% internal-apis deployment. Shapes mirror the odysee-frontend `Lbryio.call'
%% client: a form-encoded POST carrying the token as `auth_token', answered
%% with a `{"success": bool, "error": ..., "data": ...}' envelope where a
%% successful `data.id' identifies the account. A 4xx response is
%% `{error, unknown}'; a transport failure or 5xx is `{error, unavailable}' so
%% an API outage cannot be mistaken for a bad credential.
resolve_account_via_api(Endpoint, Token, Opts) ->
    Base = string:trim(hb_util:bin(Endpoint), trailing, "/"),
    Query = hb_util:bin(uri_string:compose_query([{<<"auth_token">>, Token}])),
    Request = #{
        <<"method">> => <<"POST">>,
        <<"path">> => <<Base/binary, "/user/me">>,
        <<"content-type">> => <<"application/x-www-form-urlencoded">>,
        <<"body">> => Query
    },
    case hb_http:request(Request, Opts) of
        {ok, Response} ->
            parse_user_me(Response, Opts);
        {error, Rejection} when is_map(Rejection) ->
            {error, unknown};
        _Failure ->
            {error, unavailable}
    end.

%% @doc Extract the account identity from a `user/me' response envelope. A body
%% that is not the expected envelope is treated as an unavailable API rather
%% than a rejected credential.
parse_user_me(Response, Opts) ->
    Body = hb_maps:get(<<"body">>, Response, <<>>, Opts),
    try hb_json:decode(Body) of
        #{ <<"success">> := true, <<"data">> := #{ <<"id">> := Id } } ->
            {ok, {account, hb_util:bin(Id)}};
        #{ <<"success">> := false } ->
            {error, unknown};
        _Other ->
            {error, unavailable}
    catch _:_ ->
        {error, unavailable}
    end.

%% @doc The PBKDF2 password prefix that separates the account-identifier space
%% from the raw-token space, so the two can never collide in the derived
%% keyspace.
domain_tag(account) -> <<"odysee-account:">>;
domain_tag(token) -> <<"odysee-token:">>.

derive_key(Domain, Identity, Req, Opts) ->
    Password = <<(domain_tag(Domain))/binary, (hb_util:bin(Identity))/binary>>,
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
    case hb_crypto:pbkdf2(Alg, Password, Salt, Iterations, KeyLength) of
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

mapped_sessions_share_account_secret_test() ->
    Opts = #{
        <<"odysee-session-accounts">> => #{
            <<"phone-token">> => <<"account-1">>,
            <<"laptop-token">> => <<"account-1">>,
            <<"other-token">> => <<"account-2">>
        }
    },
    Req = #{ <<"iterations">> => 1, <<"key-length">> => 32 },
    {ok, #{ <<"secret">> := Phone }} =
        generate(#{}, Req#{ <<"x-odysee-auth-token">> => <<"phone-token">> }, Opts),
    {ok, #{ <<"secret">> := Laptop }} =
        generate(#{}, Req#{ <<"x-odysee-auth-token">> => <<"laptop-token">> }, Opts),
    {ok, #{ <<"secret">> := Other }} =
        generate(#{}, Req#{ <<"x-odysee-auth-token">> => <<"other-token">> }, Opts),
    ?assertEqual(Phone, Laptop),
    ?assertNotEqual(Phone, Other).

configured_map_rejects_unknown_token_test() ->
    Opts = #{ <<"odysee-session-accounts">> => #{ <<"known">> => <<"account-1">> } },
    Req = #{
        <<"x-odysee-auth-token">> => <<"unknown-token">>,
        <<"iterations">> => 1,
        <<"key-length">> => 32
    },
    ?assertMatch({error, #{ <<"status">> := 401 }}, generate(#{}, Req, Opts)).

account_and_token_domains_do_not_collide_test() ->
    Req = #{ <<"iterations">> => 1, <<"key-length">> => 32 },
    MappedOpts = #{ <<"odysee-session-accounts">> => #{ <<"tok">> => <<"identity">> } },
    {ok, #{ <<"secret">> := AccountSecret }} =
        generate(#{}, Req#{ <<"x-odysee-auth-token">> => <<"tok">> }, MappedOpts),
    {ok, #{ <<"secret">> := TokenSecret }} =
        generate(#{}, Req#{ <<"x-odysee-auth-token">> => <<"identity">> }, #{}),
    ?assertNotEqual(AccountSecret, TokenSecret).

parse_user_me_envelope_test() ->
    ?assertEqual(
        {ok, {account, <<"12345">>}},
        parse_user_me(
            #{ <<"body">> => <<"{\"success\":true,\"data\":{\"id\":12345}}">> },
            #{}
        )
    ),
    ?assertEqual(
        {error, unknown},
        parse_user_me(
            #{ <<"body">> => <<"{\"success\":false,\"error\":\"bad token\"}">> },
            #{}
        )
    ),
    ?assertEqual(
        {error, unavailable},
        parse_user_me(#{ <<"body">> => <<"<html>">> }, #{})
    ).
