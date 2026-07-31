-module(dev_odysee_upload).
-implements(<<"odysee-upload@1.0">>).
-export([info/1, submit/3, upload/3, write/3, chunk/3, finalize/3, index/3, update/3, delete/3, record/3, media/3, list/3, reconcile/3, reindex/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-upload@1.0">>).
-define(DEFAULT_MAX_BYTES, 104857600).
-define(CHUNKED_MANIFEST_KIND, <<"odysee-hyperbeam-chunked-upload">>).
-define(SEARCH_PENDING_PATH, <<"odysee/upload/search-pending.json">>).
-define(DEFAULT_SEARCH_RECONCILE_LIMIT, 20).

info(_Opts) ->
    #{
        exports => [
            <<"submit">>,
            <<"upload">>,
            <<"write">>,
            <<"chunk">>,
            <<"finalize">>,
            <<"index">>,
            <<"update">>,
            <<"delete">>,
            <<"record">>,
            <<"media">>,
            <<"list">>,
            <<"reconcile">>,
            <<"reindex">>
        ]
    }.

upload(Base, Req, Opts) ->
    submit(Base, Req, Opts).

write(Base, Req, Opts) ->
    raw_write(Base, Req, Opts).

chunk(Base, Req, Opts) ->
    raw_write(Base, Req, Opts).

finalize(Base, Req, Opts) ->
    raw_write(Base, Req, Opts).

index(Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    {ok, Owner} ?= authenticated_owner(Base, Req, Opts),
                    {ok, Payload0} ?= request_payload(Base, Req, Opts),
                    Payload = hb_cache:ensure_all_loaded(Payload0, Opts),
                    {ok, DataID} ?= required_first([<<"data-id">>, <<"data_id">>, <<"id">>], Payload, Opts),
                    Record0 = upload_index_record(Owner, DataID, Payload, Opts),
                    {ok, RecordID} ?= hb_cache:write(committed_record(Record0, Opts), Opts),
                    Record = enrich_record(RecordID, Record0, Opts),
                    ok ?= write_indexes(Record, Opts),
                    ok ?= index_search_record(Record, Opts),
                    {ok, index_response(Record, Opts)}
                else
                    Error -> Error
                end
            end)
    end.

update(Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    {ok, Owner} ?= authenticated_owner(Base, Req, Opts),
                    {ok, Payload0} ?= request_payload(Base, Req, Opts),
                    Payload = hb_cache:ensure_all_loaded(Payload0, Opts),
                    {ok, OldRecord} ?= resolve_record(Base, Payload, Opts),
                    ok ?= require_record_owner(Owner, OldRecord, Opts),
                    OldRecordID = hb_maps:get(<<"record-id">>, OldRecord, not_found, Opts),
                    Metadata = update_metadata(OldRecord, Payload, Opts),
                    Record0 = rebuild_index_record(OldRecord, Metadata, Opts),
                    {ok, RecordID} ?= hb_cache:write(committed_record(Record0, Opts), Opts),
                    Record = enrich_record(RecordID, Record0, Opts),
                    ok ?= remove_from_list_indexes(OldRecord, OldRecordID, Opts),
                    % Pointer aliases are messages now, so the superseded
                    % record's aliases must be explicitly tombstoned (the old
                    % JSON pointers were overwritten in place).
                    ok ?= tombstone_indexes(OldRecord, Opts),
                    ok ?= write_indexes(Record, Opts),
                    ok ?= delete_search_record(OldRecord, Opts),
                    ok ?= index_search_record(Record, Opts),
                    {ok, index_response(Record, Opts)}
                else
                    Error -> Error
                end
            end)
    end.

delete(Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    {ok, Owner} ?= authenticated_owner(Base, Req, Opts),
                    {ok, Payload0} ?= request_payload(Base, Req, Opts),
                    Payload = hb_cache:ensure_all_loaded(Payload0, Opts),
                    {ok, Record} ?= resolve_record(Base, Payload, Opts),
                    ok ?= require_record_owner(Owner, Record, Opts),
                    RecordID = hb_maps:get(<<"record-id">>, Record, not_found, Opts),
                    ok ?= remove_from_list_indexes(Record, RecordID, Opts),
                    ok ?= tombstone_indexes(Record, Opts),
                    ok ?= delete_search_record(Record, Opts),
                    {ok, delete_response(RecordID, Record, Opts)}
                else
                    Error -> Error
                end
            end)
    end.

submit(Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    {ok, Owner} ?= authenticated_owner(Base, Req, Opts),
                    {ok, Payload0} ?= request_payload(Base, Req, Opts),
                    Payload = hb_cache:ensure_all_loaded(Payload0, Opts),
                    {ok, Bytes} ?= payload_bytes(Payload, Req, Opts),
                    ok ?= enforce_size(Bytes, Base, Req, Opts),
                    {ok, DataID} ?= hb_cache:write(Bytes, Opts),
                    RecordBase = upload_record(Owner, DataID, Bytes, Payload, Opts),
                    {ok, MediaBytes} ?= media_bytes(RecordBase, Bytes, Opts),
                    Record0 = RecordBase#{ <<"body">> => MediaBytes },
                    {ok, RecordID} ?= hb_cache:write(committed_record(Record0, Opts), Opts),
                    Record = enrich_record(RecordID, Record0, Opts),
                    ok ?= write_indexes(Record, Opts),
                    {ok, response(Record, Opts)}
                else
                    Error -> Error
                end
            end)
    end.

raw_write(Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    % The write is auth-gated, but a raw blob is
                    % content-addressed bytes: it carries no commitment and is
                    % bound to no owner (anyone writing the same bytes gets the
                    % same id). Ownership is asserted later, at index/finalize,
                    % on the committed record -- so the response must not claim
                    % a signer here.
                    {ok, _Owner} ?= authenticated_owner(Base, Req, Opts),
                    {ok, Bytes} ?= raw_body(Req, Opts),
                    ok ?= enforce_size(Bytes, Base, Req, Opts),
                    {ok, ID} ?= hb_cache:write(Bytes, Opts),
                    {ok, raw_write_response(ID)}
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

%% @doc Replay a bounded batch of durable search operations that could not be
%% applied while the derivative search backend was unavailable.
reconcile(Base, Req, Opts) ->
    safe(fun() ->
        Limit = min(
            1000,
            max(1, integer_param(Base, Req, <<"limit">>, ?DEFAULT_SEARCH_RECONCILE_LIMIT, Opts))
        ),
        Entries = lists:sublist(lists:sort(maps:to_list(read_search_pending(Opts))), Limit),
        {Reconciled, Failed} = reconcile_search_entries(Entries, Opts),
        search_maintenance_response(#{
            <<"reconciled">> => Reconciled,
            <<"failed">> => Failed,
            <<"pending">> => map_size(read_search_pending(Opts))
        })
    end).

%% @doc Rebuild a bounded window of native upload documents from the durable
%% global upload list. Callers advance `offset' until `next-offset' is absent.
reindex(Base, Req, Opts) ->
    case is_node_operator(Base, Req, Opts) of
        false ->
            {ok, #{<<"status">> => 403, <<"message">> => <<"Unauthorized.">>}};
        true ->
            safe(fun() ->
                Offset = max(0, integer_param(Base, Req, <<"offset">>, 0, Opts)),
                Limit = min(1000, max(1, integer_param(Base, Req, <<"limit">>, 100, Opts))),
                IDs = upload_list_ids(#{}, Opts),
                Window = slice_items(IDs, Offset, Limit),
                {Indexed, Failed} = reindex_search_records(Window, Opts),
                NextOffset =
                    case Offset + length(Window) < length(IDs) of
                        true -> Offset + length(Window);
                        false -> not_found
                    end,
                search_maintenance_response(
                    put_optional(
                        {<<"next-offset">>, NextOffset},
                        #{
                            <<"indexed">> => Indexed,
                            <<"failed">> => Failed,
                            <<"processed">> => length(Window),
                            <<"offset">> => Offset,
                            <<"total">> => length(IDs)
                        }
                    )
                )
            end)
    end.

media(Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    {ok, Record} ?= read_record(Base, Req, Opts),
                    {ok, MediaBytes} ?= record_media_bytes(Record, Opts),
                    {ok, media_response(Record, MediaBytes, Req, Opts)}
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
                true ->
                    % Ownership is anchored to the Odysee auth token when present,
                    % so it is deterministic across requests and node restarts,
                    % independent of the auth hook's per-session signing wallet.
                    % Falls back to the request signer for token-less requests.
                    case token_owner(Req, Opts) of
                        {ok, Owner} -> {ok, Owner};
                        not_found -> {ok, hd(Signers)}
                    end;
                _ -> {error, #{
                    <<"status">> => 401,
                    <<"body">> => <<"Invalid request signature.">>
                }}
            end
    end.

is_node_operator(Base, Req, Opts) ->
    Subject =
        case hb_message:signers(Req, Opts) of
            [] ->
                case hb_message:signers(Base, Opts) of
                    [] -> Req;
                    _ -> Base
                end;
            _ ->
                Req
        end,
    case hb_ao:resolve(
        #{<<"device">> => <<"meta@1.0">>},
        #{<<"path">> => <<"is-operator">>, <<"body">> => Subject},
        Opts#{<<"hashpath">> => ignore}
    ) of
        {ok, Result} -> Result;
        _ -> false
    end.

token_owner(Req, Opts) ->
    case auth_token(Req, Opts) of
        {ok, Token} -> {ok, token_secret(Token)};
        not_found -> not_found
    end.

auth_token(Req, Opts) ->
    case authorization_token(Req, Opts) of
        {ok, _Token} = Found -> Found;
        not_found ->
            case first_field(auth_token_keys(), Req, Opts) of
                not_found -> cookie_auth_token(Req, Opts);
                Token -> {ok, hb_util:bin(Token)}
            end
    end.

authorization_token(Req, Opts) ->
    case first_field([<<"authorization">>], Req, Opts) of
        not_found -> not_found;
        Auth ->
            case binary:split(string:trim(hb_util:bin(Auth)), <<" ">>) of
                [Scheme, Value0] ->
                    Value = string:trim(Value0, leading),
                    case hb_util:to_lower(Scheme) of
                        <<"bearer">> when Value =/= <<>> -> {ok, Value};
                        <<"token">> when Value =/= <<>> -> {ok, Value};
                        _ -> not_found
                    end;
                _ -> not_found
            end
    end.

cookie_auth_token(Req, Opts) ->
    % Resolve through the AO layer rather than calling the cookie device's
    % module directly: devices are addressed by name, never by module.
    try hb_ao:raw(<<"cookie@1.0">>, <<"extract">>, Req, #{}, Opts) of
        {ok, Cookies} ->
            case first_field(auth_token_keys(), Cookies, Opts) of
                not_found -> not_found;
                Token -> {ok, hb_util:bin(Token)}
            end;
        _ -> not_found
    catch _:_ ->
        not_found
    end.

auth_token_keys() ->
    [
        <<"auth-token">>,
        <<"auth_token">>,
        <<"authtoken">>,
        <<"lbry-auth-token">>,
        <<"lbry_auth_token">>,
        <<"x-lbry-auth-token">>,
        <<"x_lbry_auth_token">>,
        <<"odysee-auth-token">>,
        <<"odysee_auth_token">>
    ].

token_secret(Token0) ->
    Token = hb_util:bin(Token0),
    hb_util:encode(hb_crypto:sha256(<<"odysee-auth:", Token/binary>>)).

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

raw_body(Req, Opts) ->
    case hb_maps:get(<<"body">>, Req, not_found, Opts) of
        Body when is_binary(Body) -> {ok, Body};
        _ -> {error, upload_content_not_found}
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
    MediaType = media_type(Payload, Opts),
    Filename = first_field([<<"filename">>, <<"file-name">>, <<"file_name">>], Payload, Opts),
    ReleaseTime = first_field([<<"release-time">>, <<"release_time">>], Metadata, Opts),
    RecordFilename = value_or(Filename, value_or(Name, <<"upload">>)),
    DataKind =
        case truthy(first_field([<<"chunked-manifest">>, <<"chunked_manifest">>], Payload, Opts)) of
            true -> <<"chunked-manifest">>;
            false -> <<"bytes">>
        end,
    Size =
        integer_value(
            first_field([<<"size">>, <<"file-size">>, <<"file_size">>], Payload, Opts),
            byte_size(Bytes)
        ),
    #{
        <<"device">> => ?DEVICE,
        <<"type">> => <<"odysee-upload">>,
        <<"version">> => <<"1">>,
        <<"owner">> => Owner,
        <<"data-id">> => DataID,
        <<"data-kind">> => DataKind,
        <<"byte-size">> => Size,
        <<"content-length">> => Size,
        <<"content-type">> => value_or(MediaType, <<"application/octet-stream">>),
        <<"accept-ranges">> => <<"bytes">>,
        <<"cache-control">> => [<<"store">>, <<"cache">>],
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
                Size,
                Opts
            )
    }.

