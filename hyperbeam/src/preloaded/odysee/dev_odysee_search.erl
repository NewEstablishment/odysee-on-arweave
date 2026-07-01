-module(dev_odysee_search).
-implements(<<"odysee-search@1.0">>).
-export([info/1, search/3, index/3, index_legacy/3, query/3, health/3, recsys_fyp/3, recsys_entry/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-search@1.0">>).

info(_Opts) ->
    #{
        exports => [
            <<"search">>,
            <<"index">>,
            <<"index-legacy">>,
            <<"index_legacy">>,
            <<"query">>,
            <<"health">>,
            <<"recsys_fyp">>,
            <<"recsys-entry">>,
            <<"recsys_entry">>
        ]
    }.

search(Base, Req, Opts) ->
    safe(fun() ->
        Params = request_params(Base, Req, Opts),
        case meili_search_enabled(Params, Opts) of
            true ->
                case meili_search_result(Params, Opts) of
                    {ok, Result} ->
                        result_message(Result);
                    {error, Reason} ->
                        claim_search_result(Base, Params, Reason, Opts);
                    {failure, Reason} ->
                        claim_search_result(Base, Params, Reason, Opts)
                end;
            false ->
                claim_search_result(Base, Params, not_found, Opts)
        end
    end).

index(Base, Req, Opts) ->
    safe(fun() ->
        Params = request_params(Base, Req, Opts),
        case legacy_index_requested(Params, Opts) of
            true ->
                result_message(legacy_index_result(Base, Params, Opts));
            false ->
                Documents = meili_documents(Params, Opts),
                case Documents of
                    [] ->
                        result_message(#{
                            <<"ok">> => false,
                            <<"poweredBy">> => <<"hyperbeam-meilisearch">>,
                            <<"error">> => <<"missing_documents">>
                        });
                    _ ->
                        result_message(meili_index_documents(Documents, Params, Opts))
                end
        end
    end).

index_legacy(Base, Req, Opts) ->
    safe(fun() ->
        Params = request_params(Base, Req, Opts),
        result_message(legacy_index_result(Base, Params, Opts))
    end).

query(Base, Req, Opts) ->
    safe(fun() ->
        Params = request_params(Base, Req, Opts),
        case meili_search_result(Params, Opts) of
            {ok, Result} -> result_message(Result);
            {error, Reason} -> result_message(meili_error_result(Reason));
            {failure, Reason} -> result_message(meili_error_result(Reason))
        end
    end).

health(Base, Req, Opts) ->
    safe(fun() ->
        Params = request_params(Base, Req, Opts),
        result_message(meili_health_result(Params, Opts))
    end).

claim_search_result(Base, Params, MeiliReason, Opts) ->
    QueryParams = maps:merge(direct_query_params(Params), query_params(Params, Opts)),
    ClaimParams = claim_search_params(QueryParams, Params, Opts),
    ClaimReq = maps:merge(Params, ClaimParams),
    case hb_ao:raw(<<"odysee-claim@1.0">>, <<"search">>, Base, ClaimReq, Opts) of
        {ok, ClaimMsg} ->
            Result0 = lighthouse_result(Params, ClaimMsg, Opts),
            Result =
                case MeiliReason of
                    not_found -> Result0;
                    _ -> Result0#{ <<"meiliFallbackReason">> => error_text(MeiliReason) }
                end,
            result_message(Result);
        {error, Reason} ->
            result_message(empty_search_result(Params, ClaimParams, Reason, Opts))
    end.

legacy_index_result(Base, Params, Opts) ->
    QueryParams = maps:merge(direct_query_params(Params), query_params(Params, Opts)),
    ClaimParams = claim_search_params(QueryParams, Params, Opts),
    Pages = legacy_pages(QueryParams, Opts),
    Results = [
        legacy_index_page(Base, Params, ClaimParams, Page, Opts)
    ||
        Page <- Pages
    ],
    Documents = dedupe_documents(lists:append([Docs || {Docs, _Summary} <- Results])),
    PageSummaries = [Summary || {_Docs, Summary} <- Results],
    ClaimItems = lists:sum([
        hb_maps:get(<<"items">>, Summary, 0, Opts)
    ||
        Summary <- PageSummaries
    ]),
    IndexResult =
        case Documents of
            [] ->
                #{
                    <<"ok">> => false,
                    <<"poweredBy">> => <<"hyperbeam-meilisearch">>,
                    <<"error">> => <<"missing_documents">>
                };
            _ ->
                meili_index_documents(Documents, Params, Opts)
        end,
    IndexResult#{
        <<"source">> => <<"legacy-odysee">>,
        <<"pages">> => PageSummaries,
        <<"claimItems">> => ClaimItems,
        <<"documents">> => length(Documents)
    }.

