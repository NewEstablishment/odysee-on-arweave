-module(dev_odysee_search).
-implements(<<"odysee-search@1.0">>).
-export([info/1, search/3, recsys_fyp/3, recsys_entry/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-search@1.0">>).

info(_Opts) ->
    #{
        exports => [
            <<"search">>,
            <<"recsys_fyp">>,
            <<"recsys-entry">>,
            <<"recsys_entry">>
        ]
    }.

search(Base, Req, Opts) ->
    safe(fun() ->
        Params = request_params(Base, Req, Opts),
        QueryParams = maps:merge(direct_query_params(Params), query_params(Params, Opts)),
        ClaimParams = claim_search_params(QueryParams, Params, Opts),
        ClaimReq = maps:merge(Params, ClaimParams),
        case hb_ao:raw(<<"odysee-claim@1.0">>, <<"search">>, Base, ClaimReq, Opts) of
            {ok, ClaimMsg} ->
                result_message(lighthouse_result(Params, ClaimMsg, Opts));
            {error, Reason} ->
                result_message(empty_search_result(Params, ClaimParams, Reason, Opts))
        end
    end).

recsys_fyp(Base, Req, Opts) ->
    safe(fun() ->
        Params = request_params(Base, Req, Opts),
        Action = first_value([<<"action">>], Params, Opts),
        result_message(recsys_fyp_result(Action, Params, Opts))
    end).

recsys_entry(Base, Req, Opts) ->
    safe(fun() ->
        Params = request_params(Base, Req, Opts),
        result_message(#{
            <<"ok">> => true,
            <<"action">> => <<"recsys_entry">>,
            <<"accepted">> => maps:is_key(<<"entry">>, Params)
        })
    end).

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> {error, Reason};
        _:Reason -> {error, Reason}
    end.

