%%% @doc Stream reassembly and ranged reads over descriptor-addressed
%%% encrypted blob streams. Blobs are fetched through the content-addressed
%%% blob store and every hash is verified on read; the descriptor's blob
%%% list drives decryption and slicing.
-module(hb_odysee_bridge).
-export([reassemble_stream/2, stream_range/4]).

reassemble_stream(SDHash, Opts) ->
    maybe
        {ok, Descriptor} ?= descriptor(SDHash, Opts),
        Fetch =
            fun(Hash) ->
                read_blob(Hash, Opts)
            end,
        {ok, Bytes} ?= dev_lbry_stream_descriptor:reassemble(Descriptor, Fetch),
        {ok, #{
            <<"sd-hash">> => hb_util:to_lower(SDHash),
            <<"byte-size">> => byte_size(Bytes),
            <<"bytes">> => Bytes,
            <<"descriptor">> => Descriptor
        }}
    end.

stream_range(SDHash, Start, End, Opts) when
        is_integer(Start), is_integer(End), Start >= 0, End >= Start ->
    maybe
        {ok, Descriptor} ?= descriptor(SDHash, Opts),
        Stride = maps:get(<<"plain-blob-stride">>, Descriptor),
        FirstBlobNum = Start div Stride,
        LastBlobNum = End div Stride,
        Blobs = lists:filter(
            fun(Blob) ->
                BlobNum = maps:get(<<"blob-num">>, Blob),
                BlobNum >= FirstBlobNum andalso BlobNum =< LastBlobNum
            end,
            data_blobs(Descriptor)
        ),
        {ok, Chunks} ?= range_chunks(
            Blobs,
            maps:get(<<"key">>, Descriptor),
            Start,
            End,
            Stride,
            Opts,
            []
        ),
        Bytes = iolist_to_binary(Chunks),
        ok ?= non_empty_range(Bytes),
        {ok, #{
            <<"sd-hash">> => hb_util:to_lower(SDHash),
            <<"start">> => Start,
            <<"end">> => Start + byte_size(Bytes) - 1,
            <<"requested-end">> => End,
            <<"bytes">> => Bytes
        }}
    end.

descriptor(SDHash, Opts) ->
    case read_blob(SDHash, Opts) of
        {ok, RawDescriptor} ->
            dev_lbry_stream_descriptor:parse(RawDescriptor, SDHash);
        Error ->
            Error
    end.

%% @doc Read a blob through the store and return its verified bytes.
read_blob(Hash, Opts) ->
    case blob_message(Hash, Opts) of
        {ok, #{ <<"data">> := Bytes }} -> {ok, Bytes};
        Error -> Error
    end.

blob_message(Hash, Opts) ->
    Store = blob_store(Opts),
    hb_store_lbry_blob:read(Store, #{ <<"read">> => Hash }, Opts).

blob_store(Opts) ->
    Base = #{ <<"store-module">> => hb_store_lbry_blob },
    hb_maps:merge(
        Base,
        hb_maps:get(<<"lbry-blob-store">>, Opts, #{}, Opts),
        Opts
    ).

data_blobs(Descriptor) ->
    lists:filter(
        fun(Blob) ->
            maps:get(<<"terminator">>, Blob, false) =/= true
        end,
        maps:get(<<"blobs">>, Descriptor)
    ).

range_chunks([], _KeyHex, _Start, _End, _Stride, _Opts, Acc) ->
    {ok, lists:reverse(Acc)};
range_chunks([Blob | Rest], KeyHex, Start, End, Stride, Opts, Acc) ->
    maybe
        {ok, Plaintext} ?= read_decrypted_blob(Blob, KeyHex, Opts),
        BlobStart = maps:get(<<"blob-num">>, Blob) * Stride,
        BlobEnd = BlobStart + byte_size(Plaintext) - 1,
        Chunk = slice_overlap(Plaintext, BlobStart, BlobEnd, Start, End),
        range_chunks(Rest, KeyHex, Start, End, Stride, Opts, [Chunk | Acc])
    end.

read_decrypted_blob(Blob, KeyHex, Opts) ->
    Hash = maps:get(<<"blob-hash">>, Blob),
    ExpectedLength = maps:get(<<"length">>, Blob),
    case read_blob(Hash, Opts) of
        {ok, Ciphertext} ->
            case byte_size(Ciphertext) of
                ExpectedLength ->
                    dev_lbry_stream_descriptor:decrypt_blob(KeyHex, Blob, Ciphertext);
                ActualLength ->
                    {error, {length_mismatch, Hash, ExpectedLength, ActualLength}}
            end;
        Error ->
            Error
    end.

slice_overlap(_Plaintext, BlobStart, BlobEnd, Start, End) when
        BlobEnd < Start orelse BlobStart > End ->
    <<>>;
slice_overlap(Plaintext, BlobStart, _BlobEnd, Start, End) ->
    SliceStart = max(Start, BlobStart),
    SliceEnd = min(End, BlobStart + byte_size(Plaintext) - 1),
    Offset = SliceStart - BlobStart,
    Length = SliceEnd - SliceStart + 1,
    binary:part(Plaintext, Offset, Length).

non_empty_range(<<>>) ->
    {error, invalid_range};
non_empty_range(_) ->
    ok.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

stream_range_fetches_requested_slice_test() ->
    {RawDescriptor, DescriptorHash, BlobHash, BlobBytes} =
        hb_lbry_test_fixtures:sample_descriptor(),
    {ok, Server, Handle} = hb_mock_server:start([
        {"/blob", blob, fun(Req) ->
            case maps:get(<<"qs">>, Req) of
                <<"hash=", DescriptorHash/binary>> -> {200, RawDescriptor};
                <<"hash=", BlobHash/binary>> -> {200, BlobBytes}
            end
        end}
    ]),
    try
        Opts = #{
            <<"http-client">> => httpc,
            <<"lbry-blob-store">> => #{ <<"node">> => Server }
        },
        {ok, Result} = stream_range(DescriptorHash, 0, 5, Opts),
        ?assertEqual(<<"bridge">>, maps:get(<<"bytes">>, Result)),
        ?assertEqual(5, maps:get(<<"end">>, Result))
    after
        hb_mock_server:stop(Handle)
    end.

stream_range_rejects_empty_slice_test() ->
    {RawDescriptor, DescriptorHash, BlobHash, BlobBytes} =
        hb_lbry_test_fixtures:sample_descriptor(),
    {ok, Server, Handle} = hb_mock_server:start([
        {"/blob", blob, fun(Req) ->
            case maps:get(<<"qs">>, Req) of
                <<"hash=", DescriptorHash/binary>> -> {200, RawDescriptor};
                <<"hash=", BlobHash/binary>> -> {200, BlobBytes}
            end
        end}
    ]),
    try
        Opts = #{
            <<"http-client">> => httpc,
            <<"lbry-blob-store">> => #{ <<"node">> => Server }
        },
        ?assertEqual({error, invalid_range}, stream_range(DescriptorHash, 1000, 1005, Opts))
    after
        hb_mock_server:stop(Handle)
    end.
-endif.
