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

resolve(_StoreOpts, #{ <<"resolve">> := Key }, _NodeOpts) ->
    case classify(Key) of
        {ok, _Type, Canonical} -> {ok, Canonical};
        error -> {error, not_found}
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
    read_claim_output(
        Outpoint,
        [
            StoreOpts#{ <<"kind">> => <<"stream">> },
            StoreOpts#{ <<"kind">> => <<"channel">> },
            maps:remove(<<"kind">>, StoreOpts)
        ],
        NodeOpts,
        {error, not_found}
    ).

read_claim_output(_Outpoint, [], _NodeOpts, LastError) ->
    LastError;
read_claim_output(Outpoint, [StoreOpts | Rest], NodeOpts, _LastError) ->
    case hb_store_lbry_claim_output:read(
        StoreOpts,
        #{ <<"read">> => Outpoint },
        NodeOpts
    ) of
        {ok, _} = Result ->
            Result;
        Error ->
            read_claim_output(Outpoint, Rest, NodeOpts, Error)
    end.

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
    ?assertEqual(
        {error, not_found},
        resolve(#{}, #{ <<"resolve">> => ClaimID }, #{})
    ),
    ?assertEqual(
        {error, not_found},
        read(#{}, #{ <<"read">> => <<"odysee/claim-id/", ClaimID/binary>> }, #{})
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