request_params(Base, Req, Opts) ->
    Messages0 = [
        map_or_empty(Base),
        body_message(Base, Opts),
        map_or_empty(Req),
        body_message(Req, Opts)
    ],
    Messages = Messages0 ++ [params64_message(Msg, Opts) || Msg <- Messages0],
    lists:foldl(fun(Msg, Acc) -> maps:merge(Acc, Msg) end, #{}, Messages).

map_or_empty(Map) when is_map(Map) -> Map;
map_or_empty(_Value) -> #{}.

body_message(Msg, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"body">>, Msg, not_found, Opts) of
        Body when is_binary(Body) ->
            case try_decode_json(Body) of
                {ok, Decoded} when is_map(Decoded) -> Decoded;
                _ -> #{}
            end;
        Body when is_map(Body) ->
            Body;
        _ ->
            #{}
    end;
body_message(_Msg, _Opts) ->
    #{}.

params64_message(Msg, Opts) when is_map(Msg) ->
    case first_value([<<"params64">>, <<"params-64">>], Msg, Opts) of
        not_found -> #{};
        Encoded -> decoded_params64(Encoded)
    end;
params64_message(_Msg, _Opts) ->
    #{}.

decoded_params64(Encoded) ->
    try hb_json:decode(hb_util:decode(hb_util:bin(Encoded))) of
        Params when is_map(Params) -> Params;
        _ -> #{}
    catch
        _:_ -> #{}
    end.

try_decode_json(Raw) ->
    try {ok, hb_json:decode(Raw)}
    catch _:_ -> {error, invalid_json}
    end.

direct_query_params(Params) ->
    maps:without(
        [
            <<"action">>,
            <<"auth-token">>,
            <<"auth_token">>,
            <<"authorization">>,
            <<"body">>,
            <<"claim-search-result">>,
            <<"claim_search_result">>,
            <<"content-type">>,
            <<"entry">>,
            <<"kind">>,
            <<"method">>,
            <<"params64">>,
            <<"params-64">>,
            <<"path">>,
            <<"query">>,
            <<"result">>,
            <<"search-result">>,
            <<"search_result">>,
            <<"user_suffix">>,
            <<"user-suffix">>
        ],
        Params
    ).

query_params(Params, Opts) ->
    Query = first_value([<<"query">>, <<"search-query">>, <<"search_query">>], Params, Opts),
    UserSuffix = first_value([<<"user_suffix">>, <<"user-suffix">>], Params, Opts),
    maps:merge(parse_query(Query), parse_query(UserSuffix)).

parse_query(not_found) ->
    #{};
parse_query(Query0) ->
    Query = strip_query_prefix(hb_util:bin(Query0)),
    try
        lists:foldl(fun query_pair/2, #{}, uri_string:dissect_query(binary_to_list(Query)))
    catch
        _:_ -> #{}
    end.

strip_query_prefix(<<"?", Rest/binary>>) ->
    Rest;
strip_query_prefix(Query) ->
    Query.

query_pair({Key, Value}, Acc) ->
    maps:put(hb_util:bin(Key), hb_util:bin(Value), Acc);
query_pair(Key, Acc) ->
    maps:put(hb_util:bin(Key), <<"">>, Acc).

claim_search_params(QueryParams, Params, Opts) ->
    PageSize = positive_int_or_default(
        first_value([<<"page_size">>, <<"page-size">>, <<"size">>], QueryParams, Opts),
        20
    ),
    Page = page_number(QueryParams, PageSize, Opts),
    Params0 = #{
        <<"page">> => Page,
        <<"page_size">> => PageSize
    },
    Params1 = put_optional(<<"text">>, search_text(QueryParams, Opts), Params0),
    Params2 = put_optional(<<"claim_type">>, claim_types(QueryParams, Opts), Params1),
    Params3 = put_optional(<<"media_types">>, value_list(first_value([<<"mediaType">>, <<"media_type">>, <<"media_types">>], QueryParams, Opts)), Params2),
    Params4 = put_optional(<<"channel_ids">>, value_list(first_value([<<"channel_ids">>, <<"channel-ids">>], QueryParams, Opts)), Params3),
    Params5 = put_optional(<<"order_by">>, order_by(QueryParams, Opts), Params4),
    Params6 = put_optional(<<"languages">>, value_list(first_value([<<"language">>, <<"languages">>], QueryParams, Opts)), Params5),
    maps:merge(maps:without(lighthouse_keys(), direct_claim_params(Params)), Params6).

lighthouse_keys() ->
    [
        <<"claimType">>,
        <<"content_aspect_ratio">>,
        <<"content_aspect_ratio_or_missing">>,
        <<"deboost_same_creator">>,
        <<"exclude_shorts">>,
        <<"exclude_shorts_aspect_ratio_lte">>,
        <<"exclude_shorts_duration_lte">>,
        <<"free_only">>,
        <<"from">>,
        <<"gid">>,
        <<"language">>,
        <<"max_aspect_ratio">>,
        <<"mediaType">>,
        <<"nsfw">>,
        <<"q">>,
        <<"query">>,
        <<"related_to">>,
        <<"s">>,
        <<"size">>,
        <<"sort_by">>,
        <<"time_filter">>,
        <<"uuid">>
    ].

direct_claim_params(Params) ->
    maps:without(
        [
            <<"auth-token">>,
            <<"auth_token">>,
            <<"authorization">>,
            <<"body">>,
            <<"content-type">>,
            <<"entry">>,
            <<"kind">>,
            <<"method">>,
            <<"params64">>,
            <<"params-64">>,
            <<"path">>,
            <<"query">>,
            <<"result">>,
            <<"user_suffix">>,
            <<"user-suffix">>
        ],
        Params
    ).

page_number(QueryParams, PageSize, Opts) ->
    case first_value([<<"page">>], QueryParams, Opts) of
        not_found ->
            From = int_or_default(first_value([<<"from">>], QueryParams, Opts), 0),
            (From div PageSize) + 1;
        Page ->
            positive_int_or_default(Page, 1)
    end.

search_text(QueryParams, Opts) ->
    case first_value([<<"text">>, <<"s">>, <<"q">>], QueryParams, Opts) of
        not_found -> not_found;
        Text -> unquote(trim(hb_util:bin(Text)))
    end.

claim_types(QueryParams, Opts) ->
    case value_list(first_value([<<"claimType">>, <<"claim_type">>, <<"claim-type">>], QueryParams, Opts)) of
        [] -> not_found;
        Values -> lists:usort(lists:filtermap(fun claim_type/1, Values))
    end.

claim_type(<<"file">>) -> {true, <<"stream">>};
claim_type(<<"stream">>) -> {true, <<"stream">>};
claim_type(<<"channel">>) -> {true, <<"channel">>};
claim_type(_Value) -> false.

order_by(QueryParams, Opts) ->
    case first_value([<<"sort_by">>, <<"order_by">>, <<"order-by">>], QueryParams, Opts) of
        not_found -> not_found;
        Value -> [hb_util:bin(Value)]
    end.

lighthouse_result(Params, ClaimMsg, Opts) ->
    Items = claim_items(ClaimMsg, Opts),
    Result0 = #{
        <<"body">> => lists:filtermap(fun(Item) -> lighthouse_item(Item, Opts) end, Items),
        <<"poweredBy">> => <<"hyperbeam">>
    },
    Result1 = put_optional(<<"uuid">>, first_value([<<"uuid">>], Params, Opts), Result0),
    put_optional(<<"kind">>, first_value([<<"kind">>], Params, Opts), Result1).

