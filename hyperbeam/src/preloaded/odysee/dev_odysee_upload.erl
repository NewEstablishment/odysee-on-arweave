-module(dev_odysee_upload).
-implements(<<"odysee-upload@1.0">>).
-export([info/1, submit/3, upload/3, record/3, media/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-upload@1.0">>).
-define(DEFAULT_MAX_BYTES, 104857600).

info(_Opts) ->
    #{ exports => [<<"submit">>, <<"upload">>, <<"record">>, <<"media">>] }.

upload(Base, Req, Opts) ->
    submit(Base, Req, Opts).

submit(Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    {ok, Owner} ?= authenticated_owner(Base, Req, Opts),
                    {ok, Payload} ?= request_payload(Base, Req, Opts),
                    {ok, Bytes} ?= payload_bytes(Payload, Req, Opts),
                    ok ?= enforce_size(Bytes, Base, Req, Opts),
                    {ok, DataID} ?= hb_cache:write(Bytes, Opts),
                    Record0 = upload_record(Owner, DataID, Bytes, Payload, Opts),
                    {ok, RecordID} ?= hb_cache:write(Record0, Opts),
                    Record = enrich_record(RecordID, Record0, Opts),
                    ok ?= write_indexes(Record, Opts),
                    {ok, response(Record, Opts)}
                else
                    Error -> Error
                end
            end)
    end.

record(Base, Req, Opts) ->
    safe(fun() ->
        maybe
            {ok, ID} ?= requested_id(Base, Req, Opts),
            {ok, Msg} ?= hb_cache:read(ID, Opts),
            Loaded = hb_cache:ensure_all_loaded(Msg, Opts),
            {ok, enrich_record(ID, Loaded, Opts)}
        else
            Error -> Error
        end
    end).

media(Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    {ok, Record} ?= read_record(Base, Req, Opts),
                    {ok, DataID} ?= field(<<"data-id">>, Record, Opts),
                    {ok, Bytes} ?= hb_cache:read(DataID, Opts),
                    {ok, media_response(Record, Bytes, Req, Opts)}
                else
                    Error -> Error
                end
            end)
    end.

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> {error, Reason};
        _:Reason -> {error, Reason}
    end.

authenticated_owner(_Base, Req, Opts) ->
    case request_signers(Req, Opts) of
        [] ->
            {error, #{
                <<"status">> => 401,
                <<"body">> => <<"Signed request required.">>
            }};
        Signers ->
            case request_signature_valid(Req, Opts) of
                true -> {ok, hd(Signers)};
                _ -> {error, #{
                    <<"status">> => 401,
                    <<"body">> => <<"Invalid request signature.">>
                }}
            end
    end.

request_signers(Req, Opts) ->
    lists:usort(signers(Req, Opts)).

signers(Msg, Opts) when is_map(Msg) ->
    try hb_message:signers(Msg, Opts)
    catch _:_ -> []
    end;
signers(_Msg, _Opts) ->
    [].

request_signature_valid(Req, Opts) ->
    hb_message:verify(Req, signers, Opts)
        orelse hb_message:verify(hb_maps:without(auth_hook_ignored_keys(), Req, Opts), signers, Opts).

auth_hook_ignored_keys() ->
    [
        <<"secret">>,
        <<"cookie">>,
        <<"set-cookie">>,
        <<"path">>,
        <<"method">>,
        <<"authorization">>,
        <<"!">>
    ].

request_payload(Base, Req, Opts) ->
    Raw = maps:merge(map_or_empty(Base), map_or_empty(Req)),
    case first_field([<<"params64">>, <<"params-64">>], Raw, Opts) of
        not_found -> {ok, Raw};
        Encoded ->
            case decode_params64(Encoded) of
                {ok, Decoded} when is_map(Decoded) ->
                    {ok, maps:merge(Raw, Decoded)};
                {ok, _} ->
                    {error, invalid_upload_params};
                Error ->
                    Error
            end
    end.

payload_bytes(Payload, Req, Opts) ->
    case first_field(
        [
            <<"content-base64">>,
            <<"content_base64">>,
            <<"data-base64">>,
            <<"data_base64">>
        ],
        Payload,
        Opts
    ) of
        not_found ->
            case hb_maps:get(<<"body">>, Req, not_found, Opts) of
                Body when is_binary(Body) -> {ok, Body};
                _ -> {error, upload_content_not_found}
            end;
        Encoded ->
            try {ok, base64:decode(Encoded)}
            catch _:_ -> {error, invalid_upload_content_base64}
            end
    end.

decode_params64(Encoded) ->
    try {ok, hb_json:decode(hb_util:decode(Encoded))}
    catch _:_ -> {error, invalid_upload_params64}
    end.

