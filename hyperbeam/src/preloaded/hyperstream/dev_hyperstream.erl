%%% @doc Generic live-stream coordination for HyperBEAM and AO applications.
%%%
%%% The device manages ephemeral sessions, peer leases, targeted opaque
%%% signaling envelopes, ordered cursor polling, source metadata, and immutable
%%% recording-manifest links. It does not interpret WebRTC, relay media, or
%%% contain application-specific channel, claim, moderation, or ranking logic.
-module(dev_hyperstream).
-implements(<<"hyperstream@1.0">>).
-export([
    info/1,
    transport_key/3,
    create/3,
    join/3,
    heartbeat/3,
    leave/3,
    signal/3,
    events/3,
    session/3,
    update/3,
    record/3,
    close/3
]).
-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").
-endif.

-define(DEVICE, <<"hyperstream@1.0">>).
-define(DEFAULT_PEER_TTL_MS, 45000).
-define(DEFAULT_SESSION_TTL_MS, 120000).
-define(DEFAULT_EVENT_TTL_MS, 120000).
-define(DEFAULT_TOMBSTONE_TTL_MS, 300000).
-define(DEFAULT_MAX_SESSIONS, 1000).
-define(DEFAULT_MAX_PEERS, 1024).
-define(DEFAULT_MAX_EVENTS, 4096).
-define(DEFAULT_MAX_EVENT_BYTES, 8388608).
-define(DEFAULT_MAX_SIGNAL_BYTES, 262144).
-define(DEFAULT_MAX_METADATA_BYTES, 16384).
-define(DEFAULT_MAX_READ_EVENTS, 100).
-define(DEFAULT_MAX_RECORDING_SEGMENTS, 10000).
-define(DEFAULT_MAX_RECORDING_DESCRIPTOR_BYTES, 67108864).
-define(DEFAULT_MAX_PENDING_CALLS, 128).
-define(MAX_ID_BYTES, 128).
-define(MIN_TOKEN_BYTES, 16).
-define(MAX_TOKEN_BYTES, 512).
-define(MAX_REQUEST_DEPTH, 32).

info(_Opts) ->
    #{
        exports => [
            <<"transport-key">>,
            <<"create">>,
            <<"join">>,
            <<"heartbeat">>,
            <<"leave">>,
            <<"signal">>,
            <<"events">>,
            <<"session">>,
            <<"update">>,
            <<"record">>,
            <<"close">>
        ]
    }.

transport_key(_Base, Req, Opts) ->
    case request_method(Req) of
        ok ->
            case canonical_request(Req, Opts, transport_key) of
                {ok, _CanonicalReq, _Signer} ->
                    public_response(
                        200,
                        dev_hyperstream_transport:key_info(),
                        Opts
                    );
                {error, Status, Reason} ->
                    public_error_response(Status, Reason, Opts)
            end;
        error ->
            public_error_response(405, <<"method-not-allowed">>, Opts)
    end.

create(Base, Req, Opts) ->
    execute(
        Base,
        Req,
        Opts,
        fun(Data, Signer, Config) -> create_params(Data, Signer, Config, Opts) end,
        create,
        201
    ).

join(Base, Req, Opts) ->
    execute(
        Base,
        Req,
        Opts,
        fun(Data, Signer, Config) -> join_params(Data, Signer, Config, Opts) end,
        join,
        201
    ).

heartbeat(Base, Req, Opts) ->
    execute(
        Base,
        Req,
        Opts,
        fun(Data, Signer, _Config) ->
            with_member_params(
                Data,
                Signer,
                fun(Params) ->
                    case non_negative_integer(Data, <<"ack-cursor">>, 0) of
                        {ok, AckCursor} ->
                            {ok, Params#{ack_cursor => AckCursor}};
                        Error ->
                            Error
                    end
                end
            )
        end,
        heartbeat,
        200
    ).

leave(Base, Req, Opts) ->
    execute(
        Base,
        Req,
        Opts,
        fun(Data, Signer, _Config) ->
            with_member_params(
                Data,
                Signer,
                fun(Params) -> {ok, Params#{store_opts => Opts}} end
            )
        end,
        leave,
        200
    ).

signal(Base, Req, Opts) ->
    execute(
        Base,
        Req,
        Opts,
        fun(Data, Signer, Config) -> signal_params(Data, Signer, Config, Opts) end,
        signal,
        202
    ).

events(Base, Req, Opts) ->
    execute(
        Base,
        Req,
        Opts,
        fun(Data, Signer, Config) ->
            with_member_params(
                Data,
                Signer,
                fun(Params) ->
                    maybe
                        {ok, After} ?= non_negative_integer(Data, <<"after">>, 0),
                        {ok, RequestedLimit} ?= positive_integer(
                            Data,
                            <<"limit">>,
                            50
                        ),
                        Limit = min(RequestedLimit, maps:get(max_read_events, Config)),
                        {ok, Params#{
                            after_cursor => After,
                            limit => Limit
                        }}
                    end
                end
            )
        end,
        events,
        200
    ).

session(Base, Req, Opts) ->
    execute(
        Base,
        Req,
        Opts,
        fun(Data, Signer, _Config) ->
            with_member_params(Data, Signer, fun(Params) -> {ok, Params} end)
        end,
        session,
        200
    ).

update(Base, Req, Opts) ->
    execute(
        Base,
        Req,
        Opts,
        fun(Data, Signer, Config) ->
            with_member_params(
                Data,
                Signer,
                fun(Params) ->
                    case metadata(Data, Config, Opts) of
                        {ok, Metadata} -> {ok, Params#{metadata => Metadata}};
                        Error -> Error
                    end
                end
            )
        end,
        update,
        200
    ).

record(Base, Req, Opts) ->
    execute(
        Base,
        Req,
        Opts,
        fun(Data, Signer, Config) ->
            with_member_params(
                Data,
                Signer,
                fun(Params) ->
                    case Signer of
                        not_found ->
                            {error, 401, <<"signed-record-required">>};
                        _ ->
                            case recording_signer_allowed(Signer, Config) of
                                true ->
                                    record_params(Data, Params, Config, Opts);
                                false ->
                                    {
                                        error,
                                        403,
                                        <<"recording-signer-not-allowed">>
                                    }
                            end
                    end
                end
            )
        end,
        record,
        201
    ).

close(Base, Req, Opts) ->
    execute(
        Base,
        Req,
        Opts,
        fun(Data, Signer, _Config) ->
            with_member_params(
                Data,
                Signer,
                fun(Params) -> {ok, Params#{store_opts => Opts}} end
            )
        end,
        close,
        200
    ).

execute(Base, Req, Opts, ParamsFun, Operation, SuccessStatus) ->
    case request_method(Req) of
        ok ->
            execute_authorized(
                Base,
                Req,
                Opts,
                ParamsFun,
                Operation,
                SuccessStatus
            );
        error ->
            public_error_response(
                405,
                <<"method-not-allowed">>,
                Opts,
                #{<<"allow">> => <<"POST">>}
            )
    end.

execute_authorized(Base, Req, Opts, ParamsFun, Operation, SuccessStatus) ->
    case canonical_request(Req, Opts, Operation) of
        {ok, CanonicalReq, Signer} ->
            Config = config(Base, Opts),
            MaxRequestBytes = max_request_bytes(Operation, Config),
            case request_data(
                CanonicalReq,
                Operation,
                Opts,
                MaxRequestBytes
            ) of
                {ok, Data, Transport} ->
                    case ParamsFun(Data, Signer, Config) of
                        {ok, Params0} ->
                            Params = Params0#{
                                fingerprint => fingerprint(Operation, Params0)
                            },
                            Namespace = maps:get(namespace, Config),
                            Reply = dev_hyperstream_coordinator:call(
                                Namespace,
                                maps:remove(namespace, Config),
                                {Operation, Params}
                            ),
                            response(
                                Reply,
                                SuccessStatus,
                                Params,
                                Operation,
                                Transport,
                                Opts
                            );
                        {error, Status, Reason} ->
                            response(
                                {error, Status, Reason, #{}},
                                SuccessStatus,
                                #{},
                                Operation,
                                Transport,
                                Opts
                            )
                    end;
                {error, Status, Reason} ->
                    public_error_response(Status, Reason, Opts)
            end;
        {error, Status, Reason} ->
            public_error_response(Status, Reason, Opts)
    end.

request_method(Req) when is_map(Req) ->
    case maps:get(<<"method">>, Req, not_found) of
        not_found -> ok;
        <<"POST">> -> ok;
        _ -> error
    end;
request_method(_Req) ->
    error.

create_params(Data, Signer, Config, Opts) ->
    maybe
        {ok, RequestID} ?= required_id(Data, <<"request-id">>),
        {ok, PeerID} ?= required_id(Data, <<"peer-id">>),
        {ok, Access} ?= access(Data),
        {ok, Metadata} ?= metadata(Data, Config, Opts),
        {ok, _PeerToken, PeerTokenHash} ?= issue_peer_token(Data, Signer),
        {ok, SessionID} ?= optional_id(
            Data,
            <<"session-id">>,
            derived_session_id(RequestID, PeerID, Signer, PeerTokenHash)
        ),
        {ok, JoinTokenHash} ?= create_join_token_hash(Data, Signer),
        {ok, #{
            request_id => RequestID,
            peer_id => PeerID,
            session_id => SessionID,
            access => Access,
            metadata => Metadata,
            signer => Signer,
            peer_token_hash => PeerTokenHash,
            join_token_hash => JoinTokenHash,
            credential => credential(Signer, PeerTokenHash)
        }}
    end.

join_params(Data, Signer, Config, Opts) ->
    maybe
        {ok, RequestID} ?= required_id(Data, <<"request-id">>),
        {ok, PeerID} ?= required_id(Data, <<"peer-id">>),
        {ok, SessionID} ?= required_id(Data, <<"session-id">>),
        {ok, Metadata} ?= metadata(Data, Config, Opts),
        {ok, _PeerToken, PeerTokenHash} ?= issue_peer_token(Data, Signer),
        {ok, JoinTokenHash} ?= join_token_hash(Data, Signer),
        {ok, #{
            request_id => RequestID,
            peer_id => PeerID,
            session_id => SessionID,
            metadata => Metadata,
            signer => Signer,
            peer_token_hash => PeerTokenHash,
            join_token_hash => JoinTokenHash,
            credential => credential(Signer, PeerTokenHash)
        }}
    end.

signal_params(Data, Signer, Config, Opts) ->
    with_member_params(
        Data,
        Signer,
        fun(Params) ->
            maybe
                {ok, RequestID} ?= required_id(Data, <<"request-id">>),
                {ok, TargetPeerID} ?= required_id(Data, <<"to-peer-id">>),
                {ok, ConnectionID} ?= required_id(Data, <<"connection-id">>),
                {ok, Kind} ?= optional_id(Data, <<"kind">>, <<"signal">>),
                {ok, ContentType} ?= optional_id(
                    Data,
                    <<"content-type">>,
                    <<"application/json">>
                ),
                {ok, Body} ?= required_value(
                    Data,
                    <<"body">>,
                    maps:get(max_signal_bytes, Config),
                    <<"signal-too-large">>,
                    Opts
                ),
                ok ?= bounded_value(
                    Body,
                    maps:get(max_signal_bytes, Config),
                    <<"signal-too-large">>
                ),
                {ok, Params#{
                    request_id => RequestID,
                    to_peer_id => TargetPeerID,
                    connection_id => ConnectionID,
                    kind => Kind,
                    content_type => ContentType,
                    body => Body
                }}
            end
        end
    ).

