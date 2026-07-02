-module(dev_odysee_product_events).
-implements(<<"odysee-product-events@1.0">>).
-export([info/1, thumbnail_upload/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

info(_Opts) ->
    #{ exports => [<<"thumbnail_upload">>] }.

thumbnail_upload(_Base, Req, Opts) ->
    safe(fun() ->
        maybe
            ok ?= require_post(Req, Opts),
            {ok, Params} ?= request_params(Req, Opts),
            {ok, Bytes} ?= thumbnail_bytes(Params, Opts),
            ContentType = content_type(Params, Opts),
            {ok, Path} ?= hb_cache:write(
                #{
                    <<"body">> => Bytes,
                    <<"content-type">> => ContentType
                },
                Opts
            ),
            {ok, json_response(success_response(Path, Req, Opts))}
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
                    <<"content-type">> => <<"application/json">>,
                    <<"body">> => hb_json:encode(error_response(<<"Use POST for thumbnail uploads.">>))
                }}
    end.

request_params(Req, Opts) ->
    case first_field([<<"params64">>, <<"params-64">>], Req, Opts) of
        not_found -> request_params_body(Req, Opts);
        Encoded -> decode_params64(Encoded)
    end.

request_params_body(Req, Opts) ->
    case hb_maps:find(<<"body">>, Req, Opts) of
        {ok, Body} when is_map(Body) ->
            case first_field([<<"params64">>, <<"params-64">>], Body, Opts) of
                not_found -> {ok, Body};
                Encoded -> decode_params64(Encoded)
            end;
        {ok, Body} when is_binary(Body) ->
            try
                Decoded = hb_json:decode(Body),
                case first_field([<<"params64">>, <<"params-64">>], Decoded, Opts) of
                    not_found -> {ok, Decoded};
                    Encoded -> decode_params64(Encoded)
                end
            catch
                _:_ -> invalid_request()
            end;
        _ ->
            invalid_request()
    end.

decode_params64(Encoded0) ->
    try
        Encoded = hb_util:bin(Encoded0),
        {ok, hb_json:decode(hb_util:decode(Encoded))}
    catch
        _:_ -> invalid_request()
    end.

invalid_request() ->
    {error,
        #{
            <<"status">> => 400,
            <<"content-type">> => <<"application/json">>,
            <<"body">> => hb_json:encode(error_response(<<"Thumbnail upload request must include JSON params.">>))
        }}.

thumbnail_bytes(Params, Opts) ->
    case first_field([<<"content_base64">>, <<"content-base64">>, <<"data">>], Params, Opts) of
        not_found ->
            {error,
                #{
                    <<"status">> => 400,
                    <<"content-type">> => <<"application/json">>,
                    <<"body">> => hb_json:encode(error_response(<<"Thumbnail upload requires content_base64.">>))
                }};
        Encoded0 ->
            try {ok, base64:decode(strip_data_url(hb_util:bin(Encoded0)))}
            catch
                _:_ ->
                    {error,
                        #{
                            <<"status">> => 400,
                            <<"content-type">> => <<"application/json">>,
                            <<"body">> => hb_json:encode(error_response(<<"Thumbnail content_base64 is invalid.">>))
                        }}
            end
    end.

strip_data_url(Encoded) ->
    case binary:split(Encoded, <<",">>) of
        [_Prefix, Body] -> Body;
        _ -> Encoded
    end.

content_type(Params, Opts) ->
    case first_field([<<"content_type">>, <<"content-type">>], Params, Opts) of
        not_found -> <<"image/jpeg">>;
        Value -> hb_util:bin(Value)
    end.

success_response(Path, Req, Opts) ->
    Url = thumbnail_url(Path, Req, Opts),
    #{
        <<"type">> => <<"success">>,
        <<"message">> => Url,
        <<"url">> => Url,
        <<"id">> => Path
    }.

error_response(Message) ->
    #{
        <<"type">> => <<"error">>,
        <<"message">> => Message
    }.

thumbnail_url(Path, Req, Opts) ->
    Host = host_with_port(hb_util:bin(hb_maps:get(<<"host">>, Req, <<"127.0.0.1">>, Opts))),
    PathBin = hb_util:bin(Path),
    <<"http://", Host/binary, "/~cache@1.0/read?read=", PathBin/binary>>.

host_with_port(Host) ->
    case binary:match(Host, <<":">>) of
        nomatch -> <<Host/binary, ":8734">>;
        _ -> Host
    end.

json_response(Result) ->
    #{
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"body">> => hb_json:encode(Result)
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

thumbnail_upload_params64_test() ->
    application:ensure_all_started(hb),
    Store =
        #{
            <<"store-module">> => hb_store_fs,
            <<"name">> =>
                <<"/tmp/odysee-product-events-TEST-", (integer_to_binary(os:system_time(millisecond)))/binary>>
        },
    hb_store:reset(Store),
    Params =
        #{
            <<"content_type">> => <<"image/png">>,
            <<"content_base64">> => base64:encode(<<"png">>)
        },
    Req =
        #{
            <<"method">> => <<"POST">>,
            <<"host">> => <<"127.0.0.1:8734">>,
            <<"body">> =>
                hb_json:encode(#{
                    <<"params64">> => hb_util:encode(hb_json:encode(Params))
                })
        },
    {ok, Res} = thumbnail_upload(#{}, Req, #{ <<"store">> => Store }),
    ?assertEqual(200, hb_maps:get(<<"status">>, Res, 0, #{})),
    Body = hb_json:decode(hb_maps:get(<<"body">>, Res, <<>>, #{})),
    ?assertEqual(<<"success">>, hb_maps:get(<<"type">>, Body, <<>>, #{})),
    Path = hb_maps:get(<<"id">>, Body, <<>>, #{}),
    {ok, ReadBack0} = hb_store:read(Store, Path, #{}),
    ReadBack = hb_cache:ensure_all_loaded(ReadBack0, #{}),
    ?assertEqual(<<"png">>, hb_maps:get(<<"body">>, ReadBack, <<>>, #{})).
