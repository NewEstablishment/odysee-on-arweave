%%% @doc Odysee search device backed by a local search engine.
-module(dev_odysee_search).
-implements(<<"odysee-search@1.0">>).
-export([info/1, query/3, index/3, delete/3, status/3, schema/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-search@1.0">>).
-define(DEFAULT_BACKEND_URL, <<"http://127.0.0.1:7700">>).
-define(DEFAULT_INDEX, <<"odysee_claims">>).

info(_Opts) ->
    #{ exports => [<<"query">>, <<"index">>, <<"delete">>, <<"status">>, <<"schema">>] }.

query(Base, Req, Opts) ->
    safe(fun() ->
        Params = params(Base, Req, Opts),
        Search = meili_search_body(Params, Opts),
        maybe
            {ok, Raw} ?= meili_post(index_path(Params, Opts, <<"/search">>), Search, Base, Req, Opts),
            {ok, Decoded} ?= try_decode_json(Raw),
            Result = normalize_search_response(Decoded, Params, Opts),
            ok_json(Result#{ <<"request">> => Search })
        else
            Error -> device_error(Error)
        end
    end).

index(Base, Req, Opts) ->
    safe(fun() ->
        Params = params(Base, Req, Opts),
        Docs = documents(Params, Opts),
        maybe
            {ok, Raw} ?= meili_post(
                index_path(Params, Opts, <<"/documents?primaryKey=search_id">>),
                Docs,
                Base,
                Req,
                Opts
            ),
            {ok, Decoded} ?= try_decode_json(Raw),
            ok_json(#{ <<"task">> => Decoded, <<"documents">> => document_count(Docs) })
        else
            Error -> device_error(Error)
        end
    end).

delete(Base, Req, Opts) ->
    safe(fun() ->
        Params = params(Base, Req, Opts),
        case ids(Params, Opts) of
            [ID] ->
                SearchID = search_id(ID),
                maybe
                    {ok, Raw} ?= meili_delete(index_path(Params, Opts, <<"/documents/", SearchID/binary>>), Base, Req, Opts),
                    {ok, Decoded} ?= try_decode_json(Raw),
                    ok_json(#{ <<"task">> => Decoded, <<"deleted">> => [ID] })
                else
                    Error -> device_error(Error)
                end;
            IDs when is_list(IDs), length(IDs) > 1 ->
                maybe
                    {ok, Raw} ?= meili_post(
                        index_path(Params, Opts, <<"/documents/delete-batch">>),
                        [search_id(ID) || ID <- IDs],
                        Base,
                        Req,
                        Opts
                    ),
                    {ok, Decoded} ?= try_decode_json(Raw),
                    ok_json(#{ <<"task">> => Decoded, <<"deleted">> => IDs })
                else
                    Error -> device_error(Error)
                end;
            _ ->
                json_error(400, <<"missing id or ids">>)
        end
    end).

status(Base, Req, Opts) ->
    safe(fun() ->
        Params = params(Base, Req, Opts),
        Health =
            case meili_get(<<"/health">>, Base, Req, Opts) of
                {ok, HealthRaw} -> decode_or_raw(HealthRaw);
                Error -> Error
            end,
        Stats =
            case meili_get(index_path(Params, Opts, <<"/stats">>), Base, Req, Opts) of
                {ok, StatsRaw} -> decode_or_raw(StatsRaw);
                Error2 -> Error2
            end,
        ok_json(#{
            <<"backend">> => <<"meilisearch">>,
            <<"backend-url">> => backend_url(Base, Req, Opts),
            <<"index">> => index_name(Params, Opts),
            <<"health">> => Health,
            <<"stats">> => Stats
        })
    end).

schema(Base, Req, Opts) ->
    safe(fun() ->
        Params = params(Base, Req, Opts),
        ok_json(#{
            <<"index">> => index_name(Params, Opts),
            <<"primary-key">> => <<"search_id">>,
            <<"document-id">> => <<"immutable id for native uploads, legacy txid:vout for legacy claim outputs">>,
            <<"filterable-attributes">> => filterable_attributes(),
            <<"sortable-attributes">> => sortable_attributes(),
            <<"searchable-attributes">> => searchable_attributes(),
            <<"ranking-note">> => <<"start with Odysee-compatible text/filter search; tune ranking after legacy corpus import">>
        })
    end).

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> device_error({error, Reason});
        _:Reason -> device_error({error, Reason})
    end.

params(Base, Req, Opts) ->
    hb_cache:ensure_all_loaded(maps:merge(map_or_empty(Base), map_or_empty(Req)), Opts).

meili_search_body(Params, Opts) ->
    Body0 = #{
        <<"q">> => query_text(Params, Opts),
        <<"limit">> => page_size(Params, Opts),
        <<"offset">> => offset(Params, Opts),
        <<"attributesToRetrieve">> => attributes_to_retrieve(Params, Opts)
    },
    Body1 = maybe_put(<<"filter">>, filters(Params, Opts), Body0),
    maybe_put(<<"sort">>, sorts(Params, Opts), Body1).

normalize_search_response(Msg, Params, Opts) when is_map(Msg) ->
    Hits0 = hb_maps:get(<<"hits">>, Msg, [], Opts),
    Hits = filter_stale_native_hits(Hits0, Opts),
    Limit = hb_maps:get(<<"limit">>, Msg, page_size(Params, Opts), Opts),
    Offset = hb_maps:get(<<"offset">>, Msg, offset(Params, Opts), Opts),
    Total = first_value([<<"estimatedTotalHits">>, <<"totalHits">>], Msg, Opts),
    Removed = length_or_zero(Hits0) - length_or_zero(Hits),
    #{
        <<"device">> => ?DEVICE,
        <<"backend">> => <<"meilisearch">>,
        <<"items">> => Hits,
        <<"claim-ids">> => claim_ids_from_hits(Hits, Opts),
        <<"total-items">> => max(0, value_or(Total, length_or_zero(Hits)) - Removed),
        <<"page">> => page_from_offset(Offset, Limit),
        <<"page-size">> => Limit,
        <<"raw">> => Msg#{ <<"hits">> => Hits }
    };
normalize_search_response(Other, _Params, _Opts) ->
    #{ <<"device">> => ?DEVICE, <<"backend">> => <<"meilisearch">>, <<"raw">> => Other }.

filter_stale_native_hits(Hits, Opts) when is_list(Hits) ->
    case native_upload_ids(Opts) of
        all -> Hits;
        UploadIDs ->
            [
                Hit
             || Hit <- Hits,
                not native_hit(Hit, Opts) orelse sets:is_element(hit_id(Hit, Opts), UploadIDs)
            ]
    end;
filter_stale_native_hits(Hits, _Opts) ->
    Hits.

native_upload_ids(Opts) ->
    case hb_store:read(hb_opts:get(store, [], Opts), <<"odysee/upload-index/global/state.json">>, Opts) of
        {ok, Bin} when is_binary(Bin) ->
            try
                State = hb_json:decode(Bin),
                Uploads = hb_maps:get(<<"uploads">>, State, #{}, Opts),
                case is_map(Uploads) of
                    true -> sets:from_list([hb_util:bin(ID) || ID <- maps:keys(Uploads)], [{version, 2}]);
                    false -> all
                end
            catch
                _:_ -> all
            end;
        _ ->
            all
    end.

native_hit(Hit, Opts) when is_map(Hit) ->
    first_value([<<"source_system">>, <<"source-system">>], Hit, Opts) =:= <<"hyperbeam-native">>;
native_hit(_Hit, _Opts) ->
    false.

hit_id(Hit, Opts) when is_map(Hit) ->
    case first_value([<<"immutable_id">>, <<"immutable-id">>, <<"claim_id">>, <<"claim-id">>, <<"doc_id">>, <<"doc-id">>], Hit, Opts) of
        not_found -> <<>>;
        ID -> hb_util:bin(ID)
    end;
hit_id(_Hit, _Opts) ->
    <<>>.

meili_get(Path, Base, Req, Opts) ->
    meili_request(<<"GET">>, Path, <<>>, Base, Req, Opts).

meili_post(Path, Body, Base, Req, Opts) ->
    meili_request(<<"POST">>, Path, hb_json:encode(Body), Base, Req, Opts).

meili_delete(Path, Base, Req, Opts) ->
    meili_request(<<"DELETE">>, Path, <<>>, Base, Req, Opts).

meili_request(Method, Path, Body, Base, Req, Opts) ->
    application:ensure_all_started(inets),
    URL = binary_to_list(<<(backend_url(Base, Req, Opts))/binary, Path/binary>>),
    Headers = [
        {"accept", "application/json"},
        {"content-type", "application/json"}
        | authorization_header(Base, Req, Opts)
    ],
    HTTPOpts = [
        {connect_timeout, hb_opts:get(<<"odysee-search-connect-timeout">>, 1000, Opts)},
        {timeout, hb_opts:get(<<"odysee-search-recv-timeout">>, 2000, Opts)}
    ],
    Opts0 = [{body_format, binary}],
    Request =
        case Method of
            <<"GET">> -> {URL, Headers};
            _ -> {URL, Headers, "application/json", Body}
        end,
    case httpc:request(method_atom(Method), Request, HTTPOpts, Opts0) of
        {ok, {{_, Status, _}, _RespHeaders, RespBody}} when Status >= 200, Status < 300 ->
            {ok, RespBody};
        {ok, {{_, Status, _}, _RespHeaders, RespBody}} ->
            {error, #{ <<"status">> => Status, <<"body">> => RespBody }};
        {error, Reason} ->
            {error, Reason}
    end.

method_atom(<<"GET">>) -> get;
method_atom(<<"POST">>) -> post;
method_atom(<<"DELETE">>) -> delete.

backend_url(Base, Req, Opts) ->
    trim_trailing_slash(
        value_or(
            first_value([<<"backend-url">>, <<"backend_url">>, <<"meili-url">>, <<"meili_url">>], maps:merge(map_or_empty(Base), map_or_empty(Req)), Opts),
            hb_opts:get(<<"odysee-search-backend-url">>, ?DEFAULT_BACKEND_URL, Opts)
        )
    ).

authorization_header(Base, Req, Opts) ->
    case value_or(
        first_value([<<"api-key">>, <<"api_key">>, <<"meili-key">>, <<"meili_key">>], maps:merge(map_or_empty(Base), map_or_empty(Req)), Opts),
        hb_opts:get(<<"odysee-search-api-key">>, <<>>, Opts)
    ) of
        <<>> -> [];
        Key -> [{"authorization", binary_to_list(<<"Bearer ", (hb_util:bin(Key))/binary>>)}]
    end.

index_path(Params, Opts, Suffix) ->
    <<"/indexes/", (index_name(Params, Opts))/binary, Suffix/binary>>.

index_name(Params, Opts) ->
    hb_util:bin(value_or(first_value([<<"index">>, <<"index-id">>, <<"index_id">>], Params, Opts), ?DEFAULT_INDEX)).

query_text(Params, Opts) ->
    hb_util:bin(value_or(first_value([<<"q">>, <<"query">>, <<"s">>, <<"text">>], Params, Opts), <<"">>)).

page_size(Params, Opts) ->
    clamp_int(first_value([<<"limit">>, <<"page_size">>, <<"page-size">>, <<"size">>], Params, Opts), 20, 1, 100).

offset(Params, Opts) ->
    case first_value([<<"offset">>, <<"from">>], Params, Opts) of
        not_found ->
            (page(Params, Opts) - 1) * page_size(Params, Opts);
        Value ->
            clamp_int(Value, 0, 0, 1000000)
    end.

page(Params, Opts) ->
    clamp_int(first_value([<<"page">>], Params, Opts), 1, 1, 1000000).

attributes_to_retrieve(Params, Opts) ->
    case first_value([<<"attributes">>, <<"attributes-to-retrieve">>, <<"attributes_to_retrieve">>], Params, Opts) of
        not_found -> [<<"*">>];
        Value -> list_value(Value)
    end.

filters(Params, Opts) ->
    Parts = lists:flatten([
        visibility_filters(Params, Opts),
        enum_filter(<<"claim_id">>, first_value([<<"claim_ids">>, <<"claim-ids">>, <<"claim_id">>, <<"claim-id">>], Params, Opts)),
        enum_filter(<<"channel_claim_id">>, first_value([<<"channel_ids">>, <<"channel-ids">>, <<"channel_id">>, <<"channel-id">>], Params, Opts)),
        enum_filter(<<"claim_type">>, claim_type_value(first_value([<<"claim_type">>, <<"claim-type">>, <<"claimType">>], Params, Opts))),
        enum_filter(<<"media_type">>, media_type_value(media_type_param(Params, Opts))),
        enum_filter(<<"content_type">>, content_type_value(first_value([<<"content_type">>, <<"content-type">>, <<"contentType">>], Params, Opts))),
        enum_filter(<<"language">>, first_value([<<"language">>], Params, Opts)),
        nsfw_filter(first_value([<<"nsfw">>], Params, Opts)),
        free_filter(first_value([<<"free_only">>, <<"free-only">>], Params, Opts)),
        tag_filter(<<"tags">>, first_value([<<"any_tags">>, <<"any-tags">>], Params, Opts), <<"OR">>),
        tag_filter(<<"tags">>, first_value([<<"all_tags">>, <<"all-tags">>], Params, Opts), <<"AND">>),
        tag_filter(<<"tags">>, first_value([<<"not_tags">>, <<"not-tags">>], Params, Opts), <<"NOT">>),
        release_time_filter(Params, Opts),
        time_filter(<<"created_at">>, first_value([<<"created_at">>, <<"created-at">>], Params, Opts)),
        duration_filters(Params, Opts)
    ]),
    join_filters(Parts).

visibility_filters(Params, Opts) ->
    case truthy(first_value([<<"include_expired">>, <<"include-expired">>], Params, Opts)) of
        true -> hidden_tag_filters(Params, Opts);
        false -> [<<"bid_state != \"Expired\"">>, <<"bid_state != \"Spent\"">> | hidden_tag_filters(Params, Opts)]
    end.

hidden_tag_filters(Params, Opts) ->
    case truthy(first_value([<<"include_hidden">>, <<"include-hidden">>], Params, Opts)) of
        true -> [];
        false ->
            [
                <<"NOT tags = \"c:unlisted\"">>,
                <<"NOT tags = \"c:private\"">>,
                <<"NOT tags = \"c:scheduled:hide\"">>,
                <<"NOT tags = \"c:scheduled:show\"">>
            ]
    end.

claim_type_value(not_found) ->
    not_found;
claim_type_value(Value) ->
    [claim_type_one(Item) || Item <- list_value(Value)].

claim_type_one(<<"file">>) -> <<"stream">>;
claim_type_one(<<"files">>) -> <<"stream">>;
claim_type_one(<<"stream">>) -> <<"stream">>;
claim_type_one(<<"streams">>) -> <<"stream">>;
claim_type_one(<<"channel">>) -> <<"channel">>;
claim_type_one(<<"channels">>) -> <<"channel">>;
claim_type_one(<<"list">>) -> <<"claimlist">>;
claim_type_one(<<"collection">>) -> <<"claimlist">>;
claim_type_one(<<"collections">>) -> <<"claimlist">>;
claim_type_one(Value) -> hb_util:bin(Value).

media_type_param(Params, Opts) ->
    case first_value([<<"stream_types">>, <<"stream-types">>, <<"media_type">>, <<"media-type">>, <<"mediaType">>], Params, Opts) of
        not_found -> media_type_booleans(Params, Opts);
        Value -> Value
    end.

media_type_booleans(Params, Opts) ->
    Values = lists:filtermap(
        fun({Key, Type}) ->
            case truthy(first_value([Key], Params, Opts)) of
                true -> {true, Type};
                false -> false
            end
        end,
        [
            {<<"audio">>, <<"audio">>},
            {<<"video">>, <<"video">>},
            {<<"text">>, <<"text">>},
            {<<"image">>, <<"image">>},
            {<<"application">>, <<"application">>},
            {<<"model">>, <<"model">>},
            {<<"binary">>, <<"binary">>}
        ]
    ),
    case Values of
        [] -> not_found;
        _ -> Values
    end.

media_type_value(not_found) ->
    not_found;
media_type_value(Value) ->
    [media_type_one(Item) || Item <- list_value(Value)].

media_type_one(<<"text">>) -> <<"text">>;
media_type_one(<<"application">>) -> <<"application">>;
media_type_one(<<"audio">>) -> <<"audio">>;
media_type_one(<<"video">>) -> <<"video">>;
media_type_one(<<"image">>) -> <<"image">>;
media_type_one(<<"cad">>) -> <<"cad">>;
media_type_one(<<"model">>) -> <<"model">>;
media_type_one(<<"document">>) -> <<"text">>;
media_type_one(<<"binary">>) -> <<"application">>;
media_type_one(Value) -> hb_util:bin(Value).

content_type_value(not_found) ->
    not_found;
content_type_value(<<"application/json">>) ->
    not_found;
content_type_value(Value) ->
    Value.

nsfw_filter(not_found) ->
    [];
nsfw_filter(Value) ->
    case truthy(Value) of
        true -> [<<"nsfw = 1">>];
        false -> [<<"nsfw = 0">>]
    end.

free_filter(not_found) ->
    [];
free_filter(Value) ->
    case truthy(Value) of
        true -> [<<"fee = 0">>];
        false -> []
    end.

duration_filters(Params, Opts) ->
    lists:flatten([
        range_filter(<<"duration">>, <<">=">>, first_value([<<"min_duration">>, <<"min-duration">>, <<"duration_gte">>, <<"duration-gte">>], Params, Opts)),
        range_filter(<<"duration">>, <<"<=">>, first_value([<<"max_duration">>, <<"max-duration">>, <<"duration_lte">>, <<"duration-lte">>], Params, Opts))
    ]).

range_filter(_Field, _Op, not_found) ->
    [];
range_filter(Field, Op, Value) ->
    [<<Field/binary, " ", Op/binary, " ", (number_filter(Value))/binary>>].

sorts(Params, Opts) ->
    case first_value([<<"sort">>, <<"sort_by">>, <<"sort-by">>, <<"order_by">>, <<"order-by">>, <<"order">>], Params, Opts) of
        not_found -> default_sorts(Params, Opts);
        Value -> normalize_sorts(list_value(Value))
    end.

default_sorts(Params, Opts) ->
    case first_value([<<"claim_type">>, <<"claim-type">>, <<"claimType">>], Params, Opts) of
        <<"channel">> -> default_popularity_sorts();
        <<"file">> -> default_popularity_sorts();
        <<"stream">> -> default_popularity_sorts();
        not_found -> default_mixed_sorts();
        Value ->
            Types = [claim_type_one(Item) || Item <- list_value(Value)],
            case lists:member(<<"channel">>, Types) andalso lists:any(fun(Type) -> Type =/= <<"channel">> end, Types) of
                true -> default_mixed_sorts();
                false -> default_popularity_sorts()
            end
    end.

default_mixed_sorts() ->
    [
        <<"is_channel:desc">>,
        <<"recency_rank:desc">>,
        <<"has_thumbnail:desc">>,
        <<"search_rank:desc">>,
        <<"effective_amount:desc">>,
        <<"release_time:desc">>
    ].

default_popularity_sorts() ->
    [
        <<"recency_rank:desc">>,
        <<"has_thumbnail:desc">>,
        <<"search_rank:desc">>,
        <<"effective_amount:desc">>,
        <<"release_time:desc">>
    ].

normalize_sorts(Values) ->
    lists:filtermap(fun normalize_sort/1, Values).

normalize_sort(Value) ->
    Bin = hb_util:bin(Value),
    case Bin of
        <<"trending_group">> -> {true, <<"search_rank:desc">>};
        <<"trending_mixed">> -> {true, <<"search_rank:desc">>};
        <<"-", Field/binary>> -> {true, <<(sort_field(Field))/binary, ":desc">>};
        <<"^", Field/binary>> -> {true, <<(sort_field(Field))/binary, ":asc">>};
        <<"+", Field/binary>> -> {true, <<(sort_field(Field))/binary, ":asc">>};
        <<>> -> false;
        Field -> {true, <<(sort_field(Field))/binary, ":desc">>}
    end.

sort_field(<<"creation_timestamp">>) -> <<"created_at">>;
sort_field(<<"activation_height">>) -> <<"created_at">>;
sort_field(<<"amount">>) -> <<"effective_amount">>;
sort_field(<<"effective_amount">>) -> <<"effective_amount">>;
sort_field(<<"release_time">>) -> <<"release_time">>;
sort_field(<<"created_at">>) -> <<"created_at">>;
sort_field(<<"transaction_time">>) -> <<"transaction_time">>;
sort_field(<<"name">>) -> <<"name">>;
sort_field(Field) -> Field.

enum_filter(_Field, not_found) ->
    [];
enum_filter(Field, Value) ->
    Values = list_value(Value),
    case Values of
        [] -> [];
        [Single] -> [<<Field/binary, " = ", (quote_filter(Single))/binary>>];
        _ -> [<<Field/binary, " IN [", (join_quoted(Values))/binary, "]">>]
    end.

tag_filter(_Field, not_found, _Mode) ->
    [];
tag_filter(Field, Value, <<"OR">>) ->
    Parts = [<<Field/binary, " = ", (quote_filter(Tag))/binary>> || Tag <- list_value(Value)],
    case Parts of [] -> []; _ -> [paren(join_with(Parts, <<" OR ">>))] end;
tag_filter(Field, Value, <<"AND">>) ->
    [<<Field/binary, " = ", (quote_filter(Tag))/binary>> || Tag <- list_value(Value)];
tag_filter(Field, Value, <<"NOT">>) ->
    [<<"NOT ", Field/binary, " = ", (quote_filter(Tag))/binary>> || Tag <- list_value(Value)].

time_filter(_Field, not_found) ->
    [];
time_filter(Field, Value) ->
    Bin = hb_util:bin(Value),
    case Bin of
        <<">=", Rest/binary>> -> [<<Field/binary, " >= ", (number_filter(Rest))/binary>>];
        <<"<=", Rest/binary>> -> [<<Field/binary, " <= ", (number_filter(Rest))/binary>>];
        <<">", Rest/binary>> -> [<<Field/binary, " > ", (number_filter(Rest))/binary>>];
        <<"<", Rest/binary>> -> [<<Field/binary, " < ", (number_filter(Rest))/binary>>];
        <<>> -> [];
        _ -> [<<Field/binary, " = ", (number_filter(Bin))/binary>>]
    end.

release_time_filter(Params, Opts) ->
    case first_value([<<"release_time">>, <<"release-time">>], Params, Opts) of
        not_found -> time_filter_value(first_value([<<"time_filter">>, <<"time-filter">>], Params, Opts));
        Value -> time_filter(<<"release_time">>, Value)
    end.

time_filter_value(not_found) ->
    [];
time_filter_value(Value) ->
    Now = erlang:system_time(second),
    Cutoff =
        case hb_util:bin(Value) of
            <<"lasthour">> -> Now - 3600;
            <<"today">> -> Now - 86400;
            <<"thisweek">> -> Now - (7 * 86400);
            <<"thismonth">> -> Now - (31 * 86400);
            <<"thisyear">> -> Now - (366 * 86400);
            <<"day">> -> Now - 86400;
            <<"week">> -> Now - (7 * 86400);
            <<"month">> -> Now - (31 * 86400);
            <<"year">> -> Now - (366 * 86400);
            <<"all">> -> not_found;
            <<"default">> -> not_found;
            _ -> not_found
        end,
    case Cutoff of
        not_found -> [];
        _ -> [<<"release_time >= ", (integer_to_binary(Cutoff))/binary>>]
    end.

join_filters([]) -> not_found;
join_filters(Parts) -> join_with(Parts, <<" AND ">>).

documents(Params, Opts) ->
    case first_value([<<"documents">>, <<"items">>], Params, Opts) of
        not_found ->
            case first_value([<<"document">>, <<"item">>, <<"claim">>], Params, Opts) of
                not_found -> erlang:error({error, <<"missing document or documents">>});
                Doc -> [normalize_document(Doc, Opts)]
            end;
        Docs when is_list(Docs) ->
            [normalize_document(Doc, Opts) || Doc <- Docs];
        Doc ->
            [normalize_document(Doc, Opts)]
    end.

normalize_document(Doc, Opts) when is_map(Doc) ->
    case first_value([<<"doc_id">>, <<"doc-id">>, <<"immutable_id">>, <<"immutable-id">>, <<"txid">>, <<"claim_id">>, <<"claim-id">>], Doc, Opts) of
        not_found -> Doc;
        ID ->
            DocID = hb_util:bin(ID),
            Doc#{ <<"doc_id">> => DocID, <<"search_id">> => search_id(DocID) }
    end;
normalize_document(Other, _Opts) ->
    erlang:error({error, {invalid_document, Other}}).

search_id(ID) ->
    << <<(search_id_char(Char))>> || <<Char>> <= hb_util:bin(ID) >>.

search_id_char(Char) when Char >= $a, Char =< $z -> Char;
search_id_char(Char) when Char >= $A, Char =< $Z -> Char;
search_id_char(Char) when Char >= $0, Char =< $9 -> Char;
search_id_char($_) -> $_;
search_id_char($-) -> $-;
search_id_char(_) -> $_.

ids(Params, Opts) ->
    case first_value([<<"ids">>, <<"doc_ids">>, <<"doc-ids">>], Params, Opts) of
        not_found ->
            case first_value([<<"id">>, <<"doc_id">>, <<"doc-id">>], Params, Opts) of
                not_found -> [];
                ID -> [hb_util:bin(ID)]
            end;
        IDs ->
            [hb_util:bin(ID) || ID <- list_value(IDs)]
    end.

ok_json(Result) ->
    Body = hb_json:encode(#{ <<"result">> => Result }),
    {ok, #{
        <<"device">> => ?DEVICE,
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"result">> => Result,
        <<"body">> => Body
    }}.

json_error(Status, Message) ->
    Body = hb_json:encode(#{ <<"error">> => Message }),
    {ok, #{
        <<"device">> => ?DEVICE,
        <<"status">> => Status,
        <<"content-type">> => <<"application/json">>,
        <<"error">> => Message,
        <<"body">> => Body
    }}.

device_error({error, #{ <<"status">> := Status, <<"body">> := Body }}) ->
    json_error(Status, #{ <<"backend-status">> => Status, <<"backend-body">> => Body });
device_error({error, invalid_json}) ->
    json_error(502, <<"search backend returned invalid json">>);
device_error({error, Reason}) ->
    json_error(503, #{ <<"backend">> => <<"meilisearch">>, <<"reason">> => error_reason(Reason) });
device_error(Reason) ->
    json_error(500, #{ <<"reason">> => error_reason(Reason) }).

error_reason(Reason) when is_atom(Reason) ->
    atom_to_binary(Reason);
error_reason(Reason) when is_binary(Reason) ->
    Reason;
error_reason(Reason) when is_map(Reason) ->
    Reason;
error_reason(Reason) ->
    hb_util:bin(io_lib:format("~p", [Reason])).

decode_or_raw(Raw) ->
    case try_decode_json(Raw) of
        {ok, Decoded} -> Decoded;
        _ -> Raw
    end.

try_decode_json(Raw) ->
    try {ok, hb_json:decode(Raw)}
    catch _:_ -> {error, invalid_json}
    end.

first_value(Keys, Msg, Opts) ->
    first_value(Keys, Msg, not_found, Opts).

first_value([], _Msg, Default, _Opts) ->
    Default;
first_value([Key | Rest], Msg, Default, Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_value(Rest, Msg, Default, Opts);
        Value -> Value
    end;
first_value(_Keys, _Msg, Default, _Opts) ->
    Default.

maybe_put(_Key, not_found, Map) ->
    Map;
maybe_put(_Key, [], Map) ->
    Map;
maybe_put(Key, Value, Map) ->
    Map#{ Key => Value }.

value_or(not_found, Default) -> Default;
value_or(undefined, Default) -> Default;
value_or(Value, _Default) -> Value.

map_or_empty(Map) when is_map(Map) -> Map;
map_or_empty(_Value) -> #{}.

list_value(Value) when is_list(Value) -> Value;
list_value(Value) when is_binary(Value) ->
    case binary:split(Value, <<",">>, [global]) of
        [Value] -> [Value];
        Values -> [trim(V) || V <- Values, trim(V) =/= <<>>]
    end;
list_value(Value) -> [Value].

clamp_int(Value, Default, Min, Max) ->
    Int = parse_int(Value, Default),
    min(Max, max(Min, Int)).

parse_int(not_found, Default) -> Default;
parse_int(Value, _Default) when is_integer(Value) -> Value;
parse_int(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value)
    catch _:_ -> Default
    end;
parse_int(_Value, Default) -> Default.

truthy(true) -> true;
truthy(1) -> true;
truthy(<<"1">>) -> true;
truthy(<<"true">>) -> true;
truthy(<<"yes">>) -> true;
truthy(_) -> false.

page_from_offset(_Offset, 0) -> 1;
page_from_offset(Offset, Limit) when is_integer(Offset), is_integer(Limit) ->
    (Offset div Limit) + 1;
page_from_offset(_Offset, _Limit) -> 1.

document_count(Docs) when is_list(Docs) -> length(Docs);
document_count(_Doc) -> 1.

claim_ids_from_hits(Hits, Opts) when is_list(Hits) ->
    lists:filtermap(
        fun(Hit) when is_map(Hit) ->
            case first_value([<<"claim_id">>, <<"claim-id">>], Hit, Opts) of
                not_found -> false;
                ClaimID -> {true, hb_util:bin(ClaimID)}
            end;
           (_Hit) ->
            false
        end,
        Hits
    );
claim_ids_from_hits(_Hits, _Opts) ->
    [].

length_or_zero(List) when is_list(List) -> length(List);
length_or_zero(_Value) -> 0.

quote_filter(Value) ->
    Escaped = binary:replace(hb_util:bin(Value), <<"\"">>, <<"\\\"">>, [global]),
    <<"\"", Escaped/binary, "\"">>.

number_filter(Value) ->
    trim(hb_util:bin(Value)).

join_quoted(Values) ->
    join_with([quote_filter(Value) || Value <- Values], <<", ">>).

join_with([], _Sep) -> <<>>;
join_with([One], _Sep) -> One;
join_with([One | Rest], Sep) ->
    lists:foldl(fun(Part, Acc) -> <<Acc/binary, Sep/binary, Part/binary>> end, One, Rest).

paren(Value) ->
    <<"(", Value/binary, ")">>.

trim(Value) ->
    trim_right(trim_left(hb_util:bin(Value))).

trim_left(<<C, Rest/binary>>) when C =< $\s -> trim_left(Rest);
trim_left(Bin) -> Bin.

trim_right(Bin) ->
    Size = byte_size(Bin),
    case Size of
        0 -> Bin;
        _ ->
            Last = binary:at(Bin, Size - 1),
            case Last =< $\s of
                true -> trim_right(binary:part(Bin, 0, Size - 1));
                false -> Bin
            end
    end.

trim_trailing_slash(<<>>) ->
    <<>>;
trim_trailing_slash(Bin0) ->
    Bin = hb_util:bin(Bin0),
    Size = byte_size(Bin),
    case Size > 1 andalso binary:at(Bin, Size - 1) =:= $/ of
        true -> trim_trailing_slash(binary:part(Bin, 0, Size - 1));
        false -> Bin
    end.

filterable_attributes() ->
    [
        <<"doc_id">>,
        <<"claim_id">>,
        <<"immutable_id">>,
        <<"channel_claim_id">>,
        <<"bid_state">>,
        <<"claim_type">>,
        <<"content_type">>,
        <<"media_type">>,
        <<"tags">>,
        <<"language">>,
        <<"nsfw">>,
        <<"fee">>,
        <<"release_time">>,
        <<"created_at">>,
        <<"transaction_time">>,
        <<"duration">>,
        <<"height">>,
        <<"width">>,
        <<"claim_count">>,
        <<"claim_cnt">>,
        <<"channel_claim_count">>,
        <<"is_channel">>,
        <<"has_thumbnail">>,
        <<"has_channel">>,
        <<"is_controlling">>,
        <<"recency_rank">>
    ].

sortable_attributes() ->
    [
        <<"is_channel">>,
        <<"search_rank">>,
        <<"recency_rank">>,
        <<"has_thumbnail">>,
        <<"is_controlling">>,
        <<"release_time">>,
        <<"created_at">>,
        <<"transaction_time">>,
        <<"effective_amount">>,
        <<"certificate_amount">>,
        <<"view_count">>,
        <<"view_cnt">>,
        <<"sub_cnt">>,
        <<"claim_count">>,
        <<"claim_cnt">>,
        <<"channel_claim_count">>,
        <<"duration">>
    ].

searchable_attributes() ->
    [
        <<"title">>,
        <<"name">>,
        <<"channel_name">>,
        <<"searchable_name">>,
        <<"stripped_name">>,
        <<"tags">>,
        <<"description">>
    ].

meili_search_body_test() ->
    Body = meili_search_body(#{
        <<"s">> => <<"space cats">>,
        <<"page">> => 2,
        <<"page_size">> => 10,
        <<"claim_ids">> => [<<"a">>, <<"b">>],
        <<"claimType">> => <<"file">>,
        <<"mediaType">> => <<"video">>,
        <<"nsfw">> => false,
        <<"free_only">> => true,
        <<"min_duration">> => 30,
        <<"max_duration">> => 300,
        <<"any_tags">> => <<"science,education">>,
        <<"order_by">> => [<<"release_time">>, <<"-effective_amount">>]
    }, #{}),
    ?assertEqual(<<"space cats">>, maps:get(<<"q">>, Body)),
    ?assertEqual(10, maps:get(<<"limit">>, Body)),
    ?assertEqual(10, maps:get(<<"offset">>, Body)),
    ?assertEqual([<<"release_time:asc">>, <<"effective_amount:desc">>], maps:get(<<"sort">>, Body)),
    ?assertMatch(#{ <<"filter">> := _ }, Body),
    Filter = maps:get(<<"filter">>, Body),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"claim_type = \"stream\"">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"media_type = \"video\"">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"nsfw = 0">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"fee = 0">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"duration >= 30">>)),
    ?assertNotEqual(nomatch, binary:match(Filter, <<"duration <= 300">>)).

normalize_search_response_test() ->
    Msg = #{
        <<"hits">> => [#{ <<"claim_id">> => <<"abc">>, <<"title">> => <<"A">> }],
        <<"estimatedTotalHits">> => 1,
        <<"limit">> => 20,
        <<"offset">> => 0
    },
    Result = normalize_search_response(Msg, #{}, #{}),
    ?assertEqual([<<"abc">>], maps:get(<<"claim-ids">>, Result)),
    ?assertEqual(1, maps:get(<<"total-items">>, Result)).

search_id_test() ->
    ?assertEqual(<<"abc-XYZ_123_0">>, search_id(<<"abc-XYZ_123:0">>)).
