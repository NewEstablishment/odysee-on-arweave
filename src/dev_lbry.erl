%%% @doc The `lbry@1.0' device: native LBRY commitments and codecs for
%%% HyperBEAM messages.
%%%
%%% A native commitment binds a message to an LBRY source object through the
%%% object's own content addressing -- a blob hash, stream-descriptor hash,
%%% transaction id, claim outpoint, or on-chain channel signature -- rather
%%% than through a node signature. No wallet and no trusted third party are
%%% involved: any node holding the committed bytes can re-derive every fact
%%% a commitment asserts.
%%%
%%% == Commitment shape ==
%%%
%%% Every commitment produced or verified by this device carries:
%%%
%%% <ul>
%%%   <li>`commitment-device': always `lbry@1.0'.</li>
%%%   <li>`evidence': the verification recipe name. One of `claim',
%%%       `channel', `stream', `descriptor', `blob', `transaction', or
%%%       `attestation'.</li>
%%%   <li>`type': the proof algorithm for the recipe (`sha-384',
%%%       `sha-256d', `hash160-outpoint', `asserted-claim-id',
%%%       `ancestor-hash160-outpoint', or `secp256k1-sha256').</li>
%%%   <li>`signature': the base64url-encoded native identifier bytes. The
%%%       commitment map key derives from these bytes (SHA-256 rehash for
%%%       non-32-byte identifiers), so the key survives wire round-trips.</li>
%%%   <li>`committed': the keys of the base message the commitment binds.</li>
%%%   <li>`native-id' and `native-id-type': the LBRY-native identifier in
%%%       lowercase hex (LBRY display identity) and its kind (`blob-hash',
%%%       `txid', `sd-hash', or `outpoint').</li>
%%%   <li>Kind-specific extras (`claim-id', `claim-op',
%%%       `claim-proof-strength', `public-key', `outpoint', `channel-*').</li>
%%% </ul>
%%%
%%% Evidence messages themselves are plain `message@1.0' data maps: they
%%% carry no `device' key. The commitment's `evidence' field alone selects
%%% how the message is verified.
%%%
%%% == Evidence kinds and verification recipes ==
%%%
%%% `verify/3' receives the base message and one of its commitments, and
%%% dispatches on the commitment's `evidence' field. Every recipe re-derives
%%% every asserted fact from the committed raw bytes and fails closed on any
%%% missing or mismatching input:
%%%
%%% <ul>
%%%   <li>`blob': committed keys `blob-hash', `content-digest', `data'. The
%%%       SHA-384 hash of the committed `data' bytes must equal the
%%%       commitment's 48-byte native identifier and the message's
%%%       `blob-hash' field; a present `content-digest' must re-derive from
%%%       the bytes.</li>
%%%   <li>`descriptor': committed keys `raw', `sd-hash'. The raw descriptor
%%%       bytes must hash to the native `sd_hash' and parse into a
%%%       structurally valid stream descriptor.</li>
%%%   <li>`transaction': committed keys `raw', `txid'. The raw transaction
%%%       bytes must recompute to the native display-order txid and parse as
%%%       a valid LBRY transaction.</li>
%%%   <li>`claim': the committed `raw-transaction' is re-parsed, the output
%%%       at the committed outpoint re-derived, and every committed claim
%%%       field matched against the fresh parse. `create' outputs carry the
%%%       hash-derived claim id (`hash160-outpoint'); `update' outputs are
%%%       assertion-level (`asserted-claim-id') unless a complete create
%%%       ancestry was replayed (`ancestor-hash160-outpoint').</li>
%%%   <li>`channel': the claim recipe plus the channel public key re-derived
%%%       from the raw channel claim protobuf and normalized to compressed
%%%       form.</li>
%%%   <li>`stream': the claim recipe plus the descriptor `sd_hash'
%%%       re-derived from the raw stream claim protobuf.</li>
%%%   <li>`attestation': the committed claim envelope's secp256k1 signature
%%%       verified against the recorded channel public key over the LBRY v2
%%%       signature digest, with the envelope's embedded signing-channel
%%%       hash bound to the recorded channel claim id. The key-to-channel
%%%       binding is proven by the embedded channel evidence message's own
%%%       `channel' commitment.</li>
%%% </ul>
%%%
%%% An unknown or missing `evidence' value verifies as `false'.
%%%
%%% == Committing ==
%%%
%%% `commit/3' re-derives a native commitment from raw evidence already
%%% carried by the target message, selected by the request's `evidence' key:
%%% `claim', `channel', and `stream' construct from `raw-transaction' and
%%% `nout' (upgrading through `claim-ancestry' when present); `blob' from
%%% `data' and `blob-hash'; `descriptor' from `raw' and `sd-hash';
%%% `transaction' from `raw'. The result is the canonical evidence message
%%% for the source object, carrying its native commitments.
%%%
%%% == Codec ==
%%%
%%% `from/3' converts source objects into TABM form. Raw binary inputs
%%% dispatch on the request's `evidence' key: `blob' (with a `blob-hash'
%%% request key), `descriptor' (with an optional `sd-hash'), `transaction'
%%% (raw or hex bytes, with an optional `encoding' of `hex'), and `claim'
%%% (a claim envelope, raw or hex). Map inputs are encoded directly, after
%%% envelope extraction for `claim'. `to/3' re-encodes a
%%% TABM to its structured form by default; a `format' request key of `raw'
%%% returns the source object's raw bytes (the `data' field for blobs, the
%%% `raw' field otherwise), and `hex' returns those bytes hex-encoded.
%%%
%%% == Trust model ==
%%%
%%% The commitment fields, including `evidence' and `committed', are
%%% attacker-controlled: nothing about a commitment is trusted until its
%%% recipe has re-derived every fact from the committed raw bytes. A forged
%%% `evidence' value can only select a recipe that fails -- each recipe pins
%%% its `type', restricts the committed key list to the kind's allowlist,
%%% and re-derives the native identifier -- never one that accepts.
%%% Claim-family recipes additionally vouch for co-evidence keys (`sd-hash',
%%% `channel-evidence') by re-derivation or sibling-commitment replay, so
%%% verifying a single commitment cannot accept keys only an unverified
%%% sibling would have proven. See `dev_lbry_commitment' for the recipe
%%% implementations and `hb_message:verify' (always called with
%%% `commitment-ids' set to `all') for the dispatch entrypoint.
-module(dev_lbry).
-implements(<<"lbry@1.0">>).
-export([from/3, to/3, to_hint/3, commit/3, verify/3, content_type/1]).
-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").
-endif.

%% @doc Return the content type for the codec.
content_type(_) ->
    {ok, <<"application/vnd.lbry">>}.

%% @doc Convert a source object into TABM form. Raw binary inputs dispatch
%% on the request's `evidence' key; map inputs are normalized per kind and
%% encoded directly.
from(Msg, Req, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"evidence">>, Req, undefined, Opts) of
        <<"claim">> ->
            from_structured(extract_envelope(Msg), Req, Opts);
        _ ->
            from_structured(Msg, Req, Opts)
    end;
from(Raw, Req, Opts) when is_binary(Raw) ->
    case hb_maps:get(<<"evidence">>, Req, undefined, Opts) of
        <<"blob">> -> from_blob(Raw, Req, Opts);
        <<"descriptor">> -> from_descriptor(Raw, Req, Opts);
        <<"transaction">> -> from_transaction(Raw, Req, Opts);
        <<"claim">> -> from_claim(Raw, Req, Opts);
        _ -> {error, missing_evidence}
    end.

%% @doc Re-encode a TABM. The default target is the structured form; a
%% `format' of `raw' returns the source object's raw bytes, and `hex'
%% returns those bytes hex-encoded.
to(Bin, _Req, _Opts) when is_binary(Bin) ->
    {ok, Bin};
to(TABM, Req, Opts) ->
    {ok, Structured} = to_structured(TABM, Req, Opts),
    case hb_maps:get(<<"format">>, Req, <<"structured">>, Opts) of
        <<"raw">> ->
            raw(Structured, Req, Opts);
        <<"hex">> ->
            case raw(Structured, Req, Opts) of
                {ok, Raw} when is_binary(Raw) -> {ok, hb_util:to_hex(Raw)};
                {ok, _} -> {error, invalid_raw_hex};
                Error -> Error
            end;
        _ ->
            {ok, Structured}
    end.

to_hint(_Msg, Req, _Opts) ->
    {ok, Req#{ <<"bundle">> => true }}.

%% @doc Re-derive a native commitment from raw evidence carried by the
%% target message, selected by the request's `evidence' key. The result is
%% the canonical evidence message for the source object.
commit(Msg, Req, Opts) ->
    case hb_maps:get(<<"evidence">>, Req, undefined, Opts) of
        <<"claim">> ->
            commit_claim_output(
                Msg,
                fun dev_lbry_commitment:claim_output_message/3,
                Opts
            );
        <<"channel">> ->
            commit_claim_output(
                Msg,
                fun dev_lbry_commitment:channel_output_message/3,
                Opts
            );
        <<"stream">> ->
            commit_claim_output(
                Msg,
                fun dev_lbry_commitment:stream_claim_message/3,
                Opts
            );
        <<"blob">> -> commit_blob(Msg, Opts);
        <<"descriptor">> -> commit_descriptor(Msg, Opts);
        <<"transaction">> -> commit_transaction(Msg, Opts);
        _ -> {error, unsupported_evidence}
    end.

%% @doc Verify a native commitment against its base message, dispatching on
%% the commitment's `evidence' field. Unknown or missing evidence fails
%% closed. Always returns `{ok, boolean()}'.
verify(Base, Req, Opts) ->
    case hb_maps:get(<<"evidence">>, Req, undefined, Opts) of
        <<"claim">> ->
            {ok, valid(dev_lbry_commitment:claim_output_verification(Base, Req, Opts))};
        <<"channel">> ->
            {ok, valid(dev_lbry_commitment:channel_output_verification(Base, Req, Opts))};
        <<"stream">> ->
            {ok, valid(dev_lbry_commitment:stream_output_verification(Base, Req, Opts))};
        <<"attestation">> ->
            {ok, valid(dev_lbry_commitment:attestation_verification(Base, Req, Opts))};
        <<"blob">> -> verify_blob(Base, Req, Opts);
        <<"descriptor">> -> verify_descriptor(Base, Req, Opts);
        <<"transaction">> -> verify_transaction(Base, Req, Opts);
        _ -> {ok, false}
    end.

valid({ok, _}) -> true;
valid(_) -> false.

%% @doc Verify a blob commitment: the SHA-384 hash of the committed `data'
%% bytes must equal the commitment's native identifier, and the message's
%% `blob-hash' key must agree with the commitment. Any missing or
%% mismatching input fails closed.
verify_blob(Base, Req, Opts) ->
    Valid =
        maybe
            <<"sha-384">> ?= hb_maps:get(<<"type">>, Req, undefined, Opts),
            ok ?=
                dev_lbry_commitment:committed_subset(
                    Req,
                    [<<"blob-hash">>, <<"content-digest">>, <<"data">>],
                    Opts
                ),
            {ok, Hex, Bytes} ?= dev_lbry_commitment:native_id(Req, Opts),
            48 ?= byte_size(Bytes),
            Data = hb_maps:get(<<"data">>, Base, undefined, Opts),
            true ?= is_binary(Data),
            ok ?= dev_lbry_stream_descriptor:verify_blob_hash(Hex, Data),
            true ?= digest_field_valid(Base, Data, Opts),
            Hex == hex_field(Base, <<"blob-hash">>, Opts)
        else
            _ -> false
        end,
    {ok, Valid}.

%% @doc Verify a stream descriptor commitment: the raw descriptor bytes must
%% hash to the commitment's native `sd_hash' and parse into a structurally
%% valid stream descriptor. The message's `sd-hash' key must agree with the
%% commitment. Any missing or mismatching input fails closed.
verify_descriptor(Base, Req, Opts) ->
    Valid =
        maybe
            <<"sha-384">> ?= hb_maps:get(<<"type">>, Req, undefined, Opts),
            ok ?=
                dev_lbry_commitment:committed_subset(
                    Req,
                    [<<"raw">>, <<"sd-hash">>],
                    Opts
                ),
            {ok, Hex, Bytes} ?= dev_lbry_commitment:native_id(Req, Opts),
            48 ?= byte_size(Bytes),
            Raw = hb_maps:get(<<"raw">>, Base, undefined, Opts),
            true ?= is_binary(Raw),
            {ok, _Descriptor} ?= dev_lbry_stream_descriptor:parse(Raw, Hex),
            Hex == hex_field(Base, <<"sd-hash">>, Opts)
        else
            _ -> false
        end,
    {ok, Valid}.

%% @doc Verify a transaction commitment: the raw transaction bytes must
%% recompute to the commitment's native display-order txid and parse as a
%% valid transaction. The message's `txid' key must agree with the
%% commitment. Any missing or mismatching input fails closed.
verify_transaction(Base, Req, Opts) ->
    Valid =
        maybe
            <<"sha-256d">> ?= hb_maps:get(<<"type">>, Req, undefined, Opts),
            ok ?=
                dev_lbry_commitment:committed_subset(
                    Req,
                    [<<"raw">>, <<"txid">>],
                    Opts
                ),
            {ok, Hex, Bytes} ?= dev_lbry_commitment:native_id(Req, Opts),
            32 ?= byte_size(Bytes),
            {ok, Raw} ?=
                dev_lbry_commitment:evidence_decode(
                    hb_maps:get(<<"raw">>, Base, undefined, Opts)
                ),
            Hex ?= dev_lbry_tx:txid(Raw),
            {ok, _Tx} ?= dev_lbry_tx:parse(Raw),
            Hex == hex_field(Base, <<"txid">>, Opts)
        else
            _ -> false
        end,
    {ok, Valid}.

hex_field(Base, Key, Opts) ->
    case hb_maps:get(Key, Base, undefined, Opts) of
        Value when is_binary(Value) -> hb_util:to_lower(Value);
        _ -> undefined
    end.

digest_field_valid(Base, Data, Opts) ->
    case hb_maps:get(<<"content-digest">>, Base, undefined, Opts) of
        Digest when is_binary(Digest) ->
            Digest =:= dev_lbry_commitment:content_digest_sha384(Data);
        _ ->
            true
    end.

%%% Commit construction

commit_claim_output(Msg, Construct, Opts) ->
    maybe
        Raw0 = hb_maps:get(<<"raw-transaction">>, Msg, undefined, Opts),
        true ?= is_binary(Raw0) orelse {error, missing_raw_transaction},
        Nout = hb_maps:get(<<"nout">>, Msg, undefined, Opts),
        true ?= (Nout =/= undefined) orelse {error, missing_nout},
        Construct(raw_input(Raw0), hb_util:int(Nout), ancestry_field(Msg, Opts))
    end.

%% @doc Accept raw evidence bytes either directly or in their hex message
%% encoding. Real transactions are never all-hex-character byte strings,
%% so the decode is unambiguous in practice.
raw_input(Bin) when is_binary(Bin) ->
    case dev_lbry_commitment:evidence_decode(Bin) of
        {ok, Bytes} -> Bytes;
        _ -> Bin
    end;
raw_input(Other) ->
    Other.

ancestry_field(Msg, Opts) ->
    Ancestry =
        hb_cache:ensure_all_loaded(
            hb_maps:get(<<"claim-ancestry">>, Msg, undefined, Opts),
            Opts
        ),
    case Ancestry of
        undefined -> undefined;
        List when is_list(List) -> List;
        Map when is_map(Map) -> hb_util:message_to_ordered_list(Map, Opts)
    end.

commit_blob(Msg, Opts) ->
    maybe
        Data = hb_maps:get(<<"data">>, Msg, undefined, Opts),
        true ?= is_binary(Data) orelse {error, missing_blob_data},
        Hash = hb_maps:get(<<"blob-hash">>, Msg, undefined, Opts),
        true ?= is_binary(Hash) orelse {error, missing_blob_hash},
        ok ?= dev_lbry_stream_descriptor:verify_blob_hash(Hash, Data),
        {ok, dev_lbry_commitment:blob_message(Hash, Data)}
    end.

commit_descriptor(Msg, Opts) ->
    maybe
        Raw = hb_maps:get(<<"raw">>, Msg, undefined, Opts),
        true ?= is_binary(Raw) orelse {error, missing_raw},
        SDHash = hb_maps:get(<<"sd-hash">>, Msg, undefined, Opts),
        true ?= is_binary(SDHash) orelse {error, missing_sd_hash},
        dev_lbry_commitment:descriptor_message(Raw, SDHash)
    end.

commit_transaction(Msg, Opts) ->
    maybe
        Raw = hb_maps:get(<<"raw">>, Msg, undefined, Opts),
        true ?= is_binary(Raw) orelse {error, missing_raw},
        dev_lbry_commitment:transaction_message(raw_input(Raw))
    end.

%%% Raw-input decoding

from_blob(Raw, Req, Opts) ->
    case hb_maps:get(<<"blob-hash">>, Req, undefined, Opts) of
        undefined ->
            {error, missing_blob_hash};
        Hash ->
            case dev_lbry_stream_descriptor:verify_blob_hash(Hash, Raw) of
                ok ->
                    from_structured(
                        dev_lbry_commitment:blob_message(Hash, Raw),
                        Req,
                        Opts
                    );
                Error ->
                    Error
            end
    end.

from_descriptor(Raw, Req, Opts) ->
    Result =
        case hb_maps:get(<<"sd-hash">>, Req, undefined, Opts) of
            undefined -> dev_lbry_stream_descriptor:parse(Raw);
            SDHash -> dev_lbry_commitment:descriptor_message(Raw, SDHash)
        end,
    case Result of
        {ok, Descriptor} ->
            from_structured(Descriptor, Req, Opts);
        Error ->
            Error
    end.

from_transaction(Raw, Req, Opts) ->
    Decoded =
        case hb_maps:get(<<"encoding">>, Req, undefined, Opts) of
            <<"hex">> ->
                decode_tx_hex(Raw);
            _ ->
                {ok, Raw}
        end,
    Result =
        case Decoded of
            {ok, Bytes} ->
                case dev_lbry_commitment:transaction_message(Bytes) of
                    {ok, _} = Ok -> Ok;
                    Error when Raw == Bytes -> retry_as_hex(Raw, Error);
                    Error -> Error
                end;
            Error ->
                Error
        end,
    case Result of
        {ok, Tx} -> from_structured(Tx, Req, Opts);
        DecodeError -> DecodeError
    end.

%% Bare binary inputs may be raw bytes or hex without an `encoding' hint;
%% retry the hex interpretation before failing, matching the previous
%% auto-detection behavior.
retry_as_hex(Raw, ParseError) ->
    case decode_tx_hex(Raw) of
        {ok, Bytes} ->
            case dev_lbry_commitment:transaction_message(Bytes) of
                {ok, _} = Ok -> Ok;
                _ -> ParseError
            end;
        _ ->
            ParseError
    end.

decode_tx_hex(Raw) ->
    case hex_to_binary(Raw) of
        {ok, Bytes} -> {ok, Bytes};
        _ -> {error, invalid_tx_hex}
    end.

from_claim(Raw, Req, Opts) ->
    Decoded =
        case hb_maps:get(<<"encoding">>, Req, undefined, Opts) of
            <<"hex">> -> hex_to_binary(Raw);
            _ -> {ok, Raw}
        end,
    case Decoded of
        {ok, Bytes} ->
            case dev_lbry_tx:parse_claim_envelope(Bytes) of
                {ok, Envelope} ->
                    from_structured(Envelope, Req, Opts);
                Error ->
                    Error
            end;
        Error ->
            Error
    end.

%%% Map-input normalization

extract_envelope(#{ <<"claim-envelope">> := Envelope }) when is_map(Envelope) ->
    Envelope;
extract_envelope(Msg) ->
    Msg.

%%% Conversion plumbing

from_structured(Msg, Req, Opts) ->
    ConvOpts = Opts#{ <<"hashpath">> => ignore },
    {ok,
        hb_message:convert(
            Msg,
            tabm,
            Req#{
                <<"device">> => <<"structured@1.0">>,
                <<"bundle">> => true
            },
            ConvOpts
        )
    }.

to_structured(TABM, _Req, Opts) ->
    ConvOpts = Opts#{ <<"hashpath">> => ignore },
    {ok,
        hb_message:convert(
            TABM,
            <<"structured@1.0">>,
            tabm,
            ConvOpts
        )
    }.

raw(Structured, Req, Opts) ->
    case hb_maps:get(<<"evidence">>, Req, undefined, Opts) of
        <<"blob">> ->
            case maps:get(<<"data">>, Structured, undefined) of
                undefined -> {error, missing_blob_data};
                Data -> {ok, hb_cache:ensure_all_loaded(Data, Opts)}
            end;
        _ ->
            case maps:get(<<"raw">>, Structured, undefined) of
                undefined -> {error, missing_raw};
                Raw ->
                    % Transaction evidence carries `raw' in its hex message
                    % encoding; descriptor evidence carries ASCII JSON.
                    % `raw_input' decodes the former and passes the latter.
                    {ok, raw_input(hb_cache:ensure_all_loaded(Raw, Opts))}
            end
    end.

hex_to_binary(Hex) when is_binary(Hex) ->
    try binary:decode_hex(hb_util:to_lower(Hex)) of
        Bin -> {ok, Bin}
    catch
        _:_ -> {error, invalid_hex}
    end.

%%% Tests

-ifdef(TEST).

reverse(Bin) ->
    binary:list_to_bin(lists:reverse(binary:bin_to_list(Bin))).

blob_verify_test() ->
    Bytes = <<"encrypted blob bytes">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Msg = dev_lbry_commitment:blob_message(Hash, Bytes),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual(<<"blob">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual({ok, true}, verify(Msg, Commitment, #{})),
    Tampered = Msg#{ <<"data">> => <<"tampered blob bytes!">> },
    ?assertEqual({ok, false}, verify(Tampered, Commitment, #{})).

transaction_verify_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, Msg} = dev_lbry_commitment:transaction_message(Raw),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual({ok, true}, verify(Msg, Commitment, #{})),
    <<First, Rest/binary>> = Raw,
    Tampered = Msg#{ <<"raw">> => <<(First bxor 1), Rest/binary>> },
    ?assertEqual({ok, false}, verify(Tampered, Commitment, #{})).

descriptor_verify_test() ->
    Raw = hb_json:encode(sample_descriptor_json()),
    SDHash = dev_lbry_stream_descriptor:descriptor_hash(Raw),
    {ok, Msg} = dev_lbry_commitment:descriptor_message(Raw, SDHash),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual({ok, true}, verify(Msg, Commitment, #{})),
    Other =
        hb_json:encode(
            (sample_descriptor_json())#{ <<"stream_type">> => <<"other">> }
        ),
    ?assertEqual({ok, false}, verify(Msg#{ <<"raw">> => Other }, Commitment, #{})).

claim_verify_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, Msg} = dev_lbry_commitment:claim_output_message(Raw, 0),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual(<<"claim">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual({ok, true}, verify(Msg, Commitment, #{})),
    Tampered = Msg#{
        <<"claim-id">> => <<"0000000000000000000000000000000000000000">>
    },
    ?assertEqual({ok, false}, verify(Tampered, Commitment, #{})).

channel_verify_test() ->
    {Compressed, _} = sample_channel_keys(),
    Raw = channel_claim_tx(Compressed),
    {ok, Msg} = dev_lbry_commitment:channel_output_message(Raw, 0),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual(<<"channel">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual({ok, true}, verify(Msg, Commitment, #{})),
    OtherKey =
        hb_util:to_hex(
            ar_wallet:compress_ecdsa_pubkey(
                element(1, crypto:generate_key(ecdh, secp256k1, <<2:256>>))
            )
        ),
    Tampered = Msg#{ <<"public-key">> => OtherKey },
    ?assertEqual({ok, false}, verify(Tampered, Commitment, #{})).

stream_verify_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, Msg} = dev_lbry_commitment:stream_claim_message(Raw, 0),
    Commitments = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual(2, length(Commitments)),
    lists:foreach(
        fun(Commitment) ->
            ?assertEqual({ok, true}, verify(Msg, Commitment, #{}))
        end,
        Commitments
    ),
    [StreamCommitment] =
        [
            Commitment
         ||
            Commitment <- Commitments,
            maps:get(<<"evidence">>, Commitment) == <<"stream">>
        ],
    Tampered = Msg#{
        <<"sd-hash">> => hb_util:to_hex(crypto:hash(sha384, <<"other">>))
    },
    ?assertEqual({ok, false}, verify(Tampered, StreamCommitment, #{})).

attestation_verify_test() ->
    {Compressed, _} = sample_channel_keys(),
    {ok, ChannelMsg} =
        dev_lbry_commitment:channel_output_message(
            channel_claim_tx(Compressed),
            0
        ),
    StreamMsg = signed_stream_claim_for_channel(ChannelMsg, <<1:256>>),
    {ok, Committed} =
        dev_lbry_commitment:with_attestation_commitment(StreamMsg, ChannelMsg),
    [Attestation] =
        [
            Commitment
         ||
            Commitment <- maps:values(maps:get(<<"commitments">>, Committed)),
            maps:get(<<"evidence">>, Commitment) == <<"attestation">>
        ],
    ?assertEqual({ok, true}, verify(Committed, Attestation, #{})),
    OtherKey =
        hb_util:to_hex(
            ar_wallet:compress_ecdsa_pubkey(
                element(1, crypto:generate_key(ecdh, secp256k1, <<2:256>>))
            )
        ),
    Tampered = Attestation#{ <<"channel-public-key">> => OtherKey },
    ?assertEqual({ok, false}, verify(Committed, Tampered, #{})).

evidence_relabel_fails_closed_test() ->
    % A commitment's `evidence' field selects its verification recipe; a
    % relabeled kind must dispatch to a recipe that fails closed, never one
    % that accepts.
    Bytes = <<"encrypted blob bytes">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, TxMsg} = dev_lbry_commitment:transaction_message(Raw),
    {ok, ClaimMsg} = dev_lbry_commitment:claim_output_message(Raw, 0),
    {Compressed, _} = sample_channel_keys(),
    {ok, ChannelMsg} =
        dev_lbry_commitment:channel_output_message(
            channel_claim_tx(Compressed),
            0
        ),
    DescriptorRaw = hb_json:encode(sample_descriptor_json()),
    {ok, DescriptorMsg} =
        dev_lbry_commitment:descriptor_message(
            DescriptorRaw,
            dev_lbry_stream_descriptor:descriptor_hash(DescriptorRaw)
        ),
    Cases = [
        {dev_lbry_commitment:blob_message(Hash, Bytes), <<"claim">>},
        {TxMsg, <<"blob">>},
        {ClaimMsg, <<"blob">>},
        {ChannelMsg, <<"claim">>},
        {DescriptorMsg, <<"blob">>}
    ],
    lists:foreach(
        fun({Msg, Wrong}) ->
            [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
            Relabeled = Msg#{
                <<"commitments">> =>
                    maps:map(
                        fun(_ID, C) -> C#{ <<"evidence">> => Wrong } end,
                        maps:get(<<"commitments">>, Msg)
                    )
            },
            ?assertEqual(
                {ok, false},
                verify(Relabeled, Commitment#{ <<"evidence">> => Wrong }, #{})
            ),
            ?assertEqual(
                {ok, false},
                verify(Msg, Commitment#{ <<"evidence">> => <<"mystery">> }, #{})
            ),
            ?assertEqual(
                {ok, false},
                verify(Msg, maps:remove(<<"evidence">>, Commitment), #{})
            )
        end,
        Cases
    ).

commit_rederives_native_commitments_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    Bytes = <<"encrypted blob bytes">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    DescriptorRaw = hb_json:encode(sample_descriptor_json()),
    SDHash = dev_lbry_stream_descriptor:descriptor_hash(DescriptorRaw),
    Cases = [
        {#{ <<"raw-transaction">> => Raw, <<"nout">> => 0 }, <<"claim">>},
        {#{ <<"raw-transaction">> => Raw, <<"nout">> => <<"0">> }, <<"stream">>},
        {#{ <<"data">> => Bytes, <<"blob-hash">> => Hash }, <<"blob">>},
        {
            #{ <<"raw">> => DescriptorRaw, <<"sd-hash">> => SDHash },
            <<"descriptor">>
        },
        {#{ <<"raw">> => Raw }, <<"transaction">>}
    ],
    lists:foreach(
        fun({Msg, Evidence}) ->
            {ok, Rebuilt} = commit(Msg, #{ <<"evidence">> => Evidence }, #{}),
            Commitments = maps:values(maps:get(<<"commitments">>, Rebuilt)),
            ?assert(
                lists:any(
                    fun(Commitment) ->
                        maps:get(<<"evidence">>, Commitment) == Evidence
                    end,
                    Commitments
                )
            ),
            lists:foreach(
                fun(Commitment) ->
                    ?assertEqual({ok, true}, verify(Rebuilt, Commitment, #{}))
                end,
                Commitments
            )
        end,
        Cases
    ),
    ?assertEqual(
        {error, missing_raw_transaction},
        commit(#{ <<"nout">> => 0 }, #{ <<"evidence">> => <<"claim">> }, #{})
    ),
    ?assertEqual(
        {error, unsupported_evidence},
        commit(#{}, #{ <<"evidence">> => <<"attestation">> }, #{})
    ),
    ?assertEqual({error, unsupported_evidence}, commit(#{}, #{}, #{})).

transaction_codec_roundtrip_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, TABM} = from(Raw, #{ <<"evidence">> => <<"transaction">> }, #{}),
    ?assertEqual({ok, Raw}, to(TABM, #{ <<"format">> => <<"raw">> }, #{})),
    ?assertEqual(
        {ok, hb_util:to_hex(Raw)},
        to(TABM, #{ <<"format">> => <<"hex">> }, #{})
    ),
    {ok, FromHex} =
        from(
            hb_util:to_hex(Raw),
            #{ <<"evidence">> => <<"transaction">>, <<"encoding">> => <<"hex">> },
            #{}
        ),
    ?assertEqual(
        maps:get(<<"txid">>, TABM),
        maps:get(<<"txid">>, FromHex)
    ),
    % Hex input without an `encoding' hint is auto-detected.
    {ok, AutoHex} = from(hb_util:to_hex(Raw), #{ <<"evidence">> => <<"transaction">> }, #{}),
    ?assertEqual(maps:get(<<"txid">>, TABM), maps:get(<<"txid">>, AutoHex)).

blob_codec_roundtrip_test() ->
    Bytes = <<"encrypted blob payload">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Req = #{ <<"evidence">> => <<"blob">>, <<"blob-hash">> => Hash },
    {ok, TABM} = from(Bytes, Req, #{}),
    ?assertEqual(Hash, maps:get(<<"blob-hash">>, TABM)),
    ?assertEqual(
        {ok, Bytes},
        to(TABM, Req#{ <<"format">> => <<"raw">> }, #{})
    ),
    WrongHash = dev_lbry_stream_descriptor:blob_hash(<<"other payload">>),
    ?assertMatch(
        {error, {hash_mismatch, _, _}},
        from(Bytes, Req#{ <<"blob-hash">> => WrongHash }, #{})
    ),
    ?assertEqual({error, missing_blob_hash}, from(Bytes, #{ <<"evidence">> => <<"blob">> }, #{})).

descriptor_codec_roundtrip_test() ->
    Raw = hb_json:encode(sample_descriptor_json()),
    SDHash = dev_lbry_stream_descriptor:descriptor_hash(Raw),
    Req = #{ <<"evidence">> => <<"descriptor">>, <<"sd-hash">> => SDHash },
    {ok, TABM} = from(Raw, Req, #{}),
    ?assertEqual(SDHash, maps:get(<<"sd-hash">>, TABM)),
    ?assertEqual({ok, Raw}, to(TABM, Req#{ <<"format">> => <<"raw">> }, #{})).

claim_codec_roundtrip_test() ->
    ChannelHash = <<1:160>>,
    Signature = <<2:512>>,
    Message = <<"claim protobuf">>,
    Raw = <<1, ChannelHash/binary, Signature/binary, Message/binary>>,
    {ok, TABM} = from(Raw, #{ <<"evidence">> => <<"claim">> }, #{}),
    {ok, Structured} = to(TABM, #{}, #{}),
    ?assertEqual(true, maps:get(<<"signed">>, Structured)),
    ?assertEqual({ok, Raw}, to(TABM, #{ <<"format">> => <<"raw">> }, #{})),
    ?assertEqual(
        {ok, hb_util:to_hex(Raw)},
        to(TABM, #{ <<"format">> => <<"hex">> }, #{})
    ),
    {ok, FromHex} =
        from(
            hb_util:to_hex(Raw),
            #{ <<"evidence">> => <<"claim">>, <<"encoding">> => <<"hex">> },
            #{}
        ),
    ?assertEqual({ok, Raw}, to(FromHex, #{ <<"format">> => <<"raw">> }, #{})).

to_hint_and_content_type_test() ->
    ?assertEqual({ok, #{ <<"bundle">> => true }}, to_hint(#{}, #{}, #{})),
    ?assertEqual({ok, <<"application/vnd.lbry">>}, content_type(#{})).

%%% Test fixtures

sample_channel_keys() ->
    {Uncompressed, _} = crypto:generate_key(ecdh, secp256k1, <<1:256>>),
    {ar_wallet:compress_ecdsa_pubkey(Uncompressed), Uncompressed}.

sample_descriptor_json() ->
    Key = <<0:128>>,
    IV = <<1:128>>,
    Cipher = crypto:crypto_one_time(aes_128_cbc, Key, IV, <<2:128>>, true),
    #{
        <<"stream_type">> => <<"lbryfile">>,
        <<"stream_name">> => hb_util:to_hex(<<"sample.mp4">>),
        <<"key">> => hb_util:to_hex(Key),
        <<"suggested_file_name">> => hb_util:to_hex(<<"sample.mp4">>),
        <<"stream_hash">> => dev_lbry_stream_descriptor:blob_hash(<<"stream">>),
        <<"blobs">> => [
            #{
                <<"length">> => byte_size(Cipher),
                <<"blob_num">> => 0,
                <<"iv">> => hb_util:to_hex(IV),
                <<"blob_hash">> => dev_lbry_stream_descriptor:blob_hash(Cipher)
            },
            #{
                <<"length">> => 0,
                <<"blob_num">> => 1,
                <<"iv">> => hb_util:to_hex(<<0:128>>)
            }
        ]
    }.

channel_claim_tx(StoredKey) ->
    Claim = <<0, (proto_field(2, proto_field(1, StoredKey)))/binary>>,
    create_claim_tx(<<"@channel">>, Claim).

signed_stream_claim_for_channel(ChannelMsg, PrivKey) ->
    SDHash = crypto:hash(sha384, <<"signed stream">>),
    StreamProto = proto_field(1, proto_field(1, proto_field(6, SDHash))),
    ChannelHash = reverse(binary:decode_hex(maps:get(<<"claim-id">>, ChannelMsg))),
    Digest =
        crypto:hash(
            sha256,
            <<0:256, 0:32/little, ChannelHash/binary, StreamProto/binary>>
        ),
    Signature =
        der_to_compact(
            crypto:sign(ecdsa, sha256, {digest, Digest}, [PrivKey, secp256k1])
        ),
    Envelope = <<1, ChannelHash/binary, Signature/binary, StreamProto/binary>>,
    {ok, StreamMsg} =
        dev_lbry_commitment:stream_claim_message(
            create_claim_tx(<<"video">>, Envelope),
            0
        ),
    StreamMsg.

create_claim_tx(Name, Claim) ->
    Script = <<
        16#b5,
        (script_push(Name))/binary,
        (script_push(Claim))/binary,
        16#6d, 16#75
    >>,
    tx_with_script(Script).

tx_with_script(Script) ->
    <<1:32/little-signed,
        1,
        0:256,
        0:32/little,
        0,
        16#ffffffff:32/little,
        1,
        0:64/little,
        (byte_size(Script)),
        Script/binary,
        0:32/little>>.

proto_field(Number, Value) ->
    Key = (Number bsl 3) bor 2,
    <<(proto_varint(Key))/binary,
        (proto_varint(byte_size(Value)))/binary,
        Value/binary>>.

proto_varint(Value) when Value < 16#80 ->
    <<Value>>;
proto_varint(Value) ->
    <<((Value band 16#7f) bor 16#80), (proto_varint(Value bsr 7))/binary>>.

script_push(Value) when byte_size(Value) < 16#4c ->
    <<(byte_size(Value)), Value/binary>>;
script_push(Value) when byte_size(Value) =< 16#ff ->
    <<16#4c, (byte_size(Value)), Value/binary>>.

der_to_compact(
    <<16#30, _TotalLen, 16#02, RLen, R0:RLen/binary, 16#02, SLen, S0:SLen/binary>>
) ->
    <<(fixed_int(R0))/binary, (fixed_int(S0))/binary>>.

fixed_int(Int) ->
    Trimmed = trim_zeroes(Int),
    Padding = 32 - byte_size(Trimmed),
    <<0:(Padding * 8), Trimmed/binary>>.

trim_zeroes(<<0, Rest/binary>> = Int) when byte_size(Int) > 32 ->
    trim_zeroes(Rest);
trim_zeroes(Int) ->
    Int.

-endif.
