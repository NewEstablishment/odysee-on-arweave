%%% @doc Installs the immutable homepage Lua computation and schedules it with
%%% stock `cron@1.0'. Generated homepages are ordinary node-signed messages.
-module(hb_odysee_homepage).
-behaviour(gen_server).

-export([start_link/0, refresh/0, status/0]).
-export([init/1, handle_call/3, handle_cast/2, handle_info/2, terminate/2, code_change/3]).
-export([module_message/0, plan_message/0, plan_message/1, install/1, refresh/1]).

-define(RETRY_MS, 5000).
-define(DEFAULT_INTERVAL, <<"6-hours">>).
-define(DEFAULT_POOL_SIZE, 36).
-define(DEFAULT_INITIAL_POOL_SIZE, 12).

start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

refresh() ->
    gen_server:call(?MODULE, refresh, infinity).

status() ->
    gen_server:call(?MODULE, status).

init([]) ->
    self() ! install,
    {ok, #{status => starting}}.

handle_call(status, _From, State) ->
    {reply, maps:without([opts], State), State};
handle_call(refresh, _From, State = #{opts := Opts, module_id := ModuleID, plan_id := PlanID}) ->
    Result = run_refresh(ModuleID, PlanID, Opts),
    {reply, Result, State#{last_refresh => Result}};
handle_call(refresh, _From, State) ->
    {reply, {error, not_installed}, State};
handle_call(_Request, _From, State) ->
    {reply, {error, bad_request}, State}.

handle_cast(_Message, State) ->
    {noreply, State}.

handle_info(install, State) ->
    case node_opts() of
        {ok, Opts} ->
            case hb_opts:get(<<"homepage-materializer">>, false, Opts) of
                true ->
                    case safe_install(Opts) of
                        {ok, Installed} ->
                            {noreply, maps:merge(State, Installed#{status => refreshing, opts => Opts})};
                        {error, Reason} ->
                            erlang:send_after(?RETRY_MS, self(), install),
                            {noreply, State#{status => {retrying, Reason}}}
                    end;
                _ ->
                    {noreply, State#{status => disabled, opts => Opts}}
            end;
        {error, Reason} ->
            erlang:send_after(?RETRY_MS, self(), install),
            {noreply, State#{status => {retrying, Reason}}}
    end;
handle_info({refresh_complete, Result}, State = #{
    opts := Opts,
    module_id := ModuleID,
    plan_id := PlanID
}) ->
    Summary = refresh_summary(Result),
    logger:notice("Homepage snapshot refresh completed: ~p", [Summary]),
    case Result of
        {ok, _} ->
            case safe_schedule(ModuleID, PlanID, Opts) of
                {ok, CronID} ->
                    {noreply, State#{status => ready, cron_id => CronID, last_refresh => Summary}};
                {error, Reason} ->
                    erlang:send_after(?RETRY_MS, self(), schedule),
                    {noreply, State#{status => {scheduling, Reason}, last_refresh => Summary}}
            end;
        _ ->
            erlang:send_after(?RETRY_MS, self(), install),
            {noreply, State#{status => {retrying, Summary}, last_refresh => Summary}}
    end;
handle_info(schedule, State = #{
    opts := Opts,
    module_id := ModuleID,
    plan_id := PlanID
}) ->
    case safe_schedule(ModuleID, PlanID, Opts) of
        {ok, CronID} ->
            {noreply, State#{status => ready, cron_id => CronID}};
        {error, Reason} ->
            erlang:send_after(?RETRY_MS, self(), schedule),
            {noreply, State#{status => {scheduling, Reason}}}
    end;
handle_info(_Message, State) ->
    {noreply, State}.

terminate(_Reason, _State) -> ok.
code_change(_Old, State, _Extra) -> {ok, State}.

install(Opts) ->
    maybe
        {ok, ModuleID} ?= publish(module_message(), Opts),
        {ok, PlanID} ?= publish(plan_message(Opts), Opts),
        ok ?= start_initial_refresh(ModuleID, PlanID, Opts),
        {ok, #{module_id => ModuleID, plan_id => PlanID}}
    end.

safe_install(Opts) ->
    try install(Opts) of
        Result -> Result
    catch
        Class:Reason:Stack ->
            logger:error("Homepage snapshot installation failed: ~p", [{Class, Reason, Stack}]),
            {error, {Class, Reason}}
    end.

refresh(Opts) ->
    maybe
        {ok, ModuleID} ?= publish(module_message(), Opts),
        {ok, PlanID} ?= publish(plan_message(Opts), Opts),
        run_refresh(ModuleID, PlanID, Opts)
    end.

module_message() ->
    {ok, Body} = file:read_file(filename:join(code:priv_dir(odysee), "homepage.lua")),
    #{
        <<"content-type">> => <<"application/lua">>,
        <<"name">> => <<"odysee-homepage-materializer.lua">>,
        <<"body">> => Body
    }.

plan_message() ->
    plan_message(#{}).

plan_message(_Opts) ->
    Path = filename:join(code:priv_dir(odysee), "homepage-plan.json.gz"),
    {ok, Compressed} = file:read_file(Path),
    Homepages = hb_json:decode(zlib:gunzip(Compressed)),
    #{
        <<"schema">> => <<"odysee-homepage-plan@1.0">>,
        <<"type">> => <<"homepage-plan">>,
        <<"homepages">> => Homepages
    }.

publish(Message, Opts) ->
    case hb_cache:write(Message, Opts) of
        {ok, _} -> {ok, hb_message:id(Message, none, Opts)};
        Error -> Error
    end.

run_refresh(ModuleID, PlanID, Opts) ->
    run_refresh(ModuleID, PlanID, Opts, #{}).

schedule(ModuleID, PlanID, Opts) ->
    Interval = hb_opts:get(<<"homepage-refresh-interval">>, ?DEFAULT_INTERVAL, Opts),
    Base = #{<<"device">> => <<"cron@1.0">>},
    Req = (refresh_request(PlanID, Opts))#{
        <<"device">> => <<"lua@5.3a">>,
        <<"module">> => ModuleID,
        <<"device-sandbox">> => [
            <<"cache@1.0">>, <<"json@1.0">>, <<"message@1.0">>,
            <<"httpsig@1.0">>, <<"local-name@1.0">>, <<"meta@1.0">>,
            <<"search@1.0">>
        ],
        <<"path">> => <<"every">>,
        <<"cron-path">> => <<"refresh">>,
        <<"interval">> => Interval,
        <<"cache-control">> => [<<"no-store">>]
    },
    case hb_ao:resolve(Base, Req, Opts) of
        {ok, Response} -> {ok, hb_maps:get(<<"body">>, Response, Opts)};
        Error -> Error
    end.

safe_schedule(ModuleID, PlanID, Opts) ->
    try schedule(ModuleID, PlanID, Opts) of
        Result -> Result
    catch
        Class:Reason:Stack ->
            logger:error("Homepage cron installation failed: ~p", [{Class, Reason, Stack}]),
            {error, {Class, Reason}}
    end.

start_initial_refresh(ModuleID, PlanID, Opts) ->
    Parent = self(),
    spawn_link(fun() ->
        InitialPool = hb_opts:get(
            <<"homepage-initial-category-pool-size">>,
            ?DEFAULT_INITIAL_POOL_SIZE,
            Opts
        ),
        InitialLanguage = hb_opts:get(<<"homepage-initial-language">>, <<"en">>, Opts),
        Result = try
            run_refresh(
                ModuleID,
                PlanID,
                Opts,
                #{
                    <<"category-pool-size">> => InitialPool,
                    <<"languages">> => [InitialLanguage]
                }
            )
        catch
            Class:Reason:Stack ->
                logger:error("Initial homepage refresh failed: ~p", [{Class, Reason, Stack}]),
                {error, {Class, Reason}}
        end,
        Parent ! {refresh_complete, Result}
    end),
    ok.

refresh_summary({ok, Snapshots}) when is_map(Snapshots) ->
    Published = maps:filtermap(
        fun(Language, Snapshot) when is_map(Snapshot) ->
            case {
                maps:get(<<"language">>, Snapshot, undefined),
                maps:get(<<"id">>, Snapshot, undefined)
            } of
                {Language, ID} when is_binary(ID), byte_size(ID) =:= 43 -> {true, ID};
                _ -> false
            end;
           (_, _) -> false
        end,
        Snapshots
    ),
    {ok, Published};
refresh_summary({error, Failures}) when is_map(Failures) ->
    Normalized = maps:map(fun(_Language, Value) -> normalize_failure(Value) end, Failures),
    LanguageFailures = maps:filter(fun(_Language, Value) -> is_list(Value) end, Normalized),
    case map_size(LanguageFailures) of
        0 -> {error, maps:with([<<"body">>, <<"status">>], Normalized)};
        _ -> {error, LanguageFailures}
    end;
refresh_summary(Result) ->
    Result.

normalize_failure(Value) when is_map(Value) ->
    Keys = maps:keys(Value),
    case lists:all(fun erlang:is_integer/1, Keys) of
        true -> [maps:get(Key, Value) || Key <- lists:sort(Keys)];
        false -> maps:map(fun(_Key, Item) -> normalize_failure(Item) end, Value)
    end;
normalize_failure(Value) ->
    Value.

refresh_request(PlanID, Opts) ->
    PoolSize = hb_opts:get(<<"homepage-category-pool-size">>, ?DEFAULT_POOL_SIZE, Opts),
    #{
        <<"path">> => <<"refresh">>,
        <<"plan-id">> => PlanID,
        <<"category-pool-size">> => PoolSize
    }.

run_refresh(ModuleID, PlanID, Opts, Overrides) ->
    Base = #{
        <<"device">> => <<"lua@5.3a">>,
        <<"module">> => ModuleID,
        <<"device-sandbox">> => [
            <<"cache@1.0">>, <<"json@1.0">>, <<"message@1.0">>,
            <<"httpsig@1.0">>, <<"local-name@1.0">>, <<"meta@1.0">>,
            <<"search@1.0">>
        ]
    },
    Req = maps:merge(refresh_request(PlanID, Opts), Overrides),
    SourceTimeout = hb_opts:get(<<"homepage-source-timeout">>, 10000, Opts),
    hb_ao:resolve(
        Base,
        Req,
        Opts#{
            <<"cache-control">> => [<<"no-store">>],
            <<"http-client-connect-timeout">> => min(SourceTimeout, 5000),
            <<"http-client-hackney-recv-timeout">> => SourceTimeout
        }
    ).

node_opts() ->
    try
        Env = hb_opts:default_message_with_env(),
        ConfigPath = hb_opts:get(hb_config_location, <<"config.flat">>, Env),
        {ok, Config} = hb_opts:load(ConfigPath, Env),
        KeyPath = hb_opts:get(priv_key_location, <<"hyperbeam-key.json">>, Config),
        Wallet = hb:wallet(KeyPath),
        ServerID = hb_util:human_id(ar_wallet:to_address(Wallet)),
        hb_http_server:get_opts(#{<<"http-server">> => ServerID})
    of
        Opts when is_map(Opts) -> {ok, Opts};
        Other -> {error, {invalid_node_options, Other}}
    catch
        Class:Reason -> {error, {Class, Reason}}
    end.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

artifacts_are_content_addressable_test() ->
    Opts = #{<<"store">> => [hb_test_utils:test_store()]},
    {ok, ModuleID} = publish(module_message(), Opts),
    {ok, PlanID} = publish(plan_message(), Opts),
    ?assertMatch({ok, _}, hb_cache:read(ModuleID, Opts)),
    ?assertMatch({ok, _}, hb_cache:read(PlanID, Opts)),
    #{<<"homepages">> := Homepages} = plan_message(),
    ?assert(maps:is_key(<<"en">>, Homepages)),
    ?assert(maps:is_key(<<"pt-BR">>, Homepages)).

-endif.
