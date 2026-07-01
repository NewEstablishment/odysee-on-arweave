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

-define(LBRY_BLOB_COMMITMENT_DEVICE, <<"lbry-blob@1.0">>).
-define(LBRY_STREAM_DESCRIPTOR_COMMITMENT_DEVICE, <<"lbry-stream-descriptor@1.0">>).
-define(LBRY_CLAIM_OUTPUT_COMMITMENT_DEVICE, <<"lbry-claim-output@1.0">>).
-define(LBRY_TRANSACTION_COMMITMENT_DEVICE, <<"lbry-transaction@1.0">>).
-define(SHA384_HEX_SIZE, 96).
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

list(StoreOpts, #{ <<"list">> := Key } = Req, NodeOpts) ->
    Path = canonical_list_path(normalize_key(Key)),
    case fixture(Path, StoreOpts, NodeOpts) of
        {ok, Items} when is_list(Items) ->
            {ok, Items};
        {ok, Msg} ->
            {ok, list_search_ids(Path, Msg, NodeOpts)};
        not_found ->
            list_live(Path, Req, StoreOpts, NodeOpts)
    end.

write(_StoreOpts, _Req, _NodeOpts) ->
    {error, read_only}.

group(_StoreOpts, _Req, _NodeOpts) ->
    {error, read_only}.

link(_StoreOpts, _Req, _NodeOpts) ->
    {error, read_only}.

%% @doc Read a public Odysee object by a stable store path.
read(StoreOpts, #{ <<"read">> := Key }, NodeOpts) ->
    Path = canonical_read_path(normalize_key(Key)),
    case fixture(Path, StoreOpts, NodeOpts) of
        {ok, Msg} ->
            Type = infer_type(Path, Msg, NodeOpts),
            commit_result(enrich_surface(Path, Type, Msg), Type, NodeOpts);
        not_found ->
            read_live(Path, StoreOpts, NodeOpts)
    end.

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
                #{ <<"claim_ids">> => [ClaimID], <<"page_size">> => 1 },
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
                    <<"claim_ids">> => [ClaimID],
                    <<"claim_type">> => <<"stream">>,
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
                    <<"claim_ids">> => [ChannelID],
                    <<"claim_type">> => <<"channel">>,
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
read_live(<<"odysee/outpoint/", Rest/binary>>, StoreOpts, NodeOpts) ->
    read_claim_output_live(Rest, StoreOpts, NodeOpts);
read_live(<<"odysee/claim-output/", Rest/binary>>, StoreOpts, NodeOpts) ->
    read_claim_output_live(Rest, StoreOpts, NodeOpts);
read_live(<<"odysee/claim-proof/", Rest/binary>>, StoreOpts, NodeOpts) ->
    read_claim_output_live(Rest, StoreOpts, NodeOpts);
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
read_live(_Path, _StoreOpts, _NodeOpts) ->
    {error, not_found}.

read_claim_output_live(Rest, StoreOpts, NodeOpts) ->
    maybe
        {ok, TxID, NOut} ?= claim_proof_path(Rest),
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
        {ok, Msg} ?= claim_output_surface(Proof, TxID, NOut, StoreOpts, NodeOpts),
        commit_result(
            Msg#{
                <<"claim-output-store-path">> =>
                    <<"odysee/claim-output/", TxID/binary, "/", (integer_to_binary(NOut))/binary>>
            },
            <<"claim-output">>,
            NodeOpts
        )
    else
        Error -> Error
    end.

claim_output_surface(Proof, TxID, NOut, StoreOpts, NodeOpts) ->
    case claim_surface_for_proof(Proof, TxID, NOut, StoreOpts, NodeOpts) of
        {ok, Claim} ->
            {ok, claim_output_surface_message(Proof, Claim, TxID, NOut, NodeOpts)};
        _ ->
            {ok, Proof}
    end.

claim_surface_for_proof(Proof, TxID, NOut, StoreOpts, NodeOpts) ->
    maybe
        ClaimID = hb_maps:get(<<"claim-id">>, Proof, not_found, NodeOpts),
        true ?= is_binary(ClaimID),
        {ok, Search} ?=
            hb_ao:raw(
                <<"odysee-claim@1.0">>,
                <<"search">>,
                #{},
                #{ <<"claim_ids">> => [ClaimID], <<"page_size">> => 1 },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        {ok, Claim} ?= claim_from_search(Search, ClaimID, NodeOpts),
        ok ?= require_outpoint_match(Claim, TxID, NOut, NodeOpts),
        {ok, Claim}
    else
        _ -> {error, claim_surface_not_found}
    end.

claim_output_surface_message(Proof, Claim, TxID, NOut, Opts) ->
    ClaimID = first_found([<<"claim-id">>, <<"claim_id">>], Claim, hb_maps:get(<<"claim-id">>, Proof, not_found, Opts), Opts),
    ClaimName = first_found([<<"claim-name">>, <<"name">>], Claim, hb_maps:get(<<"claim-name">>, Proof, not_found, Opts), Opts),
    Value = first_found([<<"value">>], Claim, not_found, Opts),
    Msg0 = Proof#{
        <<"content-type">> => <<"application/json">>,
        <<"body">> => hb_json:encode(Claim),
        <<"tx-hex">> => hb_maps:get(<<"body">>, Proof, not_found, Opts),
        <<"claim">> => Claim,
        <<"claim-id">> => ClaimID,
        <<"claim_id">> => ClaimID,
        <<"claim-name">> => ClaimName,
        <<"name">> => ClaimName,
        <<"txid">> => TxID,
        <<"nout">> => NOut,
        <<"outpoint">> => <<TxID/binary, ":", (integer_to_binary(NOut))/binary>>,
        <<"immutable-id">> => <<TxID/binary, ":", (integer_to_binary(NOut))/binary>>,
        <<"claim-output-view">> => <<"sdk-claim">>
    },
    Msg1 = put_if_found(<<"value">>, Value, Msg0),
    Msg2 = put_if_found(<<"canonical-url">>, first_found([<<"canonical-url">>, <<"canonical_url">>], Claim, not_found, Opts), Msg1),
    Msg3 = put_if_found(<<"permanent-url">>, first_found([<<"permanent-url">>, <<"permanent_url">>], Claim, not_found, Opts), Msg2),
    Msg4 = put_if_found(<<"short-url">>, first_found([<<"short-url">>, <<"short_url">>], Claim, not_found, Opts), Msg3),
    put_if_found(<<"value-type">>, first_found([<<"value-type">>, <<"value_type">>], Claim, not_found, Opts), Msg4).

require_outpoint_match(Claim, TxID, NOut, Opts) ->
    ExpectedNOut = integer_to_binary(NOut),
    case {first_found([<<"txid">>, <<"tx-id">>], Claim, not_found, Opts), nout_binary(first_found([<<"nout">>, <<"n-out">>], Claim, not_found, Opts))} of
        {TxID, ExpectedNOut} -> ok;
        _ -> {error, claim_surface_outpoint_mismatch}
    end.

list_live(<<"odysee/channel-id/", Rest/binary>>, Req, StoreOpts, NodeOpts) ->
    case binary:split(Rest, <<"/">>) of
        [Encoded, <<"claim-outputs">>] ->
            list_channel_claim_outputs(Encoded, Req, StoreOpts, NodeOpts);
        [Encoded, <<"claims">>] ->
            list_channel_claims(Encoded, Req, StoreOpts, NodeOpts);
        _ ->
            {error, not_found}
    end;
list_live(_Path, _Req, _StoreOpts, _NodeOpts) ->
    {error, not_found}.

list_channel_claim_outputs(Encoded, Req, StoreOpts, NodeOpts) ->
    list_channel_search(Encoded, Req, StoreOpts, NodeOpts, fun list_claim_outputs/2).

list_channel_claims(Encoded, Req, StoreOpts, NodeOpts) ->
    list_channel_search(Encoded, Req, StoreOpts, NodeOpts, fun list_claim_ids/2).

list_channel_search(Encoded, Req, StoreOpts, NodeOpts, Project) ->
    maybe
        {ok, ChannelID} ?= decode_component(Encoded),
        Page = int_param(hb_maps:get(<<"page">>, Req, 1, NodeOpts), 1),
        PageSize = int_param(
            hb_maps:get(<<"page-size">>, Req, hb_maps:get(<<"page_size">>, Req, 20, NodeOpts), NodeOpts),
            20
        ),
        OrderBy = hb_maps:get(<<"order-by">>, Req, hb_maps:get(<<"order_by">>, Req, [<<"release_time">>], NodeOpts), NodeOpts),
        {ok, Search} ?=
            hb_ao:raw(
                <<"odysee-claim@1.0">>,
                <<"search">>,
                #{},
                #{
                    <<"channel_ids">> => [ChannelID],
                    <<"claim_type">> => <<"stream">>,
                    <<"page">> => Page,
                    <<"page_size">> => PageSize,
                    <<"order_by">> => OrderBy
                },
                store_node_opts(StoreOpts, NodeOpts)
            ),
        {ok, Project(Search, NodeOpts)}
    else
        Error -> Error
    end.

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
commit_result(Msg0, Type, Opts)
        when is_map(Msg0), Type =:= <<"claim-proof">>;
        is_map(Msg0), Type =:= <<"claim-output">> ->
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
    case CommitmentDevice of
        undefined ->
            {ok, Msg};
        _ ->
            case has_commitment_device(Msg, CommitmentDevice, Opts)
                andalso hb_message:verify(
                    Msg,
                    #{
                        <<"committers">> => <<"none">>,
                        <<"commitment-ids">> => <<"all">>
                    },
                    Opts
                )
            of
                true ->
                    committed_surface(Msg, Opts);
                false ->
                    case hb_ao:raw(
                        CommitmentDevice,
                        <<"commit">>,
                        Msg,
                        #{ <<"type">> => Type },
                        Opts
                    ) of
                        {ok, Committed} -> committed_surface(Committed, Opts);
                        Error -> Error
                    end
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
commitment_device(<<"claim-output">>) ->
    ?LBRY_CLAIM_OUTPUT_COMMITMENT_DEVICE;
