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
%%% real `user/me' call and the account is the returned user id). A token that
%%% no configured source can vouch for is rejected (401; an unreachable API is
%%% 502, never a silent fallback). Development nodes may explicitly enable
%%% `odysee-auth-allow-unvalidated-tokens'; production nodes fail closed by
%%% default. PBKDF2 policy is node-owned and the input is domain-separated
%%% (`odysee-account:' vs `odysee-token:' prefixes), so request fields cannot
%%% rotate an account's identity or choose the work factor.
-module(dev_odysee_auth).
-implements(<<"odysee-auth@1.0">>).
-export([commit/3, verify/3]).
-export([generate/3, legacy_api_headers/3]).
-include_lib("eunit/include/eunit.hrl").

-define(DEFAULT_SALT, <<"constant:odysee-auth-token">>).
-define(MAX_TOKEN_BYTES, 4096).
-define(TOKEN_KEYS, [
    <<"auth_token">>,
    <<"odysee-auth-token">>,
    <<"x-odysee-auth-token">>,
    <<"x-lbry-auth-token">>
]).
-define(REQUEST_AUTH_CONTROL_KEYS, [
    <<"secret">>,
    <<"raw">>,
    <<"alg">>,
    <<"salt">>,
    <<"iterations">>,
    <<"key-length">>,
    <<"ignored-keys">>
]).

%% @doc Commit with an HMAC key derived from the Odysee auth token.
commit(Base, Req, Opts) ->
    case hosted_wallet_secret(Base, Req, Opts) of
        {ok, Key} ->
            proxy_commit(Base, strip_auth_request_fields(Req, Opts), Key, Opts);
        error ->
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
            end
    end.

%% `~secret@1.0' registers and later unlocks a hosted wallet through an
%% access-control message whose base carries the generated wallet address and
%% whose request carries the provider-derived secret. That is the only trusted
%% direct-secret shape. Normal generator requests never have a wallet address,
%% so a public `secret' field cannot select or rotate the auth-hook identity.
hosted_wallet_secret(Base, Req, Opts) ->
    case {
        hb_maps:find(<<"wallet-address">>, Base, Opts),
        hb_maps:find(<<"secret">>, Req, Opts)
    } of
        {{ok, Address}, {ok, Secret}}
                when is_binary(Address), byte_size(Address) > 0,
                     is_binary(Secret), byte_size(Secret) > 0,
                     byte_size(Secret) =< ?MAX_TOKEN_BYTES ->
            {ok, Secret};
        _ ->
            error
    end.

%% `~httpsig@1.0''s proxy paths take the target message from the request's
%% `message' key and disregard the resolution base, so the base must be
%% carried explicitly (as `~cookie@1.0' and `~http-auth@1.0' do). Passing it
%% as the resolution base commits whatever the `message' default resolves
%% to instead of the access-control message.
proxy_commit(Base, Req, Key, Opts) ->
    hb_ao:resolve(
        #{ <<"device">> => <<"httpsig@1.0">> },
        Req#{
            <<"path">> => <<"proxy-commit">>,
            <<"commitment-device">> => <<"odysee-auth@1.0">>,
            <<"secret">> => Key,
            <<"message">> => Base
        },
        Opts
    ).

%% @doc Verify an HMAC commitment against the Odysee auth token. A request
%% that carries no token cannot check the commitment, and callers such as
%% `dev_message:verify' expect a boolean rather than a challenge, so the
%% missing-credential case reports the commitment as unverified instead of
%% surfacing `generate''s 401. Upstream faults (an unreachable account API)
%% stay errors: an outage must not read as an invalid commitment.
verify(Base, Req, Opts) ->
    case hosted_wallet_secret(Base, Req, Opts) of
        {ok, Key} ->
            proxy_verify(Base, strip_auth_request_fields(Req, Opts), Key, Opts);
        error ->
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
                {error, #{ <<"www-authenticate">> := _ }} ->
                    {ok, false};
                {error, _} = Error ->
                    Error
            end
    end.

proxy_verify(Base, Req, Key, Opts) ->
    hb_ao:resolve(
        #{ <<"device">> => <<"httpsig@1.0">> },
        Req#{
            <<"path">> => <<"proxy-verify">>,
            <<"secret">> => Key,
            <<"message">> => Base
        },
        Opts
    ).

%% @doc Generate a deterministic secret from an Odysee auth token.
generate(_Msg, ReqLink, Opts) when is_tuple(ReqLink) andalso element(1, ReqLink) == link ->
    generate(_Msg, hb_cache:ensure_loaded(ReqLink, Opts), Opts);
generate(_Msg, Req, Opts) ->
    case find_token(Req, Opts) of
        {ok, Token} ->
            case derive_secret(Token, Opts) of
                {ok, Secret} ->
                    Sanitized = strip_auth_request_fields(Req, Opts),
                    {ok,
                        stash_token(
                            Sanitized#{ <<"secret">> => Secret },
                            Token,
                            Opts
                        )
                    };
                {error, _} = Error ->
                    Error
            end;
        {error, Reason} when Reason =:= not_found; Reason =:= invalid ->
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
        {error, _} ->
            case find_token(Base, Opts) of
                {ok, Token} -> #{ <<"cookie">> => <<"auth_token=", Token/binary>> };
                {error, _} -> #{}
            end
    end.

%% The token is needed again after `strip_token_fields' has removed it from
%% the public request: the auth hook strips the derived `secret' before the
%% hosted-secret flow re-verifies a stored wallet's access-control message,
%% so `verify' must be able to re-derive the key from the same request.
%% Private state is never committed, serialized, or persisted, making it the
%% one carrier that reaches `verify' without the token leaking into signed
%% or stored messages.
stash_token(Req, Token, Opts) ->
    hb_private:set(Req, <<"odysee-auth-token">>, Token, Opts).

find_token(Req, Opts) ->
    case hb_private:get(<<"odysee-auth-token">>, Req, undefined, Opts) of
        undefined ->
            case find_token_header(Req, Opts) of
                {ok, Token} -> {ok, Token};
                {error, not_found} -> find_token_cookie(Req, Opts);
                {error, invalid} -> {error, invalid}
            end;
        Token ->
            normalize_token(Token)
    end.

find_token_header(Req, Opts) ->
    find_first(?TOKEN_KEYS -- [<<"auth_token">>], Req, Opts).

find_token_cookie(Req, Opts) ->
    maybe
        {ok, Cookies} ?= extract_cookies(Req, Opts),
        {ok, Token} ?= hb_maps:find(<<"auth_token">>, Cookies, Opts),
        {ok, Normalized} ?= normalize_token(Token),
        {ok, Normalized}
    else
        {error, invalid} -> {error, invalid};
        _ -> {error, not_found}
    end.

find_first([], _Req, _Opts) ->
    {error, not_found};
find_first([Key | Rest], Req, Opts) ->
    case hb_maps:find(Key, Req, Opts) of
        {ok, Value} -> normalize_token(Value);
        error -> find_first(Rest, Req, Opts)
    end.

token_value(#{ <<"value">> := Value }) ->
    Value;
token_value(Value) ->
    Value.

normalize_token(Value0) ->
    Value = token_value(Value0),
    case is_binary(Value) andalso byte_size(Value) > 0 andalso
        byte_size(Value) =< ?MAX_TOKEN_BYTES
    of
        true -> {ok, Value};
        false -> {error, invalid}
    end.

%% @doc Resolve the session token to its owning identity, then derive the
%% secret from that identity so every session of an account shares one wallet.
derive_secret(Token, Opts) ->
    case resolve_account(Token, Opts) of
        {ok, {account, Account}} ->
            derive_key(account, Account, Opts);
        {ok, {token, SelfToken}} ->
            derive_key(token, SelfToken, Opts);
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
%%    (`{error, unknown}'). An unconfigured node also rejects the token unless
%%    the operator explicitly enables development-only unvalidated identities.
resolve_account(Token, Opts) ->
    Accounts = hb_opts:get(<<"odysee-session-accounts">>, #{}, Opts),
    case hb_maps:find(Token, Accounts, Opts) of
        {ok, Account} ->
            {ok, {account, hb_util:bin(Account)}};
        error ->
            case hb_opts:get(<<"odysee-account-api">>, not_configured, Opts) of
                not_configured ->
                    case hb_maps:size(Accounts, Opts) of
                        0 ->
                            case allow_unvalidated_tokens(Opts) of
                                true -> {ok, {token, Token}};
                                false -> {error, unknown}
                            end;
                        _ -> {error, unknown}
                    end;
                Endpoint ->
                    resolve_account_via_api(Endpoint, Token, Opts)
            end
    end.

allow_unvalidated_tokens(Opts) ->
    case hb_opts:get(<<"odysee-auth-allow-unvalidated-tokens">>, false, Opts) of
        true -> true;
        <<"true">> -> true;
        _ -> false
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

derive_key(Domain, Identity, Opts) ->
    Password = <<(domain_tag(Domain))/binary, (hb_util:bin(Identity))/binary>>,
    case derivation_config(Opts) of
        {ok, {Alg, Salt, Iterations, KeyLength}} ->
            case hb_crypto:pbkdf2(Alg, Password, Salt, Iterations, KeyLength) of
                {ok, Key} -> {ok, hb_util:encode(Key)};
                {error, _Err} ->
                    derivation_error(<<"Failed to derive Odysee auth key.">>)
            end;
        {error, _} ->
            derivation_error(<<"Invalid Odysee auth derivation configuration.">>)
    end.

derivation_config(Opts) ->
    maybe
        {ok, Alg} ?= pbkdf2_alg(hb_opts:get(<<"odysee-auth-pbkdf2-alg">>, sha256, Opts)),
        Salt = hb_opts:get(
            <<"odysee-auth-pbkdf2-salt">>,
            hb_crypto:sha256(?DEFAULT_SALT),
            Opts
        ),
        true ?= is_binary(Salt) andalso byte_size(Salt) >= 16 andalso byte_size(Salt) =< 1024,
        {ok, Iterations} ?=
            trusted_int_option(
                <<"odysee-auth-pbkdf2-iterations">>,
                2 * 600_000,
                1,
                2 * 600_000,
                Opts
            ),
        {ok, KeyLength} ?=
            trusted_int_option(<<"odysee-auth-pbkdf2-key-length">>, 64, 16, 128, Opts),
        {ok, {Alg, Salt, Iterations, KeyLength}}
    else
        _ -> {error, invalid_derivation_config}
    end.

pbkdf2_alg(sha256) -> {ok, sha256};
pbkdf2_alg(sha384) -> {ok, sha384};
pbkdf2_alg(sha512) -> {ok, sha512};
pbkdf2_alg(<<"sha256">>) -> {ok, sha256};
pbkdf2_alg(<<"sha384">>) -> {ok, sha384};
pbkdf2_alg(<<"sha512">>) -> {ok, sha512};
pbkdf2_alg(_) -> {error, invalid_alg}.

trusted_int_option(Key, Default, Min, Max, Opts) ->
    case parse_integer(hb_opts:get(Key, Default, Opts)) of
        {ok, Value} when Value >= Min, Value =< Max -> {ok, Value};
        _ -> {error, invalid_integer_option}
    end.

parse_integer(Value) when is_integer(Value) -> {ok, Value};
parse_integer(Value) when is_binary(Value) ->
    try binary_to_integer(Value) of
        Parsed -> {ok, Parsed}
    catch
        _:_ -> {error, invalid_integer}
    end;
parse_integer(Value) when is_list(Value) ->
    try list_to_integer(Value) of
        Parsed -> {ok, Parsed}
    catch
        _:_ -> {error, invalid_integer}
    end;
parse_integer(_) -> {error, invalid_integer}.

derivation_error(Details) ->
    {error,
        #{
            <<"status">> => 500,
            <<"details">> => Details
        }
    }.

strip_auth_request_fields(Req, Opts) ->
    hb_maps:without(
        ?REQUEST_AUTH_CONTROL_KEYS,
        strip_token_fields(Req, Opts),
        Opts
    ).

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

test_opts() ->
    test_opts(#{}).

test_opts(Extra) ->
    maps:merge(
        #{
            <<"odysee-auth-allow-unvalidated-tokens">> => true,
            <<"odysee-auth-pbkdf2-iterations">> => 1,
            <<"odysee-auth-pbkdf2-key-length">> => 32
        },
        Extra
    ).

generate_from_cookie_strips_token_test() ->
    Token = <<"odysee-test-token">>,
    Req = #{ <<"cookie">> => <<"auth_token=", Token/binary, "; other=kept">> },
    {ok, Normalized} =
        generate(
            #{},
            Req,
            test_opts()
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
                <<"x-odysee-auth-token">> => Token
            },
            test_opts()
        ),
    ?assertMatch(#{ <<"secret">> := _ }, Normalized),
    ?assertEqual(error, hb_maps:find(<<"x-odysee-auth-token">>, Normalized, #{})).

missing_token_challenges_test() ->
    ?assertMatch(
        {error, #{ <<"status">> := 401, <<"www-authenticate">> := _ }},
        generate(#{}, #{}, #{})
    ).

same_token_same_secret_test() ->
    Req = #{ <<"x-odysee-auth-token">> => <<"same-token">> },
    Opts = test_opts(),
    {ok, #{ <<"secret">> := Secret1 }} = generate(#{}, Req, Opts),
    {ok, #{ <<"secret">> := Secret2 }} = generate(#{}, Req, Opts),
    ?assertEqual(Secret1, Secret2).

priv_cookie_matches_raw_cookie_secret_test() ->
    Token = <<"odysee-test-token">>,
    Req = #{},
    Opts = test_opts(),
    {ok, #{ <<"secret">> := RawSecret }} =
        generate(#{}, Req#{ <<"cookie">> => <<"auth_token=", Token/binary >> }, Opts),
    PrivCookieReq =
        hb_private:set(
            Req,
            <<"cookie">>,
            #{ <<"auth_token">> => Token },
            Opts
        ),
    {ok, #{ <<"secret">> := PrivSecret }} = generate(#{}, PrivCookieReq, Opts),
    ?assertEqual(RawSecret, PrivSecret).

mapped_sessions_share_account_secret_test() ->
    Opts = test_opts(#{
        <<"odysee-session-accounts">> => #{
            <<"phone-token">> => <<"account-1">>,
            <<"laptop-token">> => <<"account-1">>,
            <<"other-token">> => <<"account-2">>
        }
    }),
    Req = #{},
    {ok, #{ <<"secret">> := Phone }} =
        generate(#{}, Req#{ <<"x-odysee-auth-token">> => <<"phone-token">> }, Opts),
    {ok, #{ <<"secret">> := Laptop }} =
        generate(#{}, Req#{ <<"x-odysee-auth-token">> => <<"laptop-token">> }, Opts),
    {ok, #{ <<"secret">> := Other }} =
        generate(#{}, Req#{ <<"x-odysee-auth-token">> => <<"other-token">> }, Opts),
    ?assertEqual(Phone, Laptop),
    ?assertNotEqual(Phone, Other).

configured_map_rejects_unknown_token_test() ->
    Opts = test_opts(#{
        <<"odysee-session-accounts">> => #{ <<"known">> => <<"account-1">> }
    }),
    Req = #{
        <<"x-odysee-auth-token">> => <<"unknown-token">>
    },
    ?assertMatch({error, #{ <<"status">> := 401 }}, generate(#{}, Req, Opts)).

account_and_token_domains_do_not_collide_test() ->
    Req = #{},
    MappedOpts = test_opts(#{
        <<"odysee-session-accounts">> => #{ <<"tok">> => <<"identity">> }
    }),
    {ok, #{ <<"secret">> := AccountSecret }} =
        generate(#{}, Req#{ <<"x-odysee-auth-token">> => <<"tok">> }, MappedOpts),
    {ok, #{ <<"secret">> := TokenSecret }} =
        generate(#{}, Req#{ <<"x-odysee-auth-token">> => <<"identity">> }, test_opts()),
    ?assertNotEqual(AccountSecret, TokenSecret).

unconfigured_node_rejects_unvalidated_token_test() ->
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        generate(
            #{},
            #{ <<"x-odysee-auth-token">> => <<"unvalidated-token">> },
            #{
                <<"odysee-auth-pbkdf2-iterations">> => 1,
                <<"odysee-auth-pbkdf2-key-length">> => 32
            }
        )
    ).

request_cannot_override_secret_or_derivation_policy_test() ->
    Token = <<"policy-token">>,
    Opts = test_opts(),
    Req = #{ <<"x-odysee-auth-token">> => Token },
    {ok, #{ <<"secret">> := Expected }} = generate(#{}, Req, Opts),
    {ok, Normalized = #{ <<"secret">> := Actual }} =
        generate(
            #{},
            Req#{
                <<"secret">> => <<"attacker-controlled">>,
                <<"raw">> => true,
                <<"alg">> => <<"sha512">>,
                <<"salt">> => binary:copy(<<"x">>, 32),
                <<"iterations">> => 2_000_000,
                <<"key-length">> => 128,
                <<"ignored-keys">> => [<<"body">>]
            },
            Opts
        ),
    ?assertEqual(Expected, Actual),
    ?assertNotEqual(Token, Actual),
    lists:foreach(
        fun(Key) -> ?assertEqual(error, hb_maps:find(Key, Normalized, Opts)) end,
        ?REQUEST_AUTH_CONTROL_KEYS -- [<<"secret">>]
    ).

invalid_token_shape_is_rejected_test() ->
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        generate(#{}, #{ <<"x-odysee-auth-token">> => <<>> }, test_opts())
    ),
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        generate(
            #{},
            #{ <<"x-odysee-auth-token">> => binary:copy(<<"x">>, ?MAX_TOKEN_BYTES + 1) },
            test_opts()
        )
    ).

invalid_trusted_derivation_config_fails_closed_test() ->
    ?assertMatch(
        {error, #{ <<"status">> := 500 }},
        generate(
            #{},
            #{ <<"x-odysee-auth-token">> => <<"token">> },
            test_opts(#{ <<"odysee-auth-pbkdf2-iterations">> => 2_000_001 })
        )
    ).

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
