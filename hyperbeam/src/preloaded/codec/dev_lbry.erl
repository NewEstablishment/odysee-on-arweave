-module(dev_lbry).
-implements(<<"lbry@1.0">>).
-export([verify/3, to_hint/3, content_type/1]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

content_type(_) ->
    {ok, <<"application/vnd.lbry">>}.

to_hint(_Msg, Req, _Opts) ->
    {ok, Req#{ <<"bundle">> => true }}.

verify(Base, Req, Opts) ->
    Result =
        case hb_lbry_commitment:unified_verification_input(Base, Req, Opts) of
            {ok, LegacyBase, LegacyReq, Evidence} ->
                verify_evidence(Evidence, LegacyBase, LegacyReq, Opts);
            _ ->
                false
        end,
    ?event(lbry_commitment, {unified_verify, {valid, Result}}),
    {ok, Result}.

verify_evidence(<<"blob">>, Base, Req, Opts) ->
    maybe
        <<"sha-384">> ?= hb_maps:get(<<"type">>, Req, undefined, Opts),
        <<"lbry-blob@1.0">> ?= hb_maps:get(<<"device">>, Base, undefined, Opts),
        ok ?=
            hb_lbry_commitment:committed_subset(
                Req,
                [<<"blob-hash">>, <<"content-digest">>, <<"data">>, <<"device">>],
                Opts
            ),
        {ok, Hex, Bytes} ?= hb_lbry_commitment:native_id(Req, Opts),
        48 ?= byte_size(Bytes),
        Data = hb_maps:get(<<"data">>, Base, undefined, Opts),
        true ?= is_binary(Data),
        ok ?= hb_lbry_stream_descriptor:verify_blob_hash(Hex, Data),
        true ?= digest_field_valid(Base, Data, Opts),
        Hex ?= lower_field(Base, <<"blob-hash">>, Opts),
        true
    else
        _ -> false
    end;
verify_evidence(<<"descriptor">>, Base, Req, Opts) ->
    maybe
        <<"sha-384">> ?= hb_maps:get(<<"type">>, Req, undefined, Opts),
        <<"lbry-stream-descriptor@1.0">> ?=
            hb_maps:get(<<"device">>, Base, undefined, Opts),
        ok ?=
            hb_lbry_commitment:committed_subset(
                Req,
                [<<"device">>, <<"raw">>, <<"sd-hash">>],
                Opts
            ),
        {ok, Hex, Bytes} ?= hb_lbry_commitment:native_id(Req, Opts),
        48 ?= byte_size(Bytes),
        Raw = hb_maps:get(<<"raw">>, Base, undefined, Opts),
        true ?= is_binary(Raw),
        {ok, _} ?= hb_lbry_stream_descriptor:parse(Raw, Hex),
        Hex ?= lower_field(Base, <<"sd-hash">>, Opts),
        true
    else
        _ -> false
    end;
verify_evidence(<<"transaction">>, Base, Req, Opts) ->
    maybe
        <<"sha-256d">> ?= hb_maps:get(<<"type">>, Req, undefined, Opts),
        <<"lbry-transaction@1.0">> ?=
            hb_maps:get(<<"device">>, Base, undefined, Opts),
        ok ?=
            hb_lbry_commitment:committed_subset(
                Req,
                [<<"device">>, <<"raw">>, <<"txid">>],
                Opts
            ),
        {ok, Hex, Bytes} ?= hb_lbry_commitment:native_id(Req, Opts),
        32 ?= byte_size(Bytes),
        Raw = hb_maps:get(<<"raw">>, Base, undefined, Opts),
        true ?= is_binary(Raw),
        Hex ?= hb_lbry_tx:txid(Raw),
        {ok, _} ?= hb_lbry_tx:parse(Raw),
        Hex ?= lower_field(Base, <<"txid">>, Opts),
        true
    else
        _ -> false
    end;
verify_evidence(<<"claim">>, Base, Req, Opts) ->
    valid(hb_lbry_commitment:claim_output_verification(Base, Req, Opts));
verify_evidence(<<"channel">>, Base, Req, Opts) ->
    valid(hb_lbry_commitment:channel_output_verification(Base, Req, Opts));
verify_evidence(<<"stream">>, Base, Req, Opts) ->
    valid(hb_lbry_commitment:stream_output_verification(Base, Req, Opts));
verify_evidence(<<"attestation">>, Base, Req, Opts) ->
    valid(hb_lbry_commitment:attestation_verification(Base, Req, Opts));
verify_evidence(_, _Base, _Req, _Opts) ->
    false.

valid({ok, _}) -> true;
valid(_) -> false.

lower_field(Base, Key, Opts) ->
    case hb_maps:get(Key, Base, undefined, Opts) of
        Value when is_binary(Value) ->
            try hb_util:to_lower(Value)
            catch
                _:_ -> undefined
            end;
        _ -> undefined
    end.

digest_field_valid(Base, Data, Opts) ->
    case hb_maps:get(<<"content-digest">>, Base, undefined, Opts) of
        Digest when is_binary(Digest) ->
            Digest =:= hb_lbry_commitment:content_digest_sha384(Data);
        _ -> true
    end.

-ifdef(TEST).

unified_transaction_dispatch_test() ->
    Unified = unified_transaction(),
    ?assert(hb_message:verify(Unified, verify_all(), #{})).

unified_transaction_tamper_fails_test() ->
    Unified = unified_transaction(),
    Raw = maps:get(<<"raw">>, Unified),
    {ok, Bytes} = hb_lbry_commitment:evidence_decode(Raw),
    Tampered = Unified#{
        <<"raw">> =>
            hb_lbry_commitment:evidence_encode(
                <<Bytes/binary, 0>>
            )
    },
    ?assertNot(hb_message:verify(Tampered, verify_all(), #{})).

unified_transaction_noncanonical_evidence_fails_test() ->
    Unified = unified_transaction(),
    Raw = maps:get(<<"raw">>, Unified),
    ?assertNot(
        hb_message:verify(
            Unified#{ <<"raw">> => <<Raw/binary, "=">> },
            verify_all(),
            #{}
        )
    ).

unified_unknown_evidence_fails_test() ->
    Unified = unified_transaction(),
    Commitments = maps:get(<<"commitments">>, Unified),
    [{ID, Commitment}] = maps:to_list(Commitments),
    Unknown = Unified#{
        <<"commitments">> => Commitments#{
            ID => Commitment#{ <<"evidence">> => <<"unknown">> }
        }
    },
    ?assertNot(hb_message:verify(Unknown, verify_all(), #{})).

unified_remote_transaction_verifies_test() ->
    Unified = unified_transaction(),
    TxID = maps:get(<<"txid">>, Unified),
    {ok, Verified} =
        hb_lbry_commitment:verify_remote_read(
            TxID,
            Unified,
            #{ <<"verify-remote-devices">> => [<<"lbry@1.0">>] }
        ),
    ?assertEqual(TxID, maps:get(<<"txid">>, Verified)),
    ?assert(hb_message:verify(Verified, verify_all(), #{})).

unified_remote_kind_narrowing_test() ->
    Unified = unified_transaction(),
    TxID = maps:get(<<"txid">>, Unified),
    ?assertMatch(
        {ok, _},
        hb_lbry_commitment:verify_remote_read(
            TxID,
            Unified,
            #{
                <<"verify-remote-devices">> =>
                    [<<"lbry-transaction@1.0">>]
            }
        )
    ),
    ?assertMatch(
        {error, _},
        hb_lbry_commitment:verify_remote_read(
            TxID,
            Unified,
            #{
                <<"verify-remote-devices">> =>
                    [<<"lbry-stream-descriptor@1.0">>]
            }
        )
    ).

unified_remote_wrong_evidence_kind_fails_test() ->
    Unified = unified_transaction(),
    TxID = maps:get(<<"txid">>, Unified),
    Commitments = maps:get(<<"commitments">>, Unified),
    [{ID, Commitment}] = maps:to_list(Commitments),
    Substituted = Unified#{
        <<"commitments">> => Commitments#{
            ID => Commitment#{ <<"evidence">> => <<"blob">> }
        }
    },
    ?assertMatch(
        {error, _},
        hb_lbry_commitment:verify_remote_read(
            TxID,
            Substituted,
            #{ <<"verify-remote-devices">> => [<<"lbry@1.0">>] }
        )
    ).

legacy_remote_transaction_remains_supported_test() ->
    Legacy = legacy_transaction(),
    TxID = maps:get(<<"txid">>, Legacy),
    ?assertMatch(
        {ok, _},
        hb_lbry_commitment:verify_remote_read(TxID, Legacy, #{})
    ).

unified_transaction() ->
    {ok, Unified} = hb_lbry_commitment:to_unified(legacy_transaction()),
    Unified.

legacy_transaction() ->
    Raw = <<
        1:32/little,
        1,
        0:256,
        16#ffffffff:32/little,
        0,
        16#ffffffff:32/little,
        1,
        0:64/little,
        0,
        0:32/little
    >>,
    {ok, Legacy} = hb_lbry_commitment:transaction_message(Raw),
    Legacy.

verify_all() ->
    #{ <<"commitment-ids">> => <<"all">> }.

-endif.
