-module(dev_odysee_legacy_auth).
-implements(<<"odysee-legacy-auth@1.0">>).
-export([info/1, generate/3, commit/3, verify/3, identify/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-legacy-auth@1.0">>).

info(_Opts) ->
    #{ exports => [<<"generate">>, <<"commit">>, <<"verify">>, <<"identify">>] }.

generate(Base, ReqLink, Opts) when ?IS_LINK(ReqLink) ->
    generate(Base, hb_cache:ensure_loaded(ReqLink, Opts), Opts);
generate(_Base, Req = #{ <<"secret">> := Secret }, Opts) ->
    {ok, (sanitize(Req, Opts))#{ <<"secret">> => Secret }};
generate(Base, Req, Opts) ->
    case authenticated_identity(Base, Req, Opts) of
        {ok, Identity} ->
            case identity_secret(Identity, Base, Req, Opts) of
                {ok, Secret} ->
                    Sanitized = sanitize(Req, Opts),
                    {ok, Proof} = identity_proof(Identity, Sanitized, Base, Req, Opts),
                    {ok, Sanitized#{
                        <<"secret">> => Secret,
                        <<"legacy-user-id">> => maps:get(<<"legacy-user-id">>, Identity),
                        <<"auth-source">> => maps:get(<<"auth-source">>, Identity),
                        <<"legacy-auth-path">> => hb_maps:get(<<"path">>, Req, <<>>, Opts),
                        <<"legacy-auth-proof">> => Proof
                    }};
                {error, Reason} ->
                    {error, Reason}
            end;
        {error, Reason} ->
            {error, Reason}
    end.

identify(Base, ReqLink, Opts) when ?IS_LINK(ReqLink) ->
    identify(Base, hb_cache:ensure_loaded(ReqLink, Opts), Opts);
identify(Base, Req, Opts) ->
    case authenticated_identity(Base, Req, Opts) of
        {ok, Identity} -> {ok, Identity};
        {error, Reason} -> {error, Reason}
    end.

commit(Base, ReqLink, Opts) when ?IS_LINK(ReqLink) ->
    commit(Base, hb_cache:ensure_loaded(ReqLink, Opts), Opts);
commit(Base, Req = #{ <<"secret">> := Secret }, Opts) ->
    commit_with_secret(Secret, Base, Req, Opts);
commit(Base, Req, Opts) ->
    case authenticated_secret(Base, Req, Opts) of
        {ok, Secret} -> commit_with_secret(Secret, Base, Req, Opts);
        {error, Reason} -> {error, Reason}
    end.

verify(Base, ReqLink, Opts) when ?IS_LINK(ReqLink) ->
    verify(Base, hb_cache:ensure_loaded(ReqLink, Opts), Opts);
verify(Base, Req = #{ <<"secret">> := Secret }, Opts) ->
    verify_with_secret(Secret, Base, Req, Opts);
verify(Base, Req, Opts) ->
    case authenticated_secret(Base, Req, Opts) of
        {ok, Secret} -> verify_with_secret(Secret, Base, Req, Opts);
        {error, Reason} -> {error, Reason}
    end.

authenticated_secret(Base, Req, Opts) ->
    case authenticated_identity(Base, Req, Opts) of
        {ok, Identity} -> identity_secret(Identity, Base, Req, Opts);
        {error, authentication_required} -> proof_secret(Base, Req, Opts);
        {error, Reason} -> {error, Reason}
    end.

authenticated_identity(Base, Req, Opts) ->
    case request_token(Base, Req, Opts) of
        {ok, Token, Source} ->
            case valid_token(Token) of
                true -> token_identity(Token, Source, Base, Req, Opts);
                false -> {error, invalid_auth_token}
            end;
        {error, Reason} ->
            {error, Reason}
    end.

request_token(Base, Req, Opts) ->
    case first_param(token_keys(), Base, Req, Opts) of
        not_found ->
            case cookie_token(Base, Req, Opts) of
                not_found -> {error, authentication_required};
                Token -> {ok, normalize_token(Token), <<"cookie">>}
            end;
        {Token, Key} ->
            {ok, normalize_token(Token), Key}
    end.

token_keys() ->
    [
        <<"auth_token">>,
        <<"auth-token">>,
        <<"x-odysee-demo-auth-token">>,
        <<"X-Odysee-Demo-Auth-Token">>,
        <<"x-lbry-auth-token">>,
        <<"X-Lbry-Auth-Token">>
    ].

cookie_token(Base, Req, Opts) ->
    case first_param([<<"cookie">>], Base, Req, Opts) of
        not_found -> not_found;
        {Cookie, _Key} -> cookie_value(Cookie, <<"auth_token">>, Opts)
    end.

cookie_value(Cookies, Name, Opts) when is_map(Cookies) ->
    case hb_maps:get(Name, Cookies, not_found, Opts) of
        not_found -> not_found;
        Value -> normalize_cookie_value(Value, Opts)
    end;
cookie_value(Cookies, Name, Opts) when is_list(Cookies) ->
    find_in_list(fun(Cookie) -> cookie_value(Cookie, Name, Opts) end, Cookies);
cookie_value(Cookie, Name, _Opts) when is_binary(Cookie) ->
    cookie_parts(binary:split(Cookie, <<";">>, [global]), Name);
cookie_value(_Cookie, _Name, _Opts) ->
    not_found.

normalize_cookie_value(#{ <<"value">> := Value }, _Opts) ->
    hb_util:bin(Value);
normalize_cookie_value(Value, _Opts) ->
    hb_util:bin(Value).

cookie_parts([], _Name) ->
    not_found;
cookie_parts([Part | Rest], Name) ->
    case binary:split(trim(Part), <<"=">>) of
        [Name, Value] -> strip_quotes(trim(Value));
        [_Other, _Value] -> cookie_parts(Rest, Name);
        _ -> cookie_parts(Rest, Name)
    end.

strip_quotes(<<"\"", Value/binary>>) ->
    Size = byte_size(Value),
    case Size > 0 of
        true ->
            case Value of
                <<Inner:(Size - 1)/binary, "\"">> -> Inner;
                _ -> Value
            end;
        false ->
            Value
    end;
strip_quotes(Value) ->
    Value.

normalize_token(Value) ->
    Token = strip_quotes(trim(hb_util:bin(Value))),
    case extracted_token(Token) of
        not_found -> Token;
        Extracted -> Extracted
    end.

extracted_token(Token) ->
    Patterns = [
        <<"(?i)(?:auth[_-]?token)\\s*=\\s*['\\\"]?([A-Za-z0-9_-]+)">>,
        <<"(?i)(?:x-lbry-auth-token)\\s*:\\s*['\\\"]?([A-Za-z0-9_-]+)">>,
        <<"(?i)(?:x-odysee-demo-auth-token)\\s*:\\s*['\\\"]?([A-Za-z0-9_-]+)">>,
        <<"(?i)bearer\\s+([A-Za-z0-9_-]+)">>
    ],
    find_in_list(fun(Pattern) -> captured_token(Pattern, Token) end, Patterns).

captured_token(Pattern, Token) ->
    case re:run(Token, Pattern, [{capture, [1], binary}]) of
        {match, [Captured]} -> Captured;
        nomatch -> not_found
    end.

trim(Bin) ->
    iolist_to_binary(string:trim(binary_to_list(Bin))).

valid_token(<<>>) ->
    false;
valid_token(Token) when is_binary(Token) ->
    lists:all(fun valid_token_char/1, binary:bin_to_list(Token));
valid_token(_Token) ->
    false.

valid_token_char(Char) when Char >= $0, Char =< $9 -> true;
valid_token_char(Char) when Char >= $A, Char =< $Z -> true;
valid_token_char(Char) when Char >= $a, Char =< $z -> true;
valid_token_char($-) -> true;
valid_token_char($_) -> true;
valid_token_char(_Char) -> false.

token_identity(Token, Source, Base, Req, Opts) ->
    case trusted_token_users(Base, Req, Opts) of
        not_found ->
            case verifier_url(Base, Req, Opts) of
                not_found ->
                    case demo_verifier_url(Source) of
                        not_found -> {error, legacy_auth_verifier_not_configured};
                        URL -> verifier_identity(URL, Token, Source, Base, Req, Opts)
                    end;
                URL -> verifier_identity(URL, Token, Source, Base, Req, Opts)
            end;
        TokenUsers ->
            case hb_maps:get(Token, TokenUsers, not_found, Opts) of
                not_found -> {error, legacy_auth_token_not_found};
                Value -> identity_from_value(Value, Source, Opts)
            end
    end.

demo_verifier_url(<<"x-odysee-demo-auth-token">>) ->
    <<"https://api.odysee.com/user/me">>;
demo_verifier_url(<<"X-Odysee-Demo-Auth-Token">>) ->
    <<"https://api.odysee.com/user/me">>;
demo_verifier_url(_Source) ->
    not_found.

trusted_token_users(Base, Req, Opts) ->
    first_config(
        [
            <<"trusted-token-users">>,
            <<"trusted_token_users">>,
            <<"legacy-token-users">>,
            <<"legacy_token_users">>,
            <<"odysee-legacy-token-users">>,
            <<"odysee_legacy_token_users">>
        ],
        Base,
        Req,
        Opts
    ).

verifier_url(Base, Req, Opts) ->
    first_config(
        [
            <<"legacy-auth-url">>,
            <<"legacy_auth_url">>,
            <<"odysee-legacy-auth-url">>,
            <<"odysee_legacy_auth_url">>
        ],
        Base,
        Req,
        Opts
    ).

verifier_token_mode(Base, Req, Opts) ->
    case first_config(
        [
            <<"legacy-auth-token-mode">>,
            <<"legacy_auth_token_mode">>,
            <<"legacy-auth-verifier-token-mode">>,
            <<"legacy_auth_verifier_token_mode">>,
            <<"odysee-legacy-auth-token-mode">>,
            <<"odysee_legacy_auth_token_mode">>
        ],
        Base,
        Req,
        Opts
    ) of
        not_found -> <<"form">>;
        Mode -> hb_util:to_lower(hb_util:bin(Mode))
    end.

verifier_identity(URL, Token, Source, Base, Req, Opts) ->
    Msg = verifier_request(URL, Token, verifier_token_mode(Base, Req, Opts)),
    case hb_http:request(Msg, Opts) of
        {ok, #{ <<"body">> := Body }} when is_binary(Body) ->
            decoded_identity(Body, Source, Opts);
        {ok, Body} when is_binary(Body) ->
            decoded_identity(Body, Source, Opts);
        {ok, Other} ->
            {error, {legacy_auth_response_without_body, Other}};
        Error ->
            Error
    end.

verifier_request(URL, Token, <<"query">>) ->
    #{
        <<"method">> => <<"GET">>,
        <<"path">> => append_auth_token(URL, Token),
        <<"accept">> => <<"application/json">>
    };
verifier_request(URL, Token, <<"form">>) ->
    #{
        <<"method">> => <<"POST">>,
        <<"path">> => URL,
        <<"accept">> => <<"application/json">>,
        <<"content-type">> => <<"application/x-www-form-urlencoded">>,
        <<"body">> => <<"auth_token=", Token/binary>>
    };
verifier_request(URL, Token, <<"bearer">>) ->
    #{
        <<"method">> => <<"GET">>,
        <<"path">> => URL,
        <<"accept">> => <<"application/json">>,
        <<"authorization">> => <<"Bearer ", Token/binary>>
    };
verifier_request(URL, Token, <<"cookie">>) ->
    #{
        <<"method">> => <<"GET">>,
        <<"path">> => URL,
        <<"accept">> => <<"application/json">>,
        <<"cookie">> => <<"auth_token=", Token/binary>>
    };
verifier_request(URL, Token, _Mode) ->
    #{
        <<"method">> => <<"GET">>,
        <<"path">> => URL,
        <<"accept">> => <<"application/json">>,
        <<"x-lbry-auth-token">> => Token
    }.

append_auth_token(URL, Token) ->
    Sep =
        case binary:match(URL, <<"?">>) of
            nomatch -> <<"?">>;
            _ -> <<"&">>
        end,
    <<URL/binary, Sep/binary, "auth_token=", Token/binary>>.

decoded_identity(Body, Source, Opts) ->
    try hb_json:decode(Body) of
        Decoded -> identity_from_value(Decoded, Source, Opts)
    catch
        _:_ -> {error, invalid_legacy_auth_response}
    end.

identity_from_value(Value, Source, _Opts) when is_integer(Value); is_binary(Value); is_list(Value) ->
    {ok, #{
        <<"legacy-user-id">> => hb_util:bin(Value),
        <<"auth-source">> => hb_util:bin(Source)
    }};
identity_from_value(Msg, Source, Opts) when is_map(Msg) ->
    case legacy_auth_success(Msg, Opts) of
        false ->
            {error, legacy_auth_rejected};
        true ->
            Value =
                case hb_maps:get(<<"data">>, Msg, not_found, Opts) of
                    not_found -> Msg;
                    Data -> Data
                end,
            identity_from_map(Value, Source, Opts)
    end;
identity_from_value(_Value, _Source, _Opts) ->
    {error, invalid_legacy_identity}.

legacy_auth_success(Msg, Opts) ->
    case hb_maps:get(<<"success">>, Msg, true, Opts) of
        false -> false;
        <<"false">> -> false;
        0 -> false;
        _ -> true
    end.

identity_from_map(Msg, Source, Opts) when is_map(Msg) ->
    case first_value([<<"legacy-user-id">>, <<"legacy_user_id">>, <<"user-id">>, <<"user_id">>, <<"id">>], Msg, Opts) of
        not_found ->
            {error, legacy_user_id_not_found};
        UserID ->
            {ok, #{
                <<"legacy-user-id">> => hb_util:bin(UserID),
                <<"auth-source">> => hb_util:bin(Source),
                <<"legacy-user">> => legacy_user(Msg, UserID, Opts)
            }}
    end;
