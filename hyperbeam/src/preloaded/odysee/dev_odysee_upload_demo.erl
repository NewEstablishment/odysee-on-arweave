-module(dev_odysee_upload_demo).
-implements(<<"odysee-upload-demo@1.0">>).
-export([info/1, upload/3, read/3, metadata/3, channel/3, channel_claim_items/2, user_claim_items/2]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-upload-demo@1.0">>).

info(_Opts) ->
    #{
        exports => [
            <<"upload">>,
            <<"read">>,
            <<"metadata">>,
            <<"channel">>
        ]
    }.

upload(_Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            maybe
                ok ?= reject_raw_credentials(Req, Opts),
                {ok, Body} ?= request_body(Req, Opts),
                {ok, LegacyUserID} ?= legacy_user_id(Req, Opts),
                {ok, Signers} ?= request_signers(Req, Opts),
                {ok, BodyPath} ?= hb_cache:write(Body, Opts),
                UploadReq = maps:merge(
                    upload_metadata(Req, Opts),
                    Req#{ <<"upload-timestamp">> => erlang:system_time(second) }
                ),
                {ok, RequestID} ?= hb_cache:write(UploadReq, Opts),
                SignedID = hb_message:id(Req, all, Opts),
                Upload = upload_record(RequestID, SignedID, BodyPath, Body, LegacyUserID, Signers, UploadReq, Opts),
                ok ?= index_upload(RequestID, Upload, LegacyUserID, Opts),
                {ok, upload_response(Upload)}
            else
                {error, _} = Error -> Error
            end
    end.

read(_Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            maybe
                {ok, ID} ?= requested_id(Req, Opts),
                {ok, Stored} ?= stored_upload(ID, Opts),
                loaded_read_response(Stored, Req, Opts)
            else
                {error, _} = Error -> Error
            end
    end.

metadata(_Base, Req, Opts) ->
            maybe
                {ok, ID} ?= requested_id(Req, Opts),
                {ok, Stored} ?= stored_upload(ID, Opts),
                metadata_response(ID, Stored, Opts)
    else
        {error, _} = Error -> Error
    end.

channel(_Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            maybe
                {ok, ChannelID} ?= channel_id(Req, Opts),
                {ok, Uploads} ?= channel_uploads(ChannelID, Opts),
                {ok, channel_response(ChannelID, legacy_claim_ids(Req, Opts), Uploads, Opts)}
            else
                {error, _} = Error -> Error
            end
    end.

request_body(Req, Opts) ->
    case hb_maps:get(<<"body">>, Req, not_found, Opts) of
        Body when is_binary(Body) -> {ok, Body};
        not_found -> error_response(400, <<"upload_body_missing">>, <<"No upload body was provided.">>);
        _ -> error_response(400, <<"upload_body_not_binary">>, <<"Upload body must be binary bytes.">>)
    end.

legacy_user_id(Req, Opts) ->
    case hb_maps:get(<<"legacy-user-id">>, Req, not_found, Opts) of
        not_found ->
            error_response(
                401,
                <<"legacy_auth_required">>,
                <<"Run this endpoint through auth-hook@1.0 with odysee-legacy-auth@1.0.">>
            );
        UserID ->
            {ok, hb_util:bin(UserID)}
    end.

request_signers(Req, Opts) ->
    case hb_message:signers(Req, Opts) of
        [] ->
            error_response(
                401,
                <<"signed_request_required">>,
                <<"The upload request must be signed by the HyperBEAM auth hook.">>
            );
        Signers ->
            {ok, Signers}
    end.

reject_raw_credentials(Req, Opts) ->
    case first_key(raw_credential_keys(), Req, Opts) of
        not_found ->
            ok;
        Key ->
            error_response(
                400,
                <<"raw_credential_rejected">>,
                <<"Raw auth credentials must be consumed by auth-hook before upload demo storage.">>,
                #{ <<"key">> => Key }
            )
    end.

raw_credential_keys() ->
    [
        <<"auth_token">>,
        <<"auth-token">>,
        <<"x-lbry-auth-token">>,
        <<"X-Lbry-Auth-Token">>,
        <<"authorization">>,
        <<"cookie">>
    ].

first_key([], _Req, _Opts) ->
    not_found;
first_key([Key | Rest], Req, Opts) ->
    case hb_maps:get(Key, Req, not_found, Opts) of
        not_found -> first_key(Rest, Req, Opts);
        _ -> Key
    end.

upload_record(RequestID, SignedID, BodyPath, Body, LegacyUserID, Signers, Req, Opts) ->
    put_optional_pairs(#{
        <<"ok">> => true,
        <<"kind">> => <<"hyperbeam-upload">>,
        <<"id">> => RequestID,
        <<"upload-id">> => RequestID,
        <<"hyperbeam-upload-id">> => RequestID,
        <<"signed-id">> => SignedID,
        <<"body-path">> => BodyPath,
        <<"legacy-user-id">> => LegacyUserID,
        <<"signers">> => format_signers(Signers),
        <<"filename">> => filename(Req, Opts),
        <<"content-type">> => content_type(Req, Opts),
        <<"size">> => byte_size(Body),
        <<"sha256">> => hb_util:to_hex(crypto:hash(sha256, Body))
    }, upload_optional_fields(Req, Opts)).

upload_response(Upload) ->
    JSON = hb_json:encode(Upload),
    (cors_headers())#{
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"content-length">> => byte_size(JSON),
        <<"body">> => JSON
    }.

stored_upload(ID, Opts) ->
    case read_upload_record(upload_path(ID), Opts) of
        {ok, _Upload} = Found ->
            Found;
        _ ->
            case read_upload_record(ID, Opts) of
                {ok, _Upload} = Found -> Found;
                _ -> error_response(404, <<"upload_not_found">>, <<"Stored upload metadata was not found.">>)
            end
    end.

read_upload_record(Path, Opts) ->
    case hb_cache:read(Path, Opts) of
        {ok, Stored} -> decode_upload_record(hb_cache:ensure_all_loaded(Stored, Opts));
        Error -> Error
    end.

decode_upload_record(Stored) when is_map(Stored) ->
    {ok, Stored};
decode_upload_record(Stored) when is_binary(Stored) ->
    case try_decode_upload_record(Stored) of
        {ok, Upload} -> {ok, Upload};
        _ -> {ok, Stored}
    end;
decode_upload_record(Stored) ->
    {ok, Stored}.

try_decode_upload_record(Stored) ->
    try hb_json:decode(Stored) of
        Upload when is_map(Upload) -> {ok, Upload};
        _ -> not_found
    catch
        _:_ -> not_found
    end.

loaded_read_response(Upload, _Req, Opts) when is_map(Upload) ->
    BodyPath = hb_maps:get(<<"body-path">>, Upload, not_found, Opts),
    case BodyPath of
        not_found ->
            error_response(404, <<"upload_body_not_found">>, <<"Stored upload body path was not found.">>);
        _ ->
            case hb_cache:read(BodyPath, Opts) of
                {ok, Body} ->
                    loaded_read_response(hb_cache:ensure_all_loaded(Body, Opts), Upload, Opts);
                _ ->
                    error_response(404, <<"upload_body_not_found">>, <<"Stored upload body was not found.">>)
            end
    end;
loaded_read_response(Body, Req, Opts) when is_binary(Body) ->
    {ok, (cors_headers())#{
        <<"status">> => 200,
        <<"content-type">> => content_type(Req, Opts),
        <<"content-length">> => byte_size(Body),
        <<"body">> => Body
    }};