enforce_size(Bytes, Base, Req, Opts) ->
    Max = integer_param(Base, Req, <<"max-bytes">>, upload_max_bytes(Opts), Opts),
    case byte_size(Bytes) =< Max of
        true -> ok;
        false -> {error, #{
            <<"status">> => 413,
            <<"body">> => <<"Upload exceeds configured maximum size.">>,
            <<"max-bytes">> => Max,
            <<"byte-size">> => byte_size(Bytes)
        }}
    end.

upload_max_bytes(Opts) ->
    hb_opts:get(odysee_upload_max_bytes, ?DEFAULT_MAX_BYTES, Opts).

upload_record(Owner, DataID, Bytes, Payload, Opts) ->
    Metadata = metadata(Payload, Opts),
    Name = first_field([<<"name">>, <<"claim-name">>, <<"claim_name">>], Payload, Opts),
    Title = first_field([<<"title">>], Metadata, Opts),
    MediaType =
        first_field(
            [<<"content-type">>, <<"content_type">>, <<"media-type">>, <<"media_type">>],
            Payload,
            Opts
        ),
    Filename = first_field([<<"filename">>, <<"file-name">>, <<"file_name">>], Payload, Opts),
    ReleaseTime = first_field([<<"release-time">>, <<"release_time">>], Metadata, Opts),
    RecordFilename = value_or(Filename, value_or(Name, <<"upload">>)),
    #{
        <<"device">> => ?DEVICE,
        <<"type">> => <<"odysee-upload">>,
        <<"version">> => <<"1">>,
        <<"owner">> => Owner,
        <<"data-id">> => DataID,
        <<"byte-size">> => byte_size(Bytes),
        <<"content-type">> => value_or(MediaType, <<"application/octet-stream">>),
        <<"filename">> => RecordFilename,
        <<"created-at">> => integer_to_binary(erlang:system_time(second)),
        <<"metadata">> => Metadata,
        <<"claim">> =>
            claim_summary(
                Name,
                Title,
                Metadata,
                DataID,
                Owner,
                ReleaseTime,
                MediaType,
                RecordFilename,
                byte_size(Bytes),
                Opts
            )
    }.

metadata(Payload, Opts) ->
    Source = case first_field([<<"metadata">>, <<"publish">>, <<"publish-payload">>, <<"publish_payload">>], Payload, Opts) of
        Msg when is_map(Msg) ->
            Msg;
        _ ->
            Payload
    end,
    without_control_keys(Source).

without_control_keys(Msg) ->
    Control = control_keys(),
    maps:filter(
        fun(Key, _Value) -> not lists:member(lower_key(Key), Control) end,
        Msg
    ).

claim_summary(Name0, Title0, Metadata, DataID, Owner, ReleaseTime, MediaType0, Filename0, Size, Opts) ->
    Name = value_or(Name0, <<"upload">>),
    Title = value_or(Title0, Name),
    Filename = value_or(Filename0, Name),
    ClaimURI = claim_uri(Name, Metadata, Opts),
    SigningChannel = signing_channel(Metadata, Opts),
    Tags = list_value(first_field([<<"tags">>], Metadata, Opts)),
    Languages = list_value(first_field([<<"languages">>], Metadata, Opts)),
    Description = value_or(first_field([<<"description">>], Metadata, Opts), <<>>),
    Thumbnail = first_field([<<"thumbnail-url">>, <<"thumbnail_url">>, <<"thumbnail">>], Metadata, Opts),
    MediaType =
        value_or(
            first_field([<<"content-type">>, <<"content_type">>, <<"media-type">>, <<"media_type">>], Metadata, Opts),
            value_or(MediaType0, <<"application/octet-stream">>)
        ),
    Claim0 = #{
        <<"claim_id">> => DataID,
        <<"claim-id">> => DataID,
        <<"name">> => Name,
        <<"permanent_url">> => ClaimURI,
        <<"canonical_url">> => ClaimURI,
        <<"short_url">> => ClaimURI,
        <<"type">> => <<"claim">>,
        <<"value_type">> => <<"stream">>,
        <<"confirmations">> => 0,
        <<"is_channel_signature_valid">> => SigningChannel =/= not_found,
        <<"txid">> => DataID,
        <<"nout">> => 0,
        <<"timestamp">> => release_time_or_now(ReleaseTime),
        <<"meta">> => #{ <<"effective_amount">> => <<"0">> },
        <<"value">> => #{
            <<"title">> => Title,
            <<"description">> => Description,
            <<"thumbnail">> => thumbnail_value(Thumbnail),
            <<"tags">> => Tags,
            <<"languages">> => Languages,
            <<"source">> => #{
                <<"media_type">> => MediaType,
                <<"media-type">> => MediaType,
                <<"name">> => Filename,
                <<"size">> => integer_to_binary(Size),
                <<"source">> => DataID,
                <<"sd_hash">> => DataID
            }
        },
        <<"hyperbeam">> => #{
            <<"owner">> => Owner,
            <<"data-id">> => DataID,
            <<"device">> => ?DEVICE
        }
    },
    put_optional({<<"signing_channel">>, SigningChannel}, Claim0).

