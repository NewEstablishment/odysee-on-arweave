-module(dev_odysee_publish_gate).
-implements(<<"odysee-publish-gate@1.0">>).
-export([request/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEFAULT_PROTECT_PATH, <<"publish">>).

request(Base, HookReq, Opts) ->
    Req = hb_maps:get(<<"request">>, HookReq, #{}, Opts),
    case is_protected(Base, Req, Opts) andalso not has_credential(Req, Opts) of
        true ->
            {error, #{
                <<"status">> => 401,
                <<"body">> => <<"odysee-publish-requires-auth">>
            }};
        false ->
            {ok, HookReq}
    end.

is_protected(Base, Req, Opts) ->
    Pattern = hb_maps:get(<<"protect-path">>, Base, ?DEFAULT_PROTECT_PATH, Opts),
    Path = hb_util:bin(hb_maps:get(<<"path">>, Req, <<>>, Opts)),
    Path =/= <<>> andalso binary:match(Path, Pattern) =/= nomatch.

has_credential(Req, Opts) ->
    has_raw(Req, <<"cookie">>, Opts)
        orelse has_raw(Req, <<"authorization">>, Opts)
        orelse has_priv_cookie(Req, Opts).

has_raw(Req, Key, Opts) ->
    case hb_maps:get(Key, Req, undefined, Opts) of
        Value when is_binary(Value), Value =/= <<>> -> true;
        _ -> false
    end.

has_priv_cookie(Req, Opts) ->
    case hb_private:get(<<"cookie">>, Req, #{}, Opts) of
        Cookies when is_map(Cookies), map_size(Cookies) > 0 -> true;
        _ -> false
    end.

hook_req(Req) ->
    #{<<"path">> => <<"request">>, <<"request">> => Req}.

base() ->
    #{<<"device">> => <<"odysee-publish-gate@1.0">>, <<"path">> => <<"request">>}.

rejects_protected_without_credential_test() ->
    Req = #{<<"path">> => <<"publish">>},
    ?assertMatch({error, #{<<"status">> := 401}}, request(base(), hook_req(Req), #{})).

passes_protected_with_cookie_test() ->
    Req = #{<<"path">> => <<"publish">>, <<"cookie">> => <<"auth_token=t">>},
    HookReq = hook_req(Req),
    ?assertEqual({ok, HookReq}, request(base(), HookReq, #{})).

passes_protected_with_priv_cookie_test() ->
    Req = hb_private:set(
        #{<<"path">> => <<"publish">>},
        <<"cookie">>,
        #{<<"auth_token">> => <<"t">>},
        #{}
    ),
    HookReq = hook_req(Req),
    ?assertEqual({ok, HookReq}, request(base(), HookReq, #{})).

passes_unprotected_without_credential_test() ->
    Req = #{<<"path">> => <<"status">>},
    HookReq = hook_req(Req),
    ?assertEqual({ok, HookReq}, request(base(), HookReq, #{})).

custom_protect_path_test() ->
    Req = #{<<"path">> => <<"upload/finalize">>},
    Base = (base())#{<<"protect-path">> => <<"upload">>},
    ?assertMatch({error, #{<<"status">> := 401}}, request(Base, hook_req(Req), #{})).
