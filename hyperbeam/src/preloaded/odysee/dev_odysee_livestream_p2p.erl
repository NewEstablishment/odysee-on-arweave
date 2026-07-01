-module(dev_odysee_livestream_p2p).
-implements(<<"odysee-livestream-p2p@1.0">>).
-export([info/1, room/3, announce/3, leave/3, signal/3, signals/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-livestream-p2p@1.0">>).
-define(OWNER, odysee_livestream_p2p_owner).
-define(PEER_TABLE, odysee_livestream_p2p_peers).
-define(SIGNAL_TABLE, odysee_livestream_p2p_signals).
-define(DEFAULT_TTL_MS, 90000).
-define(DEFAULT_HEARTBEAT_MS, 30000).
-define(DEFAULT_ICE_SERVERS, []).

info(_Opts) ->
    #{
        exports => [<<"room">>, <<"announce">>, <<"leave">>, <<"signal">>, <<"signals">>],
        device => ?DEVICE,
        tracker => <<"hyperbeam">>,
        ttl_ms => ?DEFAULT_TTL_MS,
        heartbeat_ms => ?DEFAULT_HEARTBEAT_MS
    }.

room(Base, Req, Opts) ->
    safe(fun() ->
        case method(Req, Opts) of
            <<"options">> ->
                {ok, cors_preflight_response()};
            _ ->
                Data = request_data(Base, Req, Opts),
                maybe
                    {ok, RoomID} ?= room_id(Data, Opts),
                    {ok, response(room_payload(RoomID, Data, Opts))}
                else
                    Error -> Error
                end
        end
    end).

announce(Base, Req, Opts) ->
    safe(fun() ->
        case method(Req, Opts) of
            <<"options">> ->
                {ok, cors_preflight_response()};
            _ ->
                Data = request_data(Base, Req, Opts),
                maybe
                    {ok, RoomID} ?= room_id(Data, Opts),
                    {ok, PeerID} ?= required_value([<<"peer-id">>, <<"peer_id">>], Data, Opts),
                    ok ?= put_peer(RoomID, PeerID, Data, Opts),
                    {ok, response(room_payload(RoomID, Data#{ <<"peer-id">> => PeerID }, Opts))}
                else
                    Error -> Error
                end
        end
    end).

leave(Base, Req, Opts) ->
    safe(fun() ->
        case method(Req, Opts) of
            <<"options">> ->
                {ok, cors_preflight_response()};
            _ ->
                Data = request_data(Base, Req, Opts),
                maybe
                    {ok, RoomID} ?= room_id(Data, Opts),
                    {ok, PeerID} ?= required_value([<<"peer-id">>, <<"peer_id">>], Data, Opts),
                    ok ?= delete_peer(RoomID, PeerID),
                    {ok, response(room_payload(RoomID, Data, Opts))}
                else
                    Error -> Error
                end
        end
    end).

signal(Base, Req, Opts) ->
    safe(fun() ->
        case method(Req, Opts) of
            <<"options">> ->
                {ok, cors_preflight_response()};
            _ ->
                Data = request_data(Base, Req, Opts),
                maybe
                    {ok, RoomID} ?= room_id(Data, Opts),
                    {ok, FromPeerID} ?= required_value(
                        [<<"from-peer-id">>, <<"from_peer_id">>, <<"peer-id">>, <<"peer_id">>],
                        Data,
                        Opts
                    ),
                    {ok, Kind} ?= required_value([<<"kind">>, <<"type">>], Data, Opts),
                    {ok, Signal} ?= put_signal(RoomID, FromPeerID, Kind, Data, Opts),
                    {ok, response(signal_payload(RoomID, FromPeerID, Data, Signal, Opts))}
                else
                    Error -> Error
                end
        end
    end).

signals(Base, Req, Opts) ->
    safe(fun() ->
        case method(Req, Opts) of
            <<"options">> ->
                {ok, cors_preflight_response()};
            _ ->
                Data = request_data(Base, Req, Opts),
                maybe
                    {ok, RoomID} ?= room_id(Data, Opts),
                    {ok, PeerID} ?= required_value([<<"peer-id">>, <<"peer_id">>], Data, Opts),
                    {ok, response(signals_payload(RoomID, PeerID, Data, Opts))}
                else
                    Error -> Error
                end
        end
    end).

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> {error, Reason};
        _:Reason -> {error, Reason}
    end.

request_data(Base, Req, Opts) ->
    Body = request_body(Base, Req, Opts),
    merge_maps(Base, merge_maps(Req, Body)).

request_body(Base, Req, Opts) ->
    case first_found([{Req, <<"body">>}, {Base, <<"body">>}], Opts) of
        not_found -> #{};
        Body when is_map(Body) -> Body;
        Body when is_binary(Body) ->
            case try_decode_json(Body) of
                {ok, Decoded} when is_map(Decoded) -> Decoded;
                _ -> #{}
            end;
        _ -> #{}
    end.

room_id(Data, Opts) ->
    case first_value(
        [
            <<"room-id">>,
            <<"room_id">>,
            <<"swarm-id">>,
            <<"swarm_id">>,
            <<"claim-id">>,
            <<"claim_id">>,
            <<"channel-id">>,
            <<"channel_id">>,
            <<"stream-id">>,
            <<"stream_id">>
        ],
        Data,
        Opts
    ) of
        not_found -> {error, missing_room_id};
        Value -> {ok, safe_bin(Value)}
    end.

required_value(Keys, Data, Opts) ->
    case first_value(Keys, Data, Opts) of
        not_found -> {error, missing_required_value};
        Value -> {ok, safe_bin(Value)}
    end.

put_peer(RoomID, PeerID, Data, Opts) ->
    ensure_tables(),
    Now = erlang:system_time(millisecond),
    TTL = ttl_ms(Data, Opts),
    Peer = #{
        <<"peer-id">> => PeerID,
        <<"role">> => role(Data, Opts),
        <<"room-id">> => RoomID,
        <<"channel-id">> => first_value([<<"channel-id">>, <<"channel_id">>], Data, Opts),
        <<"claim-id">> => first_value([<<"claim-id">>, <<"claim_id">>], Data, Opts),
        <<"video-url">> => first_value([<<"video-url">>, <<"video_url">>], Data, Opts),
        <<"announced-at">> => Now,
        <<"expires-at">> => Now + TTL
    },
    ets:insert(?PEER_TABLE, {{RoomID, PeerID}, compact_peer(Peer)}),
    ok.

delete_peer(RoomID, PeerID) ->
    ensure_tables(),
    ets:delete(?PEER_TABLE, {RoomID, PeerID}),
    ok.

put_signal(RoomID, FromPeerID, Kind, Data, Opts) ->
    ensure_tables(),
    Now = erlang:system_time(millisecond),
    TTL = ttl_ms(Data, Opts),
    SignalID = signal_id(),
    Signal = compact_signal(#{
        <<"id">> => SignalID,
        <<"signal-id">> => SignalID,
        <<"room-id">> => RoomID,
        <<"room_id">> => RoomID,
        <<"from-peer-id">> => FromPeerID,
        <<"from_peer_id">> => FromPeerID,
        <<"to-peer-id">> => first_value([<<"to-peer-id">>, <<"to_peer_id">>], Data, Opts),
        <<"to_peer_id">> => first_value([<<"to-peer-id">>, <<"to_peer_id">>], Data, Opts),
        <<"kind">> => Kind,
        <<"type">> => Kind,
        <<"payload">> => signal_body(Data, Opts),
        <<"created-at">> => Now,
        <<"expires-at">> => Now + TTL
    }),
    ets:insert(?SIGNAL_TABLE, {{RoomID, SignalID}, Signal}),
    {ok, Signal}.

signal_payload(RoomID, PeerID, Data, Signal, Opts) ->
    Payload = signals_payload(RoomID, PeerID, Data, Opts),
    Payload#{ <<"signal">> => Signal }.

signals_payload(RoomID, PeerID, Data, Opts) ->
    cleanup_expired(),
    #{
        <<"device">> => ?DEVICE,
        <<"room_id">> => RoomID,
        <<"room-id">> => RoomID,
        <<"peer_id">> => PeerID,
        <<"peer-id">> => PeerID,
        <<"signals">> => signals_for(RoomID, PeerID),
        <<"peers">> => peers(RoomID),
        <<"ttl_ms">> => ttl_ms(Data, Opts),
        <<"heartbeat_ms">> => heartbeat_ms(Data, Opts)
    }.

room_payload(RoomID, Data, Opts) ->
    cleanup_expired(),
    SwarmID = swarm_id(RoomID, Data, Opts),
    #{
        <<"device">> => ?DEVICE,
        <<"room_id">> => RoomID,
        <<"room-id">> => RoomID,
        <<"swarm_id">> => SwarmID,
        <<"swarm-id">> => SwarmID,
        <<"tracker">> => <<"hyperbeam">>,
        <<"tracker_urls">> => tracker_urls(Data, Opts),
        <<"tracker-urls">> => tracker_urls(Data, Opts),
        <<"signaling">> => #{
            <<"signal-path">> => <<"/~odysee-livestream-p2p@1.0/signal">>,
            <<"signals-path">> => <<"/~odysee-livestream-p2p@1.0/signals">>
        },
        <<"ice_servers">> => ice_servers(Data, Opts),
        <<"ice-servers">> => ice_servers(Data, Opts),
        <<"peers">> => peers(RoomID),
        <<"ttl_ms">> => ttl_ms(Data, Opts),
        <<"heartbeat_ms">> => heartbeat_ms(Data, Opts),
        <<"peer_id">> => first_value([<<"peer-id">>, <<"peer_id">>], Data, Opts)
    }.