response(Record, Opts) ->
    Claim = hb_maps:get(<<"claim">>, Record, #{}, Opts),
    Msg = (cors_headers())#{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"id">> => hb_maps:get(<<"record-id">>, Record, Opts),
        <<"record-id">> => hb_maps:get(<<"record-id">>, Record, Opts),
        <<"data-id">> => hb_maps:get(<<"data-id">>, Record, Opts),
        <<"media-path">> => media_path(hb_maps:get(<<"record-id">>, Record, Opts)),
        <<"record">> => Record,
        <<"claim">> => Claim,
        <<"outputs">> => [Claim],
        <<"result">> => #{ <<"outputs">> => [Claim] }
    },
    Msg#{ <<"body">> => hb_json:encode(Msg) }.

enrich_record(RecordID, Record0, Opts) ->
    Claim0 = hb_maps:get(<<"claim">>, Record0, #{}, Opts),
    Hyperbeam0 = hb_maps:get(<<"hyperbeam">>, Claim0, #{}, Opts),
    Claim = Claim0#{
        <<"claim_id">> => RecordID,
        <<"claim-id">> => RecordID,
        <<"txid">> => RecordID,
        <<"hyperbeam">> => Hyperbeam0#{
            <<"record-id">> => RecordID
        }
    },
    Record0#{
        <<"id">> => RecordID,
        <<"record-id">> => RecordID,
        <<"claim">> => Claim
    }.

write_indexes(Record, Opts) ->
    Store = hb_opts:get(store, [], Opts),
    RecordID = hb_maps:get(<<"record-id">>, Record, not_found, Opts),
    case {Store, RecordID} of
        {[], _} -> ok;
        {_, not_found} -> ok;
        _ ->
            Indexes = upload_indexes(Record, Opts),
            hb_store:write(Store, maps:from_list([{Path, RecordID} || Path <- Indexes]), Opts)
    end.

upload_indexes(Record, Opts) ->
    Claim = hb_maps:get(<<"claim">>, Record, #{}, Opts),
    RecordID = hb_maps:get(<<"record-id">>, Record, not_found, Opts),
    DataID = hb_maps:get(<<"data-id">>, Record, not_found, Opts),
    Name = first_field([<<"name">>, <<"claim-name">>, <<"claim_name">>], Claim, Opts),
    Values =
        [
            {<<"record-id">>, RecordID},
            {<<"claim-id">>, RecordID},
            {<<"claim-id">>, DataID},
            {<<"name">>, Name}
        ]
            ++ [{<<"uri">>, URI} || URI <- claim_uris(Claim, Opts)],
    lists:usort(
        [
            index_path(Type, Value)
        ||
            {Type, Value} <- Values,
            is_binary(Value),
            Value =/= <<>>,
            Value =/= not_found
        ]
    ).

claim_uris(Claim, Opts) ->
    Values =
        [
            first_field([<<"canonical_url">>, <<"canonical-url">>], Claim, Opts),
            first_field([<<"permanent_url">>, <<"permanent-url">>], Claim, Opts),
            first_field([<<"short_url">>, <<"short-url">>], Claim, Opts)
        ],
    [URI || URI <- Values, is_binary(URI), URI =/= <<>>].

index_path(Type, Value) ->
    <<"odysee/upload/", Type/binary, "/", (hb_util:encode(hb_crypto:sha256(Value)))/binary>>.

read_record(Base, Req, Opts) ->
    maybe
        {ok, ID} ?= requested_id(Base, Req, Opts),
        {ok, Msg} ?= hb_cache:read(ID, Opts),
        Loaded = hb_cache:ensure_all_loaded(Msg, Opts),
        case Loaded of
            #{ <<"data-id">> := _ } -> {ok, enrich_record(ID, Loaded, Opts)};
            _ -> {error, invalid_upload_record}
        end
    end.

requested_id(Base, Req, Opts) ->
    case first_found(
        [
            {Req, <<"id">>},
            {Req, <<"record-id">>},
            {Req, <<"record_id">>},
            {Req, <<"claim-id">>},
            {Req, <<"claim_id">>},
            {Base, <<"id">>},
            {Base, <<"record-id">>},
            {Base, <<"record_id">>},
            {Base, <<"claim-id">>},
            {Base, <<"claim_id">>}
        ],
        Opts
    ) of
        not_found -> {error, upload_record_id_not_found};
        ID -> {ok, ID}
    end.

media_response(Record, Bytes, Req, Opts) ->
    Headers = media_headers(Record, Bytes, Opts),
    case method(Req, Opts) of
        <<"head">> ->
            Headers#{ <<"body">> => <<>> };
        _ ->
            case requested_range(Req, byte_size(Bytes), Opts) of
                not_found ->
                    Headers#{ <<"body">> => Bytes };
                {ok, Start, End} ->
                    Length = End - Start + 1,
                    Headers#{
                        <<"status">> => 206,
                        <<"content-length">> => Length,
                        <<"content-range">> => content_range(Start, End, byte_size(Bytes)),
                        <<"body">> => binary:part(Bytes, Start, Length)
                    };
                invalid ->
                    (cors_headers())#{
                        <<"status">> => 416,
                        <<"content-type">> =>
                            hb_maps:get(<<"content-type">>, Record, <<"application/octet-stream">>, Opts),
                        <<"content-length">> => 0,
                        <<"content-range">> => content_range_invalid(byte_size(Bytes)),
                        <<"body">> => <<>>
                    }
            end
    end.

