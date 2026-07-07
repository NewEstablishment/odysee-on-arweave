%%% @doc An implementation of the `reference@1.0' record specification: a
%%% mutable reference is created by an `init' record and moved by `set' records,
%%% where a set applies only if it is committed by the reference's AUTHORITY and
%%% carries a timestamp strictly greater than the current state's. The effective
%%% value of a state is its `reference-value' when present, else the record
%%% message itself. The reference's id is the id of its init record.
%%%
%%% The spec's record kinds are named `init' and `set', but both are reserved
%%% AO-Core verbs as device keys (`init' runs when a device is set on a message;
%%% `set' is the message setter), so this device exposes them as `create' and
%%% `update'. `current'/`resolve' return the resolved state.
%%%
%%% The authority of a new reference defaults to its verified committer; an
%%% explicit `authority' field overrides it (the bootstrap-publisher shape, where
%%% a trusted publisher creates a reference on behalf of another wallet). An
%%% update must be committed by the authority itself: a foreign or unsigned
%%% update is rejected (403), and a non-newer timestamp is rejected (409) without
%%% mutating the state.
%%%
%%% The current state is stored as an explicit map (authority, timestamp, value,
%%% source) because the cache retains only a message's content-id commitment,
%%% not its wallet signature -- the authority check is pinned from the signature
%%% verified at write time. Every outcome is returned as `{ok, Map}' carrying an
%%% HTTP `status', never a bare `{error, _}'.
%%%
%%% This module is deliberately self-contained (no `lib_' dependencies): a
%%% conforming implementation should be reproducible from the specification
%%% alone, since consumers trust it by its signer, not by its lineage.
-module(dev_reference).
-implements(<<"reference@1.0">>).
-export([info/1, create/3, update/3, current/3, resolve/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

%%% The store namespace under which reference states are kept.
-define(REFERENCE_CACHE, <<"reference@1.0">>).

%% @doc Device info: the resolved keys this device exports.
info(_Opts) ->
    #{
        exports => [<<"create">>, <<"update">>, <<"current">>, <<"resolve">>]
    }.

%% @doc Create a reference (the spec's `init' record). Requires a verifiable
%% committer; the authority defaults to that committer unless an explicit
%% `authority' field names another wallet. The new reference's id is the id of
%% the stored init record.
create(Base, Req, Opts) ->
    Subject = signed_subject(Base, Req, Opts),
    case verified_signer(Subject, Opts) of
        {ok, Signer} ->
            Authority =
                case param(Base, Req, [<<"authority">>], Opts) of
                    {ok, Explicit} -> Explicit;
                    {error, _} -> Signer
                end,
            case hb_cache:write(Subject, Opts) of
                {ok, ReferenceID} ->
                    State = #{
                        <<"reference-id">> => ReferenceID,
                        <<"authority">> => Authority,
                        <<"timestamp">> => timestamp_of(Base, Req, Opts),
                        <<"source">> => <<"init">>
                    },
                    store_state(with_value(State, Base, Req, Opts), Opts);
                {error, Reason} ->
                    error_response(Reason)
            end;
        error ->
            unauthorized()
    end.

%% @doc Move a reference (the spec's `set' record). Applies only if the request
%% is committed by the reference's authority and its `timestamp' is strictly
%% greater than the current state's; otherwise the state is unchanged.
update(Base, Req, Opts) ->
    case param(Base, Req, [<<"reference-id">>, <<"reference">>], Opts) of
        {ok, ReferenceID} ->
            case read_state(ReferenceID, Opts) of
                {ok, State} -> apply_update(ReferenceID, State, Base, Req, Opts);
                not_found -> error_response(not_found)
            end;
        {error, Reason} ->
            error_response(Reason)
    end.

apply_update(ReferenceID, State, Base, Req, Opts) ->
    Subject = signed_subject(Base, Req, Opts),
    Authority = hb_maps:get(<<"authority">>, State, undefined, Opts),
    case verified_signer(Subject, Opts) of
        {ok, Authority} ->
            Current = hb_maps:get(<<"timestamp">>, State, 0, Opts),
            Proposed = timestamp_of(Base, Req, Opts),
            case Proposed > Current of
                true ->
                    Next = State#{
                        <<"timestamp">> => Proposed,
                        <<"source">> => <<"set">>
                    },
                    store_state(
                        with_value(hb_maps:without([<<"reference-value">>], Next, Opts),
                            Base, Req, Opts),
                        Opts
                    );
                false ->
                    stale(Current, Proposed)
            end;
        _ ->
            unauthorized()
    end.

%% @doc Return the CURRENT resolved state of a reference, read fresh through the
%% store so the latest applied update wins.
current(Base, Req, Opts) ->
    case param(Base, Req, [<<"reference-id">>, <<"reference">>], Opts) of
        {ok, ReferenceID} ->
            case read_state(ReferenceID, Opts) of
                {ok, State} ->
                    ?event(reference,
                        {current, {reference_id, ReferenceID}, {hit, true}},
                        Opts
                    ),
                    {ok, State};
                not_found ->
                    error_response(not_found)
            end;
        {error, Reason} ->
            error_response(Reason)
    end.

%% @doc Alias for `current'.
resolve(Base, Req, Opts) ->
    current(Base, Req, Opts).

%%% Internal helpers.

%% @doc Carry the record's `reference-value' onto the state when one is present.
%% A record without a value leaves the state valueless: its effective value is
%% the record itself, reachable via `reference-id'.
with_value(State, Base, Req, Opts) ->
    case param(Base, Req, [<<"reference-value">>, <<"value">>], Opts) of
        {ok, Value} -> State#{ <<"reference-value">> => Value };
        {error, _} -> State
    end.

%% @doc Persist a state map and repoint the reference's stable link at it.
store_state(State, Opts) ->
    ReferenceID = hb_maps:get(<<"reference-id">>, State, undefined, Opts),
    case hb_cache:write(State, Opts) of
        {ok, Id} ->
            ok = hb_cache:link(Id, link_path(ReferenceID), Opts),
            ?event(reference,
                {store_state, {reference_id, ReferenceID}, {id, Id}},
                Opts
            ),
            {ok, State#{ <<"status">> => 200 }};
        {error, Reason} ->
            error_response(Reason)
    end.

read_state(ReferenceID, Opts) ->
    case hb_cache:read(link_path(ReferenceID), Opts) of
        {ok, State} -> {ok, State};
        not_found -> not_found;
        {error, _} -> not_found
    end.

link_path(ReferenceID) ->
    << ?REFERENCE_CACHE/binary, "/", ReferenceID/binary >>.

%% @doc The record's timestamp, as an integer; absent or malformed reads as 0,
%% mirroring the spec's lenient timestamp parse.
timestamp_of(Base, Req, Opts) ->
    case param(Base, Req, [<<"timestamp">>], Opts) of
        {ok, Raw} ->
            try hb_util:int(Raw) catch _:_ -> 0 end;
        {error, _} ->
            0
    end.

%% @doc Prefer whichever of the request or base carries a commitment, so the
%% authority check sees the signer regardless of invocation shape.
signed_subject(Base, Req, Opts) ->
    case hb_message:signers(Req, Opts) of
        [] ->
            case hb_message:signers(Base, Opts) of
                [] -> Req;
                _ -> Base
            end;
        _ ->
            Req
    end.

%% @doc Verify the subject's signer commitment and return the committer. An
%% unsigned message, or one whose commitment does not verify, yields `error',
%% so a forged or absent signature can never create or move a reference.
verified_signer(Subject, Opts) ->
    case hb_message:signers(Subject, Opts) of
        [Signer | _] ->
            case hb_message:verify(Subject, signers, Opts) of
                true -> {ok, Signer};
                _ -> error
            end;
        [] ->
            error
    end.

%% @doc Read the first present, non-empty value among `Keys' from the request,
%% then the base. Timestamps arrive as integers over some transports, so
%% integer values are normalized to binaries.
param(Base, Req, Keys, Opts) ->
    Paths = lists:flatmap(fun(Key) -> [{Req, Key}, {Base, Key}] end, Keys),
    case hb_maps:get_first(Paths, not_found, Opts) of
        Value when is_binary(Value), byte_size(Value) > 0 -> {ok, Value};
        Value when is_integer(Value) -> {ok, hb_util:bin(Value)};
        _ -> {error, {missing_required, hd(Keys)}}
    end.

unauthorized() ->
    {ok, #{ <<"status">> => 403, <<"message">> => <<"Unauthorized.">> }}.

stale(Current, Proposed) ->
    {ok, #{
        <<"status">> => 409,
        <<"message">> => <<"Timestamp is not newer than the current state.">>,
        <<"current-timestamp">> => Current,
        <<"proposed-timestamp">> => Proposed
    }}.

error_response(not_found) ->
    {ok, #{ <<"status">> => 404, <<"message">> => <<"Reference not found.">> }};
error_response({missing_required, Key}) ->
    {ok, #{
        <<"status">> => 400,
        <<"message">> => <<"Missing required field.">>,
        <<"field">> => Key
    }};
error_response(Reason) ->
    {ok, #{
        <<"status">> => 500,
        <<"message">> => hb_util:bin(io_lib:format("~p", [Reason]))
    }}.