identity_from_map(_Value, _Source, _Opts) ->
    {error, invalid_legacy_identity}.

legacy_user(Msg, UserID, Opts) ->
    User0 = allowlisted_user_fields(Msg, Opts),
    User1 =
        case maps:is_key(<<"id">>, User0) of
            true -> User0;
            false -> User0#{ <<"id">> => UserID }
        end,
    case maps:is_key(<<"has_verified_email">>, User1) of
        true -> User1;
        false -> User1#{ <<"has_verified_email">> => true }
    end.

allowlisted_user_fields(Msg, Opts) ->
    lists:foldl(
        fun(Key, Acc) ->
            case hb_maps:get(Key, Msg, not_found, Opts) of
                not_found -> Acc;
                Value -> Acc#{ Key => Value }
            end
        end,
        #{},
        [
            <<"id">>,
            <<"primary_email">>,
            <<"latest_claimed_email">>,
            <<"has_verified_email">>,
            <<"is_identity_verified">>,
            <<"is_reward_approved">>,
            <<"experimental_ui">>,
            <<"global_mod">>,
            <<"odysee_live_disabled">>,
            <<"country">>,
            <<"country_code">>,
            <<"created_at">>,
            <<"device_types">>,
            <<"channels">>,
            <<"channel_claims">>,
            <<"channel_claim_ids">>,
            <<"channel_claim_id">>,
            <<"default_channel_claim_id">>,
            <<"primary_channel_claim_id">>,
            <<"youtube_channels">>
        ]
    ).

