%%% @doc Odysee internal API file stats compatibility device.
%%%
%%% This device exposes read-only `/file/view_count' responses as AO-Core
%%% messages. View recording and other user/session mutations remain outside
%%% this adapter.
-module(dev_odysee_file).
-implements(<<"odysee-file@1.0">>).
-export([info/1, 'view-count'/3, view_count/3, normalize/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-file@1.0">>).
-define(DEFAULT_API_URL, <<"https://api.odysee.com">>).

%% @doc Return the public device API.
info(_Opts) ->
    #{ exports => [<<"view-count">>, <<"normalize">>] }.

%% @doc Return normalized `/file/view_count' data.
'view-count'(Base, Req, Opts) ->
    view_count(Base, Req, Opts).

view_count(Base, Req, Opts) ->
    safe(fun() ->
        maybe
            {ok, Counts, Raw} ?= count_result(Base, Req, Opts),
            {ok, ClaimIDs} ?= claim_ids(Base, Req, Counts, Opts),
            normalize_counts(Counts, Raw, ClaimIDs)
        else
            Error -> Error
        end
    end).

%% @doc Normalize supplied view count data without fetching.
normalize(Base, Req, Opts) ->
    safe(fun() ->
        case result_candidate(Base, Req, Opts) of
            {ok, Counts, Raw} ->
                maybe
                    {ok, ClaimIDs} ?= claim_ids(Base, Req, Counts, Opts),
                    normalize_counts(Counts, Raw, ClaimIDs)
                end;
            not_found ->
                {error, view_count_result_not_found}
        end
    end).

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> {error, Reason};
        _:Reason -> {error, Reason}
    end.

count_result(Base, Req, Opts) ->
    case result_candidate(Base, Req, Opts) of
        {ok, _Counts, _Raw} = Candidate ->
            Candidate;
        not_found ->
            maybe
                {ok, Params} ?= count_params(Base, Req, Opts),
                api_request(Params, Base, Req, Opts)
            end
    end.

result_candidate(Base, Req, Opts) ->
    Candidates = [
        {Req, <<"view-count-result">>},
        {Req, <<"view_count_result">>},
        {Req, <<"counts">>},
        {Req, <<"view-counts">>},
        {Req, <<"data">>},
        {Req, <<"result">>},
        {Req, <<"body">>},
        {Base, <<"view-count-result">>},
        {Base, <<"view_count_result">>},
        {Base, <<"counts">>},
        {Base, <<"view-counts">>},
        {Base, <<"data">>},
        {Base, <<"result">>},
        {Base, <<"body">>}
    ],
    case result_from_value(Base, Opts) of
        {ok, _Counts, _Raw} = Result -> Result;
        not_found -> result_from_fields(Candidates, Opts)
    end.

result_from_fields([], _Opts) ->
    not_found;