record_params(Data, Params, Config, Opts) ->
    maybe
        {ok, RequestID} ?= required_id(Data, <<"request-id">>),
        {ok, ExpectedIndex} ?= positive_integer(
            Data,
            <<"expected-index">>,
            missing
        ),
        {ok, Previous} ?= optional_locator(Data, <<"previous">>),
        {ok, Segment} ?= required_value(
            Data,
            <<"segment">>,
            maps:get(max_metadata_bytes, Config),
            <<"segment-descriptor-too-large">>,
            Opts
        ),
        ok ?= valid_segment(Segment),
        ok ?= bounded_value(
            Segment,
            maps:get(max_metadata_bytes, Config),
            <<"segment-descriptor-too-large">>
        ),
        {ok, Params#{
            request_id => RequestID,
            expected_index => ExpectedIndex,
            previous => Previous,
            segment => Segment,
            store_opts => Opts
        }}
    end.

with_member_params(Data, Signer, Fun) ->
    maybe
        {ok, SessionID} ?= required_id(Data, <<"session-id">>),
        {ok, PeerID} ?= required_id(Data, <<"peer-id">>),
        {ok, Generation} ?= positive_integer(Data, <<"peer-generation">>, missing),
        {ok, TokenHash} ?= member_token_hash(Data, Signer),
        ok ?= require_credential(Signer, TokenHash),
        Fun(#{
            session_id => SessionID,
            peer_id => PeerID,
            peer_generation => Generation,
            credential => credential(Signer, TokenHash)
        })
    end.

canonical_request(Req, Opts, Operation) when is_map(Req) ->
    case request_has_link(Req) of
        true ->
            {error, 400, <<"linked-request-value">>};
        false ->
            Signers = hb_message:signers(Req, Opts),
            case Signers of
                [] ->
                    {ok, Req, not_found};
                [Signer] ->
                    case request_has_structured_value(Req) of
                        true ->
                            {
                                error,
                                400,
                                <<"signed-structured-value-not-allowed">>
                            };
                        false ->
                            case hb_message:verify(Req, signers, Opts) of
                                true ->
                                    case
                                        hb_message:with_only_committed(
                                            Req,
                                            Opts
                                        )
                                    of
                                        {ok, Canonical} ->
                                            case signed_route(
                                                Canonical,
                                                Operation
                                            ) of
                                                ok ->
                                                    {ok, Canonical, Signer};
                                                error ->
                                                    {
                                                        error,
                                                        400,
                                                        <<"signed-route-mismatch">>
                                                    }
                                            end;
                                        _ ->
                                            {
                                                error,
                                                401,
                                                <<"invalid-commitment">>
                                            }
                                    end;
                                _ ->
                                    {error, 401, <<"invalid-signature">>}
                            end
                    end;
                _ ->
                    {error, 401, <<"ambiguous-signer">>}
            end
    end;
canonical_request(_Req, _Opts, _Operation) ->
    {error, 400, <<"invalid-request">>}.

signed_route(Req, Operation) ->
    OperationPath = operation_path(Operation),
    case {
        maps:get(<<"device">>, Req, not_found),
        maps:get(<<"path">>, Req, not_found)
    } of
        {?DEVICE, OperationPath} ->
            ok;
        _ ->
            error
    end.

request_has_link({link, _ID, _LinkOpts}) ->
    true;
request_has_link(Value) when is_map(Value) ->
    maps:fold(
        fun
            (<<"commitments">>, _Child, Found) -> Found;
            (<<"priv">>, _Child, Found) -> Found;
            (<<"ao-types">>, _Child, Found) -> Found;
            (Key, Child, Found) ->
                Found
                orelse hb_link:is_link_key(Key)
                orelse request_has_link(Child)
        end,
        false,
        Value
    );
request_has_link(Value) when is_list(Value) ->
    lists:any(fun request_has_link/1, Value);
request_has_link(_Value) ->
    false.

request_has_structured_value(Value) ->
    maps:fold(
        fun
            (<<"commitments">>, _Child, Found) -> Found;
            (<<"priv">>, _Child, Found) -> Found;
            (<<"ao-types">>, _Child, Found) -> Found;
            (_Key, Child, Found) ->
                Found orelse is_map(Child) orelse is_list(Child)
        end,
        false,
        Value
    ).

request_data(Req, Operation, Opts, MaxBytes) ->
    case http_request(Opts) of
        true ->
            encrypted_request_data(Req, Operation, MaxBytes);
        false ->
            direct_request_data(Req, Opts, MaxBytes)
    end.

encrypted_request_data(Req, Operation, MaxBytes) ->
    case maps:get(<<"body">>, Req, not_found) of
        Body when is_binary(Body) ->
            case byte_size(Body) =< max_envelope_bytes(MaxBytes) of
                false ->
                    {error, 413, <<"request-body-too-large">>};
                true ->
                    case dev_hyperstream_transport:open(
                        operation_path(Operation),
                        Body
                    ) of
                        {ok, Plaintext, Transport} when
                                byte_size(Plaintext) =< MaxBytes ->
                            case decode_map(Plaintext) of
                                {ok, Data} -> {ok, Data, Transport};
                                error -> {error, 400, <<"invalid-body">>}
                            end;
                        {ok, _Plaintext, _Transport} ->
                            {error, 413, <<"request-body-too-large">>};
                        {error, envelope_too_large} ->
                            {error, 413, <<"request-body-too-large">>};
                        {error, _Reason} ->
                            {
                                error,
                                400,
                                <<"invalid-transport-envelope">>
                            }
                    end
            end;
        _ ->
            {error, 400, <<"encrypted-body-required">>}
    end.

direct_request_data(Req, Opts, MaxBytes) ->
    case maps:get(<<"body">>, Req, not_found) of
        not_found ->
            {ok, Req, direct};
        Body when is_binary(Body) ->
            case byte_size(Body) =< MaxBytes of
                true ->
                    case decode_map(Body) of
                        {ok, Decoded} ->
                            {ok, maps:merge(Req, Decoded), direct};
                        error ->
                            {ok, Req, direct}
                    end;
                false ->
                    {error, 413, <<"request-body-too-large">>}
            end;
        Body ->
            case load_request_value(Body, Opts, MaxBytes) of
                {ok, Loaded} when is_map(Loaded) ->
                    {ok, maps:merge(Req, Loaded), direct};
                {ok, _Loaded} ->
                    {ok, Req, direct};
                too_large ->
                    {error, 413, <<"request-body-too-large">>};
                error ->
                    {error, 400, <<"invalid-body">>}
            end
    end.

max_request_bytes(signal, Config) ->
    maps:get(max_signal_bytes, Config)
        + maps:get(max_metadata_bytes, Config)
        + 4096;
max_request_bytes(Operation, Config) when
        Operation =:= create;
        Operation =:= join;
        Operation =:= update;
        Operation =:= record ->
    maps:get(max_metadata_bytes, Config) + 4096;
max_request_bytes(_Operation, _Config) ->
    4096.

max_envelope_bytes(MaxPlaintextBytes) ->
    ((MaxPlaintextBytes + 16) * 4 + 2) div 3 + 256.

operation_path(transport_key) ->
    <<"transport-key">>;
operation_path(Operation) ->
    atom_to_binary(Operation).

http_request(Opts) ->
    hb_opts:get(http_server, not_found, Opts) =/= not_found.