identity_secret(Identity, Base, Req, Opts) ->
    case legacy_auth_pepper(Base, Req, Opts) of
        not_found ->
            {error, legacy_auth_pepper_not_configured};
        Pepper ->
            UserID = maps:get(<<"legacy-user-id">>, Identity),
            {ok, hb_util:encode(hb_crypto:sha256(<<"odysee-legacy-auth:", (hb_util:bin(Pepper))/binary, ":", UserID/binary>>))}
    end.

proof_secret(Base, Req, Opts) ->
    case {hb_maps:get(<<"legacy-user-id">>, Req, not_found, Opts), hb_maps:get(<<"legacy-auth-proof">>, Req, not_found, Opts)} of
        {not_found, _Proof} ->
            {error, authentication_required};
        {_UserID, not_found} ->
            {error, authentication_required};
        {UserID0, Proof} ->
            Identity = #{
                <<"legacy-user-id">> => hb_util:bin(UserID0),
                <<"auth-source">> => <<"proof">>
            },
            case identity_proof(Identity, Req, Base, Req, Opts) of
                {ok, Proof} -> identity_secret(Identity, Base, Req, Opts);
                {ok, _Other} -> {error, invalid_legacy_auth_proof};
                {error, Reason} -> {error, Reason}
            end
    end.