result_from_fields([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> result_from_fields(Rest, Opts);
        Value ->
            case result_from_value(Value, Opts) of
                {ok, _Counts, _Raw} = Result -> Result;
                not_found -> result_from_fields(Rest, Opts)
            end
    end;
result_from_fields([_ | Rest], Opts) ->
    result_from_fields(Rest, Opts).

result_from_value(Value, Opts) when is_list(Value) ->
    result_from_counts(Value, hb_json:encode(Value));
result_from_value(Value, _Opts) when is_number(Value) ->
    result_from_counts([Value], hb_json:encode(Value));
result_from_value(Value, Opts) when is_map(Value) ->
    case result_from_map(Value, hb_json:encode(Value), Opts) of
        {ok, _Counts, _Raw} = Result -> Result;
        _ -> not_found
    end;
result_from_value(Value, Opts) when is_binary(Value) ->
    case try_decode_json(Value) of
        {ok, Decoded} -> result_from_decoded(Decoded, Value, Opts);
        _ -> not_found
    end;
result_from_value(_Value, _Opts) ->
    not_found.

result_from_decoded(Decoded, Raw, Opts) when is_list(Decoded) ->
    result_from_counts(Decoded, Raw);
result_from_decoded(Decoded, Raw, _Opts) when is_number(Decoded) ->
    result_from_counts([Decoded], Raw);
result_from_decoded(Decoded, Raw, Opts) when is_map(Decoded) ->
    case result_from_map(Decoded, Raw, Opts) of
        {ok, _Counts, _Raw} = Result -> Result;
        _ -> not_found
    end;
result_from_decoded(_Decoded, _Raw, _Opts) ->
    not_found.

result_from_map(Msg, Raw, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"error">>, Msg, not_found, Opts) of
        not_found -> result_from_success_map(Msg, Raw, Opts);
        null -> result_from_success_map(Msg, Raw, Opts);
        undefined -> result_from_success_map(Msg, Raw, Opts);
        Error -> {error, {view_count_api_error, Error}}
    end;
result_from_map(_Msg, _Raw, _Opts) ->
    {error, invalid_view_count_result}.

result_from_success_map(Msg, Raw, Opts) ->
    case hb_maps:get(<<"success">>, Msg, true, Opts) of
        false ->
            {error, {view_count_api_error, hb_maps:get(<<"data">>, Msg, Msg, Opts)}};
        _ ->
            Result0 = hb_maps:get(<<"data">>, Msg, Msg, Opts),
            Result =
                case Result0 of
                    ResultMsg when is_map(ResultMsg) -> hb_maps:get(<<"result">>, ResultMsg, ResultMsg, Opts);
                    _ -> Result0
            end,
            case Result of
                Counts when is_list(Counts) -> result_from_counts(Counts, Raw);
                Count when is_number(Count) -> result_from_counts([Count], Raw);
                CountMap when is_map(CountMap) -> result_from_count_map(CountMap, Raw);
                _ -> {error, invalid_view_count_result}
            end
    end.

result_from_count_map(CountMap, Raw) ->
    case numeric_map_values(CountMap) of
        [] -> {error, invalid_view_count_result};
        _Values -> {ok, CountMap, Raw}
    end.

result_from_counts(Counts, Raw) ->
    case lists:all(fun erlang:is_number/1, Counts) of
        true -> {ok, Counts, Raw};
        false -> {error, invalid_view_count_result}
    end.

normalize_counts(CountMap, Raw, ClaimIDs) when is_map(CountMap) ->
    case counts_from_map(CountMap, ClaimIDs, [<<"view_count">>, <<"view-count">>, <<"views">>, <<"count">>, <<"total">>]) of
        {ok, Counts} -> normalize_counts(Counts, Raw, ClaimIDs);
        error -> {error, invalid_view_count_result}
    end;
normalize_counts(Counts, Raw, ClaimIDs) ->
    case length(Counts) =:= length(ClaimIDs) of
        true ->
            {ok, #{
                <<"device">> => ?DEVICE,
                <<"content-type">> => <<"application/json">>,
                <<"body">> => Raw,
                <<"result">> => Counts,
                <<"counts">> => Counts,
                <<"view-counts">> => Counts,
                <<"claim-ids">> => ClaimIDs,
                <<"by-claim-id">> => maps:from_list(lists:zip(ClaimIDs, Counts))
            }};
        false ->
            {error, view_count_claim_id_mismatch}
    end.

counts_from_map(CountMap, ClaimIDs, SingleKeys) ->
    Ordered = [map_number(CountMap, ClaimID) || ClaimID <- ClaimIDs],
    case lists:all(fun is_number/1, Ordered) of
        true ->
            {ok, Ordered};
        false ->
            case ClaimIDs of
                [_OneClaim] -> single_count_from_map(CountMap, SingleKeys);
                _ -> error
            end
    end.

map_number(CountMap, Key) ->
    BinKey = hb_util:bin(Key),
    case maps:get(BinKey, CountMap, not_found) of
        Value when is_number(Value) -> Value;
        _ ->
            StringKey = binary_to_list(BinKey),
            case maps:get(StringKey, CountMap, not_found) of
                Value when is_number(Value) -> Value;
                _ -> not_found
            end
    end.

single_count_from_map(CountMap, Keys) ->
    KeyValues = [maps:get(Key, CountMap, not_found) || Key <- Keys],
    case [Value || Value <- KeyValues, is_number(Value)] of
        [Value | _] -> {ok, [Value]};
        [] ->
            case numeric_map_values(CountMap) of
                [Only] -> {ok, [Only]};
                _ -> error
            end
    end.

numeric_map_values(CountMap) ->
    [Value || {_Key, Value} <- maps:to_list(CountMap), is_number(Value)].

count_params(Base, Req, Opts) ->
    Params = api_params(request_params(Base, Req, Opts), Opts),
    case hb_maps:get(<<"claim_id">>, Params, not_found, Opts) of
        not_found -> {error, claim_id_not_found};
        _ClaimID -> {ok, Params}
    end.

api_params(Params0, Opts) ->
    Params1 = put_alias(<<"claim_id">>, <<"claim-id">>, Params0, Opts),
    Params2 = put_alias(<<"claim_id">>, <<"claim_ids">>, Params1, Opts),
    Params3 = put_alias(<<"claim_id">>, <<"claim-ids">>, Params2, Opts),
    maps:without(control_keys() ++ request_metadata_keys() ++ private_credential_keys(), Params3).

control_keys() ->
    [
        <<"auth-token">>,
        <<"body">>,
        <<"claim-id">>,
        <<"claim-ids">>,
        <<"claim_ids">>,
        <<"content-type">>,
        <<"counts">>,
        <<"data">>,
        <<"device">>,
        <<"method">>,
        <<"odysee-api-url">>,
        <<"odysee_api_url">>,
        <<"path">>,
        <<"result">>,
        <<"view-count-result">>,
        <<"view-count-url">>,
        <<"view-counts">>,
        <<"view_count_result">>,
        <<"view_count_url">>
    ].

request_metadata_keys() ->
    [
        <<"accept">>,
        <<"accept-bundle">>,
        <<"accept-encoding">>,
        <<"accept-language">>,
        <<"authorization">>,
        <<"commitments">>,
        <<"connection">>,
        <<"content-length">>,
        <<"cookie">>,
        <<"host">>,
        <<"origin">>,
        <<"priv">>,
        <<"referer">>,
        <<"sec-ch-ua">>,
        <<"sec-ch-ua-mobile">>,
        <<"sec-ch-ua-platform">>,
        <<"sec-fetch-dest">>,
        <<"sec-fetch-mode">>,
        <<"sec-fetch-site">>,
        <<"sec-gpc">>,
        <<"user-agent">>
    ].

private_credential_keys() ->
    [
        <<"auth_token">>,
        <<"auth-token">>,
        <<"odysee-auth-token">>,
        <<"x-odysee-auth-token">>,
        <<"x-lbry-auth-token">>,
        <<"authorization">>,
        <<"access_token">>,
        <<"access-token">>,
        <<"refresh_token">>,
        <<"refresh-token">>
    ].

put_alias(Target, Source, Params, Opts) ->
    case hb_maps:get(Target, Params, not_found, Opts) of
        not_found ->
            case hb_maps:get(Source, Params, not_found, Opts) of
                not_found -> Params;
                Value -> Params#{ Target => Value }
            end;
        _Value ->
            Params
    end.

api_request(Params, Base, Req, Opts) ->
    URL = view_count_url(Base, Req, Opts),
    AuthedMsg =
        case is_proxy_url(URL) of
            true -> proxy_api_msg(URL, <<"file_view_count">>, Params, Base, Req, Opts);
            false -> legacy_api_msg(URL, Params, Base, Req, Opts)
        end,
    case hb_http:request(AuthedMsg, Opts) of
        {ok, #{ <<"body">> := RespBody }} when is_binary(RespBody) -> decode_api_body(RespBody, Opts);
        {ok, RespBody} when is_binary(RespBody) -> decode_api_body(RespBody, Opts);
        {ok, Other} -> {error, {view_count_response_without_body, Other}};
        Error -> Error
    end.

decode_api_body(Body, Opts) ->
    maybe
        {ok, Decoded} ?= try_decode_json(Body),
        case Decoded of
            #{ <<"jsonrpc">> := _, <<"result">> := Counts } when is_list(Counts) ->
                result_from_counts(Counts, Body);
            #{ <<"jsonrpc">> := _, <<"error">> := Error } ->
                {error, {view_count_api_error, Error}};
            Counts when is_list(Counts) -> result_from_counts(Counts, Body);
            Count when is_number(Count) -> result_from_counts([Count], Body);
            Msg when is_map(Msg) -> result_from_map(Msg, Body, Opts);
            _ -> {error, invalid_view_count_result}
        end
    end.

view_count_url(Base, Req, Opts) ->
    case first_found(
        [
            {Req, <<"view-count-url">>},
            {Req, <<"view_count_url">>},
            {Base, <<"view-count-url">>},
            {Base, <<"view_count_url">>}
        ],
        Opts
    ) of
        not_found ->
            ApiURL = trim_trailing_slash(api_url(Base, Req, Opts)),
            case is_proxy_url(ApiURL) of
                true -> ApiURL;
                false -> <<ApiURL/binary, "/file/view_count">>
            end;
        URL -> URL
    end.

api_url(Base, Req, Opts) ->
    case first_found(
        [
            {Req, <<"odysee-api-url">>},
            {Req, <<"odysee_api_url">>},
            {Base, <<"odysee-api-url">>},
            {Base, <<"odysee_api_url">>}
        ],
        Opts
    ) of
        not_found -> hb_opts:get(<<"odysee-api-url">>, ?DEFAULT_API_URL, Opts);
        URL -> URL
    end.

claim_ids(Base, Req, Counts, Opts) ->
    Params = request_params(Base, Req, Opts),
    case first_param([<<"claim_id">>, <<"claim-id">>, <<"claim_ids">>, <<"claim-ids">>], #{}, Params, Opts) of
        not_found ->
            case Counts of
                [_ | _] -> {error, claim_id_not_found};
                [] -> {ok, []}
            end;
        ClaimIDCSV when is_binary(ClaimIDCSV) ->
            {ok, split_csv(ClaimIDCSV)};
        ClaimIDs when is_list(ClaimIDs) ->
            {ok, [hb_util:bin(ClaimID) || ClaimID <- ClaimIDs]};
        ClaimID ->
            {ok, [hb_util:bin(ClaimID)]}
    end.

split_csv(CSV) ->
    [Part || Part <- binary:split(CSV, <<",">>, [global]), Part =/= <<>>].

trim_trailing_slash(<<>>) ->
    <<>>;
trim_trailing_slash(Bin) ->
    Size = byte_size(Bin),
    case Bin of
        <<Prefix:(Size - 1)/binary, "/">> -> trim_trailing_slash(Prefix);
        _ -> Bin
    end.

form_body(Params) ->
    Pairs =
        [
            {binary_to_list(hb_util:bin(Key)), binary_to_list(form_value(Value))}
        ||
            {Key, Value} <- maps:to_list(Params),
            Value =/= undefined,
            Value =/= null,
            Value =/= not_found
        ],
    iolist_to_binary(uri_string:compose_query(Pairs)).

form_value(Value) when is_binary(Value) -> Value;
form_value(Value) when is_integer(Value) -> integer_to_binary(Value);
form_value(Value) when is_float(Value) -> float_to_binary(Value);
form_value(true) -> <<"true">>;
form_value(false) -> <<"false">>;
form_value(Value) when is_map(Value); is_list(Value) -> hb_json:encode(Value);
form_value(Value) -> hb_util:bin(Value).

map_or_empty(Map) when is_map(Map) -> Map;
map_or_empty(_Value) -> #{}.

legacy_api_msg(URL, Params, Base, Req, Opts) ->
    Body = form_body(legacy_api_params(Params, Base, Req, Opts)),
    Msg = #{
        <<"method">> => <<"POST">>,
        <<"path">> => URL,
        <<"content-type">> => <<"application/x-www-form-urlencoded">>,
        <<"body">> => Body
    },
    maps:merge(Msg, legacy_api_headers(Base, Req, Opts)).

proxy_api_msg(URL, Method, Params, Base, Req, Opts) ->
    ProxyParams = legacy_api_params(Params, Base, Req, Opts),
    Msg = #{
        <<"method">> => <<"POST">>,
        <<"path">> => URL,
        <<"content-type">> => <<"application/json">>,
        <<"body">> => hb_json:encode(#{
            <<"jsonrpc">> => <<"2.0">>,
            <<"method">> => Method,
            <<"params">> => ProxyParams,
            <<"id">> => 0
        })
    },
    maps:merge(Msg, proxy_api_headers(Base, Req, Opts)).

