-module(hb_lbry_codec_test).
-include_lib("eunit/include/eunit.hrl").

stream_descriptor_roundtrip_test() ->
    {Raw, SDHash} = sample_descriptor(),
    {ok, Descriptor} = dev_lbry_commitment:descriptor_message(Raw, SDHash),
    ?assertEqual(SDHash, maps:get(<<"sd-hash">>, Descriptor)),
    ?assertEqual(Raw, maps:get(<<"raw">>, Descriptor)),
    ?assertNot(maps:is_key(<<"device">>, Descriptor)).

stream_descriptor_attaches_native_commitment_test() ->
    {Raw, SDHash} = sample_descriptor(),
    {ok, Descriptor} = dev_lbry_commitment:descriptor_message(Raw, SDHash),
    Commitments = maps:get(<<"commitments">>, Descriptor),
    [Commitment] = maps:values(hb_cache:ensure_all_loaded(Commitments, opts())),
    ?assertEqual(<<"lbry@1.0">>, maps:get(<<"commitment-device">>, Commitment)),
    ?assertEqual(<<"descriptor">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual(SDHash, maps:get(<<"native-id">>, Commitment)),
    ?assertEqual(
        true,
        hb_message:verify(Descriptor, #{ <<"commitment-ids">> => <<"all">> }, opts())
    ).

stream_descriptor_verify_rejects_tampered_raw_test() ->
    {Raw, SDHash} = sample_descriptor(),
    {ok, Descriptor} = dev_lbry_commitment:descriptor_message(Raw, SDHash),
    {OtherRaw, _} = other_descriptor(),
    Tampered = Descriptor#{ <<"raw">> => OtherRaw },
    ?assertEqual(
        false,
        hb_message:verify(Tampered, #{ <<"commitment-ids">> => <<"all">> }, opts())
    ).

stream_descriptor_verify_rejects_sd_hash_field_mismatch_test() ->
    {Raw, SDHash} = sample_descriptor(),
    {ok, Descriptor} = dev_lbry_commitment:descriptor_message(Raw, SDHash),
    Tampered = Descriptor#{
        <<"sd-hash">> => hb_util:to_hex(crypto:hash(sha384, <<"other">>))
    },
    ?assertEqual(
        false,
        hb_message:verify(Tampered, #{ <<"commitment-ids">> => <<"all">> }, opts())
    ).

blob_roundtrip_and_verify_test() ->
    Bytes = <<"encrypted blob payload">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Blob = dev_lbry_commitment:blob_message(Hash, Bytes),
    ?assertEqual(Hash, maps:get(<<"blob-hash">>, Blob)),
    ?assertEqual(Bytes, maps:get(<<"data">>, Blob)),
    ?assertNot(maps:is_key(<<"device">>, Blob)),
    Commitments = maps:get(<<"commitments">>, Blob),
    [Commitment] = maps:values(hb_cache:ensure_all_loaded(Commitments, opts())),
    ?assertEqual(<<"lbry@1.0">>, maps:get(<<"commitment-device">>, Commitment)),
    ?assertEqual(<<"blob">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual(
        true,
        hb_message:verify(Blob, #{ <<"commitment-ids">> => <<"all">> }, opts())
    ).

blob_rejects_hash_mismatch_test() ->
    Bytes = <<"encrypted blob payload">>,
    WrongHash = dev_lbry_stream_descriptor:blob_hash(<<"other payload">>),
    ?assertMatch(
        {error, {hash_mismatch, WrongHash, _}},
        dev_lbry_stream_descriptor:verify_blob_hash(WrongHash, Bytes)
    ),
    Forged = dev_lbry_commitment:blob_message(WrongHash, Bytes),
    ?assertEqual(
        false,
        hb_message:verify(Forged, #{ <<"commitment-ids">> => <<"all">> }, opts())
    ).

transaction_roundtrip_test() ->
    RawTx = minimal_tx(),
    {ok, Tx} = dev_lbry_commitment:transaction_message(RawTx),
    ?assertEqual(hb_util:encode(RawTx), maps:get(<<"raw">>, Tx)),
    ?assertNot(maps:is_key(<<"device">>, Tx)),
    Commitments = maps:get(<<"commitments">>, Tx),
    [Commitment] = maps:values(hb_cache:ensure_all_loaded(Commitments, opts())),
    ?assertEqual(<<"lbry@1.0">>, maps:get(<<"commitment-device">>, Commitment)),
    ?assertEqual(<<"transaction">>, maps:get(<<"evidence">>, Commitment)),
    {ok, TxFromHex} = dev_lbry_tx:parse_hex(hb_util:to_hex(RawTx)),
    ?assertEqual(maps:get(<<"txid">>, Tx), maps:get(<<"txid">>, TxFromHex)).

claim_envelope_roundtrip_test() ->
    ChannelHash = <<1:160>>,
    Signature = <<2:512>>,
    Message = <<"claim protobuf">>,
    Raw = <<1, ChannelHash/binary, Signature/binary, Message/binary>>,
    {ok, Envelope} = dev_lbry_tx:parse_claim_envelope(Raw),
    ?assertEqual(true, maps:get(<<"signed">>, Envelope)),
    ?assertEqual(Raw, maps:get(<<"raw">>, Envelope)),
    ?assertEqual(ChannelHash, maps:get(<<"signing-channel-hash">>, Envelope)),
    ?assertEqual(Signature, maps:get(<<"claim-signature">>, Envelope)),
    ?assertEqual(Message, maps:get(<<"message">>, Envelope)),
    ?assertNot(maps:is_key(<<"device">>, Envelope)).

channel_identity_derivation_test() ->
    Channel = sample_channel(),
    {ok, ChannelHash} = dev_lbry_attestation:channel_hash(Channel),
    ?assertEqual(
        maps:get(<<"claim_id">>, Channel),
        hb_util:to_hex(reverse(ChannelHash))
    ),
    {ok, PublicKey} = dev_lbry_attestation:channel_public_key(Channel),
    ?assertEqual(
        maps:get(<<"public_key">>, maps:get(<<"value">>, Channel)),
        hb_util:to_hex(PublicKey)
    ).

stream_claim_uses_signed_claim_sd_hash_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, Stream} = dev_lbry_commitment:stream_claim_message(Raw, 0),
    ?assertEqual(
        <<"3da16b833f169c21caeb62ca66111227413f30f63c9d2f52f2a787643e086c334ee6949e05875cfe94a816aba02e492e">>,
        maps:get(<<"sd-hash">>, Stream)
    ),
    ?assertEqual(
        <<"9cc7f0e3de8db3b2ffd6dc0b4f1a0f0ca48a6b49">>,
        maps:get(<<"claim-id">>, Stream)
    ),
    ?assertNot(maps:is_key(<<"device">>, Stream)).

stream_rejects_malformed_claim_envelope_test() ->
    ?assertEqual(
        {error, truncated_fixed64},
        dev_lbry_claim_proto:stream_sd_hash(<<1, 2, 3>>)
    ).

sample_channel() ->
    PrivateKey = <<1:256>>,
    {PublicKey0, _} = crypto:generate_key(ecdh, secp256k1, PrivateKey),
    PublicKey = ar_wallet:compress_ecdsa_pubkey(PublicKey0),
    ChannelHash = <<3:160>>,
    #{
        <<"claim_id">> => hb_util:to_hex(reverse(ChannelHash)),
        <<"value">> => #{ <<"public_key">> => hb_util:to_hex(PublicKey) }
    }.

sample_descriptor() ->
    Key = <<0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15>>,
    IV = <<16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31>>,
    Plaintext = <<"hello verified legacy stream">>,
    Ciphertext = crypto:crypto_one_time(
        aes_128_cbc,
        Key,
        IV,
        pkcs7_pad(Plaintext),
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

other_descriptor() ->
    {Raw, SDHash} = sample_descriptor(),
    JSON = hb_json:decode(Raw),
    OtherRaw = hb_json:encode(JSON#{ <<"stream_type">> => <<"other">> }),
    {OtherRaw, SDHash}.

minimal_tx() ->
    <<1:32/little-signed, 0, 0, 0:32/little>>.

pkcs7_pad(Plaintext) ->
    PadLen = 16 - (byte_size(Plaintext) rem 16),
    <<Plaintext/binary, (binary:copy(<<PadLen>>, PadLen))/binary>>.

reverse(Bin) ->
    list_to_binary(lists:reverse(binary_to_list(Bin))).

opts() ->
    #{}.