loaded_read_response(Msg, _Req, Opts) when is_map(Msg) ->
    Body = hb_maps:get(<<"body">>, Msg, <<>>, Opts),
    {ok, (cors_headers())#{
        <<"status">> => 200,
        <<"content-type">> => content_type(Msg, Opts),
        <<"content-length">> => byte_size(Body),
        <<"x-odysee-upload-demo-id">> => hb_message:id(Msg, all, Opts),
        <<"x-odysee-upload-demo-signers">> => iolist_to_binary(lists:join(<<",">>, format_signers(hb_message:signers(Msg, Opts)))),
        <<"body">> => Body
    }};
loaded_read_response(_Other, _Req, _Opts) ->
    error_response(404, <<"upload_not_found">>, <<"Stored upload body was not found.">>).

metadata_response(ID, Body, _Opts) when is_binary(Body) ->
    JSON = hb_json:encode(#{
        <<"ok">> => true,
        <<"id">> => ID,
        <<"body-path">> => ID,
        <<"size">> => byte_size(Body),
        <<"sha256">> => hb_util:to_hex(crypto:hash(sha256, Body))
    }),
    {ok, (cors_headers())#{
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"content-length">> => byte_size(JSON),
        <<"body">> => JSON
    }};
metadata_response(ID, Msg, Opts) when is_map(Msg) ->
    Body = hb_maps:get(<<"body">>, Msg, <<>>, Opts),
    UploadID = hb_maps:get(<<"upload-id">>, Msg, ID, Opts),
    JSON = hb_json:encode(put_optional_pairs(#{
        <<"ok">> => true,
        <<"kind">> => <<"hyperbeam-upload">>,
        <<"id">> => ID,
        <<"upload-id">> => UploadID,
        <<"hyperbeam-upload-id">> => hb_maps:get(<<"hyperbeam-upload-id">>, Msg, UploadID, Opts),
        <<"legacy-user-id">> => hb_maps:get(<<"legacy-user-id">>, Msg, <<>>, Opts),
        <<"signers">> => upload_signers(Msg, Opts),
        <<"filename">> => filename(Msg, Opts),
        <<"content-type">> => content_type(Msg, Opts),
        <<"size">> => upload_size(Msg, Body, Opts),
        <<"sha256">> => upload_sha256(Msg, Body, Opts),
        <<"body-path">> => upload_body_path(Msg, Body, Opts)
    }, upload_optional_fields(Msg, Opts))),
    {ok, (cors_headers())#{
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"content-length">> => byte_size(JSON),
        <<"body">> => JSON
    }};
metadata_response(_ID, _Other, _Opts) ->
    error_response(404, <<"upload_not_found">>, <<"Stored upload metadata was not found.">>).

upload_size(Msg, Body, Opts) ->
    case hb_maps:get(<<"size">>, Msg, not_found, Opts) of
        not_found -> byte_size(Body);
        Size -> Size
    end.

upload_sha256(Msg, Body, Opts) ->
    case hb_maps:get(<<"sha256">>, Msg, not_found, Opts) of
        not_found -> hb_util:to_hex(crypto:hash(sha256, Body));
        Sha -> Sha
    end.

