-module(dev_odysee_index).
-implements(<<"odysee-index@1.0">>).
-export([info/1, upload/3, record/3, list/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-index@1.0">>).

info(_Opts) ->
    #{ exports => [<<"upload">>, <<"record">>, <<"list">>] }.

upload(Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    {ok, Owner} ?= authenticated_owner(Req, Opts),
                    {ok, Payload0} ?= request_payload(Base, Req, Opts),
                    Payload = hb_cache:ensure_all_loaded(Payload0, Opts),
                    {ok, DataID} ?= required_first([<<"data-id">>, <<"data_id">>, <<"id">>], Payload, Opts),
                    Record0 = upload_record(Owner, DataID, Payload, Opts),
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

list(Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                Params = maps:merge(map_or_empty(Base), map_or_empty(Req)),
                IDs = upload_list_ids(Params, Opts),
                Claims0 = upload_claims_from_ids(IDs, Opts),
                Claims = sort_claims(filter_claims(Claims0, Params, Opts), Params, Opts),
                Page = max(1, integer_param(Base, Req, <<"page">>, 1, Opts)),
                PageSize =
                    max(
                        1,
                        integer_param(
                            Base,
                            Req,
                            <<"page-size">>,
                            integer_param(Base, Req, <<"page_size">>, 50, Opts),
                            Opts
                        )
                    ),
                {ok, list_response(page_items(Claims, Page, PageSize), length(Claims), Page, PageSize)}
            end)
    end.

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> {error, Reason};
        _:Reason -> {error, Reason}
    end.

authenticated_owner(Req, Opts) ->
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
        not_found -> {ok, without_control_keys(Raw)};
        Encoded ->
            case decode_params64(Encoded) of
                {ok, Decoded} when is_map(Decoded) ->
                    {ok, maps:merge(without_control_keys(Raw), Decoded)};
                {ok, _} ->
                    {error, invalid_index_params};
                Error ->
                    Error
            end
    end.

decode_params64(Encoded) ->
    try {ok, hb_json:decode(hb_util:decode(Encoded))}
    catch _:_ -> {error, invalid_index_params64}
    end.

upload_record(Owner, DataID, Payload, Opts) ->
    Metadata = metadata(Payload, Opts),
    Name = value_or(first_field([<<"name">>, <<"claim-name">>, <<"claim_name">>], Payload, Opts), <<"upload">>),
    MediaType = value_or(first_field([<<"content-type">>, <<"content_type">>, <<"media-type">>, <<"media_type">>], Payload, Opts), <<"application/octet-stream">>),
    Filename = value_or(first_field([<<"filename">>, <<"file-name">>, <<"file_name">>], Payload, Opts), Name),
    Size = integer_value(first_field([<<"size">>, <<"byte-size">>, <<"byte_size">>], Payload, Opts), 0),
    Claim = normalize_claim(
        value_or(first_field([<<"claim">>], Payload, Opts), #{}),
        Owner,
        DataID,
        Name,
        MediaType,
        Filename,
        Size,
        Metadata,
        Opts
    ),
    #{
        <<"device">> => ?DEVICE,
        <<"type">> => <<"odysee-upload-index">>,
        <<"version">> => <<"1">>,
        <<"owner">> => Owner,
        <<"data-id">> => DataID,
        <<"data-kind">> => <<"bytes">>,
        <<"byte-size">> => Size,
        <<"content-type">> => MediaType,
        <<"filename">> => Filename,
        <<"created-at">> => integer_to_binary(erlang:system_time(second)),
        <<"metadata">> => Metadata,
        <<"claim">> => Claim
    }.

metadata(Payload, Opts) ->
    Source = case first_field([<<"metadata">>, <<"publish">>, <<"publish-payload">>, <<"publish_payload">>], Payload, Opts) of
        Msg when is_map(Msg) -> Msg;
        _ -> Payload
    end,
    without_control_keys(Source).

normalize_claim(Claim0, Owner, DataID, Name, MediaType, Filename, Size, Metadata, Opts) when is_map(Claim0) ->
    Timestamp = release_time_or_now(first_field([<<"release_time">>, <<"release-time">>], Metadata, Opts)),
    Value0 = value_or(first_field([<<"value">>], Claim0, Opts), #{}),
    Source0 = value_or(first_field([<<"source">>], Value0, Opts), #{}),
    Hyperbeam0 = value_or(first_field([<<"hyperbeam">>], Claim0, Opts), #{}),
    ClaimURI = value_or(first_field([<<"permanent_url">>, <<"canonical_url">>, <<"short_url">>], Claim0, Opts), claim_uri(Name, Metadata, Opts)),
    SigningChannel = value_or(first_field([<<"signing_channel">>, <<"signing-channel">>], Claim0, Opts), signing_channel(Metadata, Opts)),
    Claim1 = Claim0#{
        <<"claim_id">> => DataID,
        <<"claim-id">> => DataID,
        <<"name">> => value_or(first_field([<<"name">>], Claim0, Opts), Name),
        <<"normalized_name">> => hb_util:to_lower(value_or(first_field([<<"name">>], Claim0, Opts), Name)),
        <<"permanent_url">> => ClaimURI,
        <<"canonical_url">> => ClaimURI,
        <<"short_url">> => ClaimURI,
        <<"type">> => <<"claim">>,
        <<"value_type">> => <<"stream">>,
        <<"confirmations">> => 1,
        <<"is_my_output">> => true,
        <<"is_channel_signature_valid">> => SigningChannel =/= not_found,
        <<"txid">> => DataID,
        <<"nout">> => 0,
        <<"timestamp">> => Timestamp,
        <<"streaming_url">> => generic_read_path(DataID),
        <<"download_url">> => generic_read_path(DataID),
        <<"hyperbeam">> => Hyperbeam0#{
            <<"owner">> => Owner,
            <<"data-id">> => DataID,
            <<"device">> => ?DEVICE,
            <<"path">> => generic_read_path(DataID)
        },
        <<"value">> => Value0#{
            <<"title">> => value_or(first_field([<<"title">>], Value0, Opts), value_or(first_field([<<"title">>], Metadata, Opts), Name)),
            <<"description">> => value_or(first_field([<<"description">>], Value0, Opts), value_or(first_field([<<"description">>], Metadata, Opts), <<>>)),
            <<"thumbnail">> => thumbnail_value(value_or(first_field([<<"thumbnail">>], Value0, Opts), first_field([<<"thumbnail_url">>, <<"thumbnail">>], Metadata, Opts))),
            <<"tags">> => list_value(value_or(first_field([<<"tags">>], Value0, Opts), first_field([<<"tags">>], Metadata, Opts))),
            <<"languages">> => list_value(value_or(first_field([<<"languages">>], Value0, Opts), first_field([<<"languages">>], Metadata, Opts))),
            <<"release_time">> => Timestamp,
            <<"source">> => Source0#{
                <<"media_type">> => MediaType,
                <<"media-type">> => MediaType,
                <<"name">> => Filename,
                <<"size">> => integer_to_binary(Size),
                <<"source">> => DataID,
                <<"sd_hash">> => DataID,
                <<"url">> => generic_read_path(DataID)
            }
        }
    },
    put_optional({<<"signing_channel">>, SigningChannel}, Claim1);
normalize_claim(_Claim, Owner, DataID, Name, MediaType, Filename, Size, Metadata, Opts) ->
    normalize_claim(#{}, Owner, DataID, Name, MediaType, Filename, Size, Metadata, Opts).

enrich_record(RecordID, Record0, Opts) ->
    Claim0 = hb_maps:get(<<"claim">>, Record0, #{}, Opts),
    Hyperbeam0 = hb_maps:get(<<"hyperbeam">>, Claim0, #{}, Opts),
    DataID = hb_maps:get(<<"data-id">>, Record0, RecordID, Opts),
    Claim = Claim0#{
        <<"claim_id">> => RecordID,
        <<"claim-id">> => RecordID,
        <<"txid">> => RecordID,
        <<"streaming_url">> => generic_read_path(DataID),
        <<"download_url">> => generic_read_path(DataID),
        <<"hyperbeam">> => Hyperbeam0#{
            <<"record-id">> => RecordID,
            <<"data-id">> => DataID,
            <<"device">> => ?DEVICE,
            <<"path">> => generic_read_path(DataID)
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
            case hb_store:write(Store, maps:from_list([{Path, RecordID} || Path <- Indexes]), Opts) of
                ok -> write_list_indexes(Store, Record, Opts);
                Error -> Error
            end
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

write_list_indexes(Store, Record, Opts) ->
    RecordID = hb_maps:get(<<"record-id">>, Record, not_found, Opts),
    Paths = upload_list_indexes(Record, Opts),
    lists:foldl(
        fun(Path, ok) -> append_list_index(Store, Path, RecordID, Opts);
           (_Path, Error) -> Error
        end,
        ok,
        Paths
    ).

upload_list_indexes(Record, Opts) ->
    Claim = hb_maps:get(<<"claim">>, Record, #{}, Opts),
    Owner = hb_maps:get(<<"owner">>, Record, not_found, Opts),
    SigningChannel = hb_maps:get(<<"signing_channel">>, Claim, #{}, Opts),
    ChannelID = first_field([<<"claim_id">>, <<"claim-id">>, <<"id">>], SigningChannel, Opts),
    Values = [
        {<<"all">>, <<"all">>},
        {<<"owner">>, Owner},
        {<<"channel">>, ChannelID}
    ],
    lists:usort(
        [
            list_index_path(Type, Value)
        ||
            {Type, Value} <- Values,
            is_binary(Value),
            Value =/= <<>>,
            Value =/= not_found
        ]
    ).

append_list_index(Store, Path, RecordID, Opts) ->
    Existing = read_list_index(Store, Path, Opts),
    Updated = dedupe_binaries([RecordID | Existing]),
    hb_store:write(Store, #{ Path => hb_json:encode(Updated) }, Opts).

read_list_index(Store, Path, Opts) ->
    case hb_store:read(Store, Path, maps:without([<<"store">>, store], Opts)) of
        {ok, Raw} -> decode_list_index(Raw);
        Raw when is_binary(Raw) -> decode_list_index(Raw);
        _ -> []
    end.

decode_list_index(Raw) when is_binary(Raw) ->
    try hb_json:decode(Raw) of
        IDs when is_list(IDs) -> [ID || ID <- IDs, is_binary(ID), ID =/= <<>>];
        #{ <<"ids">> := IDs } when is_list(IDs) -> [ID || ID <- IDs, is_binary(ID), ID =/= <<>>];
        _ -> []
    catch _:_ ->
        []
    end;
decode_list_index(_Raw) ->
    [].

list_index_path(Type, Value) ->
    <<"odysee/upload/list/", Type/binary, "/", (hb_util:encode(hb_crypto:sha256(Value)))/binary>>.

upload_list_ids(Params, Opts) ->
    Store = hb_opts:get(store, [], Opts),
    case Store of
        [] ->
            [];
        _ ->
            ChannelIDs =
                list_value(
                    first_field(
                        [
                            <<"channel_ids">>,
                            <<"channel-ids">>,
                            <<"channel_id">>,
                            <<"channel-id">>
                        ],
                        Params,
                        Opts
                    )
                ),
            Owners =
                list_value(
                    first_field(
                        [<<"owner">>, <<"owners">>, <<"hyperbeam-owner">>, <<"hyperbeam_owner">>],
                        Params,
                        Opts
                    )
                ),
            Paths =
                case {ChannelIDs, Owners} of
                    {[_ | _], _} -> [list_index_path(<<"channel">>, ID) || ID <- ChannelIDs, is_binary(ID)];
                    {_, [_ | _]} -> [list_index_path(<<"owner">>, Owner) || Owner <- Owners, is_binary(Owner)];
                    _ -> [list_index_path(<<"all">>, <<"all">>)]
                end,
            dedupe_binaries(lists:flatmap(fun(Path) -> read_list_index(Store, Path, Opts) end, Paths))
    end.

upload_claims_from_ids(IDs, Opts) ->
    lists:filtermap(
        fun(ID) ->
            case hb_cache:read(ID, Opts) of
                {ok, Record0} when is_map(Record0) ->
                    Record = enrich_record(ID, hb_cache:ensure_all_loaded(Record0, Opts), Opts),
                    case hb_maps:get(<<"claim">>, Record, not_found, Opts) of
                        Claim when is_map(Claim) -> {true, Claim};
                        _ -> false
                    end;
                _ -> false
            end
        end,
        IDs
    ).

filter_claims(Claims, Params, Opts) ->
    lists:filter(fun(Claim) -> claim_matches(Claim, Params, Opts) end, Claims).

claim_matches(Claim, Params, Opts) ->
    claim_type_matches(Claim, Params, Opts)
        andalso claim_ids_match(Claim, Params, Opts)
        andalso name_matches(Claim, Params, Opts)
        andalso channel_matches(Claim, Params, Opts)
        andalso tags_match(Claim, Params, Opts).

claim_type_matches(Claim, Params, Opts) ->
    Types = list_value(first_field([<<"claim_type">>, <<"claim-type">>, <<"type">>], Params, Opts)),
    Types =:= []
        orelse lists:member(hb_maps:get(<<"value_type">>, Claim, not_found, Opts), Types)
        orelse lists:member(hb_maps:get(<<"value-type">>, Claim, not_found, Opts), Types).

claim_ids_match(Claim, Params, Opts) ->
    IDs =
        list_value(
            first_field(
                [<<"claim_ids">>, <<"claim-ids">>, <<"claim_id">>, <<"claim-id">>, <<"txid">>],
                Params,
                Opts
            )
        ),
    IDs =:= []
        orelse lists:any(
            fun(ID) ->
                ID =:= hb_maps:get(<<"claim_id">>, Claim, not_found, Opts)
                    orelse ID =:= hb_maps:get(<<"claim-id">>, Claim, not_found, Opts)
            end,
            IDs
        ).

name_matches(Claim, Params, Opts) ->
    Names = list_value(first_field([<<"name">>, <<"claim-name">>, <<"claim_name">>], Params, Opts)),
    Names =:= [] orelse lists:member(hb_maps:get(<<"name">>, Claim, not_found, Opts), Names).

channel_matches(Claim, Params, Opts) ->
    ChannelIDs =
        list_value(
            first_field(
                [<<"channel_ids">>, <<"channel-ids">>, <<"channel_id">>, <<"channel-id">>],
                Params,
                Opts
            )
        ),
    SigningChannel = hb_maps:get(<<"signing_channel">>, Claim, #{}, Opts),
    ChannelID = first_field([<<"claim_id">>, <<"claim-id">>, <<"id">>], SigningChannel, Opts),
    ChannelIDs =:= [] orelse lists:member(ChannelID, ChannelIDs).

tags_match(Claim, Params, Opts) ->
    Value = hb_maps:get(<<"value">>, Claim, #{}, Opts),
    Tags = list_value(hb_maps:get(<<"tags">>, Value, [], Opts)),
    AnyTags = list_value(first_field([<<"any_tags">>, <<"any-tags">>], Params, Opts)),
    NotTags = list_value(first_field([<<"not_tags">>, <<"not-tags">>], Params, Opts)),
    (AnyTags =:= [] orelse lists:any(fun(Tag) -> lists:member(Tag, Tags) end, AnyTags))
        andalso not lists:any(fun(Tag) -> lists:member(Tag, Tags) end, NotTags).

sort_claims(Claims, Params, Opts) ->
    OrderBy = list_value(first_field([<<"order_by">>, <<"order-by">>], Params, Opts)),
    case OrderBy =:= [] orelse lists:member(<<"release_time">>, OrderBy) of
        true ->
            lists:sort(fun(A, B) -> claim_time(A, Opts) >= claim_time(B, Opts) end, Claims);
        false ->
            Claims
    end.

claim_time(Claim, Opts) ->
    Value = hb_maps:get(<<"value">>, Claim, #{}, Opts),
    case hb_maps:get(<<"release_time">>, Value, not_found, Opts) of
        ReleaseInt when is_integer(ReleaseInt) -> ReleaseInt;
        ReleaseBin when is_binary(ReleaseBin) ->
            try binary_to_integer(ReleaseBin)
            catch _:_ -> 0
            end;
        _ ->
            case hb_maps:get(<<"timestamp">>, Claim, 0, Opts) of
                TimestampInt when is_integer(TimestampInt) -> TimestampInt;
                TimestampBin when is_binary(TimestampBin) ->
                    try binary_to_integer(TimestampBin)
                    catch _:_ -> 0
                    end;
                _ -> 0
            end
    end.

page_items(Items, Page, PageSize) ->
    Offset = (Page - 1) * PageSize,
    case Offset >= length(Items) of
        true -> [];
        false -> lists:sublist(lists:nthtail(Offset, Items), PageSize)
    end.

list_response(Items, Total, Page, PageSize) ->
    TotalPages = max(1, ceil_div(Total, PageSize)),
    Result = #{
        <<"items">> => Items,
        <<"page">> => Page,
        <<"page_size">> => PageSize,
        <<"total_items">> => Total,
        <<"total_pages">> => TotalPages
    },
    Msg = (cors_headers())#{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"result">> => Result,
        <<"items">> => Items,
        <<"page">> => Page,
        <<"page_size">> => PageSize,
        <<"total_items">> => Total,
        <<"total_pages">> => TotalPages
    },
    Msg#{ <<"body">> => hb_json:encode(Msg) }.

response(Record, Opts) ->
    Claim = hb_maps:get(<<"claim">>, Record, #{}, Opts),
    DataID = hb_maps:get(<<"data-id">>, Record, Opts),
    Msg = (cors_headers())#{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"id">> => hb_maps:get(<<"record-id">>, Record, Opts),
        <<"record-id">> => hb_maps:get(<<"record-id">>, Record, Opts),
        <<"data-id">> => DataID,
        <<"media-path">> => generic_read_path(DataID),
        <<"record">> => Record,
        <<"claim">> => Claim,
        <<"outputs">> => [Claim],
        <<"result">> => #{ <<"outputs">> => [Claim] }
    },
    Msg#{ <<"body">> => hb_json:encode(Msg) }.

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

required_first(Keys, Map, Opts) ->
    case first_field(Keys, Map, Opts) of
        not_found -> {error, {missing_required_param, hd(Keys)}};
        <<>> -> {error, {missing_required_param, hd(Keys)}};
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

integer_value(not_found, Default) ->
    Default;
integer_value(Int, _Default) when is_integer(Int), Int >= 0 ->
    Int;
integer_value(Bin, Default) when is_binary(Bin) ->
    try
        Int = binary_to_integer(Bin),
        case Int >= 0 of
            true -> Int;
            false -> Default
        end
    catch _:_ ->
        Default
    end;
integer_value(_Value, Default) ->
    Default.

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

generic_read_path(ID) ->
    <<"/", ID/binary>>.

thumbnail_value(not_found) ->
    #{};
thumbnail_value(#{ <<"url">> := _ } = Thumbnail) ->
    Thumbnail;
thumbnail_value(URL) when is_binary(URL) ->
    #{ <<"url">> => URL };
thumbnail_value(_Value) ->
    #{}.

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

value_or(not_found, Default) -> Default;
value_or(undefined, Default) -> Default;
value_or(<<>>, Default) -> Default;
value_or(null, Default) -> Default;
value_or(Value, _Default) -> Value.

put_optional({_Key, not_found}, Msg) ->
    Msg;
put_optional({_Key, undefined}, Msg) ->
    Msg;
put_optional({_Key, <<>>}, Msg) ->
    Msg;
put_optional({Key, Value}, Msg) ->
    Msg#{ Key => Value }.

dedupe_binaries(Values) ->
    {Items, _Seen} =
        lists:foldl(
            fun(Value, {Acc, Seen}) ->
                case is_binary(Value) andalso Value =/= <<>> andalso not lists:member(Value, Seen) of
                    true -> {[Value | Acc], [Value | Seen]};
                    false -> {Acc, Seen}
                end
            end,
            {[], []},
            Values
        ),
    lists:reverse(Items).

ceil_div(0, _Denom) ->
    0;
ceil_div(Value, Denom) ->
    (Value + Denom - 1) div Denom.

without_control_keys(Msg) ->
    Control = control_keys(),
    maps:filter(
        fun(Key, _Value) -> not lists:member(lower_key(Key), Control) end,
        Msg
    ).

control_keys() ->
    [
        <<"!">>,
        <<"accept">>,
        <<"authorization">>,
        <<"body">>,
        <<"connection">>,
        <<"cookie">>,
        <<"device">>,
        <<"host">>,
        <<"method">>,
        <<"origin">>,
        <<"params64">>,
        <<"params-64">>,
        <<"path">>,
        <<"priv">>,
        <<"referer">>,
        <<"user-agent">>
    ].

lower_key(Key) when is_binary(Key) ->
    hb_util:to_lower(Key);
lower_key(Key) ->
    hb_util:to_lower(hb_ao:normalize_key(Key)).

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

map_or_empty(Map) when is_map(Map) ->
    Map;
map_or_empty(_Value) ->
    #{}.

-ifdef(TEST).

index_upload_requires_signed_request_test() ->
    Opts = test_opts(),
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        upload(#{}, #{ <<"data-id">> => <<"data/demo">> }, Opts)
    ).

index_upload_writes_store_backed_lookup_and_lists_test() ->
    Opts = test_opts(),
    {ok, DataID} = hb_cache:write(<<"hello">>, Opts),
    Req = signed(#{
        <<"data-id">> => DataID,
        <<"name">> => <<"indexed-demo">>,
        <<"content-type">> => <<"text/plain">>,
        <<"size">> => 5,
        <<"metadata">> => #{
            <<"title">> => <<"Indexed Demo">>,
            <<"release_time">> => 200,
            <<"channel">> => #{
                <<"claim_id">> => <<"channel-1">>,
                <<"name">> => <<"@indexed">>,
                <<"short_url">> => <<"lbry://@indexed#channel-1">>
            }
        }
    }, Opts),
    {ok, Res} = upload(#{}, Req, Opts),
    RecordID = hb_maps:get(<<"record-id">>, Res, Opts),
    ?assertNotEqual(DataID, RecordID),
    {ok, All} = list(#{}, #{ <<"page_size">> => 10 }, Opts),
    [AllItem] = hb_maps:get(<<"items">>, hb_json:decode(hb_maps:get(<<"body">>, All, Opts)), Opts),
    ?assertEqual(RecordID, hb_maps:get(<<"claim_id">>, AllItem, Opts)),
    ?assertEqual(<<"/", DataID/binary>>, hb_maps:get(<<"streaming_url">>, AllItem, Opts)),
    {ok, ChannelList} = list(#{}, #{ <<"channel_ids">> => [<<"channel-1">>] }, Opts),
    [ChannelItem] = hb_maps:get(<<"items">>, hb_json:decode(hb_maps:get(<<"body">>, ChannelList, Opts)), Opts),
    ?assertEqual(RecordID, hb_maps:get(<<"claim_id">>, ChannelItem, Opts)),
    {ok, IndexedRecordID} =
        hb_store:read(
            hb_opts:get(store, [], Opts),
            index_path(<<"uri">>, <<"lbry://@indexed#channel-1/indexed-demo">>),
            Opts
        ),
    ?assertEqual(RecordID, IndexedRecordID).

signed(Msg, Opts) ->
    hb_message:commit(Msg, Opts#{ <<"priv-wallet">> => ar_wallet:new() }).

test_opts() ->
    Timestamp = integer_to_binary(erlang:unique_integer([positive, monotonic])),
    Store = #{
        <<"store-module">> => hb_store_fs,
        <<"name">> => <<"_build/odysee-index-test-", Timestamp/binary>>
    },
    ok = hb_store:start(Store),
    ok = hb_store:reset(Store),
    #{
        <<"store">> => Store,
        <<"cache-control">> => [<<"no-cache">>, <<"no-store">>],
        <<"store-all-signed">> => false
    }.

-endif.