config(_Base, Opts) ->
    #{
        namespace => config_id(Opts, <<"hyperstream-namespace">>, <<"default">>),
        peer_ttl_ms => config_integer(
            Opts,
            <<"hyperstream-peer-ttl-ms">>,
            ?DEFAULT_PEER_TTL_MS,
            1000,
            3600000
        ),
        session_ttl_ms => config_integer(
            Opts,
            <<"hyperstream-session-ttl-ms">>,
            ?DEFAULT_SESSION_TTL_MS,
            1000,
            86400000
        ),
        event_ttl_ms => config_integer(
            Opts,
            <<"hyperstream-event-ttl-ms">>,
            ?DEFAULT_EVENT_TTL_MS,
            1000,
            3600000
        ),
        tombstone_ttl_ms => config_integer(
            Opts,
            <<"hyperstream-tombstone-ttl-ms">>,
            ?DEFAULT_TOMBSTONE_TTL_MS,
            1000,
            86400000
        ),
        max_sessions => config_integer(
            Opts,
            <<"hyperstream-max-sessions">>,
            ?DEFAULT_MAX_SESSIONS,
            1,
            100000
        ),
        max_peers => config_integer(
            Opts,
            <<"hyperstream-max-peers-per-session">>,
            ?DEFAULT_MAX_PEERS,
            2,
            100000
        ),
        max_events => config_integer(
            Opts,
            <<"hyperstream-max-events-per-session">>,
            ?DEFAULT_MAX_EVENTS,
            8,
            1000000
        ),
        max_event_bytes => config_integer(
            Opts,
            <<"hyperstream-max-event-bytes-per-session">>,
            ?DEFAULT_MAX_EVENT_BYTES,
            1024,
            1073741824
        ),
        max_signal_bytes => config_integer(
            Opts,
            <<"hyperstream-max-signal-bytes">>,
            ?DEFAULT_MAX_SIGNAL_BYTES,
            1,
            16777216
        ),
        max_metadata_bytes => config_integer(
            Opts,
            <<"hyperstream-max-metadata-bytes">>,
            ?DEFAULT_MAX_METADATA_BYTES,
            2,
            1048576
        ),
        max_read_events => config_integer(
            Opts,
            <<"hyperstream-max-read-events">>,
            ?DEFAULT_MAX_READ_EVENTS,
            1,
            1000
        ),
        max_recording_segments => config_integer(
            Opts,
            <<"hyperstream-max-recording-segments-per-session">>,
            config_integer(
                Opts,
                <<"hyperstream-max-recording-requests">>,
                ?DEFAULT_MAX_RECORDING_SEGMENTS,
                1,
                1000000
            ),
            1,
            1000000
        ),
        max_recording_descriptor_bytes => config_integer(
            Opts,
            <<"hyperstream-max-recording-descriptor-bytes-per-session">>,
            ?DEFAULT_MAX_RECORDING_DESCRIPTOR_BYTES,
            1024,
            1073741824
        ),
        max_pending_calls => config_integer(
            Opts,
            <<"hyperstream-max-pending-calls-per-session">>,
            ?DEFAULT_MAX_PENDING_CALLS,
            1,
            100000
        ),
        recording_signers => recording_signers(Opts)
    }.

config_id(Opts, Key, Default) ->
    Value = hb_opts:get(Key, Default, Opts),
    case valid_id(Value) of
        true -> Value;
        false -> Default
    end.

config_integer(Opts, Key, Default, Min, Max) ->
    Value = hb_opts:get(Key, Default, Opts),
    min(Max, max(Min, parse_integer(Value, Default))).

recording_signers(Opts) ->
    case hb_opts:get(
        hyperstream_recording_signers,
        hb_opts:get(cache_writers, [], Opts),
        Opts
    ) of
        Signers when is_list(Signers) ->
            [
                Signer
             || Signer <- Signers,
                is_binary(Signer),
                byte_size(Signer) =:= 43,
                valid_locator_hash(Signer)
            ];
        _ ->
            []
    end.

recording_signer_allowed(Signer, Config) ->
    lists:member(Signer, maps:get(recording_signers, Config)).

access(Data) ->
    case maps:get(<<"access">>, Data, <<"restricted">>) of
        <<"open">> -> {ok, open};
        <<"restricted">> -> {ok, restricted};
        _ -> {error, 400, <<"invalid-access">>}
    end.

