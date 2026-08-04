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
-export([cookie_auth_hooks/1]).

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
        % Signed inbound messages (uploads, comments) land in the node's
        % `cache-http' store; stacking it makes them readable and
        % `~query@1.0'-discoverable through the normal store path.
        #{
            <<"store-module">> => hb_store_fs,
            <<"name">> => <<"cache-http">>
        },
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

%% @doc The node's default `on' hooks, with the `~auth-hook@1.0' request
%% handler's secret provider swapped to `~cookie@1.0', followed by a
%% `~reply-id@1.0' stage that surfaces the stored message's ID in the
%% reply. Browsers then receive a stable anonymous identity
%% automatically: the first commit-flag request mints a cookie-derived
%% per-user wallet, every subsequent request with that cookie commits as
%% the same user, and the committed writes (uploads, comments) persist
%% via the hook's `store-all-signed' handling. Pass the result as the
%% node's `on' option.
cookie_auth_hooks(Opts) ->
    Hooks = hb_opts:get(on, #{}, Opts),
    Pipeline = hb_maps:get(<<"request">>, Hooks, [], Opts),
    Hooks#{
        <<"request">> =>
            lists:flatmap(
                fun
                    (Handler = #{ <<"device">> := <<"auth-hook@1.0">> }) ->
                        [
                            Handler#{
                                <<"secret-provider">> =>
                                    #{ <<"device">> => <<"cookie@1.0">> }
                            },
                            #{
                                <<"device">> => <<"reply-id@1.0">>,
                                <<"path">> => <<"request">>
                            }
                        ];
                    (Handler) ->
                        [Handler]
                end,
                Pipeline
            )
    }.

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

%%% Tests

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