commitment_device(<<"transaction">>) ->
    ?LBRY_TRANSACTION_COMMITMENT_DEVICE;
commitment_device(_Type) ->
    undefined.

source_message(<<"blob">>, Msg) ->
    Msg#{ <<"device">> => ?LBRY_BLOB_COMMITMENT_DEVICE };
source_message(<<"stream-descriptor">>, Msg) ->
    Msg#{ <<"device">> => ?LBRY_STREAM_DESCRIPTOR_COMMITMENT_DEVICE };
source_message(<<"claim-proof">>, Msg) ->
    Msg#{ <<"device">> => ?LBRY_CLAIM_OUTPUT_COMMITMENT_DEVICE };
source_message(<<"claim-output">>, Msg) ->
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
infer_type(<<"odysee/claim-output/", _/binary>>, _Msg, _Opts) ->
    <<"claim-output">>;
infer_type(<<"odysee/outpoint/", _/binary>>, _Msg, _Opts) ->
    <<"claim-output">>;
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
    Claims = first_found([<<"claims">>, <<"items">>], Search, [], Opts),
    Matches = [
        Claim
    ||
        Claim <- Claims,
        first_found([<<"claim-id">>, <<"claim_id">>], Claim, not_found, Opts) =:= ClaimID
    ],
    case Matches of
        [Claim | _] -> {ok, Claim};
        [] -> {error, claim_not_found}
    end.