metadata(Data, Config, Opts) ->
    MaxBytes = maps:get(max_metadata_bytes, Config),
    case load_request_value(maps:get(<<"metadata">>, Data, #{}), Opts, MaxBytes) of
        {ok, Metadata} when is_map(Metadata) ->
            case bounded_value(
                Metadata,
                MaxBytes,
                <<"metadata-too-large">>
            ) of
                ok -> {ok, Metadata};
                Error -> Error
            end;
        too_large ->
            {error, 413, <<"metadata-too-large">>};
        _ ->
            {error, 400, <<"invalid-metadata">>}
    end.

issue_peer_token(Data, Signer) ->
    case maps:get(<<"peer-token">>, Data, not_found) of
        not_found when Signer =/= not_found ->
            {ok, not_found, not_found};
        not_found ->
            {error, 400, <<"missing-peer-token">>};
        Token ->
            case valid_token(Token) of
                true -> {ok, Token, token_hash(Token)};
                false -> {error, 400, <<"invalid-peer-token">>}
            end
    end.

create_join_token_hash(Data, _Signer) ->
    case {
        maps:get(<<"join-token">>, Data, not_found),
        maps:get(<<"join-token-hash">>, Data, not_found)
    } of
        {not_found, not_found} ->
            {ok, not_found};
        {not_found, _Hash} ->
            optional_hash(Data, <<"join-token-hash">>);
        {_Token, not_found} ->
            optional_token_hash(Data, <<"join-token">>);
        {_Token, _Hash} ->
            {error, 400, <<"ambiguous-join-credential">>}
    end.

join_token_hash(Data, _Signer) ->
    optional_token_hash(Data, <<"join-token">>).

member_token_hash(Data, _Signer) ->
    optional_token_hash(Data, <<"peer-token">>).

optional_token_hash(Data, Key) ->
    case maps:get(Key, Data, not_found) of
        not_found ->
            {ok, not_found};
        Token ->
            case valid_token(Token) of
                true -> {ok, token_hash(Token)};
                false -> {error, 400, <<"invalid-token">>}
            end
    end.

optional_hash(Data, Key) ->
    case maps:get(Key, Data, not_found) of
        not_found ->
            {ok, not_found};
        Hash when is_binary(Hash), byte_size(Hash) =:= 43 ->
            case valid_locator_hash(Hash) of
                true -> {ok, Hash};
                false -> {error, 400, invalid_reason(Key)}
            end;
        _ ->
            {error, 400, invalid_reason(Key)}
    end.

credential(Signer, TokenHash) ->
    #{
        signer => Signer,
        token_hash => TokenHash
    }.

require_credential(not_found, not_found) ->
    {error, 401, <<"peer-credential-required">>};
require_credential(_Signer, _TokenHash) ->
    ok.

required_id(Data, Key) ->
    case maps:get(Key, Data, not_found) of
        Value when is_binary(Value) ->
            case valid_id(Value) of
                true -> {ok, Value};
                false -> {error, 400, invalid_reason(Key)}
            end;
        _ ->
            {error, 400, missing_reason(Key)}
    end.

optional_id(Data, Key, Default) ->
    case maps:get(Key, Data, Default) of
        Value when is_binary(Value) ->
            case valid_id(Value) of
                true -> {ok, Value};
                false -> {error, 400, invalid_reason(Key)}
            end;
        _ ->
            {error, 400, invalid_reason(Key)}
    end.

required_value(Data, Key, MaxBytes, TooLargeReason, Opts) ->
    case maps:find(Key, Data) of
        error ->
            {error, 400, missing_reason(Key)};
        {ok, Value} ->
            case load_request_value(Value, Opts, MaxBytes) of
                {ok, Loaded} -> {ok, Loaded};
                too_large -> {error, 413, TooLargeReason};
                error -> {error, 400, invalid_reason(Key)}
            end
    end.

load_request_value(Value, Opts, MaxBytes) ->
    try
        {Loaded, _Remaining} = load_request_value(
            Value,
            Opts,
            MaxBytes,
            0,
            untrusted
        ),
        {ok, Loaded}
    catch
        throw:request_value_too_large -> too_large;
        _:_ -> error
    end.

load_request_value(_Value, _Opts, _Remaining, Depth, _Trust)
        when Depth > ?MAX_REQUEST_DEPTH ->
    throw(invalid_request_depth);
load_request_value(
    {link, _ID, _LinkOpts},
    _Opts,
    _Remaining,
    _Depth,
    _Trust
) ->
    throw(linked_request_value);
load_request_value(Value, _Opts, Remaining, _Depth, _Trust) when is_binary(Value) ->
    {Value, spend_request_budget(byte_size(Value) + 2, Remaining)};
load_request_value(Value, _Opts, Remaining, _Depth, _Trust) when is_integer(Value) ->
    {Value, spend_request_budget(byte_size(integer_to_binary(Value)), Remaining)};
load_request_value(Value, _Opts, Remaining, _Depth, _Trust) when is_float(Value) ->
    {Value, spend_request_budget(32, Remaining)};
load_request_value(Value, _Opts, Remaining, _Depth, _Trust)
        when Value =:= true; Value =:= false; Value =:= null ->
    {Value, spend_request_budget(5, Remaining)};
load_request_value(Value, Opts, Remaining, Depth, Trust) when is_list(Value) ->
    Remaining0 = spend_request_budget(2, Remaining),
    {Reversed, Remaining1} = lists:foldl(
        fun(Item, {Items, CurrentRemaining}) ->
            {Loaded, NextRemaining} = load_request_value(
                Item,
                Opts,
                spend_request_budget(1, CurrentRemaining),
                Depth + 1,
                Trust
            ),
            {[Loaded | Items], NextRemaining}
        end,
        {[], Remaining0},
        Value
    ),
    {lists:reverse(Reversed), Remaining1};
load_request_value(Value, Opts, Remaining, Depth, Trust) when is_map(Value) ->
    Public = maps:remove(<<"commitments">>, hb_private:reset(Value)),
    maps:fold(
        fun(Key, Item, {Loaded, CurrentRemaining}) when is_binary(Key) ->
            KeyRemaining = spend_request_budget(
                byte_size(Key) + 4,
                CurrentRemaining
            ),
            {LoadedItem, NextRemaining} = load_request_value(
                Item,
                Opts,
                KeyRemaining,
                Depth + 1,
                Trust
            ),
            {Loaded#{Key => LoadedItem}, NextRemaining};
           (_Key, _Item, _Acc) ->
            throw(invalid_request_key)
        end,
        {#{}, spend_request_budget(2, Remaining)},
        Public
    );
load_request_value(_Value, _Opts, _Remaining, _Depth, _Trust) ->
    throw(invalid_request_value).

spend_request_budget(Bytes, Remaining) when Bytes =< Remaining ->
    Remaining - Bytes;
spend_request_budget(_Bytes, _Remaining) ->
    throw(request_value_too_large).

positive_integer(Data, Key, missing) ->
    case maps:find(Key, Data) of
        {ok, Value} ->
            case parse_integer(Value, invalid) of
                Int when is_integer(Int), Int > 0 -> {ok, Int};
                _ -> {error, 400, invalid_reason(Key)}
            end;
        error ->
            {error, 400, missing_reason(Key)}
    end;
positive_integer(Data, Key, Default) ->
    case parse_integer(maps:get(Key, Data, Default), invalid) of
        Int when is_integer(Int), Int > 0 -> {ok, Int};
        _ -> {error, 400, invalid_reason(Key)}
    end.

non_negative_integer(Data, Key, Default) ->
    case parse_integer(maps:get(Key, Data, Default), invalid) of
        Int when is_integer(Int), Int >= 0 -> {ok, Int};
        _ -> {error, 400, invalid_reason(Key)}
    end.

parse_integer(Value, _Default) when is_integer(Value) ->
    Value;
parse_integer(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value)
    catch
        _:_ -> Default
    end;
parse_integer(_Value, Default) ->
    Default.

valid_id(Value) when is_binary(Value) ->
    Size = byte_size(Value),
    Size > 0
    andalso Size =< ?MAX_ID_BYTES
    andalso lists:all(fun(Byte) -> Byte >= 33 andalso Byte =< 126 end, binary_to_list(Value));
valid_id(_Value) ->
    false.

valid_token(Value) when is_binary(Value) ->
    Size = byte_size(Value),
    Size >= ?MIN_TOKEN_BYTES andalso Size =< ?MAX_TOKEN_BYTES;
valid_token(_Value) ->
    false.

valid_segment(Segment) when is_map(Segment) ->
    case maps:get(<<"id">>, Segment, not_found) of
        ID when is_binary(ID) ->
            case valid_immutable_locator(ID) of
                true -> ok;
                false -> {error, 400, <<"invalid-segment-id">>}
            end;
        _ ->
            {error, 400, <<"missing-segment-id">>}
    end;
valid_segment(_Value) ->
    {error, 400, <<"invalid-segment-descriptor">>}.

optional_locator(Data, Key) ->
    case maps:get(Key, Data, not_found) of
        not_found ->
            {ok, not_found};
        ID when is_binary(ID) ->
            case valid_immutable_locator(ID) of
                true -> {ok, ID};
                false -> {error, 400, invalid_reason(Key)}
            end;
        _ ->
            {error, 400, invalid_reason(Key)}
    end.

valid_immutable_locator(ID) when byte_size(ID) =:= 43 ->
    valid_locator_hash(ID);
valid_immutable_locator(<<"data/", Hash/binary>>) when byte_size(Hash) =:= 43 ->
    valid_locator_hash(Hash);
valid_immutable_locator(_ID) ->
    false.

valid_locator_hash(Hash) ->
    lists:all(
        fun(Byte) ->
            (Byte >= $A andalso Byte =< $Z)
            orelse (Byte >= $a andalso Byte =< $z)
            orelse (Byte >= $0 andalso Byte =< $9)
            orelse Byte =:= $-
            orelse Byte =:= $_
        end,
        binary_to_list(Hash)
    ).

bounded_value(Value, MaxBytes, Reason) ->
    try byte_size(hb_json:encode(Value)) of
        Size when Size =< MaxBytes -> ok;
        _ -> {error, 413, Reason}
    catch
        _:_ -> {error, 400, <<"value-not-json-compatible">>}
    end.

derived_session_id(RequestID, PeerID, Signer, TokenHash) ->
    Actor = case Signer of
        not_found -> TokenHash;
        _ -> Signer
    end,
    Digest = crypto:hash(
        sha256,
        term_to_binary({RequestID, PeerID, Actor}, [deterministic])
    ),
    <<"session-", (hb_util:encode(Digest))/binary>>.

token_hash(Token) ->
    hb_util:encode(crypto:hash(sha256, Token)).

fingerprint(Operation, Params) ->
    Semantic = maps:without(
        [credential, peer_token, store_opts, fingerprint],
        Params
    ),
    crypto:hash(sha256, term_to_binary({Operation, Semantic}, [deterministic])).

response(Reply, SuccessStatus, Params, Operation, direct, _Opts) ->
    direct_response(Reply, SuccessStatus, Params);
response(Reply, SuccessStatus, Params, Operation, Transport, Opts) ->
    case response_payload(Reply, SuccessStatus, Params) of
        {Tag, Status, Payload} ->
            Plaintext = hb_json:encode(Payload),
            case dev_hyperstream_transport:seal(
                operation_path(Operation),
                Plaintext,
                Transport
            ) of
                {ok, Envelope} ->
                    {
                        Tag,
                        #{
                            <<"status">> => Status,
                            <<"device">> => ?DEVICE,
                            <<"cache-control">> => <<"no-store">>,
                            <<"content-type">> =>
                                <<"application/octet-stream">>,
                            <<"body">> => Envelope
                        }
                    };
                {error, _Reason} ->
                    public_error_response(
                        500,
                        <<"transport-response-failed">>,
                        Opts
                    )
            end
    end.

direct_response(Reply, SuccessStatus, Params) ->
    case response_payload(Reply, SuccessStatus, Params) of
        {Tag, _Status, Payload} -> {Tag, Payload}
    end.

response_payload({ok, Payload0}, Status, _Params) ->
    {
        ok,
        Status,
        (compact(Payload0))#{
            <<"status">> => Status,
            <<"device">> => ?DEVICE,
            <<"cache-control">> => <<"no-store">>
        }
    };
response_payload({error, Status, Reason, Extra}, _SuccessStatus, _Params) ->
    {
        error,
        Status,
        (compact(Extra))#{
            <<"status">> => Status,
            <<"reason">> => Reason,
            <<"device">> => ?DEVICE,
            <<"cache-control">> => <<"no-store">>
        }
    }.

public_response(Status, Payload0, Opts) ->
    Payload = (compact(Payload0))#{
        <<"status">> => Status,
        <<"device">> => ?DEVICE,
        <<"cache-control">> => <<"no-store">>
    },
    case http_request(Opts) of
        true ->
            {
                ok,
                #{
                    <<"status">> => Status,
                    <<"device">> => ?DEVICE,
                    <<"cache-control">> => <<"no-store">>,
                    <<"content-type">> => <<"application/json">>,
                    <<"body">> => hb_json:encode(Payload)
                }
            };
        false ->
            {ok, Payload}
    end.

public_error_response(Status, Reason, Opts) ->
    public_error_response(Status, Reason, Opts, #{}).

public_error_response(Status, Reason, Opts, Extra) ->
    Payload = (compact(Extra))#{
        <<"status">> => Status,
        <<"reason">> => Reason,
        <<"device">> => ?DEVICE,
        <<"cache-control">> => <<"no-store">>
    },
    case http_request(Opts) of
        true ->
            {
                error,
                #{
                    <<"status">> => Status,
                    <<"device">> => ?DEVICE,
                    <<"cache-control">> => <<"no-store">>,
                    <<"content-type">> => <<"application/json">>,
                    <<"body">> => hb_json:encode(Payload)
                }
            };
        false ->
            {error, Payload}
    end.

compact(Value) when is_map(Value) ->
    maps:from_list([
        {Key, compact(Child)}
     || {Key, Child} <- maps:to_list(Value),
        Child =/= not_found
    ]);
compact(Value) when is_list(Value) ->
    [compact(Child) || Child <- Value];
compact(Value) ->
    Value.

missing_reason(Key) ->
    <<"missing-", Key/binary>>.

invalid_reason(Key) ->
    <<"invalid-", Key/binary>>.

decode_map(Body) ->
    try hb_json:decode(Body) of
        Value when is_map(Value) -> {ok, Value};
        _ -> error
    catch
        _:_ -> error
    end.

-ifdef(TEST).