upload_index_record(Owner, DataID, Payload, Opts) ->
    Metadata = metadata(Payload, Opts),
    Name = value_or(first_field([<<"name">>, <<"claim-name">>, <<"claim_name">>], Payload, Opts), <<"upload">>),
    MediaType =
        value_or(
            media_type(Payload, Opts),
            <<"application/octet-stream">>
        ),
    Filename = value_or(first_field([<<"filename">>, <<"file-name">>, <<"file_name">>], Payload, Opts), Name),
    Size = integer_value(first_field([<<"size">>, <<"byte-size">>, <<"byte_size">>], Payload, Opts), 0),
    Claim =
        normalize_index_claim(
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
        <<"content-length">> => Size,
        <<"content-type">> => MediaType,
        <<"accept-ranges">> => <<"bytes">>,
        <<"cache-control">> => [<<"store">>, <<"cache">>],
        <<"filename">> => Filename,
        <<"created-at">> => integer_to_binary(erlang:system_time(second)),
        <<"metadata">> => Metadata,
        <<"claim">> => Claim
    }.

metadata(Payload, Opts) ->
    Source = case first_field([<<"metadata">>, <<"publish">>, <<"publish-payload">>, <<"publish_payload">>], Payload, Opts) of
        Msg when is_map(Msg) ->
            Msg;
        _ ->
            Payload
    end,
    without_control_keys(Source).

media_type(Msg, Opts) ->
    first_field([<<"content_type">>, <<"media_type">>, <<"content-type">>, <<"media-type">>], Msg, Opts).

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
    Timestamp = release_time_or_now(ReleaseTime),
    ClaimURI = claim_uri(Name, Metadata, Opts),
    SigningChannel = signing_channel(Metadata, Opts),
    Tags = list_value(first_field([<<"tags">>], Metadata, Opts)),
    Languages = list_value(first_field([<<"languages">>], Metadata, Opts)),
    Description = value_or(first_field([<<"description">>], Metadata, Opts), <<>>),
    Thumbnail = first_field([<<"thumbnail-url">>, <<"thumbnail_url">>, <<"thumbnail">>], Metadata, Opts),
    MediaType =
        value_or(
            media_type(Metadata, Opts),
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
        % No channel signature exists on this upload path yet, so validity is
        % never asserted: an unproven `signing_channel' is display metadata,
        % not a verified identity. (Channel attestation over uploads is the
        % follow-up that would let this become a real `true'.)
        <<"txid">> => DataID,
        <<"nout">> => 0,
        <<"timestamp">> => Timestamp,
        <<"meta">> => #{
            <<"creation_timestamp">> => Timestamp,
            <<"effective_amount">> => <<"0">>
        },
        <<"value">> => #{
            <<"title">> => Title,
            <<"description">> => Description,
            <<"thumbnail">> => thumbnail_value(Thumbnail),
            <<"tags">> => Tags,
            <<"languages">> => Languages,
            <<"release_time">> => Timestamp,
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

