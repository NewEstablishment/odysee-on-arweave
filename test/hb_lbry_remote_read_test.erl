%%% @doc Remote-read verification proofs for native LBRY commitments. A node
%%% reading LBRY-shaped keys from an untrusted remote store verifies the
%%% returned messages locally before caching or serving them: an `lbry@1.0'
%%% commitment of the expected evidence kind must bind to the requested key,
%%% and every LBRY commitment on the message must verify. The remote node's
%%% own transport signatures are neither required nor trusted.
-module(hb_lbry_remote_read_test).
-include_lib("eunit/include/eunit.hrl").

blob_read_verifies_test() ->
    Bytes = <<"two-node encrypted blob">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Msg = dev_lbry_commitment:blob_message(Hash, Bytes),
    {ok, View} = dev_lbry_commitment:verify_remote_read(Hash, Msg, opts()),
    ?assertEqual(Bytes, maps:get(<<"data">>, View)),
    ?assertEqual(Hash, maps:get(<<"blob-hash">>, View)),
    ?assertEqual(
        dev_lbry_commitment:content_digest_sha384(Bytes),
        maps:get(<<"content-digest">>, View)
    ),
    ?assertEqual(
        true,
        hb_message:verify(View, #{ <<"commitment-ids">> => <<"all">> }, opts())
    ).

transport_signatures_are_not_required_test() ->
    % The serving node's own HTTP-transport signature must not be needed to
    % accept the evidence, and must not survive the trust boundary: the
    % verified view keeps only the native LBRY commitments.
    Bytes = <<"transport signed blob">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Msg = dev_lbry_commitment:blob_message(Hash, Bytes),
    Signed = hb_message:commit(Msg, #{ <<"priv-wallet">> => ar_wallet:new() }),
    ?assertEqual(2, maps:size(maps:get(<<"commitments">>, Signed))),
    {ok, View} = dev_lbry_commitment:verify_remote_read(Hash, Signed, opts()),
    [Commitment] = maps:values(maps:get(<<"commitments">>, View)),
    ?assertEqual(<<"lbry@1.0">>, maps:get(<<"commitment-device">>, Commitment)),
    ?assertEqual(<<"blob">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual(
        true,
        hb_message:verify(View, #{ <<"commitment-ids">> => <<"all">> }, opts())
    ).

rejects_substituted_blob_test() ->
    % A remote node serves a perfectly valid blob message, but for a
    % different hash than the one requested. The native-id binding must
    % reject it.
    RealBytes = <<"the real blob">>,
    RealHash = dev_lbry_stream_descriptor:blob_hash(RealBytes),
    RequestedHash = dev_lbry_stream_descriptor:blob_hash(<<"a different blob">>),
    Msg = dev_lbry_commitment:blob_message(RealHash, RealBytes),
    ?assertEqual(
        {error, {missing_native_commitment, RequestedHash}},
        dev_lbry_commitment:verify_remote_read(RequestedHash, Msg, opts())
    ).

rejects_tampered_blob_test() ->
    % A remote node serves a message whose commitment does not match its
    % bytes. Verification must fail.
    Bytes = <<"the real blob">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Tampered =
        (dev_lbry_commitment:blob_message(Hash, Bytes))#{
            <<"data">> => <<"tampered bytes!!!">>
        },
    ?assertMatch(
        {error, _},
        dev_lbry_commitment:verify_remote_read(Hash, Tampered, opts())
    ).

descriptor_read_verifies_test() ->
    {Raw, SDHash} = sample_descriptor(),
    {ok, Msg} = dev_lbry_commitment:descriptor_message(Raw, SDHash),
    {ok, View} = dev_lbry_commitment:verify_remote_read(SDHash, Msg, opts()),
    ?assertEqual(SDHash, maps:get(<<"sd-hash">>, View)),
    ?assertMatch(
        {ok, _},
        dev_lbry_commitment:verify_remote_read(
            SDHash,
            Msg,
            #{ <<"verify-remote-evidence">> => [<<"descriptor">>] }
        )
    ).

rejects_blob_when_descriptor_expected_test() ->
    % Descriptor and blob IDs are both 96-hex SHA-384 values. A caller that
    % expects descriptor evidence must be able to narrow the acceptable
    % evidence kinds and reject a valid blob commitment for the same-shaped
    % key.
    Bytes = <<"valid blob bytes, not descriptor json">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Msg = dev_lbry_commitment:blob_message(Hash, Bytes),
    ?assertMatch(
        {ok, _},
        dev_lbry_commitment:verify_remote_read(Hash, Msg, opts())
    ),
    ?assertEqual(
        {error, {missing_native_commitment, Hash}},
        dev_lbry_commitment:verify_remote_read(
            Hash,
            Msg,
            #{ <<"verify-remote-evidence">> => [<<"descriptor">>] }
        )
    ).

claim_output_read_verifies_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, Msg} = dev_lbry_commitment:claim_output_message(Raw, 0),
    Outpoint = <<(maps:get(<<"txid">>, Msg))/binary, ":0">>,
    {ok, View} = dev_lbry_commitment:verify_remote_read(Outpoint, Msg, opts()),
    ?assertEqual(
        <<"9cc7f0e3de8db3b2ffd6dc0b4f1a0f0ca48a6b49">>,
        maps:get(<<"claim-id">>, View)
    ),
    ?assertEqual(
        true,
        hb_message:verify(View, #{ <<"commitment-ids">> => <<"all">> }, opts())
    ),
    % A reader expecting channel evidence narrows the acceptable kinds and
    % must reject claim evidence served for the same outpoint.
    ?assertEqual(
        {error, {missing_native_commitment, Outpoint}},
        dev_lbry_commitment:verify_remote_read(
            Outpoint,
            Msg,
            #{ <<"verify-remote-evidence">> => [<<"channel">>] }
        )
    ).

ancestry_upgraded_read_verifies_test() ->
    {CreateRaw, [UpdateRaw], ClaimID} = dev_lbry_ancestry:test_chain(1),
    {ok, Msg} = upgraded_claim_message(CreateRaw, UpdateRaw),
    Outpoint = <<(dev_lbry_tx:txid(UpdateRaw))/binary, ":0">>,
    {ok, View} = dev_lbry_commitment:verify_remote_read(Outpoint, Msg, opts()),
    ?assertEqual(ClaimID, maps:get(<<"claim-id">>, View)),
    ?assertEqual(
        <<"ancestor-derived">>,
        maps:get(<<"claim-proof-strength">>, View)
    ),
    % The view keeps the ancestry proof, so later readers replay it locally.
    ?assertMatch([_], maps:get(<<"claim-ancestry">>, View)),
    ?assertEqual(
        true,
        hb_message:verify(View, #{ <<"commitment-ids">> => <<"all">> }, opts())
    ).

rejects_bad_ancestry_test() ->
    % A remote node serves upgraded evidence whose ancestry proof is missing
    % or tampered; the reader must replay the walk locally and reject the
    % message.
    {CreateRaw, [UpdateRaw], _ClaimID} = dev_lbry_ancestry:test_chain(1),
    {ok, Msg} = upgraded_claim_message(CreateRaw, UpdateRaw),
    [Entry] = maps:get(<<"claim-ancestry">>, Msg),
    <<First, Rest/binary>> = CreateRaw,
    Forgeries = [
        maps:remove(<<"claim-ancestry">>, Msg),
        Msg#{
            <<"claim-ancestry">> =>
                [Entry#{ <<"raw-transaction">> => <<(First bxor 1), Rest/binary>> }]
        }
    ],
    Outpoint = <<(dev_lbry_tx:txid(UpdateRaw))/binary, ":0">>,
    lists:foreach(
        fun(Forged) ->
            ?assertMatch(
                {error, _},
                dev_lbry_commitment:verify_remote_read(Outpoint, Forged, opts())
            )
        end,
        Forgeries
    ).

stream_output_read_keeps_sd_hash_test() ->
    % The trust boundary must not strip keys committed by only one of the
    % co-resident commitments: the stream view keeps the `sd-hash' binding.
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, Msg} = dev_lbry_commitment:stream_claim_message(Raw, 0),
    Outpoint = <<(maps:get(<<"txid">>, Msg))/binary, ":0">>,
    {ok, View} =
        dev_lbry_commitment:verify_remote_read(
            Outpoint,
            Msg,
            #{ <<"verify-remote-evidence">> => [<<"stream">>] }
        ),
    ?assertEqual(
        <<"3da16b833f169c21caeb62ca66111227413f30f63c9d2f52f2a787643e086c334ee6949e05875cfe94a816aba02e492e">>,
        maps:get(<<"sd-hash">>, View)
    ),
    ?assertEqual(
        true,
        hb_message:verify(View, #{ <<"commitment-ids">> => <<"all">> }, opts())
    ).

expected_remote_commitment_classifies_keys_test() ->
    TxID = <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    ?assertEqual(
        {ok,
            [<<"claim">>, <<"channel">>, <<"stream">>],
            hb_util:to_hex(dev_lbry_commitment:outpoint_bytes(TxID, 0))},
        dev_lbry_commitment:expected_remote_commitment(<<TxID/binary, ":0">>)
    ),
    Hash = dev_lbry_stream_descriptor:blob_hash(<<"descriptor or blob">>),
    ?assertEqual(
        {ok, [<<"descriptor">>, <<"blob">>], Hash},
        dev_lbry_commitment:expected_remote_commitment(Hash)
    ),
    ?assertEqual(
        {ok, [<<"transaction">>], TxID},
        dev_lbry_commitment:expected_remote_commitment(TxID)
    ),
    ?assertEqual(
        untyped,
        dev_lbry_commitment:expected_remote_commitment(
            hb_util:human_id(crypto:hash(sha256, <<"message id">>))
        )
    ).

untyped_keys_pass_through_test() ->
    % Keys that are not LBRY native identifiers (such as regular HyperBEAM
    % message IDs) pass through unchanged: the no-trust proof applies to
    % immutable source objects only.
    Msg = #{ <<"data">> => <<"not lbry-addressed">> },
    ID = hb_util:human_id(crypto:hash(sha256, <<"key">>)),
    ?assertEqual(
        {ok, Msg},
        dev_lbry_commitment:verify_remote_read(ID, Msg, opts())
    ).

%% Build ancestry-upgraded claim evidence for the update output of a
%% one-update test chain, walking the create parent from a local fetch.
upgraded_claim_message(CreateRaw, UpdateRaw) ->
    CreateTxID = dev_lbry_tx:txid(CreateRaw),
    Fetch =
        fun(TxID) ->
            case TxID of
                CreateTxID -> {ok, CreateRaw};
                _ -> {error, not_found}
            end
        end,
    {ok, Entries} =
        dev_lbry_ancestry:build(
            UpdateRaw,
            0,
            Fetch,
            dev_lbry_ancestry:default_depth_limit()
        ),
    dev_lbry_commitment:claim_output_message(UpdateRaw, 0, Entries).

sample_descriptor() ->
    Key = <<0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15>>,
    IV = <<16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31>>,
    Ciphertext = crypto:crypto_one_time(
        aes_128_cbc,
        Key,
        IV,
        pkcs7_pad(<<"hello verified legacy stream">>),
        true
    ),
    BlobHash = dev_lbry_stream_descriptor:blob_hash(Ciphertext),
    Descriptor =
        #{
            <<"stream_type">> => <<"lbryfile">>,
            <<"stream_name">> => hb_util:to_hex(<<"sample.mp4">>),
            <<"key">> => hb_util:to_hex(Key),
            <<"suggested_file_name">> => hb_util:to_hex(<<"sample.mp4">>),
            <<"stream_hash">> => dev_lbry_stream_descriptor:blob_hash(<<"stream hash test">>),
            <<"blobs">> => [
                #{
                    <<"length">> => byte_size(Ciphertext),
                    <<"blob_num">> => 0,
                    <<"iv">> => hb_util:to_hex(IV),
                    <<"blob_hash">> => BlobHash
                },
                #{
                    <<"length">> => 0,
                    <<"blob_num">> => 1,
                    <<"iv">> => hb_util:to_hex(<<0:128>>)
                }
            ]
        },
    Raw = hb_json:encode(Descriptor),
    {Raw, dev_lbry_stream_descriptor:descriptor_hash(Raw)}.

pkcs7_pad(Data) ->
    PadLen = 16 - (byte_size(Data) rem 16),
    <<Data/binary, (binary:copy(<<PadLen>>, PadLen))/binary>>.

opts() ->
    #{}.
