%%% @doc A local, updatable reference device: the mutable "stable reference key
%%% -> current immutable id" layer (a claim-id -> current content-id pointer).
%%%
%%% The team's named `reference@1.0' is a REMOTE device published to Arweave and
%%% architecture-locked, so it cannot load here. This device provides the same
%%% primitive locally on top of `hb_cache:link', which REPOINTS a key at runtime:
%%% `set(K -> A)' then `set(K -> B)' leaves `current(K)' returning B.
%%%
%%% Why this is built on `hb_cache:link'/`hb_cache:read' and NOT on
%%% `~local-name@1.0': `dev_local_name' caches its names in the in-memory node
%%% message and serves `lookup' from that cache first, so a re-register returns a
%%% STALE value. This device keeps NO in-memory copy -- `set' rewrites the store
%%% link in place (the fs/lmdb backends delete-and-recreate an existing link) and
%%% `current'/`resolve' always read through the store -- so the in-place update is
%%% observed immediately.
%%%
%%% `set' is operator-gated (mirroring `dev_local_name:register'): the caller must
%%% be the node operator, established by an operator signature on the request via
%%% `~meta@1.0/is-operator'. On an unclaimed node (no operator/wallet configured)
%%% the gate is permissive. `current'/`resolve' are unauthenticated reads.
%%%
%%% Node configuration note: because a reference is mutable at a constant path, a
%%% live HTTP node MUST disable result caching for these reads -- set
%%% `http-extra-opts => #{ <<"force-message">> => true, <<"cache-control">> =>
%%% [<<"no-store">>, <<"no-cache">>] }' -- or `current' will serve a cached prior
%%% target. The in-process `hb_ao:resolve' path used by the tests is unaffected.
-module(dev_odysee_reference).
-implements(<<"odysee-reference@1.0">>).
-export([info/1, point/3, current/3, resolve/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

%%% The store namespace under which reference links are kept.
-define(REF_CACHE, <<"odysee-reference@1.0">>).

info(_Opts) ->
    #{
        exports => [<<"point">>, <<"current">>, <<"resolve">>]
    }.

%% @doc Point a stable reference key at a target immutable id (the meeting's
%% "set" operation). Operator-gated. `key' is the stable reference name;
%% `target' is the immutable id (or path) that already resolves in the cache.
%% Repoints the link in place via `hb_cache:link', overwriting any prior target.
%% Returns the key and the target it now resolves to.
%%
%% Why the key is `point' and NOT `set': `set' is a RESERVED AO-Core
%% message-manipulation verb. A `set' key is never dispatched cleanly to a device
%% function -- the resolver routes it through `hb_ao:device_set', which (a)
%% unwraps the result with `hb_util:ok' and THROWS on a bare `{error, _}', and
%% (b) re-bases the request as a key-set operation, STRIPPING the request's
%% commitments so an operator-signature check can no longer see the signer
%% (measured: an operator-signed `set' is seen as unauthenticated). `point' is a
%% non-reserved key, dispatched directly to `point/3' with the request -- and its
%% commitments -- intact. (The repoint primitive and the gate are unchanged; only
%% the key name differs from the meeting's informal "set".)
%%
%% Every outcome is still returned as `{ok, Map}' carrying an HTTP `status'
%% (never a bare `{error, _}'), the `dev_odysee' idiom, so a non-2xx outcome maps
%% to the right HTTP status.
point(Base, Req, Opts) ->
    case is_operator(Base, Req, Opts) of
        false ->
            unauthorized();
        true ->
            case reference_key(Base, Req, Opts) of
                {ok, NormKey} ->
                    point_target(NormKey, Base, Req, Opts);
                {error, Reason} ->
                    error_response(Reason)
            end
    end.

point_target(NormKey, Base, Req, Opts) ->
    case target(Base, Req, Opts) of
        {ok, Target} ->
            LinkPath = link_path(NormKey),
            ok = hb_cache:link(Target, LinkPath, Opts),
            ?event(odysee_reference,
                {point, {key, NormKey}, {target, Target}, {path, LinkPath}},
                Opts
            ),
            {ok, #{
                <<"status">> => 200,
                <<"key">> => NormKey,
                <<"target">> => Target
            }};
        {error, Reason} ->
            error_response(Reason)
    end.

%% @doc Return the CURRENT target for a reference key by following the link
%% through the store. Reads fresh every time -- no in-memory cache -- so the
%% latest `point' wins.
current(Base, Req, Opts) ->
    case reference_key(Base, Req, Opts) of
        {ok, NormKey} ->
            case hb_cache:read(link_path(NormKey), Opts) of
                {ok, Value} ->
                    ?event(odysee_reference,
                        {current, {key, NormKey}, {hit, true}},
                        Opts
                    ),
                    {ok, Value};
                not_found ->
                    error_response(not_found);
                {error, Reason} ->
                    error_response(Reason)
            end;
        {error, Reason} ->
            error_response(Reason)
    end.

%% @doc Alias for `current'.
resolve(Base, Req, Opts) ->
    current(Base, Req, Opts).

%% @doc The reference key, normalized. Accepts `key', `claim-id', or `reference'.
reference_key(Base, Req, Opts) ->
    case param(Base, Req, [<<"key">>, <<"claim-id">>, <<"claim_id">>, <<"reference">>], Opts) of
        {ok, Key} -> {ok, hb_ao:normalize_key(Key)};
        Error -> Error
    end.

%% @doc Resolve the target to link to. A `target' (id or path) is linked
%% directly. As a convenience, an inline `value' message is written to the cache
%% first and the resulting id is used as the target.
target(Base, Req, Opts) ->
    case param(Base, Req, [<<"target">>, <<"id">>], Opts) of
        {ok, Target} ->
            {ok, Target};
        {error, _} ->
            target_from_value(Base, Req, Opts)
    end.

target_from_value(Base, Req, Opts) ->
    case hb_maps:get(<<"value">>, Req, not_found, Opts) of
        not_found ->
            case hb_maps:get(<<"value">>, Base, not_found, Opts) of
                not_found -> {error, {missing_required, <<"target">>}};
                Value -> write_value(Value, Opts)
            end;
        Value ->
            write_value(Value, Opts)
    end.

write_value(Value, Opts) ->
    case hb_cache:write(Value, Opts) of
        {ok, Id} -> {ok, Id};
        {error, Reason} -> {error, Reason}
    end.

%% @doc Whether the operation is authorized by the node operator. Permissive on
%% an unclaimed node (matching `dev_local_name:register'). The operator signature
%% may sit on EITHER the request (the HTTP singleton / `body' path, as for
%% `dev_simple_pay') OR the base message (when a committed message is resolved
%% in-process as the subject) -- so the signed one of the two is handed to
%% `~meta@1.0/is-operator' for the signer check.
is_operator(Base, Req, Opts) ->
    Subject = signed_subject(Base, Req, Opts),
    case hb_ao:resolve(
        #{ <<"device">> => <<"meta@1.0">> },
        #{ <<"path">> => <<"is-operator">>, <<"body">> => Subject },
        Opts#{ <<"hashpath">> => ignore }
    ) of
        {ok, Result} -> Result;
        _ -> false
    end.

%% @doc Prefer whichever of the request or base carries a commitment, so the
%% operator-signature check sees the signer regardless of invocation shape. On an
%% unclaimed node neither is signed and the request is used (the gate is
%% permissive anyway).
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

link_path(NormKey) ->
    << ?REF_CACHE/binary, "/", NormKey/binary >>.

param(Base, Req, Keys, Opts) ->
    case hb_maps:get_first(param_paths(Base, Req, Keys), not_found, Opts) of
        Value when is_binary(Value), byte_size(Value) > 0 -> {ok, Value};
        _ -> {error, {missing_required, hd(Keys)}}
    end.

param_paths(Base, Req, Keys) ->
    lists:flatmap(
        fun(Key) ->
            [{Req, Key}, {Base, Key}]
        end,
        Keys
    ).

%% @doc All error outcomes are returned as `{ok, #{status => ...}}', not
%% `{error, _}': see the note on `set/3' -- the reserved `set' verb's
%% `hb_util:ok' wrapper throws on a bare `{error, _}'. The HTTP layer maps a
%% non-2xx `status' to the response code regardless.
unauthorized() ->
    {ok, #{ <<"status">> => 403, <<"message">> => <<"Unauthorized.">> }}.

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