empty_search_result(Params, ClaimParams, Reason, Opts) ->
    Result0 = #{
        <<"body">> => [],
        <<"poweredBy">> => <<"hyperbeam">>,
        <<"hyperbeamError">> => hb_util:bin(io_lib:format("~p", [Reason]))
    },
    Result1 = put_optional(<<"uuid">>, first_value([<<"uuid">>], Params, Opts), Result0),
    Result2 = put_optional(<<"kind">>, first_value([<<"kind">>], Params, Opts), Result1),
    put_optional(<<"page">>, first_value([<<"page">>], ClaimParams, Opts), Result2).

claim_items(ClaimMsg, Opts) ->
    case hb_maps:get(<<"items">>, ClaimMsg, not_found, Opts) of
        Items when is_list(Items) ->
            Items;
        _ ->
            case hb_maps:get(<<"result">>, ClaimMsg, #{}, Opts) of
                Result when is_map(Result) ->
                    case first_value([<<"items">>, <<"claims">>], Result, Opts) of
                        Items when is_list(Items) -> Items;
                        _ -> []
                    end;
                _ ->
                    []
            end
    end.

lighthouse_item(Item, Opts) when is_map(Item) ->
    Name = first_value([<<"name">>, <<"claim-name">>, <<"claim_name">>], Item, Opts),
    ClaimID = first_value([<<"claimId">>, <<"claim_id">>, <<"claim-id">>], Item, Opts),
    case {Name, ClaimID} of
        {not_found, _} -> false;
        {_, not_found} -> false;
        _ -> {true, #{ <<"name">> => hb_util:bin(Name), <<"claimId">> => hb_util:bin(ClaimID) }}
    end;
lighthouse_item(_Item, _Opts) ->
    false.

recsys_fyp_result(<<"fetch">>, Params, Opts) ->
    #{
        <<"gid">> => demo_gid(Params, Opts),
        <<"recs">> => []
    };
recsys_fyp_result(not_found, Params, Opts) ->
    recsys_fyp_result(<<"fetch">>, Params, Opts);
recsys_fyp_result(Action, _Params, _Opts) ->
    #{
        <<"ok">> => true,
        <<"action">> => hb_util:bin(Action)
    }.

demo_gid(Params, Opts) ->
    case first_value([<<"gid">>], Params, Opts) of
        not_found -> <<"hyperbeam-demo">>;
        GID -> hb_util:bin(GID)
    end.

result_message(Result) ->
    {ok, #{
        <<"device">> => ?DEVICE,
        <<"content-type">> => <<"application/json">>,
        <<"body">> => hb_json:encode(Result),
        <<"result">> => Result
    }}.

put_optional(_Key, not_found, Map) ->
    Map;
put_optional(_Key, [], Map) ->
    Map;
put_optional(_Key, <<>>, Map) ->
    Map;
put_optional(Key, Value, Map) ->
    Map#{ Key => Value }.

first_value([], _Map, _Opts) ->
    not_found;
first_value([Key | Rest], Map, Opts) when is_map(Map) ->
    case hb_maps:get(Key, Map, not_found, Opts) of
        not_found -> first_value(Rest, Map, Opts);
        Value -> Value
    end;
first_value(_Keys, _Map, _Opts) ->
    not_found.

value_list(not_found) ->
    [];
value_list(Values) when is_list(Values) ->
    [hb_util:bin(Value) || Value <- Values, hb_util:bin(Value) =/= <<>>];
value_list(Value) when is_binary(Value) ->
    [trim(Part) || Part <- binary:split(Value, <<",">>, [global]), trim(Part) =/= <<>>];
value_list(Value) ->
    value_list(hb_util:bin(Value)).