upload_body_path(Msg, Body, Opts) ->
    case hb_maps:get(<<"body-path">>, Msg, not_found, Opts) of
        not_found -> body_path(Body, Opts);
        BodyPath -> BodyPath
    end.

upload_signers(Msg, Opts) ->
    case hb_maps:get(<<"signers">>, Msg, not_found, Opts) of
        not_found -> format_signers(hb_message:signers(Msg, Opts));
        Signers -> Signers
    end.

requested_id(Req, Opts) ->
    case first_value([<<"id">>, <<"upload-id">>, <<"body-path">>, <<"read">>], Req, Opts) of
        not_found -> error_response(400, <<"upload_id_missing">>, <<"No upload id was provided.">>);
        ID -> {ok, hb_util:bin(ID)}
    end.

first_value([], _Req, _Opts) ->
    not_found;
first_value([Key | Rest], Req, Opts) ->
    case hb_maps:get(Key, Req, not_found, Opts) of
        not_found -> first_value(Rest, Req, Opts);
        Value -> Value
    end.

upload_metadata(Req, Opts) ->
    case first_value([<<"metadata64">>, <<"metadata-64">>, <<"upload-metadata64">>], Req, Opts) of
        not_found -> #{};
        Encoded -> decoded_metadata64(Encoded)
    end.

decoded_metadata64(Encoded) ->
    try hb_json:decode(hb_util:decode(hb_util:bin(Encoded))) of
        Metadata when is_map(Metadata) -> allowed_upload_metadata(Metadata);
        _ -> #{}
    catch
        _:_ -> #{}
    end.

allowed_upload_metadata(Metadata) ->
    lists:foldl(
        fun(Key, Acc) ->
            case maps:get(Key, Metadata, not_found) of
                not_found -> Acc;
                Value -> Acc#{ Key => Value }
            end
        end,
        #{},
        [
            <<"filename">>,
            <<"file-name">>,
            <<"content-type">>,
            <<"file-type">>,
            <<"mime-type">>,
            <<"channel-id">>,
            <<"channel_id">>,
            <<"channel-claim-id">>,
            <<"channel_claim_id">>,
            <<"channel-name">>,
            <<"channel_name">>,
            <<"claim-name">>,
            <<"claim_name">>,
            <<"name">>,
            <<"title">>,
            <<"description">>,
            <<"tags">>,
            <<"tag">>,
            <<"thumbnail-url">>,
            <<"thumbnail_url">>
        ]
    ).

channel_id(Req, Opts) ->
    case first_value([<<"channel-id">>, <<"channel_id">>, <<"channel-claim-id">>, <<"channel_claim_id">>], Req, Opts) of
        not_found -> error_response(400, <<"channel_id_missing">>, <<"No channel id was provided.">>);
        ChannelID -> path_id(ChannelID, <<"invalid_channel_id">>)
    end.

maybe_channel_id(Req, Opts) ->
    case first_value([<<"channel-id">>, <<"channel_id">>, <<"channel-claim-id">>, <<"channel_claim_id">>], Req, Opts) of
        not_found -> not_found;
        ChannelID ->
            case path_id(ChannelID, <<"invalid_channel_id">>) of
                {ok, SafeChannelID} -> SafeChannelID;
                {error, _} -> not_found
            end
    end.

path_id(Value, Reason) ->
    Bin = hb_util:bin(Value),
    case Bin =/= <<>> andalso binary:match(Bin, <<"/">>) =:= nomatch of
        true -> {ok, Bin};
        false -> error_response(400, Reason, <<"IDs used in upload demo store paths cannot be empty or contain slash.">>)
    end.

filename(Req, Opts) ->
    case first_value([<<"filename">>, <<"file-name">>, <<"name">>], Req, Opts) of
        not_found -> <<"hyperbeam-upload-demo.bin">>;
        Value -> hb_util:bin(Value)
    end.

content_type(Req, Opts) ->
    case first_value([<<"content-type">>, <<"file-type">>, <<"mime-type">>], Req, Opts) of
        not_found -> <<"application/octet-stream">>;
        Value -> hb_util:bin(Value)
    end.

upload_optional_fields(Req, Opts) ->
    [
        {<<"channel-id">>, maybe_channel_id(Req, Opts)},
        {<<"channel-name">>, first_value([<<"channel-name">>, <<"channel_name">>], Req, Opts)},
        {<<"title">>, first_value([<<"title">>], Req, Opts)},
        {<<"description">>, first_value([<<"description">>], Req, Opts)},
        {<<"tags">>, tags(Req, Opts)},
        {<<"claim-name">>, first_value([<<"claim-name">>, <<"claim_name">>, <<"name">>], Req, Opts)},
        {<<"thumbnail-url">>, first_value([<<"thumbnail-url">>, <<"thumbnail_url">>], Req, Opts)},
        {<<"upload-timestamp">>, hb_maps:get(<<"upload-timestamp">>, Req, not_found, Opts)}
    ].

tags(Req, Opts) ->
    case first_value([<<"tags">>, <<"tag">>], Req, Opts) of
        not_found ->
            not_found;
        Value ->
            tag_list(Value)
    end.

tag_list(Values) when is_list(Values) ->
    [hb_util:bin(Value) || Value <- Values, hb_util:bin(Value) =/= <<>>];
tag_list(Value) when is_binary(Value) ->
    [trim(Part) || Part <- binary:split(Value, <<",">>, [global]), trim(Part) =/= <<>>];
