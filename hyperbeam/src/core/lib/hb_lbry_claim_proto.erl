-module(hb_lbry_claim_proto).
-export([stream_sd_hash/1, channel_public_key/1, decode_metadata/1]).
-include_lib("eunit/include/eunit.hrl").

%% @doc Decode a stream or channel claim protobuf message into a native,
%% Odysee-shaped `value' map (title/description/thumbnail/tags/source/video/
%% cover/...), matching the shape produced for HyperBEAM-native uploads. This
%% lets the client parse legacy and native content through one identical
%% codepath. Returns `{ok, Value}' for a stream or channel claim, or
%% `not_found' for messages without either body (e.g. repost claims). Field
%% numbers mirror the LBRY claim protobuf schema.
decode_metadata(Message) when is_binary(Message) ->
    case length_field(Message, 1) of
        {ok, Stream} ->
            {ok, stream_value(Message, Stream)};
        _ ->
            case length_field(Message, 2) of
                {ok, Channel} -> {ok, channel_value(Message, Channel)};
                _ -> decode_legacy_metadata(Message)
            end
    end;
decode_metadata(_) ->
    not_found.

decode_legacy_metadata(Claim) ->
    maybe
        1 ?= varint_field(Claim, 2),
        {ok, Stream} ?= length_field(Claim, 3),
        {ok, Metadata} ?= length_field(Stream, 2),
        {ok, Source} ?= length_field(Stream, 3),
        {ok, legacy_stream_value(Metadata, Source)}
    else
        _ -> not_found
    end.

legacy_stream_value(Metadata, Source) ->
    MediaType = string_field(Source, 4),
    Tags =
        case varint_field(Metadata, 7) of
            1 -> [<<"mature">>];
            _ -> []
        end,
    put_if_present(#{
        <<"title">> => string_field(Metadata, 3),
        <<"description">> => string_field(Metadata, 4),
        <<"author">> => string_field(Metadata, 5),
        <<"thumbnail">> => legacy_thumbnail_value(string_field(Metadata, 9)),
        <<"tags">> => Tags,
        <<"languages">> => legacy_languages(varint_field(Metadata, 2)),
        <<"license">> => string_field(Metadata, 6),
        <<"license_url">> => string_field(Metadata, 11),
        <<"stream_type">> => stream_type(MediaType),
        <<"source">> => legacy_source_value(Source, MediaType)
    }).

legacy_source_value(Source, MediaType) ->
    put_if_present(#{
        <<"media_type">> => MediaType,
        <<"sd_hash">> => hex_field(Source, 3)
    }).

legacy_thumbnail_value(not_found) ->
    not_found;
legacy_thumbnail_value(Url) ->
    #{ <<"url">> => Url }.

legacy_languages(1) ->
    [<<"en">>];
legacy_languages(_) ->
    [].

stream_value(Claim, Stream) ->
    Source = optional_field(Stream, 1),
    Video = optional_field(Stream, 11),
    Audio = optional_field(Stream, 12),
    MediaType = string_field(Source, 4),
    put_if_present(
        maps:merge(
            base_stream_value(Claim, Stream, Source, MediaType),
            media_dimensions_value(Video, Audio)
        )
    ).

base_stream_value(Claim, Stream, Source, MediaType) ->
    #{
        <<"title">> => string_field(Claim, 8),
        <<"description">> => string_field(Claim, 9),
        <<"thumbnail">> => thumbnail_value(optional_field(Claim, 10)),
        <<"tags">> => string_fields(Claim, 11),
        <<"languages">> => [],
        <<"license">> => string_field(Stream, 3),
        <<"release_time">> => varint_field(Stream, 5),
        <<"stream_type">> => stream_type(MediaType),
        <<"source">> => source_value(Source, MediaType)
    }.

%% Channel claims share the claim-level title/description/thumbnail/tags
%% fields with streams; the channel body contributes email, website_url and
%% cover. The raw protobuf public key is deliberately not emitted here: it is
%% DER/SPKI-wrapped for legacy channels, and the normalized key is carried in
%% the channel evidence message's committed top-level `public-key' instead.
channel_value(Claim, Channel) ->
    put_if_present(#{
        <<"title">> => string_field(Claim, 8),
        <<"description">> => string_field(Claim, 9),
        <<"thumbnail">> => thumbnail_value(optional_field(Claim, 10)),
        <<"tags">> => string_fields(Claim, 11),
        <<"email">> => string_field(Channel, 2),
        <<"website_url">> => string_field(Channel, 3),
        <<"cover">> => thumbnail_value(optional_field(Channel, 4))
    }).