positive_int_or_default(Value, Default) ->
    case int_or_default(Value, Default) of
        Int when Int > 0 -> Int;
        _ -> Default
    end.

int_or_default(not_found, Default) ->
    Default;
int_or_default(Value, Default) when is_integer(Value) ->
    Value;
int_or_default(Value, Default) ->
    try binary_to_integer(hb_util:bin(Value)) of
        Int -> Int
    catch
        _:_ -> Default
    end.

trim(Value) ->
    trim_right(trim_left(hb_util:bin(Value))).

trim_left(<<C, Rest/binary>>) when C =< 32 ->
    trim_left(Rest);
trim_left(Value) ->
    Value.

trim_right(Value) when byte_size(Value) > 0 ->
    Size = byte_size(Value),
    case binary:last(Value) of
        C when C =< 32 -> trim_right(binary:part(Value, 0, Size - 1));
        _ -> Value
    end;
trim_right(Value) ->
    Value.

unquote(<<"\"", Rest/binary>>) ->
    Size = byte_size(Rest),
    case Size > 0 andalso binary:last(Rest) =:= $" of
        true -> binary:part(Rest, 0, Size - 1);
        false -> <<"\"", Rest/binary>>
    end;
unquote(Value) ->
    Value.

-ifdef(TEST).

claim_search_params_from_lighthouse_query_test() ->
    Params = claim_search_params(
        parse_query(<<"s=respawn%20roast&size=10&from=20&claimType=file,channel&mediaType=video&sort_by=release_time">>),
        #{},
        #{}
    ),
    ?assertEqual(<<"respawn roast">>, hb_maps:get(<<"text">>, Params, #{})),
    ?assertEqual(3, hb_maps:get(<<"page">>, Params, #{})),
    ?assertEqual(10, hb_maps:get(<<"page_size">>, Params, #{})),
    ?assertEqual([<<"channel">>, <<"stream">>], hb_maps:get(<<"claim_type">>, Params, #{})),
    ?assertEqual([<<"video">>], hb_maps:get(<<"media_types">>, Params, #{})),
    ?assertEqual([<<"release_time">>], hb_maps:get(<<"order_by">>, Params, #{})).

search_accepts_supplied_claim_result_test() ->
    Claim = #{
        <<"claim_id">> => <<"claim-1">>,
        <<"name">> => <<"demo-video">>,
        <<"value_type">> => <<"stream">>,
        <<"value">> => #{ <<"title">> => <<"Demo Video">> }
    },
    {ok, Msg} = search(
        #{},
        #{
            <<"params64">> => test_params64(#{
                <<"kind">> => <<"primary">>,
                <<"query">> => <<"s=demo&size=1&from=0&claimType=file">>
            }),
            <<"claim_search_result">> => #{
                <<"items">> => [Claim],
                <<"page">> => 1,
                <<"page_size">> => 1,
                <<"total_items">> => 1,
                <<"total_pages">> => 1
            }
        },
        #{}
    ),
    Result = hb_maps:get(<<"result">>, Msg, #{}),
    ?assertEqual([#{ <<"name">> => <<"demo-video">>, <<"claimId">> => <<"claim-1">> }], hb_maps:get(<<"body">>, Result, #{})),
    ?assertEqual(<<"primary">>, hb_maps:get(<<"kind">>, Result, #{})).

recsys_fyp_fetch_returns_demo_gid_test() ->
    {ok, Msg} = recsys_fyp(#{}, #{ <<"action">> => <<"fetch">>, <<"gid">> => <<"g1">> }, #{}),
    Result = hb_maps:get(<<"result">>, Msg, #{}),
    ?assertEqual(<<"g1">>, hb_maps:get(<<"gid">>, Result, #{})),
    ?assertEqual([], hb_maps:get(<<"recs">>, Result, #{})).

recsys_entry_acknowledges_test() ->
    {ok, Msg} = recsys_entry(#{}, #{ <<"entry">> => #{ <<"claimId">> => <<"claim-1">> } }, #{}),
    Result = hb_maps:get(<<"result">>, Msg, #{}),
    ?assertEqual(true, hb_maps:get(<<"ok">>, Result, #{})),
    ?assertEqual(true, hb_maps:get(<<"accepted">>, Result, #{})).

test_params64(Params) ->
    hb_util:encode(hb_json:encode(Params)).

-endif.