legacy_index_page(Base, Params, ClaimParams, Page, Opts) ->
    case legacy_supplied_items(Params, Opts) of
        [] ->
            ClaimReq = maps:merge(Params, ClaimParams#{ <<"page">> => Page }),
            case hb_ao:raw(<<"odysee-claim@1.0">>, <<"search">>, Base, ClaimReq, Opts) of
                {ok, ClaimMsg} ->
                    legacy_index_items(Page, claim_items(ClaimMsg, Opts), Opts);
                {error, Reason} ->
                    {[], #{
                        <<"ok">> => false,
                        <<"page">> => Page,
                        <<"items">> => 0,
                        <<"documents">> => 0,
                        <<"error">> => error_text(Reason)
                    }}
            end;
        Items ->
            legacy_index_items(Page, Items, Opts)
    end.

legacy_index_items(Page, Items, Opts) ->
    Docs = meili_documents_from_value(Items, Opts),
    {Docs, #{
        <<"ok">> => true,
        <<"page">> => Page,
        <<"items">> => length(Items),
        <<"documents">> => length(Docs)
    }}.

legacy_supplied_items(Params, Opts) ->
    search_result_items(
        first_value(
            [
                <<"claim-search-result">>,
                <<"claim_search_result">>,
                <<"search-result">>,
                <<"search_result">>,
                <<"result">>
            ],
            Params,
            Opts
        ),
        Opts
    ).

legacy_pages(QueryParams, Opts) ->
    StartPage = positive_int_or_default(first_value([<<"page">>], QueryParams, Opts), 1),
    Requested = positive_int_or_default(first_value([<<"pages">>, <<"legacy-pages">>, <<"legacy_pages">>], QueryParams, Opts), 1),
    MaxPages = positive_int_or_default(first_value([<<"max-pages">>, <<"max_pages">>], QueryParams, Opts), 5),
    Count = erlang:min(Requested, MaxPages),
    [StartPage + Offset || Offset <- lists:seq(0, Count - 1)].

legacy_index_requested(Params, Opts) ->
    truthy(first_value([<<"legacy">>, <<"legacy-index">>, <<"legacy_index">>, <<"source">>], Params, Opts)).

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
            <<"claims">>,
            <<"content-type">>,
            <<"docs">>,
            <<"documents">>,
            <<"entry">>,
            <<"kind">>,
            <<"legacy">>,
            <<"legacy-index">>,
            <<"legacy_index">>,
            <<"legacy-pages">>,
            <<"legacy_pages">>,
            <<"max-pages">>,
            <<"max_pages">>,
            <<"meili">>,
            <<"meili-api-key">>,
            <<"meili_api_key">>,
            <<"meili-index">>,
            <<"meili_index">>,
            <<"meili-master-key">>,
            <<"meili_master_key">>,
            <<"meili-primary-key">>,
            <<"meili_primary_key">>,
            <<"meili-url">>,
            <<"meili_url">>,
            <<"method">>,
            <<"pages">>,
            <<"params64">>,
            <<"params-64">>,
            <<"path">>,
            <<"primaryKey">>,
            <<"primary-key">>,
            <<"primary_key">>,
            <<"query">>,
            <<"result">>,
            <<"search-result">>,
            <<"search_result">>,
            <<"search-engine">>,
            <<"search_engine">>,
            <<"source">>,
            <<"use-meili">>,
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
            <<"claims">>,
            <<"content-type">>,
            <<"docs">>,
            <<"documents">>,
            <<"entry">>,
            <<"kind">>,
            <<"legacy">>,
            <<"legacy-index">>,
            <<"legacy_index">>,
            <<"legacy-pages">>,
            <<"legacy_pages">>,
            <<"max-pages">>,
            <<"max_pages">>,
            <<"meili">>,
            <<"meili-api-key">>,
            <<"meili_api_key">>,
            <<"meili-index">>,
            <<"meili_index">>,
            <<"meili-master-key">>,
            <<"meili_master_key">>,
            <<"meili-primary-key">>,
            <<"meili_primary_key">>,
            <<"meili-url">>,
            <<"meili_url">>,
            <<"method">>,
            <<"pages">>,
            <<"params64">>,
            <<"params-64">>,
            <<"path">>,
            <<"primaryKey">>,
            <<"primary-key">>,
            <<"primary_key">>,
            <<"query">>,
            <<"result">>,
            <<"search-engine">>,
            <<"search_engine">>,
            <<"source">>,
            <<"use-meili">>,
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

