-module(dev_odysee_auth).
-implements(<<"odysee-auth@1.0">>).
-export([info/1, commit/3, verify/3]).
-export([generate/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-auth@1.0">>).

info(_Opts) ->
    #{ exports => [<<"generate">>, <<"commit">>, <<"verify">>] }.

commit(Base, Req, Opts) ->
    case generated_secret(Base, Req, Opts) of
        {ok, Key} ->
            hb_ao:resolve(
                #{ <<"device">> => <<"httpsig@1.0">> },
                Req#{
                    <<"path">> => <<"proxy-commit">>,
                    <<"commitment-device">> => ?DEVICE,
                    <<"secret">> => Key,
                    <<"message">> => Base
                },
                Opts
            );
        {error, Err} ->
            {error, Err}
    end.

verify(Base, Req, Opts) ->
    case generated_secret(Base, Req, Opts) of
        {ok, Key} ->
            hb_ao:resolve(
                #{ <<"device">> => <<"httpsig@1.0">> },
                Req#{
                    <<"path">> => <<"proxy-verify">>,
                    <<"secret">> => Key,
                    <<"message">> => Base
                },
                Opts
            );
        {error, Err} ->
            {error, Err}
    end.

generate(_Base, #{ <<"secret">> := Secret }, _Opts) ->
    {ok, Secret};
generate(Base, Req, Opts) ->
    case auth_secret(Base, Req, Opts) of
        {ok, Secret} ->
            {ok, (strip_sensitive(Req, Opts))#{ <<"secret">> => Secret, <<"odysee-auth-owner">> => Secret }};
        {error, _} = Error ->
            Error
    end.

generated_secret(Base, Req, Opts) ->
    case generate(Base, Req, Opts) of
        {ok, Secret} when is_binary(Secret) ->
            {ok, Secret};
        {ok, Msg} when is_map(Msg) ->
            case hb_maps:get(<<"secret">>, Msg, not_found, Opts) of
                not_found -> missing_auth();
                Secret -> {ok, Secret}
            end;
        {error, _} = Error ->
            Error
    end.

auth_secret(_Base, Req, Opts) ->
    case authorization(Req, Opts) of
        {basic, Auth} ->
            hb_ao:resolve(
                #{ <<"device">> => <<"http-auth@1.0">> },
                Req#{
                    <<"path">> => <<"generate">>,
                    <<"authorization">> => <<"Basic ", Auth/binary>>
                },
                Opts
            );
        {token, Token} ->
            {ok, token_secret(Token)};
        not_found ->
            case token_field(Req, Opts) of
                {ok, Token} -> {ok, token_secret(Token)};
                not_found -> missing_auth()
            end
    end.

authorization(Req, Opts) ->
    case first_field([<<"authorization">>], Req, Opts) of
        not_found -> not_found;
        Auth ->
            try authorization_value(hb_util:bin(Auth))
            catch _:_ -> not_found
            end
    end.

authorization_value(Auth) ->
    case binary:split(string:trim(Auth), <<" ">>) of
        [Scheme, Value0] ->
            Value = string:trim(Value0, leading),
            case hb_util:to_lower(Scheme) of
                <<"basic">> when Value =/= <<>> -> {basic, Value};
                <<"bearer">> when Value =/= <<>> -> {token, Value};
                <<"token">> when Value =/= <<>> -> {token, Value};
                _ -> not_found
            end;
        _ ->
            not_found
    end.

token_field(Req, Opts) ->
    case first_field(token_keys(), Req, Opts) of
        not_found -> token_cookie(Req, Opts);
        Token -> {ok, Token}
    end.

token_cookie(Req, Opts) ->
    case parsed_cookie_token(Req, Opts) of
        not_found -> raw_cookie_token(Req, Opts);
        Found -> Found
    end.

parsed_cookie_token(Req, Opts) ->
    try dev_cookie:extract(Req, #{}, Opts) of
        {ok, Cookies} ->
            case first_field(cookie_token_keys(), Cookies, Opts) of
                not_found -> not_found;
                Token -> {ok, cookie_value(Token)}
            end;
        _ ->
            not_found
    catch _:_ ->
        not_found
    end.

raw_cookie_token(Req, Opts) ->
    case first_field([<<"cookie">>], Req, Opts) of
        not_found -> not_found;
        Cookie when is_binary(Cookie) -> raw_cookie_header_token(Cookie);
        Cookies when is_list(Cookies) -> raw_cookie_list_token_or_header(Cookies);
        _ -> not_found
    end.

raw_cookie_list_token_or_header([]) ->
    not_found;
raw_cookie_list_token_or_header([First | _] = Cookie) when is_integer(First) ->
    raw_cookie_header_token(hb_util:bin(Cookie));
raw_cookie_list_token_or_header(Cookies) ->
    raw_cookie_list_token(Cookies).

raw_cookie_list_token([]) ->
    not_found;
raw_cookie_list_token([Cookie | Rest]) ->
    case raw_cookie_header_token_value(Cookie) of
        not_found -> raw_cookie_list_token(Rest);
        Found -> Found
    end.

raw_cookie_header_token_value(Cookie) when is_binary(Cookie) ->
    raw_cookie_header_token(Cookie);
raw_cookie_header_token_value(Cookie) when is_list(Cookie) ->
    raw_cookie_header_token(hb_util:bin(Cookie));
raw_cookie_header_token_value(_Cookie) ->
    not_found.

raw_cookie_header_token(Cookie) ->
    raw_cookie_pair_token(binary:split(Cookie, <<";">>, [global])).

raw_cookie_pair_token([]) ->
    not_found;
raw_cookie_pair_token([Pair0 | Rest]) ->
    Pair = string:trim(Pair0),
    case binary:split(Pair, <<"=">>) of
        [Key, Value] ->
            case lists:member(lower_key(Key), cookie_token_keys()) andalso Value =/= <<>> of
                true -> {ok, hb_escape:decode(Value)};
                false -> raw_cookie_pair_token(Rest)
            end;
        _ ->
            raw_cookie_pair_token(Rest)
    end.

cookie_value(#{ <<"value">> := Value }) ->
    Value;
cookie_value(Value) ->
    Value.

token_secret(Token0) ->
    Token = hb_util:bin(Token0),
    hb_util:encode(hb_crypto:sha256(<<"odysee-auth:", Token/binary>>)).

missing_auth() ->
    {error, #{
        <<"status">> => 401,
        <<"www-authenticate">> => <<"Bearer, Basic">>,
        <<"details">> => <<"No Odysee auth token or Authorization header provided.">>
    }}.

strip_sensitive(Req, Opts) ->
    Sensitive = token_keys() ++ [<<"authorization">>, <<"cookie">>],
    hb_maps:filter(
        fun(Key, _Value) -> not lists:member(lower_key(Key), Sensitive) end,
        Req,
        Opts
    ).

first_field(Keys, Msg, Opts) ->
    case first_exact_field(Keys, Msg, Opts) of
        not_found -> first_case_insensitive_field(Keys, Msg, Opts);
        Value -> Value
    end.

first_exact_field([], _Msg, _Opts) ->
    not_found;
first_exact_field([Key | Rest], Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_exact_field(Rest, Msg, Opts);
        <<>> -> first_exact_field(Rest, Msg, Opts);
        Value -> Value
    end.

first_case_insensitive_field(Keys, Msg, Opts) when is_map(Msg) ->
    LowerKeys = [lower_key(Key) || Key <- Keys],
    first_case_insensitive_pair(LowerKeys, hb_maps:to_list(Msg, Opts));
first_case_insensitive_field(_Keys, _Msg, _Opts) ->
    not_found.

first_case_insensitive_pair(_Keys, []) ->
    not_found;
first_case_insensitive_pair(Keys, [{_Key, <<>>} | Rest]) ->
    first_case_insensitive_pair(Keys, Rest);
first_case_insensitive_pair(Keys, [{Key, Value} | Rest]) ->
    case lists:member(lower_key(Key), Keys) of
        true -> Value;
        false -> first_case_insensitive_pair(Keys, Rest)
    end.

lower_key(Key) when is_binary(Key) ->
    hb_util:to_lower(Key);
lower_key(Key) ->
    hb_util:to_lower(hb_ao:normalize_key(Key)).

token_keys() ->
    [
        <<"auth-token">>,
        <<"auth_token">>,
        <<"authtoken">>,
        <<"lbry-auth-token">>,
        <<"lbry_auth_token">>,
        <<"x-lbry-auth-token">>,
        <<"x_lbry_auth_token">>,
        <<"odysee-auth-token">>,
        <<"odysee_auth_token">>
    ].

cookie_token_keys() ->
    [
        <<"auth_token">>,
        <<"auth-token">>,
        <<"lbry-auth-token">>,
        <<"odysee-auth-token">>
    ].

-ifdef(TEST).

missing_auth_returns_401_test() ->
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        generate(#{}, #{}, #{})
    ).

bearer_token_generates_secret_and_strips_authorization_test() ->
    {ok, Msg} = generate(#{}, #{ <<"authorization">> => <<"Bearer tok">> }, #{}),
    ?assertMatch(#{ <<"secret">> := _ }, Msg),
    ?assertEqual(not_found, hb_maps:get(<<"authorization">>, Msg, not_found, #{})).

authorization_scheme_is_case_insensitive_test() ->
    {ok, Msg1} = generate(#{}, #{ <<"authorization">> => <<"Bearer tok">> }, #{}),
    {ok, Msg2} = generate(#{}, #{ <<"authorization">> => <<"bearer   tok">> }, #{}),
    ?assertEqual(
        hb_maps:get(<<"secret">>, Msg1, #{}),
        hb_maps:get(<<"secret">>, Msg2, #{})
    ).

authorization_header_key_is_case_insensitive_test() ->
    {ok, Msg} = generate(#{}, #{ <<"Authorization">> => <<"Bearer tok">> }, #{}),
    ?assertMatch(#{ <<"secret">> := _ }, Msg),
    ?assertEqual(not_found, hb_maps:get(<<"Authorization">>, Msg, not_found, #{})).

basic_authorization_is_normalized_for_http_auth_test() ->
    Basic = base64:encode(<<"user:pass">>),
    {ok, Msg1} = generate(#{}, #{ <<"authorization">> => <<"Basic ", Basic/binary>> }, #{}),
    {ok, Msg2} = generate(#{}, #{ <<"Authorization">> => <<"basic ", Basic/binary>> }, #{}),
    ?assertEqual(
        hb_maps:get(<<"secret">>, Msg1, #{}),
        hb_maps:get(<<"secret">>, Msg2, #{})
    ),
    ?assertEqual(not_found, hb_maps:get(<<"Authorization">>, Msg2, not_found, #{})).

empty_bearer_token_returns_401_test() ->
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        generate(#{}, #{ <<"authorization">> => <<"Bearer ">> }, #{})
    ).

explicit_token_generates_secret_and_strips_token_test() ->
    {ok, Msg} = generate(#{}, #{ <<"x-lbry-auth-token">> => <<"tok">> }, #{}),
    ?assertMatch(#{ <<"secret">> := _ }, Msg),
    ?assertEqual(not_found, hb_maps:get(<<"x-lbry-auth-token">>, Msg, not_found, #{})).

explicit_token_key_is_case_insensitive_test() ->
    {ok, Msg} = generate(#{}, #{ <<"X-Lbry-Auth-Token">> => <<"tok">> }, #{}),
    ?assertMatch(#{ <<"secret">> := _ }, Msg),
    ?assertEqual(not_found, hb_maps:get(<<"X-Lbry-Auth-Token">>, Msg, not_found, #{})).

cookie_token_generates_secret_and_strips_cookie_test() ->
    {ok, Msg} = generate(#{}, #{ <<"cookie">> => <<"auth_token=tok">> }, #{}),
    ?assertMatch(#{ <<"secret">> := _ }, Msg),
    ?assertEqual(not_found, hb_maps:get(<<"cookie">>, Msg, not_found, #{})).

cookie_token_name_is_case_insensitive_test() ->
    {ok, Msg} = generate(#{}, #{ <<"cookie">> => <<"Auth_Token=tok">> }, #{}),
    ?assertMatch(#{ <<"secret">> := _ }, Msg).

same_token_generates_stable_secret_test() ->
    {ok, Msg1} = generate(#{}, #{ <<"auth-token">> => <<"tok">> }, #{}),
    {ok, Msg2} = generate(#{}, #{ <<"authorization">> => <<"Bearer tok">> }, #{}),
    ?assertEqual(
        hb_maps:get(<<"secret">>, Msg1, #{}),
        hb_maps:get(<<"secret">>, Msg2, #{})
    ).

commit_and_verify_with_secret_test() ->
    Base = #{ <<"wallet-address">> => <<"wallet">> },
    Req = #{ <<"secret">> => <<"tok-secret">> },
    {ok, Committed} = commit(Base, Req, #{}),
    ?assertNotEqual([], hb_message:signers(Committed, #{})),
    ?assertEqual({ok, true}, verify(Committed, Req, #{})).

commit_and_verify_with_bearer_token_test() ->
    Base = #{ <<"wallet-address">> => <<"wallet">> },
    Req = #{ <<"authorization">> => <<"Bearer tok">> },
    {ok, Committed} = commit(Base, Req, #{}),
    ?assertNotEqual([], hb_message:signers(Committed, #{})),
    ?assertEqual({ok, true}, verify(Committed, Req, #{})).

-endif.