media_headers(Record, Bytes, Opts) ->
    (cors_headers())#{
        <<"status">> => 200,
        <<"content-type">> =>
            hb_maps:get(<<"content-type">>, Record, <<"application/octet-stream">>, Opts),
        <<"content-length">> => byte_size(Bytes),
        <<"accept-ranges">> => <<"bytes">>
    }.

requested_range(Req, Size, Opts) ->
    case first_field([<<"range">>], Req, Opts) of
        not_found -> not_found;
        Range -> parse_range(hb_util:bin(Range), Size)
    end.

parse_range(_Range, 0) ->
    invalid;
parse_range(<<"bytes=", Descriptor/binary>>, Size) ->
    parse_range_descriptor(Descriptor, Size);
parse_range(<<"bytes ", Descriptor/binary>>, Size) ->
    parse_range_descriptor(Descriptor, Size);
parse_range(_Range, _Size) ->
    invalid.

parse_range_descriptor(Descriptor, Size) ->
    case binary:split(Descriptor, <<",">>) of
        [Single] -> parse_single_range(string:trim(Single), Size);
        _ -> invalid
    end.

parse_single_range(<<"-", SuffixBin/binary>>, Size) ->
    case parse_non_neg_int(SuffixBin) of
        {ok, 0} -> invalid;
        {ok, Suffix} ->
            Start = max(0, Size - Suffix),
            {ok, Start, Size - 1};
        error -> invalid
    end;
parse_single_range(Descriptor, Size) ->
    case binary:split(Descriptor, <<"-">>) of
        [StartBin, <<>>] ->
            range_from_start(StartBin, Size);
        [StartBin, EndBin] ->
            range_from_start_end(StartBin, EndBin, Size);
        _ ->
            invalid
    end.

range_from_start(StartBin, Size) ->
    case parse_non_neg_int(StartBin) of
        {ok, Start} when Start < Size -> {ok, Start, Size - 1};
        _ -> invalid
    end.

range_from_start_end(StartBin, EndBin, Size) ->
    case {parse_non_neg_int(StartBin), parse_non_neg_int(EndBin)} of
        {{ok, Start}, {ok, End0}} when Start < Size, End0 >= Start ->
            {ok, Start, min(End0, Size - 1)};
        _ ->
            invalid
    end.

parse_non_neg_int(Bin) ->
    try
        Int = binary_to_integer(Bin),
        case Int >= 0 of
            true -> {ok, Int};
            false -> error
        end
    catch _:_ ->
        error
    end.

content_range(Start, End, Size) ->
    <<"bytes ", (integer_to_binary(Start))/binary, "-", (integer_to_binary(End))/binary, "/", (integer_to_binary(Size))/binary>>.

content_range_invalid(Size) ->
    <<"bytes */", (integer_to_binary(Size))/binary>>.

method(Req, Opts) ->
    hb_util:to_lower(hb_util:bin(hb_maps:get(<<"method">>, Req, <<"GET">>, Opts))).

cors_preflight_response() ->
    (cors_headers())#{
        <<"status">> => 204,
        <<"content-type">> => <<"text/plain">>,
        <<"content-length">> => 0,
        <<"body">> => <<>>
    }.

cors_headers() ->
    #{
        <<"access-control-allow-origin">> => <<"*">>,
        <<"access-control-allow-methods">> => <<"GET,HEAD,POST,OPTIONS">>,
        <<"access-control-allow-headers">> =>
            <<"Range,Content-Type,Accept,Authorization,X-Lbry-Auth-Token">>,
        <<"access-control-expose-headers">> =>
            <<"Content-Length,Content-Range,Accept-Ranges,Location,Content-Digest">>
    }.

