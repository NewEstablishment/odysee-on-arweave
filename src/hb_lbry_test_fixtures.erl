%%% @doc Shared LBRY test fixtures: signed/unsigned stream claim fixtures,
%%% raw claim transactions, protobuf/DER builders, sample descriptors, and
%%% the SDK-proxy/blob mock server that serves them. Test-only; every
%%% function is compiled under TEST and used from other modules' EUnit
%%% blocks.
-module(hb_lbry_test_fixtures).

-ifdef(TEST).
-export([
    signed_stream_fixture/2,
    unsigned_stream_fixture/0,
    ancestor_channel_stream_fixture/0,
    fixture_from_txs/5,
    fixture_server/2,
    proxy_result/1,
    fixture_opts/1,
    create_claim_tx/3,
    proto_field/2,
    proto_varint/1,
    script_push/1,
    compact_signature/2,
    der_to_compact/1,
    proxy_server/1,
    sample_descriptor/0,
    sample_descriptor/1,
    pkcs7_pad/1
]).

%% @doc Build a complete signed-stream fixture: a channel claim transaction
%% and a stream claim transaction whose envelope is signed over the real v2
%% digest with `SignerPrivKey'. When the signer differs from the channel
%% key, the signature is genuinely invalid for the channel.
signed_stream_fixture(ChannelPrivKey, SignerPrivKey) ->
    Descriptor = {_, DescriptorHash, _, _} = sample_descriptor(),
    {ChannelPub, _} = crypto:generate_key(ecdh, secp256k1, ChannelPrivKey),
    Compressed = ar_wallet:compress_ecdsa_pubkey(ChannelPub),
    ChannelClaim = <<0, (proto_field(2, proto_field(1, Compressed)))/binary>>,
    ChannelTx = create_claim_tx(<<0:256>>, <<"@chan">>, ChannelClaim),
    {ok, ParsedChannelTx} = dev_lbry_tx:parse(ChannelTx),
    [ChannelOutput | _] = maps:get(<<"outputs">>, ParsedChannelTx),
    ChannelHash = maps:get(<<"claim-hash">>, ChannelOutput),
    StreamProto =
        proto_field(1,
            proto_field(1,
                proto_field(6, binary:decode_hex(DescriptorHash)))),
    PrevHash = <<1:256>>,
    Piece1 = <<PrevHash/binary, 0:32/little>>,
    Digest =
        crypto:hash(
            sha256,
            <<Piece1/binary, ChannelHash/binary, StreamProto/binary>>
        ),
    Signature = compact_signature(SignerPrivKey, Digest),
    Envelope = <<1, ChannelHash/binary, Signature/binary, StreamProto/binary>>,
    fixture_from_txs(
        Descriptor,
        ChannelTx,
        ParsedChannelTx,
        create_claim_tx(PrevHash, <<"video">>, Envelope),
        hb_util:to_hex(Compressed)
    ).

unsigned_stream_fixture() ->
    Descriptor = {_, DescriptorHash, _, _} = sample_descriptor(),
    {ChannelPub, _} = crypto:generate_key(ecdh, secp256k1, <<1:256>>),
    Compressed = ar_wallet:compress_ecdsa_pubkey(ChannelPub),
    ChannelClaim = <<0, (proto_field(2, proto_field(1, Compressed)))/binary>>,
    ChannelTx = create_claim_tx(<<0:256>>, <<"@chan">>, ChannelClaim),
    {ok, ParsedChannelTx} = dev_lbry_tx:parse(ChannelTx),
    StreamProto =
        proto_field(1,
            proto_field(1,
                proto_field(6, binary:decode_hex(DescriptorHash)))),
    Envelope = <<0, StreamProto/binary>>,
    fixture_from_txs(
        Descriptor,
        ChannelTx,
        ParsedChannelTx,
        create_claim_tx(<<1:256>>, <<"video">>, Envelope),
        hb_util:to_hex(Compressed)
    ).

%% @doc A fixture whose signing channel is an on-chain update with walkable
%% create ancestry: the channel evidence upgrades to ancestor-derived while
%% the stream claim itself stays a hash-derived create.
ancestor_channel_stream_fixture() ->
    Descriptor = {_, DescriptorHash, _, _} = sample_descriptor(),
    {ChannelPrivKey, Compressed, _} = dev_lbry_ancestry:test_key(),
    ChannelClaim = <<0, (proto_field(2, proto_field(1, Compressed)))/binary>>,
    ChannelCreate = dev_lbry_ancestry:test_create_tx(<<"@chan">>, ChannelClaim),
    {ok, ParsedCreate} = dev_lbry_tx:parse(ChannelCreate),
    [CreateOutput | _] = maps:get(<<"outputs">>, ParsedCreate),
    ChannelClaimID = maps:get(<<"claim-id">>, CreateOutput),
    ChannelUpdate =
        dev_lbry_ancestry:test_update_tx(
            <<"@chan">>,
            ChannelClaimID,
            [{ChannelCreate, 0}],
            #{ <<"claim">> => ChannelClaim }
        ),
    {ok, ParsedUpdate} = dev_lbry_tx:parse(ChannelUpdate),
    [UpdateOutput | _] = maps:get(<<"outputs">>, ParsedUpdate),
    ChannelHash = maps:get(<<"claim-hash">>, UpdateOutput),
    StreamProto =
        proto_field(1,
            proto_field(1,
                proto_field(6, binary:decode_hex(DescriptorHash)))),
    PrevHash = <<1:256>>,
    Piece1 = <<PrevHash/binary, 0:32/little>>,
    Digest =
        crypto:hash(
            sha256,
            <<Piece1/binary, ChannelHash/binary, StreamProto/binary>>
        ),
    Signature = compact_signature(ChannelPrivKey, Digest),
    Envelope = <<1, ChannelHash/binary, Signature/binary, StreamProto/binary>>,
    Fixture =
        fixture_from_txs(
            Descriptor,
            ChannelUpdate,
            ParsedUpdate,
            create_claim_tx(PrevHash, <<"video">>, Envelope),
            hb_util:to_hex(Compressed)
        ),
    Fixture#{
        extra_txs => #{
            dev_lbry_tx:txid(ChannelCreate) => hb_util:to_hex(ChannelCreate)
        }
    }.

fixture_from_txs(Descriptor, ChannelTx, ParsedChannelTx, StreamTx, PublicKeyHex) ->
    [ChannelOutput | _] = maps:get(<<"outputs">>, ParsedChannelTx),
    {ok, ParsedStreamTx} = dev_lbry_tx:parse(StreamTx),
    [StreamOutput | _] = maps:get(<<"outputs">>, ParsedStreamTx),
    #{
        descriptor => Descriptor,
        channel_claim_id => maps:get(<<"claim-id">>, ChannelOutput),
        channel_txid => maps:get(<<"txid">>, ParsedChannelTx),
        channel_tx_hex => hb_util:to_hex(ChannelTx),
        stream_claim_id => maps:get(<<"claim-id">>, StreamOutput),
        stream_txid => maps:get(<<"txid">>, ParsedStreamTx),
        stream_tx_hex => hb_util:to_hex(StreamTx),
        channel_public_key => PublicKeyHex
    }.

fixture_server(Fixture, Overrides) ->
    {RawDescriptor, DescriptorHash, BlobHash, BlobBytes} =
        maps:get(descriptor, Fixture),
    StreamClaimID = maps:get(stream_claim_id, Fixture),
    ChannelClaimID = maps:get(channel_claim_id, Fixture),
    StreamTxID = maps:get(stream_txid, Fixture),
    ChannelTxID = maps:get(channel_txid, maps:merge(Fixture, Overrides)),
    ChannelTxHex = maps:get(channel_tx_hex, maps:merge(Fixture, Overrides)),
    SDKPublicKey =
        maps:get(
            sdk_channel_public_key,
            Overrides,
            maps:get(channel_public_key, Fixture)
        ),
    StreamClaim = #{
        <<"claim_id">> => StreamClaimID,
        <<"txid">> => StreamTxID,
        <<"nout">> => 0,
        <<"value">> => #{ <<"source">> => #{ <<"sd_hash">> => DescriptorHash } },
        <<"signing_channel">> => #{
            <<"claim_id">> => ChannelClaimID,
            <<"value">> => #{ <<"public_key">> => SDKPublicKey }
        }
    },
    ChannelClaim = #{
        <<"claim_id">> => ChannelClaimID,
        <<"txid">> => ChannelTxID,
        <<"nout">> => 0
    },
    Claims = #{ StreamClaimID => StreamClaim, ChannelClaimID => ChannelClaim },
    Txs = maps:merge(
        #{
            StreamTxID => maps:get(stream_tx_hex, Fixture),
            ChannelTxID => ChannelTxHex
        },
        maps:get(extra_txs, Overrides, #{})
    ),
    hb_mock_server:start([
        {"/api/v1/proxy", proxy, fun(Req) ->
            Body = hb_json:decode(maps:get(<<"body">>, Req)),
            Params = maps:get(<<"params">>, Body),
            case maps:get(<<"qs">>, Req) of
                <<"m=claim_search">> ->
                    [ID] = maps:get(<<"claim_ids">>, Params),
                    {200, proxy_result(#{ <<"items">> => [maps:get(ID, Claims)] })};
                <<"m=transaction_show">> ->
                    TxID = maps:get(<<"txid">>, Params),
                    {200, proxy_result(#{ <<"hex">> => maps:get(TxID, Txs) })}
            end
        end},
        {"/blob", blob, fun(Req) ->
            case maps:get(<<"qs">>, Req) of
                <<"hash=", DescriptorHash/binary>> -> {200, RawDescriptor};
                <<"hash=", BlobHash/binary>> -> {200, BlobBytes}
            end
        end}
    ]).

proxy_result(Result) ->
    hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"result">> => Result,
        <<"id">> => 1
    }).

fixture_opts(Server) ->
    #{
        <<"http-client">> => httpc,
        <<"lbry-proxy-node">> => Server,
        <<"lbry-blob-store">> => #{ <<"node">> => Server },
        <<"lbry-tx-store">> => #{ <<"lbry-proxy-node">> => Server }
    }.

create_claim_tx(PrevHash, Name, Claim) ->
    Script = <<
        16#b5,
        (script_push(Name))/binary,
        (script_push(Claim))/binary,
        16#6d, 16#75
    >>,
    <<1:32/little-signed,
        1,
        PrevHash/binary,
        0:32/little,
        0,
        16#ffffffff:32/little,
        1,
        0:64/little,
        (byte_size(Script)),
        Script/binary,
        0:32/little>>.

proto_field(Number, Value) ->
    FieldKey = (Number bsl 3) bor 2,
    <<(proto_varint(FieldKey))/binary,
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

compact_signature(PrivKey, Digest) ->
    der_to_compact(
        crypto:sign(ecdsa, sha256, {digest, Digest}, [PrivKey, secp256k1])
    ).

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

%% @doc A one-time SDK-proxy mock that answers every transaction_show with
%% the given raw tx hex.
proxy_server(Hex) ->
    Response =
        hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"result">> => #{ <<"hex">> => Hex },
            <<"id">> => 1
        }),
    hb_mock_server:start([{"/api/v1/proxy", proxy, {200, Response}}]).

sample_descriptor() ->
    sample_descriptor(<<"bridge smoke">>).

sample_descriptor(Plaintext) ->
    Key = <<0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15>>,
    IV = <<16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31>>,
    BlobBytes =
        crypto:crypto_one_time(
            aes_128_cbc,
            Key,
            IV,
            pkcs7_pad(Plaintext),
            true
        ),
    BlobHash = dev_lbry_stream_descriptor:blob_hash(BlobBytes),
    RawDescriptor =
        hb_json:encode(#{
            <<"stream_type">> => <<"lbryfile">>,
            <<"stream_name">> => hb_util:to_hex(<<"sample.mp4">>),
            <<"key">> => hb_util:to_hex(Key),
            <<"suggested_file_name">> => hb_util:to_hex(<<"sample.mp4">>),
            <<"stream_hash">> => dev_lbry_stream_descriptor:blob_hash(<<"stream">>),
            <<"blobs">> => [
                #{
                    <<"length">> => byte_size(BlobBytes),
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
        }),
    DescriptorHash = dev_lbry_stream_descriptor:blob_hash(RawDescriptor),
    {RawDescriptor, DescriptorHash, BlobHash, BlobBytes}.

pkcs7_pad(Plaintext) ->
    PadLen = 16 - (byte_size(Plaintext) rem 16),
    <<Plaintext/binary, (binary:copy(<<PadLen>>, PadLen))/binary>>.
-endif.
