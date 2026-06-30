%%% @doc Read-only Odysee source store.
%%%
%%% This store sources public Odysee objects and returns normalized HyperBEAM
%%% messages carrying source commitments. It is intentionally a
%%% store, not another playback adapter: callers can place it below a local
%%% cache or behind `hb_store_remote_node' and then verify the returned message
%%% through normal `hb_message:verify/3'.
-module(hb_store_odysee).
-export([start/3, stop/3, reset/3, scope/0, scope/1]).
-export([read/3, type/3, resolve/3, list/3]).
-export([write/3, group/3, link/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(ODYSEE_COMMITMENT_DEVICE, <<"odysee@1.0">>).
-define(LBRY_BLOB_COMMITMENT_DEVICE, <<"lbry-blob@1.0">>).
-define(LBRY_STREAM_DESCRIPTOR_COMMITMENT_DEVICE, <<"lbry-stream-descriptor@1.0">>).
-define(LBRY_CLAIM_OUTPUT_COMMITMENT_DEVICE, <<"lbry-claim-output@1.0">>).
-define(LBRY_TRANSACTION_COMMITMENT_DEVICE, <<"lbry-transaction@1.0">>).
-define(SHA384_HEX_SIZE, 96).
-define(DEFAULT_RANGE_SIZE, 1048576).
-define(DEFAULT_BLOB_BASE_URLS, [
    <<"https://blobcache-eu.odycdn.com">>,
    <<"https://blobcache-us.odycdn.com">>,
    <<"https://blobcache.lbry.com">>
]).

start(_StoreOpts, _Req, _NodeOpts) ->
    ok.

stop(_StoreOpts, _Req, _NodeOpts) ->
    ok.

reset(_StoreOpts, _Req, _NodeOpts) ->
    ok.

scope() ->
    remote.

scope(#{ <<"scope">> := Scope }) ->
    Scope;
scope(_StoreOpts) ->
    scope().

resolve(_StoreOpts, #{ <<"resolve">> := Key }, _NodeOpts) ->
    {ok, normalize_key(Key)}.

type(StoreOpts, #{ <<"type">> := Key }, NodeOpts) ->
    case read(StoreOpts, #{ <<"read">> => Key }, NodeOpts) of
        {ok, Msg} when is_map(Msg) -> {ok, composite};
        {ok, _Bin} -> {ok, simple};
        Error -> Error
    end.

list(_StoreOpts, _Req, _NodeOpts) ->
    {error, not_found}.

write(_StoreOpts, _Req, _NodeOpts) ->
    {error, read_only}.

group(_StoreOpts, _Req, _NodeOpts) ->
    {error, read_only}.

link(_StoreOpts, _Req, _NodeOpts) ->
    {error, read_only}.

%% @doc Read a public Odysee object by a stable store path.
read(StoreOpts, Req = #{ <<"read">> := Key }, NodeOpts) ->
    Path = canonical_read_path(normalize_key(Key)),
    case compatibility_path_allowed(Path, StoreOpts, NodeOpts) of
        false ->
            {error, not_found};
        true ->
            case fixture(Path, StoreOpts, NodeOpts) of
                {ok, Msg} ->
                    Type = infer_type(Path, Msg, NodeOpts),
                    commit_result(enrich_surface(Path, Type, Msg), Type, NodeOpts);
                not_found ->
                    read_live(Path, Req, StoreOpts, NodeOpts)
            end
    end.

read_live(<<"odysee/media/stream-id/", Encoded/binary>>, Req, StoreOpts, NodeOpts) ->
    media_from_stream_path(<<"odysee/stream-id/", Encoded/binary>>, Req, StoreOpts, NodeOpts);
read_live(<<"odysee/media/stream/", Encoded/binary>>, Req, StoreOpts, NodeOpts) ->
    media_from_stream_path(<<"odysee/stream/", Encoded/binary>>, Req, StoreOpts, NodeOpts);
read_live(<<"odysee/media/sd-hash/", SDHash/binary>>, Req, StoreOpts, NodeOpts) ->
    media_response(#{ <<"sd-hash">> => SDHash }, Req, store_node_opts(StoreOpts, NodeOpts));
read_live(<<"odysee/media/descriptor/", SDHash/binary>>, Req, StoreOpts, NodeOpts) ->
    media_response(#{ <<"sd-hash">> => SDHash }, Req, store_node_opts(StoreOpts, NodeOpts));
read_live(Path, _Req, StoreOpts, NodeOpts) ->
    read_live(Path, StoreOpts, NodeOpts).

read_live(<<"odysee/claim/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, URI} ?= decode_component(Encoded),
        {ok, Claim} ?=
            hb_ao:raw(
                <<"odysee-claim@1.0">>,
                <<"resolve">>,
                #{},
                #{ <<"url">> => URI },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        commit_result(Claim, <<"claim">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/claim-id/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, ClaimID} ?= decode_component(Encoded),
        {ok, Search} ?=
            hb_ao:raw(
                <<"odysee-claim@1.0">>,
                <<"search">>,
                #{},
                #{ <<"claim_id">> => ClaimID, <<"page_size">> => 1 },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        {ok, Claim} ?= claim_from_search(Search, ClaimID, NodeOpts),
        commit_result(Claim, <<"claim">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/stream/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, URI} ?= decode_component(Encoded),
        {ok, Stream} ?=
            hb_ao:raw(
                <<"odysee-stream@1.0">>,
                <<"stream">>,
                #{},
                #{ <<"url">> => URI },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        commit_result(Stream, <<"stream">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/stream-id/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, ClaimID} ?= decode_component(Encoded),
        {ok, Search} ?=
            hb_ao:raw(
                <<"odysee-claim@1.0">>,
                <<"search">>,
                #{},
                #{
                    <<"claim_id">> => ClaimID,
                    <<"claim_type">> => [<<"stream">>],
                    <<"page_size">> => 1
                },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        {ok, Claim} ?= claim_from_search(Search, ClaimID, NodeOpts),
        {ok, Stream} ?=
            hb_ao:raw(
                <<"odysee-stream@1.0">>,
                <<"stream">>,
                Claim,
                #{},
                store_node_opts(StoreOpts, NodeOpts)
            ),
        commit_result(Stream, <<"stream">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/channel-id/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    read_live(<<"odysee/channel/", Encoded/binary>>, StoreOpts, NodeOpts);
read_live(<<"odysee/channel/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, ChannelID} ?= decode_component(Encoded),
        {ok, Search} ?=
            hb_ao:raw(
                <<"odysee-claim@1.0">>,
                <<"search">>,
                #{},
                #{
                    <<"claim_id">> => ChannelID,
                    <<"claim_type">> => [<<"channel">>],
                    <<"page_size">> => 1
                },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        {ok, Claim} ?= claim_from_search(Search, ChannelID, NodeOpts),
        {ok, Channel} ?=
            hb_ao:raw(
                <<"odysee-channel@1.0">>,
                <<"channel">>,
                #{},
                #{ <<"claim">> => Claim },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        commit_result(Channel, <<"channel">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/claim-proof/", Rest/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, TxID, NOut} ?= claim_proof_path(Rest),
        read_native_outpoint(TxID, NOut, StoreOpts, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/transaction/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, TxID0} ?= decode_component(Encoded),
        TxID = normalize_hex(TxID0),
        ok ?= require_hex_size(TxID, 64, invalid_txid),
        {ok, Transaction} ?=
            hb_ao:raw(
                <<"odysee-claim@1.0">>,
                <<"transaction">>,
                #{},
                #{ <<"txid">> => TxID },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        {ok, Msg} ?= transaction_message(Transaction, TxID, NodeOpts),
        commit_result(Msg, <<"transaction">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/stream-descriptor/", SDHash/binary>>, StoreOpts, NodeOpts) ->
    read_live(<<"odysee/descriptor/", SDHash/binary>>, StoreOpts, NodeOpts);
read_live(<<"odysee/descriptor-id/", SDHash/binary>>, StoreOpts, NodeOpts) ->
    read_live(<<"odysee/descriptor/", SDHash/binary>>, StoreOpts, NodeOpts);
read_live(<<"odysee/descriptor/", SDHash/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, Desc} ?=
            hb_ao:raw(
                <<"odysee-stream-descriptor@1.0">>,
                <<"fetch">>,
                #{},
                #{ <<"sd-hash">> => SDHash },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        commit_result(Desc, <<"stream-descriptor">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/comment-id/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    read_live(<<"odysee/comment/", Encoded/binary>>, StoreOpts, NodeOpts);
read_live(<<"odysee/comment/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, CommentID} ?= decode_component(Encoded),
        {ok, Comment} ?=
            hb_ao:raw(
                <<"odysee-comment@1.0">>,
                <<"by-id">>,
                #{},
                #{ <<"comment-id">> => CommentID },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        commit_result(Comment, <<"comment">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/comment-reaction/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, CommentID} ?= decode_component(Encoded),
        {ok, Reaction} ?=
            hb_ao:raw(
                <<"odysee-reaction@1.0">>,
                <<"list">>,
                #{},
                #{ <<"comment-ids">> => CommentID },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        commit_result(enrich_surface(<<"odysee/comment-reaction/", CommentID/binary>>, <<"comment-reaction">>, Reaction), <<"comment-reaction">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/file-view-count/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, ClaimID} ?= decode_component(Encoded),
        {ok, Counts} ?=
            hb_ao:raw(
                <<"odysee-file@1.0">>,
                <<"view-count">>,
                #{},
                #{ <<"claim-id">> => ClaimID },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        commit_result(enrich_surface(<<"odysee/file-view-count/", ClaimID/binary>>, <<"file-view-count">>, Counts), <<"file-view-count">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/file-reaction/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, ClaimID} ?= decode_component(Encoded),
        {ok, Reaction} ?=
            hb_ao:raw(
                <<"odysee-file-reaction@1.0">>,
                <<"list">>,
                #{},
                #{ <<"claim-ids">> => ClaimID },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        commit_result(enrich_surface(<<"odysee/file-reaction/", ClaimID/binary>>, <<"file-reaction">>, Reaction), <<"file-reaction">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/subscription-count/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, ClaimID} ?= decode_component(Encoded),
        {ok, Counts} ?=
            hb_ao:raw(
                <<"odysee-subscription@1.0">>,
                <<"sub-count">>,
                #{},
                #{ <<"claim-id">> => ClaimID },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        commit_result(enrich_surface(<<"odysee/subscription-count/", ClaimID/binary>>, <<"subscription-count">>, Counts), <<"subscription-count">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/blob-id/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    read_live(<<"odysee/blob/", Encoded/binary>>, StoreOpts, NodeOpts);
read_live(<<"odysee/blob/", Encoded/binary>>, StoreOpts, NodeOpts) ->
    maybe
        {ok, BlobHash0} ?= decode_component(Encoded),
        BlobHash = normalize_hex(BlobHash0),
        ok ?= require_sha384_hex(BlobHash),
        {ok, Body} ?= fetch_blob(BlobHash, StoreOpts, NodeOpts),
        commit_result(blob_message(BlobHash, Body), <<"blob">>, NodeOpts)
    else
        Error -> Error
    end;
read_live(<<"odysee/sha384/", Hash/binary>>, StoreOpts, NodeOpts) ->
    read_sha384(Hash, StoreOpts, NodeOpts);
read_live(_Path, _StoreOpts, _NodeOpts) ->
    {error, not_found}.

compatibility_path_allowed(Path, StoreOpts, NodeOpts) ->
    not compatibility_path(Path) orelse compatibility_routes_enabled(StoreOpts, NodeOpts).

compatibility_path(<<"odysee/media/stream-id/", _/binary>>) -> true;
compatibility_path(<<"odysee/media/stream/", _/binary>>) -> true;
compatibility_path(<<"odysee/claim/", _/binary>>) -> true;
compatibility_path(<<"odysee/claim-id/", _/binary>>) -> true;
compatibility_path(<<"odysee/stream/", _/binary>>) -> true;
compatibility_path(<<"odysee/stream-id/", _/binary>>) -> true;
compatibility_path(<<"odysee/channel-id/", _/binary>>) -> true;
compatibility_path(<<"odysee/channel/", _/binary>>) -> true;
compatibility_path(<<"odysee/comment-id/", _/binary>>) -> true;
compatibility_path(<<"odysee/comment/", _/binary>>) -> true;
compatibility_path(<<"odysee/comment-reaction/", _/binary>>) -> true;
compatibility_path(<<"odysee/file-view-count/", _/binary>>) -> true;
compatibility_path(<<"odysee/file-reaction/", _/binary>>) -> true;
compatibility_path(<<"odysee/subscription-count/", _/binary>>) -> true;
compatibility_path(_Path) -> false.

compatibility_routes_enabled(StoreOpts, NodeOpts) ->
    case hb_maps:get(<<"odysee-compatibility-routes">>, StoreOpts, not_found, NodeOpts) of
        not_found ->
            bool_opt(hb_maps:get(<<"odysee-compatibility-routes">>, NodeOpts, true, NodeOpts), true);
        Value ->
            bool_opt(Value, true)
    end.

bool_opt(false, _Default) -> false;
bool_opt(0, _Default) -> false;
bool_opt(<<"false">>, _Default) -> false;
bool_opt(<<"0">>, _Default) -> false;
bool_opt("false", _Default) -> false;
bool_opt("0", _Default) -> false;
bool_opt(undefined, Default) -> Default;
bool_opt(not_found, Default) -> Default;
bool_opt(_Value, _Default) -> true.

read_sha384(Hash, StoreOpts, NodeOpts) ->
    DescPath = <<"odysee/descriptor/", Hash/binary>>,
    BlobPath = <<"odysee/blob/", Hash/binary>>,
    case fixture(DescPath, StoreOpts, NodeOpts) of
        {ok, Desc} ->
            commit_result(enrich_surface(DescPath, <<"stream-descriptor">>, Desc), <<"stream-descriptor">>, NodeOpts);
        not_found ->
            case fixture(BlobPath, StoreOpts, NodeOpts) of
                {ok, Blob} ->
                    commit_result(enrich_surface(BlobPath, <<"blob">>, Blob), <<"blob">>, NodeOpts);
                not_found ->
                    case read(StoreOpts, #{ <<"read">> => DescPath }, NodeOpts) of
                        {ok, _} = OK -> OK;
                        _ -> read(StoreOpts, #{ <<"read">> => BlobPath }, NodeOpts)
                    end
            end
    end.

read_native_outpoint(TxID, NOut, StoreOpts, NodeOpts) ->
    Outpoint = <<TxID/binary, ":", (integer_to_binary(NOut))/binary>>,
    Kinds = [
        maps:put(<<"kind">>, <<"stream">>, StoreOpts),
        maps:put(<<"kind">>, <<"channel">>, StoreOpts),
        maps:remove(<<"kind">>, StoreOpts)
    ],
    read_native_outpoint(TxID, NOut, Outpoint, Kinds, StoreOpts, NodeOpts).

read_native_outpoint(TxID, NOut, Outpoint, [KindStore | Rest], StoreOpts, NodeOpts) ->
    case hb_store_lbry_claim_output:read(KindStore, #{ <<"read">> => Outpoint }, NodeOpts) of
        {ok, _Msg} = OK -> OK;
        _ -> read_native_outpoint(TxID, NOut, Outpoint, Rest, StoreOpts, NodeOpts)
    end;
read_native_outpoint(TxID, NOut, _Outpoint, [], StoreOpts, NodeOpts) ->
    read_verified_claim_proof(TxID, NOut, StoreOpts, NodeOpts).

read_verified_claim_proof(TxID, NOut, StoreOpts, NodeOpts) ->
    maybe
        {ok, Transaction} ?=
            hb_ao:raw(
                <<"odysee-claim@1.0">>,
                <<"transaction">>,
                #{},
                #{ <<"txid">> => TxID },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        {ok, Proof} ?=
            hb_ao:raw(
                <<"odysee-claim-proof@1.0">>,
                <<"verify">>,
                Transaction,
                #{ <<"txid">> => TxID, <<"nout">> => NOut },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        ok ?= require_valid_proof(Proof, NodeOpts),
        commit_result(Proof, <<"claim-proof">>, NodeOpts)
    end.

media_from_stream_path(Path, Req, StoreOpts, NodeOpts) ->
    maybe
        {ok, Stream} ?= read(StoreOpts, #{ <<"read">> => Path }, NodeOpts),
        {ok, Source} ?= stream_media_source(Stream, NodeOpts),
        media_response(Source, Req, store_node_opts(StoreOpts, NodeOpts))
    end.

stream_media_source(Stream, Opts) ->
    maybe
        SDHash = first_present([<<"sd-hash">>, <<"sd_hash">>], Stream, Opts),
        true ?= is_binary(SDHash),
        Source0 = #{
            <<"sd-hash">> => SDHash,
            <<"byte-size">> =>
                integer_or_undefined(
                    first_present(
                        [
                            <<"source-size">>,
                            <<"source_size">>,
                            <<"byte-size">>,
                            <<"media-size">>
                        ],
                        Stream,
                        Opts
                    )
                ),
            <<"content-type">> =>
                first_present([<<"media-type">>, <<"media_type">>, <<"content-type">>], Stream, Opts),
            <<"claim-id">> => first_present([<<"claim-id">>, <<"claim_id">>], Stream, Opts),
            <<"filename">> => first_present([<<"source-name">>, <<"source_name">>, <<"filename">>], Stream, Opts)
        },
        {ok, maps:filter(fun(_Key, Value) -> present_optional(Value) end, Source0)}
    else
        false -> {error, missing_sd_hash};
        not_found -> {error, missing_sd_hash}
    end.

media_response(Source, Req, Opts) ->
    maybe
        {ok, Start, End} ?= request_range(Req, Opts),
        {ok, BoundedStart, BoundedEnd} ?= bounded_range(Source, Start, End),
        SDHash = hb_maps:get(<<"sd-hash">>, Source, Opts),
        {ok, Result} ?= hb_lbry_bridge:stream_range(SDHash, BoundedStart, BoundedEnd, Opts),
        Body = hb_maps:get(<<"bytes">>, Result, Opts),
        ActualEnd = hb_maps:get(<<"end">>, Result, Opts),
        Total = hb_maps:get(<<"byte-size">>, Source, undefined, Opts),
        {ok,
            maps:merge(
                #{
                    <<"status">> => 206,
                    <<"content-type">> =>
                        hb_maps:get(
                            <<"content-type">>,
                            Source,
                            <<"application/octet-stream">>,
                            Opts
                        ),
                    <<"content-length">> => byte_size(Body),
                    <<"accept-ranges">> => <<"bytes">>,
                    <<"content-range">> => content_range(BoundedStart, ActualEnd, Total),
                    <<"sd-hash">> => hb_util:to_lower(SDHash),
                    <<"start">> => BoundedStart,
                    <<"end">> => ActualEnd,
                    <<"requested-end">> => hb_maps:get(<<"requested-end">>, Result, Opts),
                    <<"body">> => Body
                },
                media_metadata(Source, Total)
            )}
    end.

request_range(Req, Opts) ->
    case {
        integer_or_undefined(hb_maps:get(<<"start">>, Req, undefined, Opts)),
        integer_or_undefined(hb_maps:get(<<"end">>, Req, undefined, Opts))
    } of
        {Start, End} when is_integer(Start), is_integer(End), End >= Start ->
            {ok, Start, End};
        _ ->
            case first_present([<<"range">>, <<"Range">>], Req, Opts) of
                Range when is_binary(Range) -> parse_range(Range, Opts);
                _ -> {ok, 0, default_range_size(Opts) - 1}
            end
    end.

parse_range(<<"bytes=", Spec/binary>>, Opts) ->
    case binary:split(Spec, <<"-">>) of
        [StartBin, EndBin] when byte_size(StartBin) > 0 ->
            maybe
                {ok, Start} ?= non_negative_integer(StartBin),
                {ok, End} ?= range_end(Start, EndBin, Opts),
                true ?= End >= Start orelse {error, invalid_range},
                {ok, Start, End}
            end;
        _ ->
            {error, invalid_range}
    end;
parse_range(_Range, _Opts) ->
    {error, invalid_range}.

range_end(Start, <<>>, Opts) ->
    {ok, Start + default_range_size(Opts) - 1};
range_end(_Start, EndBin, _Opts) ->
    non_negative_integer(EndBin).

default_range_size(Opts) ->
    hb_maps:get(<<"odysee-default-range-size">>, Opts, ?DEFAULT_RANGE_SIZE, Opts).

bounded_range(Source, Start, End) ->
    case hb_maps:get(<<"byte-size">>, Source, undefined, #{}) of
        undefined ->
            {ok, Start, End};
        Size when Start < Size ->
            {ok, Start, min(End, Size - 1)};
        _ ->
            {error, invalid_range}
    end.

content_range(Start, End, undefined) ->
    content_range(Start, End, <<"*">>);
content_range(Start, End, Total) when is_integer(Total) ->
    content_range(Start, End, integer_to_binary(Total));
content_range(Start, End, Total) ->
    iolist_to_binary([
        <<"bytes ">>,
        integer_to_binary(Start),
        <<"-">>,
        integer_to_binary(End),
        <<"/">>,
        Total
    ]).

media_metadata(Source, Total) ->
    maps:from_list([
        {Key, Value}
     ||
        {Key, Value} <- [
            {<<"byte-size">>, Total},
            {<<"claim-id">>, hb_maps:get(<<"claim-id">>, Source, undefined, #{})},
            {<<"filename">>, hb_maps:get(<<"filename">>, Source, undefined, #{})}
        ],
        present_optional(Value)
    ]).

present_optional(undefined) ->
    false;
present_optional(not_found) ->
    false;
present_optional(_Value) ->
    true.

first_present([], _Msg, _Opts) ->
    not_found;
first_present([Key | Rest], Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_present(Rest, Msg, Opts);
        Value -> Value
    end.

integer_or_undefined(Value) when is_integer(Value) ->
    Value;
integer_or_undefined(Value) when is_binary(Value) ->
    try binary_to_integer(Value) of
        Int -> Int
    catch
        _:_ -> undefined
    end;
integer_or_undefined(_Value) ->
    undefined.

fixture(Path, StoreOpts, Opts) ->
    Fixtures = hb_maps:get(<<"fixtures">>, StoreOpts, #{}, Opts),
    case hb_maps:get(Path, Fixtures, not_found, Opts) of
        not_found -> not_found;
        Msg when is_map(Msg) -> {ok, Msg};
        Msg -> {ok, hb_cache:ensure_all_loaded(Msg, Opts)}
    end.

commit_result(Msg0, Type, Opts)
        when is_map(Msg0), Type =:= <<"blob">>;
        is_map(Msg0), Type =:= <<"stream-descriptor">>;
        is_map(Msg0), Type =:= <<"transaction">> ->
    native_source_message(Type, Msg0, Opts);
commit_result(Msg0, <<"claim-proof">> = Type, Opts) when is_map(Msg0) ->
    case native_claim_output_message(Msg0, Opts) of
        {ok, Msg} -> {ok, Msg};
        {error, not_native_claim_output} -> commit_surface_result(Msg0, Type, Opts);
        Error -> Error
    end;
commit_result(Msg0, Type, Opts) when is_map(Msg0) ->
    commit_surface_result(Msg0, Type, Opts);
commit_result(Bin, _Type, _Opts) when is_binary(Bin) ->
    {ok, Bin}.

commit_surface_result(Msg0, Type, Opts) ->
    Msg = source_message(Type, Msg0),
    CommitmentDevice = commitment_device(Type),
    case has_commitment_device(Msg, CommitmentDevice, Opts)
        andalso hb_message:verify(
            Msg,
            #{ <<"committers">> => <<"none">>, <<"commitment-ids">> => <<"all">> },
            Opts
        )
    of
        true ->
            committed_surface(Msg, Opts);
        false ->
            case hb_ao:raw(CommitmentDevice, <<"commit">>, Msg, #{ <<"type">> => Type }, Opts) of
                {ok, Committed} -> committed_surface(Committed, Opts);
                Error -> Error
            end
    end.

committed_surface(Msg, Opts) ->
    hb_message:with_only_committed(Msg, Opts).

commitment_device(<<"blob">>) ->
    ?LBRY_BLOB_COMMITMENT_DEVICE;
commitment_device(<<"stream-descriptor">>) ->
    ?LBRY_STREAM_DESCRIPTOR_COMMITMENT_DEVICE;
commitment_device(<<"claim-proof">>) ->
    ?LBRY_CLAIM_OUTPUT_COMMITMENT_DEVICE;
commitment_device(<<"transaction">>) ->
    ?LBRY_TRANSACTION_COMMITMENT_DEVICE;
commitment_device(_Type) ->
    ?ODYSEE_COMMITMENT_DEVICE.

source_message(<<"blob">>, Msg) ->
    Msg#{ <<"device">> => ?LBRY_BLOB_COMMITMENT_DEVICE };
source_message(<<"stream-descriptor">>, Msg) ->
    Msg#{ <<"device">> => ?LBRY_STREAM_DESCRIPTOR_COMMITMENT_DEVICE };
source_message(<<"claim-proof">>, Msg) ->
    Msg#{ <<"device">> => ?LBRY_CLAIM_OUTPUT_COMMITMENT_DEVICE };
source_message(<<"transaction">>, Msg) ->
    Msg#{ <<"device">> => ?LBRY_TRANSACTION_COMMITMENT_DEVICE };
source_message(_Type, Msg) ->
    Msg.

enrich_surface(<<"odysee/comment-reaction/", CommentID/binary>> = Path, <<"comment-reaction">>, Msg) ->
    Msg#{
        <<"comment-id">> => CommentID,
        <<"comment-reaction-store-path">> => Path
    };
enrich_surface(<<"odysee/file-view-count/", ClaimID/binary>> = Path, <<"file-view-count">>, Msg) ->
    Msg#{
        <<"claim-id">> => ClaimID,
        <<"file-view-count-store-path">> => Path
    };
enrich_surface(<<"odysee/file-reaction/", ClaimID/binary>> = Path, <<"file-reaction">>, Msg) ->
    Msg#{
        <<"claim-id">> => ClaimID,
        <<"file-reaction-store-path">> => Path
    };
enrich_surface(<<"odysee/subscription-count/", ClaimID/binary>> = Path, <<"subscription-count">>, Msg) ->
    Msg#{
        <<"claim-id">> => ClaimID,
        <<"subscription-count-store-path">> => Path
    };
enrich_surface(_Path, _Type, Msg) ->
    Msg.

has_commitment_device(Msg, Device, Opts) ->
    Commitments = hb_maps:get(<<"commitments">>, Msg, #{}, Opts),
    lists:any(
        fun(Commitment) ->
            hb_maps:get(<<"commitment-device">>, Commitment, not_found, Opts)
                =:= Device
        end,
        maps:values(Commitments)
    ).

infer_type(<<"odysee/claim/", _/binary>>, _Msg, _Opts) ->
    <<"claim">>;
infer_type(<<"odysee/claim-id/", _/binary>>, _Msg, _Opts) ->
    <<"claim">>;
infer_type(<<"odysee/stream/", _/binary>>, _Msg, _Opts) ->
    <<"stream">>;
infer_type(<<"odysee/stream-id/", _/binary>>, _Msg, _Opts) ->
    <<"stream">>;
infer_type(<<"odysee/channel-id/", _/binary>>, _Msg, _Opts) ->
    <<"channel">>;
infer_type(<<"odysee/channel/", _/binary>>, _Msg, _Opts) ->
    <<"channel">>;
infer_type(<<"odysee/claim-proof/", _/binary>>, _Msg, _Opts) ->
    <<"claim-proof">>;
infer_type(<<"odysee/transaction/", _/binary>>, _Msg, _Opts) ->
    <<"transaction">>;
infer_type(<<"odysee/stream-descriptor/", _/binary>>, _Msg, _Opts) ->
    <<"stream-descriptor">>;
infer_type(<<"odysee/descriptor-id/", _/binary>>, _Msg, _Opts) ->
    <<"stream-descriptor">>;
infer_type(<<"odysee/descriptor/", _/binary>>, _Msg, _Opts) ->
    <<"stream-descriptor">>;
infer_type(<<"odysee/comment-id/", _/binary>>, _Msg, _Opts) ->
    <<"comment">>;
infer_type(<<"odysee/comment/", _/binary>>, _Msg, _Opts) ->
    <<"comment">>;
infer_type(<<"odysee/comment-reaction/", _/binary>>, _Msg, _Opts) ->
    <<"comment-reaction">>;
infer_type(<<"odysee/file-view-count/", _/binary>>, _Msg, _Opts) ->
    <<"file-view-count">>;
infer_type(<<"odysee/file-reaction/", _/binary>>, _Msg, _Opts) ->
    <<"file-reaction">>;
infer_type(<<"odysee/subscription-count/", _/binary>>, _Msg, _Opts) ->
    <<"subscription-count">>;
infer_type(<<"odysee/blob-id/", _/binary>>, _Msg, _Opts) ->
    <<"blob">>;
infer_type(<<"odysee/blob/", _/binary>>, _Msg, _Opts) ->
    <<"blob">>;
infer_type(_Path, Msg, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"device">>, Msg, not_found, Opts) of
        <<"odysee-claim@1.0">> -> <<"claim">>;
        <<"odysee-stream@1.0">> -> <<"stream">>;
        <<"odysee-stream-descriptor@1.0">> -> <<"stream-descriptor">>;
        <<"lbry-stream-descriptor@1.0">> -> <<"stream-descriptor">>;
        <<"odysee-channel@1.0">> -> <<"channel">>;
        <<"odysee-comment@1.0">> -> <<"comment">>;
        <<"odysee-reaction@1.0">> -> <<"comment-reaction">>;
        <<"odysee-file@1.0">> -> <<"file-view-count">>;
        <<"odysee-file-reaction@1.0">> -> <<"file-reaction">>;
        <<"odysee-subscription@1.0">> -> <<"subscription-count">>;
        <<"odysee-blob@1.0">> -> <<"blob">>;
        <<"lbry-blob@1.0">> -> <<"blob">>;
        <<"odysee-claim-proof@1.0">> -> <<"claim-proof">>;
        <<"lbry-claim@1.0">> -> <<"claim-proof">>;
        <<"lbry-claim-output@1.0">> -> <<"claim-proof">>;
        <<"lbry-transaction@1.0">> -> <<"transaction">>;
        _ -> <<"source">>
    end;
infer_type(_Path, _Msg, _Opts) ->
    <<"source">>.

claim_from_search(Search, ClaimID, Opts) ->
    Claims = hb_maps:get(<<"claims">>, Search, [], Opts),
    Matches = [
        Claim
    ||
        Claim <- Claims,
        hb_maps:get(<<"claim-id">>, Claim, not_found, Opts) =:= ClaimID
    ],
    case Matches of
        [Claim | _] -> {ok, Claim};
        [] -> {error, claim_not_found}
    end.

blob_message(BlobHash, Body) ->
    (hb_lbry_commitment:blob_message(BlobHash, Body))#{
        <<"content-type">> => <<"application/octet-stream">>,
        <<"blob-store-path">> => <<"odysee/blob/", BlobHash/binary>>,
        <<"blob-size">> => byte_size(Body)
    }.

transaction_message(Transaction, TxID, Opts) ->
    maybe
        TxHex = hb_maps:get(<<"tx-hex">>, Transaction, not_found, Opts),
        true ?= is_binary(TxHex),
        {ok, Raw} ?= decode_tx_hex(TxHex),
        {ok, Msg} ?= native_transaction_message(Raw, TxID),
        {ok, Msg#{
            <<"content-type">> => <<"application/vnd.lbry.transaction">>,
            <<"tx-size">> => byte_size(Raw),
            <<"tx-store-path">> => <<"odysee/transaction/", TxID/binary>>
        }}
    else
        false -> {error, tx_hex_not_found};
        not_found -> {error, tx_hex_not_found};
        Other -> Other
    end.

native_source_message(<<"blob">>, Msg, Opts) ->
    maybe
        Hash = hb_maps:get(<<"blob-hash">>, Msg, not_found, Opts),
        true ?= is_binary(Hash),
        Body = native_bytes([<<"data">>, <<"body">>], Msg, Opts),
        true ?= is_binary(Body),
        {ok, Body} ?= verify_blob_body(normalize_hex(Hash), Body),
        {ok, blob_message(normalize_hex(Hash), Body)}
    else
        false -> {error, invalid_blob};
        not_found -> {error, invalid_blob};
        Error -> Error
    end;
native_source_message(<<"stream-descriptor">>, Msg, Opts) ->
    maybe
        SDHash = hb_maps:get(<<"sd-hash">>, Msg, not_found, Opts),
        true ?= is_binary(SDHash),
        Raw = native_bytes([<<"raw">>, <<"body">>], Msg, Opts),
        true ?= is_binary(Raw),
        {ok, Descriptor} ?=
            hb_lbry_commitment:descriptor_message(Raw, normalize_hex(SDHash)),
        {ok, Descriptor#{
            <<"content-type">> => <<"application/vnd.lbry.stream-descriptor+json">>,
            <<"descriptor-store-path">> => <<"odysee/descriptor/", (normalize_hex(SDHash))/binary>>
        }}
    else
        false -> {error, invalid_stream_descriptor};
        not_found -> {error, invalid_stream_descriptor};
        Error -> Error
    end;
native_source_message(<<"transaction">>, Msg, Opts) ->
    maybe
        TxID = hb_maps:get(<<"txid">>, Msg, not_found, Opts),
        true ?= is_binary(TxID),
        {ok, Raw} ?= transaction_bytes(Msg, Opts),
        {ok, TxMsg} ?= native_transaction_message(Raw, normalize_hex(TxID)),
        {ok, TxMsg#{
            <<"content-type">> => <<"application/vnd.lbry.transaction">>,
            <<"tx-size">> => byte_size(Raw),
            <<"tx-store-path">> => <<"odysee/transaction/", (normalize_hex(TxID))/binary>>
        }}
    else
        false -> {error, invalid_transaction};
        not_found -> {error, invalid_transaction};
        Error -> Error
    end.

native_claim_output_message(Msg, Opts) ->
    case hb_maps:get(<<"device">>, Msg, not_found, Opts) of
        <<"lbry-claim@1.0">> ->
            case
                hb_message:verify(
                    Msg,
                    #{ <<"commitment-ids">> => <<"all">> },
                    Opts
                )
            of
                true -> {ok, Msg};
                false -> {error, invalid_claim_output}
            end;
        _ ->
            {error, not_native_claim_output}
    end.

native_bytes([], _Msg, _Opts) ->
    not_found;
native_bytes([Key | Rest], Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        Bytes when is_binary(Bytes) -> Bytes;
        _ -> native_bytes(Rest, Msg, Opts)
    end.

transaction_bytes(Msg, Opts) ->
    case native_bytes([<<"raw">>, <<"body">>], Msg, Opts) of
        Raw when is_binary(Raw) ->
            {ok, Raw};
        _ ->
            case first_hex([<<"tx-hex">>, <<"hex">>, <<"raw-hex">>], Msg, Opts) of
                Hex when is_binary(Hex) -> decode_tx_hex(Hex);
                _ -> {error, missing_raw_transaction}
            end
    end.

first_hex([], _Msg, _Opts) ->
    not_found;
first_hex([Key | Rest], Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        Hex when is_binary(Hex) -> Hex;
        _ -> first_hex(Rest, Msg, Opts)
    end.

native_transaction_message(Raw, TxID) ->
    maybe
        {ok, Msg} ?= hb_lbry_commitment:transaction_message(Raw),
        TxID ?= hb_maps:get(<<"txid">>, Msg, not_found, #{}),
        {ok, Msg}
    else
        Other -> Other
    end.

fetch_blob(BlobHash, StoreOpts, NodeOpts) ->
    Opts = store_node_opts(StoreOpts, NodeOpts),
    fetch_blob(BlobHash, blob_urls(BlobHash, Opts), Opts, []).

fetch_blob(BlobHash, [], _Opts, Errors) ->
    {error, {blob_fetch_failed, BlobHash, lists:reverse(Errors)}};
fetch_blob(BlobHash, [URL | Rest], Opts, Errors) ->
    case fetch_blob_url(BlobHash, URL, Opts) of
        {ok, _Body} = OK -> OK;
        Error -> fetch_blob(BlobHash, Rest, Opts, [{URL, Error} | Errors])
    end.

fetch_blob_url(BlobHash, URL, Opts) ->
    case hb_http:request(#{ <<"method">> => <<"GET">>, <<"path">> => URL }, Opts) of
        {ok, #{ <<"status">> := Status, <<"body">> := Body }}
                when is_integer(Status), Status >= 200, Status < 300, is_binary(Body) ->
            verify_blob_body(BlobHash, Body);
        {ok, #{ <<"body">> := Body }} when is_binary(Body) ->
            verify_blob_body(BlobHash, Body);
        {ok, Body} when is_binary(Body) ->
            verify_blob_body(BlobHash, Body);
        {ok, Other} ->
            {error, {blob_response_without_body, Other}};
        Error ->
            Error
    end.

verify_blob_body(BlobHash, Body) ->
    case sha384_hex(Body) of
        BlobHash -> {ok, Body};
        Other -> {error, {blob_hash_mismatch, BlobHash, Other}}
    end.

claim_proof_path(Rest) ->
    case binary:split(Rest, <<"/">>) of
        [EncodedTxID, EncodedNOut] ->
            maybe
                {ok, TxID0} ?= decode_component(EncodedTxID),
                TxID = normalize_hex(TxID0),
                ok ?= require_hex_size(TxID, 64, invalid_txid),
                {ok, NOutBin} ?= decode_component(EncodedNOut),
                {ok, NOut} ?= non_negative_integer(NOutBin),
                {ok, TxID, NOut}
            end;
        _ ->
            {error, invalid_claim_proof_path}
    end.

require_valid_proof(Proof, Opts) ->
    case hb_maps:get(<<"valid">>, Proof, false, Opts) of
        true -> ok;
        _ -> {error, invalid_claim_proof}
    end.

blob_urls(BlobHash, Opts) ->
    TemplateURLs = [
        binary:replace(Template, <<"{hash}">>, BlobHash, [global])
    ||
        Template <- opt_values(
            [
                <<"blob-url-template">>,
                <<"blob-url-templates">>,
                <<"lbry-blob-url-template">>,
                <<"lbry-blob-url-templates">>
            ],
            [],
            Opts
        ),
        is_binary(Template)
    ],
    BaseURLs = [
        blob_url(BaseURL, BlobHash)
    ||
        BaseURL <- opt_values(
            [<<"blob-base-url">>, <<"blob-base-urls">>, <<"lbry-blob-base-url">>, <<"lbry-blob-base-urls">>],
            ?DEFAULT_BLOB_BASE_URLS,
            Opts
        ),
        is_binary(BaseURL),
        byte_size(BaseURL) > 0
    ],
    TemplateURLs ++ BaseURLs.

blob_url(BaseURL, BlobHash) ->
    CleanBaseURL =
        case binary:at(BaseURL, byte_size(BaseURL) - 1) of
            $/ -> binary:part(BaseURL, 0, byte_size(BaseURL) - 1);
            _ -> BaseURL
        end,
    <<CleanBaseURL/binary, "/blob?hash=", BlobHash/binary>>.

opt_values([], Default, _Opts) ->
    list_values(Default);
opt_values([Key | Rest], Default, Opts) ->
    case hb_maps:get(Key, Opts, not_found, Opts) of
        not_found -> opt_values(Rest, Default, Opts);
        Value -> list_values(Value)
    end.

list_values(Values) when is_list(Values) ->
    Values;
list_values(Value) ->
    [Value].

require_sha384_hex(Hex) when is_binary(Hex), byte_size(Hex) =:= ?SHA384_HEX_SIZE ->
    ok;
require_sha384_hex(_Hex) ->
    {error, invalid_blob_hash}.

require_hex_size(Hex, Size, _Error) when is_binary(Hex), byte_size(Hex) =:= Size ->
    ok;
require_hex_size(_Hex, _Size, Error) ->
    {error, Error}.

decode_tx_hex(Hex) when is_binary(Hex) ->
    try {ok, binary:decode_hex(normalize_hex(Hex))}
    catch _:_ -> {error, invalid_tx_hex}
    end.

non_negative_integer(Bin) when is_binary(Bin) ->
    try
        Int = binary_to_integer(Bin),
        case Int >= 0 of
            true -> {ok, Int};
            false -> {error, invalid_nout}
        end
    catch _:_ ->
        {error, invalid_nout}
    end.

sha384_hex(Bin) ->
    hb_util:to_hex(crypto:hash(sha384, Bin)).

normalize_hex(Hex) when is_binary(Hex) ->
    hb_util:bin(string:lowercase(binary_to_list(Hex))).

store_node_opts(StoreOpts, NodeOpts) ->
    hb_maps:merge(
        maps:without(
            [
                <<"fixtures">>,
                <<"store-module">>,
                <<"name">>,
                <<"scope">>
            ],
            StoreOpts
        ),
        NodeOpts
    ).

normalize_key(Key) ->
    Path = hb_path:to_binary(Key),
    case Path of
        <<"/", Rest/binary>> -> Rest;
        _ -> Path
    end.

canonical_read_path(Path) ->
    case classify_native_path(Path) of
        {ok, NativePath} -> NativePath;
        _ -> Path
    end.

classify_native_path(<<TxID:64/binary, ":", NOut/binary>>) ->
    case valid_hex_size(TxID, 32) andalso valid_uint(NOut) of
        true -> {ok, <<"odysee/claim-proof/", TxID/binary, "/", NOut/binary>>};
        false -> not_found
    end;
classify_native_path(Path) ->
    case
        {valid_hex_size(Path, 48), valid_hex_size(Path, 32)}
    of
        {true, _} -> {ok, <<"odysee/sha384/", Path/binary>>};
        {_, true} -> {ok, <<"odysee/transaction/", Path/binary>>};
        _ -> not_found
    end.

valid_hex_size(Hex, Bytes) when is_binary(Hex), byte_size(Hex) =:= Bytes * 2 ->
    try binary:decode_hex(Hex) of
        Decoded -> byte_size(Decoded) =:= Bytes
    catch
        _:_ -> false
    end;
valid_hex_size(_Hex, _Bytes) ->
    false.

valid_uint(Bin) when is_binary(Bin), byte_size(Bin) > 0 ->
    try binary_to_integer(Bin) of
        Int -> Int >= 0
    catch
        _:_ -> false
    end;
valid_uint(_Bin) ->
    false.

decode_component(Encoded) ->
    try {ok, hb_util:bin(uri_string:percent_decode(Encoded))}
    catch _:_ -> {error, invalid_odysee_store_path}
    end.

bare_sha384_read_returns_native_blob_test() ->
    Bytes = <<"encrypted blob payload">>,
    Hash = hb_lbry_stream_descriptor:blob_hash(Bytes),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/blob/", Hash/binary>> => #{
                <<"device">> => <<"odysee-blob@1.0">>,
                <<"body">> => Bytes,
                <<"blob-hash">> => Hash
            }
        }
    },
    {ok, Msg} = read(Store, #{ <<"read">> => Hash }, #{}),
    ?assertEqual(<<"lbry-blob@1.0">>, maps:get(<<"device">>, Msg)),
    ?assertEqual(Hash, maps:get(<<"blob-hash">>, Msg)),
    ?assertEqual(Bytes, maps:get(<<"data">>, Msg)),
    ?assertEqual(
        hb_lbry_commitment:content_digest_sha384(Bytes),
        maps:get(<<"content-digest">>, Msg)
    ),
    ?assertEqual(
        true,
        hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
    ).

bare_sha384_read_returns_native_descriptor_when_hash_is_sd_hash_test() ->
    {RawDescriptor, SDHash, _BlobHash, _BlobBytes} = media_sample_descriptor(),
    {ok, Descriptor} = hb_lbry_commitment:descriptor_message(RawDescriptor, SDHash),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/descriptor/", SDHash/binary>> => Descriptor
        }
    },
    {ok, Msg} = read(Store, #{ <<"read">> => SDHash }, #{}),
    ?assertEqual(<<"lbry-stream-descriptor@1.0">>, maps:get(<<"device">>, Msg)),
    ?assertEqual(SDHash, maps:get(<<"sd-hash">>, Msg)),
    ?assertEqual(
        true,
        hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
    ).

direct_sha384_get_returns_native_blob_test() ->
    Bytes = <<"encrypted blob payload">>,
    Hash = hb_lbry_stream_descriptor:blob_hash(Bytes),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/blob/", Hash/binary>> => #{
                <<"device">> => <<"odysee-blob@1.0">>,
                <<"body">> => Bytes,
                <<"blob-hash">> => Hash
            }
        }
    },
    {ok, Msg} =
        hb_ao:resolve(
            #{ <<"path">> => <<"/", Hash/binary>> },
            #{ <<"store">> => [Store] }
        ),
    ?assertEqual(<<"lbry-blob@1.0">>, maps:get(<<"device">>, Msg)),
    ?assertEqual(Hash, maps:get(<<"blob-hash">>, Msg)),
    ?assertEqual(Bytes, maps:get(<<"data">>, Msg)).

explicit_claim_id_read_returns_committed_claim_test() ->
    ClaimID = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    Store = claim_id_store(ClaimID),
    ?assertEqual(
        ClaimID,
        canonical_read_path(ClaimID)
    ),
    {ok, Msg} = read(Store, #{ <<"read">> => <<"odysee/claim-id/", ClaimID/binary>> }, #{}),
    ?assertEqual(<<"odysee-claim@1.0">>, maps:get(<<"device">>, Msg)),
    ?assertEqual(ClaimID, maps:get(<<"claim-id">>, Msg)),
    ?assertEqual(
        true,
        hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
    ).

bare_claim_id_get_is_not_a_store_read_test() ->
    ClaimID = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    Store = claim_id_store(ClaimID),
    ?assertMatch(
        {error, _},
        hb_ao:resolve(
            #{ <<"path">> => <<"/", ClaimID/binary>> },
            #{ <<"store">> => [Store] }
        )
    ).

compatibility_store_routes_can_be_disabled_test() ->
    ClaimID = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    Store = (claim_id_store(ClaimID))#{ <<"odysee-compatibility-routes">> => false },
    ?assertMatch(
        {error, not_found},
        read(Store, #{ <<"read">> => <<"odysee/claim-id/", ClaimID/binary>> }, #{})
    ).

direct_nested_stream_id_get_returns_committed_stream_test() ->
    ClaimID = <<"stream-1">>,
    Store = stream_id_store(ClaimID),
    {ok, Msg} =
        hb_ao:resolve(
            #{ <<"path">> => <<"/odysee/stream-id/", ClaimID/binary>> },
            #{ <<"store">> => [Store] }
        ),
    ?assertEqual(<<"odysee-stream@1.0">>, maps:get(<<"device">>, Msg)),
    ?assertEqual(ClaimID, maps:get(<<"claim-id">>, Msg)).

direct_nested_stream_id_http_get_returns_committed_stream_test() ->
    application:ensure_all_started(inets),
    ClaimID = <<"stream-1">>,
    Store = stream_id_store(ClaimID),
    Node = hb_http_server:start_node(#{ <<"store">> => [Store] }),
    URL = binary_to_list(<<Node/binary, "odysee/stream-id/", ClaimID/binary>>),
    {ok, {{_, 200, _}, Headers, _Body}} =
        httpc:request(get, {URL, []}, [], [{body_format, binary}]),
    SignatureInput = http_header(<<"signature-input">>, Headers),
    ?assertNotEqual(not_found, SignatureInput),
    ?assertNotEqual(
        nomatch,
        binary:match(SignatureInput, <<"alg=\"odysee@1.0/stream\"">>)
    ).

store_media_stream_id_read_returns_range_test() ->
    {RawDescriptor, SDHash, BlobHash, BlobBytes} = media_sample_descriptor(),
    {ok, Server, Handle} = media_mock_server(RawDescriptor, SDHash, BlobHash, BlobBytes),
    try
        Store = stream_media_store(<<"stream-1">>, SDHash, Server),
        {ok, Msg} =
            read(
                Store,
                #{
                    <<"read">> => <<"odysee/media/stream-id/stream-1">>,
                    <<"range">> => <<"bytes=0-5">>
                },
                #{ <<"http-client">> => httpc }
            ),
        ?assertEqual(206, maps:get(<<"status">>, Msg)),
        ?assertEqual(<<"video/mp4">>, maps:get(<<"content-type">>, Msg)),
        ?assertEqual(<<"bytes 0-5/12">>, maps:get(<<"content-range">>, Msg)),
        ?assertEqual(<<"bridge">>, maps:get(<<"body">>, Msg))
    after
        hb_mock_server:stop(Handle)
    end.

direct_media_stream_id_http_get_returns_range_test() ->
    application:ensure_all_started(inets),
    {RawDescriptor, SDHash, BlobHash, BlobBytes} = media_sample_descriptor(),
    {ok, BlobServer, BlobHandle} =
        media_mock_server(RawDescriptor, SDHash, BlobHash, BlobBytes),
    try
        Store = stream_media_store(<<"stream-1">>, SDHash, BlobServer),
        Node = hb_http_server:start_node(#{
            <<"store">> => [Store],
            <<"http-client">> => httpc
        }),
        URL = binary_to_list(<<Node/binary, "odysee/media/stream-id/stream-1">>),
        {ok, {{_, 206, _}, Headers, Body}} =
            httpc:request(
                get,
                {URL, [{"range", "bytes=0-5"}]},
                [],
                [{body_format, binary}]
            ),
        ?assertEqual(<<"bridge">>, Body),
        ?assertEqual(<<"bytes 0-5/12">>, http_header(<<"content-range">>, Headers)),
        ?assertEqual(<<"video/mp4">>, http_header(<<"content-type">>, Headers))
    after
        hb_mock_server:stop(BlobHandle)
    end.

claim_id_store(ClaimID) ->
    Claim = #{
        <<"device">> => <<"odysee-claim@1.0">>,
        <<"claim-id">> => ClaimID,
        <<"claim-name">> => <<"sample">>,
        <<"claim-store-path">> => <<"odysee/claim-id/", ClaimID/binary>>,
        <<"value">> => #{ <<"title">> => <<"Sample">> }
    },
    #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/claim-id/", ClaimID/binary>> => Claim
        }
    }.

stream_id_store(ClaimID) ->
    Stream = #{
        <<"device">> => <<"odysee-stream@1.0">>,
        <<"claim-id">> => ClaimID,
        <<"claim-name">> => <<"sample">>,
        <<"stream-store-path">> => <<"odysee/stream-id/", ClaimID/binary>>,
        <<"media-type">> => <<"video/mp4">>,
        <<"sd-hash">> =>
            <<"6ee8f762a2eedbd2b5eeade82ca4d0a6287f55db4195563cc52fc004701b7d55edcfad277a5141084bdf5fca3adb403a">>,
        <<"source-size">> => 1234
    },
    #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/stream-id/", ClaimID/binary>> => Stream
        }
    }.

stream_media_store(ClaimID, SDHash, BlobServer) ->
    Stream = #{
        <<"device">> => <<"odysee-stream@1.0">>,
        <<"claim-id">> => ClaimID,
        <<"claim-name">> => <<"sample">>,
        <<"stream-store-path">> => <<"odysee/stream-id/", ClaimID/binary>>,
        <<"media-type">> => <<"video/mp4">>,
        <<"sd-hash">> => SDHash,
        <<"source-size">> => 12
    },
    #{
        <<"store-module">> => ?MODULE,
        <<"lbry-blob-store">> => #{ <<"node">> => BlobServer },
        <<"fixtures">> => #{
            <<"odysee/stream-id/", ClaimID/binary>> => Stream
        }
    }.

media_mock_server(RawDescriptor, SDHash, BlobHash, BlobBytes) ->
    hb_mock_server:start([
        {"/blob", blob, fun(Req) ->
            case maps:get(<<"qs">>, Req) of
                <<"hash=", SDHash/binary>> -> {200, RawDescriptor};
                <<"hash=", BlobHash/binary>> -> {200, BlobBytes}
            end
        end}
    ]).

lbry_proxy_server(TxHex) ->
    Response =
        hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"result">> => #{ <<"hex">> => TxHex },
            <<"id">> => 1
        }),
    hb_mock_server:start([{"/api/v1/proxy", proxy, {200, Response}}]).

media_sample_descriptor() ->
    Key = <<0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15>>,
    IV = <<16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31>>,
    Plaintext = <<"bridge smoke">>,
    BlobBytes =
        crypto:crypto_one_time(
            aes_128_cbc,
            Key,
            IV,
            media_pkcs7_pad(Plaintext),
            true
        ),
    BlobHash = hb_lbry_stream_descriptor:blob_hash(BlobBytes),
    RawDescriptor =
        hb_json:encode(#{
            <<"stream_type">> => <<"lbryfile">>,
            <<"stream_name">> => hb_util:to_hex(<<"sample.mp4">>),
            <<"key">> => hb_util:to_hex(Key),
            <<"suggested_file_name">> => hb_util:to_hex(<<"sample.mp4">>),
            <<"stream_hash">> => hb_lbry_stream_descriptor:blob_hash(<<"stream">>),
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
    DescriptorHash = hb_lbry_stream_descriptor:blob_hash(RawDescriptor),
    {RawDescriptor, DescriptorHash, BlobHash, BlobBytes}.

media_pkcs7_pad(Plaintext) ->
    PadLen = 16 - (byte_size(Plaintext) rem 16),
    <<Plaintext/binary, (binary:copy(<<PadLen>>, PadLen))/binary>>.

direct_sha384_http_get_exposes_native_signature_input_test() ->
    application:ensure_all_started(inets),
    Bytes = <<"encrypted blob payload">>,
    Hash = hb_lbry_stream_descriptor:blob_hash(Bytes),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/blob/", Hash/binary>> => #{
                <<"device">> => <<"odysee-blob@1.0">>,
                <<"body">> => Bytes,
                <<"blob-hash">> => Hash
            }
        }
    },
    Node = hb_http_server:start_node(#{ <<"store">> => [Store] }),
    URL = binary_to_list(<<Node/binary, Hash/binary>>),
    {ok, {{_, 200, _}, Headers, Body}} =
        httpc:request(get, {URL, []}, [], [{body_format, binary}]),
    ?assertEqual(Bytes, Body),
    SignatureInput = http_header(<<"signature-input">>, Headers),
    ?assertNotEqual(not_found, SignatureInput),
    ?assertNotEqual(
        nomatch,
        binary:match(SignatureInput, <<"\"content-digest\"">>)
    ),
    ?assertNotEqual(
        nomatch,
        binary:match(SignatureInput, <<"alg=\"lbry-blob@1.0/sha-384\"">>)
    ),
    ?assertNotEqual(
        nomatch,
        binary:match(SignatureInput, <<"native-id=\"", Hash/binary, "\"">>)
    ).

bare_txid_read_returns_native_transaction_test() ->
    Raw = binary:decode_hex(hb_lbry_tx:task0_tx_hex()),
    {ok, TxMsg} = hb_lbry_commitment:transaction_message(Raw),
    TxID = maps:get(<<"txid">>, TxMsg),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/transaction/", TxID/binary>> => TxMsg
        }
    },
    {ok, Msg} = read(Store, #{ <<"read">> => TxID }, #{}),
    ?assertEqual(<<"lbry-transaction@1.0">>, maps:get(<<"device">>, Msg)),
    ?assertEqual(TxID, maps:get(<<"txid">>, Msg)),
    ?assertEqual(Raw, maps:get(<<"raw">>, Msg)),
    ?assertEqual(
        true,
        hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
    ).

direct_txid_get_returns_native_transaction_test() ->
    Raw = binary:decode_hex(hb_lbry_tx:task0_tx_hex()),
    {ok, TxMsg} = hb_lbry_commitment:transaction_message(Raw),
    TxID = maps:get(<<"txid">>, TxMsg),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/transaction/", TxID/binary>> => TxMsg
        }
    },
    {ok, Msg} =
        hb_ao:resolve(
            #{ <<"path">> => <<"/", TxID/binary>> },
            #{ <<"store">> => [Store] }
    ),
    ?assertEqual(<<"lbry-transaction@1.0">>, maps:get(<<"device">>, Msg)),
    ?assertEqual(TxID, maps:get(<<"txid">>, Msg)),
    ?assertEqual(Raw, maps:get(<<"raw">>, Msg)).

direct_txid_http_get_exposes_native_signature_input_test() ->
    application:ensure_all_started(inets),
    Raw = binary:decode_hex(hb_lbry_tx:task0_tx_hex()),
    {ok, TxMsg} = hb_lbry_commitment:transaction_message(Raw),
    TxID = maps:get(<<"txid">>, TxMsg),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/transaction/", TxID/binary>> => TxMsg
        }
    },
    Node = hb_http_server:start_node(#{ <<"store">> => [Store] }),
    URL = binary_to_list(<<Node/binary, TxID/binary>>),
    {ok, {{_, 200, _}, Headers, _Body}} =
        httpc:request(get, {URL, []}, [], [{body_format, binary}]),
    SignatureInput = http_header(<<"signature-input">>, Headers),
    ?assertNotEqual(not_found, SignatureInput),
    ?assertNotEqual(
        nomatch,
        binary:match(SignatureInput, <<"alg=\"lbry-transaction@1.0/sha-256d\"">>)
    ),
    ?assertNotEqual(
        nomatch,
        binary:match(SignatureInput, <<"native-id=\"", TxID/binary, "\"">>)
    ).

direct_outpoint_get_returns_native_claim_output_test() ->
    Raw = binary:decode_hex(hb_lbry_tx:task0_tx_hex()),
    TxID = hb_lbry_tx:txid(Raw),
    Outpoint = <<TxID/binary, ":0">>,
    {ok, ClaimOutput} = hb_lbry_commitment:claim_output_message(Raw, 0),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/claim-proof/", TxID/binary, "/0">> => ClaimOutput
        }
    },
    ?assertEqual(
        <<"odysee/claim-proof/", TxID/binary, "/0">>,
        canonical_read_path(Outpoint)
    ),
    {ok, StoreMsg} = read(Store, #{ <<"read">> => Outpoint }, #{}),
    ?assertEqual(<<"lbry-claim@1.0">>, maps:get(<<"device">>, StoreMsg)),
    {ok, Msg} =
        hb_ao:resolve(
            #{ <<"path">> => <<"/", Outpoint/binary>> },
            #{ <<"store">> => [Store] }
        ),
    ?assertEqual(<<"lbry-claim@1.0">>, maps:get(<<"device">>, Msg)),
    ?assertEqual(TxID, maps:get(<<"txid">>, Msg)),
    ?assertEqual(0, maps:get(<<"nout">>, Msg)),
    ?assertEqual(
        true,
        hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
    ).

direct_outpoint_read_prefers_native_stream_claim_test() ->
    application:ensure_all_started(inets),
    Raw = binary:decode_hex(hb_lbry_tx:task0_tx_hex()),
    TxID = hb_lbry_tx:txid(Raw),
    Outpoint = <<TxID/binary, ":0">>,
    {ok, Expected} = hb_lbry_commitment:stream_claim_message(Raw, 0),
    SDHash = maps:get(<<"sd-hash">>, Expected),
    {ok, Server, Handle} = lbry_proxy_server(hb_lbry_tx:task0_tx_hex()),
    try
        Store = #{
            <<"store-module">> => ?MODULE,
            <<"lbry-proxy-node">> => Server
        },
        {ok, Msg} = read(Store, #{ <<"read">> => Outpoint }, #{ <<"http-client">> => httpc }),
        ?assertEqual(<<"lbry-stream@1.0">>, maps:get(<<"device">>, Msg)),
        ?assertEqual(SDHash, maps:get(<<"sd-hash">>, Msg)),
        ?assertEqual(
            true,
            hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
        )
    after
        hb_mock_server:stop(Handle)
    end.

http_header(Name, Headers) ->
    LowerName = hb_util:bin(string:lowercase(hb_util:bin(Name))),
    case [
        hb_util:bin(Value)
     ||
        {Key, Value} <- Headers,
        hb_util:bin(string:lowercase(hb_util:bin(Key))) == LowerName
    ] of
        [Value | _] -> Value;
        [] -> not_found
    end.
