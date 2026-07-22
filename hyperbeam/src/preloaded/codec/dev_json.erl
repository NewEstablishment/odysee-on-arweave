%%% @doc A simple JSON codec for HyperBEAM's message format. Takes a
%%% message as TABM and returns an encoded JSON string representation.
%%% This codec utilizes the httpsig@1.0 codec for signing and verifying.
-module(dev_json).
-export([to/3, from/3, commit/3, verify/3, committed/3, content_type/1]).
-export([deserialize/3, serialize/3]).
-include_lib("eunit/include/eunit.hrl").
-include("include/hb.hrl").

%% @doc Return the content type for the codec.
content_type(_) -> {ok, <<"application/json">>}.

%% @doc Encode a message to a JSON string, using JSON-native typing.
to(Msg, _Req, _Opts) when is_binary(Msg) ->
    {ok, hb_util:bin(json:encode(json_safe(Msg)))};
to(Msg, Req, Opts) ->
    ConvOpts = Opts#{ <<"hashpath">> => ignore },
    % The input to this function will be a TABM message, so we:
    % 1. Convert it to a structured message.
    % 2. Load any linked items if we are in `bundle' mode.
    % 3. Convert it back to a TABM message, this time preserving all types
    %    aside `atom's -- for which JSON has no native support.
    Restructured =
        hb_message:convert(
            hb_private:reset(Msg),
            <<"structured@1.0">>,
            tabm,
            ConvOpts
        ),
    Loaded =
        case hb_maps:get(<<"bundle">>, Req, false, Opts) of
            true -> hb_cache:ensure_all_loaded(Restructured, Opts);
            false -> Restructured
        end,
    JSONStructured =
        hb_message:convert(
            Loaded,
            tabm,
            #{
                <<"device">> => <<"structured@1.0">>,
                <<"encode-types">> => [<<"atom">>]
            },
            ConvOpts
        ),
    {ok, hb_json:encode(json_safe(JSONStructured))}.

%% @doc JSON has no binary type: a binary that is not valid UTF-8 (raw
%% transaction bytes, protobuf envelopes, digests) cannot be emitted by the
%% JSON encoder. Present such values as base64url strings instead. This is a
%% view-layer conversion only: the canonical, verifiable encoding of a
%% message remains `httpsig@1.0'.
json_safe(Map) when is_map(Map) ->
    maps:map(fun(_Key, Value) -> json_safe(Value) end, Map);
json_safe(List) when is_list(List) ->
    [json_safe(Value) || Value <- List];
json_safe(Bin) when is_binary(Bin) ->
    case unicode:characters_to_binary(Bin, utf8, utf8) of
        Bin -> Bin;
        _ -> #{
            <<"$ao-type">> => <<"binary">>,
            <<"base64url">> => hb_util:encode(Bin)
        }
    end;
json_safe(Value) ->
    Value.

json_restore(#{ <<"$ao-type">> := <<"binary">>, <<"base64url">> := Encoded } = Value)
        when map_size(Value) =:= 2, is_binary(Encoded) ->
    try hb_util:decode(Encoded)
    catch _:_ -> Value
    end;
json_restore(Map) when is_map(Map) ->
    maps:map(fun(_Key, Value) -> json_restore(Value) end, Map);
json_restore(List) when is_list(List) ->
    [json_restore(Value) || Value <- List];
json_restore(Value) ->
    Value.

%% @doc Decode a JSON string to a message.
from(Map, _Req, _Opts) when is_map(Map) -> {ok, json_restore(Map)};
from(JSON, Req, Opts) ->
    ConvOpts = Opts#{ <<"hashpath">> => ignore },
    % The JSON string will be a partially-TABM encoded message: Rich number
    % and list types, but no `atom's. Subsequently, we convert it to a fully
    % structured message after decoding, then turn the result back into a TABM.
    % This is resource-intensive and could be improved, but ensures that the
    % results are fully normalized.
    Structured =
        hb_message:convert(
            json_restore(json:decode(JSON)),
            <<"structured@1.0">>,
            tabm,
            ConvOpts
        ),
    ?event(debug_json, {structured, Structured}, Opts),
    case hb_maps:get(<<"accept-codec">>, Req, undefined, Opts) of
        <<"structured@1.0">> -> {ok, Structured};
        _ ->
            % Re-encode the structured message back to TABM for the caller.
            TABM =
                hb_message:convert(
                    Structured,
                    tabm,
                    Req#{ <<"device">> => <<"structured@1.0">> },
                    ConvOpts
                ),
            ?event(debug_json, {tabm, TABM}, Opts),
            {ok, TABM}
    end.