meili_search_enabled(Params, Opts) ->
    case first_value([<<"meili">>, <<"use-meili">>, <<"search-engine">>, <<"search_engine">>], Params, Opts) of
        Value when Value =:= true;
                Value =:= <<"true">>;
                Value =:= <<"1">>;
                Value =:= <<"meili">>;
                Value =:= <<"meilisearch">> ->
            true;
        _ ->
            hb_maps:get(<<"meili-url">>, Opts, not_found, Opts) =/= not_found
    end.

meili_search_result(Params, Opts) ->
    Body = meili_search_body(Params, Opts),
    case meili_request(<<"POST">>, meili_index_path(Params, Opts, <<"search">>), Body, Params, Opts) of
        {ok, Resp} ->
            {ok, meili_lighthouse_result(Params, Resp, Opts)};
        Error ->
            Error
    end.

meili_index_documents(Documents, Params, Opts) ->
    case meili_request(<<"POST">>, meili_documents_path(Params, Opts), Documents, Params, Opts) of
        {ok, Resp} ->
            #{
                <<"ok">> => true,
                <<"poweredBy">> => <<"hyperbeam-meilisearch">>,
                <<"index">> => meili_index_uid(Params, Opts),
                <<"documents">> => length(Documents),
                <<"task">> => Resp
            };
        {error, Reason} ->
            meili_error_result(Reason);
        {failure, Reason} ->
            meili_error_result(Reason)
    end.

meili_health_result(Params, Opts) ->
    case meili_request(<<"GET">>, <<"/health">>, undefined, Params, Opts) of
        {ok, Resp} ->
            #{
                <<"ok">> => true,
                <<"poweredBy">> => <<"hyperbeam-meilisearch">>,
                <<"health">> => Resp
            };
        {error, Reason} ->
            meili_error_result(Reason);
        {failure, Reason} ->
            meili_error_result(Reason)
    end.

meili_search_body(Params, Opts) ->
    QueryParams = maps:merge(direct_query_params(Params), query_params(Params, Opts)),
    SearchText =
        case search_text(QueryParams, Opts) of
            not_found -> <<"">>;
            Text -> Text
        end,
    Limit = positive_int_or_default(
        first_value([<<"limit">>, <<"page_size">>, <<"page-size">>, <<"size">>], QueryParams, Opts),
        20
    ),
    Offset = non_negative_int_or_default(first_value([<<"offset">>, <<"from">>], QueryParams, Opts), 0),
    Body0 = #{
        <<"q">> => SearchText,
        <<"limit">> => Limit,
        <<"offset">> => Offset
    },
    Body1 = put_optional(<<"filter">>, first_value([<<"filter">>], QueryParams, Opts), Body0),
    Body2 = put_optional(<<"sort">>, value_list(first_value([<<"sort">>, <<"sort_by">>, <<"order_by">>], QueryParams, Opts)), Body1),
    put_optional(
        <<"attributesToRetrieve">>,
        value_list(first_value([<<"attributesToRetrieve">>, <<"attributes-to-retrieve">>, <<"fields">>], QueryParams, Opts)),
        Body2
    ).

