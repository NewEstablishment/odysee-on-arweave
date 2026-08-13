%%% @doc Immutable Lua application artifacts used by Odysee workflows.
%%%
%%% The scripts are ordinary `application/lua' messages executed by
%%% `lua@5.3a'. They are not devices and contain no Odysee product policy.
-module(hb_odysee_lua).
-export([multirequest/0, multirequest_id/1, publish/1]).

%% @doc Return the generic ordered multirequest Lua message.
multirequest() ->
    PrivDir = code:priv_dir(odysee),
    {ok, Script} = file:read_file(filename:join(PrivDir, "resolve_many.lua")),
    #{
        <<"content-type">> => <<"application/lua">>,
        <<"body">> => Script
    }.

%% @doc Return the immutable content ID of the multirequest message.
multirequest_id(Opts) ->
    hb_message:id(multirequest(), none, Opts).

%% @doc Ensure the multirequest message is present in the configured store.
publish(Opts) ->
    Message = multirequest(),
    maybe
        {ok, _} ?= hb_cache:write(Message, Opts),
        {ok, hb_message:id(Message, none, Opts)}
    end.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

%% @doc Resolve ordered singleton requests and isolate per-item failures.
multirequest_resolves_singleton_messages_test_() ->
    {timeout, 30, fun multirequest_resolves_singleton_messages/0}.

multirequest_resolves_singleton_messages() ->
    Opts = #{ <<"store">> => [hb_test_utils:test_store()] },
    First = #{ <<"body">> => <<"first">>, <<"content-type">> => <<"text/plain">> },
    Second = #{ <<"body">> => <<"second">>, <<"content-type">> => <<"text/plain">> },
    {ok, _} = hb_cache:write(First, Opts),
    {ok, _} = hb_cache:write(Second, Opts),
    FirstID = hb_message:id(First, none, Opts),
    SecondID = hb_message:id(Second, none, Opts),
    Request = #{
        <<"path">> => <<"resolve-many">>,
        <<"requests">> => [
            #{ <<"path">> => <<"/", FirstID/binary>> },
            #{},
            #{ <<"path">> => <<"/", SecondID/binary>> }
        ]
    },
    {ok, Response} = hb_ao:resolve(
        #{
            <<"device">> => <<"lua@5.3a">>,
            <<"module">> => multirequest()
        },
        Request,
        Opts
    ),
    ?assertEqual(3, length(Response)),
    [FirstResult, MissingResult, SecondResult] = Response,
    ?assertEqual(<<"ok">>, hb_ao:get(<<"status">>, FirstResult, Opts)),
    ?assertEqual(<<"first">>, hb_ao:get(<<"result/body">>, FirstResult, Opts)),
    ?assertNotEqual(<<"ok">>, hb_ao:get(<<"status">>, MissingResult, Opts)),
    ?assertEqual(<<"ok">>, hb_ao:get(<<"status">>, SecondResult, Opts)),
    ?assertEqual(<<"second">>, hb_ao:get(<<"result/body">>, SecondResult, Opts)).

-endif.
