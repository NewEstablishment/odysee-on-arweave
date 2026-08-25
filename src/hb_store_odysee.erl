%%% @doc Read-only Odysee source store.
%%%
%%% This store fronts the LBRY evidence stores and the Odysee SDK proxy with
%%% one stable `odysee/' path namespace, returning only verifiable objects:
%%% every message it yields carries native `lbry@1.0' commitments that are
%%% verified through `hb_message:verify/3' and narrowed to their committed
%%% keys before they leave the store. The SDK proxy is used purely as a
%%% locator (URI or claim id to `txid:nout'); every fact in a returned
%%% message is re-derived from raw transactions, claim protobufs, and
%%% content-addressed blobs fetched through the kind stores. Callers can
%%% place this store below a local cache or behind `hb_store_remote_node'
%%% and re-verify the returned messages through normal `hb_message:verify/3'.
%%%
%%% Supported read paths (bare keys are classified onto them):
%%% <ul>
%%%   <li>`odysee/claim/(uri)': resolve a `lbry://' URI to claim evidence.</li>
%%%   <li>`odysee/claim-id/(id)': locate a claim by id (40 hex chars).</li>
%%%   <li>`odysee/channel/(uri-or-id)': channel evidence with the
%%%       normalized channel public key.</li>
%%%   <li>`odysee/stream/(uri)': stream claim evidence, carrying the
%%%       channel attestation commitment when the claim is signed.</li>
%%%   <li>`odysee/stream-id/(txid:nout)': stream evidence by outpoint.</li>
%%%   <li>`odysee/outpoint/(txid)/(nout)' and
%%%       `odysee/claim-output/(txid)/(nout)': immutable claim-output
%%%       evidence, trying the stream and channel kinds before the
%%%       default.</li>
%%%   <li>`odysee/transaction/(txid)': raw transaction evidence.</li>
%%%   <li>`odysee/descriptor/(sd-hash)': stream descriptor evidence.</li>
%%%   <li>`odysee/blob/(blob-hash)': encrypted blob evidence.</li>
%%%   <li>`odysee/media/...': range-capable decrypted media reads over a
%%%       stream's descriptor, served through `hb_odysee_bridge'.</li>
%%%   <li>`odysee/source-claims/(encoded-query)': bounded legacy discovery
%%%       for server-side materializers. Results are locators only; callers
%%%       must hydrate the returned outpoints through immutable reads.</li>
%%% </ul>
-module(hb_store_odysee).
-export([start/3, stop/3, reset/3, scope/1]).
-export([read/3, type/3, resolve/3, list/3]).
-export([write/3, group/3, link/3]).

-define(DEFAULT_RANGE_SIZE, 1048576).

start(_StoreOpts, _Req, _NodeOpts) ->
    ok.

stop(_StoreOpts, _Req, _NodeOpts) ->
    ok.

reset(_StoreOpts, _Req, _NodeOpts) ->
    ok.

scope(_StoreOpts) ->
    remote.

resolve(_StoreOpts, #{ <<"resolve">> := Key }, _NodeOpts) ->
    {ok, normalize_key(Key)}.

type(StoreOpts, #{ <<"type">> := Key }, NodeOpts) ->
    case read(StoreOpts, #{ <<"read">> => Key }, NodeOpts) of
        {ok, Msg} when is_map(Msg) -> {ok, composite};
        {ok, _Bin} -> {ok, simple};
        Error -> Error
    end.

list(StoreOpts, #{ <<"list">> := Key } = Req, NodeOpts) ->
    Path = canonical_list_path(normalize_key(Key)),
    case fixture(Path, StoreOpts, NodeOpts) of
        {ok, Items} when is_list(Items) ->
            {ok, Items};
        {ok, Msg} ->
            {ok, list_search_ids(Path, Msg, NodeOpts)};
        not_found ->
            list_live(Path, Req, StoreOpts, NodeOpts)
    end.

write(_StoreOpts, _Req, _NodeOpts) ->
    {error, 'read-only'}.

group(_StoreOpts, _Req, _NodeOpts) ->
    {error, 'read-only'}.

link(_StoreOpts, _Req, _NodeOpts) ->
    {error, 'read-only'}.

%% @doc Read a public Odysee object by a stable store path.
read(StoreOpts, Req = #{ <<"read">> := Key }, NodeOpts) ->
    BareKey = normalize_key(Key),
    Path = canonical_read_path(BareKey),
    Result =
        case fixture(Path, StoreOpts, NodeOpts) of
            {ok, Msg} ->
                fixture_result(Msg, NodeOpts);
            not_found ->
                case read_live(Path, Req, StoreOpts, NodeOpts) of
                    {ok, LiveMsg} = OK when is_map(LiveMsg) ->
                        warm_addresses(BareKey, Path, LiveMsg, StoreOpts, NodeOpts),
                        OK;
                    Other ->
                        Other
                end
        end,
    with_http_status(Result).

%% HyperBEAM derives a response status through `dev_meta:message_to_status/2',
%% which recognises a fixed set of atoms and falls through to a `200'
%% catch-all for everything else. A bare `{error, invalid_outpoint}' is
%% therefore served as HTTP 200 with the reason as the body, and a caller
%% cannot tell a served object from a refused one. Carry the status
%% explicitly so the boundary reports what actually happened.
%%
%% `not_found' is left exactly as it is: it already maps to 404, and callers
%% (`dev_cache' among them) branch on that precise shape to fall back.
with_http_status({error, not_found} = NotFound) ->
    NotFound;
with_http_status({error, Reason}) when is_atom(Reason) ->
    {error, #{
        <<"status">> => error_status(Reason),
        <<"body">> => atom_to_binary(Reason, utf8)
    }};
%% Tuple reasons only arise after input validation (a malformed path yields
%% an atom via `require_hex_size'/`valid_hex_size'): they carry the detail of
%% something the legacy source returned that did not parse or verify, e.g.
%% `{txid_mismatch, _, _}', `{hash_mismatch, _, _}', `{http_status, 4xx, _}'.
%% That is an upstream fault, so 502, with the tag as the body.
with_http_status({error, Reason}) when is_tuple(Reason), is_atom(element(1, Reason)) ->
    {error, #{
        <<"status">> => 502,
        <<"body">> => atom_to_binary(element(1, Reason), utf8)
    }};
with_http_status(Other) ->
    Other.

%% The caller named something that cannot address an object.
error_status(invalid_claim_id) -> 400;
error_status(invalid_nout) -> 400;
error_status(invalid_odysee_store_path) -> 400;
error_status(invalid_outpoint) -> 400;
error_status(invalid_outpoint_path) -> 400;
error_status(invalid_range) -> 400;
error_status(invalid_txid) -> 400;
error_status(missing_nout) -> 400;
error_status(missing_txid) -> 400;
%% The legacy source answered, but what it returned does not verify. The
%% request was well formed, so this is an upstream fault rather than a
%% client one.
error_status(invalid_claim_signature) -> 502;
error_status(invalid_evidence) -> 502;
error_status(invalid_proxy_json) -> 502;
error_status(invalid_tx_hex) -> 502;
error_status(native_commitment_failure) -> 502;
error_status(unsigned_claim) -> 502;
error_status(protected) -> 403;
%% Anything else is an object we cannot produce: absent upstream, or a claim
%% whose kind did not match the one the path asked for.
error_status(_) -> 404.

read_live(<<"odysee/media/stream-id/", Encoded/binary>>, Req, StoreOpts, NodeOpts) ->
    media_from_stream_path(<<"odysee/stream-id/", Encoded/binary>>, Req, StoreOpts, NodeOpts);
read_live(<<"odysee/media/stream/", Encoded/binary>>, Req, StoreOpts, NodeOpts) ->
    media_from_stream_path(<<"odysee/stream/", Encoded/binary>>, Req, StoreOpts, NodeOpts);
