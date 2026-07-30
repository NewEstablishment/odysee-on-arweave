%%% @doc Node-local, bounded coordination state for `hyperstream@1.0'.
%%%
%%% State is intentionally ephemeral: WebRTC signaling may contain network
%%% addresses and short-lived credentials, so it is never written to a
%%% HyperBEAM store. Recording entries are the exception; they contain only
%%% caller-supplied immutable media locators and form a content-addressed chain.
-module(dev_hyperstream_coordinator).
-export([call/3]).
-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").
-endif.

-define(CALL_TIMEOUT, 10000).

call(Namespace, Config, Command) ->
    SessionID = command_session_id(Command),
    Name = {?MODULE, Namespace, SessionID},
    case hb_name:lookup(Name) of
        undefined ->
            call_unregistered(Name, Namespace, Config, Command);
        PID ->
            call_pid(PID, Config, Command)
    end.

call_unregistered(Name, Namespace, Config, {create, _Params} = Command) ->
    case admit_session(Name, Namespace, Config) of
        {ok, PID} -> call_pid(PID, Config, Command);
        Error -> Error
    end;
call_unregistered(_Name, _Namespace, _Config, _Command) ->
    {error, 404, <<"session-not-found">>, #{}}.

call_pid(PID, Config, Command) ->
    case mailbox_available(PID, Config) of
        false ->
            {error, 429, <<"coordinator-busy">>, #{<<"retry-after">> => 1}};
        true ->
            Ref = make_ref(),
            ReplyTo = erlang:alias(),
            Monitor = erlang:monitor(process, PID),
            PID ! {hyperstream_call, ReplyTo, Ref, Config, Command},
            receive
                {hyperstream_reply, Ref, Reply} ->
                    erlang:unalias(ReplyTo),
                    erlang:demonitor(Monitor, [flush]),
                    Reply;
                {'DOWN', Monitor, process, PID, _Reason} ->
                    erlang:unalias(ReplyTo),
                    {error, 503, <<"coordinator-unavailable">>, #{}}
            after ?CALL_TIMEOUT ->
                erlang:unalias(ReplyTo),
                erlang:demonitor(Monitor, [flush]),
                {error, 503, <<"coordinator-timeout">>, #{}}
            end
    end.

command_session_id({_Operation, Params}) ->
    maps:get(session_id, Params).

admit_session(SessionName, Namespace, Config) ->
    AdmissionName = {?MODULE, Namespace, admission},
    AdmissionPID = hb_name:singleton(
        AdmissionName,
        fun() ->
            process_flag(message_queue_data, off_heap),
            admission_loop(
                AdmissionName,
                Namespace,
                admission_sessions(Namespace)
            )
        end
    ),
    case mailbox_available(AdmissionPID, Config) of
        false ->
            {error, 429, <<"coordinator-busy">>, #{<<"retry-after">> => 1}};
        true ->
            Ref = make_ref(),
            ReplyTo = erlang:alias(),
            Monitor = erlang:monitor(process, AdmissionPID),
            AdmissionPID ! {
                hyperstream_admit,
                ReplyTo,
                Ref,
                Config,
                SessionName
            },
            receive
                {hyperstream_admitted, Ref, Reply} ->
                    erlang:unalias(ReplyTo),
                    erlang:demonitor(Monitor, [flush]),
                    Reply;
                {'DOWN', Monitor, process, AdmissionPID, _Reason} ->
                    erlang:unalias(ReplyTo),
                    {error, 503, <<"coordinator-unavailable">>, #{}}
            after ?CALL_TIMEOUT ->
                erlang:unalias(ReplyTo),
                erlang:demonitor(Monitor, [flush]),
                {error, 503, <<"coordinator-timeout">>, #{}}
            end
    end.

mailbox_available(PID, Config) ->
    MaxPending = maps:get(max_pending_calls, Config, 128),
    case process_info(PID, message_queue_len) of
        {message_queue_len, Pending} -> Pending < MaxPending;
        undefined -> true
    end.

admission_sessions(Namespace) ->
    maps:from_list([
        begin
            Monitor = erlang:monitor(process, PID),
            {SessionID, {PID, Monitor}}
        end
     || {{?MODULE, ExistingNamespace, SessionID}, PID} <- hb_name:all(),
        ExistingNamespace =:= Namespace,
        is_binary(SessionID)
    ]).

admission_loop(Name, Namespace, Sessions0) ->
    receive
        {hyperstream_admit, From, Ref, RequestConfig, SessionName} ->
            Sessions1 = live_admission_sessions(Sessions0),
            SessionID = element(3, SessionName),
            {Reply, Sessions2} = admit_session_locked(
                SessionID,
                SessionName,
                Namespace,
                RequestConfig,
                Sessions1
            ),
            From ! {hyperstream_admitted, Ref, Reply},
            admission_loop(Name, Namespace, Sessions2);
        {'DOWN', Monitor, process, PID, _Reason} ->
            Sessions1 = maps:filter(
                fun(_SessionID, {ExistingPID, ExistingMonitor}) ->
                    ExistingPID =/= PID orelse ExistingMonitor =/= Monitor
                end,
                Sessions0
            ),
            admission_loop(Name, Namespace, Sessions1)
    after 1000 ->
        Sessions1 = live_admission_sessions(Sessions0),
        case map_size(Sessions1) of
            0 ->
                hb_name:unregister(Name),
                ok;
            _ ->
                admission_loop(Name, Namespace, Sessions1)
        end
    end.

admit_session_locked(SessionID, SessionName, _Namespace, Config, Sessions) ->
    MaxSessions = maps:get(max_sessions, Config),
    case maps:get(SessionID, Sessions, not_found) of
        {PID, _Monitor} ->
            {{ok, PID}, Sessions};
        not_found when map_size(Sessions) >= MaxSessions ->
            {
                {error, 429, <<"session-capacity">>, #{<<"retry-after">> => 1}},
                Sessions
            };
        not_found ->
            PID = hb_name:singleton(
                SessionName,
                fun() ->
                    process_flag(message_queue_data, off_heap),
                    loop(SessionName, initial_state(Config))
                end
            ),
            Monitor = erlang:monitor(process, PID),
            {{ok, PID}, Sessions#{SessionID => {PID, Monitor}}}
    end.

live_admission_sessions(Sessions) ->
    maps:filter(
        fun(_SessionID, {PID, _Monitor}) -> is_process_alive(PID) end,
        Sessions
    ).

initial_state(Config) ->
    #{
        config => Config,
        sessions => #{}
    }.

loop(Name, State0) ->
    receive
        {hyperstream_call, From, Ref, Config, Command} ->
            Now = current_time(),
            State1 = safe_prune(State0#{config => Config}, Now),
            {Reply, State2} =
                try
                    handle(Command, State1, Now)
                catch
                    _Class:_Reason ->
                        {
                            {error, 503, <<"coordinator-failure">>, #{}},
                            State1
                        }
                end,
            From ! {hyperstream_reply, Ref, Reply},
            loop(Name, State2)
    after 1000 ->
        State1 = safe_prune(State0, current_time()),
        case map_size(maps:get(sessions, State1)) of
            0 ->
                hb_name:unregister(Name),
                ok;
            _ ->
                loop(Name, State1)
        end
    end.

handle({create, Params}, State, Now) ->
    create(Params, State, Now);
handle({join, Params}, State, Now) ->
    with_session(Params, State, fun join/4, Now);
handle({heartbeat, Params}, State, Now) ->
    with_session(Params, State, fun heartbeat/4, Now);
handle({leave, Params}, State, Now) ->
    with_session(Params, State, fun leave/4, Now);
handle({signal, Params}, State, Now) ->
    with_session(Params, State, fun signal/4, Now);
handle({events, Params}, State, Now) ->
    with_session(Params, State, fun events/4, Now);
handle({session, Params}, State, Now) ->
    with_session(Params, State, fun session/4, Now);
handle({update, Params}, State, Now) ->
    with_session(Params, State, fun update/4, Now);
handle({record, Params}, State, Now) ->
    with_session(Params, State, fun record/4, Now);
handle({close, Params}, State, Now) ->
    with_session(Params, State, fun close/4, Now).

create(Params, State = #{sessions := Sessions, config := Config}, Now) ->
    SessionID = maps:get(session_id, Params),
    Existing = maps:get(SessionID, Sessions, not_found),
    case Existing of
        not_found ->
            PeerID = maps:get(peer_id, Params),
            Generation = 1,
            Peer = new_peer(PeerID, Generation, Params, Config, Now),
            Stream0 = #{
                id => SessionID,
                owner_peer_id => PeerID,
                owner_signer => maps:get(signer, Params),
                access => maps:get(access, Params),
                join_token_hash => maps:get(join_token_hash, Params),
                metadata => maps:get(metadata, Params),
                status => live,
                created_at => maps:get(wall, Now),
                expires_at => maps:get(wall, Now) + maps:get(session_ttl_ms, Config),
                expires_mono => maps:get(mono, Now) + maps:get(session_ttl_ms, Config),
                closed_at => not_found,
                peers => #{PeerID => Peer},
                next_generation => 2,
                cursor => 0,
                floor_cursor => 0,
                events => [],
                event_bytes => 0,
                create_request_id => maps:get(request_id, Params),
                create_fingerprint => maps:get(fingerprint, Params),
                recording_head => not_found,
                recording_count => 0,
                recording_descriptor_bytes => 0,
                recording_requests => #{},
                recording_store_opts => #{},
                replay_id => not_found,
                replay_finalization_pending => false
            },
            case append_control_event(
                Stream0,
                <<"session-created">>,
                #{<<"peer">> => public_peer(Peer)},
                Config,
                Now
            ) of
                {ok, Stream1} ->
                    Stream2 = set_peer_ack(
                        Stream1,
                        PeerID,
                        maps:get(cursor, Stream1)
                    ),
                    Reply = create_reply(Stream2, Peer),
                    {
                        {ok, Reply},
                        State#{sessions => Sessions#{SessionID => Stream2}}
                    };
                {error, ErrorReply} ->
                    {ErrorReply, State}
            end;
        Stream ->
            create_existing(Params, Stream, State, Now)
    end.

create_existing(Params, Stream, State, Now) ->
    OwnerPeerID = maps:get(owner_peer_id, Stream),
    case {
        maps:get(status, Stream),
        maps:get(peer_id, Params) =:= OwnerPeerID,
        authenticate_peer(Stream, OwnerPeerID, 1, maps:get(credential, Params), Now),
        maps:get(request_id, Params) =:= maps:get(create_request_id, Stream),
        maps:get(fingerprint, Params) =:= maps:get(create_fingerprint, Stream)
    } of
        {live, true, {ok, Peer}, true, true} ->
            {{ok, create_reply(Stream, Peer)}, State};
        {closed, _, _, _, _} ->
            {
                {error, 410, <<"session-closed">>, session_cursor_fields(Stream)},
                State
            };
        {_, _, _, true, false} ->
            {
                {error, 409, <<"idempotency-key-reused">>, #{}},
                State
            };
        _ ->
            {
                {error, 409, <<"session-id-in-use">>, #{}},
                State
            }
    end.

join(Params, Stream, State, Now) ->
    case maps:get(status, Stream) of
        closed ->
            {
                {error, 410, <<"session-closed">>, session_cursor_fields(Stream)},
                Stream,
                State
            };
        live ->
            join_live(Params, Stream, State, Now)
    end.

join_live(Params, Stream = #{peers := Peers}, State, Now) ->
    PeerID = maps:get(peer_id, Params),
    Config = maps:get(config, State),
    Existing = maps:get(PeerID, Peers, not_found),
    AtCapacity = map_size(Peers) >= maps:get(max_peers, Config),
    case {Existing, AtCapacity} of
        {Peer, _} when is_map(Peer) ->
            join_existing(Params, Peer, Stream, State, Now);
        {not_found, true} ->
            {
                {error, 429, <<"peer-capacity">>, #{<<"retry-after">> => 1}},
                Stream,
                State
            };
        {not_found, false} ->
            case can_join(Params, Stream) of
                false ->
                    {
                        {error, 403, <<"join-forbidden">>, #{}},
                        Stream,
                        State
                    };
                true ->
                    Generation = maps:get(next_generation, Stream),
                    Peer = new_peer(PeerID, Generation, Params, Config, Now),
                    Stream0 = Stream#{
                        peers => Peers#{PeerID => Peer},
                        next_generation => Generation + 1
                    },
                    case append_event(
                        Stream0,
                        <<"peer-joined">>,
                        all,
                        #{<<"peer">> => public_peer(Peer)},
                        Config,
                        Now
                    ) of
                        {ok, Stream1} ->
                            Stream2 = set_peer_ack(
                                Stream1,
                                PeerID,
                                maps:get(cursor, Stream1)
                            ),
                            {
                                {ok, join_reply(Stream2, Peer)},
                                Stream2,
                                State
                            };
                        {error, Reply} ->
                            {Reply, Stream, State}
                    end
            end
    end.

join_existing(Params, Peer, Stream, State, Now) ->
    Credential = maps:get(credential, Params),
    SameRequestID =
        maps:get(request_id, Params) =:= maps:get(join_request_id, Peer),
    SameRequest =
        SameRequestID
        andalso maps:get(fingerprint, Params) =:= maps:get(join_fingerprint, Peer),
    case {credential_matches(Peer, Credential), SameRequestID, SameRequest} of
        {true, true, true} ->
            Refreshed = refresh_peer(Peer, maps:get(config, State), Now),
            Stream1 = put_peer(Stream, Refreshed),
            {
                {ok, join_reply(Stream1, Refreshed)},
                Stream1,
                State
            };
        {true, true, false} ->
            {
                {error, 409, <<"idempotency-key-reused">>, #{}},
                Stream,
                State
            };
        _ ->
            {
                {error, 409, <<"peer-id-in-use">>, #{}},
                Stream,
                State
            }
    end.

heartbeat(Params, Stream, State, Now) ->
    with_peer(
        Params,
        Stream,
        State,
        Now,
        fun(Peer, CurrentStream, Config) ->
            Refreshed0 = refresh_peer(Peer, Config, Now),
            Ack = maps:get(ack_cursor, Params),
            Refreshed = Refreshed0#{ack_cursor => max(maps:get(ack_cursor, Peer), Ack)},
            Stream0 = put_peer(CurrentStream, Refreshed),
            Stream1 =
                case maps:get(id, Peer) =:= maps:get(owner_peer_id, CurrentStream) of
                    true ->
                        CurrentStreamTTL = maps:get(session_ttl_ms, Config),
                        Stream0#{
                            expires_at => maps:get(wall, Now) + CurrentStreamTTL,
                            expires_mono => maps:get(mono, Now) + CurrentStreamTTL
                        };
                    false ->
                        Stream0
                end,
            Stream2 = prune_events(Stream1, Now),
            {
                {ok, peer_reply(Stream2, Refreshed)},
                Stream2
            }
        end
    ).

leave(Params, Stream, State, Now) ->
    with_peer(
        Params,
        Stream,
        State,
        Now,
        fun(Peer, CurrentStream, Config) ->
            PeerID = maps:get(id, Peer),
            case PeerID =:= maps:get(owner_peer_id, CurrentStream) of
                true ->
                    close_stream(
                        CurrentStream,
                        <<"owner-left">>,
                        maps:get(store_opts, Params),
                        Config,
                        Now
                    );
                false ->
                    Stream0 = CurrentStream#{
                        peers => maps:remove(PeerID, maps:get(peers, CurrentStream))
                    },
                    {ok, Stream1} = append_control_event(
                        Stream0,
                        <<"peer-left">>,
                        #{
                            <<"peer-id">> => PeerID,
                            <<"reason">> => <<"left">>
                        },
                        Config,
                        Now
                    ),
                    {
                        {ok, #{
                            <<"session-id">> => maps:get(id, Stream1),
                            <<"peer-id">> => PeerID,
                            <<"left">> => true,
                            <<"current-cursor">> => maps:get(cursor, Stream1)
                        }},
                        Stream1
                    }
            end
        end
    ).

signal(Params, Stream, State, Now) ->
    with_peer(
        Params,
        Stream,
        State,
        Now,
        fun(Peer, CurrentStream, Config) ->
            PeerID = maps:get(id, Peer),
            TargetID = maps:get(to_peer_id, Params),
            case maps:get(TargetID, maps:get(peers, CurrentStream), not_found) of
                not_found ->
                    {
                        {error, 404, <<"target-peer-not-found">>, #{}},
                        CurrentStream
                    };
                _Target when TargetID =:= PeerID ->
                    {
                        {error, 400, <<"self-signal-not-allowed">>, #{}},
                        CurrentStream
                    };
                TargetPeer ->
                    signal_new_or_existing(
                        Params,
                        Peer,
                        TargetPeer,
                        CurrentStream,
                        Config,
                        Now
                    )
            end
        end
    ).

signal_new_or_existing(Params, Peer, TargetPeer, Stream, Config, Now) ->
    PeerID = maps:get(id, Peer),
    PeerGeneration = maps:get(generation, Peer),
    RequestID = maps:get(request_id, Params),
    case find_signal(Stream, PeerID, PeerGeneration, RequestID) of
        not_found ->
            Payload = #{
                <<"from-peer-id">> => PeerID,
                <<"from-peer-generation">> => maps:get(generation, Peer),
                <<"to-peer-id">> => maps:get(to_peer_id, Params),
                <<"connection-id">> => maps:get(connection_id, Params),
                <<"kind">> => maps:get(kind, Params),
                <<"content-type">> => maps:get(content_type, Params),
                <<"body">> => maps:get(body, Params)
            },
            Internal = #{
                request_id => RequestID,
                fingerprint => maps:get(fingerprint, Params)
            },
            case append_event(
                Stream,
                <<"signal">>,
                {
                    maps:get(id, TargetPeer),
                    maps:get(generation, TargetPeer)
                },
                Payload,
                Internal,
                Config,
                Now
            ) of
                {ok, Stream1} ->
                    {
                        {ok, #{
                            <<"accepted">> => true,
                            <<"session-id">> => maps:get(id, Stream1),
                            <<"request-id">> => RequestID,
                            <<"cursor">> => maps:get(cursor, Stream1)
                        }},
                        Stream1
                    };
                {error, Reply} ->
                    {Reply, Stream}
            end;
        Event ->
            case maps:get(fingerprint, Event) =:= maps:get(fingerprint, Params) of
                true ->
                    {
                        {ok, #{
                            <<"accepted">> => true,
                            <<"duplicate">> => true,
                            <<"session-id">> => maps:get(id, Stream),
                            <<"request-id">> => RequestID,
                            <<"cursor">> => maps:get(cursor, Event)
                        }},
                        Stream
                    };
                false ->
                    {
                        {error, 409, <<"idempotency-key-reused">>, #{}},
                        Stream
                    }
            end
    end.

events(Params, Stream, State, Now) ->
    with_peer_allow_closed(
        Params,
        Stream,
        State,
        Now,
        fun(Peer, CurrentStream, _Config) ->
            After = maps:get(after_cursor, Params),
            Floor = maps:get(floor_cursor, CurrentStream),
            case After < Floor of
                true ->
                    {
                        {
                            error,
                            410,
                            <<"cursor-expired">>,
                            session_cursor_fields(CurrentStream)
                        },
                        CurrentStream
                    };
                false ->
                    Visible = [
                        Event
                     || Event <- maps:get(events, CurrentStream),
                        maps:get(cursor, Event) > After,
                        event_visible(Event, Peer)
                    ],
                    Limit = maps:get(limit, Params),
                    {Page, HasMore} = take_page(Visible, Limit),
                    NextCursor =
                        case {HasMore, Page} of
                            {true, _} -> maps:get(cursor, lists:last(Page));
                            {false, _} -> maps:get(cursor, CurrentStream)
                        end,
                    Reply = #{
                        <<"session-id">> => maps:get(id, CurrentStream),
                        <<"events">> => [public_event(Event) || Event <- Page],
                        <<"next-cursor">> => NextCursor,
                        <<"oldest-cursor">> => Floor,
                        <<"current-cursor">> => maps:get(cursor, CurrentStream),
                        <<"has-more">> => HasMore
                    },
                    {{ok, Reply}, CurrentStream}
            end
        end
    ).

session(Params, Stream, State, Now) ->
    with_peer_allow_closed(
        Params,
        Stream,
        State,
        Now,
        fun(_Peer, CurrentStream, _Config) ->
            {{ok, session_reply(CurrentStream)}, CurrentStream}
        end
    ).

update(Params, Stream, State, Now) ->
    with_owner(
        Params,
        Stream,
        State,
        Now,
        fun(_Peer, CurrentStream, Config) ->
            Stream0 = CurrentStream#{metadata => maps:get(metadata, Params)},
            {ok, Stream1} = append_control_event(
                Stream0,
                <<"session-updated">>,
                #{},
                Config,
                Now
            ),
            {
                {ok, session_reply(Stream1)},
                Stream1
            }
        end
    ).

record(Params, Stream, State, Now) ->
    with_owner(
        Params,
        Stream,
        State,
        Now,
        fun(_Peer, CurrentStream, Config) ->
            record_segment(Params, CurrentStream, Config, Now)
        end
    ).

record_segment(Params, Stream, Config, Now) ->
    RequestID = maps:get(request_id, Params),
    Fingerprint = maps:get(fingerprint, Params),
    Existing = maps:get(RequestID, maps:get(recording_requests, Stream), not_found),
    case Existing of
        #{fingerprint := Fingerprint, reply := Reply} ->
            {{ok, Reply#{<<"duplicate">> => true}}, Stream};
        #{ } ->
            {
                {error, 409, <<"idempotency-key-reused">>, #{}},
                Stream
            };
        not_found ->
            Index = maps:get(recording_count, Stream) + 1,
            case recording_position(Params, Stream, Index) of
                ok ->
                    SegmentBytes = descriptor_size(maps:get(segment, Params)),
                    case recording_capacity(Stream, Config, SegmentBytes) of
                        ok ->
                            record_segment_at_position(
                                Params,
                                Stream,
                                Config,
                                Now,
                                Index,
                                RequestID,
                                Fingerprint,
                                SegmentBytes
                            );
                        {error, Status, Reason, Extra} ->
                            {{error, Status, Reason, Extra}, Stream}
                    end;
                {error, Extra} ->
                    {
                        {error, 409, <<"recording-position-conflict">>, Extra},
                        Stream
                    }
            end
    end.

record_segment_at_position(
    Params,
    Stream,
    Config,
    Now,
    Index,
    RequestID,
    Fingerprint,
    SegmentBytes
) ->
    StoreOpts = maps:get(store_opts, Params),
    Segment = maps:get(segment, Params),
    case segment_exists(Segment, StoreOpts) of
        ok ->
            Entry = recording_entry(Stream, Segment, Index, RequestID),
            case write_verified(Entry, StoreOpts) of
                {ok, EntryID} ->
                    Stream0 = Stream#{
                        recording_head => EntryID,
                        recording_count => Index,
                        recording_descriptor_bytes =>
                            maps:get(recording_descriptor_bytes, Stream, 0)
                            + SegmentBytes,
                        recording_store_opts => StoreOpts
                    },
                    case persist_replay(Stream0, live, StoreOpts, Now) of
                        {ok, ReplayID} ->
                            Reply = #{
                                <<"session-id">> => maps:get(id, Stream),
                                <<"request-id">> => RequestID,
                                <<"recording-head">> => EntryID,
                                <<"replay-id">> => ReplayID,
                                <<"segment-index">> => Index,
                                <<"segment-count">> => Index
                            },
                            Requests = (maps:get(recording_requests, Stream))#{
                                RequestID => #{
                                    fingerprint => Fingerprint,
                                    reply => Reply
                                }
                            },
                            Stream1 = Stream0#{
                                replay_id => ReplayID,
                                recording_requests => Requests
                            },
                            {ok, Stream2} = append_control_event(
                                Stream1,
                                <<"recording-advanced">>,
                                #{
                                    <<"recording-head">> => EntryID,
                                    <<"replay-id">> => ReplayID,
                                    <<"segment-count">> => Index
                                },
                                Config,
                                Now
                            ),
                            {{ok, Reply}, Stream2};
                        {error, _Reason} ->
                            {
                                {error, 503, <<"recording-store-unavailable">>, #{}},
                                Stream
                            }
                    end;
                {error, _Reason} ->
                    {
                        {error, 503, <<"recording-store-unavailable">>, #{}},
                        Stream
                    }
            end;
        {error, Status, Reason} ->
            {{error, Status, Reason, #{}}, Stream}
    end.

recording_position(Params, Stream, Index) ->
    ExpectedIndex = maps:get(expected_index, Params),
    ExpectedPrevious = maps:get(previous, Params),
    CurrentHead = maps:get(recording_head, Stream),
    case ExpectedIndex =:= Index andalso ExpectedPrevious =:= CurrentHead of
        true ->
            ok;
        false ->
            {error, compact_map(#{
                <<"expected-index">> => Index,
                <<"recording-head">> => CurrentHead,
                <<"segment-count">> => maps:get(recording_count, Stream)
            })}
    end.

recording_capacity(Stream, Config, SegmentBytes) ->
    Count = maps:get(recording_count, Stream),
    DescriptorBytes = maps:get(recording_descriptor_bytes, Stream, 0),
    MaxSegments = maps:get(
        max_recording_segments,
        Config,
        10000
    ),
    MaxDescriptorBytes = maps:get(
        max_recording_descriptor_bytes,
        Config,
        maps:get(max_metadata_bytes, Config, 16384) * MaxSegments
    ),
    case Count >= MaxSegments of
        true ->
            {
                error,
                429,
                <<"recording-segment-capacity">>,
                #{
                    <<"segment-count">> => Count,
                    <<"max-recording-segments">> => MaxSegments
                }
            };
        false when DescriptorBytes + SegmentBytes > MaxDescriptorBytes ->
            {
                error,
                429,
                <<"recording-descriptor-capacity">>,
                #{
                    <<"recording-descriptor-bytes">> => DescriptorBytes,
                    <<"max-recording-descriptor-bytes">> => MaxDescriptorBytes
                }
            };
        false ->
            ok
    end.

descriptor_size(Segment) ->
    byte_size(hb_json:encode(Segment)).

recording_entry(Stream, Segment, Index, RequestID) ->
    maybe_put(
        <<"previous">>,
        maps:get(recording_head, Stream),
        #{
            <<"type">> => <<"hyperstream-recording-segment@1.0">>,
            <<"device">> => <<"hyperstream@1.0">>,
            <<"session-id">> => maps:get(id, Stream),
            <<"publisher">> => maps:get(owner_signer, Stream),
            <<"request-id">> => RequestID,
            <<"index">> => Index,
            <<"segment">> => Segment
        }
    ).

segment_exists(Segment, StoreOpts) ->
    SegmentID = maps:get(<<"id">>, Segment),
    case hb_cache:read(SegmentID, StoreOpts) of
        {ok, _Stored} -> ok;
        {error, not_found} -> {error, 404, <<"segment-not-found">>};
        not_found -> {error, 404, <<"segment-not-found">>};
        {error, _Reason} -> {error, 503, <<"segment-store-unavailable">>}
    end.

close(Params, Stream, State, Now) ->
    with_owner_allow_closed(
        Params,
        Stream,
        State,
        Now,
        fun(_Peer, CurrentStream, Config) ->
            case maps:get(status, CurrentStream) of
                closed ->
                    case maps:get(
                        replay_finalization_pending,
                        CurrentStream,
                        false
                    ) of
                        true ->
                            close_stream(
                                CurrentStream,
                                <<"owner-closed">>,
                                maps:get(store_opts, Params),
                                Config,
                                Now
                            );
                        false ->
                            {
                                {ok, close_reply(CurrentStream)},
                                CurrentStream
                            }
                    end;
                live ->
                    close_stream(
                        CurrentStream,
                        <<"owner-closed">>,
                        maps:get(store_opts, Params),
                        Config,
                        Now
                    )
            end
        end
    ).

close_stream(Stream, Reason, StoreOpts, Config, Now) ->
    Closed0 = latch_closed(Stream, Config, Now),
    case persist_replay(Closed0, closed, StoreOpts, Now) of
        {ok, ReplayID} ->
            Closed1 = Closed0#{
                replay_id => ReplayID,
                replay_finalization_pending => false
            },
            {ok, Closed2} = append_control_event(
                Closed1,
                <<"session-closed">>,
                #{
                    <<"reason">> => Reason,
                    <<"replay-id">> => ReplayID
                },
                Config,
                Now
            ),
            {{ok, close_reply(Closed2)}, Closed2};
        {error, _Reason} ->
            {
                {error, 503, <<"recording-store-unavailable">>, #{}},
                Closed0
            }
    end.

latch_closed(Stream = #{status := closed}, _Config, _Now) ->
    Stream;
latch_closed(Stream, Config, Now) ->
    Stream#{
        status => closed,
        closed_at => maps:get(wall, Now),
        expires_at => maps:get(wall, Now) + maps:get(tombstone_ttl_ms, Config),
        expires_mono => maps:get(mono, Now) + maps:get(tombstone_ttl_ms, Config),
        replay_finalization_pending => maps:get(recording_count, Stream) > 0
    }.

persist_replay(#{recording_count := 0}, _Status, _StoreOpts, _Now) ->
    {ok, not_found};
persist_replay(Stream, Status, StoreOpts, _Now) ->
    write_verified(replay_manifest(Stream, Status), StoreOpts).

replay_manifest(Stream, Status) ->
    Manifest0 = #{
        <<"type">> => <<"hyperstream-replay@1.0">>,
        <<"device">> => <<"hyperstream@1.0">>,
        <<"session-id">> => maps:get(id, Stream),
        <<"publisher">> => maps:get(owner_signer, Stream),
        <<"recording-status">> => atom_to_binary(Status),
        <<"recording-head">> => maps:get(recording_head, Stream),
        <<"segment-count">> => maps:get(recording_count, Stream),
        <<"created-at">> => maps:get(created_at, Stream)
    },
    Manifest1 = maybe_put(
        <<"previous-manifest">>,
        maps:get(replay_id, Stream),
        Manifest0
    ),
    case Status of
        closed -> Manifest1#{<<"closed-at">> => maps:get(closed_at, Stream)};
        live -> Manifest1
    end.

with_session(Params, State = #{sessions := Sessions}, Fun, Now) ->
    SessionID = maps:get(session_id, Params),
    case maps:get(SessionID, Sessions, not_found) of
        not_found ->
            {
                {error, 404, <<"session-not-found">>, #{}},
                State
            };
        Stream ->
            {Reply, Stream1, State1} = Fun(Params, Stream, State, Now),
            Sessions1 = maps:get(sessions, State1),
            {
                Reply,
                State1#{sessions => Sessions1#{SessionID => Stream1}}
            }
    end.

with_peer(Params, Stream, State, Now, Fun) ->
    with_peer_mode(false, Params, Stream, State, Now, Fun).

with_peer_allow_closed(Params, Stream, State, Now, Fun) ->
    with_peer_mode(true, Params, Stream, State, Now, Fun).

with_peer_mode(AllowClosed, Params, Stream, State, Now, Fun) ->
    PeerID = maps:get(peer_id, Params),
    Generation = maps:get(peer_generation, Params),
    Credential = maps:get(credential, Params),
    Status = maps:get(status, Stream),
    case Status =:= closed andalso not AllowClosed of
        true ->
            {
                {error, 410, <<"session-closed">>, session_cursor_fields(Stream)},
                Stream,
                State
            };
        false ->
            AuthResult = case Status of
                closed ->
                    authenticate_closed_peer(Stream, PeerID, Generation, Credential);
                live ->
                    authenticate_peer(Stream, PeerID, Generation, Credential, Now)
            end,
            case AuthResult of
                {ok, Peer} ->
                    {Reply, Stream1} = Fun(Peer, Stream, maps:get(config, State)),
                    {Reply, Stream1, State};
                {error, ErrorStatus, Reason} ->
                    {{error, ErrorStatus, Reason, #{}}, Stream, State}
            end
    end.

with_owner(Params, Stream, State, Now, Fun) ->
    with_peer(
        Params,
        Stream,
        State,
        Now,
        fun(Peer, CurrentStream, Config) ->
            case maps:get(id, Peer) =:= maps:get(owner_peer_id, CurrentStream) of
                true -> Fun(Peer, CurrentStream, Config);
                false ->
                    {
                        {error, 403, <<"owner-required">>, #{}},
                        CurrentStream
                    }
            end
        end
    ).

with_owner_allow_closed(Params, Stream, State, Now, Fun) ->
    with_peer_allow_closed(
        Params,
        Stream,
        State,
        Now,
        fun(Peer, CurrentStream, Config) ->
            case maps:get(id, Peer) =:= maps:get(owner_peer_id, CurrentStream) of
                true -> Fun(Peer, CurrentStream, Config);
                false ->
                    {
                        {error, 403, <<"owner-required">>, #{}},
                        CurrentStream
                    }
            end
        end
    ).

authenticate_peer(Stream, PeerID, Generation, Credential, Now) ->
    case maps:get(PeerID, maps:get(peers, Stream), not_found) of
        not_found ->
            {error, 404, <<"peer-not-found">>};
        Peer ->
            case {
                maps:get(generation, Peer) =:= Generation,
                maps:get(expires_mono, Peer) > maps:get(mono, Now),
                credential_matches(Peer, Credential)
            } of
                {false, _, _} -> {error, 409, <<"stale-peer-generation">>};
                {_, false, _} -> {error, 410, <<"peer-expired">>};
                {_, _, false} -> {error, 401, <<"invalid-peer-credential">>};
                {true, true, true} -> {ok, Peer}
            end
    end.

authenticate_closed_peer(Stream, PeerID, Generation, Credential) ->
    case maps:get(PeerID, maps:get(peers, Stream), not_found) of
        not_found ->
            {error, 404, <<"peer-not-found">>};
        Peer ->
            case {
                maps:get(generation, Peer) =:= Generation,
                credential_matches(Peer, Credential)
            } of
                {false, _} -> {error, 409, <<"stale-peer-generation">>};
                {_, false} -> {error, 401, <<"invalid-peer-credential">>};
                {true, true} -> {ok, Peer}
            end
    end.

credential_matches(Peer, Credential) ->
    Signer = maps:get(signer, Credential),
    TokenHash = maps:get(token_hash, Credential),
    SignerMatch =
        Signer =/= not_found
        andalso Signer =:= maps:get(signer, Peer),
    TokenMatch =
        TokenHash =/= not_found
        andalso hash_matches(TokenHash, maps:get(token_hash, Peer)),
    SignerMatch orelse TokenMatch.

can_join(Params, Stream) ->
    case maps:get(access, Stream) of
        open ->
            true;
        restricted ->
            Signer = maps:get(signer, Params),
            JoinTokenHash = maps:get(join_token_hash, Params),
            (Signer =/= not_found andalso Signer =:= maps:get(owner_signer, Stream))
            orelse
                (
                    JoinTokenHash =/= not_found
                    andalso hash_matches(
                        JoinTokenHash,
                        maps:get(join_token_hash, Stream)
                    )
                )
    end.

hash_matches(Left, Right)
        when is_binary(Left), is_binary(Right), byte_size(Left) =:= byte_size(Right) ->
    crypto:hash_equals(Left, Right);
hash_matches(_Left, _Right) ->
    false.

new_peer(PeerID, Generation, Params, Config, Now) ->
    #{
        id => PeerID,
        generation => Generation,
        signer => maps:get(signer, Params),
        token_hash => maps:get(peer_token_hash, Params),
        metadata => maps:get(metadata, Params),
        joined_at => maps:get(wall, Now),
        expires_at => maps:get(wall, Now) + maps:get(peer_ttl_ms, Config),
        expires_mono => maps:get(mono, Now) + maps:get(peer_ttl_ms, Config),
        ack_cursor => 0,
        join_request_id => maps:get(request_id, Params),
        join_fingerprint => maps:get(fingerprint, Params)
    }.

refresh_peer(Peer, Config, Now) ->
    Peer#{
        expires_at => maps:get(wall, Now) + maps:get(peer_ttl_ms, Config),
        expires_mono => maps:get(mono, Now) + maps:get(peer_ttl_ms, Config)
    }.

put_peer(Stream, Peer) ->
    PeerID = maps:get(id, Peer),
    Stream#{peers => (maps:get(peers, Stream))#{PeerID => Peer}}.

set_peer_ack(Stream, PeerID, Cursor) ->
    Peer = maps:get(PeerID, maps:get(peers, Stream)),
    put_peer(Stream, Peer#{ack_cursor => Cursor}).

append_event(Stream, Type, Target, Payload, Config, Now) ->
    append_event(Stream, Type, Target, Payload, #{}, Config, Now).

append_event(Stream, Type, Target, Payload, Internal, Config, Now) ->
    Cursor = maps:get(cursor, Stream) + 1,
    Event0 = maps:merge(
        Internal,
        #{
            cursor => Cursor,
            type => Type,
            target => Target,
            payload => Payload,
            created_at => maps:get(wall, Now),
            expires_mono =>
                maps:get(mono, Now) + maps:get(event_ttl_ms, Config)
        }
    ),
    EventSize = event_storage_size(Event0),
    MaxEvents = maps:get(max_events, Config),
    MaxBytes = maps:get(max_event_bytes, Config),
    case
        length(maps:get(events, Stream)) >= MaxEvents
        orelse maps:get(event_bytes, Stream) + EventSize > MaxBytes
    of
        true ->
            {error,
                {error, 429, <<"event-buffer-full">>, #{<<"retry-after">> => 1}}};
        false ->
            Event = Event0#{encoded_size => EventSize},
            {ok, Stream#{
                cursor => Cursor,
                events => maps:get(events, Stream) ++ [Event],
                event_bytes => maps:get(event_bytes, Stream) + EventSize
            }}
    end.

append_control_event(Stream, Type, Payload, Config, Now) ->
    case append_event(Stream, Type, all, Payload, Config, Now) of
        {ok, Stream1} ->
            {ok, Stream1};
        {error, Reply} ->
            case maps:get(events, Stream) of
                [Dropped | Rest] ->
                    Stream0 = Stream#{
                        events => Rest,
                        event_bytes =>
                            maps:get(event_bytes, Stream) - maps:get(encoded_size, Dropped),
                        floor_cursor => maps:get(cursor, Dropped)
                    },
                    append_control_event(Stream0, Type, Payload, Config, Now);
                [] ->
                    {error, Reply}
            end
    end.

find_signal(Stream, PeerID, PeerGeneration, RequestID) ->
    case [
        Event
     || Event <- maps:get(events, Stream),
        maps:get(type, Event) =:= <<"signal">>,
        maps:get(request_id, Event, not_found) =:= RequestID,
        maps:get(<<"from-peer-id">>, maps:get(payload, Event)) =:= PeerID,
        maps:get(
            <<"from-peer-generation">>,
            maps:get(payload, Event),
            not_found
        ) =:= PeerGeneration
    ] of
        [Event | _] -> Event;
        [] -> not_found
    end.

event_visible(Event, Peer) ->
    PeerID = maps:get(id, Peer),
    Generation = maps:get(generation, Peer),
    case maps:get(target, Event) of
        all -> true;
        {PeerID, Generation} -> true;
        _ -> false
    end.

take_page(Events, Limit) when length(Events) > Limit ->
    {lists:sublist(Events, Limit), true};
take_page(Events, _Limit) ->
    {Events, false}.

public_event(Event) ->
    maps:merge(
        maps:get(payload, Event),
        #{
            <<"cursor">> => maps:get(cursor, Event),
            <<"type">> => maps:get(type, Event),
            <<"created-at">> => maps:get(created_at, Event)
        }
    ).

public_peer(Peer) ->
    #{
        <<"peer-id">> => maps:get(id, Peer),
        <<"peer-generation">> => maps:get(generation, Peer),
        <<"metadata">> => maps:get(metadata, Peer),
        <<"joined-at">> => maps:get(joined_at, Peer),
        <<"expires-at">> => maps:get(expires_at, Peer)
    }.

create_reply(Stream, Peer) ->
    maps:merge(
        session_reply(Stream),
        peer_fields(Peer)
    ).

join_reply(Stream, Peer) ->
    maps:merge(
        session_reply(Stream),
        peer_fields(Peer)
    ).

peer_reply(Stream, Peer) ->
    maps:merge(
        #{
            <<"session-id">> => maps:get(id, Stream),
            <<"current-cursor">> => maps:get(cursor, Stream)
        },
        peer_fields(Peer)
    ).

peer_fields(Peer) ->
    #{
        <<"peer-id">> => maps:get(id, Peer),
        <<"peer-generation">> => maps:get(generation, Peer),
        <<"peer-expires-at">> => maps:get(expires_at, Peer)
    }.

session_reply(Stream) ->
    maps:merge(
        #{
            <<"session-id">> => maps:get(id, Stream),
            <<"session-status">> => atom_to_binary(maps:get(status, Stream)),
            <<"access">> => atom_to_binary(maps:get(access, Stream)),
            <<"metadata">> => maps:get(metadata, Stream),
            <<"created-at">> => maps:get(created_at, Stream),
            <<"expires-at">> => maps:get(expires_at, Stream),
            <<"peers">> => [
                public_peer(Peer)
             || {_PeerID, Peer} <- lists:sort(maps:to_list(maps:get(peers, Stream)))
            ],
            <<"recording-head">> => maps:get(recording_head, Stream),
            <<"segment-count">> => maps:get(recording_count, Stream),
            <<"replay-id">> => maps:get(replay_id, Stream)
        },
        session_cursor_fields(Stream)
    ).

close_reply(Stream) ->
    #{
        <<"session-id">> => maps:get(id, Stream),
        <<"session-status">> => <<"closed">>,
        <<"closed-at">> => maps:get(closed_at, Stream),
        <<"recording-head">> => maps:get(recording_head, Stream),
        <<"segment-count">> => maps:get(recording_count, Stream),
        <<"replay-id">> => maps:get(replay_id, Stream),
        <<"current-cursor">> => maps:get(cursor, Stream)
    }.

session_cursor_fields(Stream) ->
    #{
        <<"oldest-cursor">> => maps:get(floor_cursor, Stream),
        <<"current-cursor">> => maps:get(cursor, Stream)
    }.

prune(State = #{sessions := Sessions, config := Config}, Now) ->
    Sessions1 = maps:fold(
        fun(SessionID, Stream, Acc) ->
            case prune_stream(Stream, Config, Now) of
                remove -> Acc;
                Stream1 -> Acc#{SessionID => Stream1}
            end
        end,
        #{},
        Sessions
    ),
    State#{sessions => Sessions1}.

safe_prune(State, Now) ->
    try prune(State, Now)
    catch
        _:_ -> State
    end.

prune_stream(Stream = #{status := closed}, Config, Now) ->
    Stream1 = retry_pending_replay(Stream, Config, Now),
    case maps:get(expires_mono, Stream1) =< maps:get(mono, Now) of
        true -> remove;
        false -> prune_events(Stream1, Now)
    end;
prune_stream(Stream, Config, Now) ->
    OwnerPeerID = maps:get(owner_peer_id, Stream),
    Peers0 = maps:get(peers, Stream),
    Expired = [
        Peer
     || {_PeerID, Peer} <- maps:to_list(Peers0),
        maps:get(expires_mono, Peer) =< maps:get(mono, Now)
    ],
    Peers1 = lists:foldl(
        fun(Peer, Acc) -> maps:remove(maps:get(id, Peer), Acc) end,
        Peers0,
        Expired
    ),
    Stream0 = Stream#{peers => Peers1},
    Stream1 = lists:foldl(
        fun(Peer, Acc) ->
            {ok, Next} = append_control_event(
                Acc,
                <<"peer-left">>,
                #{
                    <<"peer-id">> => maps:get(id, Peer),
                    <<"reason">> => <<"expired">>
                },
                Config,
                Now
            ),
            Next
        end,
        Stream0,
        Expired
    ),
    OwnerExpired = lists:any(
        fun(Peer) -> maps:get(id, Peer) =:= OwnerPeerID end,
        Expired
    ),
    SessionExpired = maps:get(expires_mono, Stream1) =< maps:get(mono, Now),
    case OwnerExpired orelse SessionExpired of
        true ->
            {_Reply, Closed} = close_stream(
                Stream1,
                <<"expired">>,
                maps:get(recording_store_opts, Stream1, #{}),
                Config,
                Now
            ),
            prune_events(Closed, Now);
        false ->
            prune_events(Stream1, Now)
    end.

retry_pending_replay(Stream, Config, Now) ->
    case maps:get(replay_finalization_pending, Stream, false) of
        true ->
            {_Reply, Stream1} = close_stream(
                Stream,
                <<"expired">>,
                maps:get(recording_store_opts, Stream, #{}),
                Config,
                Now
            ),
            Stream1;
        false ->
            Stream
    end.

prune_events(Stream, Now) ->
    Events = maps:get(events, Stream),
    {Removed, Kept} = lists:splitwith(
        fun(Event) ->
            maps:get(expires_mono, Event) =< maps:get(mono, Now)
        end,
        Events
    ),
    RemovedBytes = lists:sum([maps:get(encoded_size, Event) || Event <- Removed]),
    Floor = case Removed of
        [] -> maps:get(floor_cursor, Stream);
        _ -> maps:get(cursor, lists:last(Removed))
    end,
    Stream#{
        events => Kept,
        event_bytes => maps:get(event_bytes, Stream) - RemovedBytes,
        floor_cursor => Floor
    }.

maybe_put(_Key, not_found, Map) ->
    Map;
maybe_put(Key, Value, Map) ->
    Map#{Key => Value}.

compact_map(Map) ->
    maps:filter(
        fun(_Key, Value) -> Value =/= not_found end,
        Map
    ).

event_storage_size(Event) ->
    byte_size(
        term_to_binary(
            maps:without([encoded_size, expires_mono], Event),
            [deterministic]
        )
    ).

write_verified(Value, Opts) ->
    try
        case hb_cache:write(Value, Opts) of
            {ok, ID} ->
                case hb_cache:read(ID, Opts) of
                    {ok, Stored} ->
                        case hb_message:match(Value, Stored, strict, Opts) of
                            true -> {ok, ID};
                            _ -> {error, store_verification_failed}
                        end;
                    _ ->
                        {error, store_read_after_write_failed}
                end;
            Error ->
                Error
        end
    catch
        Class:Reason ->
            {error, {Class, Reason}}
    end.

current_time() ->
    #{
        mono => erlang:monotonic_time(millisecond),
        wall => erlang:system_time(millisecond)
    }.

-ifdef(TEST).

control_event_evicts_until_within_byte_cap_test() ->
    Small = #{},
    Large = #{<<"body">> => binary:copy(<<"x">>, 40)},
    Medium = #{<<"body">> => binary:copy(<<"y">>, 20)},
    Config0 = #{
        max_events => 8,
        max_event_bytes => 100000,
        event_ttl_ms => 60000
    },
    Now = current_time(),
    Stream0 = #{
        cursor => 0,
        floor_cursor => 0,
        events => [],
        event_bytes => 0
    },
    {ok, Stream1} = append_event(
        Stream0,
        <<"small">>,
        all,
        Small,
        Config0,
        Now
    ),
    {ok, Stream2} = append_event(
        Stream1,
        <<"large">>,
        all,
        Large,
        Config0,
        Now
    ),
    {ok, Stream3} = append_event(
        Stream2,
        <<"medium">>,
        all,
        Medium,
        Config0,
        Now
    ),
    Control = maps:merge(
        #{},
        #{
            cursor => maps:get(cursor, Stream3) + 1,
            type => <<"peer-left">>,
            target => all,
            payload => Large,
            created_at => maps:get(wall, Now),
            expires_mono =>
                maps:get(mono, Now) + maps:get(event_ttl_ms, Config0)
        }
    ),
    [_, _, LastEvent] = maps:get(events, Stream3),
    MaxBytes =
        maps:get(encoded_size, LastEvent)
        + event_storage_size(Control),
    Config = Config0#{max_event_bytes => MaxBytes},
    {ok, Stream4} = append_control_event(
        Stream3,
        <<"peer-left">>,
        Large,
        Config,
        Now
    ),
    ?assertEqual(2, maps:get(floor_cursor, Stream4)),
    ?assert(maps:get(event_bytes, Stream4) =< MaxBytes),
    ?assertEqual(
        <<"peer-left">>,
        maps:get(type, lists:last(maps:get(events, Stream4)))
    ).

recording_capacity_is_hard_test() ->
    Config = #{
        max_recording_segments => 2,
        max_recording_descriptor_bytes => 100
    },
    ?assertEqual(
        ok,
        recording_capacity(
            #{recording_count => 1, recording_descriptor_bytes => 40},
            Config,
            60
        )
    ),
    ?assertMatch(
        {error, 429, <<"recording-segment-capacity">>, _},
        recording_capacity(
            #{recording_count => 2, recording_descriptor_bytes => 40},
            Config,
            1
        )
    ),
    ?assertMatch(
        {error, 429, <<"recording-descriptor-capacity">>, _},
        recording_capacity(
            #{recording_count => 1, recording_descriptor_bytes => 40},
            Config,
            61
        )
    ).

recording_payloads_are_deterministic_test() ->
    Segment = #{
        <<"id">> => binary:copy(<<"A">>, 43),
        <<"duration-ms">> => 2000
    },
    Stream = #{
        id => <<"stream-1">>,
        owner_signer => binary:copy(<<"B">>, 43),
        recording_head => not_found,
        recording_count => 1,
        replay_id => not_found,
        created_at => 100,
        closed_at => 200
    },
    Entry = recording_entry(Stream, Segment, 1, <<"record-1">>),
    ?assertEqual(Entry, recording_entry(Stream, Segment, 1, <<"record-1">>)),
    ?assertNot(maps:is_key(<<"created-at">>, Entry)),
    Live = replay_manifest(Stream, live),
    ?assertEqual(Live, replay_manifest(Stream, live)),
    ?assertNot(maps:is_key(<<"updated-at">>, Live)),
    Closed = replay_manifest(Stream, closed),
    ?assertEqual(200, maps:get(<<"closed-at">>, Closed)).

failed_close_latches_deterministic_state_test() ->
    Head = binary:copy(<<"C">>, 43),
    Stream = #{
        id => <<"stream-1">>,
        owner_signer => binary:copy(<<"D">>, 43),
        status => live,
        recording_head => Head,
        recording_count => 1,
        replay_id => not_found,
        created_at => 100,
        closed_at => not_found,
        cursor => 0,
        floor_cursor => 0,
        events => [],
        event_bytes => 0
    },
    Config = #{
        tombstone_ttl_ms => 5000,
        event_ttl_ms => 60000,
        max_events => 8,
        max_event_bytes => 100000
    },
    FirstNow = #{wall => 200, mono => 300},
    {
        {error, 503, <<"recording-store-unavailable">>, #{}},
        Pending
    } = close_stream(
        Stream,
        <<"owner-closed">>,
        #{<<"store">> => []},
        Config,
        FirstNow
    ),
    ?assertEqual(closed, maps:get(status, Pending)),
    ?assertEqual(200, maps:get(closed_at, Pending)),
    ?assertEqual(true, maps:get(replay_finalization_pending, Pending)),
    ExpectedManifest = replay_manifest(Pending, closed),
    Store = hb_test_utils:test_store(),
    StoreOpts = #{<<"store">> => [Store]},
    SecondNow = #{wall => 400, mono => 500},
    {{ok, _Reply}, Closed} = close_stream(
        Pending,
        <<"owner-closed">>,
        StoreOpts,
        Config,
        SecondNow
    ),
    ?assertEqual(200, maps:get(closed_at, Closed)),
    ?assertEqual(false, maps:get(replay_finalization_pending, Closed)),
    {ok, StoredManifest} = hb_cache:read(maps:get(replay_id, Closed), StoreOpts),
    ?assert(hb_message:match(ExpectedManifest, StoredManifest, strict, StoreOpts)).

-endif.