tag_list(Value) ->
    [hb_util:bin(Value)].

put_optional_pairs(Msg, []) ->
    Msg;
put_optional_pairs(Msg, [{_Key, not_found} | Rest]) ->
    put_optional_pairs(Msg, Rest);
put_optional_pairs(Msg, [{_Key, <<>>} | Rest]) ->
    put_optional_pairs(Msg, Rest);
put_optional_pairs(Msg, [{Key, Value} | Rest]) ->
    put_optional_pairs(Msg#{ Key => optional_value(Value) }, Rest).

optional_value(Value) when is_binary(Value); is_list(Value); is_map(Value); is_integer(Value); is_boolean(Value) ->
    Value;
optional_value(Value) ->
    hb_util:bin(Value).

index_upload(UploadID, Upload, LegacyUserID, Opts) ->
    JSON = hb_json:encode(Upload),
    UserUploadIDs = lists:usort([UploadID | upload_id_index(user_upload_index_path(LegacyUserID), Opts)]),
    Paths0 = #{
        upload_path(UploadID) => JSON,
        user_upload_path(LegacyUserID, UploadID) => JSON,
        user_upload_index_path(LegacyUserID) => hb_json:encode(UserUploadIDs)
    },
    Paths =
        case maybe_channel_id(Upload, Opts) of
            not_found -> Paths0;
            ChannelID ->
                ChannelUploadIDs = lists:usort([UploadID | upload_id_index(channel_upload_index_path(ChannelID), Opts)]),
                Paths0#{
                    channel_upload_path(ChannelID, UploadID) => JSON,
                    channel_upload_index_path(ChannelID) => hb_json:encode(ChannelUploadIDs)
                }
        end,
    hb_store:write(hb_opts:get(store, no_viable_store, Opts), Paths, Opts).

channel_uploads(ChannelID, Opts) ->
    IDs = lists:usort(
        upload_id_index(channel_upload_index_path(ChannelID), Opts)
            ++ hb_cache:list(channel_upload_root(ChannelID), Opts)
            ++ all_upload_ids(Opts)
    ),
    {ok,
        lists:filtermap(
            fun(UploadID) ->
                case upload_for_channel(ChannelID, UploadID, Opts) of
                    {ok, Upload} when is_map(Upload) ->
                        {true, upload_summary(UploadID, Upload, Opts)};
                    _ ->
                        false
                end
            end,
            IDs
        )
    }.

channel_claim_items(ChannelID, Opts) ->
    SafeChannelID =
        case path_id(ChannelID, <<"invalid_channel_id">>) of
            {ok, ID} -> ID;
            {error, _} -> not_found
        end,
    case SafeChannelID of
        not_found ->
            [];
        SafeID ->
            case channel_uploads(SafeID, Opts) of
                {ok, Uploads} ->
                    [upload_claim_item(Upload, Opts) || Upload <- Uploads];
                _ ->
                    []
            end
    end.

user_claim_items(LegacyUserID, Opts) ->
    SafeUserID =
        case path_id(LegacyUserID, <<"invalid_legacy_user_id">>) of
            {ok, ID} -> ID;
            {error, _} -> not_found
        end,
    case SafeUserID of
        not_found ->
            [];
        SafeID ->
            case user_uploads(SafeID, Opts) of
                {ok, Uploads} ->
                    [upload_claim_item(Upload, Opts) || Upload <- Uploads];
                _ ->
                    []
            end
    end.

channel_response(ChannelID, LegacyClaimIDs, Uploads, Opts) ->
    UploadIDs = [hb_maps:get(<<"upload-id">>, Upload, <<>>, Opts) || Upload <- Uploads],
    JSON = hb_json:encode(#{
        <<"ok">> => true,
        <<"channel-id">> => ChannelID,
        <<"legacy-claim-ids">> => LegacyClaimIDs,
        <<"hyperbeam-upload-ids">> => UploadIDs,
        <<"content-ids">> => content_ids(LegacyClaimIDs, UploadIDs),
        <<"uploads">> => Uploads
    }),
    (cors_headers())#{
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"content-length">> => byte_size(JSON),
        <<"body">> => JSON
    }.

upload_summary(UploadID, Upload, Opts) ->
    Body = hb_maps:get(<<"body">>, Upload, <<>>, Opts),
    put_optional_pairs(#{
        <<"kind">> => <<"hyperbeam-upload">>,
        <<"id">> => UploadID,
        <<"upload-id">> => UploadID,
        <<"hyperbeam-upload-id">> => UploadID,
        <<"body-path">> => upload_body_path(Upload, Body, Opts),
        <<"legacy-user-id">> => hb_maps:get(<<"legacy-user-id">>, Upload, <<>>, Opts),
        <<"signers">> => upload_signers(Upload, Opts),
        <<"filename">> => filename(Upload, Opts),
        <<"content-type">> => content_type(Upload, Opts),
        <<"size">> => upload_size(Upload, Body, Opts),
        <<"sha256">> => upload_sha256(Upload, Body, Opts)
    }, upload_optional_fields(Upload, Opts)).

body_path(Body, Opts) when is_binary(Body) ->
    <<"data/", (hb_path:hashpath(Body, Opts))/binary>>;
body_path(_Body, _Opts) ->
    not_found.