%%% The vertical slice: a node configured by `seed_opts/1', driven over
%%% HTTP exactly as a client drives it, asserting that what comes back
%%% still verifies. Every other suite here exercises one layer in
%%% isolation (codecs check byte recipes, stores are called through
%%% `read/3'); nothing else asserts that the layers compose into a served
%%% object, which is the only thing that decides whether the architecture
%%% works.
%%%
%%% Source bytes come from the `fixtures' store option, the seam kept
%%% deliberately (`decisions/keep-fixtures-test-seam.md'), so these are
%%% deterministic and need no network. That is a real limit, stated rather
%%% than hidden: this proves the layers compose, NOT that the legacy
%%% endpoints answer. Live sourcing is a separate check
%%% (`docs/data-sourcing.md').

%% Boot a seed node through the production config builder, with a fixture
%% store ahead of the real Odysee stores so no legacy endpoint is reached.
skeleton_node(Fixtures) ->
    Store = hb_test_utils:test_store(),
    Opts =
        seed_opts(#{
            <<"store">> => [
                Store,
                #{
                    <<"store-module">> => hb_store_odysee,
                    <<"fixtures">> => Fixtures,
                    <<"local-store">> => [Store]
                }
            ],
            <<"priv-wallet">> => ar_wallet:new(),
            %% A mutable value at a constant address must not be served from
            %% the resolution cache or an alias never refreshes. Node
            %% configuration: a device cannot opt its own results out.
            <<"http-extra-opts">> => #{
                <<"force-message">> => true,
                <<"cache-control">> => [<<"no-store">>]
            }
        }),
    {hb_http_server:start_node(Opts), Store}.

skeleton_read(Node, Path) ->
    hb_http:get(Node, <<"/~cache@1.0/read?read=", Path/binary>>, #{}).

%% A served message must still verify in the client's hands.
%% `commitment-ids => all' is required: `lbry@1.0' commitments are
%% content-addressed and carry no committer, so the default selection
%% checks nothing and would pass a forgery.
skeleton_assert_verifies(Msg, Opts) ->
    Loaded = hb_cache:ensure_all_loaded(Msg, Opts),
    ?assertEqual(
        true,
        hb_message:verify(Loaded, #{ <<"commitment-ids">> => <<"all">> }, Opts)
    ),
    Loaded.

%% Blob evidence: the smallest complete slice. Bytes in, verified message
%% out over HTTP, and afterwards addressable by a plain HyperBEAM id with
%% no knowledge of the store path and no device call, which is what lets a
%% router or a peer serve Odysee content.
skeleton_blob_serves_and_addresses_test() ->
    Bytes = <<"walking skeleton blob payload">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Path = <<"odysee/blob/", Hash/binary>>,
    {Node, Store} = skeleton_node(#{ <<"lbry/blob/", Hash/binary>> => Bytes }),
    Opts = #{ <<"store">> => [Store] },

    {ok, ViaPath} = skeleton_read(Node, Path),
    Served = skeleton_assert_verifies(ViaPath, Opts),
    ?assertEqual(Hash, hb_maps:get(<<"blob-hash">>, Served, not_found, Opts)),

    Alias = hb_odysee_address:alias(Path),
    {ok, ViaAlias} = hb_http:get(Node, <<"/", Alias/binary>>, #{}),
    Addressed = skeleton_assert_verifies(ViaAlias, Opts),
    ?assertEqual(Hash, hb_maps:get(<<"blob-hash">>, Addressed, not_found, Opts)).

%% Descriptor evidence: parsed, checked against its sd-hash, and serving
%% the stream metadata playback depends on.
skeleton_descriptor_serves_test() ->
    {Raw, SDHash} = skeleton_descriptor(),
    Path = <<"odysee/descriptor/", SDHash/binary>>,
    {Node, Store} = skeleton_node(#{ <<"lbry/descriptor/", SDHash/binary>> => Raw }),
    Opts = #{ <<"store">> => [Store] },
    {ok, ViaPath} = skeleton_read(Node, Path),
    Served = skeleton_assert_verifies(ViaPath, Opts),
    ?assertEqual(SDHash, hb_maps:get(<<"sd-hash">>, Served, not_found, Opts)).

%% Transaction evidence: the txid is recomputed from raw bytes, so a lying
%% source cannot substitute a different transaction.
skeleton_transaction_serves_test() ->
    Raw = binary:decode_hex(dev_lbry_tx:task0_tx_hex()),
    {ok, TxMsg} = dev_lbry_commitment:transaction_message(Raw),
    TxID = maps:get(<<"txid">>, TxMsg),
    Path = <<"odysee/transaction/", TxID/binary>>,
    {Node, Store} = skeleton_node(#{ Path => TxMsg }),
    Opts = #{ <<"store">> => [Store] },
    {ok, ViaPath} = skeleton_read(Node, Path),
    Served = skeleton_assert_verifies(ViaPath, Opts),
    ?assertEqual(TxID, hb_maps:get(<<"txid">>, Served, not_found, Opts)).

%% Tampering must fail closed at the HTTP boundary, not merely inside the
%% store: bytes that do not hash to the requested id are a read failure,
%% never a 200.
skeleton_tampered_source_is_not_served_test() ->
    Bytes = <<"honest payload">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Path = <<"odysee/blob/", Hash/binary>>,
    {Node, _Store} =
        skeleton_node(#{ <<"lbry/blob/", Hash/binary>> => <<"tampered payload">> }),
    ?assertMatch({error, _}, skeleton_read(Node, Path)).

skeleton_descriptor() ->
    Key = <<0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15>>,
    IV = <<16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31>>,
    Plaintext = <<"walking skeleton media bytes">>,
    Pad = 16 - (byte_size(Plaintext) rem 16),
    Padded = <<Plaintext/binary, (binary:copy(<<Pad>>, Pad))/binary>>,
    Ciphertext = crypto:crypto_one_time(aes_128_cbc, Key, IV, Padded, true),
    BlobHash = dev_lbry_stream_descriptor:blob_hash(Ciphertext),
    Descriptor =
        #{
            <<"stream_type">> => <<"lbryfile">>,
            <<"stream_name">> => hb_util:to_hex(<<"skeleton.mp4">>),
            <<"key">> => hb_util:to_hex(Key),
            <<"suggested_file_name">> => hb_util:to_hex(<<"skeleton.mp4">>),
            <<"stream_hash">> =>
                dev_lbry_stream_descriptor:blob_hash(<<"skeleton stream hash">>),
            <<"blobs">> => [
                #{
                    <<"length">> => byte_size(Ciphertext),
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
        },
    Raw = hb_json:encode(Descriptor),
    {Raw, dev_lbry_stream_descriptor:descriptor_hash(Raw)}.

-endif.