normalize_index_claim(Claim0, Owner, DataID, Name, MediaType, Filename, Size, Metadata, Opts) when is_map(Claim0) ->
    Timestamp = release_time_or_now(first_field([<<"release_time">>, <<"release-time">>], Metadata, Opts)),
    Value0 = value_or(first_field([<<"value">>], Claim0, Opts), #{}),
    Source0 = value_or(first_field([<<"source">>], Value0, Opts), #{}),
    Hyperbeam0 = value_or(first_field([<<"hyperbeam">>], Claim0, Opts), #{}),
    ClaimName = value_or(first_field([<<"name">>], Claim0, Opts), Name),
    ClaimURI =
        value_or(
            first_field([<<"permanent_url">>, <<"canonical_url">>, <<"short_url">>], Claim0, Opts),
            claim_uri(ClaimName, Metadata, Opts)
        ),
    SigningChannel =
        value_or(
            first_field([<<"signing_channel">>, <<"signing-channel">>], Claim0, Opts),
            signing_channel(Metadata, Opts)
        ),
    Value1 =
        put_optional(
            {<<"audio">>,
                value_or(
                    first_field([<<"audio">>], Value0, Opts),
                    first_field([<<"audio">>], Metadata, Opts)
                )},
            put_optional(
                {<<"video">>,
                    value_or(
                        first_field([<<"video">>], Value0, Opts),
                        first_field([<<"video">>], Metadata, Opts)
                    )},
                Value0
            )
        ),
    Claim1 = Claim0#{
        <<"claim_id">> => DataID,
        <<"claim-id">> => DataID,
        <<"name">> => ClaimName,
        <<"normalized_name">> => hb_util:to_lower(ClaimName),
        <<"permanent_url">> => ClaimURI,
        <<"canonical_url">> => ClaimURI,
        <<"short_url">> => ClaimURI,
        <<"type">> => <<"claim">>,
        <<"value_type">> => <<"stream">>,
        <<"confirmations">> => 1,
        <<"is_my_output">> => true,
        % No channel signature exists on this upload path yet, so validity is
        % never asserted: an unproven `signing_channel' is display metadata,
        % not a verified identity. (Channel attestation over uploads is the
        % follow-up that would let this become a real `true'.)
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
        <<"value">> => Value1#{
            <<"title">> =>
                value_or(first_field([<<"title">>], Value0, Opts), value_or(first_field([<<"title">>], Metadata, Opts), ClaimName)),
            <<"description">> =>
                value_or(
                    first_field([<<"description">>], Value0, Opts),
                    value_or(first_field([<<"description">>], Metadata, Opts), <<>>)
                ),
            <<"thumbnail">> =>
                thumbnail_value(
                    value_or(
                        first_field([<<"thumbnail">>], Value0, Opts),
                        first_field([<<"thumbnail_url">>, <<"thumbnail">>], Metadata, Opts)
                    )
                ),
            <<"tags">> =>
                list_value(value_or(first_field([<<"tags">>], Value0, Opts), first_field([<<"tags">>], Metadata, Opts))),
            <<"languages">> =>
                list_value(
                    value_or(first_field([<<"languages">>], Value0, Opts), first_field([<<"languages">>], Metadata, Opts))
                ),
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
normalize_index_claim(_Claim, Owner, DataID, Name, MediaType, Filename, Size, Metadata, Opts) ->
    normalize_index_claim(#{}, Owner, DataID, Name, MediaType, Filename, Size, Metadata, Opts).

response(Record, Opts) ->
    Claim = hb_maps:get(<<"claim">>, Record, #{}, Opts),
    RecordID = hb_maps:get(<<"record-id">>, Record, not_found, Opts),
    Msg = (cors_headers())#{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"id">> => RecordID,
        <<"record-id">> => RecordID,
        <<"data-id">> => hb_maps:get(<<"data-id">>, Record, not_found, Opts),
        <<"media-path">> => generic_read_path(RecordID),
        <<"read-path">> => generic_read_path(RecordID),
        <<"url">> => generic_read_path(RecordID),
        <<"record">> => public_record(Record, Opts),
        <<"claim">> => Claim,
        <<"outputs">> => [Claim],
        <<"result">> => #{ <<"outputs">> => [Claim] }
    },
    Msg#{ <<"body">> => hb_json:encode(Msg) }.

index_response(Record, Opts) ->
    Claim = hb_maps:get(<<"claim">>, Record, #{}, Opts),
    DataID = hb_maps:get(<<"data-id">>, Record, not_found, Opts),
    Msg = (cors_headers())#{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"id">> => hb_maps:get(<<"record-id">>, Record, not_found, Opts),
        <<"record-id">> => hb_maps:get(<<"record-id">>, Record, not_found, Opts),
        <<"data-id">> => DataID,
        <<"media-path">> => generic_read_path(DataID),
        <<"record">> => public_record(Record, Opts),
        <<"claim">> => Claim,
        <<"outputs">> => [Claim],
        <<"result">> => #{ <<"outputs">> => [Claim] }
    },
    Msg#{ <<"body">> => hb_json:encode(Msg) }.

public_record(Record, Opts) ->
    hb_maps:without([<<"body">>], Record, Opts).

raw_write_response(ID) ->
    ReadPath = <<"/", ID/binary>>,
    Body = #{
        <<"id">> => ID,
        <<"path">> => ID,
        <<"read_path">> => ReadPath,
        <<"read-path">> => ReadPath
    },
    (cors_headers())#{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"id">> => ID,
        <<"path">> => ID,
        <<"read-path">> => ReadPath,
        <<"url">> => ReadPath,
        <<"body">> => hb_json:encode(Body)
    }.

%% @doc Commit the record with the node's wallet before it is written, so
%% the record id is a committed id -- an uncommitted cache hash must not
%% act as claim identity.
committed_record(Record, Opts) ->
    hb_message:commit(Record, Opts).

enrich_record(RecordID, Record0, Opts) ->
    case hb_maps:get(<<"type">>, Record0, not_found, Opts) of
        <<"odysee-upload-index">> ->
            enrich_index_record(RecordID, Record0, Opts);
        _ ->
            enrich_upload_record(RecordID, Record0, Opts)
    end.

enrich_upload_record(RecordID, Record0, Opts) ->
    Claim0 = hb_maps:get(<<"claim">>, Record0, #{}, Opts),
    Hyperbeam0 = hb_maps:get(<<"hyperbeam">>, Claim0, #{}, Opts),
    Value0 = hb_maps:get(<<"value">>, Claim0, #{}, Opts),
    Source0 = hb_maps:get(<<"source">>, Value0, #{}, Opts),
    ReadPath = generic_read_path(RecordID),
    Claim = Claim0#{
        <<"claim_id">> => RecordID,
        <<"claim-id">> => RecordID,
        <<"txid">> => RecordID,
        <<"permanent_url">> => <<"lbry://", RecordID/binary>>,
        <<"canonical_url">> => <<"lbry://", RecordID/binary>>,
        <<"short_url">> => <<"lbry://", RecordID/binary>>,
        <<"streaming_url">> => ReadPath,
        <<"download_url">> => ReadPath,
        <<"hyperbeam">> => Hyperbeam0#{
            <<"record-id">> => RecordID,
            <<"path">> => ReadPath
        },
        <<"value">> => Value0#{
            <<"source">> => Source0#{
                <<"url">> => ReadPath
            }
        }
    },
    Record0#{
        <<"id">> => RecordID,
        <<"record-id">> => RecordID,
        <<"claim">> => Claim
    }.

enrich_index_record(RecordID, Record0, Opts) ->
    Claim0 = hb_maps:get(<<"claim">>, Record0, #{}, Opts),
    Hyperbeam0 = hb_maps:get(<<"hyperbeam">>, Claim0, #{}, Opts),
    DataID = hb_maps:get(<<"data-id">>, Record0, RecordID, Opts),
    Claim = Claim0#{
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

%% Indexes are messages, never JSON blobs or bare-binary pointers: every
%% membership/alias/pending fact is its own committed message, discovered
%% through the store's match index, and the latest message per subject wins.
%% Legacy JSON/pointer entries written by earlier builds remain readable as
%% a fallback, but are no longer written.
write_indexes(Record, Opts) ->
    Store = hb_opts:get(store, [], Opts),
    RecordID = hb_maps:get(<<"record-id">>, Record, not_found, Opts),
    case {Store, RecordID} of
        {[], _} -> ok;
        {_, not_found} -> ok;
        _ ->
            case write_pointer_messages(Record, RecordID, <<"active">>, Opts) of
                ok -> write_list_entries(Record, RecordID, <<"active">>, Opts);
                Error -> Error
            end
    end.

write_pointer_messages(Record, RecordID, State, Opts) ->
    lists:foldl(
        fun({Type, Alias}, ok) ->
            write_index_message(
                #{
                    <<"type">> => <<"odysee-upload-pointer">>,
                    <<"alias-type">> => Type,
                    <<"alias">> => Alias,
                    <<"record-id">> => RecordID,
                    <<"state">> => State
                },
                Opts
            );
           (_Entry, Error) -> Error
        end,
        ok,
        upload_index_aliases(Record, Opts)
    ).

write_list_entries(Record, RecordID, State, Opts) ->
    lists:foldl(
        fun({Type, Key}, ok) ->
            write_index_message(
                #{
                    <<"type">> => <<"odysee-upload-list-entry">>,
                    <<"list">> => Type,
                    <<"list-key">> => Key,
                    <<"record-id">> => RecordID,
                    <<"state">> => State
                },
                Opts
            );
           (_Entry, Error) -> Error
        end,
        ok,
        upload_list_keys(Record, Opts)
    ).

write_index_message(Message, Opts) ->
    Stamped = Message#{ <<"at">> => erlang:system_time(millisecond) },
    case hb_cache:write(hb_message:commit(Stamped, Opts), Opts) of
        {ok, _ID} -> ok;
        Error -> Error
    end.

%% @doc Latest-message-wins fold over index messages matched by `Selector'.
%% Returns record-id => state; on equal timestamps the inactive state wins,
%% so removal is never lost to a same-millisecond append.
index_message_states(Selector, SubjectKey, Opts) ->
    Paths =
        case hb_cache:match(Selector, Opts) of
            {ok, Found} when is_list(Found) -> Found;
            _ -> []
        end,
    lists:foldl(
        fun(Path, Acc) ->
            case hb_cache:read(Path, Opts) of
                {ok, Msg0} when is_map(Msg0) ->
                    Msg = hb_cache:ensure_all_loaded(Msg0, Opts),
                    Subject = hb_maps:get(SubjectKey, Msg, not_found, Opts),
                    State = hb_maps:get(<<"state">>, Msg, <<"active">>, Opts),
                    At = integer_value(hb_maps:get(<<"at">>, Msg, 0, Opts), 0),
                    Rank = {At, state_tiebreak(State)},
                    case Subject of
                        not_found -> Acc;
                        _ ->
                            case maps:get(Subject, Acc, not_found) of
                                {PrevRank, _PrevState} when PrevRank >= Rank -> Acc;
                                _ -> Acc#{ Subject => {Rank, State} }
                            end
                    end;
                _ -> Acc
            end
        end,
        #{},
        Paths
    ).

%% Inactive states outrank active ones at the same timestamp.
state_tiebreak(<<"active">>) -> 0;
state_tiebreak(<<"pending">>) -> 0;
state_tiebreak(_Inactive) -> 1.

%% Meilisearch is derivative state, so backend availability must not fail an
%% upload. Failed operations are retained in the primary store and replayed by
%% `reconcile/3'.
index_search_record(Record, Opts) ->
    Event = index_search_event(Record, Opts),
    case perform_index_search_record(Record, Opts) of
        ok ->
            best_effort_clear_search_pending(Event, Opts);
        Error ->
            ?event(warning, {odysee_upload_search_index_deferred, {result, Error}}),
            best_effort_queue_search_pending(Event, Opts)
    end.

delete_search_record(Record, Opts) ->
    Event = delete_search_event(Record, Opts),
    case perform_delete_search_record(Event, Opts) of
        ok ->
            best_effort_clear_search_pending(Event, Opts);
        Error ->
            ?event(warning, {odysee_upload_search_delete_deferred, {result, Error}}),
            best_effort_queue_search_pending(Event, Opts)
    end.

perform_index_search_record(Record, Opts) ->
    try
        Claim = search_claim(Record, Opts),
        Document = search_document(Record, Claim, Opts),
        search_device_result(
            hb_ao:raw(
                <<"search@1.0">>,
                <<"write">>,
                #{},
                #{
                    <<"body">> => Document,
                    <<"id">> => record_search_id(Record, Opts)
                },
                Opts
            ),
            Opts
        )
    catch
        Class:Reason -> {error, {Class, Reason}}
    end.

perform_delete_search_record(Event, Opts) ->
    RecordID = hb_maps:get(<<"record-id">>, Event, <<>>, Opts),
    try
        search_device_result(
            hb_ao:raw(
                <<"search@1.0">>,
                <<"write">>,
                #{},
                #{
                    <<"id">> => RecordID,
                    <<"body">> => #{
                        <<"state">> => <<"deleted">>,
                        <<"is_public">> => 0,
                        <<"source_system">> => <<"hyperbeam-native">>,
                        <<"search_rank">> => 0
                    }
                },
                Opts
            ),
            Opts
        )
    catch
        Class:Reason -> {error, {Class, Reason}}
    end.

search_device_result({ok, Result}, Opts) when is_map(Result) ->
    Status = integer_value(hb_maps:get(<<"status">>, Result, 200, Opts), 500),
    case Status >= 200 andalso Status < 300 andalso hb_maps:get(<<"error">>, Result, not_found, Opts) =:= not_found of
        true -> ok;
        false -> {error, {search_device_status, Status, hb_maps:get(<<"error">>, Result, Result, Opts)}}
    end;
search_device_result({ok, _Result}, _Opts) ->
    ok;
search_device_result(Error, _Opts) ->
    Error.

index_search_event(Record, Opts) ->
    #{
        <<"operation">> => <<"index">>,
        <<"record-id">> => record_search_id(Record, Opts)
    }.

delete_search_event(Record, Opts) ->
    #{
        <<"operation">> => <<"delete">>,
        <<"record-id">> => record_search_id(Record, Opts)
    }.

search_pending_key(Event, Opts) ->
    Operation = hb_maps:get(<<"operation">>, Event, <<"unknown">>, Opts),
    RecordID = hb_maps:get(<<"record-id">>, Event, <<>>, Opts),
    <<Operation/binary, ":", (hb_util:encode(hb_crypto:sha256(RecordID)))/binary>>.

%% Pending search operations are individual event messages: queueing and
%% clearing are independent appends folded latest-wins at read time, so no
%% read-modify-write cycle (and therefore no global lock) exists. The old
%% single JSON document remains readable as a legacy fallback.
best_effort_queue_search_pending(Event, Opts) ->
    case write_search_event(Event, <<"pending">>, Opts) of
        ok -> ok;
        Error ->
            ?event(error, {odysee_upload_search_pending_write_failed, {result, Error}}),
            ok
    end.

best_effort_clear_search_pending(Event, Opts) ->
    case write_search_event(Event, <<"cleared">>, Opts) of
        ok -> ok;
        Error ->
            ?event(warning, {odysee_upload_search_pending_clear_failed, {result, Error}}),
            ok
    end.

write_search_event(Event, State, Opts) ->
    case hb_opts:get(store, [], Opts) of
        [] -> {error, no_store};
        _ ->
            write_index_message(
                #{
                    <<"type">> => <<"odysee-upload-search-event">>,
                    <<"event-key">> => search_pending_key(Event, Opts),
                    <<"operation">> => hb_maps:get(<<"operation">>, Event, <<"unknown">>, Opts),
                    <<"record-id">> => hb_maps:get(<<"record-id">>, Event, <<>>, Opts),
                    <<"state">> => State
                },
                Opts
            )
    end.