identity_proof(Identity, Msg, Base, Req, Opts) ->
    case legacy_auth_pepper(Base, Req, Opts) of
        not_found ->
            {error, legacy_auth_pepper_not_configured};
        Pepper ->
            {ok, hb_util:encode(crypto:mac(hmac, sha256, hb_util:bin(Pepper), term_to_binary(proof_fields(Identity, Msg, Opts))))}
    end.

proof_fields(Identity, Msg, Opts) ->
    #{
        <<"legacy-user-id">> => maps:get(<<"legacy-user-id">>, Identity),
        <<"legacy-auth-path">> => hb_maps:get(<<"legacy-auth-path">>, Msg, hb_maps:get(<<"path">>, Msg, <<>>, Opts), Opts),
        <<"method">> => hb_maps:get(<<"method">>, Msg, <<>>, Opts),
        <<"body">> => hb_maps:get(<<"body">>, Msg, <<>>, Opts)
    }.

legacy_auth_pepper(Base, Req, Opts) ->
    first_config(
        [
            <<"legacy-auth-pepper">>,
            <<"legacy_auth_pepper">>,
            <<"odysee-legacy-auth-pepper">>,
            <<"odysee_legacy_auth_pepper">>
        ],
        Base,
        Req,
        Opts
    ).

commit_with_secret(Secret, Base, Req, Opts) ->
    hb_ao:resolve(
        #{ <<"device">> => <<"httpsig@1.0">> },
        (sanitize(Req, Opts))#{
            <<"path">> => <<"proxy-commit">>,
            <<"commitment-device">> => ?DEVICE,
            <<"secret">> => Secret,
            <<"message">> => Base
        },
        Opts
    ).

