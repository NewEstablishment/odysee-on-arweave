%%% @doc The `lbry@1.0' commitment device: verifies native LBRY
%%% commitments on HyperBEAM messages.
%%%
%%% A native commitment binds a message to an LBRY source object through the
%%% object's own content addressing -- a blob hash, stream-descriptor hash,
%%% transaction id, claim outpoint, or on-chain channel signature -- rather
%%% than through a node signature. No wallet and no trusted third party are
%%% involved: any node holding the committed bytes can re-derive every fact
%%% a commitment asserts.
%%%
%%% This device is a pure verifier: `verify/3' is its one load-bearing
%%% key, reached through the `commitment-device' dispatch in `dev_message'.
%%% Evidence messages are constructed by the store layer through
%%% `dev_lbry_commitment' (which this module also dispatches into for the
%%% claim-family recipes), so the device carries no `commit' or codec
%%% surface of its own. `to_hint/3' remains because `hb_message' calls it
%%% on the commitment device while converting a message to TABM for
%%% verification.
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
-export([verify/3, to_hint/3, content_type/1]).
-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").
-endif.

%% @doc Return the content type for the device.
content_type(_) ->
    {ok, <<"application/vnd.lbry">>}.

%% @doc Bundle hint for the structured codec. Evidence messages carry
%% nested submessages (a claim's decoded `value', an attestation's
%% `channel-evidence'), so they are always bundled; `hb_message' calls
%% this on the commitment device while converting a message to TABM for
%% verification.
to_hint(_Msg, Req, _Opts) ->
    {ok, Req#{ <<"bundle">> => true }}.

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

claim_verify_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, Msg} = dev_lbry_commitment:claim_output_message(Raw, 0),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual(<<"claim">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual({ok, true}, verify(Msg, Commitment, #{})).

%% The device dispatches on the commitment's `evidence' field alone.
%% Relabeling a commitment to a different, mystery, or absent evidence
%% kind must fail closed -- a wrong recipe cannot accept another recipe's
%% message. The per-kind recipes are exercised end-to-end through
%% `hb_message:verify' in `dev_lbry_commitment'.
dispatch_fails_closed_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, Msg} = dev_lbry_commitment:transaction_message(Raw),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual({ok, true}, verify(Msg, Commitment, #{})),
    ?assertEqual(
        {ok, false},
        verify(Msg, Commitment#{ <<"evidence">> => <<"claim">> }, #{})),
    ?assertEqual(
        {ok, false},
        verify(Msg, Commitment#{ <<"evidence">> => <<"mystery">> }, #{})),
    ?assertEqual(
        {ok, false},
        verify(Msg, maps:remove(<<"evidence">>, Commitment), #{})).

-endif.
