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
    Defaults = #{
        <<"port">> => 0,
        %% Browser writes (comments, uploads): the cookie identity commits
        %% a `POST /id?!=true&committers=all', `store-all-signed' persists
        %% the committed message, and `~reply-id@1.0' (appended by
        %% `cookie_auth_hooks/1') surfaces the stored id in the reply.
        %% Override hooks are folded in rather than replaced, so callers
        %% supplying their own `on' handlers keep the write path.
        <<"store-all-signed">> => true,
        <<"on">> => cookie_auth_hooks(Overrides)
    },
    Base = maps:merge(Defaults, maps:without([<<"store">>, <<"on">>], Overrides)),
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

%%% The vertical slice: a node built by `seed_opts/1' and driven over HTTP
%%% as a client drives it, asserting what comes back still verifies. Source
%%% bytes come from the `fixtures' seam, so these prove the layers compose,
%%% not that the legacy endpoints answer.

%% Seed node with a fixture store ahead of the real ones, so no legacy
%% endpoint is reached.
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
            %% A mutable value at a constant address must not come from the
            %% resolution cache, or an alias never refreshes.
            <<"http-extra-opts">> => #{
                <<"force-message">> => true,
                <<"cache-control">> => [<<"no-store">>]
            }
        }),
    {hb_http_server:start_node(Opts), Store}.

skeleton_read(Node, Path) ->
    hb_http:get(Node, <<"/~cache@1.0/read?read=", Path/binary>>, #{}).

%% `commitment-ids => all' is required: content-addressed commitments have
%% no committer, so the default selection checks nothing. Assert the
%% commitments are actually PRESENT first: verifying an empty selection
%% returns true vacuously, so a message that lost its commitments in transit
%% would otherwise pass this check while carrying no proof at all.
skeleton_assert_verifies(Msg, Opts) ->
    Loaded = hb_cache:ensure_all_loaded(Msg, Opts),
    Commitments = hb_maps:get(<<"commitments">>, Loaded, #{}, Opts),
    ?assert(map_size(hb_cache:ensure_all_loaded(Commitments, Opts)) > 0),
    ?assertEqual(
        true,
        hb_message:verify(Loaded, #{ <<"commitment-ids">> => <<"all">> }, Opts)
    ),
    Loaded.

%% The smallest complete slice: bytes in, verified message out over HTTP,
%% then addressable by a plain id with no path knowledge and no device call.
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

%% Descriptor parsed and checked against its sd-hash.
skeleton_descriptor_serves_test() ->
    {Raw, SDHash} = skeleton_descriptor(),
    Path = <<"odysee/descriptor/", SDHash/binary>>,
    {Node, Store} = skeleton_node(#{ <<"lbry/descriptor/", SDHash/binary>> => Raw }),
    Opts = #{ <<"store">> => [Store] },
    {ok, ViaPath} = skeleton_read(Node, Path),
    Served = skeleton_assert_verifies(ViaPath, Opts),
    ?assertEqual(SDHash, hb_maps:get(<<"sd-hash">>, Served, not_found, Opts)).

%% The txid is recomputed from raw bytes, so a lying source cannot
%% substitute a different transaction.
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

%% Tampering fails closed at the HTTP boundary, not just inside the store.
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


%% Live sourcing against real Odysee infrastructure. Network dependent, so it
%% is opt-in: set ODYSEE_LIVE=1 to run. Everything else in this suite uses the
%% fixtures seam and proves only that the layers compose.
live_transaction_sourcing_test_() ->
    {timeout, 120, fun() ->
        case os:getenv("ODYSEE_LIVE") of
            false -> ok;
            _ -> run_live_transaction()
        end
    end}.

run_live_transaction() ->
    TxID = <<"d22e243be78d4dd4b5fcbebf800dcebc066b1df1b042b363910e5f507d1d61f6">>,
    Path = <<"odysee/transaction/", TxID/binary>>,
    Store = hb_test_utils:test_store(),
    Opts = #{ <<"store">> => [Store] },
    SourceStore =
        #{
            <<"store-module">> => hb_store_odysee,
            <<"local-store">> => [Store]
        },
    %% The full store read: sources from the live SDK proxy, verifies the
    %% txid against the raw bytes, and warms the local cache and addresses.
    {ok, Msg} = hb_store_odysee:read(SourceStore, #{ <<"read">> => Path }, Opts),
    ?assertEqual(TxID, hb_maps:get(<<"txid">>, Msg, not_found, Opts)),
    ?assertEqual(
        true,
        hb_message:verify(
            hb_cache:ensure_all_loaded(Msg, Opts),
            #{ <<"commitment-ids">> => <<"all">> },
            Opts
        )
    ),
    %% Warming linked the alias, so the object is now addressable by id.
    {ok, ViaAlias} = hb_cache:read(hb_odysee_address:alias(Path), Opts),
    ?assertEqual(
        TxID,
        hb_maps:get(
            <<"txid">>,
            hb_cache:ensure_all_loaded(ViaAlias, Opts),
            not_found,
            Opts
        )
    ),
    ok.

-endif.