meili_lighthouse_result(Params, Resp, Opts) ->
    Hits = meili_hits(Resp, Opts),
    Result0 = #{
        <<"body">> => lists:filtermap(fun(Hit) -> lighthouse_item(Hit, Opts) end, Hits),
        <<"hits">> => Hits,
        <<"poweredBy">> => <<"hyperbeam-meilisearch">>,
        <<"meili">> => maps:without([<<"hits">>], Resp)
    },
    Result1 = put_optional(<<"uuid">>, first_value([<<"uuid">>], Params, Opts), Result0),
    put_optional(<<"kind">>, first_value([<<"kind">>], Params, Opts), Result1).

meili_hits(Resp, Opts) when is_map(Resp) ->
    case hb_maps:get(<<"hits">>, Resp, [], Opts) of
        Hits when is_list(Hits) -> Hits;
        _ -> []
    end;
meili_hits(_Resp, _Opts) ->
    [].

meili_documents(Params, Opts) ->
    Values = [
        first_value([<<"documents">>, <<"docs">>], Params, Opts),
        first_value([<<"claims">>, <<"items">>], Params, Opts),
        first_value([<<"claim">>, <<"item">>], Params, Opts),
        search_result_items(first_value([<<"claim-search-result">>, <<"claim_search_result">>, <<"search-result">>, <<"search_result">>, <<"result">>], Params, Opts), Opts)
    ],
    Docs = lists:flatmap(fun(Value) -> meili_documents_from_value(Value, Opts) end, Values),
    dedupe_documents(Docs).

meili_documents_from_value(not_found, _Opts) ->
    [];
meili_documents_from_value(Values, Opts) when is_list(Values) ->
    lists:filtermap(
        fun(Value) ->
            case meili_document(Value, Opts) of
                not_found -> false;
                Doc -> {true, Doc}
            end
        end,
        Values
    );
meili_documents_from_value(Value, Opts) when is_map(Value) ->
    case meili_document(Value, Opts) of
        not_found -> [];
        Doc -> [Doc]
    end;
meili_documents_from_value(_Value, _Opts) ->
    [].

meili_document(Claim, Opts) when is_map(Claim) ->
    Value = map_value(first_value([<<"value">>], Claim, Opts)),
    Source = map_value(first_value([<<"source">>], Value, Opts)),
    Channel = map_value(first_value([<<"signing_channel">>, <<"signing-channel">>], Claim, Opts)),
    ClaimID = first_value([<<"claim_id">>, <<"claim-id">>, <<"claimId">>, <<"id">>], Claim, Opts),
    Name = first_value([<<"name">>, <<"claim-name">>, <<"claim_name">>], Claim, Opts),
    ID = document_id(ClaimID, Claim, Opts),
    case ID of
        not_found ->
            not_found;
        _ ->
            optional_doc_fields(#{
                <<"id">> => ID,
                <<"claim_id">> => optional_bin(ClaimID),
                <<"claimId">> => optional_bin(ClaimID),
                <<"name">> => optional_bin(Name),
                <<"title">> =>
                    optional_bin(first_present([
                        first_value([<<"title">>], Value, Opts),
                        first_value([<<"title">>], Claim, Opts)
                    ])),
                <<"description">> =>
                    optional_bin(first_present([
                        first_value([<<"description">>], Value, Opts),
                        first_value([<<"description">>], Claim, Opts)
                    ])),
                <<"value_type">> => optional_bin(first_value([<<"value_type">>, <<"value-type">>], Claim, Opts)),
                <<"media_type">> =>
                    optional_bin(first_present([
                        first_value([<<"media_type">>, <<"media-type">>, <<"content-type">>], Source, Opts),
                        first_value([<<"media_type">>, <<"media-type">>, <<"content-type">>], Claim, Opts)
                    ])),
                <<"tags">> =>
                    first_present([
                        first_value([<<"tags">>], Value, Opts),
                        first_value([<<"tags">>], Claim, Opts)
                    ]),
                <<"channel_id">> =>
                    optional_bin(first_value([<<"claim_id">>, <<"claim-id">>, <<"claimId">>], Channel, Opts)),
                <<"channel_name">> => optional_bin(first_value([<<"name">>], Channel, Opts)),
                <<"txid">> => optional_bin(first_value([<<"txid">>], Claim, Opts)),
                <<"nout">> => first_value([<<"nout">>], Claim, Opts),
                <<"sd_hash">> => optional_bin(first_value([<<"sd_hash">>, <<"sd-hash">>], Source, Opts)),
                <<"canonical_url">> =>
                    optional_bin(first_value([<<"canonical_url">>, <<"canonical-url">>, <<"permanent_url">>], Claim, Opts)),
                <<"hyperbeam_upload_id">> =>
                    optional_bin(first_value([<<"hyperbeam_upload_id">>, <<"hyperbeam-upload-id">>], Claim, Opts)),
                <<"body_path">> =>
                    optional_bin(first_value([<<"hyperbeam_body_path">>, <<"hyperbeam-body-path">>], Source, Opts))
            })
    end;