peers(RoomID) ->
    ensure_tables(),
    Now = erlang:system_time(millisecond),
    [
        Peer
     || {{PeerRoomID, _PeerID}, Peer = #{ <<"expires-at">> := ExpiresAt }} <- ets:tab2list(?PEER_TABLE),
        PeerRoomID =:= RoomID,
        ExpiresAt > Now
    ].

signals_for(RoomID, PeerID) ->
    ensure_tables(),
    Now = erlang:system_time(millisecond),
    [
        Signal
     || {{SignalRoomID, _SignalID}, Signal = #{ <<"expires-at">> := ExpiresAt }} <- ets:tab2list(?SIGNAL_TABLE),
        SignalRoomID =:= RoomID,
        ExpiresAt > Now,
        signal_visible_to(Signal, PeerID)
    ].

signal_visible_to(Signal, PeerID) ->
    FromPeerID = hb_maps:get(<<"from-peer-id">>, Signal, not_found, #{}),
    ToPeerID = hb_maps:get(<<"to-peer-id">>, Signal, not_found, #{}),
    FromPeerID =/= PeerID andalso (ToPeerID =:= not_found orelse ToPeerID =:= PeerID).

cleanup_expired() ->
    ensure_tables(),
    Now = erlang:system_time(millisecond),
    lists:foreach(
        fun
            ({Key, #{ <<"expires-at">> := ExpiresAt }}) when ExpiresAt =< Now ->
                ets:delete(?PEER_TABLE, Key);
            (_) ->
                ok
        end,
        ets:tab2list(?PEER_TABLE)
    ),
    lists:foreach(
        fun
            ({Key, #{ <<"expires-at">> := ExpiresAt }}) when ExpiresAt =< Now ->
                ets:delete(?SIGNAL_TABLE, Key);
            (_) ->
                ok
        end,
        ets:tab2list(?SIGNAL_TABLE)
    ).

compact_peer(Peer) ->
    maps:filter(
        fun
            (_Key, not_found) -> false;
            (_Key, undefined) -> false;
            (_Key, <<>>) -> false;
            (_Key, _Value) -> true
        end,
        Peer
    ).

compact_signal(Signal) ->
    compact_peer(Signal).

signal_body(Data, Opts) ->
    case first_value([<<"payload">>, <<"body">>], Data, Opts) of
        not_found ->
            maps:filter(
                fun
                    (<<"room-id">>, _Value) -> false;
                    (<<"room_id">>, _Value) -> false;
                    (<<"from-peer-id">>, _Value) -> false;
                    (<<"from_peer_id">>, _Value) -> false;
                    (<<"to-peer-id">>, _Value) -> false;
                    (<<"to_peer_id">>, _Value) -> false;
                    (<<"peer-id">>, _Value) -> false;
                    (<<"peer_id">>, _Value) -> false;
                    (<<"kind">>, _Value) -> false;
                    (<<"type">>, _Value) -> false;
                    (_Key, _Value) -> true
                end,
                Data
            );
        Value -> Value
    end.

signal_id() ->
    Integer = erlang:unique_integer([monotonic, positive]),
    <<"sig-", (integer_to_binary(Integer))/binary>>.

swarm_id(RoomID, Data, Opts) ->
    case first_value([<<"swarm-id">>, <<"swarm_id">>], Data, Opts) of
        not_found -> <<"odysee-live-", RoomID/binary>>;
        Value -> safe_bin(Value)
    end.

role(Data, Opts) ->
    case first_value([<<"role">>], Data, Opts) of
        not_found -> <<"viewer">>;
        Value -> safe_bin(Value)
    end.

tracker_urls(Data, Opts) ->
    Requested = values(
        [
            first_value([<<"tracker-urls">>, <<"tracker_urls">>], Data, Opts),
            first_value([<<"tracker-url">>, <<"tracker_url">>], Data, Opts),
            hb_opts:get(<<"odysee-livestream-p2p-trackers">>, not_found, Opts)
        ]
    ),
    case Requested of
        [] -> [];
        _ -> unique(Requested)
    end.

ice_servers(Data, Opts) ->
    Requested = values(
        [
            first_value([<<"ice-servers">>, <<"ice_servers">>], Data, Opts),
            first_value([<<"ice-server">>, <<"ice_server">>], Data, Opts),
            first_value([<<"turn-url">>, <<"turn_url">>], Data, Opts),
            hb_opts:get(<<"odysee-livestream-p2p-ice-servers">>, not_found, Opts)
        ]
    ),
    case Requested of
        [] -> ?DEFAULT_ICE_SERVERS;
        _ -> [ice_server(Value, Data, Opts) || Value <- unique(Requested)]
    end.

ice_server(Value = #{}, _Data, _Opts) ->
    Value;
ice_server(Value, Data, Opts) ->
    Server0 = #{ <<"urls">> => safe_bin(Value) },
    Server1 =
        put_optional(
            {<<"username">>, first_value([<<"turn-username">>, <<"turn_username">>], Data, Opts)},
            Server0
        ),
    put_optional(
        {<<"credential">>, first_value([<<"turn-credential">>, <<"turn_credential">>], Data, Opts)},
        Server1
    ).

ttl_ms(Data, Opts) ->
    positive_int(first_value([<<"ttl-ms">>, <<"ttl_ms">>], Data, Opts), ?DEFAULT_TTL_MS).

heartbeat_ms(Data, Opts) ->
    positive_int(first_value([<<"heartbeat-ms">>, <<"heartbeat_ms">>], Data, Opts), ?DEFAULT_HEARTBEAT_MS).

positive_int(not_found, Default) ->
    Default;
positive_int(Value, Default) when is_integer(Value), Value > 0 ->
    Value;
positive_int(Value, Default) when is_binary(Value) ->
    case string:to_integer(binary_to_list(Value)) of
        {Int, _} when Int > 0 -> Int;
        _ -> Default
    end;
positive_int(_Value, Default) ->
    Default.

values(Values) ->
    lists:flatmap(fun value_list/1, Values).

value_list(not_found) ->
    [];
value_list(Value) when is_list(Value) ->
    lists:flatmap(fun value_list/1, Value);
value_list(Value) when is_binary(Value) ->
    [Trimmed || Trimmed <- [trim(Value)], Trimmed =/= <<>>];
value_list(Value) when is_map(Value) ->
    [Value];
value_list(Value) ->
    [safe_bin(Value)].

unique(Values) ->
    lists:reverse(
        element(
            2,
            lists:foldl(
                fun(Value, {Seen, Acc}) ->
                    Key = unique_key(Value),
                    case sets:is_element(Key, Seen) of
                        true -> {Seen, Acc};
                        false -> {sets:add_element(Key, Seen), [Value | Acc]}
                    end
                end,
                {sets:new(), []},
                Values
            )
        )
    ).

unique_key(Value) when is_map(Value) ->
    hb_json:encode(Value);
unique_key(Value) ->
    safe_bin(Value).

put_optional({_Key, not_found}, Msg) ->
    Msg;
put_optional({_Key, undefined}, Msg) ->
    Msg;
put_optional({_Key, <<>>}, Msg) ->
    Msg;
put_optional({Key, Value}, Msg) ->
    Msg#{ Key => Value }.

merge_maps(Left, Right) when is_map(Left), is_map(Right) ->
    maps:merge(Left, Right);
merge_maps(_Left, Right) when is_map(Right) ->
    Right;
merge_maps(Left, _Right) when is_map(Left) ->
    Left;
merge_maps(_Left, _Right) ->
    #{}.

first_value([], _Map, _Opts) ->
    not_found;
first_value([Key | Rest], Map, Opts) ->
    case hb_maps:get(Key, Map, not_found, Opts) of
        not_found -> first_value(Rest, Map, Opts);
        Value -> Value
    end.

first_found([], _Opts) ->
    not_found;
first_found([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_found(Rest, Opts);
        Value -> Value
    end;
first_found([_ | Rest], Opts) ->
    first_found(Rest, Opts).

safe_bin(Value) when is_binary(Value) ->
    trim(Value);
safe_bin(Value) when is_atom(Value) ->
    atom_to_binary(Value, utf8);
safe_bin(Value) when is_integer(Value) ->
    integer_to_binary(Value);
safe_bin(Value) ->
    hb_util:bin(Value).

trim(Value) when is_binary(Value) ->
    list_to_binary(string:trim(binary_to_list(Value))).

try_decode_json(Body) ->
    try hb_json:decode(Body) of
        Decoded -> {ok, Decoded}
    catch
        _:_ -> error
    end.

method(Req, Opts) ->
    hb_util:to_lower(hb_maps:get(<<"method">>, Req, hb_opts:get(<<"method">>, <<"get">>, Opts), Opts)).

response(Payload) ->
    Body = hb_json:encode(Payload),
    (cors_headers())#{
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"content-length">> => byte_size(Body),
        <<"body">> => Body
    }.

cors_preflight_response() ->
    (cors_headers())#{
        <<"status">> => 204,
        <<"content-type">> => <<"text/plain">>,
        <<"body">> => <<>>
    }.

cors_headers() ->
    #{
        <<"access-control-allow-origin">> => <<"*">>,
        <<"access-control-allow-methods">> => <<"GET, POST, OPTIONS">>,
        <<"access-control-allow-headers">> => <<"content-type, authorization, accept">>,
        <<"access-control-max-age">> => <<"86400">>
    }.

ensure_tables() ->
    case tables_ready() of
        true ->
            ok;
        false ->
            ensure_owner(),
            wait_for_tables(100)
    end.

tables_ready() ->
    ets:info(?PEER_TABLE) =/= undefined andalso ets:info(?SIGNAL_TABLE) =/= undefined.

ensure_owner() ->
    case whereis(?OWNER) of
        undefined ->
            Parent = self(),
            Pid = spawn(fun() -> table_owner(Parent) end),
            receive
                {?OWNER, Pid, _Status} -> ok
            after 1000 -> ok
            end;
        _ ->
            ok
    end.

table_owner(Parent) ->
    case catch register(?OWNER, self()) of
        true ->
            create_table(?PEER_TABLE),
            create_table(?SIGNAL_TABLE),
            Parent ! {?OWNER, self(), ready},
            table_owner_loop();
        _ ->
            Parent ! {?OWNER, self(), already_started}
    end.

table_owner_loop() ->
    receive
        stop -> ok;
        _ -> table_owner_loop()
    end.

create_table(Table) ->
    case ets:info(Table) of
        undefined ->
            try ets:new(Table, [named_table, public, set, {read_concurrency, true}, {write_concurrency, true}]) of
                _ -> ok
            catch
                error:badarg -> ok
            end;
        _ ->
            ok
    end.

wait_for_tables(0) ->
    ok;
wait_for_tables(Attempts) ->
    case tables_ready() of
        true ->
            ok;
        false ->
            timer:sleep(10),
            wait_for_tables(Attempts - 1)
    end.

announce_returns_room_payload_test() ->
    ensure_tables(),
    ets:delete_all_objects(?PEER_TABLE),
    ets:delete_all_objects(?SIGNAL_TABLE),
    {ok, Res} = announce(
        #{},
        #{
            <<"claim-id">> => <<"abc">>,
            <<"peer-id">> => <<"peer-a">>,
            <<"role">> => <<"seed">>
        },
        #{}
    ),
    Body = hb_json:decode(hb_maps:get(<<"body">>, Res, #{})),
    ?assertEqual(<<"abc">>, hb_maps:get(<<"room_id">>, Body, #{})),
    ?assertEqual(<<"odysee-live-abc">>, hb_maps:get(<<"swarm_id">>, Body, #{})),
    ?assertEqual(<<"hyperbeam">>, hb_maps:get(<<"tracker">>, Body, #{})),
    ?assertEqual([], hb_maps:get(<<"tracker_urls">>, Body, #{})),
    ?assertMatch([#{ <<"peer-id">> := <<"peer-a">>, <<"role">> := <<"seed">> }], hb_maps:get(<<"peers">>, Body, #{})).

leave_removes_peer_test() ->
    ensure_tables(),
    ets:delete_all_objects(?PEER_TABLE),
    ets:delete_all_objects(?SIGNAL_TABLE),
    {ok, _} = announce(#{}, #{ <<"claim-id">> => <<"abc">>, <<"peer-id">> => <<"peer-a">> }, #{}),
    {ok, Res} = leave(#{}, #{ <<"claim-id">> => <<"abc">>, <<"peer-id">> => <<"peer-a">> }, #{}),
    Body = hb_json:decode(hb_maps:get(<<"body">>, Res, #{})),
    ?assertEqual([], hb_maps:get(<<"peers">>, Body, #{})).

signals_are_visible_to_target_peer_test() ->
    ensure_tables(),
    ets:delete_all_objects(?PEER_TABLE),
    ets:delete_all_objects(?SIGNAL_TABLE),
    {ok, _} = signal(
        #{},
        #{
            <<"room-id">> => <<"abc">>,
            <<"from-peer-id">> => <<"seed-a">>,
            <<"to-peer-id">> => <<"viewer-a">>,
            <<"kind">> => <<"offer">>,
            <<"payload">> => #{ <<"sdp">> => <<"v=0">> }
        },
        #{}
    ),
    {ok, ViewerRes} = signals(#{}, #{ <<"room-id">> => <<"abc">>, <<"peer-id">> => <<"viewer-a">> }, #{}),
    ViewerBody = hb_json:decode(hb_maps:get(<<"body">>, ViewerRes, #{})),
    ?assertMatch([#{ <<"kind">> := <<"offer">>, <<"from-peer-id">> := <<"seed-a">> }], hb_maps:get(<<"signals">>, ViewerBody, #{})),
    {ok, SeedRes} = signals(#{}, #{ <<"room-id">> => <<"abc">>, <<"peer-id">> => <<"seed-a">> }, #{}),
    SeedBody = hb_json:decode(hb_maps:get(<<"body">>, SeedRes, #{})),
    ?assertEqual([], hb_maps:get(<<"signals">>, SeedBody, #{})).