read_live(<<"odysee/media/sd-hash/", SDHash/binary>>, Req, StoreOpts, NodeOpts) ->
    media_response(#{ <<"sd-hash">> => SDHash }, Req, store_node_opts(StoreOpts, NodeOpts));
read_live(<<"odysee/media/descriptor/", SDHash/binary>>, Req, StoreOpts, NodeOpts) ->
    media_response(#{ <<"sd-hash">> => SDHash }, Req, store_node_opts(StoreOpts, NodeOpts));
read_live(Path, _Req, StoreOpts, NodeOpts) ->
    read_live(Path, StoreOpts, NodeOpts).

read_live(<<"odysee/claim-meta/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    claim_meta_read(Encoded, StoreOpts, NodeOpts);
read_live(<<"odysee/claim/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, URI} ?= decode_uri_component(Encoded),
        {ok, Claim} ?=
            hb_odysee_client:resolve(URI, store_node_opts(StoreOpts, NodeOpts)),
        claim_evidence(Claim, undefined, StoreOpts, NodeOpts)
    end;
read_live(<<"odysee/claim-id/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, Decoded} ?= decode_component(Encoded),
        ClaimID = normalize_hex(Decoded),
        ok ?= require_hex_size(ClaimID, 40, invalid_claim_id),
        {ok, Claim} ?=
            hb_odysee_client:claim_search(
                ClaimID,
                store_node_opts(StoreOpts, NodeOpts)
            ),
        claim_evidence(Claim, ClaimID, StoreOpts, NodeOpts)
    end;
read_live(<<"odysee/channel-id/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    read_live(<<"odysee/channel/", Encoded/binary>>, StoreOpts, NodeOpts);
read_live(<<"odysee/source-claims/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    source_claims_read(Encoded, StoreOpts, NodeOpts);
read_live(<<"odysee/channel/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, Decoded} ?= decode_component(Encoded),
        channel_read(Decoded, StoreOpts, NodeOpts)
    end;
read_live(<<"odysee/stream/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, URI} ?= decode_uri_component(Encoded),
        {ok, Claim} ?=
            hb_odysee_client:resolve(URI, store_node_opts(StoreOpts, NodeOpts)),
        {ok, TxID} ?= claim_txid(Claim),
        {ok, Nout} ?= claim_nout(Claim),
        {ok, Msg} ?= outpoint_evidence(<<"stream">>, TxID, Nout, StoreOpts, NodeOpts),
        evidence_result(Msg, NodeOpts)
    end;
read_live(<<"odysee/stream-id/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, Outpoint} ?= decode_component(Encoded),
        {ok, TxID, Nout} ?= parse_bare_outpoint(Outpoint),
        {ok, Msg} ?= outpoint_evidence(<<"stream">>, TxID, Nout, StoreOpts, NodeOpts),
        evidence_result(Msg, NodeOpts)
    end;
read_live(<<"odysee/outpoint/", Rest/binary>>, StoreOpts, NodeOpts) ->
    read_live(<<"odysee/claim-output/", Rest/binary>>, StoreOpts, NodeOpts);
read_live(<<"odysee/claim-output/", Rest/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, TxID, Nout} ?= outpoint_path(Rest),
        read_native_outpoint(TxID, Nout, StoreOpts, NodeOpts)
    end;
read_live(<<"odysee/transaction/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, Decoded} ?= decode_component(Encoded),
        TxID = normalize_hex(Decoded),
        ok ?= require_hex_size(TxID, 64, invalid_txid),
        {ok, Msg} ?=
            hb_store_lbry_transaction:read(
                StoreOpts,
                #{ <<"read">> => TxID },
                NodeOpts
            ),
        evidence_result(Msg, NodeOpts)
    end;
read_live(<<"odysee/descriptor/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, SDHash} ?= decode_component(Encoded),
        {ok, Msg} ?=
            hb_store_lbry_stream_descriptor:read(
                StoreOpts,
                #{ <<"read">> => SDHash },
                NodeOpts
            ),
        evidence_result(Msg, NodeOpts)
    end;
read_live(<<"odysee/blob/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, Hash} ?= decode_component(Encoded),
        {ok, Msg} ?=
            hb_store_lbry_blob:read(
                StoreOpts,
                #{ <<"read">> => Hash },
                NodeOpts
            ),
        evidence_result(Msg, NodeOpts)
    end;
read_live(_Path, _StoreOpts, _NodeOpts) ->
    {error, not_found}.

%% @doc Build claim-family evidence from an SDK-located claim. The claim map
%% only supplies the immutable outpoint locator and the kind routing hint;
%% the evidence message is constructed from the raw transaction through the
%% claim-output store, so every returned fact is re-derived from committed
%% bytes. When the locator was addressed by claim id, the id derived from
%% the raw output must match the request.
claim_evidence(Claim, RequiredClaimID, StoreOpts, NodeOpts) ->
    maybe
        {ok, TxID} ?= claim_txid(Claim),
        {ok, Nout} ?= claim_nout(Claim),
        {ok, Msg} ?=
            outpoint_evidence(claim_kind(Claim), TxID, Nout, StoreOpts, NodeOpts),
        ok ?= require_claim_id(RequiredClaimID, Msg),
        evidence_result(Msg, NodeOpts)
    end.

%% Display-only compatibility metadata that cannot be derived from claim
%% bytes. Keep it on a separate uncommitted path so it never becomes part of
%% verified claim evidence.
claim_meta_read(Encoded, StoreOpts, NodeOpts) ->
    maybe
        {ok, Decoded} ?= decode_component(Encoded),
        ClaimID = normalize_hex(Decoded),
        ok ?= require_hex_size(ClaimID, 40, invalid_claim_id),
        {ok, Claim} ?=
            hb_odysee_client:claim_search(
                ClaimID,
                store_node_opts(StoreOpts, NodeOpts)
            ),
        {ok,
            maps:filter(
                fun(_K, V) -> V =/= not_found end,
                #{
                    <<"claim-id">> => ClaimID,
                    <<"timestamp">> =>
                        first_found([<<"timestamp">>], Claim, not_found, NodeOpts),
                    <<"height">> =>
                        first_found([<<"height">>], Claim, not_found, NodeOpts),
                    <<"source">> => <<"legacy-compatibility">>
                }
            )}
    end.

%% @doc Read a channel by claim id or `lbry://' URI. The channel-output
%% constructor fails closed when the located output is not a channel claim.
channel_read(Decoded, StoreOpts, NodeOpts) ->
    ChannelID = normalize_hex(Decoded),
    case valid_hex_size(ChannelID, 20) of
        true ->
            maybe
                {ok, Claim} ?=
                    hb_odysee_client:claim_search(
                        ChannelID,
                        store_node_opts(StoreOpts, NodeOpts)
                    ),
                channel_evidence(Claim, ChannelID, StoreOpts, NodeOpts)
            end;
        false ->
            maybe
                {ok, Claim} ?=
                    hb_odysee_client:resolve(
                        restore_uri_scheme(Decoded),
                        store_node_opts(StoreOpts, NodeOpts)
                    ),
                channel_evidence(Claim, undefined, StoreOpts, NodeOpts)
            end
    end.

channel_evidence(Claim, RequiredClaimID, StoreOpts, NodeOpts) ->
    maybe
        {ok, TxID} ?= claim_txid(Claim),
        {ok, Nout} ?= claim_nout(Claim),
        {ok, Msg} ?= kind_output(<<"channel">>, TxID, Nout, StoreOpts, NodeOpts),
        ok ?= require_claim_id(RequiredClaimID, Msg),
        evidence_result(Msg, NodeOpts)
    end.

claim_kind(Claim) when is_map(Claim) ->
    case maps:get(<<"value_type">>, Claim, undefined) of
        <<"channel">> -> <<"channel">>;
        <<"stream">> -> <<"stream">>;
        _ -> <<"claim">>
    end;
claim_kind(_Claim) ->
    <<"claim">>.

%% @doc Construct evidence for one output through the claim-output store,
%% attaching the channel attestation commitment to signed stream claims.
outpoint_evidence(<<"stream">>, TxID, Nout, StoreOpts, NodeOpts) ->
    case kind_output(<<"stream">>, TxID, Nout, StoreOpts, NodeOpts) of
        {ok, StreamMsg} ->
            attach_attestation(StreamMsg, StoreOpts, NodeOpts);
        {error, not_a_stream_claim} ->
            %% The SDK labels livestream placeholders `stream', but their
            %% protobuf carries no source, so no sd-hash exists and the
            %% stream constructor fails closed. The claim itself is still
            %% valid and verifiable, it simply has no stream media, so serve
            %% generic claim evidence rather than failing the whole read.
            %% Only this label degrades: a transport failure must propagate,
            %% or a transient proxy error silently yields sd-hash-less
            %% evidence and media reads fail with `missing_sd_hash'.
            kind_output(<<"claim">>, TxID, Nout, StoreOpts, NodeOpts);
        Error ->
            Error
    end;
outpoint_evidence(Kind, TxID, Nout, StoreOpts, NodeOpts) ->
    kind_output(Kind, TxID, Nout, StoreOpts, NodeOpts).

kind_output(Kind, TxID, Nout, StoreOpts, NodeOpts) ->
    Store =
        case Kind of
            <<"claim">> -> maps:remove(<<"kind">>, StoreOpts);
            _ -> maps:put(<<"kind">>, Kind, StoreOpts)
        end,
    hb_store_lbry_claim_output:read(
        Store,
        #{ <<"read">> => <<TxID/binary, ":", (integer_to_binary(Nout))/binary>> },
        NodeOpts
    ).

%% @doc Bind the channel attestation to a signed stream claim. The channel
%% is located by the claim envelope's embedded signing-channel id -- never
%% by SDK signing-channel hints -- and fetched as verified channel-output
%% evidence, so `dev_lbry_commitment:with_attestation_commitment/2' verifies
%% the claim signature against the raw channel public key before the
%% commitment is attached. A signed claim whose channel evidence cannot be
%% fetched fails the read; unsigned claims pass through unchanged.
attach_attestation(StreamMsg, StoreOpts, NodeOpts) ->
    Envelope = maps:get(<<"claim-envelope">>, StreamMsg, #{}),
    case maps:get(<<"signed">>, Envelope, false) of
        false ->
            {ok, StreamMsg};
        true ->
            maybe
                ChannelID = maps:get(<<"signing-channel-id">>, Envelope),
                {ok, ChannelClaim} ?=
                    hb_odysee_client:claim_search(
                        ChannelID,
                        store_node_opts(StoreOpts, NodeOpts)
                    ),
                {ok, ChannelTxID} ?= claim_txid(ChannelClaim),
                {ok, ChannelNout} ?= claim_nout(ChannelClaim),
                {ok, ChannelMsg} ?=
                    kind_output(
                        <<"channel">>,
                        ChannelTxID,
                        ChannelNout,
                        StoreOpts,
                        NodeOpts
                    ),
                dev_lbry_commitment:with_attestation_commitment(StreamMsg, ChannelMsg)
            end
    end.

%% @doc Resolve a bare outpoint to native committed claim-output evidence,
%% trying the stream and channel kinds before the default claim kind.
read_native_outpoint(TxID, Nout, StoreOpts, NodeOpts) ->
    read_native_outpoint(
        TxID,
        Nout,
        [<<"stream">>, <<"channel">>, <<"claim">>],
        StoreOpts,
        NodeOpts
    ).

%% Try each kind in turn, but advance ONLY when the claim genuinely is not of
%% that kind. A transport failure must propagate: otherwise a transient proxy
%% error walks the whole kind list and returns weaker evidence (or
%% `not_found') for a claim that is perfectly readable a moment later.
read_native_outpoint(TxID, Nout, [Kind | Rest], StoreOpts, NodeOpts) ->
    case kind_output(Kind, TxID, Nout, StoreOpts, NodeOpts) of
        {ok, Msg} ->
            evidence_result(Msg, NodeOpts);
        {error, Label} when Label == not_a_stream_claim;
                            Label == not_a_channel_claim ->
            read_native_outpoint(TxID, Nout, Rest, StoreOpts, NodeOpts);
        Error ->
            Error
    end;
read_native_outpoint(_TxID, _Nout, [], _StoreOpts, _NodeOpts) ->
    {error, not_found}.

%% @doc Fail closed and narrow: every message leaving the store must carry
%% verifying native commitments, and only its committed keys. The narrowed
%% message is written to the node's local stores before it is returned, so
%% its sub-messages are servable wherever the evidence itself is -- the
%% HTTP layer links nested maps against the local store when encoding
%% unbundled responses, and peers read the same copies through the cache.
evidence_result(Msg, Opts) ->
    case hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, Opts) of
        true ->
            case hb_message:with_only_committed(Msg, Opts) of
                {ok, Narrowed} ->
                    hb_cache:write(Narrowed, local_write_opts(Opts)),
                    {ok, Narrowed};
                Other -> Other
            end;
        false -> {error, invalid_evidence}
    end.

%% @doc The node options, with the store stack narrowed to local scope for
%% evidence write-back. An empty local stack disables the write cleanly.
local_write_opts(Opts) ->
    Opts#{
        <<"store">> =>
            hb_store:scope(hb_opts:get(store, [], Opts), local)
    }.

require_claim_id(undefined, _Msg) ->
    ok;
require_claim_id(ClaimID, Msg) ->
    case maps:get(<<"claim-id">>, Msg, not_found) of
        ClaimID -> ok;
        Other -> {error, {claim_id_mismatch, Other, ClaimID}}
    end.

media_from_stream_path(Path, Req, StoreOpts, NodeOpts) ->
    maybe
        {ok, Stream} ?= read(StoreOpts, #{ <<"read">> => Path }, NodeOpts),
        {ok, Source} ?= stream_media_source(Stream, NodeOpts),
        media_response(Source, Req, store_node_opts(StoreOpts, NodeOpts))
    end.

%% @doc Extract the media source locator from committed stream evidence: the
%% signed `sd-hash' plus the size, media type, and file name from the
%% committed claim `value'.
stream_media_source(Stream, Opts) ->
    maybe
        SDHash = hb_maps:get(<<"sd-hash">>, Stream, not_found, Opts),
        true ?= is_binary(SDHash) orelse {error, missing_sd_hash},
        Source = hb_util:deep_get([<<"value">>, <<"source">>], Stream, #{}, Opts),
        Source0 = #{
            <<"sd-hash">> => SDHash,
            <<"byte-size">> =>
                integer_or_undefined(
                    hb_maps:get(<<"size">>, Source, undefined, Opts)
                ),
            <<"content-type">> =>
                hb_maps:get(<<"media_type">>, Source, undefined, Opts),
            <<"claim-id">> => hb_maps:get(<<"claim-id">>, Stream, undefined, Opts),
            <<"filename">> => hb_maps:get(<<"name">>, Source, undefined, Opts)
        },
        {ok, maps:filter(fun(_Key, Value) -> present_optional(Value) end, Source0)}
    end.

%% @doc Serve media bytes for a stream. Explicit ranges (store request
%% `start'/`end' keys or a `range' header value) yield a bounded 206
%% slice; without one the FULL decrypted object is served with a plain
%% 200. HTTP `Range' headers do not reach store reads through
%% `~cache@1.0/read', so serving a partial window to a rangeless caller
%% would hand video elements the same slice for every request.
media_response(Source, Req, Opts) ->
    case request_range(Req, Opts) of
        full -> full_media_response(Source, Opts);
        {ok, Start, End} -> ranged_media_response(Source, Start, End, Opts);
        Error -> Error
    end.

full_media_response(Source, Opts) ->
    maybe
        SDHash = hb_maps:get(<<"sd-hash">>, Source, not_found, Opts),
        {ok, Result} ?= hb_odysee_bridge:reassemble_stream(SDHash, Opts),
        Body = maps:get(<<"bytes">>, Result),
        {ok,
            maps:merge(
                #{
                    <<"status">> => 200,
                    <<"content-type">> =>
                        hb_maps:get(
                            <<"content-type">>,
                            Source,
                            <<"application/octet-stream">>,
                            Opts
                        ),
                    <<"content-length">> => byte_size(Body),
                    <<"sd-hash">> => hb_util:to_lower(SDHash),
                    <<"body">> => Body
                },
                media_metadata(Source, byte_size(Body))
            )}
    end.

ranged_media_response(Source, Start, End, Opts) ->
    maybe
        {ok, BoundedStart, BoundedEnd} ?= bounded_range(Source, Start, End),
        SDHash = hb_maps:get(<<"sd-hash">>, Source, not_found, Opts),
        {ok, Result} ?=
            hb_odysee_bridge:stream_range(SDHash, BoundedStart, BoundedEnd, Opts),
        Body = maps:get(<<"bytes">>, Result),
        ActualEnd = maps:get(<<"end">>, Result),
        Total = hb_maps:get(<<"byte-size">>, Source, undefined, Opts),
        {ok,
            maps:merge(
                #{
                    <<"status">> => 206,
                    <<"content-type">> =>
                        hb_maps:get(
                            <<"content-type">>,
                            Source,
                            <<"application/octet-stream">>,
                            Opts
                        ),
                    <<"content-length">> => byte_size(Body),
                    <<"accept-ranges">> => <<"bytes">>,
                    <<"content-range">> => content_range(BoundedStart, ActualEnd, Total),
                    <<"sd-hash">> => hb_util:to_lower(SDHash),
                    <<"start">> => BoundedStart,
                    <<"end">> => ActualEnd,
                    <<"requested-end">> => maps:get(<<"requested-end">>, Result),
                    <<"body">> => Body
                },
                media_metadata(Source, Total)
            )}
    end.

request_range(Req, Opts) ->
    case {
        integer_or_undefined(hb_maps:get(<<"start">>, Req, undefined, Opts)),
        integer_or_undefined(hb_maps:get(<<"end">>, Req, undefined, Opts))
    } of
        {Start, End} when is_integer(Start), is_integer(End), End >= Start ->
            {ok, Start, End};
        _ ->
            case first_present([<<"range">>], Req, Opts) of
                Range when is_binary(Range) -> parse_range(Range, Opts);
                _ -> full
            end
    end.

parse_range(<<"bytes=", Spec/binary>>, Opts) ->
    case binary:split(Spec, <<"-">>) of
        [StartBin, EndBin] when byte_size(StartBin) > 0 ->
            maybe
                {ok, Start} ?= non_negative_integer(StartBin),
                {ok, End} ?= range_end(Start, EndBin, Opts),
                true ?= End >= Start orelse {error, invalid_range},
                {ok, Start, End}
            end;
        _ ->
            {error, invalid_range}
    end;
parse_range(_Range, _Opts) ->
    {error, invalid_range}.

range_end(Start, <<>>, Opts) ->
    {ok, Start + default_range_size(Opts) - 1};
range_end(_Start, EndBin, _Opts) ->
    non_negative_integer(EndBin).

default_range_size(Opts) ->
    hb_maps:get(<<"odysee-default-range-size">>, Opts, ?DEFAULT_RANGE_SIZE, Opts).

bounded_range(Source, Start, End) ->
    case hb_maps:get(<<"byte-size">>, Source, undefined, #{}) of
        undefined ->
            {ok, Start, End};
        Size when Start < Size ->
            {ok, Start, min(End, Size - 1)};
        _ ->
            {error, invalid_range}
    end.

content_range(Start, End, undefined) ->
    content_range(Start, End, <<"*">>);
content_range(Start, End, Total) when is_integer(Total) ->
    content_range(Start, End, integer_to_binary(Total));
content_range(Start, End, Total) ->
    iolist_to_binary([
        <<"bytes ">>,
        integer_to_binary(Start),
        <<"-">>,
        integer_to_binary(End),
        <<"/">>,
        Total
    ]).

media_metadata(Source, Total) ->
    maps:from_list([
        {Key, Value}
     ||
        {Key, Value} <- [
            {<<"byte-size">>, Total},
            {<<"claim-id">>, hb_maps:get(<<"claim-id">>, Source, undefined, #{})},
            {<<"filename">>, hb_maps:get(<<"filename">>, Source, undefined, #{})}
        ],
        present_optional(Value)
    ]).

present_optional(undefined) ->
    false;
present_optional(not_found) ->
    false;
present_optional(_Value) ->
    true.

first_present([], _Msg, _Opts) ->
    not_found;
first_present([Key | Rest], Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_present(Rest, Msg, Opts);
        Value -> Value
    end.

integer_or_undefined(Value) when is_integer(Value) ->
    Value;
integer_or_undefined(Value) when is_binary(Value) ->
    try binary_to_integer(Value) of
        Int -> Int
    catch
        _:_ -> undefined
    end;
integer_or_undefined(_Value) ->
    undefined.

%% @doc Link a resolved bare outpoint key to its evidence message, so a
%% later bare read hits the local store before falling through to this
%% (remote, read-only) store. Only bare outpoints warm -- those keys are
%% immutable, so the link can never go stale. The message is written to
%% obtain its canonical cache id (`lbry@1.0' commitments carry no
%% committer, so the id cannot be recomputed independently of the write),
%% then the request key is linked to it. A warming failure never breaks
%% the read.
%% Link a freshly-read message to its direct addresses: the bare outpoint
%% (immutable, so the shortcut cannot go stale) and, when the read used the
%% `ao:' form, that literal key as well. The message is written first to
%% obtain its cache id; `lbry@1.0' commitments carry no committer, so the id
%% cannot be recomputed independently of the write. Mutable locators are
%% never linked: they re-resolve through the store on every read. Warming
%% failure never breaks the read.
warm_addresses(BareKey, _Path, Msg, StoreOpts, NodeOpts) when is_map(Msg) ->
    Direct = strip_ao_prefix(BareKey),
    Keys =
        case is_bare_outpoint(Direct) of
            true -> lists:usort([BareKey, Direct]);
            false -> []
        end,
    catch link_local(Keys, Msg, local_stores(StoreOpts, NodeOpts), NodeOpts),
    ok;
warm_addresses(_BareKey, _Path, _Msg, _StoreOpts, _NodeOpts) ->
    ok.

strip_ao_prefix(<<"ao:", Rest/binary>>) -> Rest;
strip_ao_prefix(Key) -> Key.

link_local(_Keys, _Msg, [], _Opts) ->
    ok;
link_local(Keys, Msg, LocalStores, Opts) ->
    WriteOpts = Opts#{ <<"store">> => LocalStores },
    {ok, UncommittedID} = hb_cache:write(Msg, WriteOpts),
    %% Link to a COMMITMENT id, never to the uncommitted id `hb_cache:write'
    %% returns. `hb_cache' selects a message's commitment by the id the
    %% caller asked for, building `commitments/<Target>' from the requested
    %% path, so the uncommitted id names no commitment and serves the content
    %% with no proof at all.
    %%
    %% This makes the link target correct, not the link itself verifiable:
    %% these keys are locators (a path hash, a bare outpoint), and neither
    %% names a commitment either, so a read through one still arrives without
    %% proof. Callers that need proof address the object by its commitment id
    %% or by its canonical path. See `skeleton_blob_serves_and_addresses_test'
    %% in `hb_odysee_node' for both halves.
    Target = commitment_target(Msg, UncommittedID, WriteOpts),
    lists:foreach(
        fun(Key) -> hb_store:link(LocalStores, #{ Key => Target }, Opts) end,
        Keys
    ),
    ok.

commitment_target(Msg, UncommittedID, Opts) ->
    case hb_maps:keys(hb_maps:get(<<"commitments">>, Msg, #{}, Opts), Opts) of
        [] -> UncommittedID;
        [CommitmentID | _] -> CommitmentID
    end.

%% Follow `hb_store_gateway''s `local-store' convention when provided;
%% otherwise the node's own local-scope stores (this store is `remote',
%% so it excludes itself).
local_stores(StoreOpts, NodeOpts) ->
    case hb_maps:get(<<"local-store">>, StoreOpts, not_found, NodeOpts) of
        not_found -> hb_store:scope(hb_opts:get(store, [], NodeOpts), local);
        false -> [];
        Stores when is_list(Stores) -> Stores;
        Store -> [Store]
    end.

is_bare_outpoint(<<TxID:64/binary, ":", Nout/binary>>) ->
    valid_hex_size(TxID, 32) andalso valid_uint(Nout);
is_bare_outpoint(_Key) ->
    false.

list_live(<<"odysee/channel-id/", Rest/binary>>, Req, StoreOpts, NodeOpts) ->
    case binary:split(Rest, <<"/">>) of
        [Encoded, <<"claim-outputs">>] ->
            list_channel_search(Encoded, Req, StoreOpts, NodeOpts, fun list_claim_outputs/2);
        [Encoded, <<"claims">>] ->
            list_channel_search(Encoded, Req, StoreOpts, NodeOpts, fun list_claim_ids/2);
        _ ->
            {error, not_found}
    end;
list_live(_Path, _Req, _StoreOpts, _NodeOpts) ->
    {error, not_found}.

%% Discovery is deliberately separate from evidence hydration. The SDK proxy
%% may locate current claims, but every selected outpoint is subsequently read
%% through the immutable store path and verified before it enters a snapshot.
source_claims_read(Encoded, StoreOpts, NodeOpts) ->
    maybe
        {ok, JSON} ?= decode_component(Encoded),
        Query = hb_json:decode(JSON),
        true ?= is_map(Query),
        source_claims_read_query(Query, StoreOpts, NodeOpts)
    else
        _ -> {error, invalid_odysee_store_path}
    end.

source_claims_read_query(Query, StoreOpts, NodeOpts) ->
    SearchReq = (maps:from_list(
        lists:filtermap(
            fun({RequestKey, SourceKey, Kind}) ->
                source_search_param(RequestKey, SourceKey, Kind, Query, NodeOpts)
            end,
            [
                {<<"channel_ids">>, <<"channel_ids">>, list},
                {<<"claim_ids">>, <<"claim_ids">>, list},
                {<<"not_channel_ids">>, <<"not_channel_ids">>, list},
                {<<"claim_type">>, <<"claim_type">>, list},
                {<<"any_tags">>, <<"any_tags">>, list},
                {<<"order_by">>, <<"order_by">>, list},
                {<<"any_languages">>, <<"any_languages">>, list},
                {<<"page">>, <<"page">>, integer},
                {<<"page_size">>, <<"page_size">>, integer},
                {<<"limit_claims_per_channel">>, <<"limit_claims_per_channel">>, integer},
                {<<"duration">>, <<"duration">>, scalar},
                {<<"timestamp">>, <<"timestamp">>, scalar},
                {<<"release_time">>, <<"release_time">>, scalar},
                {<<"exclude_shorts">>, <<"exclude_shorts">>, boolean}
            ]
        )
    ))#{<<"no_totals">> => true},
    maybe
        {ok, Search} ?=
            hb_odysee_client:call(
                <<"claim_search">>,
                SearchReq,
                store_node_opts(StoreOpts, NodeOpts)
            ),
        Locators = list_claim_outputs(Search, NodeOpts),
        {ok, #{
            <<"content-type">> => <<"application/json">>,
            <<"cache-control">> => [<<"no-store">>, <<"no-cache">>],
            <<"body">> => hb_json:encode(Search),
            <<"locators">> => iolist_to_binary(lists:join(<<",">>, Locators)),
            <<"page">> => hb_maps:get(<<"page">>, SearchReq, 1, NodeOpts),
            <<"page-size">> => hb_maps:get(<<"page_size">>, SearchReq, length(Locators), NodeOpts)
        }}
    end.

source_search_param(RequestKey, SourceKey, Kind, Req, NodeOpts) ->
    case hb_maps:get(RequestKey, Req, not_found, NodeOpts) of
        not_found -> false;
        Value ->
            case source_search_value(Kind, Value) of
                not_found -> false;
                Parsed -> {true, {SourceKey, Parsed}}
            end
    end.

source_search_value(list, Value) when is_list(Value) -> Value;
source_search_value(list, Value) when is_binary(Value) ->
    [Item || Item <- binary:split(Value, <<",">>, [global]), Item =/= <<>>];
source_search_value(integer, Value) -> int_param(Value, 0);
source_search_value(boolean, true) -> true;
source_search_value(boolean, <<"true">>) -> true;
source_search_value(boolean, 1) -> true;
source_search_value(boolean, <<"1">>) -> true;
source_search_value(boolean, _Value) -> false;
source_search_value(scalar, Value) when is_binary(Value); is_integer(Value) -> Value;
source_search_value(_Kind, _Value) -> not_found.

list_channel_search(Encoded, Req, StoreOpts, NodeOpts, Project) ->
    maybe
        {ok, ChannelID} ?= decode_component(Encoded),
        Page = int_param(hb_maps:get(<<"page">>, Req, 1, NodeOpts), 1),
        PageSize = int_param(
            hb_maps:get(<<"page-size">>, Req, 20, NodeOpts),
            20
        ),
        OrderBy = hb_maps:get(<<"order-by">>, Req, [<<"release_time">>], NodeOpts),
        {ok, Search} ?=
            hb_odysee_client:call(
                <<"claim_search">>,
                #{
                    <<"channel_ids">> => [normalize_hex(ChannelID)],
                    <<"claim_type">> => <<"stream">>,
                    <<"page">> => Page,
                    <<"page_size">> => PageSize,
                    <<"order_by">> => OrderBy,
                    <<"no_totals">> => true
                },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        {ok, Project(Search, NodeOpts)}
    end.

fixture(Path, StoreOpts, Opts) ->
    Fixtures = hb_maps:get(<<"fixtures">>, StoreOpts, #{}, Opts),
    case hb_maps:get(Path, Fixtures, not_found, Opts) of
        not_found -> not_found;
        Msg when is_map(Msg) -> {ok, Msg};
        Msg -> {ok, hb_cache:ensure_all_loaded(Msg, Opts)}
    end.

%% Fixture messages carrying native commitments are held to the same bar as
%% live reads: verify, then narrow. Uncommitted fixtures (locator maps used
%% by the list surfaces) pass through untouched.
fixture_result(Msg, Opts) when is_map(Msg) ->
    case has_lbry_commitment(Msg, Opts) of
        true -> evidence_result(Msg, Opts);
        false -> {ok, Msg}
    end;
fixture_result(Bin, _Opts) ->
    {ok, Bin}.

has_lbry_commitment(Msg, Opts) ->
    Commitments = hb_maps:get(<<"commitments">>, Msg, #{}, Opts),
    lists:any(
        fun(Commitment) ->
            hb_maps:get(<<"commitment-device">>, Commitment, not_found, Opts)
                =:= <<"lbry@1.0">>
        end,
        hb_maps:values(Commitments, Opts)
    ).

claim_txid(Claim) when is_map(Claim) ->
    case maps:get(<<"txid">>, Claim, undefined) of
        TxID when is_binary(TxID) ->
            Normalized = normalize_hex(TxID),
            case valid_hex_size(Normalized, 32) of
                true -> {ok, Normalized};
                false -> {error, invalid_txid}
            end;
        _ ->
            {error, missing_txid}
    end;
claim_txid(_Claim) ->
    {error, missing_txid}.

claim_nout(Claim) when is_map(Claim) ->
    case maps:get(<<"nout">>, Claim, undefined) of
        Nout when is_integer(Nout), Nout >= 0 ->
            {ok, Nout};
        Nout when is_binary(Nout) ->
            non_negative_integer(Nout);
        _ ->
            {error, missing_nout}
    end;
claim_nout(_Claim) ->
    {error, missing_nout}.

first_found([], _Msg, Default, _Opts) ->
    Default;
first_found([Key | Rest], Msg, Default, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_found(Rest, Msg, Default, Opts);
        Value -> Value
    end.

list_claim_ids(Search, Opts) ->
    case first_found([<<"claim_ids">>], Search, not_found, Opts) of
        ClaimIDs when is_list(ClaimIDs) ->
            ClaimIDs;
        _ ->
            [
                ClaimID
            ||
                Claim <- first_found([<<"claims">>, <<"items">>], Search, [], Opts),
                ClaimID <- [first_found([<<"claim_id">>], Claim, not_found, Opts)],
                ClaimID =/= not_found
            ]
    end.

list_search_ids(Path, Search, Opts) ->
    case binary:match(Path, <<"/claim-outputs">>) of
        nomatch -> list_claim_ids(Search, Opts);
        _ -> list_claim_outputs(Search, Opts)
    end.

list_claim_outputs(Search, Opts) ->
    [
        Outpoint
    ||
        Claim <- first_found([<<"claims">>, <<"items">>], Search, [], Opts),
        Outpoint <- [claim_outpoint(Claim, Opts)],
        Outpoint =/= not_found
    ].

claim_outpoint(Claim, Opts) ->
    TxID = first_found([<<"txid">>], Claim, not_found, Opts),
    Nout = first_found([<<"nout">>], Claim, not_found, Opts),
    case {TxID, nout_binary(Nout)} of
        {TxID, NoutBin} when is_binary(TxID), is_binary(NoutBin) ->
            <<TxID/binary, ":", NoutBin/binary>>;
        _ ->
            not_found
    end.

nout_binary(Nout) when is_integer(Nout), Nout >= 0 ->
    integer_to_binary(Nout);
nout_binary(Nout) when is_binary(Nout) ->
    case valid_uint(Nout) of
        true -> Nout;
        false -> not_found
    end;
nout_binary(_Nout) ->
    not_found.

int_param(Value, _Default) when is_integer(Value) ->
    Value;
int_param(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value) of
        Int -> Int
    catch
        _:_ -> Default
    end;
int_param(_Value, Default) ->
    Default.

outpoint_path(Rest) ->
    case binary:split(Rest, <<"/">>) of
        [EncodedTxID, EncodedNout] ->
            maybe
                {ok, Decoded} ?= decode_component(EncodedTxID),
                TxID = normalize_hex(Decoded),
                ok ?= require_hex_size(TxID, 64, invalid_txid),
                {ok, NoutBin} ?= decode_component(EncodedNout),
                {ok, Nout} ?= non_negative_integer(NoutBin),
                {ok, TxID, Nout}
            end;
        _ ->
            {error, invalid_outpoint_path}
    end.

parse_bare_outpoint(<<TxID:64/binary, ":", NoutBin/binary>>) ->
    maybe
        Normalized = normalize_hex(TxID),
        true ?= valid_hex_size(Normalized, 32) orelse {error, invalid_outpoint},
        {ok, Nout} ?= non_negative_integer(NoutBin),
        {ok, Normalized, Nout}
    end;
parse_bare_outpoint(_Outpoint) ->
    {error, invalid_outpoint}.

require_hex_size(Hex, Size, _Error) when is_binary(Hex), byte_size(Hex) =:= Size ->
    ok;
require_hex_size(_Hex, _Size, Error) ->
    {error, Error}.

non_negative_integer(Bin) when is_binary(Bin) ->
    try
        Int = binary_to_integer(Bin),
        case Int >= 0 of
            true -> {ok, Int};
            false -> {error, invalid_nout}
        end
    catch _:_ ->
        {error, invalid_nout}
    end.

normalize_hex(Hex) when is_binary(Hex) ->
    hb_util:to_lower(Hex).

store_node_opts(StoreOpts, NodeOpts) ->
    hb_maps:merge(
        maps:without(
            [
                <<"fixtures">>,
                <<"store-module">>,
                <<"name">>,
                <<"scope">>
            ],
            StoreOpts
        ),
        NodeOpts
    ).

normalize_key(Key) ->
    Path = hb_path:to_binary(Key),
    case Path of
        <<"/", Rest/binary>> -> Rest;
        _ -> Path
    end.

canonical_read_path(Path) ->
    case classify_native_path(Path) of
        {ok, NativePath} -> NativePath;
        _ -> Path
    end.

canonical_list_path(Path) ->
    case classify_channel_claims_list_path(Path) of
        {ok, NativePath} -> NativePath;
        _ -> Path
    end.

classify_channel_claims_list_path(<<ChannelID:40/binary, "/claim-outputs">>) ->
    case valid_hex_size(ChannelID, 20) of
        true -> {ok, <<"odysee/channel-id/", ChannelID/binary, "/claim-outputs">>};
        false -> not_found
    end;
classify_channel_claims_list_path(<<ChannelID:40/binary, "/claims">>) ->
    case valid_hex_size(ChannelID, 20) of
        true -> {ok, <<"odysee/channel-id/", ChannelID/binary, "/claims">>};
        false -> not_found
    end;
classify_channel_claims_list_path(_Path) ->
    not_found.

%% `ao:' ids are immutable only: outpoints, txids, and content hashes. A
%% claim id is a mutable locator (its current claim changes on update), so
%% it is never an `ao:' id; resolve it to an outpoint first.
classify_native_path(<<"ao:", Rest/binary>>) ->
    case classify_native_path(Rest) of
        {ok, <<"odysee/claim-id/", _/binary>>} -> not_found;
        Classified -> Classified
    end;
classify_native_path(<<TxID:64/binary, ":", Nout/binary>>) ->
    case valid_hex_size(TxID, 32) andalso valid_uint(Nout) of
        true -> {ok, <<"odysee/claim-output/", TxID/binary, "/", Nout/binary>>};
        false -> not_found
    end;
classify_native_path(Path) ->
    case {valid_hex_size(Path, 48), valid_hex_size(Path, 32), valid_hex_size(Path, 20)} of
        {true, _, _} -> {ok, <<"odysee/blob/", Path/binary>>};
        {_, true, _} -> {ok, <<"odysee/transaction/", Path/binary>>};
        {_, _, true} -> {ok, <<"odysee/claim-id/", Path/binary>>};
        _ -> not_found
    end.

valid_hex_size(Hex, Bytes) when is_binary(Hex), byte_size(Hex) =:= Bytes * 2 ->
    try binary:decode_hex(Hex) of
        Decoded -> byte_size(Decoded) =:= Bytes
    catch
        _:_ -> false
    end;
valid_hex_size(_Hex, _Bytes) ->
    false.

valid_uint(Bin) when is_binary(Bin), byte_size(Bin) > 0 ->
    try binary_to_integer(Bin) of
        Int -> Int >= 0
    catch
        _:_ -> false
    end;
valid_uint(_Bin) ->
    false.

decode_component(Encoded) ->
    try {ok, hb_util:bin(uri_string:percent_decode(Encoded))}
    catch _:_ -> {error, invalid_odysee_store_path}
    end.

decode_uri_component(Encoded) ->
    case decode_component(Encoded) of
        {ok, URI} -> {ok, restore_uri_scheme(URI)};
        Error -> Error
    end.

%% URI path components lose the double slash after the scheme when they pass
%% through path normalization; restore it so `lbry://' URIs survive a round
%% trip through a store key.
restore_uri_scheme(<<"lbry://", _/binary>> = URI) -> URI;
restore_uri_scheme(<<"http://", _/binary>> = URI) -> URI;
restore_uri_scheme(<<"https://", _/binary>> = URI) -> URI;
restore_uri_scheme(<<"lbry:/", Rest/binary>>) -> <<"lbry://", Rest/binary>>;
restore_uri_scheme(<<"http:/", Rest/binary>>) -> <<"http://", Rest/binary>>;
restore_uri_scheme(<<"https:/", Rest/binary>>) -> <<"https://", Rest/binary>>;
restore_uri_scheme(URI) -> URI.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

%% An `ao:'-prefixed key resolves exactly like its bare form: the prefix is
%% stripped and the remainder classifies onto the same canonical path, so
%% outpoints, txids, and hashes need no alias or index scheme.
ao_prefixed_key_resolves_like_bare_test() ->
    Bytes = <<"ao addressed blob payload">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Store = hb_test_utils:test_store(),
    Opts = #{ <<"store">> => [Store] },
    SourceStore = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{ <<"lbry/blob/", Hash/binary>> => Bytes },
        <<"local-store">> => [Store]
    },
    {ok, Msg} = read(SourceStore, #{ <<"read">> => <<"ao:", Hash/binary>> }, Opts),
    Loaded = hb_cache:ensure_all_loaded(Msg, Opts),
    ?assertEqual(Hash, hb_maps:get(<<"blob-hash">>, Loaded, not_found, Opts)),
    ?assertEqual(
        true,
        hb_message:verify(Loaded, #{ <<"commitment-ids">> => <<"all">> }, Opts)
    ).

%% `ao:' ids are immutable: a claim id is a mutable locator, never an id.
ao_prefixed_claim_id_is_not_an_id_test() ->
    ClaimID = binary:copy(<<"c">>, 40),
    ?assertEqual(not_found, classify_native_path(<<"ao:", ClaimID/binary>>)),
    ?assertEqual(
        {ok, <<"odysee/claim-id/", ClaimID/binary>>},
        classify_native_path(ClaimID)
    ).

%% A transport failure must NOT be mistaken for "this claim is not a stream".
%% The stream-to-claim fallback exists for livestream placeholders whose
%% protobuf carries no source; if it also swallowed fetch errors, a transient
%% proxy failure would yield claim evidence with no `sd-hash' and the media
%% read would fail with `missing_sd_hash' for a perfectly good claim.
outpoint_evidence_propagates_transport_errors_test() ->
    Unreachable =
        #{
            <<"store-module">> => ?MODULE,
            %% Port 1 is reserved and refuses instantly, so this is a
            %% transport failure and never a claim-shape rejection.
            <<"lbry-proxy-node">> => <<"http://127.0.0.1:1">>,
            <<"http-client">> => httpc
        },
    TxID = binary:copy(<<"a">>, 64),
    Result = outpoint_evidence(<<"stream">>, TxID, 0, Unreachable, #{}),
    %% The property under test: it must not silently succeed with weaker
    %% evidence. `hb_odysee_client' reports transport and 5xx as
    %% `{failure, _}' and 4xx as `{error, _}'; either is acceptable here.
    ?assertNotMatch({ok, _}, Result),
    ?assert(element(1, Result) =:= failure orelse element(1, Result) =:= error).

decoded_store_uri_preserves_claim_id_test() ->
    URI = <<"lbry://@rave#5383026b8b74683313ad6ea5c72f27eedcae026c">>,
    ?assertEqual(
        {ok, URI},
        decode_uri_component(<<"lbry:/@rave#5383026b8b74683313ad6ea5c72f27eedcae026c">>)
    ).

bare_sha384_read_returns_native_blob_test() ->
    Bytes = <<"encrypted blob payload">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{ <<"lbry/blob/", Hash/binary>> => Bytes }
    },
    ?assertEqual(<<"odysee/blob/", Hash/binary>>, canonical_read_path(Hash)),
    {ok, Msg} = read(Store, #{ <<"read">> => Hash }, #{}),
    ?assertEqual(Hash, maps:get(<<"blob-hash">>, Msg)),
    ?assertEqual(Bytes, maps:get(<<"data">>, Msg)),
    ?assertEqual(
        dev_lbry_commitment:content_digest_sha384(Bytes),
        maps:get(<<"content-digest">>, Msg)
    ),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual(<<"lbry@1.0">>, maps:get(<<"commitment-device">>, Commitment)),
    ?assertEqual(<<"blob">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual(
        true,
        hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
    ).

bare_sha384_descriptor_read_returns_native_descriptor_test() ->
    {Raw, SDHash, _BlobHash, _Ciphertext} = sample_descriptor(),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{ <<"lbry/descriptor/", SDHash/binary>> => Raw }
    },
    {ok, Msg} =
        read(Store, #{ <<"read">> => <<"odysee/descriptor/", SDHash/binary>> }, #{}),
    ?assertEqual(SDHash, maps:get(<<"sd-hash">>, Msg)),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual(<<"descriptor">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual(
        true,
        hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
    ).

bare_txid_read_returns_native_transaction_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, TxMsg} = dev_lbry_commitment:transaction_message(Raw),
    TxID = maps:get(<<"txid">>, TxMsg),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/transaction/", TxID/binary>> => TxMsg
        }
    },
    ?assertEqual(<<"odysee/transaction/", TxID/binary>>, canonical_read_path(TxID)),
    {ok, Msg} = read(Store, #{ <<"read">> => TxID }, #{}),
    ?assertEqual(TxID, maps:get(<<"txid">>, Msg)),
    ?assertEqual(hb_util:encode(Raw), maps:get(<<"raw">>, Msg)),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual(<<"transaction">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual(
        true,
        hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
    ).

bare_claim_id_read_returns_committed_claim_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, ClaimOutput} = dev_lbry_commitment:claim_output_message(Raw, 0),
    ClaimID = maps:get(<<"claim-id">>, ClaimOutput),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/claim-id/", ClaimID/binary>> => ClaimOutput
        }
    },
    ?assertEqual(
        <<"odysee/claim-id/", ClaimID/binary>>,
        canonical_read_path(ClaimID)
    ),
    {ok, Msg} = read(Store, #{ <<"read">> => ClaimID }, #{}),
    ?assertEqual(ClaimID, maps:get(<<"claim-id">>, Msg)),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual(<<"claim">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual(
        true,
        hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
    ).

claim_output_path_aliases_return_native_claim_output_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    TxID = dev_lbry_tx:txid(Raw),
    {ok, ClaimOutput} = dev_lbry_commitment:claim_output_message(Raw, 0),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/claim-output/", TxID/binary, "/0">> => ClaimOutput,
            <<"odysee/outpoint/", TxID/binary, "/0">> => ClaimOutput
        }
    },
    ?assertEqual(
        <<"odysee/claim-output/", TxID/binary, "/0">>,
        canonical_read_path(<<TxID/binary, ":0">>)
    ),
    {ok, ClaimOutputMsg} =
        read(Store, #{ <<"read">> => <<"odysee/claim-output/", TxID/binary, "/0">> }, #{}),
    {ok, OutpointMsg} =
        read(Store, #{ <<"read">> => <<"odysee/outpoint/", TxID/binary, "/0">> }, #{}),
    {ok, BareMsg} = read(Store, #{ <<"read">> => <<TxID/binary, ":0">> }, #{}),
    ?assertEqual(TxID, maps:get(<<"txid">>, ClaimOutputMsg)),
    ?assertEqual(0, maps:get(<<"nout">>, ClaimOutputMsg)),
    ?assertEqual(TxID, maps:get(<<"txid">>, OutpointMsg)),
    ?assertEqual(0, maps:get(<<"nout">>, OutpointMsg)),
    ?assertEqual(TxID, maps:get(<<"txid">>, BareMsg)),
    ?assertEqual(0, maps:get(<<"nout">>, BareMsg)).

direct_txid_get_returns_native_transaction_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, TxMsg} = dev_lbry_commitment:transaction_message(Raw),
    TxID = maps:get(<<"txid">>, TxMsg),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/transaction/", TxID/binary>> => TxMsg
        }
    },
    {ok, Msg} = hb_cache:read(TxID, #{ <<"store">> => [Store] }),
    ?assertEqual(TxID, maps:get(<<"txid">>, Msg)),
    ?assertEqual(hb_util:encode(Raw), maps:get(<<"raw">>, Msg)).

direct_outpoint_get_returns_native_claim_output_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    TxID = dev_lbry_tx:txid(Raw),
    Outpoint = <<TxID/binary, ":0">>,
    {ok, ClaimOutput} = dev_lbry_commitment:claim_output_message(Raw, 0),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/claim-output/", TxID/binary, "/0">> => ClaimOutput
        }
    },
    {ok, Msg} = hb_cache:read(Outpoint, #{ <<"store">> => [Store] }),
    ?assertEqual(TxID, maps:get(<<"txid">>, Msg)),
    ?assertEqual(0, maps:get(<<"nout">>, Msg)),
    ?assertEqual(
        true,
        hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
    ).

live_claim_id_read_builds_native_claim_evidence_test() ->
    application:ensure_all_started(inets),
    TxID = <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    ClaimID = <<"9cc7f0e3de8db3b2ffd6dc0b4f1a0f0ca48a6b49">>,
    SearchResponse =
        hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"result">> => #{
                <<"items">> => [
                    #{
                        <<"claim_id">> => ClaimID,
                        <<"txid">> => TxID,
                        <<"nout">> => 0
                    }
                ]
            },
            <<"id">> => 1
        }),
    TxResponse =
        hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"result">> => #{ <<"hex">> => dev_lbry_tx:task0_tx_hex() },
            <<"id">> => 1
        }),
    {ok, Server, Handle} = hb_mock_server:start([
        {"/api/v1/proxy", proxy, fun(Req) ->
            case maps:get(<<"qs">>, Req) of
                <<"m=claim_search">> -> {200, SearchResponse};
                <<"m=transaction_show">> -> {200, TxResponse}
            end
        end}
    ]),
    try
        Store = #{
            <<"store-module">> => ?MODULE,
            <<"lbry-proxy-node">> => Server,
            <<"http-client">> => httpc
        },
        {ok, Msg} = read(Store, #{ <<"read">> => ClaimID }, #{ <<"store">> => [] }),
        ?assertEqual(ClaimID, maps:get(<<"claim-id">>, Msg)),
        ?assertEqual(TxID, maps:get(<<"txid">>, Msg)),
        [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
        ?assertEqual(<<"lbry@1.0">>, maps:get(<<"commitment-device">>, Commitment)),
        ?assertEqual(<<"claim">>, maps:get(<<"evidence">>, Commitment)),
        ?assertEqual(
            true,
            hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
        )
    after
        hb_mock_server:stop(Handle)
    end.

live_outpoint_read_returns_stream_evidence_test() ->
    application:ensure_all_started(inets),
    TxID = <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    TxResponse =
        hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"result">> => #{ <<"hex">> => dev_lbry_tx:task0_tx_hex() },
            <<"id">> => 1
        }),
    {ok, Server, Handle} = hb_mock_server:start([
        {"/api/v1/proxy", proxy, {200, TxResponse}}
    ]),
    try
        Store = #{
            <<"store-module">> => ?MODULE,
            <<"lbry-proxy-node">> => Server,
            <<"http-client">> => httpc
        },
        {ok, Msg} =
            read(
                Store,
                #{ <<"read">> => <<TxID/binary, ":0">> },
                #{ <<"store">> => [] }
            ),
        ?assertEqual(TxID, maps:get(<<"txid">>, Msg)),
        ?assertEqual(0, maps:get(<<"nout">>, Msg)),
        ?assert(is_binary(maps:get(<<"sd-hash">>, Msg))),
        Kinds =
            lists:sort([
                maps:get(<<"evidence">>, Commitment)
             ||
                Commitment <- maps:values(maps:get(<<"commitments">>, Msg))
            ]),
        ?assertEqual([<<"claim">>, <<"stream">>], Kinds),
        ?assertEqual(
            true,
            hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
        )
    after
        hb_mock_server:stop(Handle)
    end.

media_sd_hash_range_read_returns_partial_content_test() ->
    {Raw, SDHash, BlobHash, Ciphertext} = sample_descriptor(),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"lbry-blob-store">> => #{
            <<"fixtures">> => #{
                SDHash => Raw,
                BlobHash => Ciphertext
            }
        }
    },
    {ok, Msg} =
        read(
            Store,
            #{
                <<"read">> => <<"odysee/media/sd-hash/", SDHash/binary>>,
                <<"start">> => 0,
                <<"end">> => 5
            },
            #{}
        ),
    ?assertEqual(206, maps:get(<<"status">>, Msg)),
    ?assertEqual(<<"hello ">>, maps:get(<<"body">>, Msg)),
    ?assertEqual(<<"bytes 0-5/*">>, maps:get(<<"content-range">>, Msg)),
    ?assertEqual(SDHash, maps:get(<<"sd-hash">>, Msg)).

bare_channel_id_claims_list_returns_claim_ids_test() ->
    ChannelID = <<"fb364ef587872515f545a5b4b3182b58073f230f">>,
    ClaimID1 = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    ClaimID2 = <<"3fda836a92faaceedfe398225fb9b2ee2ed1f01a">>,
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/channel-id/", ChannelID/binary, "/claims">> => #{
                <<"items">> => [
                    #{ <<"claim_id">> => ClaimID1 },
                    #{ <<"claim_id">> => ClaimID2 }
                ]
            }
        }
    },
    ?assertEqual(
        <<"odysee/channel-id/", ChannelID/binary, "/claims">>,
        canonical_list_path(<<ChannelID/binary, "/claims">>)
    ),
    {ok, ClaimIDs} = list(Store, #{ <<"list">> => <<ChannelID/binary, "/claims">> }, #{}),
    ?assertEqual([ClaimID1, ClaimID2], ClaimIDs).

bare_channel_id_claim_outputs_list_returns_immutable_outpoints_test() ->
    ChannelID = <<"fb364ef587872515f545a5b4b3182b58073f230f">>,
    ClaimID = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    TxID1 = <<"6f4fc565d9f7b553c2b87b17f0e1821adc281b6331b926d72df44ee45d44f284">>,
    TxID2 = <<"8c2c68213df87840edcb0a5a2d2e093f5d2ecc4be82a4f86bfc320778ee8305d">>,
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/channel-id/", ChannelID/binary, "/claim-outputs">> => #{
                <<"items">> => [
                    #{ <<"claim_id">> => ClaimID, <<"txid">> => TxID1, <<"nout">> => 0 },
                    #{ <<"claim_id">> => ClaimID, <<"txid">> => TxID2, <<"nout">> => <<"2">> },
                    #{ <<"claim_id">> => ClaimID }
                ]
            }
        }
    },
    ?assertEqual(
        <<"odysee/channel-id/", ChannelID/binary, "/claim-outputs">>,
        canonical_list_path(<<ChannelID/binary, "/claim-outputs">>)
    ),
    {ok, Outpoints} = list(Store, #{ <<"list">> => <<ChannelID/binary, "/claim-outputs">> }, #{}),
    ?assertEqual([<<TxID1/binary, ":0">>, <<TxID2/binary, ":2">>], Outpoints).

%% Warming mechanics: a live-resolved native claim output must be readable
%% back from the local store by every address warming links, so a later
%% `GET /(id)' never re-hits the proxy. Two addresses are linked: the bare
%% outpoint key (immutable, so the shortcut stays correct) and the canonical
%% path's alias id (which is what makes the object addressable by a plain id
%% on any node).
bare_outpoint_warm_cache_links_local_store_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    TxID = dev_lbry_tx:txid(Raw),
    Outpoint = <<TxID/binary, ":0">>,
    {ok, ClaimOutput} = dev_lbry_commitment:claim_output_message(Raw, 0),
    Timestamp = integer_to_binary(erlang:unique_integer([positive, monotonic])),
    LocalStore = #{
        <<"store-module">> => hb_store_fs,
        <<"name">> => <<"cache-TEST/odysee-warm-", Timestamp/binary>>
    },
    hb_store:reset(LocalStore),
    Opts = #{ <<"store">> => [LocalStore] },
    Path = <<"odysee/outpoint/", TxID/binary, "/0">>,
    ?assert(is_bare_outpoint(Outpoint)),
    ok = warm_addresses(Outpoint, Path, ClaimOutput, #{}, Opts),
    {ok, Cached0} = hb_cache:read(Outpoint, Opts),
    Cached = hb_cache:ensure_all_loaded(Cached0, Opts),
    ?assertEqual(TxID, hb_maps:get(<<"txid">>, Cached, not_found, Opts)),
    ?assertEqual(
        maps:get(<<"claim-id">>, ClaimOutput),
        hb_maps:get(<<"claim-id">>, Cached, not_found, Opts)
    ),
    %% An `ao:'-form read warms both the literal `ao:' key and the bare
    %% outpoint, so either address hits the cache afterwards.
    AoKey = <<"ao:", Outpoint/binary>>,
    ok = warm_addresses(AoKey, Path, ClaimOutput, #{}, Opts),
    ?assertMatch({ok, _}, hb_cache:read(AoKey, Opts)),
    %% A mutable locator never becomes a direct address: nothing is linked.
    LocatorPath = <<"odysee/claim/x">>,
    ok = warm_addresses(LocatorPath, LocatorPath, ClaimOutput, #{}, Opts),
    ?assertMatch({error, not_found}, hb_cache:read(LocatorPath, Opts)),
    %% Warming without local stores is a harmless no-op.
    ?assertEqual(
        ok,
        warm_addresses(Outpoint, Path, ClaimOutput, #{}, #{ <<"store">> => [] })
    ).

sample_descriptor() ->
    hb_lbry_test_fixtures:sample_descriptor(<<"hello verified legacy stream">>).

%% Adversarial coverage for the attestation-enforcing stream-id path,
%% ported from the removed hb_odysee_bridge:verified_stream/2 suite. The
%% live path must fail closed on forged or misbound signatures and serve
%% unsigned (anonymous) claims without an attestation commitment.
stream_id_read_rejects_forged_signature_test() ->
    application:ensure_all_started(inets),
    Fixture = hb_lbry_test_fixtures:signed_stream_fixture(<<1:256>>, <<2:256>>),
    {ok, Server, Handle} = hb_lbry_test_fixtures:fixture_server(Fixture, #{}),
    try
        Store = #{
            <<"store-module">> => ?MODULE,
            <<"lbry-proxy-node">> => Server,
            <<"http-client">> => httpc
        },
        StreamTxID = maps:get(stream_txid, Fixture),
        ?assertEqual(
            {error, #{
                <<"status">> => 502,
                <<"body">> => <<"invalid_claim_signature">>
            }},
            read(
                Store,
                #{ <<"read">> => <<"odysee/stream-id/", StreamTxID/binary, ":0">> },
                #{ <<"store">> => [] }
            )
        )
    after
        hb_mock_server:stop(Handle)
    end.

stream_id_read_rejects_channel_binding_mismatch_test() ->
    application:ensure_all_started(inets),
    FixtureA = hb_lbry_test_fixtures:signed_stream_fixture(<<1:256>>, <<1:256>>),
    FixtureB = hb_lbry_test_fixtures:signed_stream_fixture(<<2:256>>, <<2:256>>),
    {ok, Server, Handle} =
        hb_lbry_test_fixtures:fixture_server(FixtureA, #{
            channel_txid => maps:get(channel_txid, FixtureB),
            channel_tx_hex => maps:get(channel_tx_hex, FixtureB)
        }),
    try
        Store = #{
            <<"store-module">> => ?MODULE,
            <<"lbry-proxy-node">> => Server,
            <<"http-client">> => httpc
        },
        StreamTxID = maps:get(stream_txid, FixtureA),
        ?assertEqual(
            {error, #{
                <<"status">> => 502,
                <<"body">> => <<"channel_binding_mismatch">>
            }},
            read(
                Store,
                #{ <<"read">> => <<"odysee/stream-id/", StreamTxID/binary, ":0">> },
                #{ <<"store">> => [] }
            )
        )
    after
        hb_mock_server:stop(Handle)
    end.