meili_document(_Claim, _Opts) ->
    not_found.

search_result_items(not_found, _Opts) ->
    [];
search_result_items(Result, Opts) when is_map(Result) ->
    case first_value([<<"items">>, <<"claims">>], Result, Opts) of
        Items when is_list(Items) -> Items;
        _ -> []
    end;
search_result_items(_Result, _Opts) ->
    [].

document_id(not_found, Claim, Opts) ->
    case {first_value([<<"txid">>], Claim, Opts), first_value([<<"nout">>], Claim, Opts)} of
        {TxID, NOut} when is_binary(TxID), is_integer(NOut) ->
            <<TxID/binary, ":", (integer_to_binary(NOut))/binary>>;
        {TxID, NOut} when is_binary(TxID), is_binary(NOut) ->
            <<TxID/binary, ":", NOut/binary>>;
        _ ->
            not_found
    end;
document_id(ID, _Claim, _Opts) ->
    optional_bin(ID).

optional_doc_fields(Map) ->
    maps:filter(
        fun(_Key, Value) ->
            Value =/= not_found andalso Value =/= undefined andalso Value =/= <<>> andalso Value =/= []
        end,
        Map
    ).

optional_bin(not_found) ->
    not_found;
optional_bin(Value) when is_binary(Value) ->
    Value;
optional_bin(Value) when is_integer(Value) ->
    integer_to_binary(Value);
optional_bin(Value) ->
    hb_util:bin(Value).

map_value(Value) when is_map(Value) ->
    Value;
map_value(_Value) ->
    #{}.