info_exports_public_contract_test() ->
    Exports = maps:get(exports, info(#{})),
    ?assertEqual(
        [
            <<"transport-key">>,
            <<"create">>,
            <<"join">>,
            <<"heartbeat">>,
            <<"leave">>,
            <<"signal">>,
            <<"events">>,
            <<"session">>,
            <<"update">>,
            <<"record">>,
            <<"close">>
        ],
        Exports
    ).

http_plaintext_body_is_rejected_test() ->
    Opts = http_test_opts(<<"plaintext">>),
    {error, Response} = create(
        #{},
        #{
            <<"method">> => <<"POST">>,
            <<"body">> => hb_json:encode(
                #{
                    <<"request-id">> => <<"create-1">>,
                    <<"session-id">> => <<"stream-1">>,
                    <<"peer-id">> => <<"publisher">>,
                    <<"peer-token">> => test_token(<<"publisher">>)
                }
            )
        },
        Opts
    ),
    ?assertEqual(400, maps:get(<<"status">>, Response)),
    ?assertEqual(
        <<"invalid-transport-envelope">>,
        maps:get(
            <<"reason">>,
            hb_json:decode(maps:get(<<"body">>, Response))
        )
    ).

sealed_http_request_and_response_are_operation_bound_test() ->
    Opts = http_test_opts(<<"sealed">>),
    Payload = #{
        <<"request-id">> => <<"create-1">>,
        <<"session-id">> => <<"stream-1">>,
        <<"peer-id">> => <<"publisher">>,
        <<"peer-token">> => test_token(<<"publisher">>),
        <<"access">> => <<"open">>
    },
    {Envelope, Client} = test_seal_request(
        <<"create">>,
        hb_json:encode(Payload)
    ),
    {ok, Response} = create(
        #{},
        #{<<"method">> => <<"POST">>, <<"body">> => Envelope},
        Opts
    ),
    ?assertEqual(201, maps:get(<<"status">>, Response)),
    Opened = hb_json:decode(
        test_open_response(
            <<"create">>,
            maps:get(<<"body">>, Response),
            Client
        )
    ),
    ?assertEqual(<<"stream-1">>, maps:get(<<"session-id">>, Opened)),
    {error, WrongOperation} = join(
        #{},
        #{<<"method">> => <<"POST">>, <<"body">> => Envelope},
        http_test_opts(<<"sealed-wrong-operation">>)
    ),
    ?assertEqual(400, maps:get(<<"status">>, WrongOperation)),
    ?assertEqual(
        <<"invalid-transport-envelope">>,
        maps:get(
            <<"reason">>,
            hb_json:decode(maps:get(<<"body">>, WrongOperation))
        )
    ).

sealed_http_body_is_the_only_semantic_input_test() ->
    Opts = http_test_opts(<<"semantic-input">>),
    InnerMetadata = #{
        <<"application">> => <<"inner">>,
        <<"description">> => binary:copy(<<"x">>, 32)
    },
    Payload = #{
        <<"request-id">> => <<"create-inner">>,
        <<"session-id">> => <<"stream-inner">>,
        <<"peer-id">> => <<"publisher-inner">>,
        <<"peer-token">> => test_token(<<"publisher-inner">>),
        <<"access">> => <<"open">>,
        <<"metadata">> => InnerMetadata
    },
    {Envelope, Client} = test_seal_request(
        <<"create">>,
        hb_json:encode(Payload)
    ),
    Outer = #{
        <<"method">> => <<"POST">>,
        <<"body">> => Envelope,
        <<"request-id">> => <<"create-outer">>,
        <<"session-id">> => <<"stream-outer">>,
        <<"peer-id">> => <<"publisher-outer">>,
        <<"peer-token">> => test_token(<<"publisher-outer">>),
        <<"access">> => <<"restricted">>,
        <<"metadata">> => #{<<"application">> => <<"outer">>},
        <<"hyperstream-namespace">> => <<"attacker">>,
        <<"hyperstream-max-metadata-bytes">> => 2
    },
    {ok, Response} = create(#{}, Outer, Opts),
    Opened = hb_json:decode(
        test_open_response(
            <<"create">>,
            maps:get(<<"body">>, Response),
            Client
        )
    ),
    ?assertEqual(<<"stream-inner">>, maps:get(<<"session-id">>, Opened)),
    ?assertEqual(<<"publisher-inner">>, maps:get(<<"peer-id">>, Opened)),
    ?assertEqual(InnerMetadata, maps:get(<<"metadata">>, Opened)),
    ?assertEqual(<<"open">>, maps:get(<<"access">>, Opened)).

signed_transport_key_route_uses_hyphenated_path_test() ->
    Wallet = ar_wallet:new(),
    Opts = (http_test_opts(<<"transport-key">>))#{
        <<"priv-wallet">> => Wallet
    },
    Signed = hb_message:commit(
        #{
            <<"device">> => ?DEVICE,
            <<"path">> => <<"transport-key">>
        },
        Opts
    ),
    {ok, Response} = transport_key(#{}, Signed, Opts),
    KeyInfo = hb_json:decode(maps:get(<<"body">>, Response)),
    ?assertEqual(<<"hs1">>, maps:get(<<"transport">>, KeyInfo)),
    ?assertEqual(
        <<"transport-key">>,
        operation_path(transport_key)
    ),
    WrongRoute = hb_message:commit(
        #{
            <<"device">> => ?DEVICE,
            <<"path">> => <<"transport_key">>
        },
        Opts
    ),
    {error, WrongResponse} = transport_key(#{}, WrongRoute, Opts),
    ?assertEqual(
        <<"signed-route-mismatch">>,
        maps:get(
            <<"reason">>,
            hb_json:decode(maps:get(<<"body">>, WrongResponse))
        )
    ).

targeted_signaling_and_cursor_test() ->
    Base = test_base(<<"signal">>),
    {ok, Created} = create(
        Base,
        #{
            <<"request-id">> => <<"create-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"publisher">>,
            <<"peer-token">> => test_token(<<"publisher">>),
            <<"access">> => <<"open">>,
            <<"metadata">> => #{<<"application">> => <<"test">>}
        },
        Base
    ),
    ?assertEqual(201, maps:get(<<"status">>, Created)),
    {ok, Joined} = join(
        Base,
        #{
            <<"request-id">> => <<"join-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"viewer">>,
            <<"peer-token">> => test_token(<<"viewer">>)
        },
        Base
    ),
    ViewerGeneration = maps:get(<<"peer-generation">>, Joined),
    {ok, Accepted} = signal(
        Base,
        #{
            <<"request-id">> => <<"offer-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"publisher">>,
            <<"peer-generation">> => maps:get(<<"peer-generation">>, Created),
            <<"peer-token">> => test_token(<<"publisher">>),
            <<"to-peer-id">> => <<"viewer">>,
            <<"connection-id">> => <<"publisher-viewer">>,
            <<"kind">> => <<"offer">>,
            <<"body">> => #{<<"sdp">> => <<"v=0">>}
        },
        Base
    ),
    SignalCursor = maps:get(<<"cursor">>, Accepted),
    {ok, ViewerEvents} = events(
        Base,
        #{
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"viewer">>,
            <<"peer-generation">> => ViewerGeneration,
            <<"peer-token">> => test_token(<<"viewer">>),
            <<"after">> => SignalCursor - 1
        },
        Base
    ),
    ?assertMatch(
        [
            #{
                <<"type">> := <<"signal">>,
                <<"kind">> := <<"offer">>,
                <<"body">> := #{<<"sdp">> := <<"v=0">>}
            }
        ],
        maps:get(<<"events">>, ViewerEvents)
    ),
    {ok, PublisherEvents} = events(
        Base,
        #{
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"publisher">>,
            <<"peer-generation">> => maps:get(<<"peer-generation">>, Created),
            <<"peer-token">> => test_token(<<"publisher">>),
            <<"after">> => SignalCursor - 1
        },
        Base
    ),
    ?assertEqual([], maps:get(<<"events">>, PublisherEvents)).

signal_idempotency_and_spoofing_test() ->
    Base = test_base(<<"idempotency">>),
    {ok, Created} = create(
        Base,
        #{
            <<"request-id">> => <<"create-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"publisher">>,
            <<"peer-token">> => test_token(<<"publisher">>),
            <<"access">> => <<"open">>
        },
        Base
    ),
    {ok, Joined} = join(
        Base,
        #{
            <<"request-id">> => <<"join-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"viewer">>,
            <<"peer-token">> => test_token(<<"viewer">>)
        },
        Base
    ),
    Signal = #{
        <<"request-id">> => <<"signal-1">>,
        <<"session-id">> => <<"stream-1">>,
        <<"peer-id">> => <<"publisher">>,
        <<"peer-generation">> => maps:get(<<"peer-generation">>, Created),
        <<"peer-token">> => test_token(<<"publisher">>),
        <<"to-peer-id">> => <<"viewer">>,
        <<"connection-id">> => <<"pc-1">>,
        <<"kind">> => <<"ice-candidate">>,
        <<"body">> => <<>>
    },
    {ok, First} = signal(Base, Signal, Base),
    {ok, Duplicate} = signal(Base, Signal, Base),
    ?assertEqual(maps:get(<<"cursor">>, First), maps:get(<<"cursor">>, Duplicate)),
    ?assertEqual(true, maps:get(<<"duplicate">>, Duplicate)),
    ?assertMatch(
        {error, #{<<"status">> := 401, <<"reason">> := <<"invalid-peer-credential">>}},
        session(
            Base,
            #{
                <<"session-id">> => <<"stream-1">>,
                <<"peer-id">> => <<"viewer">>,
                <<"peer-generation">> => maps:get(<<"peer-generation">>, Joined),
                <<"peer-token">> => test_token(<<"attacker">>)
            },
            Base
        )
    ).