upload_claim_item(Upload, Opts) ->
    UploadID = hb_maps:get(<<"upload-id">>, Upload, <<>>, Opts),
    ClaimName = claim_name(Upload, Opts),
    ContentType = hb_maps:get(<<"content-type">>, Upload, <<"application/octet-stream">>, Opts),
    CanonicalURL = canonical_upload_url(Upload, ClaimName, Opts),
    Source = #{
        <<"media_type">> => ContentType,
        <<"name">> => hb_maps:get(<<"filename">>, Upload, <<"hyperbeam-upload-demo.bin">>, Opts),
        <<"size">> => hb_maps:get(<<"size">>, Upload, 0, Opts),
        <<"sha256">> => hb_maps:get(<<"sha256">>, Upload, <<>>, Opts),
        <<"hyperbeam_upload_id">> => UploadID,
        <<"hyperbeam_body_path">> => hb_maps:get(<<"body-path">>, Upload, <<>>, Opts)
    },
    Value =
        put_optional_pairs(#{
            <<"title">> => title(Upload, ClaimName, Opts),
            <<"source">> => Source,
            <<"stream_type">> => stream_type(ContentType)
        }, [
            {<<"description">>, hb_maps:get(<<"description">>, Upload, not_found, Opts)},
            {<<"tags">>, hb_maps:get(<<"tags">>, Upload, not_found, Opts)},
            {<<"thumbnail">>, thumbnail(Upload, Opts)}
        ]),
    put_optional_pairs(#{
        <<"claim_id">> => UploadID,
        <<"name">> => ClaimName,
        <<"normalized_name">> => ClaimName,
        <<"type">> => <<"claim">>,
        <<"claim_op">> => <<"create">>,
        <<"value_type">> => <<"stream">>,
        <<"canonical_url">> => CanonicalURL,
        <<"permanent_url">> => CanonicalURL,
        <<"short_url">> => CanonicalURL,
        <<"value">> => Value,
        <<"meta">> => #{ <<"effective_amount">> => <<"0">> },
        <<"address">> => <<>>,
        <<"amount">> => <<"0.0">>,
        <<"height">> => 0,
        <<"confirmations">> => 0,
        <<"timestamp">> => hb_maps:get(<<"upload-timestamp">>, Upload, erlang:system_time(second), Opts),
        <<"txid">> => UploadID,
        <<"nout">> => 0,
        <<"is_my_output">> => true,
        <<"hyperbeam_upload_id">> => UploadID,
        <<"is_hyperbeam_upload">> => true,
        <<"is_channel_signature_valid">> => upload_has_channel(Upload, Opts)
    }, [
        {<<"signing_channel">>, signing_channel(Upload, Opts)}
    ]).

claim_name(Upload, Opts) ->
    case first_value([<<"claim-name">>, <<"claim_name">>, <<"name">>, <<"title">>, <<"filename">>], Upload, Opts) of
        not_found -> <<"hyperbeam-upload">>;
        Value -> safe_name(hb_util:bin(Value))
    end.

title(Upload, ClaimName, Opts) ->
    case hb_maps:get(<<"title">>, Upload, not_found, Opts) of
        not_found -> ClaimName;
        Value -> hb_util:bin(Value)
    end.

thumbnail(Upload, Opts) ->
    case first_value([<<"thumbnail-url">>, <<"thumbnail_url">>], Upload, Opts) of
        not_found -> not_found;
        URL -> #{ <<"url">> => hb_util:bin(URL) }
    end.

stream_type(<<"video/", _/binary>>) ->
    <<"video">>;
stream_type(<<"audio/", _/binary>>) ->
    <<"audio">>;
stream_type(<<"image/", _/binary>>) ->
    <<"image">>;
stream_type(_ContentType) ->
    <<"binary">>.

signing_channel(Upload, Opts) ->
    case hb_maps:get(<<"channel-id">>, Upload, not_found, Opts) of
        not_found ->
            not_found;
        ChannelID ->
            ChannelIDBin = hb_util:bin(ChannelID),
            ChannelName = channel_name(Upload, Opts),
            ChannelURL = <<"lbry://", ChannelName/binary, "#", ChannelIDBin/binary>>,
            #{
                <<"claim_id">> => ChannelIDBin,
                <<"name">> => ChannelName,
                <<"normalized_name">> => ChannelName,
                <<"value_type">> => <<"channel">>,
                <<"canonical_url">> => ChannelURL,
                <<"permanent_url">> => ChannelURL,
                <<"short_url">> => ChannelURL,
                <<"value">> => #{ <<"title">> => ChannelName }
            }
    end.

upload_has_channel(Upload, Opts) ->
    first_value([<<"channel-id">>, <<"channel_id">>], Upload, Opts) =/= not_found.

canonical_upload_url(Upload, ClaimName, Opts) ->
    UploadID = hb_maps:get(<<"upload-id">>, Upload, <<>>, Opts),
    case hb_maps:get(<<"channel-id">>, Upload, not_found, Opts) of
        not_found ->
            <<"lbry://", ClaimName/binary, "#", UploadID/binary>>;
        ChannelID ->
            <<
                "lbry://",
                (channel_name(Upload, Opts))/binary,
                "#",
                (hb_util:bin(ChannelID))/binary,
                "/",
                ClaimName/binary,
                "#",
                UploadID/binary
            >>
    end.

channel_name(Upload, Opts) ->
    case hb_maps:get(<<"channel-name">>, Upload, not_found, Opts) of
        not_found -> <<"@hyperbeam">>;
        Name -> ensure_channel_name(hb_util:bin(Name))
    end.