dedupe_documents(Docs) ->
    {_, Deduped} =
        lists:foldl(
            fun(Doc, {Seen, Acc}) ->
                ID = maps:get(<<"id">>, Doc, not_found),
                case maps:is_key(ID, Seen) of
                    true -> {Seen, Acc};
                    false -> {Seen#{ ID => true }, [Doc | Acc]}
                end
            end,
            {#{}, []},
            Docs
        ),
    lists:reverse(Deduped).

meili_request(Method, Path, undefined, Params, Opts) ->
    meili_http(Method, Path, undefined, Params, Opts);
meili_request(Method, Path, Body, Params, Opts) ->
    meili_http(Method, Path, hb_json:encode(Body), Params, Opts).

meili_http(Method, Path, Body, Params, Opts) ->
    URL = meili_url(Params, Opts),
    Req0 = #{
        peer => URL,
        path => Path,
        method => Method,
        headers => meili_headers(Params, Opts),
        body => <<>>
    },
    Req =
        case Body of
            undefined -> Req0;
            _ -> Req0#{ body => Body }
        end,
    HTTPOpts = Opts#{ <<"http-client">> => hb_maps:get(<<"http-client">>, Opts, httpc, Opts) },
    case hb_http_client:request(Req, HTTPOpts) of
        {ok, Status, _Headers, RespBody} when Status >= 200, Status < 300 ->
            decode_meili_response(RespBody);
        {ok, Status, _Headers, RespBody} when Status < 500 ->
            {error, {meili_http_status, Status, decode_meili_body(RespBody)}};
        {ok, Status, _Headers, RespBody} ->
            {failure, {meili_http_status, Status, decode_meili_body(RespBody)}};
        {error, Reason} ->
            {failure, Reason}
    end.

decode_meili_response(RespBody) ->
    {ok, decode_meili_body(RespBody)}.

decode_meili_body(Body) when is_binary(Body), byte_size(Body) > 0 ->
    case try_decode_json(Body) of
        {ok, Decoded} -> Decoded;
        _ -> Body
    end;
decode_meili_body(_Body) ->
    #{}.

meili_url(Params, Opts) ->
    case first_value([<<"meili-url">>, <<"meili_url">>], Params, Opts) of
        URL when is_binary(URL), byte_size(URL) > 0 ->
            trim_trailing_slash(URL);
        _ ->
            trim_trailing_slash(hb_maps:get(<<"meili-url">>, Opts, <<"http://127.0.0.1:7700">>, Opts))
    end.

meili_index_path(Params, Opts, Suffix) ->
    <<"/indexes/", (meili_index_uid(Params, Opts))/binary, "/", Suffix/binary>>.

meili_documents_path(Params, Opts) ->
    <<(meili_index_path(Params, Opts, <<"documents">>))/binary, "?primaryKey=", (meili_primary_key(Params, Opts))/binary>>.

meili_index_uid(Params, Opts) ->
    case first_value([<<"index">>, <<"index_uid">>, <<"index-uid">>], Params, Opts) of
        Value when is_binary(Value), byte_size(Value) > 0 -> Value;
        _ -> hb_maps:get(<<"meili-index">>, Opts, <<"odysee_claims">>, Opts)
    end.

meili_primary_key(Params, Opts) ->
    case first_value([<<"primaryKey">>, <<"primary-key">>, <<"primary_key">>], Params, Opts) of
        Value when is_binary(Value), byte_size(Value) > 0 -> Value;
        _ -> hb_maps:get(<<"meili-primary-key">>, Opts, <<"id">>, Opts)
    end.

meili_headers(Params, Opts) ->
    Headers0 = #{ <<"content-type">> => <<"application/json">> },
    case meili_api_key(Params, Opts) of
        not_found -> Headers0;
        Key -> Headers0#{ <<"authorization">> => <<"Bearer ", Key/binary>> }
    end.

meili_api_key(Params, Opts) ->
    case first_value([<<"meili-api-key">>, <<"meili_api_key">>, <<"meili-master-key">>, <<"meili_master_key">>], Params, Opts) of
        Key when is_binary(Key), byte_size(Key) > 0 -> Key;
        _ -> hb_maps:get(<<"meili-api-key">>, Opts, not_found, Opts)
    end.

trim_trailing_slash(URL) when is_binary(URL), byte_size(URL) > 0 ->
    case binary:last(URL) of
        $/ -> trim_trailing_slash(binary:part(URL, 0, byte_size(URL) - 1));
        _ -> URL
    end;
trim_trailing_slash(<<>>) ->
    <<>>.

meili_error_result(Reason) ->
    #{
        <<"ok">> => false,
        <<"poweredBy">> => <<"hyperbeam-meilisearch">>,
        <<"error">> => error_text(Reason)
    }.

error_text(Reason) ->
    hb_util:bin(io_lib:format("~p", [Reason])).

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

first_present([]) ->
    not_found;
first_present([Value | Rest]) ->
    case Value of
        not_found -> first_present(Rest);
        undefined -> first_present(Rest);
        <<>> -> first_present(Rest);
        [] -> first_present(Rest);
        _ -> Value
    end.

truthy(Value) when Value =:= true;
                   Value =:= <<"true">>;
                   Value =:= <<"1">>;
                   Value =:= <<"yes">>;
                   Value =:= <<"legacy">>;
                   Value =:= <<"legacy-odysee">> ->
    true;
truthy(_Value) ->
    false.

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

non_negative_int_or_default(Value, Default) ->
    case int_or_default(Value, Default) of
        Int when Int >= 0 -> Int;
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