proxy_api_headers(Base, Req, Opts) ->
    case find_auth_token(Req, Opts) of
        {ok, Token} ->
            #{ <<"x-lbry-auth-token">> => Token };
        {error, not_found} ->
            case find_auth_token(Base, Opts) of
                {ok, Token} -> #{ <<"x-lbry-auth-token">> => Token };
                {error, not_found} -> #{}
            end
    end.

legacy_api_headers(Base, Req, Opts) ->
    case find_auth_token(Req, Opts) of
        {ok, Token} ->
            #{ <<"cookie">> => <<"auth_token=", Token/binary>> };
        {error, not_found} ->
            case find_auth_token(Base, Opts) of
                {ok, Token} -> #{ <<"cookie">> => <<"auth_token=", Token/binary>> };
                {error, not_found} -> #{}
            end
    end.

legacy_api_params(Params, Base, Req, Opts) ->
    case find_auth_token(Req, Opts) of
        {ok, Token} ->
            Params#{ <<"auth_token">> => Token };
        {error, not_found} ->
            case find_auth_token(Base, Opts) of
                {ok, Token} -> Params#{ <<"auth_token">> => Token };
                {error, not_found} -> Params
            end
    end.

find_auth_token(Msg, Opts) ->
    AuthKeys = [<<"x-odysee-auth-token">>, <<"x-lbry-auth-token">>, <<"odysee-auth-token">>, <<"auth_token">>],
    case first_param(AuthKeys, #{}, Msg, Opts) of
        not_found ->
            case first_param(AuthKeys, #{}, body_params(Msg, Opts), Opts) of
                not_found -> find_auth_cookie(Msg, Opts);
                Token -> {ok, token_value(Token)}
            end;
        Token ->
            {ok, token_value(Token)}
    end.

find_auth_cookie(Msg, Opts) when is_map(Msg) ->
    case hb_maps:find(<<"cookie">>, Msg, Opts) of
        {ok, Cookie} -> token_from_cookie(hb_util:bin(Cookie));
        error -> {error, not_found}
    end;
find_auth_cookie(_Msg, _Opts) ->
    {error, not_found}.

token_from_cookie(Cookie) ->
    token_from_cookie_parts(binary:split(Cookie, <<";">>, [global])).

token_from_cookie_parts([]) ->
    {error, not_found};
token_from_cookie_parts([Part | Rest]) ->
    case binary:split(Part, <<"=">>) of
        [Name, Value] ->
            case trim_bin(Name) of
                <<"auth_token">> -> {ok, trim_bin(Value)};
                _ -> token_from_cookie_parts(Rest)
            end;
        _ ->
            token_from_cookie_parts(Rest)
    end.

token_value(#{ <<"value">> := Value }) ->
    hb_util:bin(Value);
token_value(Value) ->
    hb_util:bin(Value).

trim_bin(Bin) ->
    list_to_binary(string:trim(binary_to_list(Bin))).

is_proxy_url(URL) when is_binary(URL) ->
    binary:match(URL, <<"/api/v1/proxy">>) =/= nomatch;
is_proxy_url(URL) ->
    is_proxy_url(hb_util:bin(URL)).

request_params(Base, Req, Opts) ->
    BaseParams = maps:merge(map_or_empty(Base), body_params(Base, Opts)),
    ReqParams = maps:merge(body_params(Req, Opts), map_or_empty(Req)),
    maps:merge(BaseParams, ReqParams).

body_params(Msg, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"body">>, Msg, not_found, Opts) of
        Body when is_map(Body) ->
            Body;
        Body when is_binary(Body) ->
            case try_decode_json(Body) of
                {ok, Decoded} when is_map(Decoded) -> Decoded;
                _ -> #{}
            end;
        _ ->
            #{}
    end;
body_params(_Msg, _Opts) ->
    #{}.

first_param(Keys, Base, Req, Opts) ->
    first_found([{Req, Key} || Key <- Keys] ++ [{Base, Key} || Key <- Keys], Opts).

first_found([], _Opts) ->
    not_found;
first_found([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_found(Rest, Opts);
        Value -> Value
    end;
first_found([_ | Rest], Opts) ->
    first_found(Rest, Opts).

try_decode_json(Raw) ->
    try {ok, hb_json:decode(Raw)}
    catch _:_ -> {error, invalid_json}
    end.

-ifdef(TEST).

view_count_internal_api_json_test() ->
    Raw = hb_json:encode(#{
        <<"success">> => true,
        <<"error">> => null,
        <<"data">> => [1504, 11]
    }),
    {ok, Msg} = view_count(
        #{},
        #{ <<"claim_id">> => <<"claim-1,claim-2">>, <<"body">> => Raw },
        #{}
    ),
    ?assertEqual([1504, 11], hb_maps:get(<<"result">>, Msg, #{})),
    ?assertEqual([<<"claim-1">>, <<"claim-2">>], hb_maps:get(<<"claim-ids">>, Msg, #{})),
    ?assertEqual(1504, hb_maps:get(<<"claim-1">>, hb_maps:get(<<"by-claim-id">>, Msg, #{}), #{})).

view_count_accepts_supplied_counts_test() ->
    {ok, Msg} = view_count(
        #{},
        #{ <<"claim-ids">> => <<"claim-1,claim-2">>, <<"view-counts">> => [7, 8] },
        #{}
    ),
    ?assertEqual([7, 8], hb_maps:get(<<"view-counts">>, Msg, #{})).

view_count_reads_claim_ids_from_json_body_test() ->
    {ok, Msg} = view_count(
        #{},
        #{
            <<"body">> => <<"{\"claim_ids\":[\"claim-1\",\"claim-2\"]}">>,
            <<"counts">> => [7, 8]
        },
        #{}
    ),
    ?assertEqual([7, 8], hb_maps:get(<<"view-counts">>, Msg, #{})),
    ?assertEqual([<<"claim-1">>, <<"claim-2">>], hb_maps:get(<<"claim-ids">>, Msg, #{})).

view_count_accepts_claim_count_map_test() ->
    Raw = hb_json:encode(#{
        <<"success">> => true,
        <<"error">> => null,
        <<"data">> => #{
            <<"claim-1">> => 7,
            <<"claim-2">> => 8
        }
    }),
    {ok, Msg} = view_count(
        #{},
        #{
            <<"body">> => hb_json:encode(#{ <<"claim_ids">> => [<<"claim-1">>, <<"claim-2">>] }),
            <<"result">> => Raw
        },
        #{}
    ),
    ?assertEqual([7, 8], hb_maps:get(<<"view-counts">>, Msg, #{})).

view_count_rejects_mismatched_claim_ids_test() ->
    ?assertEqual(
        {error, view_count_claim_id_mismatch},
        view_count(#{}, #{ <<"claim_id">> => <<"claim-1">>, <<"counts">> => [7, 8] }, #{})
    ).

count_params_normalizes_aliases_and_strips_control_fields_test() ->
    {ok, Params} = count_params(
        #{ <<"odysee-api-url">> => <<"http://api">>, <<"claim-ids">> => <<"claim-1">> },
        #{ <<"body">> => <<"{}">> },
        #{}
    ),
    ?assertEqual(#{ <<"claim_id">> => <<"claim-1">> }, Params).

count_params_strips_private_credentials_test() ->
    {ok, Params} = count_params(
        #{ <<"claim-id">> => <<"claim-1">> },
        #{
            <<"auth_token">> => <<"tok">>,
            <<"x-odysee-auth-token">> => <<"tok">>,
            <<"accept-encoding">> => <<"gzip">>,
            <<"commitments">> => #{ <<"sig">> => <<"value">> },
            <<"sec-gpc">> => <<"1">>
        },
        #{}
    ),
    ?assertEqual(#{ <<"claim_id">> => <<"claim-1">> }, Params).

legacy_api_headers_forwards_odysee_auth_token_test() ->
    ?assertEqual(
        #{ <<"cookie">> => <<"auth_token=token-1">> },
        legacy_api_headers(#{}, #{ <<"x-odysee-auth-token">> => <<"token-1">> }, #{})
    ).

legacy_api_headers_extracts_auth_cookie_test() ->
    ?assertEqual(
        #{ <<"cookie">> => <<"auth_token=token-2">> },
        legacy_api_headers(#{}, #{ <<"cookie">> => <<"other=1; auth_token=token-2; x=3">> }, #{})
    ).

count_params_reads_json_body_test() ->
    {ok, Params} = count_params(
        #{},
        #{ <<"body">> => <<"{\"claim_id\":\"claim-1\",\"x-odysee-auth-token\":\"tok\"}">> },
        #{}
    ),
    ?assertEqual(#{ <<"claim_id">> => <<"claim-1">> }, Params).

legacy_api_params_forwards_odysee_auth_token_test() ->
    ?assertEqual(
        #{ <<"claim_id">> => <<"claim-1">>, <<"auth_token">> => <<"token-1">> },
        legacy_api_params(
            #{ <<"claim_id">> => <<"claim-1">> },
            #{},
            #{ <<"x-odysee-auth-token">> => <<"token-1">> },
            #{}
        )
    ).

proxy_api_headers_reads_json_body_auth_token_test() ->
    ?assertEqual(
        #{ <<"x-lbry-auth-token">> => <<"token-1">> },
        proxy_api_headers(
            #{},
            #{ <<"body">> => <<"{\"claim_id\":\"claim-1\",\"auth_token\":\"token-1\"}">> },
            #{}
        )
    ).

form_body_encodes_params_test() ->
    ?assertEqual(
        <<"claim_id=claim-1">>,
        form_body(#{ <<"claim_id">> => <<"claim-1">> })
    ).

view_count_requires_claim_id_for_fetch_test() ->
    ?assertEqual({error, claim_id_not_found}, view_count(#{}, #{}, #{})).

view_count_url_uses_configurable_base_test() ->
    ?assertEqual(
        <<"http://api/file/view_count">>,
        view_count_url(#{ <<"odysee-api-url">> => <<"http://api/">> }, #{}, #{})
    ).

-endif.