verify_with_secret(Secret, Base, Req, Opts) ->
    hb_ao:resolve(
        #{ <<"device">> => <<"httpsig@1.0">> },
        (sanitize(Req, Opts))#{
            <<"path">> => <<"proxy-verify">>,
            <<"secret">> => Secret,
            <<"message">> => Base
        },
        Opts
    ).

sanitize(Msg, Opts) when is_map(Msg) ->
    hb_maps:without(sensitive_keys(), Msg, Opts);
sanitize(Msg, _Opts) ->
    Msg.

sensitive_keys() ->
    token_keys() ++ [
        <<"authorization">>,
        <<"cookie">>,
        <<"secret">>,
        <<"trusted-token-users">>,
        <<"trusted_token_users">>,
        <<"legacy-token-users">>,
        <<"legacy_token_users">>,
        <<"odysee-legacy-token-users">>,
        <<"odysee_legacy_token_users">>,
        <<"legacy-auth-pepper">>,
        <<"legacy_auth_pepper">>,
        <<"odysee-legacy-auth-pepper">>,
        <<"odysee_legacy_auth_pepper">>,
        <<"legacy-auth-path">>,
        <<"legacy_auth_path">>,
        <<"legacy-auth-proof">>,
        <<"legacy_auth_proof">>,
        <<"legacy-auth-url">>,
        <<"legacy_auth_url">>,
        <<"odysee-legacy-auth-url">>,
        <<"odysee_legacy_auth_url">>,
        <<"legacy-auth-token-mode">>,
        <<"legacy_auth_token_mode">>,
        <<"legacy-auth-verifier-token-mode">>,
        <<"legacy_auth_verifier_token_mode">>,
        <<"odysee-legacy-auth-token-mode">>,
        <<"odysee_legacy_auth_token_mode">>
    ].

first_param(Keys, Base, Req, Opts) ->
    first_param(Keys, [Req, Base], Opts).

first_param(_Keys, [], _Opts) ->
    not_found;
first_param(Keys, [Msg | Rest], Opts) when is_map(Msg) ->
    case first_key(Keys, Msg, Opts) of
        not_found -> first_param(Keys, Rest, Opts);
        Found -> Found
    end;
first_param(Keys, [_Msg | Rest], Opts) ->
    first_param(Keys, Rest, Opts).

first_key([], _Msg, _Opts) ->
    not_found;
