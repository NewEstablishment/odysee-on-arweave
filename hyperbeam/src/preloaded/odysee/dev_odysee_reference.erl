-module(dev_odysee_reference).
-implements(<<"odysee-reference@1.0">>).
-export([info/1, point/3, current/3, resolve/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(REF_CACHE, <<"odysee-reference@1.0">>).

info(_Opts) ->
    #{exports => [<<"point">>, <<"current">>, <<"resolve">>]}.

point(Base, Req, Opts) ->
    case is_operator(Base, Req, Opts) of
        false ->
            {ok, #{<<"status">> => 403, <<"message">> => <<"Unauthorized.">>}};
        true ->
            maybe
                {ok, Key} ?= reference_key(Base, Req, Opts),
                {ok, Target} ?= reference_target(Base, Req, Opts),
                Path = link_path(Key),
                ok ?= hb_cache:link(Target, Path, Opts),
                {ok, #{<<"status">> => 200, <<"key">> => Key, <<"target">> => Target}}
            else
                Error -> {ok, error_response(Error)}
            end
    end.

current(Base, Req, Opts) ->
    maybe
        {ok, Key} ?= reference_key(Base, Req, Opts),
        {ok, Value} ?= current_value(Key, Opts),
        {ok, Value}
    else
        Error -> {ok, error_response(Error)}
    end.

resolve(Base, Req, Opts) ->
    current(Base, Req, Opts).

reference_key(Base, Req, Opts) ->
    case param(Base, Req, [<<"key">>, <<"claim-id">>, <<"claim_id">>, <<"reference">>], Opts) of
        {ok, Key} -> {ok, hb_ao:normalize_key(Key)};
        Error -> Error
    end.

reference_target(Base, Req, Opts) ->
    case param(Base, Req, [<<"target">>, <<"target-id">>, <<"target_id">>, <<"id">>], Opts) of
        {ok, Target} -> {ok, Target};
        {error, _} -> target_from_value(Base, Req, Opts)
    end.

target_from_value(Base, Req, Opts) ->
    case first_value([Req, Base], <<"value">>, Opts) of
        not_found -> {error, {missing_required, <<"target">>}};
        Value -> hb_cache:write(Value, Opts)
    end.

cache_read(Path, Opts) ->
    case hb_cache:read(Path, Opts) of
        {ok, _} = Found -> Found;
        not_found -> {error, not_found};
        {error, _} = Error -> Error
    end.

current_value(Key, Opts) ->
    case cache_read(link_path(Key), Opts) of
        {ok, _} = Found -> Found;
        {error, not_found} -> legacy_claim_reference(Key, Opts);
        Error -> Error
    end.

legacy_claim_reference(ClaimID, Opts) ->
    case valid_hex_size(ClaimID, 20) of
        true ->
            maybe
                {ok, Claim} ?= cache_read(ClaimID, Opts),
                {ok, Outpoint} ?= claim_outpoint(Claim, Opts),
                cache_read(Outpoint, Opts)
            end;
        false ->
            {error, not_found}
    end.

claim_outpoint(Claim, Opts) when is_map(Claim) ->
    case first_found([<<"immutable-id">>, <<"immutable_id">>, <<"outpoint">>], Claim, not_found, Opts) of
        Outpoint when is_binary(Outpoint) ->
            normalize_outpoint(Outpoint);
        _ ->
            case first_found([<<"claim-output-store-path">>, <<"claim_output_store_path">>], Claim, not_found, Opts) of
                Path when is_binary(Path) -> outpoint_from_store_path(Path);
                _ -> outpoint_from_tx_fields(Claim, Opts)
            end
    end;
claim_outpoint(_Claim, _Opts) ->
    {error, missing_immutable_outpoint}.

outpoint_from_tx_fields(Claim, Opts) ->
    TxID = first_found([<<"txid">>, <<"tx-id">>], Claim, not_found, Opts),
    NOut = first_found([<<"nout">>, <<"n-out">>], Claim, not_found, Opts),
    case {TxID, nout_binary(NOut)} of
        {TxID, NOutBin} when is_binary(TxID), is_binary(NOutBin) ->
            normalize_outpoint(<<TxID/binary, ":", NOutBin/binary>>);
        _ ->
            {error, missing_immutable_outpoint}
    end.

outpoint_from_store_path(<<"odysee/claim-output/", Rest/binary>>) ->
    case binary:split(Rest, <<"/">>) of
        [TxID, NOut] -> normalize_outpoint(<<TxID/binary, ":", NOut/binary>>);
        _ -> {error, missing_immutable_outpoint}
    end;
outpoint_from_store_path(<<"odysee/outpoint/", Rest/binary>>) ->
    outpoint_from_store_path(<<"odysee/claim-output/", Rest/binary>>);
outpoint_from_store_path(<<"odysee/claim-proof/", Rest/binary>>) ->
    outpoint_from_store_path(<<"odysee/claim-output/", Rest/binary>>);
outpoint_from_store_path(_Path) ->
    {error, missing_immutable_outpoint}.

normalize_outpoint(Outpoint) ->
    case binary:split(Outpoint, <<":">>) of
        [TxID, NOut] ->
            case valid_hex_size(TxID, 32) andalso valid_uint(NOut) of
                true -> {ok, <<(hb_util:to_lower(TxID))/binary, ":", NOut/binary>>};
                false -> {error, missing_immutable_outpoint}
            end;
        _ ->
            {error, missing_immutable_outpoint}
    end.

is_operator(Base, Req, Opts) ->
    Subject = signed_subject(Base, Req, Opts),
    case hb_ao:resolve(
        #{<<"device">> => <<"meta@1.0">>},
        #{<<"path">> => <<"is-operator">>, <<"body">> => Subject},
        Opts#{<<"hashpath">> => ignore}
    ) of
        {ok, Result} -> Result;
        _ -> false
    end.

signed_subject(Base, Req, Opts) ->
    case hb_message:signers(Req, Opts) of
        [] ->
            case hb_message:signers(Base, Opts) of
                [] -> Req;
                _ -> Base
            end;
        _ ->
            Req
    end.

param(Base, Req, Keys, Opts) ->
    case first_param(Base, Req, Keys, Opts) of
        Value when is_binary(Value), byte_size(Value) > 0 -> {ok, Value};
        _ -> {error, {missing_required, hd(Keys)}}
    end.

first_param(_Base, _Req, [], _Opts) ->
    not_found;
first_param(Base, Req, [Key | Rest], Opts) ->
    case first_value([Req, Base], Key, Opts) of
        not_found -> first_param(Base, Req, Rest, Opts);
        Value -> Value
    end.

first_value([], _Key, _Opts) ->
    not_found;
first_value([Msg | Rest], Key, Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_value(Rest, Key, Opts);
        Value -> Value
    end;
first_value([_ | Rest], Key, Opts) ->
    first_value(Rest, Key, Opts).

first_found([], _Msg, Default, _Opts) ->
    Default;
first_found([Key | Rest], Msg, Default, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_found(Rest, Msg, Default, Opts);
        Value -> Value
    end.

nout_binary(NOut) when is_integer(NOut), NOut >= 0 ->
    integer_to_binary(NOut);
nout_binary(NOut) when is_binary(NOut) ->
    case valid_uint(NOut) of
        true -> NOut;
        false -> not_found
    end;
nout_binary(_NOut) ->
    not_found.

valid_hex_size(Hex, Bytes) when is_binary(Hex), byte_size(Hex) =:= Bytes * 2 ->
    try binary:decode_hex(Hex) of
        Decoded -> byte_size(Decoded) =:= Bytes
    catch
        _:_ -> false
    end;
valid_hex_size(_Hex, _Bytes) ->
    false.

valid_uint(Bin) when is_binary(Bin), byte_size(Bin) > 0 ->
    try binary_to_integer(Bin) of
        Int -> Int >= 0
    catch
        _:_ -> false
    end;
valid_uint(_Bin) ->
    false.

link_path(Key) ->
    <<?REF_CACHE/binary, "/", Key/binary>>.

error_response(not_found) ->
    #{<<"status">> => 404, <<"message">> => <<"Reference not found.">>};
error_response({error, not_found}) ->
    error_response(not_found);
error_response({missing_required, Key}) ->
    #{<<"status">> => 400, <<"message">> => <<"Missing required field.">>, <<"field">> => Key};
error_response({error, {missing_required, Key}}) ->
    error_response({missing_required, Key});
error_response(Reason) ->
    #{<<"status">> => 500, <<"message">> => hb_util:bin(io_lib:format("~p", [Reason]))}.

test_opts(Tag) ->
    #{<<"store">> => [hb_test_utils:test_store(hb_store_fs, Tag)]}.

write_target(Marker, Opts) ->
    {ok, ID} = hb_cache:write(#{<<"odysee-reference-target">> => Marker}, Opts),
    ID.

current_marker(Key, Opts) ->
    Base = #{<<"device">> => <<"odysee-reference@1.0">>, <<"key">> => Key},
    {ok, Value} = hb_ao:resolve(Base, <<"current">>, Opts),
    hb_ao:get(<<"odysee-reference-target">>, Value, not_found, Opts).

point_reference(Key, Target, Opts) ->
    Base = #{<<"device">> => <<"odysee-reference@1.0">>, <<"key">> => Key, <<"target">> => Target},
    hb_ao:resolve(Base, <<"point">>, Opts).

point_then_current_updates_in_place_test() ->
    Opts = test_opts(<<"odysee-ref-update">>),
    Key = <<"claim">>,
    TargetA = write_target(<<"A">>, Opts),
    TargetB = write_target(<<"B">>, Opts),
    ?assertMatch({ok, #{<<"status">> := 200}}, point_reference(Key, TargetA, Opts)),
    ?assertEqual(<<"A">>, current_marker(Key, Opts)),
    ?assertMatch({ok, #{<<"status">> := 200}}, point_reference(Key, TargetB, Opts)),
    ?assertEqual(<<"B">>, current_marker(Key, Opts)).

resolve_aliases_current_test() ->
    Opts = test_opts(<<"odysee-ref-alias">>),
    Key = <<"claim">>,
    Target = write_target(<<"resolved">>, Opts),
    ?assertMatch({ok, #{<<"status">> := 200}}, point_reference(Key, Target, Opts)),
    Base = #{<<"device">> => <<"odysee-reference@1.0">>, <<"key">> => Key},
    {ok, Value} = hb_ao:resolve(Base, <<"resolve">>, Opts),
    ?assertEqual(<<"resolved">>, hb_ao:get(<<"odysee-reference-target">>, Value, not_found, Opts)).

legacy_claim_id_resolves_current_immutable_outpoint_test() ->
    ClaimID = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    TxID = <<"6f4fc565d9f7b553c2b87b17f0e1821adc281b6331b926d72df44ee45d44f284">>,
    Outpoint = <<TxID/binary, ":0">>,
    Claim = #{
        <<"claim_id">> => ClaimID,
        <<"txid">> => TxID,
        <<"nout">> => 0
    },
    Opts = test_opts(<<"odysee-ref-legacy-claim">>),
    Current = #{<<"marker">> => <<"current-immutable">>, <<"txid">> => TxID, <<"nout">> => 0},
    {ok, ClaimPath} = hb_cache:write(Claim, Opts),
    {ok, CurrentPath} = hb_cache:write(Current, Opts),
    ok = hb_cache:link(ClaimPath, ClaimID, Opts),
    ok = hb_cache:link(CurrentPath, Outpoint, Opts),
    Base = #{<<"device">> => <<"odysee-reference@1.0">>, <<"key">> => ClaimID},
    {ok, Value} = hb_ao:resolve(Base, <<"current">>, Opts),
    ?assertEqual(<<"current-immutable">>, hb_ao:get(<<"marker">>, Value, not_found, Opts)),
    ?assertEqual(TxID, hb_ao:get(<<"txid">>, Value, not_found, Opts)),
    ?assertEqual(0, hb_ao:get(<<"nout">>, Value, not_found, Opts)).

legacy_claim_id_accepts_existing_immutable_metadata_test() ->
    ClaimID = <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
    TxID = <<"6f4fc565d9f7b553c2b87b17f0e1821adc281b6331b926d72df44ee45d44f284">>,
    Outpoint = <<TxID/binary, ":0">>,
    Opts = test_opts(<<"odysee-ref-existing-immutable">>),
    Current = #{<<"marker">> => <<"current-immutable">>, <<"txid">> => TxID, <<"nout">> => 0},
    {ok, CurrentPath} = hb_cache:write(Current, Opts),
    ok = hb_cache:link(CurrentPath, Outpoint, Opts),
    lists:foreach(
        fun({Key, Claim}) ->
            {ok, ClaimPath} = hb_cache:write(Claim, Opts),
            ok = hb_cache:link(ClaimPath, Key, Opts),
            Base = #{<<"device">> => <<"odysee-reference@1.0">>, <<"key">> => Key},
            {ok, Value} = hb_ao:resolve(Base, <<"current">>, Opts),
            ?assertEqual(<<"current-immutable">>, hb_ao:get(<<"marker">>, Value, not_found, Opts))
        end,
        [
            {ClaimID, #{<<"immutable-id">> => Outpoint}},
            {<<"3fda836a92faaceedfe398225fb9b2ee2ed1f01a">>, #{<<"outpoint">> => Outpoint}},
            {<<"52a6a67c77a6adc6b502a9f15ebf92f9728e8ebe">>, #{
                <<"claim-output-store-path">> => <<"odysee/claim-output/", TxID/binary, "/0">>
            }}
        ]
    ).

unknown_reference_is_not_found_test() ->
    Opts = test_opts(<<"odysee-ref-missing">>),
    Base = #{<<"device">> => <<"odysee-reference@1.0">>, <<"key">> => <<"missing">>},
    ?assertMatch({ok, #{<<"status">> := 404}}, hb_ao:resolve(Base, <<"current">>, Opts)).

operator_gate_rejects_unsigned_on_claimed_node_test() ->
    Operator = ar_wallet:new(),
    Opts =
        (test_opts(<<"odysee-ref-gate">>))#{
            <<"priv-wallet">> => Operator,
            <<"operator">> => hb_util:human_id(ar_wallet:to_address(Operator))
        },
    Key = <<"claim">>,
    Target = write_target(<<"gated">>, Opts),
    Unsigned = #{<<"device">> => <<"odysee-reference@1.0">>, <<"key">> => Key, <<"target">> => Target},
    ?assertMatch({ok, #{<<"status">> := 403}}, hb_ao:resolve(Unsigned, <<"point">>, Opts)),
    Signed = hb_message:commit(Unsigned, Opts),
    ?assertMatch({ok, #{<<"status">> := 200}}, hb_ao:resolve(Signed, <<"point">>, Opts)),
    ?assertEqual(<<"gated">>, current_marker(Key, Opts)).