stream_id_read_serves_unsigned_claim_without_attestation_test() ->
    application:ensure_all_started(inets),
    Fixture = hb_lbry_test_fixtures:unsigned_stream_fixture(),
    {ok, Server, Handle} = hb_lbry_test_fixtures:fixture_server(Fixture, #{}),
    try
        Store = #{
            <<"store-module">> => ?MODULE,
            <<"lbry-proxy-node">> => Server,
            <<"http-client">> => httpc
        },
        StreamTxID = maps:get(stream_txid, Fixture),
        {ok, Msg} =
            read(
                Store,
                #{ <<"read">> => <<"odysee/stream-id/", StreamTxID/binary, ":0">> },
                #{ <<"store">> => [] }
            ),
        Kinds =
            lists:sort([
                maps:get(<<"evidence">>, Commitment)
             ||
                Commitment <- maps:values(maps:get(<<"commitments">>, Msg))
            ]),
        ?assertEqual([<<"claim">>, <<"stream">>], Kinds),
        ?assertEqual(
            true,
            hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
        )
    after
        hb_mock_server:stop(Handle)
    end.

claim_id_read_rejects_locator_claim_id_mismatch_test() ->
    application:ensure_all_started(inets),
    BadClaimID = <<"0000000000000000000000000000000000000000">>,
    Claim = #{
        <<"claim_id">> => BadClaimID,
        <<"txid">> => <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
        <<"nout">> => 0
    },
    ClaimResponse =
        hb_lbry_test_fixtures:proxy_result(#{ <<"items">> => [Claim] }),
    TxResponse =
        hb_lbry_test_fixtures:proxy_result(#{ <<"hex">> => dev_lbry_tx:task0_tx_hex() }),
    {ok, Server, Handle} = hb_mock_server:start([
        {"/api/v1/proxy", proxy, fun(Req) ->
            case maps:get(<<"qs">>, Req) of
                <<"m=claim_search">> -> {200, ClaimResponse};
                <<"m=transaction_show">> -> {200, TxResponse}
            end
        end}
    ]),
    try
        Store = #{
            <<"store-module">> => ?MODULE,
            <<"lbry-proxy-node">> => Server,
            <<"http-client">> => httpc
        },
        ?assertEqual(
            {error, #{
                <<"status">> => 502,
                <<"body">> => <<"claim_id_mismatch">>
            }},
            read(
                Store,
                #{ <<"read">> => <<"odysee/claim-id/", BadClaimID/binary>> },
                #{ <<"store">> => [] }
            )
        )
    after
        hb_mock_server:stop(Handle)
    end.

-endif.