rejoined_sender_can_reuse_signal_request_id_test() ->
    Base = test_base(<<"sender-generation">>),
    OwnerToken = test_token(<<"owner">>),
    SenderToken1 = test_token(<<"sender-one">>),
    SenderToken2 = test_token(<<"sender-two">>),
    TargetToken = test_token(<<"target">>),
    {ok, _Created} = create(
        Base,
        #{
            <<"request-id">> => <<"create-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"owner">>,
            <<"peer-token">> => OwnerToken,
            <<"access">> => <<"open">>
        },
        Base
    ),
    {ok, FirstJoin} = join(
        Base,
        #{
            <<"request-id">> => <<"join-sender-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"sender">>,
            <<"peer-token">> => SenderToken1
        },
        Base
    ),
    {ok, _TargetJoin} = join(
        Base,
        #{
            <<"request-id">> => <<"join-target">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"target">>,
            <<"peer-token">> => TargetToken
        },
        Base
    ),
    Signal = #{
        <<"request-id">> => <<"reusable-signal">>,
        <<"session-id">> => <<"stream-1">>,
        <<"peer-id">> => <<"sender">>,
        <<"peer-generation">> => maps:get(<<"peer-generation">>, FirstJoin),
        <<"peer-token">> => SenderToken1,
        <<"to-peer-id">> => <<"target">>,
        <<"connection-id">> => <<"pc-1">>,
        <<"kind">> => <<"offer">>,
        <<"body">> => #{<<"sdp">> => <<"v=0">>}
    },
    {ok, FirstSignal} = signal(Base, Signal, Base),
    {ok, _Left} = leave(
        Base,
        #{
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"sender">>,
            <<"peer-generation">> => maps:get(<<"peer-generation">>, FirstJoin),
            <<"peer-token">> => SenderToken1
        },
        Base
    ),
    {ok, SecondJoin} = join(
        Base,
        #{
            <<"request-id">> => <<"join-sender-2">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"sender">>,
            <<"peer-token">> => SenderToken2
        },
        Base
    ),
    {ok, SecondSignal} = signal(
        Base,
        Signal#{
            <<"peer-generation">> => maps:get(
                <<"peer-generation">>,
                SecondJoin
            ),
            <<"peer-token">> => SenderToken2
        },
        Base
    ),
    ?assert(
        maps:get(<<"cursor">>, SecondSignal)
        > maps:get(<<"cursor">>, FirstSignal)
    ),
    ?assertNot(maps:is_key(<<"duplicate">>, SecondSignal)).

rejoined_peer_cannot_read_prior_generation_signals_test() ->
    Base = test_base(<<"generation">>),
    PublisherToken = test_token(<<"publisher">>),
    ViewerToken1 = test_token(<<"viewer-one">>),
    ViewerToken2 = test_token(<<"viewer-two">>),
    {ok, Created} = create(
        Base,
        #{
            <<"request-id">> => <<"create-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"publisher">>,
            <<"peer-token">> => PublisherToken,
            <<"access">> => <<"open">>
        },
        Base
    ),
    {ok, FirstJoin} = join(
        Base,
        #{
            <<"request-id">> => <<"join-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"viewer">>,
            <<"peer-token">> => ViewerToken1
        },
        Base
    ),
    {ok, _} = signal(
        Base,
        #{
            <<"request-id">> => <<"offer-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"publisher">>,
            <<"peer-generation">> => maps:get(<<"peer-generation">>, Created),
            <<"peer-token">> => PublisherToken,
            <<"to-peer-id">> => <<"viewer">>,
            <<"connection-id">> => <<"pc-1">>,
            <<"kind">> => <<"offer">>,
            <<"body">> => #{<<"sdp">> => <<"secret-old-offer">>}
        },
        Base
    ),
    {ok, _} = leave(
        Base,
        #{
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"viewer">>,
            <<"peer-generation">> => maps:get(<<"peer-generation">>, FirstJoin),
            <<"peer-token">> => ViewerToken1
        },
        Base
    ),
    {ok, SecondJoin} = join(
        Base,
        #{
            <<"request-id">> => <<"join-2">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"viewer">>,
            <<"peer-token">> => ViewerToken2
        },
        Base
    ),
    ?assert(
        maps:get(<<"peer-generation">>, SecondJoin)
        > maps:get(<<"peer-generation">>, FirstJoin)
    ),
    {ok, Polled} = events(
        Base,
        #{
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"viewer">>,
            <<"peer-generation">> => maps:get(<<"peer-generation">>, SecondJoin),
            <<"peer-token">> => ViewerToken2,
            <<"after">> => 0
        },
        Base
    ),
    ?assertNot(
        lists:any(
            fun(Event) -> maps:get(<<"type">>, Event) =:= <<"signal">> end,
            maps:get(<<"events">>, Polled)
        )
    ).

signed_peer_uses_verified_authority_test() ->
    Base = test_base(<<"signed">>),
    Wallet = ar_wallet:new(),
    Opts = Base#{<<"priv-wallet">> => Wallet},
    SignedWithToken = hb_message:commit(
        #{
            <<"device">> => ?DEVICE,
            <<"path">> => <<"create">>,
            <<"request-id">> => <<"create-with-token">>,
            <<"session-id">> => <<"stream-with-token">>,
            <<"peer-id">> => <<"publisher">>,
            <<"peer-token">> => test_token(<<"must-not-persist">>)
        },
        Opts
    ),
    ?assertMatch(
        {ok, #{<<"session-id">> := <<"stream-with-token">>}},
        create(Base, SignedWithToken, Opts)
    ),
    CreateReq = hb_message:commit(
        #{
            <<"device">> => ?DEVICE,
            <<"path">> => <<"create">>,
            <<"request-id">> => <<"create-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"publisher">>
        },
        Opts
    ),
    {ok, Created} = create(Base, CreateReq, Opts),
    ?assertNot(maps:is_key(<<"peer-token">>, Created)),
    SessionReq = hb_message:commit(
        #{
            <<"device">> => ?DEVICE,
            <<"path">> => <<"session">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"publisher">>,
            <<"peer-generation">> => maps:get(<<"peer-generation">>, Created)
        },
        Opts
    ),
    ?assertMatch(
        {ok, #{<<"session-id">> := <<"stream-1">>}},
        session(Base, SessionReq, Opts)
    ),
    ?assertMatch(
        {
            error,
            #{
                <<"status">> := 400,
                <<"reason">> := <<"signed-route-mismatch">>
            }
        },
        close(Base, SessionReq, Opts)
    ),
    PathlessSessionReq = hb_message:commit(
        #{
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"publisher">>,
            <<"peer-generation">> => maps:get(<<"peer-generation">>, Created)
        },
        Opts
    ),
    ?assertMatch(
        {
            error,
            #{
                <<"status">> := 400,
                <<"reason">> := <<"signed-route-mismatch">>
            }
        },
        session(Base, PathlessSessionReq, Opts)
    ),
    Tampered = SessionReq#{<<"peer-id">> => <<"attacker">>},
    ?assertMatch(
        {error, #{<<"status">> := 401, <<"reason">> := <<"invalid-signature">>}},
        session(Base, Tampered, Opts)
    ).

signed_structured_values_are_rejected_and_json_is_resolved_test() ->
    Store = hb_test_utils:test_store(),
    Wallet = ar_wallet:new(),
    Base = test_base(<<"signed-body">>),
    Opts = Base#{
        <<"store">> => [Store],
        <<"priv-wallet">> => Wallet
    },
    Metadata = #{<<"role">> => <<"publisher">>},
    StructuredReq = hb_message:commit(
        #{
            <<"device">> => ?DEVICE,
            <<"path">> => <<"create">>,
            <<"body">> => #{
                <<"request-id">> => <<"create-1">>,
                <<"session-id">> => <<"stream-1">>,
                <<"peer-id">> => <<"publisher">>,
                <<"metadata">> => Metadata
            }
        },
        Opts,
        #{<<"bundle">> => true}
    ),
    ?assertMatch(
        {
            error,
            #{
                <<"status">> := 400,
                <<"reason">> :=
                    <<"signed-structured-value-not-allowed">>
            }
        },
        create(Base, StructuredReq, Opts)
    ),
    JSONReq = hb_message:commit(
        #{
            <<"device">> => ?DEVICE,
            <<"path">> => <<"create">>,
            <<"body">> => hb_json:encode(
                #{
                    <<"request-id">> => <<"create-1">>,
                    <<"session-id">> => <<"stream-1">>,
                    <<"peer-id">> => <<"publisher">>,
                    <<"metadata">> => Metadata
                }
            )
        },
        Opts
    ),
    {ok, Created} = create(Base, JSONReq, Opts),
    ?assertEqual(Metadata, maps:get(<<"metadata">>, Created)).

