%%% @doc Odysee HyperBEAM-native upload/write demo device.
%%%
%%% The request must be signed by the node's auth hook, normally via an
%%% Odysee `auth_token' cookie or token header plus the `!' commit marker.
%%% Only committed fields are persisted, so auth cookies and token headers are
%%% not written to the public store.
-module(dev_odysee_upload).
-implements(<<"odysee-upload@1.0">>).
-export([chunk/3, delete/3, finalize/3, index/3, info/1, list/3, write/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

info(_Opts) ->
    #{ exports => [<<"chunk">>, <<"delete">>, <<"finalize">>, <<"index">>, <<"list">>, <<"write">>] }.

chunk(Base, Req, Opts) ->
    write(Base, Req, Opts).

finalize(Base, Req, Opts) ->
    write(Base, Req, Opts).

index(_Base, Req, Opts) ->
    safe(fun() ->
        maybe
            ok ?= require_post(Req, Opts),
            {ok, Signers} ?= require_signed(Req, Opts),
            {ok, Owner} ?= owner_identity(Req, Signers, Opts),
            {ok, Payload} ?= request_json_body(Req, Opts),
            {ok, Claim} ?= indexed_claim(Payload, Opts),
            {ok, State0} ?= read_index(Owner, Opts),
            ClaimID = hb_maps:get(<<"claim_id">>, Claim, <<>>, Opts),
            Uploads0 = hb_maps:get(<<"uploads">>, State0, #{}, Opts),
            Uploads1 = Uploads0#{ ClaimID => Claim },
            State1 = State0#{ <<"uploads">> => Uploads1 },
            ok ?= write_index(Owner, State1, Opts),
            ok ?= write_global_claim(ClaimID, Claim, Opts),
            {ok, json_response(#{ <<"item">> => Claim, <<"signers">> => Signers })}
        else
            Error -> Error
        end
    end).

list(_Base, Req, Opts) ->
    safe(fun() ->
        maybe
            ok ?= require_post(Req, Opts),
            {ok, Filters} ?= list_filters(Req, Opts),
            {ok, Uploads} ?= indexed_uploads(Filters, Opts),
            {ok,
                json_response(#{
                    <<"items">> => Uploads,
                    <<"total_items">> => length(Uploads)
                })}
        else
            Error -> Error
        end
    end).

delete(_Base, Req, Opts) ->
    safe(fun() ->
        maybe
            ok ?= require_post(Req, Opts),
            {ok, Signers} ?= require_signed(Req, Opts),
            {ok, Owner} ?= owner_identity(Req, Signers, Opts),
            {ok, ClaimID} ?= delete_claim_id(Req, Opts),
            {ok, State0} ?= read_index(Owner, Opts),
            Uploads0 = hb_maps:get(<<"uploads">>, State0, #{}, Opts),
            Uploads1 = maps:remove(ClaimID, Uploads0),
            State1 = State0#{ <<"uploads">> => Uploads1 },
            ok ?= write_index(Owner, State1, Opts),
            ok ?= delete_global_claim(ClaimID, Opts),
            {ok, json_response(#{ <<"claim_id">> => ClaimID, <<"deleted">> => true, <<"signers">> => Signers })}
        else
            Error -> Error
        end
    end).

write(_Base, Req, Opts) ->
    safe(fun() ->
        maybe
            ok ?= require_post(Req, Opts),
            {ok, Signers} ?= require_signed(Req, Opts),
            {ok, Stored} ?= upload_message(Req, Signers, Opts),
            {ok, Path} ?= hb_cache:write(Stored, Opts),
            {ok, response(Path, Signers)}
        else
            Error -> Error
        end
    end).

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> {error, Reason};
        _:Reason -> {error, Reason}
    end.

require_post(Req, Opts) ->
    case hb_maps:get(<<"method">>, Req, <<"GET">>, Opts) of
        <<"POST">> -> ok;
        _ ->
            {error,
                #{
                    <<"status">> => 405,
                    <<"body">> => <<"Use POST for Odysee upload writes.">>
                }
            }
    end.

require_signed(Req, Opts) ->
    case hb_message:signers(Req, Opts) of
        [] ->
            {error,
                #{
                    <<"status">> => 401,
                    <<"www-authenticate">> => <<"OdyseeAuthToken">>,
                    <<"body">> =>
                        <<"Odysee upload writes require an auth-signed request.">>
                }
            };
        Signers ->
            {ok, Signers}
    end.

upload_message(Req, Signers, Opts) ->
    case hb_maps:find(<<"body">>, Req, Opts) of
        {ok, Body} ->
            ContentType = hb_maps:get(<<"content-type">>, Req, <<"application/octet-stream">>, Opts),
            Clean =
                #{
                    <<"body">> => Body,
                    <<"content-type">> => ContentType,
                    <<"upload-auth-signers">> => Signers
                },
            {ok, hb_message:commit(Clean, Opts)};
        error ->
            {error,
                #{
                    <<"status">> => 400,
                    <<"body">> => <<"Upload write request requires a body.">>
                }
            }
    end.

owner_identity(Req, Signers, Opts) ->
    case auth_token(Req, Opts) of
        {ok, Token} -> {ok, token_secret(Token)};
        not_found ->
            case Signers of
                [Signer | _] -> {ok, Signer};
                [] -> {error, no_upload_owner}
            end
    end.

auth_token(Req, Opts) ->
    case authorization_token(Req, Opts) of
        {ok, _Token} = Found -> Found;
        not_found -> token_field(Req, Opts)
    end.

authorization_token(Req, Opts) ->
    case first_field([<<"authorization">>], Req, Opts) of
        not_found -> not_found;
        Auth ->
            try authorization_value(hb_util:bin(Auth))
            catch _:_ -> not_found
            end
    end.

authorization_value(Auth) ->
    case binary:split(string:trim(Auth), <<" ">>) of
        [Scheme, Value0] ->
            Value = string:trim(Value0, leading),
            case hb_util:to_lower(Scheme) of
                <<"bearer">> when Value =/= <<>> -> {ok, Value};
                <<"token">> when Value =/= <<>> -> {ok, Value};
                _ -> not_found
            end;
        _ ->
            not_found
    end.

token_field(Req, Opts) ->
    case first_field(token_keys(), Req, Opts) of
        not_found -> not_found;
        Token -> {ok, Token}
    end.

token_secret(Token0) ->
    Token = hb_util:bin(Token0),
    hb_util:encode(hb_crypto:sha256(<<"odysee-upload:", Token/binary>>)).

token_keys() ->
    [
        <<"auth-token">>,
        <<"auth_token">>,
        <<"odysee-auth-token">>,
        <<"odysee_auth_token">>,
        <<"x-odysee-auth-token">>,
        <<"x_odysee_auth_token">>,
        <<"x-lbry-auth-token">>,
        <<"x_lbry_auth_token">>
    ].

request_json_body(Req, Opts) ->
    case upload_claim_header(Req, Opts) of
        {ok, Claim} ->
            {ok, #{ <<"claim">> => Claim }};
        not_found ->
            request_json_body_from_payload(Req, Opts)
    end.

request_json_body_from_payload(Req, Opts) ->
    case request_json_payload(Req, Opts) of
        {ok, Body} when is_binary(Body) ->
            try {ok, hb_json:decode(Body)}
            catch _:_ ->
                {error,
                    #{
                        <<"status">> => 400,
                        <<"body">> => <<"Upload index request body must be JSON.">>
                    }
                }
            end;
        {ok, Body} when is_map(Body) ->
            {ok, Body};
        request_fields ->
            {ok, Req};
        _ ->
            {error,
                #{
                    <<"status">> => 400,
                    <<"body">> => <<"Upload index request requires a JSON body.">>
                }
            }
    end.

upload_claim_header(Req, Opts) ->
    case first_field([<<"x-odysee-upload-claim">>, <<"odysee-upload-claim">>], Req, Opts) of
        not_found ->
            not_found;
        Encoded ->
            try {ok, hb_json:decode(hb_util:decode(hb_util:bin(Encoded)))}
            catch _:_ ->
                {error,
                    #{
                        <<"status">> => 400,
                        <<"body">> => <<"Upload index claim header must be base64url JSON.">>
                    }
                }
            end
    end.

request_json_payload(Req, Opts) ->
    case hb_maps:find(<<"body">>, Req, Opts) of
        {ok, Body = #{}} ->
            case hb_maps:find(<<"data">>, Body, Opts) of
                {ok, Data} -> {ok, Data};
                error -> {ok, Body}
            end;
        {ok, Body} ->
            {ok, Body};
        error ->
            case hb_maps:find(<<"data">>, Req, Opts) of
                {ok, Data} -> {ok, Data};
                error ->
                    case hb_maps:find(<<"claim">>, Req, Opts) of
                        {ok, _Claim} -> request_fields;
                        error -> error
                    end
            end
    end.

indexed_claim(Payload, Opts) ->
    Claim = hb_maps:get(<<"claim">>, Payload, Payload, Opts),
    case Claim of
        ClaimMap when is_map(ClaimMap) ->
            case hb_maps:get(<<"claim_id">>, ClaimMap, <<>>, Opts) of
                <<>> ->
                    {error,
                        #{
                            <<"status">> => 400,
                            <<"body">> => <<"Upload index claim requires claim_id.">>
                        }
                    };
                _ ->
                    {ok, ClaimMap}
            end;
        _ ->
            {error,
                #{
                    <<"status">> => 400,
                    <<"body">> => <<"Upload index request requires a claim object.">>
                }
            }
    end.