first_key([Key | Rest], Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_key(Rest, Msg, Opts);
        Value -> {Value, Key}
    end.

first_config(Keys, Base, Req, Opts) ->
    case first_param(Keys, Base, Req, Opts) of
        not_found -> first_value(Keys, Opts, Opts);
        {Value, _Key} -> Value
    end.

first_value([], _Msg, _Opts) ->
    not_found;
first_value([Key | Rest], Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_value(Rest, Msg, Opts);
        Value -> Value
    end.

find_in_list(_Fun, []) ->
    not_found;
find_in_list(Fun, [Item | Rest]) ->
    case Fun(Item) of
        not_found -> find_in_list(Fun, Rest);
        Value -> Value
    end.

extracts_token_from_header_test() ->
    Req = #{ <<"x-lbry-auth-token">> => <<"abc123">> },
    ?assertEqual({ok, <<"abc123">>, <<"x-lbry-auth-token">>}, request_token(#{}, Req, #{})).

extracts_token_from_bearer_header_value_test() ->
    Req = #{ <<"x-lbry-auth-token">> => <<"Bearer abc123_DEF">> },
    ?assertEqual({ok, <<"abc123_DEF">>, <<"x-lbry-auth-token">>}, request_token(#{}, Req, #{})).

extracts_token_from_form_style_value_test() ->
    Req = #{ <<"X-Odysee-Demo-Auth-Token">> => <<"auth_token=abc123_DEF">> },
    ?assertEqual({ok, <<"abc123_DEF">>, <<"X-Odysee-Demo-Auth-Token">>}, request_token(#{}, Req, #{})).

extracts_token_from_cookie_test() ->
    Req = #{ <<"cookie">> => <<"other=1; auth_token=\"abc123\"; theme=dark">> },
    ?assertEqual({ok, <<"abc123">>, <<"cookie">>}, request_token(#{}, Req, #{})).

rejects_missing_token_test() ->
    ?assertEqual({error, authentication_required}, authenticated_identity(#{}, #{}, #{})).

accepts_url_safe_token_chars_test() ->
    ?assertEqual(true, valid_token(<<"abc-123_DEF">>)).

stable_secret_uses_identity_not_token_test() ->
    Base = test_base(),
    Req1 = #{ <<"auth_token">> => <<"tokenA">> },
    Req2 = #{ <<"auth_token">> => <<"tokenB">> },
    {ok, Res1} = generate(Base, Req1, #{}),
    {ok, Res2} = generate(Base, Req2, #{}),
    ?assertEqual(hb_maps:get(<<"secret">>, Res1, #{}), hb_maps:get(<<"secret">>, Res2, #{})).

generate_strips_credentials_test() ->
    Base = test_base(),
    Req = #{
        <<"path">> => <<"commitments">>,
        <<"auth_token">> => <<"tokenA">>,
        <<"cookie">> => <<"auth_token=tokenA">>,
        <<"authorization">> => <<"Bearer value">>
    },
    {ok, Res} = generate(Base, Req, #{}),
    ?assertEqual(false, maps:is_key(<<"auth_token">>, Res)),
    ?assertEqual(false, maps:is_key(<<"cookie">>, Res)),
    ?assertEqual(false, maps:is_key(<<"authorization">>, Res)),
    ?assertEqual(<<"commitments">>, maps:get(<<"path">>, Res)).

commit_verify_with_legacy_token_test() ->
    Base = #{ <<"hello">> => <<"world">> },
    Provider = test_base(),
    Req = #{ <<"auth_token">> => <<"tokenA">> },
    {ok, Committed} = commit(Base, maps:merge(Provider, Req), #{}),
    ?assert(hb_message:verify(Committed, maps:merge(Provider, Req), #{})).

auth_hook_legacy_tokens_share_signer_test() ->
    Node =
        hb_http_server:start_node(
            #{
                <<"priv-wallet">> => ServerWallet = ar_wallet:new(),
                <<"on">> => #{
                    <<"request">> => #{
                        <<"device">> => <<"auth-hook@1.0">>,
                        <<"path">> => <<"request">>,
                        <<"secret-provider">> =>
                            (test_base())#{
                                <<"device">> => ?DEVICE,
                                <<"access-control">> => (test_base())#{ <<"device">> => ?DEVICE }
                            }
                    }
                }
            }
        ),
    {ok, Resp1} =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"first">>,
                <<"auth_token">> => <<"tokenA">>
            },
            #{}
        ),
    {ok, Resp2} =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"second">>,
                <<"auth_token">> => <<"tokenB">>
            },
            #{}
        ),
    Signers1 = signers_from_commitments_response(Resp1, ServerWallet),
    Signers2 = signers_from_commitments_response(Resp2, ServerWallet),
    ?assertMatch([_], Signers1),
    ?assertEqual(Signers1, Signers2).

internal_api_user_me_response_test() ->
    Body = hb_json:encode(#{
        <<"success">> => true,
        <<"data">> => #{
            <<"id">> => 123,
            <<"primary_email">> => <<"demo@example.test">>,
            <<"has_verified_email">> => true,
            <<"auth_token">> => <<"must-not-leak">>
        }
    }),
    {ok, Identity} = decoded_identity(Body, <<"verifier">>, #{}),
    ?assertEqual(<<"123">>, maps:get(<<"legacy-user-id">>, Identity)),
    User = maps:get(<<"legacy-user">>, Identity),
    ?assertEqual(123, maps:get(<<"id">>, User)),
    ?assertEqual(<<"demo@example.test">>, maps:get(<<"primary_email">>, User)),
    ?assertEqual(true, maps:get(<<"has_verified_email">>, User)),
    ?assertEqual(false, maps:is_key(<<"auth_token">>, User)).

internal_api_user_me_failure_test() ->
    Body = hb_json:encode(#{
        <<"success">> => false,
        <<"error">> => <<"invalid auth token">>
    }),
    ?assertEqual({error, legacy_auth_rejected}, decoded_identity(Body, <<"verifier">>, #{})).

verifier_token_mode_defaults_to_form_test() ->
    ?assertEqual(<<"form">>, verifier_token_mode(#{}, #{}, #{})).

verifier_request_uses_form_body_for_user_me_test() ->
    Req = verifier_request(<<"https://example.test/user/me">>, <<"tokenA">>, <<"form">>),
    ?assertEqual(<<"POST">>, maps:get(<<"method">>, Req)),
    ?assertEqual(<<"https://example.test/user/me">>, maps:get(<<"path">>, Req)),
    ?assertEqual(<<"application/x-www-form-urlencoded">>, maps:get(<<"content-type">>, Req)),
    ?assertEqual(<<"auth_token=tokenA">>, maps:get(<<"body">>, Req)),
    ?assertEqual(false, binary:match(maps:get(<<"path">>, Req), <<"tokenA">>) =/= nomatch).

demo_header_uses_user_me_verifier_by_default_test() ->
    Req = #{ <<"X-Odysee-Demo-Auth-Token">> => <<"tokenA">> },
    {ok, Token, Source} = request_token(#{}, Req, #{}),
    ?assertEqual(<<"tokenA">>, Token),
    ?assertEqual(<<"X-Odysee-Demo-Auth-Token">>, Source),
    ?assertEqual(<<"https://api.odysee.com/user/me">>, demo_verifier_url(Source)).

verifier_request_can_use_auth_header_test() ->
    Req = verifier_request(<<"https://example.test/user/me">>, <<"tokenA">>, <<"header">>),
    ?assertEqual(<<"GET">>, maps:get(<<"method">>, Req)),
    ?assertEqual(<<"https://example.test/user/me">>, maps:get(<<"path">>, Req)),
    ?assertEqual(<<"tokenA">>, maps:get(<<"x-lbry-auth-token">>, Req)),
    ?assertEqual(false, maps:is_key(<<"authorization">>, Req)),
    ?assertEqual(false, binary:match(maps:get(<<"path">>, Req), <<"tokenA">>) =/= nomatch).

verifier_request_can_use_query_mode_test() ->
    Req = verifier_request(<<"https://example.test/user/me">>, <<"tokenA">>, <<"query">>),
    ?assertEqual(<<"https://example.test/user/me?auth_token=tokenA">>, maps:get(<<"path">>, Req)),
    ?assertEqual(false, maps:is_key(<<"x-lbry-auth-token">>, Req)).

test_base() ->
    #{
        <<"trusted-token-users">> => #{
            <<"tokenA">> => <<"42">>,
            <<"tokenB">> => #{ <<"id">> => 42 }
        },
        <<"legacy-auth-pepper">> => <<"test-pepper">>
    }.

signers_from_commitments_response(Response, ServerWallet) ->
    ServerAddress = ar_wallet:to_address(ServerWallet),
    hb_maps:values(hb_maps:filtermap(
        fun(Key, Value) when ?IS_ID(Key) ->
            Type = hb_maps:get(<<"type">>, Value, not_found, #{}),
            Committer = hb_maps:get(<<"committer">>, Value, not_found, #{}),
            case {Type, Committer} of
                {<<"rsa-pss-sha512">>, ServerAddress} -> false;
                {<<"rsa-pss-sha512">>, _} -> {true, Committer};
                _ -> false
            end;
           (_Key, _Value) ->
            false
        end,
        Response,
        #{}
    )).