source_value(not_found, _MediaType) ->
    not_found;
source_value(Source, MediaType) ->
    put_if_present(#{
        <<"hash">> => hex_field(Source, 1),
        <<"name">> => string_field(Source, 2),
        <<"size">> => varint_field(Source, 3),
        <<"media_type">> => MediaType,
        <<"url">> => string_field(Source, 5),
        <<"sd_hash">> => hex_field(Source, 6)
    }).

media_dimensions_value(not_found, not_found) ->
    #{};
media_dimensions_value(Video, Audio) ->
    put_if_present(#{
        <<"video">> => video_value(Video),
        <<"audio">> => audio_value(Audio)
    }).

video_value(not_found) ->
    not_found;
video_value(Video) ->
    put_if_present(#{
        <<"width">> => varint_field(Video, 1),
        <<"height">> => varint_field(Video, 2),
        <<"duration">> => varint_field(Video, 3)
    }).

audio_value(not_found) ->
    not_found;
audio_value(Audio) ->
    put_if_present(#{ <<"duration">> => varint_field(Audio, 1) }).

thumbnail_value(not_found) ->
    not_found;
thumbnail_value(Thumbnail) ->
    case value_or(string_field(Thumbnail, 5), string_field(Thumbnail, 1)) of
        not_found -> not_found;
        Url -> #{ <<"url">> => Url }
    end.

stream_type(not_found) -> not_found;
stream_type(MediaType) when is_binary(MediaType) ->
    case binary:split(MediaType, <<"/">>) of
        [<<"video">> | _] -> <<"video">>;
        [<<"audio">> | _] -> <<"audio">>;
        [<<"image">> | _] -> <<"image">>;
        [<<"text">> | _] -> <<"document">>;
        _ -> <<"document">>
    end.

%% Drop keys whose values are absent, so the emitted map only carries fields
%% that were actually present in the protobuf (mirroring the client decoder).
put_if_present(Map) ->
    maps:filter(
        fun(_Key, Value) -> Value =/= not_found andalso Value =/= [] end,
        Map
    ).

value_or(not_found, Default) -> Default;
value_or(Value, _Default) -> Value.

optional_field(not_found, _FieldNum) ->
    not_found;
optional_field(Message, FieldNum) ->
    case length_field(Message, FieldNum) of
        {ok, Value} -> Value;
        _ -> not_found
    end.

string_field(not_found, _FieldNum) ->
    not_found;
string_field(Message, FieldNum) ->
    optional_field(Message, FieldNum).

string_fields(not_found, _FieldNum) ->
    [];
string_fields(Message, FieldNum) ->
    all_length_fields(Message, FieldNum, []).

hex_field(Message, FieldNum) ->
    case optional_field(Message, FieldNum) of
        not_found -> not_found;
        Bytes -> hb_util:to_hex(Bytes)
    end.

varint_field(not_found, _FieldNum) ->
    not_found;
varint_field(Message, FieldNum) ->
    case find_field(Message, FieldNum) of
        {ok, 0, Value} -> Value;
        _ -> not_found
    end.

all_length_fields(<<>>, _FieldNum, Acc) ->
    lists:reverse(Acc);
all_length_fields(Message, FieldNum, Acc) ->
    case read_field(Message) of
        {ok, Number, 2, Value, Tail} when Number =:= FieldNum ->
            all_length_fields(Tail, FieldNum, [Value | Acc]);
        {ok, _Number, _WireType, _Value, Tail} ->
            all_length_fields(Tail, FieldNum, Acc);
        _ ->
            lists:reverse(Acc)
    end.

read_field(Message) ->
    maybe
        {ok, Key, Rest} ?= read_varint(Message),
        Number = Key bsr 3,
        WireType = Key band 7,
        {ok, Value, Tail} ?= read_value(WireType, Rest),
        {ok, Number, WireType, Value, Tail}
    end.

stream_sd_hash(Message) when is_binary(Message) ->
    case stream_sd_hash_v2(Message) of
        {ok, _SDHash} = OK -> OK;
        V2Error ->
            case varint_field(Message, 2) of
                1 -> stream_sd_hash_v1(Message);
                _ -> V2Error
            end
    end.

stream_sd_hash_v2(Message) ->
    maybe
        {ok, Stream} ?= length_field(Message, 1),
        {ok, Source} ?= length_field(Stream, 1),
        {ok, SDHash} ?= length_field(Source, 6),
        ok ?= valid_hash(SDHash),
        {ok, hb_util:to_hex(SDHash)}
    end.

stream_sd_hash_v1(Message) ->
    maybe
        1 ?= varint_field(Message, 2),
        {ok, Stream} ?= length_field(Message, 3),
        {ok, Source} ?= length_field(Stream, 3),
        {ok, SDHash} ?= length_field(Source, 3),
        ok ?= valid_hash(SDHash),
        {ok, hb_util:to_hex(SDHash)}
    end.

%% @doc Extract the raw channel public key bytes from a channel claim
%% protobuf (`Claim.channel.public_key'). The bytes are returned untouched:
%% legacy channels store DER/SPKI-wrapped keys, which the caller must
%% normalize before use.
channel_public_key(Message) when is_binary(Message) ->
    case length_field(Message, 2) of
        {ok, Channel} ->
            length_field(Channel, 1);
        V2Error ->
            case varint_field(Message, 2) of
                2 ->
                    maybe
                        {ok, Certificate} ?= length_field(Message, 4),
                        {ok, PublicKey} ?= length_field(Certificate, 4),
                        {ok, PublicKey}
                    end;
                _ ->
                    V2Error
            end
    end.

length_field(Message, FieldNum) ->
    case find_field(Message, FieldNum) of
        {ok, 2, Value} -> {ok, Value};
        {ok, WireType, _Value} -> {error, {invalid_wire_type, FieldNum, WireType}};
        Error -> Error
    end.

find_field(<<>>, FieldNum) ->
    {error, {missing_field, FieldNum}};
find_field(Message, FieldNum) ->
    maybe
        {ok, Key, Rest} ?= read_varint(Message),
        Number = Key bsr 3,
        WireType = Key band 7,
        {ok, Value, Tail} ?= read_value(WireType, Rest),
        case Number of
            FieldNum -> {ok, WireType, Value};
            _ -> find_field(Tail, FieldNum)
        end
    end.

read_value(0, Raw) ->
    read_varint(Raw);
read_value(1, <<Value:8/binary, Rest/binary>>) ->
    {ok, Value, Rest};
read_value(1, _) ->
    {error, truncated_fixed64};
read_value(2, Raw) ->
    maybe
        {ok, Size, Rest} ?= read_varint(Raw),
        take(Size, Rest)
    end;
read_value(5, <<Value:4/binary, Rest/binary>>) ->
    {ok, Value, Rest};
read_value(5, _) ->
    {error, truncated_fixed32};
read_value(WireType, _Raw) ->
    {error, {unsupported_wire_type, WireType}}.

read_varint(Raw) ->
    read_varint(Raw, 0, 0).

read_varint(<<Byte, Rest/binary>>, Shift, Acc) when Shift < 70 ->
    Value = Acc bor ((Byte band 16#7f) bsl Shift),
    case Byte band 16#80 of
        0 -> {ok, Value, Rest};
        _ -> read_varint(Rest, Shift + 7, Value)
    end;
read_varint(_, _Shift, _Acc) ->
    {error, invalid_varint}.

take(Size, Raw) when is_integer(Size), Size >= 0, byte_size(Raw) >= Size ->
    <<Value:Size/binary, Rest/binary>> = Raw,
    {ok, Value, Rest};
take(_, _) ->
    {error, truncated_binary}.

valid_hash(Hash) when byte_size(Hash) == 48 ->
    ok;
valid_hash(Hash) ->
    {error, {invalid_sd_hash_size, byte_size(Hash)}}.

stream_sd_hash_from_task0_claim_test() ->
    {ok, Tx} = hb_lbry_tx:parse_hex(hb_lbry_tx:task0_tx_hex()),
    [ClaimOutput | _] = maps:get(<<"outputs">>, Tx),
    Envelope = maps:get(<<"claim-envelope">>, ClaimOutput),
    ?assertEqual(
        {ok, <<"3da16b833f169c21caeb62ca66111227413f30f63c9d2f52f2a787643e086c334ee6949e05875cfe94a816aba02e492e">>},
        stream_sd_hash(maps:get(<<"message">>, Envelope))
    ).

channel_public_key_from_channel_claim_test() ->
    PublicKey = <<2, 1:256>>,
    Channel = field(1, PublicKey),
    Claim = field(2, Channel),
    ?assertEqual({ok, PublicKey}, channel_public_key(Claim)).

channel_public_key_requires_channel_field_test() ->
    Claim = field(1, field(1, <<"stream">>)),
    ?assertEqual({error, {missing_field, 2}}, channel_public_key(Claim)).

stream_sd_hash_rejects_wrong_hash_size_test() ->
    BadHash = <<1, 2, 3>>,
    Source = field(6, BadHash),
    Stream = field(1, Source),
    Claim = field(1, Stream),
    ?assertEqual({error, {invalid_sd_hash_size, 3}}, stream_sd_hash(Claim)).

decode_metadata_extracts_native_value_shape_test() ->
    Source =
        <<
            (field(2, <<"video.mp4">>))/binary,
            (field(4, <<"video/mp4">>))/binary,
            (varint_field_bin(3, 12345))/binary,
            (field(6, <<1:384>>))/binary
        >>,
    Video = <<(varint_field_bin(1, 1920))/binary, (varint_field_bin(2, 1080))/binary, (varint_field_bin(3, 42))/binary>>,
    Stream =
        <<
            (field(1, Source))/binary,
            (field(3, <<"Public Domain">>))/binary,
            (varint_field_bin(5, 1700000000))/binary,
            (field(11, Video))/binary
        >>,
    Thumbnail = field(5, <<"https://example.com/t.png">>),
    Claim =
        <<
            (field(1, Stream))/binary,
            (field(8, <<"Intro to Bloomscroll">>))/binary,
            (field(9, <<"a description">>))/binary,
            (field(10, Thumbnail))/binary,
            (field(11, <<"tag-a">>))/binary,
            (field(11, <<"tag-b">>))/binary
        >>,
    {ok, Value} = decode_metadata(Claim),
    ?assertEqual(<<"Intro to Bloomscroll">>, maps:get(<<"title">>, Value)),
    ?assertEqual(<<"a description">>, maps:get(<<"description">>, Value)),
    ?assertEqual([<<"tag-a">>, <<"tag-b">>], maps:get(<<"tags">>, Value)),
    ?assertEqual(#{ <<"url">> => <<"https://example.com/t.png">> }, maps:get(<<"thumbnail">>, Value)),
    ?assertEqual(<<"Public Domain">>, maps:get(<<"license">>, Value)),
    ?assertEqual(1700000000, maps:get(<<"release_time">>, Value)),
    ?assertEqual(<<"video">>, maps:get(<<"stream_type">>, Value)),
    SourceValue = maps:get(<<"source">>, Value),
    ?assertEqual(<<"video/mp4">>, maps:get(<<"media_type">>, SourceValue)),
    ?assertEqual(<<"video.mp4">>, maps:get(<<"name">>, SourceValue)),
    ?assertEqual(12345, maps:get(<<"size">>, SourceValue)),
    VideoValue = maps:get(<<"video">>, Value),
    ?assertEqual(1920, maps:get(<<"width">>, VideoValue)),
    ?assertEqual(42, maps:get(<<"duration">>, VideoValue)).

decode_metadata_extracts_channel_value_test() ->
    Cover = field(5, <<"https://example.com/banner.png">>),
    Channel =
        <<
            (field(1, <<2, 1:256>>))/binary,
            (field(2, <<"hi@example.com">>))/binary,
            (field(3, <<"https://example.com">>))/binary,
            (field(4, Cover))/binary
        >>,
    Thumbnail = field(5, <<"https://example.com/avatar.png">>),
    Claim =
        <<
            (field(2, Channel))/binary,
            (field(8, <<"Veritasium">>))/binary,
            (field(9, <<"An element of truth.">>))/binary,
            (field(10, Thumbnail))/binary,
            (field(11, <<"science">>))/binary
        >>,
    {ok, Value} = decode_metadata(Claim),
    ?assertEqual(<<"Veritasium">>, maps:get(<<"title">>, Value)),
    ?assertEqual(<<"An element of truth.">>, maps:get(<<"description">>, Value)),
    ?assertEqual(#{ <<"url">> => <<"https://example.com/avatar.png">> }, maps:get(<<"thumbnail">>, Value)),
    ?assertEqual(#{ <<"url">> => <<"https://example.com/banner.png">> }, maps:get(<<"cover">>, Value)),
    ?assertEqual([<<"science">>], maps:get(<<"tags">>, Value)),
    ?assertEqual(<<"hi@example.com">>, maps:get(<<"email">>, Value)),
    ?assertEqual(<<"https://example.com">>, maps:get(<<"website_url">>, Value)),
    ?assertNot(maps:is_key(<<"public_key">>, Value)).

decode_metadata_channel_without_metadata_returns_empty_value_test() ->
    Channel = field(1, <<2, 1:256>>),
    Claim = field(2, Channel),
    ?assertEqual({ok, #{}}, decode_metadata(Claim)).

decode_metadata_without_stream_or_channel_returns_not_found_test() ->
    Repost = field(1, <<1:160>>),
    Claim = field(4, Repost),
    ?assertEqual(not_found, decode_metadata(Claim)).

decode_legacy_metadata_extracts_native_value_shape_test() ->
    SDHash = <<2:384>>,
    Metadata =
        <<
            (varint_field_bin(1, 4))/binary,
            (varint_field_bin(2, 1))/binary,
            (field(3, <<"Legacy test title">>))/binary,
            (field(4, <<"legacy description">>))/binary,
            (field(5, <<"legacy author">>))/binary,
            (field(6, <<"Public Domain">>))/binary,
            (varint_field_bin(7, 1))/binary,
            (field(9, <<"https://example.com/legacy.png">>))/binary,
            (field(11, <<"https://example.com/license">>))/binary
        >>,
    Source =
        <<
            (varint_field_bin(1, 1))/binary,
            (varint_field_bin(2, 1))/binary,
            (field(3, SDHash))/binary,
            (field(4, <<"video/mp4">>))/binary
        >>,
    Stream =
        <<
            (varint_field_bin(1, 1))/binary,
            (field(2, Metadata))/binary,
            (field(3, Source))/binary
        >>,
    Claim =
        <<
            (varint_field_bin(1, 1))/binary,
            (varint_field_bin(2, 1))/binary,
            (field(3, Stream))/binary
        >>,
    {ok, Value} = decode_metadata(Claim),
    ?assertEqual(<<"Legacy test title">>, maps:get(<<"title">>, Value)),
    ?assertEqual(<<"legacy description">>, maps:get(<<"description">>, Value)),
    ?assertEqual(<<"legacy author">>, maps:get(<<"author">>, Value)),
    ?assertEqual([<<"mature">>], maps:get(<<"tags">>, Value)),
    ?assertEqual([<<"en">>], maps:get(<<"languages">>, Value)),
    ?assertEqual(
        #{ <<"url">> => <<"https://example.com/legacy.png">> },
        maps:get(<<"thumbnail">>, Value)
    ),
    ?assertEqual(<<"video">>, maps:get(<<"stream_type">>, Value)),
    SourceValue = maps:get(<<"source">>, Value),
    ?assertEqual(<<"video/mp4">>, maps:get(<<"media_type">>, SourceValue)),
    ?assertEqual(hb_util:to_hex(SDHash), maps:get(<<"sd_hash">>, SourceValue)),
    ?assertEqual({ok, hb_util:to_hex(SDHash)}, stream_sd_hash(Claim)).

channel_public_key_from_legacy_channel_claim_test() ->
    PublicKey = <<3, 1:256>>,
    Certificate =
        <<
            (varint_field_bin(1, 1))/binary,
            (varint_field_bin(2, 3))/binary,
            (field(4, PublicKey))/binary
        >>,
    Claim =
        <<
            (varint_field_bin(1, 1))/binary,
            (varint_field_bin(2, 2))/binary,
            (field(4, Certificate))/binary
        >>,
    ?assertEqual({ok, PublicKey}, channel_public_key(Claim)).

varint_field_bin(Number, Value) ->
    Key = Number bsl 3,
    <<(varint(Key))/binary, (varint(Value))/binary>>.

field(Number, Value) ->
    Key = (Number bsl 3) bor 2,
    <<(varint(Key))/binary, (varint(byte_size(Value)))/binary, Value/binary>>.

varint(Value) when Value < 16#80 ->
    <<Value>>;
varint(Value) ->
    <<((Value band 16#7f) bor 16#80), (varint(Value bsr 7))/binary>>.