%% @doc Route commitments through `httpsig@1.0'.
commit(Msg, Req, Opts) ->
    {ok,
        hb_message:commit(
            Msg,
            Opts,
            Req#{ <<"commitment-device">> => <<"httpsig@1.0">> }
        )
    }.

%% @doc Route verification through `httpsig@1.0'.
verify(Msg, Req, Opts) ->
    {ok,
        hb_message:verify(
            Msg,
            Req#{ <<"commitment-device">> => <<"httpsig@1.0">> },
            Opts
        )
    }.

committed(Msg, Req, Opts) when is_binary(Msg) ->
    committed(hb_util:ok(from(Msg, Req, Opts)), Req, Opts);
committed(Msg, _Req, Opts) ->
    hb_message:committed(Msg, all, Opts).

%% @doc Deserialize the JSON string found at the given path.
deserialize(Base, Req, Opts) ->
    Payload = 
        hb_ao:get(
            Target =
                hb_ao:get(
                    <<"target">>,
                    Req,
                    <<"body">>,
                    Opts
                ),
            Base,
            Opts
        ),
    case Payload of
        not_found -> {error, #{
            <<"status">> => 404,
            <<"body">> =>
                <<
                    "JSON payload not found in the base message.",
                    "Searched for: ", Target/binary
                >>
            }};
        _ ->
            from(Payload, Req, Opts)
    end.

%% @doc Serialize a message to a JSON string.
serialize(Base, Msg, Opts) ->
    {ok,
        #{
            <<"content-type">> => <<"application/json">>,
            <<"body">> => hb_util:ok(to(Base, Msg, Opts))
        }
    }.

%%% Tests

raw_binary_values_encode_as_base64url_test() ->
    RawBytes = <<0, 179, 255, 16, 42>>,
    Msg = #{
        <<"device">> => <<"lbry-claim@1.0">>,
        <<"raw-transaction">> => RawBytes,
        <<"nested">> => #{ <<"envelope">> => RawBytes },
        <<"list">> => [RawBytes, <<"plain utf8">>]
    },
    {ok, JSON} = to(Msg, #{}, #{}),
    Decoded = json:decode(JSON),
    Encoded = #{
        <<"$ao-type">> => <<"binary">>,
        <<"base64url">> => hb_util:encode(RawBytes)
    },
    Leaves = json_leaves(Decoded),
    ?assertEqual(Encoded, maps:get(<<"raw-transaction">>, Decoded)),
    ?assertNot(lists:member(RawBytes, Leaves)),
    {ok, Restored} = from(JSON, #{}, #{}),
    ?assertEqual(RawBytes, maps:get(<<"raw-transaction">>, Restored)),
    {ok, RestoredMap} = from(Decoded, #{}, #{}),
    ?assertEqual(RawBytes, maps:get(<<"raw-transaction">>, RestoredMap)).

json_leaves(Map) when is_map(Map) ->
    lists:append([json_leaves(Value) || Value <- maps:values(Map)]);
json_leaves(List) when is_list(List) ->
    lists:append([json_leaves(Value) || Value <- List]);
json_leaves(Value) ->
    [Value].

decode_with_atom_test() ->
    JSON =
        <<"""
        [
            {
                "store-module": "hb_store_fs",
                "name": "cache-TEST/json-test-store",
                "ao-types": "store-module=\"atom\""
            }
        ]
        """>>,
    Msg = hb_message:convert(JSON, <<"structured@1.0">>, <<"json@1.0">>, #{}),
    ?assertMatch(
        [#{ <<"store-module">> := hb_store_fs }|_],
        hb_cache:ensure_all_loaded(Msg, #{})
    ).

deeply_nested_typed_keys_test() ->
    Opts = #{ <<"store">> => [hb_test_utils:test_store()] },
    Msg = #{
        <<"message">> =>
            [
                #{
                    <<"deep-integer">> => 456,
                    <<"deep-atom">> => atom,
                    <<"deep-list">> => [1,2,3]
                }
            ]
    },
    Encoded =
        hb_message:convert(
            Msg,
            #{
                <<"device">> => <<"json@1.0">>,
                <<"bundle">> => true
            },
            Opts
        ),
    ?event(debug_json, {encoded, Encoded}, Opts),
    Decoded =
        hb_message:convert(
            Encoded,
            <<"structured@1.0">>,
            <<"json@1.0">>,
            Opts
        ),
    ?event(debug_json, {decoded, Decoded}, Opts),
    ?assert(hb_message:match(Msg, Decoded, strict, Opts)).