ensure_channel_name(<<"@", _/binary>> = Name) ->
    safe_name(Name);
ensure_channel_name(Name) ->
    <<"@", (safe_name(Name))/binary>>.

safe_name(Bin) ->
    Trimmed = trim(Bin),
    Normalized = iolist_to_binary([safe_name_char(char_lower(C)) || C <- binary_to_list(Trimmed)]),
    case trim_hyphens(Normalized) of
        <<>> -> <<"hyperbeam-upload">>;
        Name -> Name
    end.

safe_name_char(C) when C >= $a, C =< $z ->
    C;
safe_name_char(C) when C >= $0, C =< $9 ->
    C;
safe_name_char($@) ->
    $@;
safe_name_char(_) ->
    $-.

char_lower(C) when C >= $A, C =< $Z ->
    C + 32;
char_lower(C) ->
    C.

trim_hyphens(<<"-", Rest/binary>>) ->
    trim_hyphens(Rest);
trim_hyphens(Bin) when byte_size(Bin) > 0 ->
    Size = byte_size(Bin),
    case binary:last(Bin) of
        $- -> trim_hyphens(binary:part(Bin, 0, Size - 1));
        _ -> Bin
    end;
trim_hyphens(Bin) ->
    Bin.

legacy_claim_ids(Req, Opts) ->
    case first_value([<<"legacy-claim-ids">>, <<"legacy_claim_ids">>, <<"claim-ids">>, <<"claim_ids">>], Req, Opts) of
        not_found -> [];
        Value -> id_list(Value)
    end.

id_list(Values) when is_list(Values) ->
    [hb_util:bin(Value) || Value <- Values, hb_util:bin(Value) =/= <<>>];
id_list(Value) when is_binary(Value) ->
    [trim(Part) || Part <- binary:split(Value, <<",">>, [global]), trim(Part) =/= <<>>];
id_list(Value) ->
    [hb_util:bin(Value)].

trim(Bin) ->
    iolist_to_binary(string:trim(binary_to_list(Bin))).

content_ids(LegacyClaimIDs, UploadIDs) ->
    [#{ <<"type">> => <<"legacy-claim">>, <<"id">> => ID } || ID <- LegacyClaimIDs]
        ++ [#{ <<"type">> => <<"hyperbeam-upload">>, <<"id">> => ID } || ID <- UploadIDs].

upload_path(UploadID) ->
    <<"odysee/hyperbeam-upload/", UploadID/binary>>.

user_upload_path(LegacyUserID, UploadID) ->
    <<"odysee/hyperbeam-user/", LegacyUserID/binary, "/uploads/", UploadID/binary>>.

user_uploads(LegacyUserID, Opts) ->
    IDs = lists:usort(
        upload_id_index(user_upload_index_path(LegacyUserID), Opts)
            ++ hb_cache:list(user_upload_root(LegacyUserID), Opts)
            ++ all_upload_ids(Opts)
    ),
    {ok,
        lists:filtermap(
            fun(UploadID) ->
                case upload_for_user(LegacyUserID, UploadID, Opts) of
                    {ok, Upload} when is_map(Upload) ->
                        {true, upload_summary(UploadID, Upload, Opts)};
                    _ ->
                        false
                end
            end,
            IDs
        )
    }.

all_upload_ids(Opts) ->
    hb_cache:list(upload_root(), Opts).

upload_for_user(LegacyUserID, UploadID, Opts) ->
    case read_upload_record(user_upload_path(LegacyUserID, UploadID), Opts) of
        {ok, _Upload} = Found ->
            Found;
        _ ->
            case read_upload_record(upload_path(UploadID), Opts) of
                {ok, Upload} ->
                    case hb_maps:get(<<"legacy-user-id">>, Upload, not_found, Opts) of
                        LegacyUserID -> {ok, Upload};
                        _ -> not_found
                    end;
                Other ->
                    Other
            end
    end.

upload_for_channel(ChannelID, UploadID, Opts) ->
    case read_upload_record(channel_upload_path(ChannelID, UploadID), Opts) of
        {ok, _Upload} = Found ->
            Found;
        _ ->
            case read_upload_record(upload_path(UploadID), Opts) of
                {ok, Upload} ->
                    case maybe_channel_id(Upload, Opts) of
                        ChannelID -> {ok, Upload};
                        _ -> not_found
                    end;
                Other ->
                    Other
            end
    end.

upload_root() ->
    <<"odysee/hyperbeam-upload">>.

upload_id_index(Path, Opts) ->
    case hb_cache:read(Path, Opts) of
        {ok, Stored} -> decode_upload_id_index(hb_cache:ensure_all_loaded(Stored, Opts));
        _ -> []
    end.

decode_upload_id_index(Stored) when is_list(Stored) ->
    [hb_util:bin(ID) || ID <- Stored, hb_util:bin(ID) =/= <<>>];
decode_upload_id_index(Stored) when is_binary(Stored) ->
    try hb_json:decode(Stored) of
        IDs when is_list(IDs) -> decode_upload_id_index(IDs);
        _ -> []
    catch
        _:_ -> []
    end;
decode_upload_id_index(_Stored) ->
    [].

user_upload_root(LegacyUserID) ->
    <<"odysee/hyperbeam-user/", LegacyUserID/binary, "/uploads">>.

user_upload_index_path(LegacyUserID) ->
    <<"odysee/hyperbeam-user/", LegacyUserID/binary, "/upload-ids">>.

channel_upload_root(ChannelID) ->
    <<"odysee/hyperbeam-channel/", ChannelID/binary, "/uploads">>.

channel_upload_index_path(ChannelID) ->
    <<"odysee/hyperbeam-channel/", ChannelID/binary, "/upload-ids">>.

channel_upload_path(ChannelID, UploadID) ->
    <<(channel_upload_root(ChannelID))/binary, "/", UploadID/binary>>.

format_signers(Signers) ->
    [hb_util:human_id(Signer) || Signer <- Signers].

method(Req, Opts) ->
    hb_util:to_lower(hb_util:bin(hb_maps:get(<<"method">>, Req, <<"GET">>, Opts))).

error_response(Status, Reason, Message) ->
    error_response(Status, Reason, Message, #{}).

error_response(Status, Reason, Message, Extra) ->
    Body = hb_json:encode(Extra#{
        <<"ok">> => false,
        <<"reason">> => Reason,
        <<"message">> => Message
    }),
    {error, (cors_headers())#{
        <<"status">> => Status,
        <<"content-type">> => <<"application/json">>,
        <<"content-length">> => byte_size(Body),
        <<"body">> => Body
    }}.

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
        <<"access-control-allow-methods">> => <<"GET,POST,HEAD,OPTIONS">>,
        <<"access-control-allow-headers">> =>
            <<"Range,Content-Type,Accept,Authorization,X-Lbry-Auth-Token">>,
        <<"access-control-expose-headers">> =>
            <<"Content-Length,Content-Type,X-Odysee-Upload-Demo-Id,X-Odysee-Upload-Demo-Signers">>
    }.