first_found([], _Msg, Default, _Opts) ->
    Default;
first_found([Key | Rest], Msg, Default, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_found(Rest, Msg, Default, Opts);
        Value -> Value
    end.

list_claim_ids(Search, Opts) ->
    case first_found([<<"claim-ids">>, <<"claim_ids">>], Search, not_found, Opts) of
        ClaimIDs when is_list(ClaimIDs) ->
            ClaimIDs;
        _ ->
            [
                ClaimID
            ||
                Claim <- first_found([<<"claims">>, <<"items">>], Search, [], Opts),
                ClaimID <- [first_found([<<"claim-id">>, <<"claim_id">>], Claim, not_found, Opts)],
                ClaimID =/= not_found
            ]
    end.

list_search_ids(Path, Search, Opts) ->
    case binary:match(Path, <<"/claim-outputs">>) of
        nomatch -> list_claim_ids(Search, Opts);
        _ -> list_claim_outputs(Search, Opts)
    end.

list_claim_outputs(Search, Opts) ->
    [
        Outpoint
    ||
        Claim <- first_found([<<"claims">>, <<"items">>], Search, [], Opts),
        Outpoint <- [claim_outpoint(Claim, Opts)],
        Outpoint =/= not_found
    ].

claim_outpoint(Claim, Opts) ->
    TxID = first_found([<<"txid">>, <<"tx-id">>], Claim, not_found, Opts),
    NOut = first_found([<<"nout">>, <<"n-out">>], Claim, not_found, Opts),
    case {TxID, nout_binary(NOut)} of
        {TxID, NOutBin} when is_binary(TxID), is_binary(NOutBin) ->
            <<TxID/binary, ":", NOutBin/binary>>;
        _ ->
            not_found
    end.

nout_binary(NOut) when is_integer(NOut), NOut >= 0 ->
    integer_to_binary(NOut);
nout_binary(NOut) when is_binary(NOut) ->
    case valid_uint(NOut) of
        true -> NOut;
        false -> not_found
    end;
nout_binary(_NOut) ->
    not_found.

int_param(Value, _Default) when is_integer(Value) ->
    Value;
int_param(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value) of
        Int -> Int
    catch
        _:_ -> Default
    end;
int_param(_Value, Default) ->
    Default.

put_if_found(_Key, not_found, Msg) ->
    Msg;
put_if_found(Key, Value, Msg) ->
    Msg#{ Key => Value }.

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

canonical_list_path(Path) ->
    case classify_channel_claims_list_path(Path) of
        {ok, NativePath} -> NativePath;
        _ -> Path
    end.

classify_channel_claims_list_path(<<ChannelID:40/binary, "/claim-outputs">>) ->
    case valid_hex_size(ChannelID, 20) of
        true -> {ok, <<"odysee/channel-id/", ChannelID/binary, "/claim-outputs">>};
        false -> not_found
    end;
classify_channel_claims_list_path(<<ChannelID:40/binary, "/claims">>) ->
    case valid_hex_size(ChannelID, 20) of
        true -> {ok, <<"odysee/channel-id/", ChannelID/binary, "/claims">>};
        false -> not_found
    end;
classify_channel_claims_list_path(_Path) ->
    not_found.

classify_native_path(<<TxID:64/binary, ":", NOut/binary>>) ->
    case valid_hex_size(TxID, 32) andalso valid_uint(NOut) of
        true -> {ok, <<"odysee/claim-output/", TxID/binary, "/", NOut/binary>>};
        false -> not_found
    end;
classify_native_path(Path) ->
    case {valid_hex_size(Path, 48), valid_hex_size(Path, 32), valid_hex_size(Path, 20)} of
        {true, _, _} -> {ok, <<"odysee/blob/", Path/binary>>};
        {_, true, _} -> {ok, <<"odysee/transaction/", Path/binary>>};
        {_, _, true} -> {ok, <<"odysee/claim-id/", Path/binary>>};
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

bare_claim_id_read_returns_native_claim_test() ->
    ClaimID = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    Claim = #{
        <<"device">> => <<"odysee-claim@1.0">>,
        <<"claim_id">> => ClaimID,
        <<"name">> => <<"claim-name">>,
        <<"value_type">> => <<"stream">>,
        <<"value">> => #{}
    },
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/claim-id/", ClaimID/binary>> => Claim
        }
    },
    ?assertEqual(<<"odysee/claim-id/", ClaimID/binary>>, canonical_read_path(ClaimID)),
    {ok, Msg} = read(Store, #{ <<"read">> => ClaimID }, #{}),
    ?assertEqual(<<"odysee-claim@1.0">>, maps:get(<<"device">>, Msg)),
    ?assertEqual(ClaimID, first_found([<<"claim-id">>, <<"claim_id">>], Msg, not_found, #{})).

bare_channel_id_claims_list_returns_claim_ids_test() ->
    ChannelID = <<"fb364ef587872515f545a5b4b3182b58073f230f">>,
    ClaimID1 = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    ClaimID2 = <<"3fda836a92faaceedfe398225fb9b2ee2ed1f01a">>,
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/channel-id/", ChannelID/binary, "/claims">> => #{
                <<"items">> => [
                    #{ <<"claim_id">> => ClaimID1 },
                    #{ <<"claim-id">> => ClaimID2 }
                ]
            }
        }
    },
    ?assertEqual(
        <<"odysee/channel-id/", ChannelID/binary, "/claims">>,
        canonical_list_path(<<ChannelID/binary, "/claims">>)
    ),
    {ok, ClaimIDs} = list(Store, #{ <<"list">> => <<ChannelID/binary, "/claims">> }, #{}),
    ?assertEqual([ClaimID1, ClaimID2], ClaimIDs).

bare_channel_id_claim_outputs_list_returns_immutable_outpoints_test() ->
    ChannelID = <<"fb364ef587872515f545a5b4b3182b58073f230f">>,
    ClaimID = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    TxID1 = <<"6f4fc565d9f7b553c2b87b17f0e1821adc281b6331b926d72df44ee45d44f284">>,
    TxID2 = <<"8c2c68213df87840edcb0a5a2d2e093f5d2ecc4be82a4f86bfc320778ee8305d">>,
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/channel-id/", ChannelID/binary, "/claim-outputs">> => #{
                <<"items">> => [
                    #{ <<"claim_id">> => ClaimID, <<"txid">> => TxID1, <<"nout">> => 0 },
                    #{ <<"claim-id">> => ClaimID, <<"txid">> => TxID2, <<"nout">> => <<"2">> },
                    #{ <<"claim-id">> => ClaimID }
                ]
            }
        }
    },
    ?assertEqual(
        <<"odysee/channel-id/", ChannelID/binary, "/claim-outputs">>,
        canonical_list_path(<<ChannelID/binary, "/claim-outputs">>)
    ),
    {ok, Outpoints} = list(Store, #{ <<"list">> => <<ChannelID/binary, "/claim-outputs">> }, #{}),
    ?assertEqual([<<TxID1/binary, ":0">>, <<TxID2/binary, ":2">>], Outpoints).

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
            <<"odysee/claim-output/", TxID/binary, "/0">> => ClaimOutput
        }
    },
    ?assertEqual(
        <<"odysee/claim-output/", TxID/binary, "/0">>,
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

claim_output_path_aliases_return_native_claim_output_test() ->
    Raw = binary:decode_hex(hb_lbry_tx:task0_tx_hex()),
    TxID = hb_lbry_tx:txid(Raw),
    {ok, ClaimOutput} = hb_lbry_commitment:claim_output_message(Raw, 0),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"odysee/claim-output/", TxID/binary, "/0">> => ClaimOutput,
            <<"odysee/claim-proof/", TxID/binary, "/0">> => ClaimOutput,
            <<"odysee/outpoint/", TxID/binary, "/0">> => ClaimOutput
        }
    },
    {ok, ClaimOutputMsg} =
        read(Store, #{ <<"read">> => <<"odysee/claim-output/", TxID/binary, "/0">> }, #{}),
    {ok, ClaimProofMsg} =
        read(Store, #{ <<"read">> => <<"odysee/claim-proof/", TxID/binary, "/0">> }, #{}),
    {ok, OutpointMsg} =
        read(Store, #{ <<"read">> => <<"odysee/outpoint/", TxID/binary, "/0">> }, #{}),
    ?assertEqual(TxID, maps:get(<<"txid">>, ClaimOutputMsg)),
    ?assertEqual(0, maps:get(<<"nout">>, ClaimOutputMsg)),
    ?assertEqual(TxID, maps:get(<<"txid">>, ClaimProofMsg)),
    ?assertEqual(0, maps:get(<<"nout">>, ClaimProofMsg)),
    ?assertEqual(TxID, maps:get(<<"txid">>, OutpointMsg)),
    ?assertEqual(0, maps:get(<<"nout">>, OutpointMsg)).

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