signed_links_are_rejected_and_json_is_limited_test() ->
    Store = hb_test_utils:test_store(),
    Wallet = ar_wallet:new(),
    Base = (test_base(<<"signed-limit">>))#{
        <<"hyperstream-max-signal-bytes">> => 32
    },
    Opts = Base#{
        <<"store">> => [Store],
        <<"priv-wallet">> => Wallet
    },
    {ok, Created} = create(
        Base,
        hb_message:commit(
            #{
                <<"device">> => ?DEVICE,
                <<"path">> => <<"create">>,
                <<"request-id">> => <<"create-1">>,
                <<"session-id">> => <<"stream-1">>,
                <<"peer-id">> => <<"publisher">>,
                <<"access">> => <<"open">>
            },
            Opts
        ),
        Opts
    ),
    {ok, _Joined} = join(
        Base,
        #{
            <<"request-id">> => <<"join-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"viewer">>,
            <<"peer-token">> => test_token(<<"viewer">>)
        },
        Opts
    ),
    ?assertMatch(
        {
            error,
            #{
                <<"status">> := 400,
                <<"reason">> := <<"linked-request-value">>
            }
        },
        signal(
            Base,
            hb_message:commit(
                #{
                    <<"device">> => ?DEVICE,
                    <<"path">> => <<"signal">>,
                    <<"request-id">> => <<"signal-1">>,
                    <<"session-id">> => <<"stream-1">>,
                    <<"peer-id">> => <<"publisher">>,
                    <<"peer-generation">> =>
                        maps:get(<<"peer-generation">>, Created),
                    <<"to-peer-id">> => <<"viewer">>,
                    <<"connection-id">> => <<"pc-1">>,
                    <<"body">> => #{
                        <<"sdp">> => binary:copy(<<"x">>, 128)
                    }
                },
                Opts
            ),
            Opts
        )
    ),
    ?assertMatch(
        {error, #{<<"status">> := 413, <<"reason">> := <<"signal-too-large">>}},
        signal(
            Base,
            hb_message:commit(
                #{
                    <<"device">> => ?DEVICE,
                    <<"path">> => <<"signal">>,
                    <<"body">> => hb_json:encode(
                        #{
                            <<"request-id">> => <<"signal-1">>,
                            <<"session-id">> => <<"stream-1">>,
                            <<"peer-id">> => <<"publisher">>,
                            <<"peer-generation">> =>
                                maps:get(
                                    <<"peer-generation">>,
                                    Created
                                ),
                            <<"to-peer-id">> => <<"viewer">>,
                            <<"connection-id">> => <<"pc-1">>,
                            <<"body">> => #{
                                <<"sdp">> =>
                                    binary:copy(<<"x">>, 128)
                            }
                        }
                    )
                },
                Opts
            ),
            Opts
        )
    ).

oversized_create_event_returns_capacity_error_test() ->
    Base = (test_base(<<"create-event-capacity">>))#{
        <<"hyperstream-max-event-bytes-per-session">> => 1024,
        <<"hyperstream-max-metadata-bytes">> => 4096
    },
    Large = #{
        <<"role">> => <<"publisher">>,
        <<"description">> => binary:copy(<<"x">>, 2048)
    },
    Request = #{
        <<"request-id">> => <<"create-1">>,
        <<"session-id">> => <<"stream-1">>,
        <<"peer-id">> => <<"publisher">>,
        <<"peer-token">> => test_token(<<"publisher">>),
        <<"metadata">> => Large
    },
    ?assertMatch(
        {
            error,
            #{
                <<"status">> := 429,
                <<"reason">> := <<"event-buffer-full">>
            }
        },
        create(Base, Request, Base)
    ),
    {ok, _Created} = create(
        Base,
        Request#{
            <<"request-id">> => <<"create-2">>,
            <<"metadata">> => #{}
        },
        Base
    ).

max_sessions_admission_is_atomic_test() ->
    Base = (test_base(<<"session-capacity">>))#{
        <<"hyperstream-max-sessions">> => 1
    },
    Parent = self(),
    Ref = make_ref(),
    lists:foreach(
        fun({SessionID, PeerID}) ->
            spawn(
                fun() ->
                    Result = create(
                        Base,
                        #{
                            <<"request-id">> => <<"create-", SessionID/binary>>,
                            <<"session-id">> => SessionID,
                            <<"peer-id">> => PeerID,
                            <<"peer-token">> => test_token(PeerID)
                        },
                        Base
                    ),
                    Parent ! {Ref, Result}
                end
            )
        end,
        [
            {<<"stream-1">>, <<"publisher-1">>},
            {<<"stream-2">>, <<"publisher-2">>}
        ]
    ),
    First = receive {Ref, Result1} -> Result1 end,
    Second = receive {Ref, Result2} -> Result2 end,
    Statuses = lists:sort([
        maps:get(<<"status">>, Payload)
     || {_Status, Payload} <- [First, Second]
    ]),
    ?assertEqual([201, 429], Statuses).

restricted_join_update_and_close_tombstone_test() ->
    Base = test_base(<<"restricted">>),
    JoinToken = test_token(<<"join">>),
    OwnerToken = test_token(<<"owner">>),
    ViewerToken = test_token(<<"viewer">>),
    {ok, Created} = create(
        Base,
        #{
            <<"request-id">> => <<"create-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"owner">>,
            <<"peer-token">> => OwnerToken,
            <<"join-token">> => JoinToken
        },
        Base
    ),
    JoinReq = #{
        <<"request-id">> => <<"join-1">>,
        <<"session-id">> => <<"stream-1">>,
        <<"peer-id">> => <<"viewer">>,
        <<"peer-token">> => ViewerToken
    },
    ?assertMatch(
        {error, #{<<"status">> := 403, <<"reason">> := <<"join-forbidden">>}},
        join(Base, JoinReq, Base)
    ),
    {ok, Joined} = join(
        Base,
        JoinReq#{<<"join-token">> => JoinToken},
        Base
    ),
    Viewer = #{
        <<"session-id">> => <<"stream-1">>,
        <<"peer-id">> => <<"viewer">>,
        <<"peer-generation">> => maps:get(<<"peer-generation">>, Joined),
        <<"peer-token">> => ViewerToken
    },
    ?assertMatch(
        {error, #{<<"status">> := 403, <<"reason">> := <<"owner-required">>}},
        update(Base, Viewer#{<<"metadata">> => #{}}, Base)
    ),
    Owner = #{
        <<"session-id">> => <<"stream-1">>,
        <<"peer-id">> => <<"owner">>,
        <<"peer-generation">> => maps:get(<<"peer-generation">>, Created),
        <<"peer-token">> => OwnerToken
    },
    SourceMetadata = #{
        <<"source">> => #{
            <<"protocol">> => <<"rtmp">>,
            <<"playback">> => <<"webrtc">>
        }
    },
    {ok, Updated} = update(
        Base,
        Owner#{<<"metadata">> => SourceMetadata},
        Base
    ),
    ?assertEqual(SourceMetadata, maps:get(<<"metadata">>, Updated)),
    {ok, Closed} = close(Base, Owner, Base),
    ClosedCursor = maps:get(<<"current-cursor">>, Closed),
    {ok, Tombstone} = session(Base, Viewer, Base),
    ?assertEqual(<<"closed">>, maps:get(<<"session-status">>, Tombstone)),
    {ok, ClosedEvents} = events(
        Base,
        Viewer#{<<"after">> => ClosedCursor - 1},
        Base
    ),
    ?assertMatch(
        [#{<<"type">> := <<"session-closed">>}],
        maps:get(<<"events">>, ClosedEvents)
    ).

oversized_signal_is_rejected_without_cursor_test() ->
    Base = (test_base(<<"signal-limit">>))#{
        <<"hyperstream-max-signal-bytes">> => 8
    },
    {ok, Created} = create(
        Base,
        #{
            <<"request-id">> => <<"create-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"publisher">>,
            <<"peer-token">> => test_token(<<"publisher">>),
            <<"access">> => <<"open">>
        },
        Base
    ),
    {ok, Joined} = join(
        Base,
        #{
            <<"request-id">> => <<"join-1">>,
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"viewer">>,
            <<"peer-token">> => test_token(<<"viewer">>)
        },
        Base
    ),
    CursorBefore = maps:get(<<"current-cursor">>, Joined),
    ?assertMatch(
        {error, #{<<"status">> := 413, <<"reason">> := <<"signal-too-large">>}},
        signal(
            Base,
            #{
                <<"request-id">> => <<"signal-1">>,
                <<"session-id">> => <<"stream-1">>,
                <<"peer-id">> => <<"publisher">>,
                <<"peer-generation">> => maps:get(<<"peer-generation">>, Created),
                <<"peer-token">> => test_token(<<"publisher">>),
                <<"to-peer-id">> => <<"viewer">>,
                <<"connection-id">> => <<"pc-1">>,
                <<"body">> => <<"this payload is too large">>
            },
            Base
        )
    ),
    {ok, Snapshot} = session(
        Base,
        #{
            <<"session-id">> => <<"stream-1">>,
            <<"peer-id">> => <<"viewer">>,
            <<"peer-generation">> => maps:get(<<"peer-generation">>, Joined),
            <<"peer-token">> => test_token(<<"viewer">>)
        },
        Base
    ),
    ?assertEqual(CursorBefore, maps:get(<<"current-cursor">>, Snapshot)).

recording_signer_allowlist_is_fail_closed_test() ->
    Wallet = ar_wallet:new(),
    Base = test_base(<<"recording-allowlist">>),
    Opts = Base#{<<"priv-wallet">> => Wallet},
    {ok, Created} = create(
        Base,
        hb_message:commit(
            #{
                <<"device">> => ?DEVICE,
                <<"path">> => <<"create">>,
                <<"request-id">> => <<"create-1">>,
                <<"session-id">> => <<"stream-1">>,
                <<"peer-id">> => <<"publisher">>
            },
            Opts
        ),
        Opts
    ),
    Record = hb_message:commit(
        #{
            <<"device">> => ?DEVICE,
            <<"path">> => <<"record">>,
            <<"body">> => hb_json:encode(
                #{
                    <<"session-id">> => <<"stream-1">>,
                    <<"peer-id">> => <<"publisher">>,
                    <<"peer-generation">> =>
                        maps:get(<<"peer-generation">>, Created),
                    <<"request-id">> => <<"segment-1">>,
                    <<"expected-index">> => 1,
                    <<"segment">> => #{
                        <<"id">> => binary:copy(<<"A">>, 43)
                    }
                }
            )
        },
        Opts
    ),
    ?assertMatch(
        {
            error,
            #{
                <<"status">> := 403,
                <<"reason">> := <<"recording-signer-not-allowed">>
            }
        },
        record(Base, Record, Opts)
    ).