meili_documents_from_claim_search_result_test() ->
    Claim = #{
        <<"claim_id">> => <<"claim-1">>,
        <<"name">> => <<"demo-video">>,
        <<"txid">> => <<"tx123">>,
        <<"nout">> => 0,
        <<"canonical_url">> => <<"lbry://demo-video#claim-1">>,
        <<"value_type">> => <<"stream">>,
        <<"value">> => #{
            <<"title">> => <<"Demo Video">>,
            <<"description">> => <<"Searchable description">>,
            <<"tags">> => [<<"hb">>, <<"search">>],
            <<"source">> => #{
                <<"media_type">> => <<"video/mp4">>,
                <<"sd_hash">> => <<"sd123">>
            }
        },
        <<"signing_channel">> => #{
            <<"claim_id">> => <<"channel-1">>,
            <<"name">> => <<"@demo">>
        }
    },
    [Doc] = meili_documents(
        #{
            <<"claim_search_result">> => #{
                <<"items">> => [Claim],
                <<"page">> => 1,
                <<"page_size">> => 1
            }
        },
        #{}
    ),
    ?assertEqual(<<"claim-1">>, hb_maps:get(<<"id">>, Doc, #{})),
    ?assertEqual(<<"claim-1">>, hb_maps:get(<<"claimId">>, Doc, #{})),
    ?assertEqual(<<"demo-video">>, hb_maps:get(<<"name">>, Doc, #{})),
    ?assertEqual(<<"Demo Video">>, hb_maps:get(<<"title">>, Doc, #{})),
    ?assertEqual(<<"channel-1">>, hb_maps:get(<<"channel_id">>, Doc, #{})),
    ?assertEqual(<<"sd123">>, hb_maps:get(<<"sd_hash">>, Doc, #{})).

meili_query_uses_search_endpoint_test() ->
    SearchBody = hb_json:encode(#{
        <<"hits">> => [
            #{
                <<"id">> => <<"claim-1">>,
                <<"claimId">> => <<"claim-1">>,
                <<"name">> => <<"demo-video">>,
                <<"title">> => <<"Demo Video">>
            }
        ],
        <<"offset">> => 0,
        <<"limit">> => 10,
        <<"estimatedTotalHits">> => 1,
        <<"query">> => <<"demo">>
    }),
    {ok, Server, Handle} =
        hb_mock_server:start([
            {"/indexes/odysee_claims/search", meili_search, {200, SearchBody}}
        ]),
    try
        {ok, Msg} =
            query(
                #{},
                #{
                    <<"meili-url">> => Server,
                    <<"q">> => <<"demo">>,
                    <<"limit">> => 10
                },
                #{}
            ),
        Result = hb_maps:get(<<"result">>, Msg, #{}),
        ?assertEqual(<<"hyperbeam-meilisearch">>, hb_maps:get(<<"poweredBy">>, Result, #{})),
        ?assertEqual([#{ <<"name">> => <<"demo-video">>, <<"claimId">> => <<"claim-1">> }], hb_maps:get(<<"body">>, Result, #{})),
        [Request] = hb_mock_server:get_requests(meili_search, 1, Handle),
        ReqBody = hb_json:decode(hb_maps:get(<<"body">>, Request, <<>>, #{})),
        ?assertEqual(<<"demo">>, hb_maps:get(<<"q">>, ReqBody, #{})),
        ?assertEqual(10, hb_maps:get(<<"limit">>, ReqBody, #{}))
    after
        hb_mock_server:stop(Handle)
    end.

meili_index_posts_documents_test() ->
    IndexBody = hb_json:encode(#{
        <<"taskUid">> => 7,
        <<"indexUid">> => <<"odysee_claims">>,
        <<"status">> => <<"enqueued">>
    }),
    {ok, Server, Handle} =
        hb_mock_server:start([
            {"/indexes/odysee_claims/documents", meili_index, {202, IndexBody}}
        ]),
    try
        {ok, Msg} =
            index(
                #{},
                #{
                    <<"meili-url">> => Server,
                    <<"documents">> => [
                        #{
                            <<"id">> => <<"claim-1">>,
                            <<"claimId">> => <<"claim-1">>,
                            <<"name">> => <<"demo-video">>,
                            <<"title">> => <<"Demo Video">>
                        }
                    ]
                },
                #{}
            ),
        Result = hb_maps:get(<<"result">>, Msg, #{}),
        ?assertEqual(true, hb_maps:get(<<"ok">>, Result, #{})),
        ?assertEqual(1, hb_maps:get(<<"documents">>, Result, #{})),
        ?assertEqual(7, hb_maps:get(<<"taskUid">>, hb_maps:get(<<"task">>, Result, #{}), #{})),
        [Request] = hb_mock_server:get_requests(meili_index, 1, Handle),
        ?assertEqual(<<"primaryKey=id">>, hb_maps:get(<<"qs">>, Request, <<>>, #{})),
        [Doc] = hb_json:decode(hb_maps:get(<<"body">>, Request, <<>>, #{})),
        ?assertEqual(<<"claim-1">>, hb_maps:get(<<"id">>, Doc, #{})),
        ?assertEqual(<<"Demo Video">>, hb_maps:get(<<"title">>, Doc, #{}))
    after
        hb_mock_server:stop(Handle)
    end.

legacy_index_indexes_claim_search_items_test() ->
    IndexBody = hb_json:encode(#{
        <<"taskUid">> => 8,
        <<"indexUid">> => <<"odysee_claims">>,
        <<"status">> => <<"enqueued">>
    }),
    LegacyClaim = #{
        <<"claim_id">> => <<"legacy-claim-1">>,
        <<"name">> => <<"legacy-video">>,
        <<"value_type">> => <<"stream">>,
        <<"value">> => #{
            <<"title">> => <<"Legacy Search Video">>,
            <<"description">> => <<"Indexed from legacy claim search">>,
            <<"source">> => #{ <<"media_type">> => <<"video/mp4">> }
        }
    },
    {ok, Server, Handle} =
        hb_mock_server:start([
            {"/indexes/odysee_claims/documents", meili_index, {202, IndexBody}}
        ]),
    try
        {ok, Msg} =
            index_legacy(
                #{},
                #{
                    <<"meili-url">> => Server,
                    <<"query">> => <<"s=legacy&size=1&claimType=file">>,
                    <<"claim_search_result">> => #{
                        <<"items">> => [LegacyClaim],
                        <<"page">> => 1,
                        <<"page_size">> => 1,
                        <<"total_items">> => 1
                    }
                },
                #{}
            ),
        Result = hb_maps:get(<<"result">>, Msg, #{}),
        ?assertEqual(true, hb_maps:get(<<"ok">>, Result, #{})),
        ?assertEqual(<<"legacy-odysee">>, hb_maps:get(<<"source">>, Result, #{})),
        ?assertEqual(1, hb_maps:get(<<"claimItems">>, Result, #{})),
        ?assertEqual(1, hb_maps:get(<<"documents">>, Result, #{})),
        [Page] = hb_maps:get(<<"pages">>, Result, #{}),
        ?assertEqual(1, hb_maps:get(<<"items">>, Page, #{})),
        [Request] = hb_mock_server:get_requests(meili_index, 1, Handle),
        ?assertEqual(<<"primaryKey=id">>, hb_maps:get(<<"qs">>, Request, <<>>, #{})),
        [Doc] = hb_json:decode(hb_maps:get(<<"body">>, Request, <<>>, #{})),
        ?assertEqual(<<"legacy-claim-1">>, hb_maps:get(<<"id">>, Doc, #{})),
        ?assertEqual(<<"Legacy Search Video">>, hb_maps:get(<<"title">>, Doc, #{}))
    after
        hb_mock_server:stop(Handle)
    end.

meili_health_uses_health_endpoint_test() ->
    HealthBody = hb_json:encode(#{ <<"status">> => <<"available">> }),
    {ok, Server, Handle} =
        hb_mock_server:start([
            {"/health", meili_health, {200, HealthBody}}
        ]),
    try
        {ok, Msg} =
            health(
                #{},
                #{ <<"meili-url">> => Server },
                #{}
            ),
        Result = hb_maps:get(<<"result">>, Msg, #{}),
        ?assertEqual(true, hb_maps:get(<<"ok">>, Result, #{})),
        ?assertEqual(<<"available">>, hb_maps:get(<<"status">>, hb_maps:get(<<"health">>, Result, #{}), #{})),
        [_Request] = hb_mock_server:get_requests(meili_health, 1, Handle)
    after
        hb_mock_server:stop(Handle)
    end.

test_params64(Params) ->
    hb_util:encode(hb_json:encode(Params)).

-endif.
