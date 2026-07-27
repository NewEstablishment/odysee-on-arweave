%%% @doc A read-only store sourcing raw LBRY transactions by display-order
%%% txid. The transaction bytes are fetched through the SDK proxy front door,
%%% re-hashed locally, and only returned when the recomputed txid matches the
%%% requested key. The result is a HyperBEAM message carrying the raw bytes
%%% and a native `lbry-transaction@1.0' commitment.
%%%
%%% Confirmed transactions are immutable, so the verified raw bytes are
%%% written through to the node's local stores and served from there on
%%% subsequent reads. Cached bytes pass through the same txid verification
%%% as remote fetches, so a corrupted cache entry degrades to a refetch
%%% rather than serving bad evidence.
-module(hb_store_lbry_transaction).
-export([scope/0, scope/1, type/3, read/3, resolve/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

scope() -> remote.
scope(_) -> scope().

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
            Result = fetch_transaction(StoreOpts, NormalizedTxID, NodeOpts),
            ?event(lbry_transaction,
                {transaction_read,
                    {txid, NormalizedTxID},
                    {result, result_class(Result)}},
                NodeOpts
            ),
            Result;
        false ->
            {error, not_found}
    end.

fetch_transaction(StoreOpts, TxID, NodeOpts) ->
    case read_cached_transaction(TxID, NodeOpts) of
        {ok, Msg} -> {ok, Msg};
        not_found -> fetch_remote_transaction(StoreOpts, TxID, NodeOpts)
    end.

fetch_remote_transaction(StoreOpts, TxID, NodeOpts) ->
    maybe
        {ok, TxResult} ?=
            hb_lbry_proxy:transaction_show(TxID, proxy_opts(StoreOpts, NodeOpts)),
        {ok, Hex} ?= raw_tx_hex(TxResult),
        {ok, Raw} ?= decode_tx_hex(Hex),
        {ok, Msg} ?= hb_lbry_commitment:transaction_message(Raw),
        ok ?= matching_txid(TxID, Msg),
        write_cached_transaction(TxID, Raw, NodeOpts),
        {ok, Msg}
    else
        {error, _} = Error -> Error;
        {failure, _} = Failure -> Failure
    end.

read_cached_transaction(TxID, NodeOpts) ->
    case local_stores(NodeOpts) of
        [] ->
            not_found;
        Stores ->
            case hb_store:read(Stores, cache_path(TxID), NodeOpts) of
                {ok, Raw} when is_binary(Raw) ->
                    rebuild_cached_transaction(TxID, Raw);
                _ ->
                    not_found
            end
    end.

rebuild_cached_transaction(TxID, Raw) ->
    maybe
        {ok, Msg} ?= hb_lbry_commitment:transaction_message(Raw),
        ok ?= matching_txid(TxID, Msg),
        {ok, Msg}
    else
        _ -> not_found
    end.

write_cached_transaction(TxID, Raw, NodeOpts) ->
    case local_stores(NodeOpts) of
        [] ->
            ok;
        Stores ->
            try hb_store:write(Stores, #{ cache_path(TxID) => Raw }, NodeOpts)
            catch _:_ -> ok
            end
    end.

cache_path(TxID) ->
    <<"lbry-transaction/", TxID/binary>>.

local_stores(NodeOpts) ->
    case hb_opts:get(store, [], NodeOpts) of
        Stores when is_list(Stores) -> hb_store:scope(Stores, local);
        Store when is_map(Store) -> hb_store:scope([Store], local);
        _ -> []
    end.

%% The proxy node and HTTP client may be pinned per-store; otherwise the
%% node options apply.
proxy_opts(StoreOpts, NodeOpts) ->
    ProxyNode =
        case hb_maps:get(<<"lbry-proxy-node">>, StoreOpts, not_found, NodeOpts) of
            not_found -> hb_maps:get(<<"lbry-proxy-url">>, StoreOpts, not_found, NodeOpts);
            Node -> Node
        end,
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

raw_tx_hex(TxResult) when is_map(TxResult) ->
    case maps:get(<<"hex">>, TxResult, undefined) of
        Hex when is_binary(Hex) -> {ok, Hex};
        _ -> {error, missing_raw_tx_hex}
    end;
raw_tx_hex(_) ->
    {error, missing_raw_tx_hex}.

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

valid_txid(TxID) when is_binary(TxID), byte_size(TxID) == 64 ->
    try binary:decode_hex(TxID) of
        Decoded -> byte_size(Decoded) == 32
    catch
        _:_ -> false
    end;
valid_txid(_) ->
    false.

result_class({ok, _}) -> ok;
result_class({error, _}) -> error;
result_class({failure, _}) -> failure.

%%% Tests

read_returns_committed_transaction_message_test() ->
    application:ensure_all_started(inets),
    TxID = <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    {ok, Server, Handle} = proxy_server(hb_lbry_tx:task0_tx_hex()),
    try
        Store = store(Server),
        {ok, Msg} =
            read(Store, #{ <<"read">> => TxID }, uncached_node_opts()),
        ?assertEqual(TxID, maps:get(<<"txid">>, Msg)),
        ?assertEqual(<<"lbry-transaction@1.0">>, maps:get(<<"device">>, Msg)),
        ?assertEqual(
            binary:decode_hex(hb_lbry_tx:task0_tx_hex()),
            maps:get(<<"raw">>, Msg)
        ),
        ?assertEqual(
            true,
            hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
        )
    after
        hb_mock_server:stop(Handle)
    end.

read_rejects_txid_mismatch_test() ->
    application:ensure_all_started(inets),
    RequestedTxID =
        <<"0000000000000000000000000000000000000000000000000000000000000000">>,
    ActualTxID =
        <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    {ok, Server, Handle} = proxy_server(hb_lbry_tx:task0_tx_hex()),
    try
        Store = store(Server),
        ?assertEqual(
            {error, {txid_mismatch, RequestedTxID, ActualTxID}},
            read(Store, #{ <<"read">> => RequestedTxID }, uncached_node_opts())
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
            read(Store, #{ <<"read">> => TxID }, uncached_node_opts())
        )
    after
        hb_mock_server:stop(Handle)
    end.

read_rejects_invalid_txid_test() ->
    ?assertEqual(
        {error, not_found},
        read(#{}, #{ <<"read">> => <<"not-a-txid">> }, #{})
    ).

read_serves_cached_transaction_without_proxy_test() ->
    application:ensure_all_started(inets),
    TxID = <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    Cache = #{
        <<"store-module">> => hb_store_volatile,
        <<"name">> => <<"lbry-transaction-cache-test">>
    },
    ok = hb_store:start(Cache),
    {ok, Server, Handle} = proxy_server(hb_lbry_tx:task0_tx_hex()),
    NodeOpts = #{ <<"http-client">> => httpc, <<"store">> => [Cache] },
    try
        Store = store(Server),
        {ok, First} = read(Store, #{ <<"read">> => TxID }, NodeOpts),
        % The verified raw bytes were written through to the local store.
        ?assertMatch(
            {ok, _},
            hb_store:read([Cache], cache_path(TxID), NodeOpts)
        ),
        hb_mock_server:stop(Handle),
        % With the proxy gone, the read is served from the local store.
        {ok, Second} = read(Store, #{ <<"read">> => TxID }, NodeOpts),
        ?assertEqual(maps:get(<<"raw">>, First), maps:get(<<"raw">>, Second)),
        ?assertEqual(
            true,
            hb_message:verify(Second, #{ <<"commitment-ids">> => <<"all">> }, #{})
        )
    after
        hb_store:stop(Cache)
    end.

read_refetches_on_corrupted_cache_entry_test() ->
    application:ensure_all_started(inets),
    TxID = <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    Cache = #{
        <<"store-module">> => hb_store_volatile,
        <<"name">> => <<"lbry-transaction-corrupt-cache-test">>
    },
    ok = hb_store:start(Cache),
    {ok, Server, Handle} = proxy_server(hb_lbry_tx:task0_tx_hex()),
    NodeOpts = #{ <<"http-client">> => httpc, <<"store">> => [Cache] },
    try
        ok = hb_store:write([Cache], #{ cache_path(TxID) => <<"garbage">> }, NodeOpts),
        Store = store(Server),
        {ok, Msg} = read(Store, #{ <<"read">> => TxID }, NodeOpts),
        ?assertEqual(TxID, maps:get(<<"txid">>, Msg)),
        % The refetch replaced the corrupted entry with the verified bytes.
        ?assertEqual(
            {ok, binary:decode_hex(hb_lbry_tx:task0_tx_hex())},
            hb_store:read([Cache], cache_path(TxID), NodeOpts)
        )
    after
        hb_mock_server:stop(Handle),
        hb_store:stop(Cache)
    end.

uncached_node_opts() ->
    #{ <<"http-client">> => httpc, <<"store">> => [] }.

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