field(Key, Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> {error, {missing_upload_field, Key}};
        Value -> {ok, Value}
    end.

first_field(Keys, Msg, Opts) ->
    first_found([{Msg, Key} || Key <- Keys], Opts).

first_found([], _Opts) ->
    not_found;
first_found([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_found(Rest, Opts);
        Value -> Value
    end;
first_found([_ | Rest], Opts) ->
    first_found(Rest, Opts).

integer_param(Base, Req, Key, Default, Opts) ->
    case first_found([{Req, Key}, {Base, Key}], Opts) of
        not_found -> Default;
        Int when is_integer(Int) -> Int;
        Bin when is_binary(Bin) ->
            try binary_to_integer(Bin)
            catch _:_ -> Default
            end;
        _ -> Default
    end.

release_time_or_now(not_found) ->
    erlang:system_time(second);
release_time_or_now(Int) when is_integer(Int) ->
    Int;
release_time_or_now(Bin) when is_binary(Bin) ->
    try binary_to_integer(Bin)
    catch _:_ -> erlang:system_time(second)
    end;
release_time_or_now(_Value) ->
    erlang:system_time(second).

thumbnail_value(not_found) ->
    #{};
thumbnail_value(#{ <<"url">> := _ } = Thumbnail) ->
    Thumbnail;
thumbnail_value(URL) when is_binary(URL) ->
    #{ <<"url">> => URL };
thumbnail_value(_Value) ->
    #{}.

claim_uri(Name, Metadata, Opts) ->
    case channel_uri(Metadata, Opts) of
        not_found -> <<"lbry://", Name/binary>>;
        ChannelURI -> <<ChannelURI/binary, "/", Name/binary>>
    end.

channel_uri(Metadata, Opts) ->
    Channel = channel_metadata(Metadata, Opts),
    case first_field([<<"short_url">>, <<"short-url">>, <<"canonical_url">>, <<"canonical-url">>, <<"permanent_url">>, <<"permanent-url">>], Channel, Opts) of
        <<"lbry://", _/binary>> = URI -> URI;
        _ ->
            case first_field([<<"name">>, <<"channel_name">>, <<"channel-name">>], Channel, Opts) of
                <<"@", _/binary>> = Name -> <<"lbry://", Name/binary>>;
                _ -> not_found
            end
    end.

signing_channel(Metadata, Opts) ->
    Channel = channel_metadata(Metadata, Opts),
    case first_field([<<"claim_id">>, <<"claim-id">>, <<"id">>], Channel, Opts) of
        not_found -> not_found;
        ClaimID ->
            #{
                <<"claim_id">> => ClaimID,
                <<"name">> => first_field([<<"name">>, <<"channel_name">>, <<"channel-name">>], Channel, Opts),
                <<"permanent_url">> => first_field([<<"permanent_url">>, <<"permanent-url">>], Channel, Opts),
                <<"canonical_url">> => first_field([<<"canonical_url">>, <<"canonical-url">>], Channel, Opts),
                <<"short_url">> => first_field([<<"short_url">>, <<"short-url">>], Channel, Opts),
                <<"value">> => first_field([<<"value">>], Channel, Opts)
            }
    end.

channel_metadata(Metadata, Opts) ->
    case first_field([<<"channel">>, <<"signing_channel">>, <<"signing-channel">>], Metadata, Opts) of
        Channel when is_map(Channel) ->
            Channel;
        _ ->
            #{
                <<"claim_id">> => first_field([<<"channel_id">>, <<"channel-id">>, <<"channel_claim_id">>, <<"channel-claim-id">>], Metadata, Opts),
                <<"name">> => first_field([<<"channel_name">>, <<"channel-name">>], Metadata, Opts),
                <<"permanent_url">> => first_field([<<"channel_url">>, <<"channel-url">>], Metadata, Opts)
            }
    end.

list_value(not_found) ->
    [];
list_value(Value) when is_list(Value) ->
    Value;
list_value(Value) when is_binary(Value) ->
    case binary:split(Value, <<",">>, [global]) of
        [Value] -> [Value];
        Parts -> [Part || Part <- Parts, Part =/= <<>>]
    end;
list_value(_Value) ->
    [].

value_or(not_found, Default) ->
    Default;
value_or(undefined, Default) ->
    Default;
value_or(<<>>, Default) ->
    Default;
value_or(Value, _Default) ->
    Value.

put_optional({_Key, not_found}, Msg) ->
    Msg;
put_optional({_Key, undefined}, Msg) ->
    Msg;
put_optional({_Key, <<>>}, Msg) ->
    Msg;
put_optional({Key, Value}, Msg) ->
    Msg#{ Key => Value }.

lower_key(Key) when is_binary(Key) ->
    hb_util:to_lower(Key);
lower_key(Key) ->
    hb_util:to_lower(hb_ao:normalize_key(Key)).

media_path(ID) ->
    <<"/~odysee-upload@1.0/media?id=", ID/binary>>.

map_or_empty(Map) when is_map(Map) ->
    Map;
map_or_empty(_Value) ->
    #{}.

control_keys() ->
    [
        <<"!">>,
        <<"accept">>,
        <<"accept-language">>,
        <<"authorization">>,
        <<"auth-token">>,
        <<"auth_token">>,
        <<"authtoken">>,
        <<"body">>,
        <<"connection">>,
        <<"content-base64">>,
        <<"content_base64">>,
        <<"cookie">>,
        <<"data-base64">>,
        <<"data_base64">>,
        <<"device">>,
        <<"host">>,
        <<"lbry-auth-token">>,
        <<"lbry_auth_token">>,
        <<"method">>,
        <<"odysee-auth-token">>,
        <<"odysee_auth_token">>,
        <<"origin">>,
        <<"params64">>,
        <<"params-64">>,
        <<"path">>,
        <<"priv">>,
        <<"referer">>,
        <<"sec-ch-ua">>,
        <<"sec-ch-ua-mobile">>,
        <<"sec-ch-ua-platform">>,
        <<"sec-fetch-dest">>,
        <<"sec-fetch-mode">>,
        <<"sec-fetch-site">>,
        <<"user-agent">>,
        <<"x-lbry-auth-token">>,
        <<"x_lbry_auth_token">>
    ].

-ifdef(TEST).

upload_requires_signed_request_test() ->
    Opts = test_opts(),
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        submit(#{}, #{ <<"body">> => <<"hello">> }, Opts)
    ).

upload_rejects_signed_base_with_unsigned_request_test() ->
    Opts = test_opts(),
    Base = signed(#{ <<"body">> => <<"base">> }, Opts),
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        submit(Base, #{ <<"body">> => <<"hello">> }, Opts)
    ).

upload_stores_signed_body_and_reads_media_test() ->
    Opts = test_opts(),
    Req = signed(#{
        <<"body">> => <<"hello">>,
        <<"name">> => <<"demo">>,
        <<"title">> => <<"Demo">>,
        <<"content-type">> => <<"text/plain">>
    }, Opts),
    {ok, Res} = submit(#{}, Req, Opts),
    RecordID = hb_maps:get(<<"record-id">>, Res, Opts),
    DataID = hb_maps:get(<<"data-id">>, Res, Opts),
    Body = hb_json:decode(hb_maps:get(<<"body">>, Res, Opts)),
    ?assertMatch(<<"data/", _/binary>>, DataID),
    ?assertEqual(<<"*">>, hb_maps:get(<<"access-control-allow-origin">>, Res, Opts)),
    ?assertNotEqual(
        nomatch,
        binary:match(
            hb_maps:get(<<"access-control-allow-headers">>, Res, Opts),
            <<"X-Lbry-Auth-Token">>
        )
    ),
    ?assertEqual(RecordID, hb_maps:get(<<"claim_id">>, hd(hb_maps:get(<<"outputs">>, Res, Opts)), Opts)),
    ?assertEqual(RecordID, hb_maps:get(<<"record-id">>, Body, Opts)),
    ?assertEqual(RecordID, hb_maps:get(<<"claim_id">>, hd(hb_maps:get(<<"outputs">>, Body, Opts)), Opts)),
    Source =
        hb_maps:get(
            <<"source">>,
            hb_maps:get(<<"value">>, hd(hb_maps:get(<<"outputs">>, Body, Opts)), Opts),
            Opts
        ),
    ?assertEqual(<<"demo">>, hb_maps:get(<<"name">>, Source, Opts)),
    ?assertEqual(<<"5">>, hb_maps:get(<<"size">>, Source, Opts)),
    {ok, Record} = record(#{}, #{ <<"id">> => RecordID }, Opts),
    ?assertEqual(RecordID, hb_maps:get(<<"record-id">>, Record, Opts)),
    ?assertEqual(RecordID, hb_maps:get(<<"claim_id">>, hb_maps:get(<<"claim">>, Record, Opts), Opts)),
    ?assertEqual(DataID, hb_maps:get(<<"data-id">>, Record, Opts)),
    {ok, Media} = media(#{}, #{ <<"id">> => RecordID }, Opts),
    ?assertEqual(<<"hello">>, hb_maps:get(<<"body">>, Media, Opts)),
    ?assertEqual(<<"text/plain">>, hb_maps:get(<<"content-type">>, Media, Opts)).

upload_accepts_params64_base64_content_test() ->
    Opts = test_opts(),
    Params = #{
        <<"name">> => <<"demo64">>,
        <<"content_type">> => <<"text/plain">>,
        <<"content_base64">> => base64:encode(<<"hello64">>),
        <<"metadata">> => #{
            <<"title">> => <<"Demo 64">>,
            <<"tags">> => [<<"test">>]
        }
    },
    Req = signed(#{ <<"params64">> => hb_util:encode(hb_json:encode(Params)) }, Opts),
    {ok, Res} = submit(#{}, Req, Opts),
    {ok, Media} = media(#{}, #{ <<"id">> => hb_maps:get(<<"record-id">>, Res, Opts) }, Opts),
    ?assertEqual(<<"hello64">>, hb_maps:get(<<"body">>, Media, Opts)).

upload_resolves_native_claim_and_stream_media_test() ->
    Opts = test_opts(),
    Req = signed(#{
        <<"body">> => <<"native media">>,
        <<"name">> => <<"native-demo">>,
        <<"content-type">> => <<"text/plain">>,
        <<"metadata">> => #{
            <<"title">> => <<"Native Demo">>,
            <<"channel">> => #{
                <<"claim_id">> => <<"channel-1">>,
                <<"name">> => <<"@native">>,
                <<"short_url">> => <<"lbry://@native#channel-1">>
            }
        }
    }, Opts),
    {ok, Res} = submit(#{}, Req, Opts),
    RecordID = hb_maps:get(<<"record-id">>, Res, Opts),
    URI = <<"lbry://@native#channel-1/native-demo">>,
    {ok, ClaimMsg} = dev_odysee_claim:resolve(#{}, #{ <<"uri">> => URI }, Opts),
    ?assertEqual(RecordID, hb_maps:get(<<"claim-id">>, ClaimMsg, Opts)),
    Claim = hb_maps:get(<<"claim">>, ClaimMsg, Opts),
    ?assertEqual(true, hb_maps:get(<<"is_channel_signature_valid">>, Claim, Opts)),
    {ok, Playback} =
        dev_odysee_stream:playback(
            #{},
            #{ <<"uri">> => URI, <<"media-base-url">> => <<"http://127.0.0.1:8734">> },
            Opts
        ),
    PlaybackBody = hb_json:decode(hb_maps:get(<<"body">>, Playback, Opts)),
    ?assertEqual(
        <<"http://127.0.0.1:8734/~odysee-upload@1.0/media?id=", RecordID/binary>>,
        hb_maps:get(<<"streaming_url">>, PlaybackBody, Opts)
    ),
    {ok, StreamMedia} = dev_odysee_stream:media(#{}, #{ <<"uri">> => URI }, Opts),
    ?assertEqual(<<"native media">>, hb_maps:get(<<"body">>, StreamMedia, Opts)).

upload_options_response_test() ->
    {ok, Res} = submit(#{}, #{ <<"method">> => <<"OPTIONS">> }, #{}),
    ?assertEqual(204, hb_maps:get(<<"status">>, Res, #{})),
    ?assertEqual(<<>>, hb_maps:get(<<"body">>, Res, #{})),
    ?assertEqual(<<"GET,HEAD,POST,OPTIONS">>, hb_maps:get(<<"access-control-allow-methods">>, Res, #{})).

media_options_response_test() ->
    {ok, Res} = media(#{}, #{ <<"method">> => <<"OPTIONS">> }, #{}),
    ?assertEqual(204, hb_maps:get(<<"status">>, Res, #{})),
    ?assertEqual(<<>>, hb_maps:get(<<"body">>, Res, #{})),
    ?assertEqual(<<"GET,HEAD,POST,OPTIONS">>, hb_maps:get(<<"access-control-allow-methods">>, Res, #{})).

media_head_response_test() ->
    Opts = test_opts(),
    Req = signed(#{
        <<"body">> => <<"hello">>,
        <<"name">> => <<"head-demo">>,
        <<"content-type">> => <<"text/plain">>
    }, Opts),
    {ok, Res} = submit(#{}, Req, Opts),
    {ok, Head} = media(#{}, #{ <<"id">> => hb_maps:get(<<"record-id">>, Res, Opts), <<"method">> => <<"HEAD">> }, Opts),
    ?assertEqual(200, hb_maps:get(<<"status">>, Head, Opts)),
    ?assertEqual(5, hb_maps:get(<<"content-length">>, Head, Opts)),
    ?assertEqual(<<>>, hb_maps:get(<<"body">>, Head, Opts)).

media_range_response_test() ->
    Opts = test_opts(),
    Req = signed(#{
        <<"body">> => <<"hello">>,
        <<"name">> => <<"range-demo">>,
        <<"content-type">> => <<"text/plain">>
    }, Opts),
    {ok, Res} = submit(#{}, Req, Opts),
    {ok, Range} =
        media(
            #{},
            #{
                <<"id">> => hb_maps:get(<<"record-id">>, Res, Opts),
                <<"range">> => <<"bytes=1-3">>
            },
            Opts
        ),
    ?assertEqual(206, hb_maps:get(<<"status">>, Range, Opts)),
    ?assertEqual(3, hb_maps:get(<<"content-length">>, Range, Opts)),
    ?assertEqual(<<"bytes 1-3/5">>, hb_maps:get(<<"content-range">>, Range, Opts)),
    ?assertEqual(<<"ell">>, hb_maps:get(<<"body">>, Range, Opts)).

upload_strips_auth_fields_from_metadata_test() ->
    Opts = test_opts(),
    Req = signed(#{
        <<"body">> => <<"hello">>,
        <<"name">> => <<"demo">>,
        <<"!">> => true,
        <<"X-Lbry-Auth-Token">> => <<"secret-token">>,
        <<"auth_token">> => <<"cookie-token">>
    }, Opts),
    {ok, Res} = submit(#{}, Req, Opts),
    Metadata = hb_maps:get(<<"metadata">>, hb_maps:get(<<"record">>, Res, Opts), Opts),
    ?assertEqual(not_found, hb_maps:get(<<"!">>, Metadata, not_found, Opts)),
    ?assertEqual(not_found, hb_maps:get(<<"X-Lbry-Auth-Token">>, Metadata, not_found, Opts)),
    ?assertEqual(not_found, hb_maps:get(<<"auth_token">>, Metadata, not_found, Opts)).

upload_rejects_oversized_content_test() ->
    Opts = test_opts(),
    Req = signed(#{ <<"body">> => <<"too big">>, <<"max-bytes">> => <<"3">> }, Opts),
    ?assertMatch(
        {error, #{ <<"status">> := 413 }},
        submit(#{}, Req, Opts)
    ).

auth_hook_signed_upload_roundtrip_test() ->
    Token = <<"demo-token">>,
    UploadReq = #{
        <<"Authorization">> => <<"Bearer ", Token/binary>>,
        <<"!">> => true,
        <<"body">> => <<"hook upload">>,
        <<"name">> => <<"hook-upload">>,
        <<"title">> => <<"Hook Upload">>,
        <<"content-type">> => <<"text/plain">>
    },
    auth_hook_upload_roundtrip(Token, UploadReq).

auth_hook_cookie_signed_upload_roundtrip_test() ->
    Token = <<"cookie-token">>,
    UploadReq = #{
        <<"cookie">> => <<"auth_token=", Token/binary>>,
        <<"!">> => true,
        <<"body">> => <<"cookie hook upload">>,
        <<"name">> => <<"cookie-hook-upload">>,
        <<"title">> => <<"Cookie Hook Upload">>,
        <<"content-type">> => <<"text/plain">>
    },
    auth_hook_upload_roundtrip(Token, UploadReq).

auth_hook_upload_roundtrip(Token, UploadReq) ->
    {ok, AuthMsg} =
        hb_ao:resolve(
            #{ <<"device">> => <<"odysee-auth@1.0">> },
            #{
                <<"path">> => <<"generate">>,
                <<"authorization">> => <<"Bearer ", Token/binary>>
            },
            #{}
        ),
    Secret = hb_maps:get(<<"secret">>, AuthMsg, #{}),
    Wallet = ar_wallet:new(),
    Address = hb_util:human_id(ar_wallet:to_address(Wallet)),
    AccessControl = #{
        <<"device">> => <<"odysee-auth@1.0">>,
        <<"wallet-address">> => Address
    },
    {ok, InitializedAuth} =
        hb_ao:resolve(
            AccessControl,
            #{ <<"path">> => <<"commit">>, <<"secret">> => Secret },
            #{}
        ),
    [Committer] = hb_message:signers(InitializedAuth, #{}),
    KeyID = <<"secret:", (hb_util:secret_key_to_committer(Secret))/binary>>,
    WalletDetails = #{
        <<"wallet">> => ar_wallet:to_json(Wallet),
        <<"address">> => Address,
        <<"persist">> => <<"in-memory">>,
        <<"access-control">> => hb_private:reset(InitializedAuth),
        <<"committer">> => Committer,
        <<"controllers">> => [],
        <<"required-controllers">> => 1
    },
    Opts = (test_opts())#{
        <<"priv-wallet">> => ar_wallet:new(),
        <<"priv-wallet-hosted">> => #{ KeyID => WalletDetails }
    },
    HookBase = #{
        <<"when">> => #{ <<"keys">> => [<<"authorization">>, <<"!">>] },
        <<"secret-provider">> => #{
            <<"device">> => <<"odysee-auth@1.0">>,
            <<"access-control">> => #{ <<"device">> => <<"odysee-auth@1.0">> }
        }
    },
    {ok, #{ <<"request">> := SignedReq }} =
        hb_ao:resolve(
            HookBase#{ <<"device">> => <<"auth-hook@1.0">> },
            #{
                <<"path">> => <<"request">>,
                <<"request">> => UploadReq,
                <<"body">> => []
            },
            Opts
        ),
    ?assertNotEqual([], hb_message:signers(SignedReq, Opts)),
    {ok, Res} = submit(#{}, SignedReq, Opts),
    RecordID = hb_maps:get(<<"record-id">>, Res, Opts),
    {ok, Media} = media(#{}, #{ <<"id">> => RecordID }, Opts),
    ?assertEqual(hb_maps:get(<<"body">>, UploadReq, Opts), hb_maps:get(<<"body">>, Media, Opts)).

signed(Msg, Opts) ->
    hb_message:commit(Msg, Opts#{ <<"priv-wallet">> => ar_wallet:new() }).

test_opts() ->
    Timestamp = integer_to_binary(erlang:unique_integer([positive, monotonic])),
    Store = #{
        <<"store-module">> => hb_store_fs,
        <<"name">> => <<"_build/odysee-upload-test-", Timestamp/binary>>
    },
    ok = hb_store:start(Store),
    ok = hb_store:reset(Store),
    #{
        <<"store">> => Store,
        <<"cache-control">> => [<<"no-cache">>, <<"no-store">>],
        <<"store-all-signed">> => false
    }.

-endif.