upload_writes_signed_request_and_reads_body_test() ->
    Store = hb_test_utils:test_store(hb_store_volatile, <<"odysee-upload-demo">>),
    ok = hb_store:start(Store),
    Wallet = ar_wallet:new(),
    Signer = hb_util:human_id(ar_wallet:to_address(Wallet)),
    Opts = #{ <<"store">> => Store, <<"priv-wallet">> => Wallet },
    Req = hb_message:commit(#{
        <<"path">> => <<"/~odysee-upload-demo@1.0/upload">>,
        <<"method">> => <<"POST">>,
        <<"legacy-user-id">> => <<"42">>,
        <<"filename">> => <<"demo.txt">>,
        <<"content-type">> => <<"text/plain">>,
        <<"body">> => <<"hello hyperbeam">>
    }, Opts),
    {ok, Res} = upload(#{}, Req, Opts),
    UploadJSON = hb_json:decode(maps:get(<<"body">>, Res)),
    ?assertEqual(true, maps:get(<<"ok">>, UploadJSON)),
    ?assertEqual([Signer], maps:get(<<"signers">>, UploadJSON)),
    {ok, Read} = read(#{}, #{ <<"id">> => maps:get(<<"id">>, UploadJSON) }, Opts),
    ?assertEqual(<<"hello hyperbeam">>, maps:get(<<"body">>, Read)),
    ?assertEqual(<<"text/plain">>, maps:get(<<"content-type">>, Read)).

upload_indexes_channel_upload_ids_test() ->
    Store = hb_test_utils:test_store(hb_store_volatile, <<"odysee-upload-demo-channel">>),
    ok = hb_store:start(Store),
    Wallet = ar_wallet:new(),
    Opts = #{ <<"store">> => Store, <<"priv-wallet">> => Wallet },
    Req = hb_message:commit(#{
        <<"path">> => <<"/~odysee-upload-demo@1.0/upload">>,
        <<"method">> => <<"POST">>,
        <<"legacy-user-id">> => <<"42">>,
        <<"channel-id">> => <<"channel-1">>,
        <<"channel-name">> => <<"@native-demo">>,
        <<"title">> => <<"Native upload">>,
        <<"description">> => <<"Stored directly in HyperBEAM">>,
        <<"tags">> => <<"hb,native">>,
        <<"thumbnail-url">> => <<"https://example.test/thumb.jpg">>,
        <<"claim-name">> => <<"native-upload">>,
        <<"filename">> => <<"native.mp4">>,
        <<"content-type">> => <<"video/mp4">>,
        <<"body">> => <<"native hyperbeam bytes">>
    }, Opts),
    {ok, Res} = upload(#{}, Req, Opts),
    UploadJSON = hb_json:decode(maps:get(<<"body">>, Res)),
    UploadID = maps:get(<<"upload-id">>, UploadJSON),
    {ok, ChannelRes} = channel(
        #{},
        #{
            <<"channel-id">> => <<"channel-1">>,
            <<"claim-ids">> => <<"legacy-a,legacy-b">>
        },
        Opts
    ),
    ChannelJSON = hb_json:decode(maps:get(<<"body">>, ChannelRes)),
    ?assertEqual([UploadID], maps:get(<<"hyperbeam-upload-ids">>, ChannelJSON)),
    ?assertEqual([<<"legacy-a">>, <<"legacy-b">>], maps:get(<<"legacy-claim-ids">>, ChannelJSON)),
    [Upload] = maps:get(<<"uploads">>, ChannelJSON),
    ?assertEqual(<<"hyperbeam-upload">>, maps:get(<<"kind">>, Upload)),
    ?assertEqual(<<"channel-1">>, maps:get(<<"channel-id">>, Upload)),
    ?assertEqual(<<"Native upload">>, maps:get(<<"title">>, Upload)),
    ?assertEqual([<<"hb">>, <<"native">>], maps:get(<<"tags">>, Upload)),
    [ClaimItem] = channel_claim_items(<<"channel-1">>, Opts),
    ?assertEqual(UploadID, maps:get(<<"claim_id">>, ClaimItem)),
    ?assertEqual(<<"stream">>, maps:get(<<"value_type">>, ClaimItem)),
    ?assertEqual(<<"native-upload">>, maps:get(<<"name">>, ClaimItem)),
    ?assertEqual(true, maps:get(<<"is_channel_signature_valid">>, ClaimItem)),
    ClaimValue = maps:get(<<"value">>, ClaimItem),
    ?assertEqual(<<"Native upload">>, maps:get(<<"title">>, ClaimValue)),
    ?assertEqual(<<"Stored directly in HyperBEAM">>, maps:get(<<"description">>, ClaimValue)),
    ?assertEqual([<<"hb">>, <<"native">>], maps:get(<<"tags">>, ClaimValue)),
    ?assertEqual(
        #{ <<"url">> => <<"https://example.test/thumb.jpg">> },
        maps:get(<<"thumbnail">>, ClaimValue)
    ),
    ClaimSource = maps:get(<<"source">>, ClaimValue),
    ?assertEqual(UploadID, maps:get(<<"hyperbeam_upload_id">>, ClaimSource)),
    ?assertEqual(false, maps:is_key(<<"sd_hash">>, ClaimSource)),
    [UserClaimItem] = user_claim_items(<<"42">>, Opts),
    ?assertEqual(UploadID, maps:get(<<"claim_id">>, UserClaimItem)),
    ?assertEqual(true, maps:get(<<"is_my_output">>, UserClaimItem)),
    ?assertEqual(true, maps:get(<<"is_channel_signature_valid">>, UserClaimItem)),
    ?assert(maps:get(<<"timestamp">>, UserClaimItem) > 0),
    UserClaimValue = maps:get(<<"value">>, UserClaimItem),
    ?assertEqual(<<"Native upload">>, maps:get(<<"title">>, UserClaimValue)),
    UserClaimSource = maps:get(<<"source">>, UserClaimValue),
    ?assertEqual(false, maps:is_key(<<"sd_hash">>, UserClaimSource)).

upload_accepts_metadata64_with_special_characters_test() ->
    Store = hb_test_utils:test_store(hb_store_volatile, <<"odysee-upload-demo-metadata64">>),
    ok = hb_store:start(Store),
    Wallet = ar_wallet:new(),
    Opts = #{ <<"store">> => Store, <<"priv-wallet">> => Wallet },
    Metadata = #{
        <<"filename">> => <<"OdyTest.mp4">>,
        <<"content-type">> => <<"video/mp4">>,
        <<"claim-name">> => <<"OdyTest">>,
        <<"title">> => <<"Odysee on HyperBeam">>,
        <<"description">> => <<"Move Fast & Eat Glass">>,
        <<"tags">> => <<"arweave,hyperbeam">>,
        <<"thumbnail-url">> => <<"https://thumbs.odycdn.com/e6ba67593ac6b69db03cc5525e59fe8f.webp">>
    },
    Req = hb_message:commit(#{
        <<"path">> => <<"/~odysee-upload-demo@1.0/upload">>,
        <<"method">> => <<"POST">>,
        <<"legacy-user-id">> => <<"42">>,
        <<"metadata64">> => hb_util:encode(hb_json:encode(Metadata)),
        <<"body">> => <<"fake mp4 bytes">>
    }, Opts),
    {ok, Res} = upload(#{}, Req, Opts),
    UploadJSON = hb_json:decode(maps:get(<<"body">>, Res)),
    ?assertEqual(<<"OdyTest.mp4">>, maps:get(<<"filename">>, UploadJSON)),
    ?assertEqual(<<"video/mp4">>, maps:get(<<"content-type">>, UploadJSON)),
    ?assertEqual(<<"Odysee on HyperBeam">>, maps:get(<<"title">>, UploadJSON)),
    ?assertEqual(<<"Move Fast & Eat Glass">>, maps:get(<<"description">>, UploadJSON)),
    ?assertEqual([<<"arweave">>, <<"hyperbeam">>], maps:get(<<"tags">>, UploadJSON)),
    ?assertEqual(<<"OdyTest">>, maps:get(<<"claim-name">>, UploadJSON)).

upload_rejects_raw_token_before_storage_test() ->
    Store = hb_test_utils:test_store(hb_store_volatile, <<"odysee-upload-demo-raw-token">>),
    ok = hb_store:start(Store),
    Req = #{
        <<"path">> => <<"/~odysee-upload-demo@1.0/upload">>,
        <<"method">> => <<"POST">>,
        <<"legacy-user-id">> => <<"42">>,
        <<"auth_token">> => <<"tokenA">>,
        <<"body">> => <<"hello">>
    },
    {error, Res} = upload(#{}, Req, #{ <<"store">> => Store }),
    ?assertEqual(400, maps:get(<<"status">>, Res)),
    Body = hb_json:decode(maps:get(<<"body">>, Res)),
    ?assertEqual(<<"raw_credential_rejected">>, maps:get(<<"reason">>, Body)).
