%%% @doc Odysee HyperBEAM-native upload/write demo device.
%%%
%%% The request must be signed by the node's auth hook, normally via an
%%% Odysee `auth_token' cookie or token header plus the `!' commit marker.
%%% Only committed fields are persisted, so auth cookies and token headers are
%%% not written to the public store.
-module(dev_odysee_upload).
-implements(<<"odysee-upload@1.0">>).
-export([chunk/3, finalize/3, index/3, info/1, list/3, write/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

info(_Opts) ->
    #{ exports => [<<"chunk">>, <<"finalize">>, <<"index">>, <<"list">>, <<"write">>] }.

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
            {ok, json_response(#{ <<"item">> => Claim, <<"signers">> => Signers })}
        else
            Error -> Error
        end
    end).

list(_Base, Req, Opts) ->
    safe(fun() ->
        maybe
            ok ?= require_post(Req, Opts),
            {ok, Signers} ?= require_signed(Req, Opts),
            {ok, Owner} ?= owner_identity(Req, Signers, Opts),
            {ok, State} ?= read_index(Owner, Opts),
            Uploads = maps:values(hb_maps:get(<<"uploads">>, State, #{}, Opts)),
            {ok,
                json_response(#{
                    <<"items">> => Uploads,
                    <<"total_items">> => length(Uploads),
                    <<"signers">> => Signers
                })}
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
    Path = hb_ao:get(<<"id">>, Res, #{}),
    ?assert(is_binary(Path)),
    ?assertEqual(
        [true],
        [is_binary(S) || S <- hb_maps:get(<<"signers">>, Res, [], #{})]
    ),
    ?assertEqual(nomatch, binary:match(Path, <<"odysee-test-token">>)).
