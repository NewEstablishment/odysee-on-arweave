-module(hb_store_odysee).
-export([start/3, stop/3, reset/3, scope/0, scope/1]).
-export([read/3, type/3, resolve/3]).
-export([write/3, list/3, group/3, link/3]).
-include_lib("eunit/include/eunit.hrl").

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

%% @doc Canonicalize only the explicitly `odysee/'-namespaced paths this
%% store positively owns. Every other key resolves to itself, mirroring the
%% local stores' identity-when-no-links contract: resolution runs once
%% against the whole store list and the first `{ok, ...}' wins, so rewriting
%% a bare hex key here (e.g. lowercasing a txid-shaped key) would corrupt
%% lookups for sibling stores that own that key, and a `not_found' would
%% abort the read before any store is tried. Bare-key classification stays a
%% read-time concern, where each store only answers for what it can serve.
resolve(_StoreOpts, #{ <<"resolve">> := Key }, _NodeOpts) ->
    KeyBin = strip_slash(hb_path:to_binary(Key)),
    case KeyBin of
        <<"odysee/", _/binary>> ->
            case classify(KeyBin) of
                {ok, _Type, Canonical} -> {ok, Canonical};
                error -> {ok, KeyBin}
            end;
        _ ->
            {ok, KeyBin}
    end.

type(StoreOpts, #{ <<"type">> := Key }, NodeOpts) ->
    case read(StoreOpts, #{ <<"read">> => Key }, NodeOpts) of
        {ok, Msg} when is_map(Msg) -> {ok, composite};
        {ok, _} -> {ok, simple};
        Error -> Error
    end.

read(StoreOpts, #{ <<"read">> := Key }, NodeOpts) ->
    case classify(Key) of
        {ok, claim_output, Outpoint} ->
            read_claim_output(Outpoint, StoreOpts, NodeOpts);
        {ok, transaction, TxID} ->
            hb_store_lbry_transaction:read(StoreOpts, #{ <<"read">> => TxID }, NodeOpts);
        {ok, descriptor, Hash} ->
            hb_store_lbry_stream_descriptor:read(
                StoreOpts,
                #{ <<"read">> => <<"odysee/descriptor/", Hash/binary>> },
                NodeOpts
            );
        {ok, blob, Hash} ->
            hb_store_lbry_blob:read(
                StoreOpts,
                #{ <<"read">> => <<"odysee/blob/", Hash/binary>> },
                NodeOpts
            );
        {ok, descriptor_or_blob, Hash} ->
            read_descriptor_or_blob(Hash, StoreOpts, NodeOpts);
        error ->
            {error, not_found}
    end.

write(_StoreOpts, _Req, _NodeOpts) ->
    {error, read_only}.

list(_StoreOpts, _Req, _NodeOpts) ->
    {error, not_found}.

group(_StoreOpts, _Req, _NodeOpts) ->
    {error, read_only}.

link(_StoreOpts, _Req, _NodeOpts) ->
    {error, read_only}.

read_claim_output(Outpoint, StoreOpts, NodeOpts) ->
    hb_store_lbry_claim_output:read(
        StoreOpts#{ <<"kind">> => <<"auto">> },
        #{ <<"read">> => Outpoint },
        NodeOpts
    ).

read_descriptor_or_blob(Hash, StoreOpts, NodeOpts) ->
    case hb_store_lbry_stream_descriptor:read(
        StoreOpts,
        #{ <<"read">> => Hash },
        NodeOpts
    ) of
        {ok, _} = Result ->
            Result;
        _ ->
            hb_store_lbry_blob:read(StoreOpts, #{ <<"read">> => Hash }, NodeOpts)
    end.

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

mutable_claim_id_is_not_a_store_key_test() ->
    ClaimID = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    % Resolution is identity (the key may belong to a sibling store), but
    % this store still refuses to serve mutable claim-id lookups.
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
    % A txid-shaped key with uppercase hex may belong to another store in
    % the list; resolving it must not lowercase or otherwise rewrite it.
    MixedCaseTxID = <<"51D3CD6A27420ADDB648347410233931B862AB52660C1DBA58806B5B0F38A460">>,
    ?assertEqual(
        {ok, MixedCaseTxID},
        resolve(#{}, #{ <<"resolve">> => MixedCaseTxID }, #{})
    ),
    % Native message ids and arbitrary paths resolve to themselves rather
    % than not_found, so a store list led by this store can still read them.
    MsgID = <<"0NjWsJ4Y9q6FlCDBnCh-WS3DBzzw8elq-nmGN00Dik4">>,
    ?assertEqual({ok, MsgID}, resolve(#{}, #{ <<"resolve">> => MsgID }, #{})),
    ?assertEqual(
        {ok, <<"messages/abc/def">>},
        resolve(#{}, #{ <<"resolve">> => <<"messages/abc/def">> }, #{})
    ).

resolve_canonicalizes_owned_namespace_test() ->
    TxID = <<"51D3CD6A27420ADDB648347410233931B862AB52660C1DBA58806B5B0F38A460">>,
    Lower = hb_util:to_lower(TxID),
    % Explicitly odysee-namespaced paths are ours to canonicalize.
    ?assertEqual(
        {ok, <<Lower/binary, ":0">>},
        resolve(#{}, #{ <<"resolve">> => <<"odysee/claim-output/", TxID/binary, "/0">> }, #{})
    ),
    ?assertEqual(
        {ok, Lower},
        resolve(#{}, #{ <<"resolve">> => <<"odysee/transaction/", TxID/binary>> }, #{})
    ),
    % Unparseable odysee-prefixed paths fall back to identity, not failure.
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
        resolve(
            #{},
            #{ <<"resolve">> => <<"odysee/claim-output/", TxID/binary, "/0">> },
            #{}
        )
    ).

blob_read_uses_the_immutable_hash_test() ->
    Raw = <<"immutable blob">>,
    Hash = hb_lbry_stream_descriptor:blob_hash(Raw),
    Store = #{
        <<"fixtures">> => #{
            <<"odysee/blob/", Hash/binary>> => Raw
        }
    },
    {ok, Msg} = read(
        Store,
        #{ <<"read">> => <<"odysee/blob/", Hash/binary>> },
        #{}
    ),
    ?assertEqual(<<"lbry-blob@1.0">>, maps:get(<<"device">>, Msg)),
    ?assertEqual(Hash, maps:get(<<"blob-hash">>, Msg)).
