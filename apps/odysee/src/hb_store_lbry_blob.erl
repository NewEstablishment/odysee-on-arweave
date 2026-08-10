%%% @doc A read-only store sourcing encrypted LBRY blobs by SHA-384 blob
%%% hash from a blob cache node. The returned bytes are re-hashed locally
%%% and only surface as a message carrying a native `lbry@1.0' commitment
%%% with `blob' evidence when they match the requested hash.
-module(hb_store_lbry_blob).
-export([scope/1, type/3, read/3, resolve/3]).

-define(DEFAULT_NODE, <<"http://blobcache-eu.odycdn.com:5569">>).

scope(_) -> remote.

resolve(_StoreOpts, #{ <<"resolve">> := Key }, _NodeOpts) ->
    case normalize_hash_key(Key) of
        {ok, Hash} -> {ok, Hash};
        error -> {error, not_found}
    end.

type(StoreOpts, #{ <<"type">> := Key }, NodeOpts) ->
    case normalize_hash_key(Key) of
        {ok, Hash} ->
            case request(<<"HEAD">>, StoreOpts, Hash, NodeOpts) of
                {ok, Status, _Headers, _Body} when Status == 200; Status == 204 ->
                    {ok, simple};
                {ok, 403, _Headers, _Body} ->
                    {error, protected};
                {ok, 404, _Headers, _Body} ->
                    {error, not_found};
                {ok, Status, _Headers, _Body} when Status >= 500 ->
                    {failure, {http_status, Status}};
                {ok, Status, _Headers, _Body} ->
                    {error, {http_status, Status}};
                {error, Reason} ->
                    {failure, Reason}
            end;
        error ->
            {error, not_found}
    end.

%% @doc Read a blob by SHA-384 hash and return it as a HyperBEAM message
%% carrying the encrypted bytes under `data' and a native `lbry@1.0'
%% `blob'-evidence commitment. The hash of the returned bytes is verified
%% before the message is constructed; mismatching bytes never leave the
%% store.
read(StoreOpts, #{ <<"read">> := Key }, NodeOpts) ->
    case normalize_hash_key(Key) of
        {ok, Hash} ->
            case fixture(StoreOpts, Hash, NodeOpts) of
                {ok, Msg} ->
                    {ok, Msg};
                not_found ->
                    case hb_store_remote_node:read_local_cache(StoreOpts, Hash, NodeOpts) of
                        {ok, Msg} ->
                            %% This could be skipped if we fully trust the store
                            %% will not serve invalid data.
                            case verify_cached_blob(StoreOpts, Hash, Msg, NodeOpts) of
                                {ok, VerifiedMsg} -> {ok, VerifiedMsg};
                                _ -> read_live(StoreOpts, Hash, NodeOpts)
                            end;
                        _ ->
                            read_live(StoreOpts, Hash, NodeOpts)
                    end
            end;
        error ->
            {error, not_found}
    end.

read_live(StoreOpts, NormalizedHash, NodeOpts) ->
    case request(<<"GET">>, StoreOpts, NormalizedHash, NodeOpts) of
      {ok, 200, _Headers, Body} ->
          case dev_lbry_stream_descriptor:verify_blob_hash(NormalizedHash, Body) of
              ok ->
                  Msg = dev_lbry_commitment:blob_message(NormalizedHash, Body),
                  hb_store_remote_node:maybe_cache(
                      StoreOpts,
                      Msg,
                      [NormalizedHash]
                  ),
                  {ok, Msg};
              Error ->
                  Error
          end;
      {ok, 403, _Headers, _Body} ->
          {error, protected};
      {ok, 404, _Headers, _Body} ->
          {error, not_found};
      {ok, Status, _Headers, _Body} when Status >= 500 ->
          {failure, {http_status, Status}};
      {ok, Status, _Headers, _Body} ->
          {error, {http_status, Status}};
      {error, Reason} ->
          {failure, Reason}
    end.

verify_cached_blob(StoreOpts, Hash, Msg, NodeOpts) ->
    try
        CacheOpts = hb_odysee_util:local_cache_opts(StoreOpts, NodeOpts),
        Loaded = hb_cache:ensure_all_loaded(Msg, CacheOpts),
        case blob_bytes(Loaded, CacheOpts) of
            Bytes when is_binary(Bytes) ->
                case dev_lbry_stream_descriptor:verify_blob_hash(Hash, Bytes) of
                    ok -> {ok, dev_lbry_commitment:blob_message(Hash, Bytes)};
                    _ -> not_found
                end;
            _ ->
                not_found
        end
    catch
        _:_ -> not_found
    end.

fixture(StoreOpts, Hash, Opts) ->
    Fixtures = hb_maps:get(<<"fixtures">>, StoreOpts, #{}, Opts),
    Keys = [Hash, <<"lbry/blob/", Hash/binary>>, <<"odysee/blob/", Hash/binary>>],
    case first_fixture(Keys, Fixtures, Opts) of
        not_found ->
            not_found;
        Msg0 ->
            Msg =
                case is_map(Msg0) of
                    true -> Msg0;
                    false -> hb_cache:ensure_all_loaded(Msg0, Opts)
                end,
            case blob_bytes(Msg, Opts) of
                Bytes when is_binary(Bytes) ->
                    case dev_lbry_stream_descriptor:verify_blob_hash(Hash, Bytes) of
                        ok -> {ok, dev_lbry_commitment:blob_message(Hash, Bytes)};
                        Error -> Error
                    end;
                _ ->
                    {error, missing_blob_data}
            end
    end.

first_fixture([], _Fixtures, _Opts) ->
    not_found;
first_fixture([Key | Rest], Fixtures, Opts) ->
    case hb_maps:get(Key, Fixtures, not_found, Opts) of
        not_found -> first_fixture(Rest, Fixtures, Opts);
        Msg -> Msg
    end.

blob_bytes(Msg, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"data">>, Msg, not_found, Opts) of
        Bytes when is_binary(Bytes) -> Bytes;
        _ -> hb_maps:get(<<"body">>, Msg, not_found, Opts)
    end;
blob_bytes(Bytes, _Opts) when is_binary(Bytes) ->
    Bytes;
blob_bytes(_Msg, _Opts) ->
    not_found.

request(Method, StoreOpts, Hash, NodeOpts) ->
    Node = hb_maps:get(<<"node">>, StoreOpts, ?DEFAULT_NODE, NodeOpts),
    Path = blob_path(Hash, StoreOpts, NodeOpts),
    HTTPOpts =
        case hb_maps:get(<<"http-client">>, StoreOpts, not_found, NodeOpts) of
            not_found -> NodeOpts;
            Client -> NodeOpts#{ <<"http-client">> => Client }
        end,
    hb_http_client:request(
        #{
            peer => Node,
            path => Path,
            method => Method,
            headers => #{},
            body => <<>>
        },
        HTTPOpts
    ).

blob_path(Hash, StoreOpts, Opts) ->
    case hb_maps:get(<<"edge-token">>, StoreOpts, not_found, Opts) of
        not_found ->
            <<"/blob?hash=", Hash/binary>>;
        Token ->
            Query =
                unicode:characters_to_binary(
                    uri_string:compose_query([
                        {<<"hash">>, Hash},
                        {<<"edge_token">>, hb_util:bin(Token)}
                    ])
                ),
            <<"/blob?", Query/binary>>
    end.

normalize_hash_key(<<"/", Rest/binary>>) ->
    normalize_hash_key(Rest);
normalize_hash_key(<<"lbry/blob/", Hash/binary>>) ->
    normalize_hash_key(Hash);
normalize_hash_key(<<"odysee/blob/", Hash/binary>>) ->
    normalize_hash_key(Hash);
normalize_hash_key(Hash) when is_binary(Hash) ->
    case hb_odysee_util:valid_hex(Hash, 48) of
        true -> {ok, hb_util:to_lower(Hash)};
        false -> error
    end;
normalize_hash_key(_) ->
    error.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

read_returns_committed_blob_message_test() ->
    application:ensure_all_started(inets),
    Body = <<"encrypted bytes">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Body),
    {ok, Server, Handle} = hb_mock_server:start([{"/blob", blob, {200, Body}}]),
    try
        Store = #{ <<"store-module">> => ?MODULE, <<"node">> => Server },
        {ok, Msg} =
            read(Store, #{ <<"read">> => Hash }, #{ <<"http-client">> => httpc }),
        ?assertEqual(Body, maps:get(<<"data">>, Msg)),
        ?assertEqual(Hash, maps:get(<<"blob-hash">>, Msg)),
        [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
        ?assertEqual(<<"lbry@1.0">>, maps:get(<<"commitment-device">>, Commitment)),
        ?assertEqual(<<"blob">>, maps:get(<<"evidence">>, Commitment)),
        ?assert(verify_lbry_message(Msg))
    after
        hb_mock_server:stop(Handle)
    end.

cache_read_returns_blob_message_test() ->
    application:ensure_all_started(inets),
    Body = <<"encrypted bytes">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Body),
    {ok, Server, Handle} = hb_mock_server:start([{"/blob", blob, {200, Body}}]),
    try
        Store = #{
            <<"store-module">> => ?MODULE,
            <<"node">> => Server,
            <<"http-client">> => httpc
        },
        {ok, Msg} = hb_cache:read(Hash, #{ <<"store">> => [Store] }),
        ?assertEqual(Body, maps:get(<<"data">>, Msg)),
        ?assert(verify_lbry_message(Msg))
    after
        hb_mock_server:stop(Handle)
    end.

read_serves_cached_blob_without_server_test_() ->
    {timeout, 60, fun() -> with_test_devices(fun read_serves_cached_blob_without_server/1) end}.

read_serves_cached_blob_without_server(DeviceOpts) ->
    application:ensure_all_started(inets),
    Body = <<"encrypted bytes">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Body),
    Cache = #{
        <<"store-module">> => hb_store_volatile,
        <<"name">> => <<"lbry-blob-cache-test">>
    },
    ok = hb_store:start(Cache),
    {ok, Server, Handle} = hb_mock_server:start([{"/blob", blob, {200, Body}}]),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"node">> => Server,
        <<"http-client">> => httpc,
        <<"local-store">> => Cache
    },
    NodeOpts = DeviceOpts#{ <<"http-client">> => httpc, <<"store">> => [Cache] },
    try
        {ok, First} = read(Store, #{ <<"read">> => Hash }, NodeOpts),
        {ok, Cached0} = hb_cache:read(Hash, #{ <<"store">> => [Cache] }),
        Cached = hb_cache:ensure_all_loaded(Cached0, #{ <<"store">> => [Cache] }),
        ?assertEqual(Body, maps:get(<<"data">>, Cached)),
        hb_mock_server:stop(Handle),
        {ok, Second} = read(Store, #{ <<"read">> => Hash }, NodeOpts),
        ?assertEqual(maps:get(<<"data">>, First), maps:get(<<"data">>, Second)),
        ?assert(verify_lbry_message(Second))
    after
        hb_store:stop(Cache)
    end.

read_refetches_on_corrupted_blob_cache_entry_test_() ->
    {timeout, 60, fun() -> with_test_devices(fun read_refetches_on_corrupted_blob_cache_entry/1) end}.

read_refetches_on_corrupted_blob_cache_entry(DeviceOpts) ->
    application:ensure_all_started(inets),
    Body = <<"encrypted bytes">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Body),
    Cache = #{
        <<"store-module">> => hb_store_volatile,
        <<"name">> => <<"lbry-blob-corrupt-cache-test">>
    },
    ok = hb_store:start(Cache),
    {ok, Server, Handle} = hb_mock_server:start([{"/blob", blob, {200, Body}}]),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"node">> => Server,
        <<"http-client">> => httpc,
        <<"local-store">> => Cache
    },
    NodeOpts = DeviceOpts#{ <<"http-client">> => httpc, <<"store">> => [Cache] },
    try
        ok = hb_store:write([Cache], #{ Hash => <<"garbage">> }, NodeOpts),
        {ok, Msg} = read(Store, #{ <<"read">> => Hash }, NodeOpts),
        ?assertEqual(Body, maps:get(<<"data">>, Msg)),
        {ok, Cached0} = hb_cache:read(Hash, #{ <<"store">> => [Cache] }),
        Cached = hb_cache:ensure_all_loaded(Cached0, #{ <<"store">> => [Cache] }),
        ?assertEqual(Body, maps:get(<<"data">>, Cached))
    after
        hb_mock_server:stop(Handle),
        hb_store:stop(Cache)
    end.

read_rejects_hash_mismatch_test() ->
    application:ensure_all_started(inets),
    Body = <<"encrypted bytes">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(<<"expected bytes">>),
    {ok, Server, Handle} = hb_mock_server:start([{"/blob", blob, {200, Body}}]),
    try
        Store = #{ <<"store-module">> => ?MODULE, <<"node">> => Server },
        ?assertMatch(
            {error, {hash_mismatch, Hash, _}},
            read(Store, #{ <<"read">> => Hash }, #{ <<"http-client">> => httpc })
        )
    after
        hb_mock_server:stop(Handle)
    end.

edge_token_is_query_encoded_test() ->
    Body = <<"encrypted bytes">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Body),
    {ok, Server, Handle} = hb_mock_server:start([
        {"/blob", blob, {200, Body}}
    ]),
    try
        Store = #{
            <<"store-module">> => ?MODULE,
            <<"node">> => Server,
            <<"edge-token">> => <<"a+b&c">>
        },
        {ok, #{ <<"data">> := Body }} =
            read(Store, #{ <<"read">> => Hash }, #{ <<"http-client">> => httpc }),
        [Req] = hb_mock_server:get_requests(Handle, blob),
        ?assertEqual(<<"hash=", Hash/binary, "&edge_token=a%2Bb%26c">>, maps:get(<<"qs">>, Req))
    after
        hb_mock_server:stop(Handle)
    end.

resolve_rejects_non_hash_test() ->
    ?assertEqual(
        {error, not_found},
        resolve(#{}, #{ <<"resolve">> => <<"not-a-hash">> }, #{})
    ).

verify_lbry_message(Msg) ->
    lists:all(
        fun(Commitment) -> dev_lbry:verify(Msg, Commitment, #{}) =:= {ok, true} end,
        maps:values(maps:get(<<"commitments">>, Msg))
    ).

with_test_devices(Fun) ->
    HBPreloaded = filename:join(code:lib_dir(hb), "src/preloaded"),
    BootstrapOpts = #{
        % ?FILE keeps the app source dir correct in both flat-src and
        % apps/<app>/src umbrella layouts.
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
