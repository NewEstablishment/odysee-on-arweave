%%% @doc Odysee legacy-content resolution device.
%%%
%%% Resolves a legacy LBRY identifier -- a claim outpoint, transaction id,
%%% stream-descriptor hash, or data-blob hash -- into a verified AO-Core
%%% message. This is the resolution logic that previously lived inside the
%%% `hb_store_odysee' store: classify an opaque key by its shape/namespace and
%%% dispatch to the source that owns it. It belongs in a device, not a store,
%%% because classification + dispatch is domain logic -- a store is a dumb
%%% key->bytes map with no knowledge of what a key means (per the core direction
%%% "resolution must be a device, not a store").
%%%
%%% Leaf access goes through `hb_lbry_bridge', so the four `hb_store_lbry_*'
%%% sources are reached through one shared, tested path rather than direct
%%% per-module store calls.
%%%
%%% Keys:
%%%   `read'    -- classify the id and return the resolved, verified message.
%%%   `resolve' -- canonicalize an `odysee/'-namespaced key; identity otherwise.
%%%   `type'    -- `composite' for a resolved message, else the underlying error.
%%% The id is accepted under `read'/`resolve'/`type'/`id'/`target'/`key'.
-module(dev_odysee_resolution).
-implements(<<"odysee-resolution@1.0">>).
-export([info/1, read/3, resolve/3, type/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

info(_Opts) ->
    #{ exports => [<<"read">>, <<"resolve">>, <<"type">>] }.

%% @doc Classify the requested id and dispatch to the owning source, returning
%% the resolved message (`{ok, Msg}') or `{error, not_found}' when the id is not
%% one this device owns.
read(Base, Req, Opts) ->
    case resolution_key(Base, Req, Opts) of
        {ok, Key} -> dispatch(classify(Key), Opts);
        {error, _} = Error -> Error
    end.

%% @doc Canonicalize only the explicitly `odysee/'-namespaced paths this device
%% positively owns. Every other key resolves to itself, mirroring the local
%% stores' identity-when-no-links contract -- rewriting a bare hex key (e.g.
%% lowercasing a txid-shaped key) would corrupt lookups for a sibling store that
%% owns it, and a `not_found' would abort a read before any store is tried.
resolve(Base, Req, Opts) ->
    case resolution_key(Base, Req, Opts) of
        {ok, Key0} ->
            KeyBin = strip_slash(hb_path:to_binary(Key0)),
            case KeyBin of
                <<"odysee/", _/binary>> ->
                    case classify(KeyBin) of
                        {ok, _Type, Canonical} -> {ok, Canonical};
                        error -> {ok, KeyBin}
                    end;
                _ ->
                    {ok, KeyBin}
            end;
        {error, _} = Error ->
            Error
    end.

%% @doc Type of the resolved id: `composite' for a resolved message.
type(Base, Req, Opts) ->
    case read(Base, Req, Opts) of
        {ok, Msg} when is_map(Msg) -> {ok, composite};
        {ok, _} -> {ok, simple};
        Error -> Error
    end.

%% -- dispatch --------------------------------------------------------------

dispatch({ok, claim_output, Outpoint}, Opts) ->
    {TxID, Nout} = split_outpoint(Outpoint),
    hb_lbry_bridge:auto_output_message(TxID, Nout, Opts);
dispatch({ok, transaction, TxID}, Opts) ->
    hb_lbry_bridge:transaction_message(TxID, Opts);
dispatch({ok, descriptor, Hash}, Opts) ->
    hb_lbry_bridge:descriptor_message(Hash, Opts);
dispatch({ok, blob, Hash}, Opts) ->
    hb_lbry_bridge:blob_message(Hash, Opts);
dispatch({ok, descriptor_or_blob, Hash}, Opts) ->
    case hb_lbry_bridge:descriptor_message(Hash, Opts) of
        {ok, _} = Result -> Result;
        _ -> hb_lbry_bridge:blob_message(Hash, Opts)
    end;
dispatch(error, _Opts) ->
    {error, not_found}.

split_outpoint(Outpoint) ->
    [TxID, NOutBin] = binary:split(Outpoint, <<":">>),
    {TxID, binary_to_integer(NOutBin)}.

%% -- key extraction --------------------------------------------------------

resolution_key(Base, Req, Opts) ->
    Keys = [<<"read">>, <<"resolve">>, <<"type">>, <<"id">>, <<"target">>, <<"key">>],
    case first_value([Req, Base], Keys, Opts) of
        not_found -> {error, {missing_required, <<"id">>}};
        Value -> {ok, Value}
    end.

first_value(_Msgs, [], _Opts) ->
    not_found;
first_value(Msgs, [Key | Rest], Opts) ->
    case first_in(Msgs, Key, Opts) of
        not_found -> first_value(Msgs, Rest, Opts);
        Value -> Value
    end.

first_in([], _Key, _Opts) ->
    not_found;
first_in([Msg | Rest], Key, Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_in(Rest, Key, Opts);
        Value -> Value
    end;
first_in([_ | Rest], Key, Opts) ->
    first_in(Rest, Key, Opts).

%% -- classification (ported verbatim from the former hb_store_odysee) ------

classify(Key0) ->
    Key = strip_slash(hb_path:to_binary(Key0)),
    classify_path(Key).

classify_path(<<"odysee/claim-output/", Rest/binary>>) ->
    explicit_outpoint(Rest);
classify_path(<<"odysee/outpoint/", Rest/binary>>) ->
    explicit_outpoint(Rest);
classify_path(<<"odysee/claim-proof/", Rest/binary>>) ->
    explicit_outpoint(Rest);
classify_path(<<"odysee/transaction/", TxID/binary>>) ->
    explicit_transaction(TxID);
classify_path(<<"odysee/descriptor/", Hash/binary>>) ->
    explicit_hash(descriptor, Hash);
classify_path(<<"odysee/descriptor-id/", Hash/binary>>) ->
    explicit_hash(descriptor, Hash);
classify_path(<<"odysee/stream-descriptor/", Hash/binary>>) ->
    explicit_hash(descriptor, Hash);
classify_path(<<"odysee/blob/", Hash/binary>>) ->
    explicit_hash(blob, Hash);
classify_path(<<"odysee/blob-id/", Hash/binary>>) ->
    explicit_hash(blob, Hash);
classify_path(Key) ->
    case parse_outpoint(Key) of
        {ok, Outpoint} ->
            {ok, claim_output, Outpoint};
        error ->
            classify_hash(Key)
    end.

explicit_outpoint(Rest) ->
    case binary:split(Rest, <<"/">>) of
        [TxID, NOut] -> classify_path(<<TxID/binary, ":", NOut/binary>>);
        _ -> error
    end.

explicit_transaction(TxID) ->
    case valid_hex(TxID, 32) of
        true -> {ok, transaction, hb_util:to_lower(TxID)};
        false -> error
    end.

explicit_hash(Type, Hash) ->
    case valid_hex(Hash, 48) of
        true -> {ok, Type, hb_util:to_lower(Hash)};
        false -> error
    end.

classify_hash(Key) ->
    case {valid_hex(Key, 32), valid_hex(Key, 48)} of
        {true, _} -> {ok, transaction, hb_util:to_lower(Key)};
        {_, true} -> {ok, descriptor_or_blob, hb_util:to_lower(Key)};
        _ -> error
    end.

parse_outpoint(Key) ->
    case binary:split(Key, <<":">>) of
        [TxID, NOut] ->
            case valid_hex(TxID, 32) andalso valid_uint(NOut) of
                true ->
                    {ok, <<(hb_util:to_lower(TxID))/binary, ":", NOut/binary>>};
                false ->
                    error
            end;
        _ ->
            error
    end.

strip_slash(<<"/", Rest/binary>>) ->
    strip_slash(Rest);
strip_slash(Key) ->
    Key.

valid_hex(Hex, Bytes) when is_binary(Hex), byte_size(Hex) =:= Bytes * 2 ->
    try binary:decode_hex(Hex) of
        Decoded -> byte_size(Decoded) =:= Bytes
    catch
        _:_ -> false
    end;
valid_hex(_Hex, _Bytes) ->
    false.

valid_uint(Bin) when is_binary(Bin), byte_size(Bin) > 0 ->
    try binary_to_integer(Bin) of
        Int -> Int >= 0
    catch
        _:_ -> false
    end;
valid_uint(_Bin) ->
    false.

%%% Tests

-ifdef(TEST).

mutable_claim_id_is_not_a_store_key_test() ->
    ClaimID = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    % Resolution is identity (the key may belong to a sibling store), but a
    % mutable claim-id is not something this device resolves to content.
    ?assertEqual(
        {ok, ClaimID},
        resolve(#{}, #{ <<"resolve">> => ClaimID }, #{})
    ),
    ?assertEqual(
        {error, not_found},
        read(#{}, #{ <<"read">> => ClaimID }, #{})
    ),
    ?assertEqual(
        {error, not_found},
        read(#{}, #{ <<"read">> => <<"odysee/claim-id/", ClaimID/binary>> }, #{})
    ).

resolve_never_rewrites_foreign_keys_test() ->
    MixedCaseTxID = <<"51D3CD6A27420ADDB648347410233931B862AB52660C1DBA58806B5B0F38A460">>,
    ?assertEqual(
        {ok, MixedCaseTxID},
        resolve(#{}, #{ <<"resolve">> => MixedCaseTxID }, #{})
    ),
    MsgID = <<"0NjWsJ4Y9q6FlCDBnCh-WS3DBzzw8elq-nmGN00Dik4">>,
    ?assertEqual({ok, MsgID}, resolve(#{}, #{ <<"resolve">> => MsgID }, #{})),
    ?assertEqual(
        {ok, <<"messages/abc/def">>},
        resolve(#{}, #{ <<"resolve">> => <<"messages/abc/def">> }, #{})
    ).

resolve_canonicalizes_owned_namespace_test() ->
    TxID = <<"51D3CD6A27420ADDB648347410233931B862AB52660C1DBA58806B5B0F38A460">>,
    Lower = hb_util:to_lower(TxID),
    ?assertEqual(
        {ok, <<Lower/binary, ":0">>},
        resolve(#{}, #{ <<"resolve">> => <<"odysee/claim-output/", TxID/binary, "/0">> }, #{})
    ),
    ?assertEqual(
        {ok, Lower},
        resolve(#{}, #{ <<"resolve">> => <<"odysee/transaction/", TxID/binary>> }, #{})
    ),
    ?assertEqual(
        {ok, <<"odysee/claim-id/abc">>},
        resolve(#{}, #{ <<"resolve">> => <<"odysee/claim-id/abc">> }, #{})
    ).

outpoint_is_an_immutable_store_key_test() ->
    TxID = <<"51d3cd6a27420addb648347410233931b862ab52660c1dba58806b5b0f38a460">>,
    Outpoint = <<TxID/binary, ":0">>,
    ?assertEqual(
        {ok, Outpoint},
        resolve(#{}, #{ <<"resolve">> => Outpoint }, #{})
    ),
    ?assertEqual(
        {ok, Outpoint},
        resolve(#{}, #{ <<"resolve">> => <<"odysee/claim-output/", TxID/binary, "/0">> }, #{})
    ).

blob_read_uses_the_immutable_hash_test() ->
    Raw = <<"immutable blob">>,
    Hash = hb_lbry_stream_descriptor:blob_hash(Raw),
    % The leaf blob source draws from `fixtures' in its own store config, which
    % the bridge assembles from the `lbry-blob-store' node option.
    Opts = #{
        <<"lbry-blob-store">> => #{
            <<"fixtures">> => #{
                <<"odysee/blob/", Hash/binary>> => Raw
            }
        }
    },
    {ok, Msg} = read(#{}, #{ <<"read">> => <<"odysee/blob/", Hash/binary>> }, Opts),
    ?assertEqual(<<"lbry-blob@1.0">>, maps:get(<<"device">>, Msg)),
    ?assertEqual(Hash, maps:get(<<"blob-hash">>, Msg)).

-endif.
