%%% @doc A read-only store sourcing raw LBRY transactions by display-order
%%% txid. The transaction bytes are fetched through the SDK proxy front door,
%%% re-hashed locally, and only returned when the recomputed txid matches the
%%% requested key. The result is a HyperBEAM message carrying the raw bytes
%%% and a native `lbry@1.0' commitment with `transaction' evidence.
-module(hb_store_lbry_transaction).
-export([scope/1, type/3, read/3, resolve/3]).

scope(_) -> remote.

resolve(_StoreOpts, #{ <<"resolve">> := TxID }, _NodeOpts) ->
    case valid_txid(TxID) of
        true -> {ok, hb_util:to_lower(TxID)};
        false -> {error, not_found}
    end.

type(StoreOpts, #{ <<"type">> := TxID }, NodeOpts) ->
    case read(StoreOpts, #{ <<"read">> => TxID }, NodeOpts) of
        {ok, _} -> {ok, simple};
        Error -> Error
    end.

read(StoreOpts, #{ <<"read">> := TxID }, NodeOpts) ->
    case valid_txid(TxID) of
        true ->
            NormalizedTxID = hb_util:to_lower(TxID),
            case hb_store_remote_node:read_local_cache(StoreOpts, TxID, NodeOpts) of
                {ok, Msg} ->
                    case verify_cached_transaction(StoreOpts, NormalizedTxID, Msg, NodeOpts) of
                        {ok, VerifiedMsg} -> {ok, VerifiedMsg};
                        _ -> fetch_transaction(StoreOpts, NormalizedTxID, NodeOpts, 2)
                    end;
                _ -> fetch_transaction(StoreOpts, NormalizedTxID, NodeOpts, 2)
            end;
        false ->
            {error, not_found}
    end.

%% The SDK proxy intermittently fails single requests, exactly as the ancestry
%% walk in `hb_store_lbry_claim_output' already documents. A transient failure
%% here is worse than a slow read: callers that degrade to a weaker claim kind
%% turn it into evidence with no `sd-hash', and the media read then fails with
%% `missing_sd_hash' for a claim that is perfectly readable a moment later.
%% Give the fetch one retry before reporting failure.
fetch_transaction(StoreOpts, TxID, NodeOpts, Attempts) ->
    case do_fetch_transaction(StoreOpts, TxID, NodeOpts) of
        {ok, Msg} ->
            {ok, Msg};
        _Error when Attempts > 1 ->
            fetch_transaction(StoreOpts, TxID, NodeOpts, Attempts - 1);
        Error ->
            Error
    end.

do_fetch_transaction(StoreOpts, TxID, NodeOpts) ->
    maybe
        {ok, TxResult} ?=
            hb_odysee_client:transaction_show(TxID, proxy_opts(StoreOpts, NodeOpts)),
        {ok, Hex} ?= hb_odysee_util:raw_tx_hex(TxResult),
        {ok, Raw} ?= decode_tx_hex(Hex),
        {ok, Msg} ?= dev_lbry_commitment:transaction_message(Raw),
        ok ?= matching_txid(TxID, Msg),
        hb_store_remote_node:maybe_cache(StoreOpts, Msg, [TxID]),
        {ok, Msg}
    end.

verify_cached_transaction(StoreOpts, TxID, Msg, NodeOpts) ->
    try
        CacheOpts = hb_odysee_util:local_cache_opts(StoreOpts, NodeOpts),
        Loaded = hb_cache:ensure_all_loaded(Msg, CacheOpts),
        {ok, Raw} = dev_lbry_commitment:evidence_decode(maps:get(<<"raw">>, Loaded)),
        {ok, VerifiedMsg} = dev_lbry_commitment:transaction_message(Raw),
        ok = matching_txid(TxID, VerifiedMsg),
        {ok, VerifiedMsg}
    catch
        _:_ -> {error, invalid_cached_transaction}
    end.

%% The proxy node and HTTP client may be pinned per-store; otherwise the
%% node options apply.
proxy_opts(StoreOpts, NodeOpts) ->
    ProxyNode = hb_maps:get(<<"lbry-proxy-node">>, StoreOpts, not_found, NodeOpts),
    ProxyOpts =
        case ProxyNode of
            not_found -> #{};
            _ -> #{ <<"lbry-proxy-node">> => ProxyNode }
        end,
    hb_maps:merge(
        hb_maps:merge(NodeOpts, ProxyOpts, NodeOpts),
        hb_maps:with([<<"http-client">>], StoreOpts, NodeOpts),
        NodeOpts
    ).

decode_tx_hex(Hex) when is_binary(Hex) ->
    try binary:decode_hex(hb_util:to_lower(Hex)) of
        Raw -> {ok, Raw}
    catch
        _:_ -> {error, invalid_tx_hex}
    end;
decode_tx_hex(_) ->
    {error, invalid_tx_hex}.

matching_txid(TxID, #{ <<"txid">> := TxID }) ->
    ok;
matching_txid(TxID, #{ <<"txid">> := ActualTxID }) ->
    {error, {txid_mismatch, TxID, ActualTxID}}.

valid_txid(TxID) ->
    hb_odysee_util:valid_hex(TxID, 32).

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

read_returns_committed_transaction_message_test() ->
    application:ensure_all_started(inets),
    TxID = <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    {ok, Server, Handle} = proxy_server(dev_lbry_tx:task0_tx_hex()),
    try
        Store = store(Server),
        {ok, Msg} =
            read(Store, #{ <<"read">> => TxID }, #{ <<"http-client">> => httpc }),
        ?assertEqual(TxID, maps:get(<<"txid">>, Msg)),
        [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
        ?assertEqual(<<"lbry@1.0">>, maps:get(<<"commitment-device">>, Commitment)),
        ?assertEqual(<<"transaction">>, maps:get(<<"evidence">>, Commitment)),
        ?assertEqual(
            hb_util:encode(binary:decode_hex(dev_lbry_tx:task0_tx_hex())),
            maps:get(<<"raw">>, Msg)
        ),
        ?assert(verify_lbry_message(Msg))
    after
        hb_mock_server:stop(Handle)
    end.

read_rehydrates_lazy_cached_transaction_test_() ->
    {timeout, 60, fun() ->
        with_test_devices(fun read_rehydrates_lazy_cached_transaction/1)
    end}.

read_rehydrates_lazy_cached_transaction(DeviceOpts) ->
    application:ensure_all_started(inets),
    TxID = <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    {ok, Server, Handle} = proxy_server(dev_lbry_tx:task0_tx_hex()),
    Timestamp = integer_to_binary(erlang:unique_integer([positive, monotonic])),
    Cache = #{
        <<"store-module">> => hb_store_volatile,
        <<"name">> => <<"cache-TEST/lbry-transaction-", Timestamp/binary>>
    },
    ok = hb_store:start(Cache),
    Store = (store(Server))#{ <<"local-store">> => [Cache] },
    NodeOpts = DeviceOpts#{ <<"http-client">> => httpc, <<"store">> => [Cache] },
    try
        {ok, _LiveMsg} = read(Store, #{ <<"read">> => TxID }, NodeOpts),
        hb_mock_server:stop(Handle),
        {ok, CachedMsg} = read(Store, #{ <<"read">> => TxID }, NodeOpts),
        ?assertEqual(TxID, maps:get(<<"txid">>, CachedMsg)),
        ?assert(is_binary(maps:get(<<"raw">>, CachedMsg))),
        ?assert(verify_lbry_message(CachedMsg))
    after
        hb_store:stop(Cache)
    end.

read_rejects_txid_mismatch_test() ->
    application:ensure_all_started(inets),
    RequestedTxID =
        <<"0000000000000000000000000000000000000000000000000000000000000000">>,
    ActualTxID =
        <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    {ok, Server, Handle} = proxy_server(dev_lbry_tx:task0_tx_hex()),
    try
        Store = store(Server),
        ?assertEqual(
            {error, {txid_mismatch, RequestedTxID, ActualTxID}},
            read(Store, #{ <<"read">> => RequestedTxID }, #{ <<"http-client">> => httpc })
        )
    after
        hb_mock_server:stop(Handle)
    end.

read_rejects_malformed_raw_transaction_test() ->
    application:ensure_all_started(inets),
    TxID = <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    {ok, Server, Handle} = proxy_server(<<"deadbeef">>),
    try
        Store = store(Server),
        ?assertMatch(
            {error, _},
            read(Store, #{ <<"read">> => TxID }, #{ <<"http-client">> => httpc })
        )
    after
        hb_mock_server:stop(Handle)
    end.

read_rejects_invalid_txid_test() ->
    ?assertEqual(
        {error, not_found},
        read(#{}, #{ <<"read">> => <<"not-a-txid">> }, #{})
    ).

proxy_server(Hex) ->
    Response =
        hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"result">> => #{ <<"hex">> => Hex },
            <<"id">> => 1
        }),
    hb_mock_server:start([{"/api/v1/proxy", proxy, {200, Response}}]).

store(Server) ->
    #{
        <<"store-module">> => ?MODULE,
        <<"lbry-proxy-node">> => Server,
        <<"http-client">> => httpc
    }.

verify_lbry_message(Msg) ->
    lists:all(
        fun(Commitment) -> dev_lbry:verify(Msg, Commitment, #{}) =:= {ok, true} end,
        maps:values(maps:get(<<"commitments">>, Msg))
    ).

with_test_devices(Fun) ->
    HBPreloaded = filename:join(code:lib_dir(hb), "src/preloaded"),
    BootstrapOpts = #{
        <<"bootstrap-device-src">> => [HBPreloaded, filename:dirname(?FILE)],
        <<"commitment-device">> => <<"lbry@1.0">>
    },
    hb_forge_seed:with_forge_bootstrap(
        BootstrapOpts,
        fun(Opts) ->
            maps:foreach(
                fun(Ref, Mod) -> erlang:put({hb_device_load, Ref}, Mod) end,
                maps:get(<<"forge-bootstrap">>, Opts)
            ),
            Fun(Opts)
        end
    ).

-endif.
