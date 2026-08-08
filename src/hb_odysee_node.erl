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
-export([start_seed/0, start_seed/1, seed_opts/1, upload_opts/1, serving_store/1]).
-export([cookie_auth_hooks/1]).

%% The keys the auth hook must leave out of the signature. The hook's own
%% defaults (secret, cookie, path, ...) plus the transport keys `hb_http'
%% attaches to a request. Transport keys are rewritten when the stored
%% message is later served, so signing them makes the served copy fail
%% verification against its own commitment.
-define(UNSIGNED_REQUEST_KEYS, [
    <<"secret">>, <<"cookie">>, <<"set-cookie">>, <<"path">>,
    <<"method">>, <<"authorization">>, <<"!">>,
    <<"accept">>, <<"accept-bundle">>, <<"ao-peer">>, <<"ao-peer-port">>,
    <<"committers">>, <<"host">>, <<"user-agent">>
]).

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

%% @doc Seed-node options that also accept committed writes: uploads,
%% channel profiles, comments. The stock auth hook signs any request
%% carrying the `!' commit flag with a cookie-derived per-user wallet,
%% `store-all-signed' persists what it signs, and the match index makes
%% the writes discoverable through `~query@1.0'. Writes land in the
%% primary (first) store, which must support `match' (LMDB does).
upload_opts(Overrides) ->
    Opts = #{ <<"store">> := Stores } = seed_opts(Overrides),
    Opts#{
        <<"on">> => cookie_auth_hooks(Opts),
        <<"store-all-signed">> => true,
        <<"match-index">> => [hd(Stores)],
        <<"hook-auth-ignored-keys">> => ?UNSIGNED_REQUEST_KEYS
    }.

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

%% The `lbry@1.0' commitment ids on a message, newest-agnostic and ordered
%% only by the map. These are content-addressed, so each names the object in
%% the store; the node's own response signature does not.
lbry_commitment_ids(Msg, Opts) ->
    Commitments = hb_cache:ensure_all_loaded(
        hb_maps:get(<<"commitments">>, Msg, #{}, Opts), Opts),
    [
        ID
    ||
        {ID, Commitment} <- hb_maps:to_list(Commitments, Opts),
        hb_maps:get(<<"commitment-device">>, Commitment, none, Opts)
            =:= <<"lbry@1.0">>
    ].

%% The smallest complete slice: bytes in, verified message out over HTTP,
%% then addressable by a plain id with no path knowledge and no device call.
%%
%% The verifiable plain id is a COMMITMENT id. `hb_cache' selects the
%% commitment named by the id the caller asked for (`prepare_typed_values'
%% builds `commitments/<Target>' from the requested path), so an id derived
%% from the content selects its own proof and an id derived from anything
%% else cannot. The alias is a path hash with no cryptographic relationship
%% to the bytes, so it is a locator: it resolves to the same object, but a
%% caller who wants proof asks by commitment id or by canonical path.
skeleton_blob_serves_and_addresses_test() ->
    Bytes = <<"walking skeleton blob payload">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Path = <<"odysee/blob/", Hash/binary>>,
    {Node, Store} = skeleton_node(#{ <<"lbry/blob/", Hash/binary>> => Bytes }),
    Opts = #{ <<"store">> => [Store] },

    {ok, ViaPath} = skeleton_read(Node, Path),
    Served = skeleton_assert_verifies(ViaPath, Opts),
    ?assertEqual(Hash, hb_maps:get(<<"blob-hash">>, Served, not_found, Opts)),

    %% Addressable by a plain id, and it still carries its proof. Select the
    %% `lbry@1.0' commitment specifically: a served message also carries the
    %% node's own signature over the response, which is minted per request
    %% and names nothing in the store.
    [CommitmentID | _] = lbry_commitment_ids(Served, Opts),
    {ok, ViaID} = hb_http:get(Node, <<"/", CommitmentID/binary>>, #{}),
    Addressed = skeleton_assert_verifies(ViaID, Opts),
    ?assertEqual(Hash, hb_maps:get(<<"blob-hash">>, Addressed, not_found, Opts)),

    %% The alias locates the same object, without carrying the proof.
    Alias = hb_odysee_address:alias(Path),
    {ok, ViaAlias} = hb_http:get(Node, <<"/", Alias/binary>>, #{}),
    ?assertEqual(
        Hash,
        hb_maps:get(
            <<"blob-hash">>,
            hb_cache:ensure_all_loaded(ViaAlias, Opts),
            not_found,
            Opts
        )
    ).

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


%%% The write loop: a node built by `upload_opts/1', driven over HTTP the way
%%% a browser drives it. A POST carrying the `!' commit flag is signed with a
%%% cookie-derived wallet, persisted, and its signed id returned; everything
%%% after that is ordinary reads and queries.

upload_node() ->
    Store = hb_test_utils:test_store(),
    Node =
        hb_http_server:start_node(upload_opts(#{
            <<"store">> => [Store],
            <<"priv-wallet">> => ar_wallet:new()
        })),
    {Node, #{ <<"store">> => [Store] }}.

%% @doc POST a message with the commit flag. Passing a previous reply reuses
%% its session cookie, so the request commits as the same user; `none' is a
%% fresh session and therefore a fresh identity.
commit_post(Node, Msg, PrevReply, Opts) ->
    Req = Msg#{ <<"path">> => <<"/id?!=true&committers=all">> },
    WithCookie =
        case PrevReply of
            none -> Req;
            _ -> with_cookie(Req, PrevReply, Opts)
        end,
    {ok, Reply} = hb_http:post(Node, WithCookie, Opts),
    ID = hb_maps:get(<<"message-id">>, Reply, not_found, Opts),
    ?assert(is_binary(ID)),
    {Reply, ID}.

%% What a browser does: each `set-cookie' line's `name=value' pair, joined
%% into one `cookie' header on the next request.
with_cookie(Req, PrevReply, Opts) ->
    SetCookie =
        case hb_maps:get(<<"set-cookie">>, PrevReply, [], Opts) of
            Lines when is_list(Lines) -> Lines;
            Line -> [Line]
        end,
    Pairs = [hd(binary:split(L, <<";">>)) || L <- SetCookie],
    Req#{ <<"cookie">> => iolist_to_binary(lists:join(<<"; ">>, Pairs)) }.

%% @doc The committers of the message as stored, without the transport
%% signature a served copy also carries.
stored_signers(ID, Opts) ->
    {ok, Msg} = hb_cache:read(ID, Opts),
    hb_message:signers(hb_cache:ensure_all_loaded(Msg, Opts), Opts).

%% Bytes and metadata in one committed POST. The reply carries the signed
%% id; reading that id back returns the exact bytes with the uploader's
%% commitment attached and verifying. The same cookie commits as the same
%% identity.
upload_video_roundtrip_test() ->
    {Node, Opts} = upload_node(),
    Bytes = crypto:strong_rand_bytes(64 * 1024),
    {Reply, ID} =
        commit_post(Node, #{
            <<"type">> => <<"stream">>,
            <<"title">> => <<"upload roundtrip probe">>,
            <<"content-type">> => <<"video/mp4">>,
            <<"body">> => Bytes
        }, none, Opts),
    {ok, ReadBack} = hb_http:get(Node, <<"/", ID/binary>>, Opts),
    Loaded = hb_cache:ensure_all_loaded(ReadBack, Opts),
    ?assertEqual(Bytes, hb_maps:get(<<"body">>, Loaded, not_found, Opts)),
    ?assertEqual(
        <<"video/mp4">>,
        hb_maps:get(<<"content-type">>, Loaded, not_found, Opts)
    ),
    skeleton_assert_verifies(ReadBack, Opts),
    [Committer] = stored_signers(ID, Opts),
    {_, SameUserID} =
        commit_post(Node, #{
            <<"type">> => <<"stream">>,
            <<"title">> => <<"same user">>,
            <<"body">> => <<"second">>
        }, Reply, Opts),
    ?assertEqual([Committer], stored_signers(SameUserID, Opts)),
    {_, FreshUserID} =
        commit_post(Node, #{
            <<"type">> => <<"stream">>,
            <<"title">> => <<"fresh user">>,
            <<"body">> => <<"third">>
        }, none, Opts),
    ?assertNotEqual([Committer], stored_signers(FreshUserID, Opts)).

%% @doc The numbered values of a `~query@1.0' reply, in order.
match_paths(Reply, Opts) ->
    Loaded = hb_cache:ensure_all_loaded(Reply, Opts),
    [
        V
    ||
        {K, V} <- lists:sort(hb_maps:to_list(Loaded, Opts)),
        lists:all(fun(C) -> C >= $0 andalso C =< $9 end, binary_to_list(K))
    ].

%% @doc Read a query match the way a verifying client must: attach the
%% stored commitments, then accept the entry only if its committer IS the
%% claimed channel and the commitment verifies. Returns the title.
verified_channel_entry(Path, Channel, Opts) ->
    {ok, Msg} = hb_cache:read(Path, Opts),
    Loaded =
        hb_cache:read_all_commitments(
            hb_cache:ensure_all_loaded(Msg, Opts),
            Opts
        ),
    IsGenuine =
        lists:usort(hb_message:signers(Loaded, Opts)) =:= [Channel] andalso
            hb_message:verify(
                Loaded,
                #{ <<"commitment-ids">> => <<"all">> },
                Opts
            ),
    case IsGenuine of
        true -> {true, hb_maps:get(<<"title">>, Loaded, not_found, Opts)};
        false -> false
    end.

%% A channel is its owner's address: the profile is a committed message and
%% uploads reference the address under `channel'. The channel page is a
%% `~query@1.0' match on that key. The query is convention; the proof is the
%% commitment: a listing reader keeps only entries whose committer IS the
%% claimed channel, so a spoofed entry from another identity matches the
%% query but fails the filter.
channel_profile_and_listing_test() ->
    {Node, Opts} = upload_node(),
    {ProfileReply, ProfileID} =
        commit_post(Node, #{
            <<"type">> => <<"channel">>,
            <<"name">> => <<"probe channel">>
        }, none, Opts),
    [Channel] = stored_signers(ProfileID, Opts),
    {ok, Profile} = hb_http:get(Node, <<"/", ProfileID/binary>>, Opts),
    ?assertEqual(
        <<"probe channel">>,
        hb_maps:get(<<"name">>, hb_cache:ensure_all_loaded(Profile, Opts), not_found, Opts)
    ),
    Upload =
        fun(Title) -> #{
            <<"type">> => <<"stream">>,
            <<"channel">> => Channel,
            <<"title">> => Title,
            <<"body">> => crypto:strong_rand_bytes(1024)
        } end,
    {_, _} = commit_post(Node, Upload(<<"first">>), ProfileReply, Opts),
    {_, _} = commit_post(Node, Upload(<<"second">>), ProfileReply, Opts),
    {_, _} = commit_post(Node, Upload(<<"spoofed">>), none, Opts),
    {ok, QueryReply} =
        hb_http:post(Node, #{
            <<"path">> => <<"/~query@1.0/only">>,
            <<"type">> => <<"stream">>,
            <<"channel">> => Channel,
            <<"only">> => [<<"type">>, <<"channel">>],
            <<"return">> => <<"paths">>
        }, Opts),
    Paths = match_paths(QueryReply, Opts),
    ?assertEqual(3, length(Paths)),
    Verified =
        lists:sort(lists:filtermap(
            fun(P) -> verified_channel_entry(P, Channel, Opts) end,
            Paths
        )),
    ?assertEqual([<<"first">>, <<"second">>], Verified).

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
