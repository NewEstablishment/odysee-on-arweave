%%% @doc Odysee HyperBEAM-native upload/write demo device.
%%%
%%% The request must be signed by the node's auth hook, normally via an
%%% Odysee `auth_token' cookie or token header plus the `!' commit marker.
%%% Only committed fields are persisted, so auth cookies and token headers are
%%% not written to the public store.
-module(dev_odysee_upload).
-implements(<<"odysee-upload@1.0">>).
-export([chunk/3, finalize/3, info/1, write/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

info(_Opts) ->
    #{ exports => [<<"chunk">>, <<"finalize">>, <<"write">>] }.

chunk(Base, Req, Opts) ->
    write(Base, Req, Opts).

finalize(Base, Req, Opts) ->
    write(Base, Req, Opts).

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
