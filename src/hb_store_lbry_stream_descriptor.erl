%%% @doc A read-only store sourcing LBRY stream descriptors by `sd_hash'.
%%% Stream descriptors are stored as encrypted LBRY blobs, so this store first
%%% verifies the requested SHA-384 bytes through `hb_store_lbry_blob', then
%%% parses them as a descriptor and returns a message committed under a
%%% native `lbry@1.0' commitment with `descriptor' evidence.
-module(hb_store_lbry_stream_descriptor).
-export([scope/1, type/3, read/3, resolve/3]).

scope(_) -> remote.

resolve(_StoreOpts, #{ <<"resolve">> := Key }, _NodeOpts) ->
    case normalize_key(Key) of
        {ok, Hash, _Mode} -> {ok, Hash};
        error -> {error, not_found}
    end.

type(StoreOpts, #{ <<"type">> := Key }, NodeOpts) ->
    case read(StoreOpts, #{ <<"read">> => Key }, NodeOpts) of
        {ok, _} -> {ok, simple};
        Error -> Error
    end.

read(StoreOpts, #{ <<"read">> := Key }, NodeOpts) ->
    case normalize_key(Key) of
        {ok, Hash, Mode} ->
            case descriptor_bytes(StoreOpts, Hash, NodeOpts) of
                {ok, Bytes} -> descriptor_message(Hash, Bytes, Mode);
                Error -> Error
            end;
        error ->
            {error, not_found}
    end.

descriptor_message(Hash, Bytes, Mode) ->
    case dev_lbry_commitment:descriptor_message(Bytes, Hash) of
        {ok, Msg} ->
            {ok, Msg};
        {error, _} = Error ->
            case Mode of
                fallback -> {error, not_found};
                strict -> Error
            end
    end.

descriptor_bytes(StoreOpts, Hash, Opts) ->
    case descriptor_fixture(StoreOpts, Hash, Opts) of
        not_found ->
            blob_store_bytes(StoreOpts, Hash, Opts);
        Result ->
            Result
    end.

descriptor_fixture(StoreOpts, Hash, Opts) ->
    Fixtures = hb_maps:get(<<"fixtures">>, StoreOpts, #{}, Opts),
    Keys = [
        <<"lbry/descriptor/", Hash/binary>>,
        <<"lbry/stream-descriptor/", Hash/binary>>,
        <<"odysee/descriptor/", Hash/binary>>,
        <<"odysee/descriptor-id/", Hash/binary>>,
        <<"odysee/stream-descriptor/", Hash/binary>>,
        Hash
    ],
    case first_fixture(Keys, Fixtures, Opts) of
        not_found -> not_found;
        Msg -> descriptor_bytes_from_fixture(Msg, Opts)
    end.

first_fixture([], _Fixtures, _Opts) ->
    not_found;
first_fixture([Key | Rest], Fixtures, Opts) ->
    case hb_maps:get(Key, Fixtures, not_found, Opts) of
        not_found -> first_fixture(Rest, Fixtures, Opts);
        Msg -> Msg
    end.

descriptor_bytes_from_fixture(Msg, Opts) ->
    case Msg of
        Bytes when is_binary(Bytes) ->
            {ok, Bytes};
        Map when is_map(Map) ->
            Loaded = hb_cache:ensure_all_loaded(Map, Opts),
            case hb_maps:get(<<"raw">>, Loaded, not_found, Opts) of
                Bytes when is_binary(Bytes) -> {ok, Bytes};
                _ ->
                    case hb_maps:get(<<"body">>, Loaded, not_found, Opts) of
                        Bytes when is_binary(Bytes) -> {ok, Bytes};
                        _ -> {error, missing_descriptor_bytes}
                    end
            end;
        _ ->
            {error, missing_descriptor_bytes}
    end.

blob_store_bytes(StoreOpts, Hash, Opts) ->
    BlobStore = StoreOpts#{ <<"store-module">> => hb_store_lbry_blob },
    case hb_store_lbry_blob:read(BlobStore, #{ <<"read">> => Hash }, Opts) of
        {ok, Msg0} ->
            Msg = hb_cache:ensure_all_loaded(Msg0, Opts),
            case hb_maps:get(<<"data">>, Msg, not_found, Opts) of
                Bytes when is_binary(Bytes) -> {ok, Bytes};
                _ -> {error, missing_blob_data}
            end;
        Error ->
            Error
    end.

normalize_key(Key0) ->
    Key = strip_slash(hb_path:to_binary(Key0)),
    case descriptor_path_hash(Key) of
        {ok, Hash} ->
            {ok, Hash, strict};
        error ->
            case hb_odysee_util:valid_hex(Key, 48) of
                true -> {ok, hb_util:to_lower(Key), fallback};
                false -> error
            end
    end.

descriptor_path_hash(<<"lbry/descriptor/", Hash/binary>>) ->
    explicit_hash(Hash);
descriptor_path_hash(<<"lbry/stream-descriptor/", Hash/binary>>) ->
    explicit_hash(Hash);
descriptor_path_hash(<<"odysee/descriptor/", Hash/binary>>) ->
    explicit_hash(Hash);
descriptor_path_hash(<<"odysee/descriptor-id/", Hash/binary>>) ->
    explicit_hash(Hash);
descriptor_path_hash(<<"odysee/stream-descriptor/", Hash/binary>>) ->
    explicit_hash(Hash);
descriptor_path_hash(_Key) ->
    error.

explicit_hash(Hash) ->
    case hb_odysee_util:valid_hex(Hash, 48) of
        true -> {ok, hb_util:to_lower(Hash)};
        false -> error
    end.

strip_slash(<<"/", Rest/binary>>) ->
    strip_slash(Rest);
strip_slash(Key) ->
    Key.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

read_returns_committed_descriptor_message_test() ->
    {Raw, SDHash} = sample_descriptor(),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{
            <<"lbry/descriptor/", SDHash/binary>> => Raw
        }
    },
    {ok, Msg} = read(Store, #{ <<"read">> => <<"lbry/descriptor/", SDHash/binary>> }, #{}),
    ?assertEqual(SDHash, maps:get(<<"sd-hash">>, Msg)),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual(<<"lbry@1.0">>, maps:get(<<"commitment-device">>, Commitment)),
    ?assertEqual(<<"descriptor">>, maps:get(<<"evidence">>, Commitment)),
    ?assertEqual(
        true,
        hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, #{})
    ).

direct_hash_http_get_exposes_native_signature_input_test() ->
    application:ensure_all_started(inets),
    {Raw, SDHash} = sample_descriptor(),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{ SDHash => Raw }
    },
    Node = hb_http_server:start_node(#{ <<"store">> => [Store], <<"port">> => 0 }),
    URL =
        binary_to_list(
            <<Node/binary, "~cache@1.0/read?read=", SDHash/binary>>
        ),
    {ok, {{_, 200, _}, Headers, _Body}} =
        httpc:request(get, {URL, []}, [], [{body_format, binary}]),
    SignatureInput = http_header(<<"signature-input">>, Headers),
    ?assertNotEqual(not_found, SignatureInput),
    ?assertNotEqual(
        nomatch,
        binary:match(
            SignatureInput,
            <<"alg=\"lbry@1.0/sha-384\"">>
        )
    ),
    ?assertNotEqual(
        nomatch,
        binary:match(SignatureInput, <<"native-id=\"", SDHash/binary, "\"">>)
    ).

bare_non_descriptor_hash_returns_not_found_test() ->
    Bytes = <<"encrypted blob, not descriptor json">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{ Hash => Bytes }
    },
    ?assertEqual({error, not_found}, read(Store, #{ <<"read">> => Hash }, #{})).

explicit_non_descriptor_hash_fails_test() ->
    Bytes = <<"encrypted blob, not descriptor json">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{ <<"lbry/descriptor/", Hash/binary>> => Bytes }
    },
    ?assertMatch(
        {error, _},
        read(Store, #{ <<"read">> => <<"lbry/descriptor/", Hash/binary>> }, #{})
    ).

store_stack_falls_back_to_blob_for_non_descriptor_hash_test() ->
    Bytes = <<"encrypted blob, not descriptor json">>,
    Hash = dev_lbry_stream_descriptor:blob_hash(Bytes),
    Store = [
        #{
            <<"store-module">> => ?MODULE,
            <<"fixtures">> => #{ Hash => Bytes }
        },
        #{
            <<"store-module">> => hb_store_lbry_blob,
            <<"fixtures">> => #{ Hash => Bytes }
        }
    ],
    {ok, Msg} = hb_store:read(Store, Hash, #{}),
    ?assertEqual(Hash, maps:get(<<"blob-hash">>, Msg)),
    [Commitment] = maps:values(maps:get(<<"commitments">>, Msg)),
    ?assertEqual(<<"blob">>, maps:get(<<"evidence">>, Commitment)).

sample_descriptor() ->
    {Raw, SDHash, _BlobHash, _Ciphertext} =
        hb_lbry_test_fixtures:sample_descriptor(<<"hello verified legacy stream">>),
    {Raw, SDHash}.

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

-endif.