read_search_pending(Opts) ->
    Events = search_event_states(Opts),
    Pending =
        maps:from_list(
            [
                {Key, Event}
            ||
                {Key, {_Rank, <<"pending">>, Event}} <- maps:to_list(Events)
            ]
        ),
    Cleared =
        [Key || {Key, {_Rank, State, _Event}} <- maps:to_list(Events), State =/= <<"pending">>],
    Legacy = maps:without(Cleared, read_legacy_search_pending(Opts)),
    maps:merge(Legacy, Pending).

%% Latest event message per event-key; equal timestamps favor `cleared' so
%% a clear is never lost to a same-millisecond queue.
search_event_states(Opts) ->
    Paths =
        case hb_cache:match(#{ <<"type">> => <<"odysee-upload-search-event">> }, Opts) of
            {ok, Found} when is_list(Found) -> Found;
            _ -> []
        end,
    lists:foldl(
        fun(Path, Acc) ->
            case hb_cache:read(Path, Opts) of
                {ok, Msg0} when is_map(Msg0) ->
                    Msg = hb_cache:ensure_all_loaded(Msg0, Opts),
                    Key = hb_maps:get(<<"event-key">>, Msg, not_found, Opts),
                    State = hb_maps:get(<<"state">>, Msg, <<"pending">>, Opts),
                    At = integer_value(hb_maps:get(<<"at">>, Msg, 0, Opts), 0),
                    Rank = {At, state_tiebreak(State)},
                    Event = #{
                        <<"operation">> => hb_maps:get(<<"operation">>, Msg, <<"unknown">>, Opts),
                        <<"record-id">> => hb_maps:get(<<"record-id">>, Msg, <<>>, Opts)
                    },
                    case Key of
                        not_found -> Acc;
                        _ ->
                            case maps:get(Key, Acc, not_found) of
                                {PrevRank, _S, _E} when PrevRank >= Rank -> Acc;
                                _ -> Acc#{ Key => {Rank, State, Event} }
                            end
                    end;
                _ -> Acc
            end
        end,
        #{},
        Paths
    ).

read_legacy_search_pending(Opts) ->
    Store = hb_opts:get(store, [], Opts),
    case hb_store:read(Store, ?SEARCH_PENDING_PATH, maps:without([<<"store">>, store], Opts)) of
        {ok, Raw} -> decode_search_pending(Raw);
        Raw when is_binary(Raw) -> decode_search_pending(Raw);
        _ -> #{}
    end.

decode_search_pending(Raw) when is_binary(Raw) ->
    try hb_json:decode(Raw) of
        Pending when is_map(Pending) -> Pending;
        _ -> #{}
    catch
        _:_ -> #{}
    end;
decode_search_pending(_Raw) ->
    #{}.

reconcile_search_entries(Entries, Opts) ->
    lists:foldl(
        fun({_Key, Event}, {Reconciled, Failed}) ->
            Result = reconcile_search_event(Event, Opts),
            case Result of
                ok ->
                    best_effort_clear_search_pending(Event, Opts),
                    {Reconciled + 1, Failed};
                _ ->
                    {Reconciled, Failed + 1}
            end
        end,
        {0, 0},
        Entries
    ).

reconcile_search_event(Event, Opts) ->
    case hb_maps:get(<<"operation">>, Event, not_found, Opts) of
        <<"index">> ->
            RecordID = hb_maps:get(<<"record-id">>, Event, not_found, Opts),
            case hb_cache:read(RecordID, Opts) of
                {ok, Record0} when is_map(Record0) ->
                    Record = enrich_record(RecordID, hb_cache:ensure_all_loaded(Record0, Opts), Opts),
                    perform_index_search_record(Record, Opts);
                Error ->
                    Error
            end;
        <<"delete">> ->
            perform_delete_search_record(Event, Opts);
        Other ->
            {error, {invalid_search_pending_operation, Other}}
    end.

reindex_search_records(RecordIDs, Opts) ->
    lists:foldl(
        fun(RecordID, {Indexed, Failed}) ->
            case hb_cache:read(RecordID, Opts) of
                {ok, Record0} when is_map(Record0) ->
                    Record = enrich_record(RecordID, hb_cache:ensure_all_loaded(Record0, Opts), Opts),
                    Event = index_search_event(Record, Opts),
                    case perform_index_search_record(Record, Opts) of
                        ok ->
                            best_effort_clear_search_pending(Event, Opts),
                            {Indexed + 1, Failed};
                        _ ->
                            best_effort_queue_search_pending(Event, Opts),
                            {Indexed, Failed + 1}
                    end;
                _ ->
                    {Indexed, Failed + 1}
            end
        end,
        {0, 0},
        RecordIDs
    ).

%% The search document is built from the record's claim; fall back to the
%% record ids when the claim carries no `claim_id' of its own.
search_claim(Record, Opts) ->
    Claim =
        case hb_maps:get(<<"claim">>, Record, #{}, Opts) of
            Map when is_map(Map) -> Map;
            _ -> #{}
        end,
    case hb_maps:get(<<"claim_id">>, Claim, not_found, Opts) of
        ID when is_binary(ID), ID =/= <<>> -> Claim;
        _ -> Claim#{ <<"claim_id">> => record_data_id(Record, Opts) }
    end.

record_search_id(Record, Opts) ->
    value_or(
        first_field([<<"record-id">>, <<"id">>, <<"data-id">>], Record, Opts),
        <<>>
    ).

record_data_id(Record, Opts) ->
    value_or(
        first_field([<<"data-id">>, <<"record-id">>, <<"id">>], Record, Opts),
        <<>>
    ).

search_document(Record, Claim, Opts) ->
    RecordID = record_search_id(Record, Opts),
    DataID = value_or(hb_maps:get(<<"data-id">>, Record, not_found, Opts), <<>>),
    ClaimID = value_or(hb_maps:get(<<"claim_id">>, Claim, not_found, Opts), DataID),
    Value = hb_maps:get(<<"value">>, Claim, #{}, Opts),
    Source = map_value(Value, <<"source">>, #{}, Opts),
    SigningChannel = hb_maps:get(<<"signing_channel">>, Claim, #{}, Opts),
    Timestamp = upload_timestamp(Claim, Opts),
    ContentType = map_value(Source, <<"media_type">>, <<>>, Opts),
    Name = hb_maps:get(<<"name">>, Claim, <<>>, Opts),
    ClaimType = hb_maps:get(<<"value_type">>, Claim, <<"stream">>, Opts),
    ThumbnailURL = thumbnail_url(Value, Opts),
    HasThumbnail = truthy_int(ThumbnailURL =/= <<>>),
    HasChannel = truthy_int(channel_id_from_claim(Claim, Opts) =/= <<>>),
    IsChannel = truthy_int(ClaimType =:= <<"channel">>),
    EffectiveAmount = number_value(hb_maps:get(<<"effective_amount">>, Claim, 0, Opts), 0),
    CertificateAmount = number_value(map_value(SigningChannel, <<"effective_amount">>, 1, Opts), 1),
    ViewCount = number_value(first_field([<<"view_count">>, <<"view_cnt">>], Claim, Opts), 0),
    SubCount = number_value(first_field([<<"sub_count">>, <<"sub_cnt">>], SigningChannel, Opts), 0),
    ClaimCount = number_value(first_field([<<"claim_count">>, <<"claim_cnt">>], SigningChannel, Opts), 0),
    Tags = list_value(map_value(Value, <<"tags">>, [], Opts)),
    % Reference time is injectable via Opts (defaulting to the system clock),
    % so ranking is testable and a node can pin it for reproducible ordering.
    Now = now_seconds(Opts),
    RecencyRank = recency_rank(Timestamp, Now),
    Rank = search_rank(#{
        has_channel => HasChannel,
        view_count => ViewCount,
        sub_count => SubCount,
        timestamp => Timestamp
    }, Now),
    #{
        <<"id">> => RecordID,
        <<"doc_id">> => ClaimID,
        <<"claim_id">> => ClaimID,
        <<"immutable_id">> => RecordID,
        <<"record_id">> => RecordID,
        <<"data_id">> => DataID,
        <<"txid">> => hb_maps:get(<<"txid">>, Claim, DataID, Opts),
        <<"name">> => Name,
        <<"canonical_url">> => hb_maps:get(<<"canonical_url">>, Claim, <<>>, Opts),
        <<"permanent_url">> => hb_maps:get(<<"permanent_url">>, Claim, <<>>, Opts),
        <<"short_url">> => hb_maps:get(<<"short_url">>, Claim, <<>>, Opts),
        <<"source_name">> => map_value(Source, <<"name">>, <<>>, Opts),
        <<"searchable_name">> => searchable_name(Name),
        <<"stripped_name">> => stripped_name(Name),
        <<"title">> => map_value(Value, <<"title">>, <<>>, Opts),
        <<"description">> => map_value(Value, <<"description">>, <<>>, Opts),
        <<"channel_name">> => map_value(SigningChannel, <<"name">>, <<>>, Opts),
        <<"channel_claim_id">> => channel_id_from_claim(Claim, Opts),
        <<"state">> => <<"active">>,
        <<"bid_state">> => <<"Active">>,
        <<"claim_type">> => ClaimType,
        <<"content_type">> => ContentType,
        <<"media_type">> => media_type(ContentType),
        <<"tags">> => Tags,
        % binary:join/2 is OTP 28+; stay compatible with OTP 27 nodes.
        <<"tags_text">> =>
            iolist_to_binary(lists:join(<<" ">>, [hb_util:bin(Tag) || Tag <- Tags])),
        <<"language">> => first_list_value(map_value(Value, <<"languages">>, [], Opts), <<"">>),
        <<"nsfw">> => 0,
        <<"thumbnail_url">> => ThumbnailURL,
        <<"release_time">> => Timestamp,
        <<"created_at">> => Timestamp,
        <<"transaction_time">> => Timestamp,
        <<"duration">> => map_value(Source, <<"duration">>, 0, Opts),
        <<"fee">> => map_value(Value, <<"fee">>, 0, Opts),
        <<"view_count">> => ViewCount,
        <<"view_cnt">> => ViewCount,
        <<"sub_cnt">> => SubCount,
        <<"claim_count">> => ClaimCount,
        <<"claim_cnt">> => ClaimCount,
        <<"channel_claim_count">> => ClaimCount,
        <<"effective_amount">> => EffectiveAmount,
        <<"certificate_amount">> => CertificateAmount,
        <<"is_channel">> => IsChannel,
        <<"has_thumbnail">> => HasThumbnail,
        <<"has_channel">> => HasChannel,
        <<"is_controlling">> => 0,
        <<"recency_rank">> => RecencyRank,
        <<"search_rank">> => Rank,
        <<"search_rank_version">> => 3,
        <<"source_system">> => <<"hyperbeam-native">>
    }.

truthy_int(true) -> 1;
truthy_int(false) -> 0.

number_value(Value, _Default) when is_integer(Value) -> Value;
number_value(Value, _Default) when is_float(Value) -> Value;
number_value(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value)
    catch _:_ ->
        try binary_to_float(Value)
        catch _:_ -> Default
        end
    end;
number_value(_Value, Default) -> Default.

%% Reference time is read from Opts (`now`, seconds) when supplied, else the
%% system clock. Keeps recency ranking testable and node-pinnable.
now_seconds(Opts) ->
    case hb_maps:get(<<"now">>, Opts, not_found, Opts) of
        Now when is_integer(Now) -> Now;
        Now when is_binary(Now) ->
            try binary_to_integer(Now) catch _:_ -> erlang:system_time(second) end;
        _ -> erlang:system_time(second)
    end.

search_rank(Values, Now) ->
    Timestamp = maps:get(timestamp, Values, 0),
    HasChannel = maps:get(has_channel, Values, 0),
    ViewCount = maps:get(view_count, Values, 0),
    SubCount = maps:get(sub_count, Values, 0),
    Recency =
        case Timestamp > 0 of
            true ->
                AgeDays = max(0, (Now - Timestamp) / 86400),
                10 * math:pow(0.5, AgeDays / 365);
            false ->
                0
        end,
    Recency +
        bounded_log_rank(ViewCount, 100000000, 6) +
        bounded_log_rank(SubCount, 10000000, 4) +
        case HasChannel > 0 of
            true -> 0.5;
            false -> 0
        end.

bounded_log_rank(Value, Cap, Weight) ->
    math:log(max(0, min(Value, Cap)) + 1) / math:log(Cap + 1) * Weight.

recency_rank(Timestamp, Now) ->
    AgeDays = max(0, (Now - number_value(Timestamp, 0)) div 86400),
    if
        AgeDays =< 7 -> 60;
        AgeDays =< 30 -> 45;
        AgeDays =< 90 -> 30;
        AgeDays =< 365 -> 18;
        AgeDays =< 3650 -> max(0, 12 - ((AgeDays - 365) / 365));
        true -> 0
    end.

map_value(Map, Key, Default, Opts) when is_map(Map) ->
    hb_maps:get(Key, Map, Default, Opts);
map_value(_Map, _Key, Default, _Opts) ->
    Default.

thumbnail_url(Value, Opts) ->
    Thumbnail = map_value(Value, <<"thumbnail">>, #{}, Opts),
    map_value(Thumbnail, <<"url">>, <<>>, Opts).

media_type(ContentType) ->
    case binary:split(hb_util:to_lower(hb_util:bin(ContentType)), <<"/">>) of
        [<<"video">>, _] -> <<"video">>;
        [<<"audio">>, _] -> <<"audio">>;
        [<<"image">>, _] -> <<"image">>;
        _ -> <<>>
    end.

first_list_value([Value | _], _Default) ->
    Value;
first_list_value(_Value, Default) ->
    Default.

searchable_name(Name) ->
    normalize_search_text(Name).

stripped_name(Name0) ->
    Name1 = binary:replace(hb_util:bin(Name0), <<"-">>, <<>>, [global]),
    Name2 = binary:replace(Name1, <<"_">>, <<>>, [global]),
    Name3 = binary:replace(Name2, <<"The">>, <<>>, [global]),
    binary:replace(Name3, <<"the">>, <<>>, [global]).

normalize_search_text(Name0) ->
    lists:foldl(
        fun(Sep, Name) -> binary:replace(Name, Sep, <<" ">>, [global]) end,
        hb_util:bin(Name0),
        [<<".">>, <<"_">>, <<"-">>, <<"(">>, <<")">>, <<"[">>, <<"]">>]
    ).

upload_timestamp(Claim, Opts) ->
    case hb_maps:get(<<"timestamp">>, Claim, 0, Opts) of
        Value when is_integer(Value) -> Value;
        Value when is_binary(Value) ->
            try binary_to_integer(Value)
            catch _:_ -> 0
            end;
        _ -> 0
    end.

channel_id_from_claim(Claim, Opts) when is_map(Claim) ->
    case hb_maps:get(<<"channel_id">>, Claim, <<>>, Opts) of
        <<>> ->
            case hb_maps:get(<<"channel_claim_id">>, Claim, <<>>, Opts) of
                <<>> ->
                    Channel = hb_maps:get(<<"signing_channel">>, Claim, #{}, Opts),
                    hb_maps:get(<<"claim_id">>, Channel, <<>>, Opts);
                ChannelID ->
                    ChannelID
            end;
        ChannelID ->
            ChannelID
    end;
channel_id_from_claim(_, _Opts) ->
    undefined.

upload_index_aliases(Record, Opts) ->
    Claim = hb_maps:get(<<"claim">>, Record, #{}, Opts),
    RecordID = hb_maps:get(<<"record-id">>, Record, not_found, Opts),
    DataID = hb_maps:get(<<"data-id">>, Record, not_found, Opts),
    Name = first_field([<<"name">>, <<"claim-name">>, <<"claim_name">>], Claim, Opts),
    Metadata = hb_maps:get(<<"metadata">>, Record, #{}, Opts),
    NamedURI =
        case Name of
            NameBin when is_binary(NameBin), NameBin =/= <<>> -> claim_uri(NameBin, Metadata, Opts);
            _ -> not_found
        end,
    Values =
        [
            {<<"record-id">>, RecordID},
            {<<"claim-id">>, RecordID},
            {<<"claim-id">>, DataID},
            {<<"name">>, Name},
            {<<"uri">>, NamedURI}
        ]
            ++ [{<<"uri">>, URI} || URI <- claim_uris(Claim, Opts)],
    lists:usort(
        [
            {Type, Value}
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

upload_list_keys(Record, Opts) ->
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
            {Type, Value}
        ||
            {Type, Value} <- Values,
            is_binary(Value),
            Value =/= <<>>,
            Value =/= not_found
        ]
    ).

%% Legacy read-only fallback for JSON list indexes written by earlier builds.
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
            Selectors =
                case {ChannelIDs, Owners} of
                    {[_ | _], _} -> [{<<"channel">>, ID} || ID <- ChannelIDs, is_binary(ID)];
                    {_, [_ | _]} -> [{<<"owner">>, Owner} || Owner <- Owners, is_binary(Owner)];
                    _ -> [{<<"all">>, <<"all">>}]
                end,
            dedupe_binaries(
                lists:flatmap(
                    fun(Selector) -> list_ids_for_selector(Store, Selector, Opts) end,
                    Selectors
                )
            )
    end.

%% List membership is derived from list-entry messages (latest state per
%% record wins); ids from legacy JSON indexes are appended behind them,
%% unless a message explicitly removed them.
list_ids_for_selector(Store, {Type, Key}, Opts) ->
    States =
        index_message_states(
            #{
                <<"type">> => <<"odysee-upload-list-entry">>,
                <<"list">> => Type,
                <<"list-key">> => Key
            },
            <<"record-id">>,
            Opts
        ),
    Sorted =
        lists:sort(
            fun({_, {RankA, _}}, {_, {RankB, _}}) -> RankA >= RankB end,
            maps:to_list(States)
        ),
    MessageIDs =
        [
            RecordID
        ||
            {RecordID, {_Rank, State}} <- Sorted,
            is_binary(RecordID),
            State =:= <<"active">>
        ],
    Removed =
        [RecordID || {RecordID, {_Rank, State}} <- maps:to_list(States), State =/= <<"active">>],
    LegacyIDs = read_list_index(Store, list_index_path(Type, Key), Opts),
    MessageIDs ++ [ID || ID <- LegacyIDs, not lists:member(ID, MessageIDs), not lists:member(ID, Removed)].

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
    slice_items(Items, Offset, PageSize).

slice_items(Items, Offset, Limit) ->
    case Offset >= length(Items) of
        true -> [];
        false -> lists:sublist(lists:nthtail(Offset, Items), Limit)
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
    % Pagination lives in the snake_case `result' (the legacy API payload the
    % client reads); it is not duplicated as snake_case message-level keys.
    Msg = (cors_headers())#{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"result">> => Result,
        <<"items">> => Items,
        <<"page">> => Page
    },
    Msg#{ <<"body">> => hb_json:encode(Msg) }.

search_maintenance_response(Result) ->
    Msg = (cors_headers())#{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"result">> => Result
    },
    {ok, Msg#{ <<"body">> => hb_json:encode(Msg) }}.

ceil_div(0, _Denom) ->
    0;
ceil_div(Value, Denom) ->
    (Value + Denom - 1) div Denom.

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

resolve_record(Base, Req, Opts) ->
    case read_record(Base, Req, Opts) of
        {ok, Record} ->
            {ok, Record};
        _ ->
            maybe
                {ok, ID} ?= requested_id(Base, Req, Opts),
                {ok, RecordID} ?= indexed_record_id(ID, Opts),
                {ok, Msg} ?= hb_cache:read(RecordID, Opts),
                Loaded = hb_cache:ensure_all_loaded(Msg, Opts),
                case Loaded of
                    #{ <<"data-id">> := _ } -> {ok, enrich_record(RecordID, Loaded, Opts)};
                    _ -> {error, invalid_upload_record}
                end
            end
    end.

indexed_record_id(ID, Opts) ->
    Store = hb_opts:get(store, no_viable_store, Opts),
    case Store of
        no_viable_store ->
            {error, upload_record_not_found};
        _ ->
            case pointer_record_id(ID, Opts) of
                {ok, RecordID} ->
                    {ok, RecordID};
                {error, _} = Error ->
                    Error;
                not_found ->
                    % Legacy bare-binary pointer entries from earlier builds.
                    first_index_value(
                        Store,
                        [index_path(<<"record-id">>, ID), index_path(<<"claim-id">>, ID)],
                        Opts
                    )
            end
    end.

pointer_record_id(Alias, Opts) ->
    States =
        index_message_states(
            #{
                <<"type">> => <<"odysee-upload-pointer">>,
                <<"alias">> => Alias
            },
            <<"record-id">>,
            Opts
        ),
    Active =
        lists:sort(
            fun({_, {RankA, _}}, {_, {RankB, _}}) -> RankA >= RankB end,
            [Entry || Entry = {_ID, {_Rank, State}} <- maps:to_list(States), State =:= <<"active">>]
        ),
    case Active of
        [{RecordID, _} | _] -> {ok, RecordID};
        [] ->
            case map_size(States) of
                0 -> not_found;
                % Every pointer for the alias is tombstoned: the record is
                % gone, and the legacy fallback must not resurrect it.
                _ -> {error, upload_record_not_found}
            end
    end.

first_index_value(_Store, [], _Opts) ->
    {error, upload_record_not_found};
first_index_value(Store, [Path | Rest], Opts) ->
    case hb_store:read(Store, Path, maps:without([<<"store">>, store], Opts)) of
        {ok, RecordID} when is_binary(RecordID), RecordID =/= <<>> -> {ok, RecordID};
        RecordID when is_binary(RecordID), RecordID =/= <<>> -> {ok, RecordID};
        _ -> first_index_value(Store, Rest, Opts)
    end.

require_record_owner(Owner, Record, Opts) ->
    case hb_maps:get(<<"owner">>, Record, not_found, Opts) of
        Owner ->
            ok;
        _ ->
            {error, #{
                <<"status">> => 403,
                <<"body">> => <<"Record is owned by another identity.">>
            }}
    end.

update_metadata(OldRecord, Payload, Opts) ->
    OldMetadata = strip_commitments(map_or_empty(hb_maps:get(<<"metadata">>, OldRecord, #{}, Opts))),
    NewMetadata =
        case first_field([<<"metadata">>, <<"publish">>, <<"publish-payload">>, <<"publish_payload">>], Payload, Opts) of
            Msg when is_map(Msg) -> without_control_keys(hb_cache:ensure_all_loaded(Msg, Opts));
            _ -> #{}
        end,
    maps:merge(OldMetadata, NewMetadata).

strip_commitments(Map) when is_map(Map) ->
    maps:map(
        fun(_Key, Value) -> strip_commitments(Value) end,
        maps:without([<<"commitments">>, <<"priv">>], Map)
    );
strip_commitments(List) when is_list(List) ->
    [strip_commitments(Value) || Value <- List];
strip_commitments(Value) ->
    Value.

rebuild_index_record(OldRecord, Metadata, Opts) ->
    Claim0 = strip_commitments(map_or_empty(hb_maps:get(<<"claim">>, OldRecord, #{}, Opts))),
    BaseClaim = maps:without([<<"value">>], Claim0),
    Owner = hb_maps:get(<<"owner">>, OldRecord, not_found, Opts),
    DataID = hb_maps:get(<<"data-id">>, OldRecord, not_found, Opts),
    Name = value_or(first_field([<<"name">>], Claim0, Opts), <<"upload">>),
    MediaType =
        value_or(
            hb_maps:get(<<"content-type">>, OldRecord, not_found, Opts),
            <<"application/octet-stream">>
        ),
    Filename = value_or(hb_maps:get(<<"filename">>, OldRecord, not_found, Opts), Name),
    Size = integer_value(hb_maps:get(<<"byte-size">>, OldRecord, 0, Opts), 0),
    Claim = normalize_index_claim(BaseClaim, Owner, DataID, Name, MediaType, Filename, Size, Metadata, Opts),
    maps:without(
        [<<"id">>, <<"record-id">>, <<"commitments">>, <<"priv">>],
        OldRecord#{
            <<"metadata">> => Metadata,
            <<"claim">> => Claim,
            <<"updated-at">> => integer_to_binary(erlang:system_time(second))
        }
    ).

remove_from_list_indexes(_Record, not_found, _Opts) ->
    ok;
remove_from_list_indexes(Record, RecordID, Opts) ->
    case hb_opts:get(store, [], Opts) of
        [] -> ok;
        _ -> write_list_entries(Record, RecordID, <<"removed">>, Opts)
    end.

tombstone_indexes(Record, Opts) ->
    RecordID = hb_maps:get(<<"record-id">>, Record, not_found, Opts),
    case {hb_opts:get(store, [], Opts), RecordID} of
        {[], _} -> ok;
        {_, not_found} -> ok;
        _ -> write_pointer_messages(Record, RecordID, <<"removed">>, Opts)
    end.

delete_response(RecordID, Record, Opts) ->
    Msg = (cors_headers())#{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"id">> => RecordID,
        <<"record-id">> => RecordID,
        <<"data-id">> => hb_maps:get(<<"data-id">>, Record, not_found, Opts),
        <<"deleted">> => true
    },
    Msg#{ <<"body">> => hb_json:encode(Msg) }.

record_media_bytes(Record, Opts) ->
    case hb_maps:get(<<"body">>, Record, not_found, Opts) of
        Body when is_binary(Body) ->
            {ok, Body};
        _ ->
            maybe
                {ok, DataID} ?= field(<<"data-id">>, Record, Opts),
                {ok, Bytes} ?= hb_cache:read(DataID, Opts),
                media_bytes(Record, Bytes, Opts)
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

media_bytes(Record, Bytes, Opts) ->
    case hb_maps:get(<<"data-kind">>, Record, <<"bytes">>, Opts) of
        <<"chunked-manifest">> -> chunked_manifest_bytes(Bytes, Opts);
        _ -> {ok, Bytes}
    end.

chunked_manifest_bytes(Bytes, Opts) ->
    maybe
        {ok, Manifest} ?= decode_manifest(Bytes),
        true ?= hb_maps:get(<<"type">>, Manifest, not_found, Opts) =:= ?CHUNKED_MANIFEST_KIND,
        Chunks = hb_maps:get(<<"chunks">>, Manifest, [], Opts),
        {ok, Parts} ?= read_manifest_chunks(Chunks, Opts, []),
        {ok, iolist_to_binary(Parts)}
    else
        false -> {error, invalid_upload_manifest};
        Error -> Error
    end.

decode_manifest(Bytes) ->
    try hb_json:decode(Bytes) of
        Manifest when is_map(Manifest) -> {ok, Manifest};
        _ -> {error, invalid_upload_manifest}
    catch _:_ ->
        {error, invalid_upload_manifest}
    end.

read_manifest_chunks([], _Opts, Acc) ->
    {ok, lists:reverse(Acc)};
read_manifest_chunks([Chunk | Rest], Opts, Acc) ->
    maybe
        {ok, ID} ?= manifest_chunk_id(Chunk, Opts),
        {ok, Bytes} ?= hb_cache:read(ID, Opts),
        read_manifest_chunks(Rest, Opts, [Bytes | Acc])
    end.

manifest_chunk_id(Chunk, Opts) when is_map(Chunk) ->
    case first_field([<<"id">>, <<"path">>, <<"chunk-id">>, <<"chunk_id">>], Chunk, Opts) of
        not_found -> {error, invalid_upload_manifest_chunk};
        ID -> {ok, ID}
    end;
manifest_chunk_id(ID, _Opts) when is_binary(ID) ->
    {ok, ID};
manifest_chunk_id(_Chunk, _Opts) ->
    {error, invalid_upload_manifest_chunk}.

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

required_first(Keys, Map, Opts) ->
    case first_field(Keys, Map, Opts) of
        not_found -> {error, {missing_required_param, hd(Keys)}};
        <<>> -> {error, {missing_required_param, hd(Keys)}};
        Value -> {ok, Value}
    end.

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

truthy(true) -> true;
truthy(<<"true">>) -> true;
truthy(<<"1">>) -> true;
truthy(1) -> true;
truthy(_Value) -> false.

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
value_or(null, Default) ->
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

generic_read_path(ID) ->
    <<"/", ID/binary>>.

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
    ?assertEqual(generic_read_path(RecordID), hb_maps:get(<<"read-path">>, Body, Opts)),
    ?assertEqual(generic_read_path(RecordID), hb_maps:get(<<"media-path">>, Body, Opts)),
    ?assertEqual(RecordID, hb_maps:get(<<"claim_id">>, hd(hb_maps:get(<<"outputs">>, Body, Opts)), Opts)),
    ?assertEqual(not_found, hb_maps:get(<<"body">>, hb_maps:get(<<"record">>, Body, Opts), not_found, Opts)),
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
    ?assertEqual(<<"hello">>, hb_maps:get(<<"body">>, Record, Opts)),
    {ok, Media} = media(#{}, #{ <<"id">> => RecordID }, Opts),
    ?assertEqual(<<"hello">>, hb_maps:get(<<"body">>, Media, Opts)),
    ?assertEqual(<<"text/plain">>, hb_maps:get(<<"content-type">>, Media, Opts)).

upload_response_includes_metadata_and_signature_context_test() ->
    Opts = test_opts(),
    Channel = #{
        <<"claim_id">> => <<"channel-1">>,
        <<"name">> => <<"@demo">>,
        <<"permanent_url">> => <<"lbry://@demo#channel-1">>,
        <<"canonical_url">> => <<"lbry://@demo#channel-1">>,
        <<"short_url">> => <<"lbry://@demo#channel-1">>,
        <<"value">> => #{ <<"title">> => <<"Demo Channel">> }
    },
    Metadata = #{
        <<"title">> => <<"Signed Metadata">>,
        <<"description">> => <<"metadata survives upload">>,
        <<"tags">> => [<<"hyperbeam">>, <<"demo">>],
        <<"languages">> => [<<"en">>],
        <<"thumbnail_url">> => <<"https://example.test/thumb.jpg">>,
        <<"release_time">> => 123,
        <<"channel">> => Channel
    },
    Payload = #{
        <<"content_base64">> => base64:encode(<<"signed upload">>),
        <<"name">> => <<"signed-demo">>,
        <<"filename">> => <<"signed-demo.txt">>,
        <<"content_type">> => <<"text/plain">>,
        <<"metadata">> => Metadata
    },
    Req = signed(#{ <<"params64">> => hb_util:encode(hb_json:encode(Payload)) }, Opts),
    [Owner] = hb_message:signers(Req, Opts),
    {ok, Res} = submit(#{}, Req, Opts),
    Body = hb_json:decode(hb_maps:get(<<"body">>, Res, Opts)),
    Record = hb_maps:get(<<"record">>, Body, Opts),
    [Claim] = hb_maps:get(<<"outputs">>, Body, Opts),
    Value = hb_maps:get(<<"value">>, Claim, Opts),
    Source = hb_maps:get(<<"source">>, Value, Opts),
    Hyperbeam = hb_maps:get(<<"hyperbeam">>, Claim, Opts),
    SigningChannel = hb_maps:get(<<"signing_channel">>, Claim, Opts),
    ?assertEqual(Owner, hb_maps:get(<<"owner">>, Record, Opts)),
    ?assertEqual(Owner, hb_maps:get(<<"owner">>, Hyperbeam, Opts)),
    ?assertEqual(hb_maps:get(<<"record-id">>, Body, Opts), hb_maps:get(<<"claim_id">>, Claim, Opts)),
    ?assertEqual(Metadata, hb_maps:get(<<"metadata">>, Record, Opts)),
    ?assertEqual(<<"Signed Metadata">>, hb_maps:get(<<"title">>, Value, Opts)),
    ?assertEqual(<<"metadata survives upload">>, hb_maps:get(<<"description">>, Value, Opts)),
    ?assertEqual([<<"hyperbeam">>, <<"demo">>], hb_maps:get(<<"tags">>, Value, Opts)),
    ?assertEqual([<<"en">>], hb_maps:get(<<"languages">>, Value, Opts)),
    ?assertEqual(#{ <<"url">> => <<"https://example.test/thumb.jpg">> }, hb_maps:get(<<"thumbnail">>, Value, Opts)),
    ?assertEqual(123, hb_maps:get(<<"release_time">>, Value, Opts)),
    ?assertEqual(<<"text/plain">>, hb_maps:get(<<"media_type">>, Source, Opts)),
    ?assertEqual(<<"signed-demo.txt">>, hb_maps:get(<<"name">>, Source, Opts)),
    ?assertEqual(<<"13">>, hb_maps:get(<<"size">>, Source, Opts)),
    % Validity is never asserted without a real channel signature.
    ?assertEqual(
        not_found,
        hb_maps:get(<<"is_channel_signature_valid">>, Claim, not_found, Opts)
    ),
    ?assertEqual(Channel, SigningChannel).

upload_index_prefers_payload_media_type_over_transport_content_type_test() ->
    Opts = test_opts(),
    DataID = <<"data-id-1">>,
    Payload = #{
        <<"data_id">> => DataID,
        <<"name">> => <<"mov-demo">>,
        <<"filename">> => <<"demo.mov">>,
        <<"content_type">> => <<"video/quicktime">>,
        <<"size">> => 1234,
        <<"metadata">> => #{
            <<"title">> => <<"MOV Demo">>
        }
    },
    Req =
        signed(
            #{
                <<"params64">> => hb_util:encode(hb_json:encode(Payload)),
                <<"content-type">> => <<"application/json">>
            },
            Opts
        ),
    {ok, Res} = index(#{}, Req, Opts),
    Body = hb_json:decode(hb_maps:get(<<"body">>, Res, Opts)),
    Record = hb_maps:get(<<"record">>, Body, Opts),
    [Claim] = hb_maps:get(<<"outputs">>, Body, Opts),
    Source = hb_maps:get(<<"source">>, hb_maps:get(<<"value">>, Claim, Opts), Opts),
    ?assertEqual(<<"video/quicktime">>, hb_maps:get(<<"content-type">>, Record, Opts)),
    ?assertEqual(<<"video/quicktime">>, hb_maps:get(<<"media_type">>, Source, Opts)),
    ?assertEqual(<<"/", DataID/binary>>, hb_maps:get(<<"media-path">>, Body, Opts)).

search_document_uses_record_id_as_immutable_locator_test() ->
    RecordID = <<"record-id">>,
    DataID = <<"media-data-id">>,
    Claim = #{
        <<"claim_id">> => DataID,
        <<"name">> => <<"native-upload">>,
        <<"value_type">> => <<"stream">>,
        <<"value">> => #{
            <<"title">> => <<"Native upload">>,
            <<"source">> => #{<<"media_type">> => <<"video/mp4">>}
        }
    },
    Record = #{
        <<"record-id">> => RecordID,
        <<"data-id">> => DataID,
        <<"claim">> => Claim
    },
    Document = search_document(Record, Claim, #{}),
    ?assertEqual(DataID, maps:get(<<"doc_id">>, Document)),
    ?assertEqual(RecordID, maps:get(<<"immutable_id">>, Document)),
    ?assertEqual(DataID, maps:get(<<"claim_id">>, Document)),
    ?assertEqual(RecordID, maps:get(<<"record_id">>, Document)),
    ?assertEqual(DataID, maps:get(<<"data_id">>, Document)),
    ?assertEqual(DataID, maps:get(<<"txid">>, Document)),
    ?assertEqual(<<"active">>, maps:get(<<"state">>, Document)),
    ?assert(claim_ids_match(Claim, #{<<"claim_ids">> => [DataID]}, #{})),
    ?assert(maps:get(<<"search_rank">>, Document) >= 0).

search_rank_balances_recency_views_and_subscribers_test() ->
    Now = 2000000000,
    Fresh = search_rank(#{timestamp => Now}, Now),
    FreshWithChannel = search_rank(#{timestamp => Now, has_channel => 1}, Now),
    OneYearOld = search_rank(#{timestamp => Now - 365 * 86400}, Now),
    OldPopular = search_rank(
        #{
            timestamp => Now - 10 * 365 * 86400,
            view_count => 100000000
        },
        Now
    ),
    Maximum = search_rank(
        #{
            timestamp => Now,
            view_count => 1000000000,
            sub_count => 1000000000
        },
        Now
    ),
    ?assertEqual(10.0, Fresh),
    ?assertEqual(10.5, FreshWithChannel),
    ?assertEqual(5.0, OneYearOld),
    ?assert(Fresh > OldPopular),
    ?assert(Maximum =< 20.5).

search_device_result_rejects_error_responses_test() ->
    ?assertEqual(
        {error, {search_device_status, 503, #{ <<"reason">> => <<"terminating">> }}},
        search_device_result(
            {ok, #{
                <<"status">> => 503,
                <<"error">> => #{ <<"reason">> => <<"terminating">> }
            }},
            #{}
        )
    ),
    ?assertEqual(ok, search_device_result({ok, #{ <<"status">> => 202 }}, #{})).

search_pending_state_roundtrip_test() ->
    Opts = test_opts(),
    Event = #{
        <<"operation">> => <<"index">>,
        <<"record-id">> => <<"pending-record-id">>
    },
    Key = search_pending_key(Event, Opts),
    ok = best_effort_queue_search_pending(Event, Opts),
    ?assertEqual(Event, maps:get(Key, read_search_pending(Opts))),
    ok = best_effort_clear_search_pending(Event, Opts),
    ?assertEqual(#{}, read_search_pending(Opts)).

search_pending_concurrent_updates_need_no_lock_test() ->
    % Each pending operation is its own message, so concurrent queueing has
    % no read-modify-write cycle to serialize.
    Opts = test_opts(),
    Parent = self(),
    Refs = [
        begin
            Ref = make_ref(),
            spawn(fun() ->
                Event = #{
                    <<"operation">> => <<"index">>,
                    <<"record-id">> => <<"concurrent-", (integer_to_binary(Index))/binary>>
                },
                Parent ! {Ref, best_effort_queue_search_pending(Event, Opts)}
            end),
            Ref
        end
     || Index <- lists:seq(1, 12)
    ],
    lists:foreach(
        fun(Ref) ->
            receive
                {Ref, Result} -> ?assertEqual(ok, Result)
            after 5000 ->
                ?assert(false)
            end
        end,
        Refs
    ),
    ?assertEqual(12, map_size(read_search_pending(Opts))).

reindex_operator_gate_rejects_unsigned_on_claimed_node_test() ->
    Operator = ar_wallet:new(),
    Opts =
        (test_opts())#{
            <<"priv-wallet">> => Operator,
            <<"operator">> => hb_util:human_id(ar_wallet:to_address(Operator))
        },
    ?assertMatch(
        {ok, #{<<"status">> := 403}},
        reindex(#{}, #{<<"limit">> => 1}, Opts)
    ).

upload_owner_is_stable_across_signing_wallets_with_same_token_test() ->
    Opts = test_opts(),
    Token = <<"stable-user-token">>,
    DataID = <<"data-token-owned-1">>,
    IndexPayload = #{
        <<"data_id">> => DataID,
        <<"name">> => <<"token-owned">>,
        <<"content_type">> => <<"video/mp4">>,
        <<"size">> => 10,
        <<"metadata">> => #{ <<"title">> => <<"Before">> }
    },
    %% First session: wallet A signs, but the Bearer token carries the identity.
    ReqA = (signed(params64_req(IndexPayload), Opts))#{ <<"authorization">> => <<"Bearer ", Token/binary>> },
    {ok, IndexRes} = index(#{}, ReqA, Opts),
    IndexBody = hb_json:decode(hb_maps:get(<<"body">>, IndexRes, Opts)),
    RecordID = hb_maps:get(<<"record-id">>, IndexBody, Opts),
    ?assertEqual(token_secret(Token), hb_maps:get(<<"owner">>, hb_maps:get(<<"record">>, IndexBody, Opts), Opts)),
    %% Second session: a DIFFERENT signing wallet, same token -> edit succeeds.
    UpdatePayload = #{ <<"record_id">> => RecordID, <<"metadata">> => #{ <<"title">> => <<"After">> } },
    ReqB = (signed(params64_req(UpdatePayload), Opts))#{ <<"authorization">> => <<"Bearer ", Token/binary>> },
    {ok, UpdateRes} = update(#{}, ReqB, Opts),
    UpdateBody = hb_json:decode(hb_maps:get(<<"body">>, UpdateRes, Opts)),
    [UpdatedClaim] = hb_maps:get(<<"outputs">>, UpdateBody, Opts),
    ?assertEqual(<<"After">>, hb_maps:get(<<"title">>, hb_maps:get(<<"value">>, UpdatedClaim, Opts), Opts)),
    %% A different token must NOT be able to edit.
    ReqC = (signed(params64_req(UpdatePayload), Opts))#{ <<"authorization">> => <<"Bearer other-token">> },
    ?assertMatch({error, #{ <<"status">> := 403 }}, update(#{}, ReqC, Opts)).

upload_update_and_delete_roundtrip_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    DataID = <<"data-update-1">>,
    IndexPayload = #{
        <<"data_id">> => DataID,
        <<"name">> => <<"update-demo">>,
        <<"filename">> => <<"update-demo.mp4">>,
        <<"content_type">> => <<"video/mp4">>,
        <<"size">> => 10,
        <<"metadata">> => #{
            <<"title">> => <<"Before">>,
            <<"video">> => #{ <<"duration">> => 42 }
        }
    },
    {ok, IndexRes} = index(#{}, signed_with(params64_req(IndexPayload), Wallet, Opts), Opts),
    IndexBody = hb_json:decode(hb_maps:get(<<"body">>, IndexRes, Opts)),
    RecordID = hb_maps:get(<<"record-id">>, IndexBody, Opts),
    [IndexClaim] = hb_maps:get(<<"outputs">>, IndexBody, Opts),
    IndexValue = hb_maps:get(<<"value">>, IndexClaim, Opts),
    ?assertEqual(<<"Before">>, hb_maps:get(<<"title">>, IndexValue, Opts)),
    ?assertEqual(42, hb_maps:get(<<"duration">>, hb_maps:get(<<"video">>, IndexValue, Opts), Opts)),
    UpdatePayload = #{
        <<"record_id">> => RecordID,
        <<"metadata">> => #{ <<"title">> => <<"After">> }
    },
    ?assertMatch(
        {error, #{ <<"status">> := 403 }},
        update(#{}, signed(params64_req(UpdatePayload), Opts), Opts)
    ),
    {ok, UpdateRes} = update(#{}, signed_with(params64_req(UpdatePayload), Wallet, Opts), Opts),
    UpdateBody = hb_json:decode(hb_maps:get(<<"body">>, UpdateRes, Opts)),
    NewRecordID = hb_maps:get(<<"record-id">>, UpdateBody, Opts),
    [UpdatedClaim] = hb_maps:get(<<"outputs">>, UpdateBody, Opts),
    UpdatedValue = hb_maps:get(<<"value">>, UpdatedClaim, Opts),
    ?assertEqual(<<"After">>, hb_maps:get(<<"title">>, UpdatedValue, Opts)),
    ?assertNotEqual(RecordID, NewRecordID),
    UpdatedVideo = hb_maps:get(<<"video">>, UpdatedValue, Opts),
    ?assertEqual(42, hb_maps:get(<<"duration">>, UpdatedVideo, Opts)),
    ?assertEqual(not_found, hb_maps:get(<<"commitments">>, UpdatedVideo, not_found, Opts)),
    ?assertEqual(DataID, hb_maps:get(<<"claim_id">>, UpdatedClaim, Opts)),
    {ok, ListRes} = list(#{}, #{ <<"name">> => <<"update-demo">> }, Opts),
    ListBody = hb_json:decode(hb_maps:get(<<"body">>, ListRes, Opts)),
    ListItems = hb_maps:get(<<"items">>, hb_maps:get(<<"result">>, ListBody, Opts), Opts),
    ?assertEqual(1, length(ListItems)),
    ?assertEqual(
        <<"After">>,
        hb_maps:get(<<"title">>, hb_maps:get(<<"value">>, hd(ListItems), Opts), Opts)
    ),
    DeletePayload = #{ <<"record_id">> => NewRecordID },
    ?assertMatch(
        {error, #{ <<"status">> := 403 }},
        delete(#{}, signed(params64_req(DeletePayload), Opts), Opts)
    ),
    {ok, DeleteRes} = delete(#{}, signed_with(params64_req(DeletePayload), Wallet, Opts), Opts),
    DeleteBody = hb_json:decode(hb_maps:get(<<"body">>, DeleteRes, Opts)),
    ?assertEqual(true, hb_maps:get(<<"deleted">>, DeleteBody, Opts)),
    {ok, ListAfterDelete} = list(#{}, #{ <<"name">> => <<"update-demo">> }, Opts),
    ListAfterBody = hb_json:decode(hb_maps:get(<<"body">>, ListAfterDelete, Opts)),
    ?assertEqual(
        [],
        hb_maps:get(<<"items">>, hb_maps:get(<<"result">>, ListAfterBody, Opts), Opts)
    ),
    ?assertMatch({error, _}, resolve_record(#{}, #{ <<"claim-id">> => DataID }, Opts)),
    ?assertMatch({error, _}, indexed_record_id(NewRecordID, Opts)).

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

upload_chunked_manifest_reads_media_test() ->
    Opts = test_opts(),
    {ok, Chunk1} = chunk(#{}, signed(#{ <<"body">> => <<"hello ">> }, Opts), Opts),
    {ok, Chunk2} = chunk(#{}, signed(#{ <<"body">> => <<"world">> }, Opts), Opts),
    ChunkID1 = hb_maps:get(<<"id">>, Chunk1, Opts),
    ChunkID2 = hb_maps:get(<<"id">>, Chunk2, Opts),
    Manifest =
        hb_json:encode(#{
            <<"type">> => ?CHUNKED_MANIFEST_KIND,
            <<"version">> => 1,
            <<"size">> => 11,
            <<"chunks">> => [
                #{ <<"id">> => ChunkID1, <<"size">> => 6 },
                #{ <<"id">> => ChunkID2, <<"size">> => 5 }
            ]
        }),
    Req =
        signed(
            #{
                <<"body">> => Manifest,
                <<"name">> => <<"chunked-demo">>,
                <<"content-type">> => <<"text/plain">>,
                <<"chunked_manifest">> => true,
                <<"size">> => 11
            },
            Opts
        ),
    {ok, Res} = submit(#{}, Req, Opts),
    Record = hb_maps:get(<<"record">>, Res, Opts),
    ?assertEqual(<<"chunked-manifest">>, hb_maps:get(<<"data-kind">>, Record, Opts)),
    ?assertEqual(11, hb_maps:get(<<"byte-size">>, Record, Opts)),
    Source =
        hb_maps:get(
            <<"source">>,
            hb_maps:get(<<"value">>, hd(hb_maps:get(<<"outputs">>, Res, Opts)), Opts),
            Opts
        ),
    ?assertEqual(<<"11">>, hb_maps:get(<<"size">>, Source, Opts)),
    {ok, Media} = media(#{}, #{ <<"id">> => hb_maps:get(<<"record-id">>, Res, Opts) }, Opts),
    ?assertEqual(<<"hello world">>, hb_maps:get(<<"body">>, Media, Opts)),
    ?assertEqual(<<"text/plain">>, hb_maps:get(<<"content-type">>, Media, Opts)).

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
    % Aliases are pointer messages now, resolved through the lookup API
    % rather than read from bare-binary index paths.
    {ok, IndexedRecordID} = indexed_record_id(URI, Opts),
    ?assertEqual(RecordID, IndexedRecordID),
    {ok, Record0} = hb_cache:read(RecordID, Opts),
    Record = enrich_record(RecordID, hb_cache:ensure_all_loaded(Record0, Opts), Opts),
    Claim = hb_maps:get(<<"claim">>, Record, Opts),
    ?assertEqual(RecordID, hb_maps:get(<<"claim-id">>, Claim, Opts)),
    % Validity is never asserted without a real channel signature.
    ?assertEqual(
        not_found,
        hb_maps:get(<<"is_channel_signature_valid">>, Claim, not_found, Opts)
    ),
    {ok, Media} = media(#{}, #{ <<"id">> => RecordID }, Opts),
    ?assertEqual(<<"native media">>, hb_maps:get(<<"body">>, Media, Opts)).

upload_list_indexes_all_channel_and_name_test() ->
    Opts = test_opts(),
    Req1 = signed(#{
        <<"body">> => <<"one">>,
        <<"name">> => <<"first-upload">>,
        <<"metadata">> => #{
            <<"title">> => <<"First Upload">>,
            <<"release_time">> => 100,
            <<"channel">> => #{
                <<"claim_id">> => <<"channel-1">>,
                <<"name">> => <<"@one">>,
                <<"short_url">> => <<"lbry://@one#channel-1">>
            }
        }
    }, Opts),
    Req2 = signed(#{
        <<"body">> => <<"two">>,
        <<"name">> => <<"second-upload">>,
        <<"metadata">> => #{
            <<"title">> => <<"Second Upload">>,
            <<"release_time">> => 200,
            <<"channel">> => #{
                <<"claim_id">> => <<"channel-2">>,
                <<"name">> => <<"@two">>,
                <<"short_url">> => <<"lbry://@two#channel-2">>
            }
        }
    }, Opts),
    {ok, Res1} = submit(#{}, Req1, Opts),
    {ok, Res2} = submit(#{}, Req2, Opts),
    RecordID1 = hb_maps:get(<<"record-id">>, Res1, Opts),
    RecordID2 = hb_maps:get(<<"record-id">>, Res2, Opts),
    {ok, All} = list(#{}, #{ <<"page_size">> => 10 }, Opts),
    AllBody = hb_json:decode(hb_maps:get(<<"body">>, All, Opts)),
    AllItems = hb_maps:get(<<"items">>, AllBody, Opts),
    ?assertEqual(2, length(AllItems)),
    ?assertEqual(RecordID2, hb_maps:get(<<"claim_id">>, hd(AllItems), Opts)),
    {ok, ChannelList} = list(#{}, #{ <<"channel_ids">> => [<<"channel-1">>] }, Opts),
    ChannelBody = hb_json:decode(hb_maps:get(<<"body">>, ChannelList, Opts)),
    [ChannelItem] = hb_maps:get(<<"items">>, ChannelBody, Opts),
    ?assertEqual(RecordID1, hb_maps:get(<<"claim_id">>, ChannelItem, Opts)),
    {ok, NameList} = list(#{}, #{ <<"name">> => <<"second-upload">> }, Opts),
    NameBody = hb_json:decode(hb_maps:get(<<"body">>, NameList, Opts)),
    [NameItem] = hb_maps:get(<<"items">>, NameBody, Opts),
    ?assertEqual(RecordID2, hb_maps:get(<<"claim_id">>, NameItem, Opts)).

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
        <<"x-odysee-auth-token">> => Token,
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
                <<"x-odysee-auth-token">> => Token
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
        <<"when">> => #{ <<"keys">> => [<<"x-odysee-auth-token">>, <<"!">>] },
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

signed_with(Msg, Wallet, Opts) ->
    hb_message:commit(Msg, Opts#{ <<"priv-wallet">> => Wallet }).

params64_req(Payload) ->
    #{
        <<"params64">> => hb_util:encode(hb_json:encode(Payload)),
        <<"content-type">> => <<"application/json">>
    }.

test_opts() ->
    % Match-capable store: index/list/pending discovery goes through the
    % store's reverse-index match, which lmdb supports (fs does not).
    Store = hb_test_utils:test_store(hb_store_lmdb),
    ok = hb_store:start(Store),
    ok = hb_store:reset(Store),
    #{
        <<"store">> => Store,
        <<"cache-control">> => [<<"no-cache">>, <<"no-store">>],
        <<"store-all-signed">> => false,
        % Records are committed with the node wallet before caching.
        <<"priv-wallet">> => ar_wallet:new()
    }.

-endif.
