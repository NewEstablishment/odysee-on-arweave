-module(dev_odysee_sync).
-implements(<<"odysee-sync@1.0">>).
-export([info/1, snapshot/3, restore/3, pull/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-sync@1.0">>).

info(_Opts) ->
    #{ exports => [<<"snapshot">>, <<"restore">>, <<"pull">>] }.

snapshot(_Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                Uploads = upload_snapshot(Opts),
                Comments = comment_snapshot(Opts),
                Result = #{
                    <<"device">> => ?DEVICE,
                    <<"version">> => <<"1">>,
                    <<"generated-at">> => erlang:system_time(second),
                    <<"uploads">> => Uploads,
                    <<"comments">> => Comments,
                    <<"counts">> => #{
                        <<"uploads">> => length(Uploads),
                        <<"comments">> => length(Comments)
                    }
                },
                {ok, response(Result)}
            end)
    end.

restore(_Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    ok ?= require_signed_request(Req, Opts),
                    {ok, Payload} ?= restore_payload(Req, Opts),
                    {ok, Result} ?= restore_snapshot(Payload, Opts),
                    {ok, response(Result#{ <<"device">> => ?DEVICE })}
                else
                    Error -> Error
                end
            end)
    end.

pull(Base, Req, Opts) ->
    case method(Req, Opts) of
        <<"options">> ->
            {ok, cors_preflight_response()};
        _ ->
            safe(fun() ->
                maybe
                    ok ?= require_signed_request(Req, Opts),
                    {ok, Node} ?= remote_node(Base, Req, Opts),
                    {ok, Payload} ?= fetch_remote_snapshot(Node, Opts),
                    {ok, Result} ?= restore_snapshot(Payload, Opts),
                    {ok, response(Result#{
                        <<"device">> => ?DEVICE,
                        <<"pulled-from">> => Node
                    })}
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

restore_snapshot(Payload, Opts) ->
    maybe
        {ok, UploadCount} ?= restore_uploads(hb_maps:get(<<"uploads">>, Payload, [], Opts), Opts),
        {ok, CommentCount} ?= restore_comments(hb_maps:get(<<"comments">>, Payload, [], Opts), Opts),
        {ok, #{
            <<"restored">> => true,
            <<"uploads">> => UploadCount,
            <<"comments">> => CommentCount
        }}
    end.

remote_node(Base, Req, Opts) ->
    Payload =
        case request_payload(Req, Opts) of
            {ok, Decoded} when is_map(Decoded) -> Decoded;
            _ -> #{}
        end,
    Keys = [
        <<"node">>,
        <<"remote">>,
        <<"remote-node">>,
        <<"remote_node">>,
        <<"from">>,
        <<"url">>
    ],
    case first_found(
        [{Payload, Key} || Key <- Keys] ++
        [{Req, Key} || Key <- Keys] ++
        [{Base, Key} || Key <- Keys],
        Opts
    ) of
        not_found ->
            {error, #{ <<"status">> => 400, <<"body">> => <<"Remote node required.">> }};
        Node ->
            {ok, trim_trailing_slashes(hb_util:bin(Node))}
    end.

fetch_remote_snapshot(Node, Opts) ->
    Msg = #{
        <<"method">> => <<"GET">>,
        <<"path">> => snapshot_url(Node),
        <<"accept">> => <<"application/json">>
    },
    case hb_http:request(Msg, Opts) of
        {ok, #{ <<"body">> := Body }} when is_binary(Body) ->
            snapshot_from_response_body(Body, Opts);
        {ok, Body} when is_binary(Body) ->
            snapshot_from_response_body(Body, Opts);
        {ok, _Other} ->
            {error, #{ <<"status">> => 502, <<"body">> => <<"Remote snapshot response without body.">> }};
        Error ->
            Error
    end.

snapshot_from_response_body(Body, Opts) ->
    maybe
        {ok, Decoded} ?= try_decode_json(Body),
        {ok, snapshot_response_payload(Decoded, Opts)}
    end.

snapshot_response_payload(Msg, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"body">>, Msg, not_found, Opts) of
        Body when is_binary(Body) ->
            case try_decode_json(Body) of
                {ok, DecodedBody} when is_map(DecodedBody) ->
                    snapshot_response_payload(DecodedBody, Opts);
                _ ->
                    snapshot_result_payload(Msg, Opts)
            end;
        _ ->
            snapshot_result_payload(Msg, Opts)
    end;
snapshot_response_payload(Value, _Opts) ->
    Value.

snapshot_result_payload(Msg, Opts) ->
    case hb_maps:get(<<"result">>, Msg, not_found, Opts) of
        not_found -> Msg;
        Result -> Result
    end.

snapshot_url(Node) ->
    <<Node/binary, "/~odysee-sync@1.0/snapshot">>.

trim_trailing_slashes(Bin) when is_binary(Bin), byte_size(Bin) > 0 ->
    RestSize = byte_size(Bin) - 1,
    case Bin of
        <<Rest:RestSize/binary, "/">> -> trim_trailing_slashes(Rest);
        _ -> Bin
    end;
trim_trailing_slashes(Bin) ->
    Bin.

require_signed_request(Req, Opts) ->
    case request_signers(Req, Opts) of
        [] ->
            {error, #{
                <<"status">> => 401,
                <<"body">> => <<"Signed restore request required.">>
            }};
        _ ->
            case request_signature_valid(Req, Opts) of
                true -> ok;
                _ ->
                    {error, #{
                        <<"status">> => 401,
                        <<"body">> => <<"Invalid restore request signature.">>
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

restore_payload(Req, Opts) ->
    maybe
        {ok, Payload} ?= request_payload(Req, Opts),
        {ok, restore_snapshot_payload(Payload, Opts)}
    end.

restore_snapshot_payload(Payload0, Opts) ->
    case first_field([<<"snapshot">>, <<"payload">>], Payload0, Opts) of
        Payload when is_map(Payload) ->
            Payload;
        _ ->
            Payload0
    end.

request_payload(Req, Opts) ->
    case first_field([<<"params64">>, <<"params-64">>], Req, Opts) of
        not_found ->
            request_body_payload(Req, Opts);
        Encoded ->
            case decode_params64(Encoded) of
                {ok, Decoded} when is_map(Decoded) -> {ok, Decoded};
                {ok, _} -> {error, invalid_sync_params};
                Error -> Error
            end
    end.

request_body_payload(Req, Opts) ->
    case hb_maps:get(<<"body">>, Req, not_found, Opts) of
        Body when is_binary(Body) ->
            try_decode_json(Body);
        _ ->
            {ok, without_control_keys(Req)}
    end.

decode_params64(Encoded) ->
    try {ok, hb_json:decode(hb_util:decode(Encoded))}
    catch _:_ -> {error, invalid_sync_params64}
    end.

upload_snapshot(Opts) ->
    IDs = upload_ids(Opts),
    lists:filtermap(fun(ID) -> upload_snapshot_entry(ID, Opts) end, IDs).

upload_snapshot_entry(RecordID, Opts) ->
    case hb_cache:read(RecordID, Opts) of
        {ok, Record0} when is_map(Record0) ->
            Record = hb_cache:ensure_all_loaded(Record0, Opts),
            case hb_maps:get(<<"data-id">>, Record, not_found, Opts) of
                DataID when is_binary(DataID) ->
                    case hb_cache:read(DataID, Opts) of
                        {ok, Bytes} when is_binary(Bytes) ->
                            {true, #{
                                <<"record-id">> => RecordID,
                                <<"data-id">> => DataID,
                                <<"record">> => Record,
                                <<"content-base64">> => base64:encode(Bytes)
                            }};
                        _ ->
                            false
                    end;
                _ ->
                    false
            end;
        _ ->
            false
    end.

restore_uploads(Uploads, Opts) when is_list(Uploads) ->
    lists:foldl(
        fun
            (_Entry, {error, _} = Error) ->
                Error;
            (Entry, {ok, Count}) ->
                case restore_upload(Entry, Opts) of
                    ok -> {ok, Count + 1};
                    Error -> Error
                end
        end,
        {ok, 0},
        Uploads
    );
restore_uploads(_Uploads, _Opts) ->
    {error, invalid_upload_snapshot}.

restore_upload(Entry, Opts) when is_map(Entry) ->
    maybe
        {ok, Record0} ?= required_map(<<"record">>, Entry, Opts),
        {ok, Bytes} ?= decode_content(first_field([<<"content-base64">>, <<"content_base64">>], Entry, Opts)),
        {ok, DataID} ?= hb_cache:write(Bytes, Opts),
        ok ?= assert_expected_id(<<"data-id">>, DataID, [Entry, Record0], Opts),
        Record = Record0#{ <<"data-id">> => DataID },
        {ok, RecordID} ?= hb_cache:write(Record, Opts),
        ok ?= assert_expected_id(<<"record-id">>, RecordID, [Entry], Opts),
        write_upload_indexes(enrich_upload_record(RecordID, Record, Opts), Opts)
    end;
restore_upload(_Entry, _Opts) ->
    {error, invalid_upload_snapshot_entry}.

comment_snapshot(Opts) ->
    IDs = comment_ids(Opts),
    lists:filtermap(fun(ID) -> comment_snapshot_entry(ID, Opts) end, IDs).

comment_snapshot_entry(CommentID, Opts) ->
    case read_comment(CommentID, Opts) of
        {ok, Comment} ->
            {true, #{
                <<"comment-id">> => CommentID,
                <<"comment">> => Comment
            }};
        not_found ->
            false
    end.

restore_comments(Comments, Opts) when is_list(Comments) ->
    lists:foldl(
        fun
            (_Entry, {error, _} = Error) ->
                Error;
            (Entry, {ok, Count}) ->
                case restore_comment(Entry, Opts) of
                    ok -> {ok, Count + 1};
                    Error -> Error
                end
        end,
        {ok, 0},
        Comments
    );
restore_comments(_Comments, _Opts) ->
    {error, invalid_comment_snapshot}.

restore_comment(Entry, Opts) ->
    case comment_from_entry(Entry, Opts) of
        {ok, Comment} ->
            write_public_comment(Comment, Opts);
        Error ->
            Error
    end.

comment_from_entry(#{ <<"comment">> := Comment }, _Opts) when is_map(Comment) ->
    {ok, Comment};
comment_from_entry(Comment, _Opts) when is_map(Comment) ->
    {ok, Comment};
comment_from_entry(_Entry, _Opts) ->
    {error, invalid_comment_snapshot_entry}.

upload_ids(Opts) ->
    Store = hb_opts:get(store, [], Opts),
    case Store of
        [] -> [];
        _ -> read_index(Store, upload_list_index_path(<<"all">>, <<"all">>), Opts)
    end.

comment_ids(Opts) ->
    Store = hb_opts:get(store, [], Opts),
    case Store of
        [] -> [];
        _ -> read_index(Store, public_comment_list_index_path(<<"all">>, <<"all">>), Opts)
    end.

read_comment(CommentID, Opts) ->
    Store = hb_opts:get(store, [], Opts),
    case Store of
        [] ->
            not_found;
        _ ->
            case hb_store:read(Store, public_comment_record_path(CommentID), maps:without([<<"store">>, store], Opts)) of
                {ok, Raw} -> decode_comment(Raw);
                Raw when is_binary(Raw) -> decode_comment(Raw);
                _ -> not_found
            end
    end.

decode_comment(Raw) when is_binary(Raw) ->
    try hb_json:decode(Raw) of
        Comment when is_map(Comment) -> {ok, Comment};
        _ -> not_found
    catch _:_ ->
        not_found
    end;
decode_comment(_Raw) ->
    not_found.

write_upload_indexes(Record, Opts) ->
    Store = hb_opts:get(store, [], Opts),
    RecordID = hb_maps:get(<<"record-id">>, Record, not_found, Opts),
    case {Store, RecordID} of
        {[], _} ->
            ok;
        {_, not_found} ->
            ok;
        _ ->
            Indexes = upload_indexes(Record, Opts),
            case hb_store:write(Store, maps:from_list([{Path, RecordID} || Path <- Indexes]), Opts) of
                ok -> write_upload_list_indexes(Store, Record, Opts);
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
            upload_index_path(Type, Value)
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

write_upload_list_indexes(Store, Record, Opts) ->
    RecordID = hb_maps:get(<<"record-id">>, Record, not_found, Opts),
    Paths = upload_list_indexes(Record, Opts),
    lists:foldl(
        fun(Path, ok) -> append_index(Store, Path, RecordID, Opts);
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
            upload_list_index_path(Type, Value)
        ||
            {Type, Value} <- Values,
            is_binary(Value),
            Value =/= <<>>,
            Value =/= not_found
        ]
    ).

write_public_comment(Comment, Opts) ->
    Store = hb_opts:get(store, [], Opts),
    CommentID = first_field([<<"comment_id">>, <<"comment-id">>, <<"id">>], Comment, Opts),
    case {Store, CommentID} of
        {[], _} ->
            ok;
        {_, not_found} ->
            ok;
        _ ->
            case hb_store:write(Store, #{ public_comment_record_path(CommentID) => hb_json:encode(Comment) }, Opts) of
                ok -> write_public_comment_indexes(Store, Comment, Opts);
                Error -> Error
            end
    end.

write_public_comment_indexes(Store, Comment, Opts) ->
    CommentID = first_field([<<"comment_id">>, <<"comment-id">>, <<"id">>], Comment, Opts),
    Paths = public_comment_list_indexes(Comment, Opts),
    lists:foldl(
        fun(Path, ok) -> append_index(Store, Path, CommentID, Opts);
           (_Path, Error) -> Error
        end,
        ok,
        Paths
    ).

public_comment_list_indexes(Comment, Opts) ->
    ClaimID = first_field([<<"claim_id">>, <<"claim-id">>], Comment, Opts),
    ChannelID = first_field([<<"channel_id">>, <<"channel-id">>], Comment, Opts),
    Values = [
        {<<"all">>, <<"all">>},
        {<<"claim">>, ClaimID},
        {<<"channel">>, ChannelID}
    ],
    lists:usort(
        [
            public_comment_list_index_path(Type, Value)
        ||
            {Type, Value} <- Values,
            is_binary(Value),
            Value =/= <<>>,
            Value =/= not_found
        ]
    ).

append_index(Store, Path, ID, Opts) ->
    Existing = read_index(Store, Path, Opts),
    Updated = dedupe_binaries([ID | Existing]),
    hb_store:write(Store, #{ Path => hb_json:encode(Updated) }, Opts).

read_index(Store, Path, Opts) ->
    case hb_store:read(Store, Path, maps:without([<<"store">>, store], Opts)) of
        {ok, Raw} -> decode_index(Raw);
        Raw when is_binary(Raw) -> decode_index(Raw);
        _ -> []
    end.

decode_index(Raw) when is_binary(Raw) ->
    try hb_json:decode(Raw) of
        IDs when is_list(IDs) -> [ID || ID <- IDs, is_binary(ID), ID =/= <<>>];
        #{ <<"ids">> := IDs } when is_list(IDs) -> [ID || ID <- IDs, is_binary(ID), ID =/= <<>>];
        _ -> []
    catch _:_ ->
        []
    end;
decode_index(_Raw) ->
    [].

enrich_upload_record(RecordID, Record0, Opts) ->
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

upload_index_path(Type, Value) ->
    <<"odysee/upload/", Type/binary, "/", (hb_util:encode(hb_crypto:sha256(Value)))/binary>>.

upload_list_index_path(Type, Value) ->
    <<"odysee/upload/list/", Type/binary, "/", (hb_util:encode(hb_crypto:sha256(Value)))/binary>>.

public_comment_record_path(CommentID) ->
    <<"odysee/comment/local/id/", (hb_util:encode(hb_crypto:sha256(CommentID)))/binary>>.

public_comment_list_index_path(Type, Value) ->
    <<"odysee/comment/local/list/", Type/binary, "/", (hb_util:encode(hb_crypto:sha256(Value)))/binary>>.

assert_expected_id(Key, Actual, Sources, Opts) ->
    case first_present_field(Key, Sources, Opts) of
        not_found -> ok;
        Actual -> ok;
        Expected -> {error, #{ <<"status">> => 409, <<"body">> => <<"Snapshot ID mismatch.">>, <<"key">> => Key, <<"expected">> => Expected, <<"actual">> => Actual }}
    end.

first_present_field(_Key, [], _Opts) ->
    not_found;
first_present_field(Key, [Source | Rest], Opts) ->
    case hb_maps:get(Key, Source, not_found, Opts) of
        not_found -> first_present_field(Key, Rest, Opts);
        Value -> Value
    end.

required_map(Key, Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        Value when is_map(Value) -> {ok, Value};
        _ -> {error, #{ <<"status">> => 400, <<"body">> => <<"Invalid snapshot record.">> }}
    end.

decode_content(not_found) ->
    {error, #{ <<"status">> => 400, <<"body">> => <<"Missing snapshot content.">> }};
decode_content(Encoded) ->
    try {ok, base64:decode(Encoded)}
    catch _:_ -> {error, #{ <<"status">> => 400, <<"body">> => <<"Invalid snapshot content.">> }}
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
        <<"accept-language">>,
        <<"authorization">>,
        <<"body">>,
        <<"connection">>,
        <<"content-type">>,
        <<"cookie">>,
        <<"device">>,
        <<"host">>,
        <<"method">>,
        <<"origin">>,
        <<"path">>,
        <<"referer">>,
        <<"sec-fetch-dest">>,
        <<"sec-fetch-mode">>,
        <<"sec-fetch-site">>,
        <<"user-agent">>
    ].

lower_key(Key) when is_binary(Key) ->
    hb_util:to_lower(Key);
lower_key(Key) ->
    hb_util:to_lower(hb_ao:normalize_key(Key)).

try_decode_json(Raw) ->
    try {ok, hb_json:decode(Raw)}
    catch _:_ -> {error, #{ <<"status">> => 400, <<"body">> => <<"Invalid snapshot JSON.">> }}
    end.

method(Req, Opts) ->
    hb_util:to_lower(hb_util:bin(hb_maps:get(<<"method">>, Req, <<"GET">>, Opts))).

response(Result) ->
    Msg = (cors_headers())#{
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"result">> => Result
    },
    Msg#{ <<"body">> => hb_json:encode(Msg) }.

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
        <<"access-control-allow-methods">> => <<"GET,POST,OPTIONS">>,
        <<"access-control-allow-headers">> =>
            <<"Content-Type,Accept,Authorization,X-Lbry-Auth-Token">>,
        <<"access-control-expose-headers">> => <<"Content-Length">>
    }.

-ifdef(TEST).

snapshot_restore_roundtrip_test() ->
    SourceOpts = test_opts(<<"source">>),
    TargetOpts = test_opts(<<"target">>),
    {ok, DataID} = hb_cache:write(<<"local media">>, SourceOpts),
    Record0 = #{
        <<"device">> => <<"odysee-upload@1.0">>,
        <<"owner">> => <<"owner-1">>,
        <<"data-id">> => DataID,
        <<"byte-size">> => 11,
        <<"content-type">> => <<"video/mp4">>,
        <<"filename">> => <<"clip.mp4">>,
        <<"created-at">> => <<"1">>,
        <<"metadata">> => #{},
        <<"claim">> => #{
            <<"name">> => <<"clip">>,
            <<"value_type">> => <<"stream">>,
            <<"timestamp">> => 1,
            <<"value">> => #{ <<"release_time">> => 1 },
            <<"signing_channel">> => #{
                <<"claim_id">> => <<"chan-1">>,
                <<"name">> => <<"@chan">>
            }
        }
    },
    {ok, RecordID} = hb_cache:write(Record0, SourceOpts),
    ok = write_upload_indexes(enrich_upload_record(RecordID, Record0, SourceOpts), SourceOpts),
    Comment = #{
        <<"comment_id">> => <<"comment-1">>,
        <<"id">> => <<"comment-1">>,
        <<"claim_id">> => <<"claim-1">>,
        <<"comment">> => <<"hello">>,
        <<"channel_id">> => <<"chan-1">>,
        <<"channel_name">> => <<"@chan">>,
        <<"channel_url">> => <<"lbry://@chan#chan-1">>,
        <<"timestamp">> => 1
    },
    ok = write_public_comment(Comment, SourceOpts),
    {ok, SnapshotMsg} = snapshot(#{}, #{}, SourceOpts),
    Snapshot = hb_maps:get(<<"result">>, SnapshotMsg, SourceOpts),
    RestoreReq = hb_message:commit(
        #{ <<"snapshot">> => Snapshot },
        TargetOpts#{ <<"priv-wallet">> => ar_wallet:new() }
    ),
    {ok, RestoreMsg} = restore(#{}, RestoreReq, TargetOpts),
    RestoreResult = hb_maps:get(<<"result">>, RestoreMsg, TargetOpts),
    ?assertEqual(1, hb_maps:get(<<"uploads">>, RestoreResult, TargetOpts)),
    ?assertEqual(1, hb_maps:get(<<"comments">>, RestoreResult, TargetOpts)),
    {ok, UploadList} = dev_odysee_upload:list(#{}, #{}, TargetOpts),
    [UploadClaim] = hb_maps:get(<<"items">>, UploadList, TargetOpts),
    ?assertEqual(RecordID, hb_maps:get(<<"claim_id">>, UploadClaim, TargetOpts)),
    {ok, CommentList} = dev_odysee_comment:list(
        #{},
        #{
            <<"claim_id">> => <<"claim-1">>,
            <<"top_level">> => true,
            <<"comment-url">> => <<"http://127.0.0.1:1">>
        },
        TargetOpts
    ),
    [RestoredComment] = hb_maps:get(<<"comments">>, CommentList, TargetOpts),
    ?assertEqual(<<"comment-1">>, hb_maps:get(<<"comment-id">>, RestoredComment, TargetOpts)).

test_opts(Name) ->
    Timestamp = integer_to_binary(erlang:unique_integer([positive, monotonic])),
    Store = #{
        <<"store-module">> => hb_store_fs,
        <<"name">> => <<"_build/odysee-sync-test-", Name/binary, "-", Timestamp/binary>>
    },
    ok = hb_store:start(Store),
    ok = hb_store:reset(Store),
    #{
        <<"store">> => Store,
        <<"cache-control">> => [<<"no-cache">>, <<"no-store">>],
        <<"store-all-signed">> => false
    }.

-endif.
