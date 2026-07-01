-module(dev_odysee_publish_gate).
-implements(<<"odysee-publish-gate@1.0">>).
-export([request/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEFAULT_PROTECT_PATH, <<"publish">>).

request(Base, HookReq, Opts) ->
    Request = hb_maps:get(<<"request">>, HookReq, #{}, Opts),
    case is_protected(Base, Request, Opts) andalso not has_credential(Request, Opts) of
        true ->
            {error,
                #{
                    <<"status">> => 401,
                    <<"body">> => <<"odysee-publish-requires-auth">>
                }
            };
        false ->
            {ok, HookReq}
    end.

is_protected(Base, Request, Opts) ->
    Pattern = hb_maps:get(<<"protect-path">>, Base, ?DEFAULT_PROTECT_PATH, Opts),
    Path = hb_util:bin(hb_maps:get(<<"path">>, Request, <<>>, Opts)),
    Path =/= <<>> andalso binary:match(Path, hb_util:bin(Pattern)) =/= nomatch.

has_credential(Request, Opts) ->
    has_header(Request, <<"cookie">>, Opts)
        orelse has_header(Request, <<"authorization">>, Opts)
        orelse has_priv_cookie(Request, Opts).

has_header(Request, Key, Opts) ->
    case hb_maps:get(Key, Request, undefined, Opts) of
        Value when is_binary(Value), Value =/= <<>> ->
            true;
        _ ->
            LowerKey = lower_key(Key),
            lists:any(
                fun({RequestKey, Value}) ->
                    lower_key(RequestKey) =:= LowerKey
                        andalso is_binary(Value)
                        andalso Value =/= <<>>
                end,
                hb_maps:to_list(Request, Opts)
            )
    end.

has_priv_cookie(Request, Opts) ->
    case hb_private:get(<<"cookie">>, Request, #{}, Opts) of
        Map when is_map(Map), map_size(Map) > 0 -> true;
        _ -> false
    end.

lower_key(Key) when is_binary(Key) ->
    hb_util:to_lower(Key);
lower_key(Key) ->
    hb_util:to_lower(hb_ao:normalize_key(Key)).

publish_without_credential_rejected_test() ->
    HookReq = hook_req(#{ <<"path">> => <<"/publish">> }),
    ?assertMatch({error, #{ <<"status">> := 401 }}, request(#{}, HookReq, #{})).

publish_with_authorization_allowed_test() ->
    Request = #{ <<"path">> => <<"/publish">>, <<"Authorization">> => <<"Bearer tok">> },
    HookReq = hook_req(Request),
    ?assertEqual({ok, HookReq}, request(#{}, HookReq, #{})).

publish_with_private_cookie_allowed_test() ->
    Request =
        hb_private:set(
            #{ <<"path">> => <<"/publish">> },
            <<"cookie">>,
            #{ <<"auth_token">> => <<"tok">> },
            #{}
        ),
    HookReq = hook_req(Request),
    ?assertEqual({ok, HookReq}, request(#{}, HookReq, #{})).

non_publish_without_credential_allowed_test() ->
    HookReq = hook_req(#{ <<"path">> => <<"/read">> }),
    ?assertEqual({ok, HookReq}, request(#{}, HookReq, #{})).

configured_protect_path_rejected_test() ->
    HookReq = hook_req(#{ <<"path">> => <<"/upload">> }),
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        request(#{ <<"protect-path">> => <<"upload">> }, HookReq, #{})
    ).

hook_req(Request) ->
    #{ <<"request">> => Request }.