missing_recording_segment_does_not_advance_test() ->
    Store = hb_test_utils:test_store(),
    Wallet = ar_wallet:new(),
    Signer = hb_util:human_id(ar_wallet:to_address(Wallet)),
    Base = test_base(<<"missing-recording">>),
    Opts = Base#{
        <<"store">> => [Store],
        <<"priv-wallet">> => Wallet,
        <<"hyperstream-recording-signers">> => [Signer]
    },
    {ok, Created} = create(
        Base,
        hb_message:commit(
            #{
                <<"device">> => ?DEVICE,
                <<"path">> => <<"create">>,
                <<"request-id">> => <<"create-1">>,
                <<"session-id">> => <<"stream-1">>,
                <<"peer-id">> => <<"publisher">>
            },
            Opts
        ),
        Opts
    ),
    Member = #{
        <<"session-id">> => <<"stream-1">>,
        <<"peer-id">> => <<"publisher">>,
        <<"peer-generation">> => maps:get(<<"peer-generation">>, Created)
    },
    MissingID = binary:copy(<<"A">>, 43),
    ?assertMatch(
        {error, #{<<"status">> := 404, <<"reason">> := <<"segment-not-found">>}},
        record(
            Base,
            hb_message:commit(
                #{
                    <<"device">> => ?DEVICE,
                    <<"path">> => <<"record">>,
                    <<"body">> => hb_json:encode(
                        Member#{
                            <<"request-id">> => <<"segment-1">>,
                            <<"expected-index">> => 1,
                            <<"segment">> => #{<<"id">> => MissingID}
                        }
                    )
                },
                Opts
            ),
            Opts
        )
    ),
    {ok, Snapshot} = session(
        Base,
        hb_message:commit(
            Member#{
                <<"device">> => ?DEVICE,
                <<"path">> => <<"session">>
            },
            Opts
        ),
        Opts
    ),
    ?assertEqual(0, maps:get(<<"segment-count">>, Snapshot)).

recording_manifest_chain_test() ->
    Store = hb_test_utils:test_store(),
    Wallet = ar_wallet:new(),
    Signer = hb_util:human_id(ar_wallet:to_address(Wallet)),
    Base = test_base(<<"recording">>),
    Opts = Base#{
        <<"store">> => [Store],
        <<"priv-wallet">> => Wallet,
        <<"hyperstream-recording-signers">> => [Signer]
    },
    {ok, Created} = create(
        Base,
        hb_message:commit(
            #{
                <<"device">> => ?DEVICE,
                <<"path">> => <<"create">>,
                <<"request-id">> => <<"create-1">>,
                <<"session-id">> => <<"stream-1">>,
                <<"peer-id">> => <<"publisher">>
            },
            Opts
        ),
        Opts
    ),
    Member = #{
        <<"session-id">> => <<"stream-1">>,
        <<"peer-id">> => <<"publisher">>,
        <<"peer-generation">> => maps:get(<<"peer-generation">>, Created)
    },
    {ok, MediaID1} = hb_cache:write(<<"immutable-media-bytes-1">>, Opts),
    {ok, Recorded1} = record(
        Base,
        hb_message:commit(
            #{
                <<"device">> => ?DEVICE,
                <<"path">> => <<"record">>,
                <<"body">> => hb_json:encode(
                    Member#{
                        <<"request-id">> => <<"segment-1">>,
                        <<"expected-index">> => 1,
                        <<"segment">> => #{
                            <<"id">> => MediaID1,
                            <<"duration-ms">> => 2000
                        }
                    }
                )
            },
            Opts
        ),
        Opts
    ),
    Head1 = maps:get(<<"recording-head">>, Recorded1),
    LiveReplayID = maps:get(<<"replay-id">>, Recorded1),
    {ok, MediaID2} = hb_cache:write(<<"immutable-media-bytes-2">>, Opts),
    {ok, Recorded2} = record(
        Base,
        hb_message:commit(
            #{
                <<"device">> => ?DEVICE,
                <<"path">> => <<"record">>,
                <<"body">> => hb_json:encode(
                    Member#{
                        <<"request-id">> => <<"segment-2">>,
                        <<"expected-index">> => 2,
                        <<"previous">> => Head1,
                        <<"segment">> => #{
                            <<"id">> => MediaID2,
                            <<"duration-ms">> => 2000
                        }
                    }
                )
            },
            Opts
        ),
        Opts
    ),
    Head2 = maps:get(<<"recording-head">>, Recorded2),
    {ok, Entry2} = hb_cache:read(Head2, Opts),
    StoredSegment = hb_maps:get(<<"segment">>, Entry2, #{}, Opts),
    ?assertEqual(
        MediaID2,
        hb_maps:get(<<"id">>, StoredSegment, not_found, Opts)
    ),
    ?assertEqual(Head1, hb_maps:get(<<"previous">>, Entry2, not_found, Opts)),
    ?assertEqual(2, maps:get(<<"segment-count">>, Recorded2)),
    {ok, LiveReplay} = hb_cache:read(
        maps:get(<<"replay-id">>, Recorded2),
        Opts
    ),
    ?assertEqual(
        <<"live">>,
        hb_maps:get(<<"recording-status">>, LiveReplay, not_found, Opts)
    ),
    ?assertEqual(not_found, hb_maps:get(<<"session-metadata">>, LiveReplay, not_found, Opts)),
    {ok, Closed} = close(
        Base,
        hb_message:commit(
            Member#{
                <<"device">> => ?DEVICE,
                <<"path">> => <<"close">>
            },
            Opts
        ),
        Opts
    ),
    ReplayID = maps:get(<<"replay-id">>, Closed),
    {ok, Replay} = hb_cache:read(ReplayID, Opts),
    ?assertEqual(Head2, hb_maps:get(<<"recording-head">>, Replay, not_found, Opts)),
    ?assertEqual(
        maps:get(<<"replay-id">>, Recorded2),
        hb_maps:get(<<"previous-manifest">>, Replay, not_found, Opts)
    ),
    ?assertNotEqual(LiveReplayID, ReplayID),
    ?assertEqual(
        <<"closed">>,
        hb_maps:get(<<"recording-status">>, Replay, not_found, Opts)
    ).

http_test_opts(Suffix) ->
    (test_base(Suffix))#{
        <<"http-server">> => <<"test-server">>
    }.

test_seal_request(Operation, Plaintext) ->
    Info = dev_hyperstream_transport:key_info(),
    KeyID = maps:get(<<"key-id">>, Info),
    NodePublic = hb_util:decode(maps:get(<<"public-key">>, Info)),
    {ClientPublic, ClientPrivate} =
        crypto:generate_key(ecdh, secp256r1),
    Shared = crypto:compute_key(
        ecdh,
        NodePublic,
        ClientPrivate,
        secp256r1
    ),
    Key = test_transport_key(
        Shared,
        NodePublic,
        ClientPublic,
        KeyID
    ),
    Nonce = crypto:strong_rand_bytes(12),
    {Ciphertext, Tag} = crypto:crypto_one_time_aead(
        aes_256_gcm,
        Key,
        Nonce,
        Plaintext,
        test_transport_aad(<<"request">>, Operation, KeyID),
        true
    ),
    Envelope = <<
        "hs1.",
        KeyID/binary,
        ".",
        (hb_util:encode(ClientPublic))/binary,
        ".",
        (hb_util:encode(Nonce))/binary,
        ".",
        (hb_util:encode(<<Ciphertext/binary, Tag/binary>>))/binary
    >>,
    {Envelope, #{key_id => KeyID, key => Key}}.

test_open_response(
    Operation,
    Envelope,
    #{key_id := ExpectedKeyID, key := Key}
) ->
    [<<"hs1r">>, ExpectedKeyID, EncodedNonce, EncodedCombined] =
        binary:split(Envelope, <<".">>, [global]),
    Nonce = hb_util:decode(EncodedNonce),
    Combined = hb_util:decode(EncodedCombined),
    CiphertextBytes = byte_size(Combined) - 16,
    <<Ciphertext:CiphertextBytes/binary, Tag:16/binary>> = Combined,
    crypto:crypto_one_time_aead(
        aes_256_gcm,
        Key,
        Nonce,
        Ciphertext,
        test_transport_aad(
            <<"response">>,
            Operation,
            ExpectedKeyID
        ),
        Tag,
        false
    ).

test_transport_key(Shared, NodePublic, ClientPublic, KeyID) ->
    Salt = crypto:hash(
        sha256,
        <<NodePublic/binary, ClientPublic/binary>>
    ),
    PseudoRandomKey = crypto:mac(hmac, sha256, Salt, Shared),
    Info = <<"hyperstream@1.0/transport/", KeyID/binary>>,
    crypto:mac(
        hmac,
        sha256,
        PseudoRandomKey,
        <<Info/binary, 1>>
    ).

test_transport_aad(Direction, Operation, KeyID) ->
    <<
        "hyperstream-transport@1",
        0,
        Direction/binary,
        0,
        Operation/binary,
        0,
        KeyID/binary
    >>.

test_base(Suffix) ->
    #{
        <<"hyperstream-namespace">> =>
            <<"test-", Suffix/binary, "-", (integer_to_binary(erlang:unique_integer([positive])))/binary>>
    }.

test_token(Label) ->
    <<Label/binary, "-0123456789abcdef0123456789abcdef">>.

store_contains(Store, Needle) ->
    #{<<"ets-table">> := Table} = hb_store:find(Store),
    lists:any(
        fun(Entry) ->
            binary:match(term_to_binary(Entry), Needle) =/= nomatch
        end,
        ets:tab2list(Table)
    ).

-endif.