delete_claim_id(Req, Opts) ->
    case first_field([<<"x-odysee-upload-claim-id">>, <<"odysee-upload-claim-id">>, <<"claim_id">>], Req, Opts) of
        not_found ->
            {error,
                #{
                    <<"status">> => 400,
                    <<"body">> => <<"Upload delete requires claim_id.">>
                }
            };
        <<>> ->
            {error,
                #{
                    <<"status">> => 400,
                    <<"body">> => <<"Upload delete requires claim_id.">>
                }
            };
        ClaimID ->
            {ok, hb_util:bin(ClaimID)}
    end.

read_index(Owner, Opts) ->
    case hb_store:read(hb_opts:get(store, [], Opts), index_path(Owner), Opts) of
        {ok, Bin} when is_binary(Bin) ->
            try {ok, maps:merge(default_index(), hb_json:decode(Bin))}
            catch _:_ -> {ok, default_index()}
            end;
        _ ->
            {ok, default_index()}
    end.

write_index(Owner, State, Opts) ->
    hb_store:write(hb_opts:get(store, [], Opts), #{ index_path(Owner) => hb_json:encode(State) }, Opts).

index_path(Owner) ->
    <<"odysee/upload-index/", (owner_key(Owner))/binary, "/state.json">>.

read_global_index(Opts) ->
    case hb_store:read(hb_opts:get(store, [], Opts), global_index_path(), Opts) of
        {ok, Bin} when is_binary(Bin) ->
            try {ok, maps:merge(default_index(), hb_json:decode(Bin))}
            catch _:_ -> {ok, default_index()}
            end;
        _ ->
            {ok, default_index()}
    end.

write_global_claim(ClaimID, Claim, Opts) ->
    maybe
        {ok, State0} ?= read_global_index(Opts),
        Uploads0 = hb_maps:get(<<"uploads">>, State0, #{}, Opts),
        Uploads1 = Uploads0#{ ClaimID => Claim },
        State1 = State0#{ <<"uploads">> => Uploads1 },
        ok ?= hb_store:write(hb_opts:get(store, [], Opts), #{ global_index_path() => hb_json:encode(State1) }, Opts),
        ok ?= hb_store:write(hb_opts:get(store, [], Opts), #{ claim_index_path(ClaimID) => hb_json:encode(Claim) }, Opts),
        write_channel_claim(channel_id_from_claim(Claim, Opts), ClaimID, Claim, Opts)
    end.

delete_global_claim(ClaimID, Opts) ->
    maybe
        {ok, State0} ?= read_global_index(Opts),
        Uploads0 = hb_maps:get(<<"uploads">>, State0, #{}, Opts),
        Existing = hb_maps:get(ClaimID, Uploads0, undefined, Opts),
        Uploads1 = maps:remove(ClaimID, Uploads0),
        State1 = State0#{ <<"uploads">> => Uploads1 },
        ok ?= hb_store:write(hb_opts:get(store, [], Opts), #{ global_index_path() => hb_json:encode(State1) }, Opts),
        ok ?= hb_store:write(hb_opts:get(store, [], Opts), #{ claim_index_path(ClaimID) => <<>> }, Opts),
        delete_channel_claim(channel_id_from_claim(Existing, Opts), ClaimID, Opts)
    end.

global_index_path() ->
    <<"odysee/upload-index/global/state.json">>.

claim_index_path(ClaimID) ->
    <<"odysee/upload-index/claims/", (owner_key(ClaimID))/binary, ".json">>.

channel_index_path(ChannelID) ->
    <<"odysee/upload-index/channels/", (owner_key(ChannelID))/binary, "/state.json">>.

write_channel_claim(undefined, _ClaimID, _Claim, _Opts) ->
    ok;
write_channel_claim(<<>>, _ClaimID, _Claim, _Opts) ->
    ok;
write_channel_claim(ChannelID, ClaimID, Claim, Opts) ->
    maybe
        {ok, State0} ?= read_channel_index(ChannelID, Opts),
        Uploads0 = hb_maps:get(<<"uploads">>, State0, #{}, Opts),
        Uploads1 = Uploads0#{ ClaimID => Claim },
        State1 = State0#{ <<"uploads">> => Uploads1 },
        hb_store:write(hb_opts:get(store, [], Opts), #{ channel_index_path(ChannelID) => hb_json:encode(State1) }, Opts)
    end.

delete_channel_claim(undefined, _ClaimID, _Opts) ->
    ok;
delete_channel_claim(<<>>, _ClaimID, _Opts) ->
    ok;
delete_channel_claim(ChannelID, ClaimID, Opts) ->
    maybe
        {ok, State0} ?= read_channel_index(ChannelID, Opts),
        Uploads0 = hb_maps:get(<<"uploads">>, State0, #{}, Opts),
        Uploads1 = maps:remove(ClaimID, Uploads0),
        State1 = State0#{ <<"uploads">> => Uploads1 },
        hb_store:write(hb_opts:get(store, [], Opts), #{ channel_index_path(ChannelID) => hb_json:encode(State1) }, Opts)
    end.

read_channel_index(ChannelID, Opts) ->
    case hb_store:read(hb_opts:get(store, [], Opts), channel_index_path(ChannelID), Opts) of
        {ok, Bin} when is_binary(Bin) ->
            try {ok, maps:merge(default_index(), hb_json:decode(Bin))}
            catch _:_ -> {ok, default_index()}
            end;
        _ ->
            {ok, default_index()}
    end.

indexed_uploads(Filters, Opts) ->
    ClaimIDs = claim_ids_from_filters(Filters, Opts),
    ChannelIDs = channel_ids_from_filters(Filters, Opts),
    case {ClaimIDs, ChannelIDs} of
        {[_ | _], _} ->
            {ok, sort_uploads(claim_uploads(ClaimIDs, Opts), Opts)};
        {[], []} ->
            maybe
                {ok, State} ?= read_global_index(Opts),
                Uploads = maps:values(hb_maps:get(<<"uploads">>, State, #{}, Opts)),
                {ok, sort_uploads(Uploads, Opts)}
            end;
        {[], _} ->
            {ok, sort_uploads(channel_uploads(ChannelIDs, Opts), Opts)}
    end.

claim_uploads(ClaimIDs, Opts) ->
    [
        Claim
     || ClaimID <- ClaimIDs,
        {ok, Claim} <- [read_claim_index(ClaimID, Opts)]
    ].

read_claim_index(ClaimID, Opts) ->
    case hb_store:read(hb_opts:get(store, [], Opts), claim_index_path(ClaimID), Opts) of
        {ok, Bin} when is_binary(Bin), Bin =/= <<>> ->
            try {ok, hb_json:decode(Bin)}
            catch _:_ -> not_found
            end;
        _ ->
            not_found
    end.

channel_uploads(ChannelIDs, Opts) ->
    UploadsByID =
        lists:foldl(
            fun(ChannelID, Acc) ->
                case read_channel_index(ChannelID, Opts) of
                    {ok, State} -> maps:merge(Acc, hb_maps:get(<<"uploads">>, State, #{}, Opts));
                    _ -> Acc
                end
            end,
            #{},
            ChannelIDs
        ),
    maps:values(UploadsByID).

sort_uploads(Uploads, Opts) ->
    lists:sort(
        fun(Left, Right) ->
            upload_timestamp(Left, Opts) >= upload_timestamp(Right, Opts)
        end,
        Uploads
    ).

upload_timestamp(Claim, Opts) ->
    case hb_maps:get(<<"timestamp">>, Claim, 0, Opts) of
        Value when is_integer(Value) -> Value;
        Value when is_binary(Value) ->
            try binary_to_integer(Value)
            catch _:_ -> 0
            end;
        _ -> 0
    end.

optional_json_body(Req, Opts) ->
    case request_json_body_from_payload(Req, Opts) of
        {ok, Body} -> {ok, Body};
        _ -> {ok, #{}}
    end.

list_filters(Req, Opts) ->
    maybe
        {ok, BodyFilters} ?= optional_json_body(Req, Opts),
        RequestChannelIDs = channel_ids_from_request(Req, Opts),
        BodyChannelIDs = channel_ids_from_filters(BodyFilters, Opts),
        RequestClaimIDs = claim_ids_from_request(Req, Opts),
        BodyClaimIDs = claim_ids_from_filters(BodyFilters, Opts),
        ChannelIDs = lists:usort(RequestChannelIDs ++ BodyChannelIDs),
        ClaimIDs = lists:usort(RequestClaimIDs ++ BodyClaimIDs),
        FiltersWithClaims =
            case ClaimIDs of
                [] -> BodyFilters;
                _ -> BodyFilters#{ <<"claim_ids">> => ClaimIDs }
            end,
        case ChannelIDs of
            [] -> {ok, FiltersWithClaims};
            _ -> {ok, FiltersWithClaims#{ <<"channel_ids">> => ChannelIDs }}
        end
    end.

claim_ids_from_request(Req, Opts) ->
    case first_field(
        [
            <<"x-odysee-claim-ids">>,
            <<"x-odysee-claim-id">>,
            <<"claim-ids">>,
            <<"claim-id">>,
            <<"claim_ids">>,
            <<"claim_id">>
        ],
        Req,
        Opts
    ) of
        not_found -> [];
        Value -> normalize_id_list(Value)
    end.

claim_ids_from_filters(Filters, Opts) ->
    lists:usort(
        normalize_id_list(hb_maps:get(<<"claim_ids">>, Filters, [], Opts)) ++
            normalize_id_list(hb_maps:get(<<"claim_id">>, Filters, [], Opts))
    ).

channel_ids_from_request(Req, Opts) ->
    case first_field(
        [
            <<"x-odysee-channel-ids">>,
            <<"x-odysee-channel-id">>,
            <<"channel-ids">>,
            <<"channel-id">>,
            <<"channel_ids">>,
            <<"channel_id">>
        ],
        Req,
        Opts
    ) of
        not_found -> [];
        Value -> normalize_id_list(Value)
    end.

channel_ids_from_filters(Filters, Opts) ->
    lists:usort(
        normalize_id_list(hb_maps:get(<<"channel_ids">>, Filters, [], Opts)) ++
            normalize_id_list(hb_maps:get(<<"channel_id">>, Filters, [], Opts))
    ).

normalize_id_list(Value) when is_list(Value) ->
    lists:append([normalize_id_list(Item) || Item <- Value]);
normalize_id_list(Value) when is_binary(Value), Value =/= <<>> ->
    [
        string:trim(Part)
     || Part <- binary:split(Value, <<",">>, [global]),
        string:trim(Part) =/= <<>>
    ];
normalize_id_list(_) ->
    [].

channel_id_from_claim(Claim, Opts) when is_map(Claim) ->
    case hb_maps:get(<<"channel_id">>, Claim, <<>>, Opts) of
        <<>> ->
            case hb_maps:get(<<"channel_claim_id">>, Claim, <<>>, Opts) of
                <<>> ->
                    Channel = hb_maps:get(<<"signing_channel">>, Claim, #{}, Opts),
                    hb_maps:get(<<"claim_id">>, Channel, <<>>, Opts);
                ChannelID ->
                    ChannelID
            end;
        ChannelID ->
            ChannelID
    end;
channel_id_from_claim(_, _Opts) ->
    undefined.

owner_key(Owner) ->
    hb_util:encode(hb_crypto:sha256(Owner)).

default_index() ->
    #{ <<"uploads">> => #{} }.

response(Path, Signers) ->
    ReadPath = <<"/", Path/binary>>,
    #{
        <<"status">> => 200,
        <<"id">> => Path,
        <<"path">> => Path,
        <<"read-path">> => ReadPath,
        <<"url">> => ReadPath,
        <<"signers">> => Signers,
        <<"content-type">> => <<"application/json">>,
        <<"body">> =>
            <<"{\"id\":\"", Path/binary, "\",\"read_path\":\"", ReadPath/binary, "\"}">>
    }.

json_response(Result) ->
    Body = hb_json:encode(#{ <<"result">> => Result }),
    #{
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"result">> => Result,
        <<"body">> => Body
    }.

first_field(Keys, Msg, Opts) when is_map(Msg) ->
    case first_exact_field(Keys, Msg, Opts) of
        not_found -> first_case_insensitive_field(Keys, hb_maps:to_list(Msg, Opts));
        Value -> Value
    end;
first_field(_Keys, _Msg, _Opts) ->
    not_found.

first_exact_field([], _Msg, _Opts) ->
    not_found;
first_exact_field([Key | Rest], Msg, Opts) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_exact_field(Rest, Msg, Opts);
        Value -> Value
    end.

first_case_insensitive_field(_Keys, []) ->
    not_found;
first_case_insensitive_field(Keys, [{Key, Value} | Rest]) ->
    LowerKeys = [lower_key(K) || K <- Keys],
    case lists:member(lower_key(Key), LowerKeys) of
        true -> Value;
        false -> first_case_insensitive_field(Keys, Rest)
    end.

lower_key(Key) when is_binary(Key) ->
    hb_util:to_lower(Key);
lower_key(Key) ->
    hb_util:to_lower(hb_ao:normalize_key(Key)).

upload_auth_ignored_keys() ->
    [
        <<"secret">>,
        <<"cookie">>,
        <<"set-cookie">>,
        <<"auth_token">>,
        <<"odysee-auth-token">>,
        <<"x-odysee-auth-token">>,
        <<"x-lbry-auth-token">>,
        <<"path">>,
        <<"method">>,
        <<"authorization">>,
        <<"host">>,
        <<"accept">>,
        <<"accept-bundle">>,
        <<"ao-peer">>,
        <<"user-agent">>,
        <<"connection">>,
        <<"content-type">>,
        <<"content-length">>,
        <<"transfer-encoding">>,
        <<"content-digest">>,
        <<"iterations">>,
        <<"key-length">>,
        <<"salt">>,
        <<"alg">>,
        <<"ignored-keys">>,
        <<"!">>
    ].

%%% Tests

write_requires_auth_signature_test() ->
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        write(#{}, #{ <<"method">> => <<"POST">>, <<"body">> => <<"test">> }, #{})
    ).

write_stores_only_committed_authenticated_request_test() ->
    application:ensure_all_started(hb),
    Store =
        #{
            <<"store-module">> => hb_store_fs,
            <<"name">> =>
                <<"/tmp/odysee-upload-TEST-", (integer_to_binary(os:system_time(millisecond)))/binary>>
        },
    hb_store:reset(Store),
    Node =
        hb_http_server:start_node(
            #{
                <<"store">> => Store,
                <<"priv-wallet">> => ar_wallet:new(),
                <<"on">> => #{
                    <<"request">> => #{
                        <<"device">> => <<"auth-hook@1.0">>,
                        <<"path">> => <<"request">>,
                        <<"when">> => #{ <<"keys">> => [<<"!">>] },
                        <<"ignored-keys">> => upload_auth_ignored_keys(),
                        <<"secret-provider">> =>
                            #{
                                <<"device">> => <<"odysee-auth@1.0">>,
                                <<"access-control">> =>
                                    #{ <<"device">> => <<"odysee-auth@1.0">> }
                            }
                    }
                }
            }
        ),
    {ok, Res} =
        hb_http:post(
            Node,
            #{
                <<"path">> => <<"/~odysee-upload@1.0/write">>,
                <<"method">> => <<"POST">>,
                <<"content-type">> => <<"text/plain">>,
                <<"body">> => <<"hello upload">>,
                <<"cookie">> => <<"auth_token=odysee-test-token">>,
                <<"!">> => true,
                <<"iterations">> => 1,
                <<"key-length">> => 32
            },
            #{}
        ),
    ?assertEqual(200, hb_ao:get(<<"status">>, Res, #{})),
    Path = hb_maps:get(<<"id">>, Res, <<>>, #{}),
    ?assert(is_binary(Path)),
    ?assertEqual(
        [true],
        [is_binary(S) || S <- hb_maps:get(<<"signers">>, Res, [], #{})]
    ),
    ?assertEqual(nomatch, binary:match(Path, <<"odysee-test-token">>)),
    {ok, ReadBack0} =
        hb_http:get(
            Node,
            <<"/~cache@1.0/read?read=", Path/binary>>,
            #{}
        ),
    ReadBack = hb_cache:ensure_all_loaded(ReadBack0, #{}),
    ?assertEqual(<<"hello upload">>, hb_maps:get(<<"body">>, ReadBack, #{})),
    ?assertNotEqual([], hb_message:signers(ReadBack, #{})),
    ?assertEqual(error, hb_maps:find(<<"auth_token">>, ReadBack, #{})),
    ?assertEqual(error, hb_maps:find(<<"x-odysee-auth-token">>, ReadBack, #{})).

upload_index_list_is_public_and_channel_scoped_test() ->
    Store =
        #{
            <<"store-module">> => hb_store_fs,
            <<"name">> =>
                <<"/tmp/odysee-upload-index-TEST-", (integer_to_binary(os:system_time(millisecond)))/binary>>
        },
    hb_store:reset(Store),
    Opts = #{ <<"store">> => Store },
    ChannelID = <<"channel-1">>,
    ClaimID = <<"claim-1">>,
    Claim =
        #{
            <<"claim_id">> => ClaimID,
            <<"value_type">> => <<"stream">>,
            <<"timestamp">> => 10,
            <<"channel_id">> => ChannelID
        },
    Signed =
        hb_message:commit(
            #{
                <<"method">> => <<"POST">>,
                <<"body">> => hb_json:encode(#{ <<"claim">> => Claim })
            },
            Opts
        ),
    {ok, IndexRes} = index(#{}, Signed, Opts),
    ?assertEqual(200, hb_maps:get(<<"status">>, IndexRes, undefined, Opts)),
    PublicListReq = #{ <<"method">> => <<"POST">>, <<"body">> => <<"{}">> },
    {ok, PublicListRes} = list(#{}, PublicListReq, Opts),
    PublicResult = hb_maps:get(<<"result">>, PublicListRes, #{}, Opts),
    ?assertEqual(1, hb_maps:get(<<"total_items">>, PublicResult, 0, Opts)),
    ChannelListReq =
        #{
            <<"method">> => <<"POST">>,
            <<"body">> => hb_json:encode(#{ <<"channel_ids">> => [ChannelID] })
        },
    {ok, ChannelListRes} = list(#{}, ChannelListReq, Opts),
    ChannelResult = hb_maps:get(<<"result">>, ChannelListRes, #{}, Opts),
    ?assertEqual(1, hb_maps:get(<<"total_items">>, ChannelResult, 0, Opts)),
    EmptyListReq =
        #{
            <<"method">> => <<"POST">>,
            <<"body">> => hb_json:encode(#{ <<"channel_ids">> => [<<"other-channel">>] })
        },
    {ok, EmptyListRes} = list(#{}, EmptyListReq, Opts),
    EmptyResult = hb_maps:get(<<"result">>, EmptyListRes, #{}, Opts),
    ?assertEqual(0, hb_maps:get(<<"total_items">>, EmptyResult, 0, Opts)).
