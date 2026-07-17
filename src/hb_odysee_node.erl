%%% @doc Boot helpers for Odysee-serving HyperBEAM nodes.
%%%
%%% A `seed' node sources content from legacy Odysee infrastructure: its
%%% store stack layers the read-only Odysee stores beneath the node's
%%% local caches, so every object read is verified, committed, and cached
%%% locally, then servable to peers and browsers over the node's normal
%%% HTTP surface.
%%%
%%% A `serving' node requires none of this repository's store modules: a
%%% stock HyperBEAM node with a `trusted-devices' entry for `lbry@1.0'
%%% and an `hb_store_remote_node' entry pointing at one or more seed
%%% peers serves the same content trustlessly. `serving_store/1' returns
%%% the store stack for that configuration.
-module(hb_odysee_node).
-export([start_seed/0, start_seed/1, seed_opts/1, serving_store/1]).

%% @doc Start a seed node on an OS-assigned port with default options.
start_seed() ->
    start_seed(#{}).

%% @doc Start a seed node, merging the given options over the seed
%% defaults. Returns the node's base URL.
start_seed(Overrides) ->
    hb_http_server:start_node(seed_opts(Overrides)).

%% @doc The seed-node option set: the stock option defaults, with the
%% Odysee source stores appended after the node's own caches so local
%% (already-verified) copies win, and live legacy reads fill misses.
seed_opts(Overrides) ->
    Stores =
        maps:get(<<"store">>, Overrides, hb_opts:get(store, [], #{}))
            ++ odysee_stores(Overrides),
    Base = maps:merge(#{ <<"port">> => 0 }, maps:remove(<<"store">>, Overrides)),
    Base#{ <<"store">> => Stores }.

%% @doc The read-only Odysee source stores.
odysee_stores(Opts) ->
    [
        #{
            <<"store-module">> => hb_store_odysee,
            <<"name">> => <<"cache-odysee">>
        },
        #{
            <<"store-module">> => hb_store_lbry_claim_output,
            <<"name">> => <<"cache-lbry-claim-output">>
        },
        #{
            <<"store-module">> => hb_store_lbry_transaction,
            <<"name">> => <<"cache-lbry-transaction">>
        },
        #{
            <<"store-module">> => hb_store_lbry_stream_descriptor,
            <<"name">> => <<"cache-lbry-stream-descriptor">>
        },
        #{
            <<"store-module">> => hb_store_lbry_blob,
            <<"name">> => <<"cache-lbry-blob">>
        }
    ] ++ hb_opts:get(<<"odysee-extra-stores">>, [], Opts).

%% @doc The store stack for a stock serving node: local caches first,
%% then remote reads from the given seed peers. Results read from peers
%% carry their `lbry@1.0' commitments; consumers verify them with
%% `hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> })'.
serving_store(Peers) ->
    [
        #{
            <<"store-module">> => hb_store_fs,
            <<"name">> => <<"cache-mainnet">>
        }
    ] ++
    [
        #{
            <<"store-module">> => hb_store_remote_node,
            <<"node">> => Peer,
            <<"access">> => [<<"read">>]
        }
    ||
        Peer <- Peers
    ].
