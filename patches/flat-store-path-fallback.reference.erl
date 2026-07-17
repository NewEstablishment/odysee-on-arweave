maybe_store_path_result(MsgList, Res, Opts) ->
    case is_not_found_result(Res) of
        true ->
            case store_path_request(MsgList, Opts) of
                {ok, Req} ->
                    case hb_cache:read(Req, Opts) of
                        {ok, _} = OK -> OK;
                        _ -> Res
                    end;
                error ->
                    Res
            end;
        false ->
            Res
    end.

is_not_found_result({error, not_found}) ->
    true;
is_not_found_result({error, #{ <<"body">> := not_found }}) ->
    true;
is_not_found_result(_Res) ->
    false.

store_path_request(MsgList, Opts) when is_list(MsgList) ->
    case lists:all(fun is_plain_store_path_msg/1, MsgList) of
        true -> build_store_path_request(MsgList, Opts);
        false -> error
    end;
store_path_request(_MsgList, _Opts) ->
    error.

is_plain_store_path_msg(Msg) when is_map(Msg) ->
    not maps:is_key(<<"device">>, Msg);
is_plain_store_path_msg(_Msg) ->
    false.

build_store_path_request(MsgList, Opts) ->
    Maps = [Msg || Msg <- MsgList, is_map(Msg)],
    PathParts = [
        Path
     ||
        Msg <- Maps,
        Path <- [hb_maps:get(<<"path">>, Msg, undefined, Opts)],
        Path =/= undefined
    ],
    case PathParts of
        [] ->
            error;
        _ ->
            BaseReq =
                lists:foldl(
                    fun(Msg, Acc) ->
                        hb_maps:merge(
                            Acc,
                            hb_maps:without([<<"path">>], Msg, Opts),
                            Opts
                        )
                    end,
                    #{},
                    Maps
                ),
            {ok, BaseReq#{ <<"read">> => hb_path:to_binary(PathParts) }}
    end.

%% @doc Catch all return if we are in an infinite loop.
error_infinite(Base, Req, Opts) ->
    ?event(
        ao_core,
        {error, {type, infinite_recursion},
            {base, Base},
            {req, Req},
            {opts, Opts}
        },
        Opts
    ),
    ?trace(),
resolve_many(MsgList, Opts) ->
    ?event_debug(debug_ao_core, {resolve_many, MsgList}, Opts),
    Res = do_resolve_many(MsgList, Opts),
    ?event_debug(debug_ao_core, {resolve_many_complete, {res, Res}, {reqs, MsgList}}, Opts),
    maybe_store_path_result(MsgList, Res, Opts).
do_resolve_many([], _Opts) ->
    {failure, <<"Attempted to resolve an empty message sequence.">>};
