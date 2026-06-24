%%% @doc Odysee claim resolution compatibility device.
%%%
%%% This device normalizes a legacy SDK `resolve' claim into an AO-Core message
%%% while preserving the raw JSON response for audit/debugging.
-module(dev_odysee_claim).
-implements(<<"odysee-claim@1.0">>).
-export([info/1, resolve/3, search/3, transaction/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-claim@1.0">>).
-define(DEFAULT_PROXY_URL, <<"https://api.na-backend.odysee.com/api/v1/proxy">>).

%% @doc Return the public device API.
info(_Opts) ->
    #{ exports => [<<"resolve">>, <<"search">>, <<"transaction">>] }.

%% @doc Resolve and normalize an Odysee/LBRY claim.
resolve(Base, Req, Opts) ->
    safe(fun() ->
        case claim_ids(Base, Req, Opts) of
            {ok, ClaimIDs} ->
                maybe
                    {ok, Result, Raw} ?= find_or_fetch_claim_id_search(ClaimIDs, Base, Req, Opts),
                    ok_message((normalize_search_result(Result, Raw, Opts))#{
                        <<"view">> => <<"claim-id-resolve">>
                    })
                else
                    Error -> Error
                end;
            not_found ->
                resolve_by_uri_or_claim(Base, Req, Opts);
            Error ->
                Error
        end
    end).

resolve_by_uri_or_claim(Base, Req, Opts) ->
    case claim_uris(Base, Req, Opts) of
            {ok, URIs} ->
                maybe
                    {ok, Raw} ?= resolve_proxy_many(URIs, Base, Req, Opts),
                    {ok, Result} ?= claims_from_proxy(URIs, Raw, Opts),
                    ok_message(normalize_claim_result_map(Result, Raw, Opts))
                else
                    Error -> Error
                end;
            not_found ->
                maybe
                    {ok, Claim, Raw} ?= find_or_fetch_claim(Base, Req, Opts),
                    ok_message(normalize_claim(Claim, Raw, Opts))
                else
                    Error -> Error
                end;
            Error ->
                Error
    end.

%% @doc Search claims using the SDK proxy `claim_search' method.
search(Base, Req, Opts) ->
    safe(fun() ->
        Params = search_params(Base, Req, Opts),
        maybe
            {ok, Result, Raw} ?= find_or_fetch_search_params(Params, Base, Req, Opts),
            ok_message(normalize_search_result(Result, Raw, Opts))
        else
            Error -> Error
        end
    end).

%% @doc Fetch or normalize SDK proxy `transaction_show' evidence.
transaction(Base, Req, Opts) ->
    safe(fun() ->
        maybe
            {ok, Result, Raw} ?= find_or_fetch_transaction(Base, Req, Opts),
            ok_message(normalize_transaction_result(Result, Raw, Opts))
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

ok_message(Msg) when is_map(Msg) -> {ok, Msg};
ok_message(Error) -> Error.

find_or_fetch_claim(Base, Req, Opts) ->
    case claim_candidate(Base, Req, Opts) of
        {ok, Claim, Raw} ->
            {ok, Claim, Raw};
        not_found ->
            maybe
                {ok, URI} ?= claim_uri(Base, Req, Opts),
                {ok, Raw} ?= resolve_proxy(URI, Base, Req, Opts),
                claim_from_proxy(URI, Raw, Opts)
            end
    end.

find_or_fetch_search(Base, Req, Opts) ->
    find_or_fetch_search_params(search_params(Base, Req, Opts), Base, Req, Opts).

find_or_fetch_search_params(Params, Base, Req, Opts) ->
    case search_candidate(Base, Req, Opts) of
        {ok, _Result, _Raw} = Search ->
            Search;
        not_found ->
            maybe
                {ok, Raw} ?= search_proxy(Params, Base, Req, Opts),
                search_from_proxy(Raw, Opts)
            end
    end.

find_or_fetch_claim_id_search(ClaimIDs, Base, Req, Opts) ->
    case search_candidate(Base, Req, Opts) of
        {ok, _Result, _Raw} = Search ->
            Search;
        not_found ->
            maybe
                {ok, Raw} ?= search_proxy(claim_id_search_params(ClaimIDs, Base, Req, Opts), Base, Req, Opts),
                search_from_proxy(Raw, Opts)
            end
    end.

find_or_fetch_transaction(Base, Req, Opts) ->
    case transaction_candidate(Base, Req, Opts) of
        {ok, _Result, _Raw} = Transaction ->
            Transaction;
        not_found ->
            maybe
                {ok, TxID} ?= required_txid(Base, Req, Opts),
                {ok, Raw} ?=
                    sdk_proxy(<<"transaction_show">>, #{ <<"txid">> => TxID }, Base, Req, Opts),
                transaction_from_proxy(Raw, Opts)
            end
    end.

claim_candidate(Base, Req, Opts) ->
    Candidates = [
        {Req, <<"claim">>},
        {Req, <<"source">>},
        {Req, <<"proxy-result">>},
        {Req, <<"resolve-result">>},
        {Req, <<"raw-result">>},
        {Req, <<"body">>},
        {Base, <<"claim">>},
        {Base, <<"source">>},
        {Base, <<"proxy-result">>},
        {Base, <<"resolve-result">>},
        {Base, <<"raw-result">>},
        {Base, <<"body">>}
    ],
    case candidate_from_value(Base, not_found, Opts) of
        {ok, _Claim, _Raw} = Claim -> Claim;
        not_found -> candidate_from_fields(Candidates, Opts)
    end.

search_candidate(Base, Req, Opts) ->
    Candidates = [
        {Req, <<"search-result">>},
        {Req, <<"search_result">>},
        {Req, <<"claim-search-result">>},
        {Req, <<"claim_search_result">>},
        {Req, <<"result">>},
        {Req, <<"body">>},
        {Base, <<"search-result">>},
        {Base, <<"search_result">>},
        {Base, <<"claim-search-result">>},
        {Base, <<"claim_search_result">>},
        {Base, <<"result">>},
        {Base, <<"body">>}
    ],
    case search_candidate_from_value(Base, Opts) of
        {ok, _Result, _Raw} = Search -> Search;
        not_found -> search_candidate_from_fields(Candidates, Opts)
    end.

transaction_candidate(Base, Req, Opts) ->
    Candidates = [
        {Req, <<"transaction-result">>},
        {Req, <<"transaction_result">>},
        {Req, <<"result">>},
        {Req, <<"body">>},
        {Base, <<"transaction-result">>},
        {Base, <<"transaction_result">>},
        {Base, <<"result">>},
        {Base, <<"body">>}
    ],
    case transaction_candidate_from_value(Base, Opts) of
        {ok, _Result, _Raw} = Transaction -> Transaction;
        not_found -> transaction_candidate_from_fields(Candidates, Opts)
    end.

search_candidate_from_fields([], _Opts) ->
    not_found;
search_candidate_from_fields([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> search_candidate_from_fields(Rest, Opts);
        Value ->
            case search_candidate_from_value(Value, Opts) of
                {ok, _Result, _Raw} = Search -> Search;
                not_found -> search_candidate_from_fields(Rest, Opts)
            end
    end;
search_candidate_from_fields([_ | Rest], Opts) ->
    search_candidate_from_fields(Rest, Opts).

search_candidate_from_value(Value, Opts) when is_map(Value) ->
    case search_from_proxy_map(Value, hb_json:encode(Value), Opts) of
        {ok, _Result, _Raw} = Search -> Search;
        _ -> not_found
    end;
search_candidate_from_value(Value, Opts) when is_binary(Value) ->
    case try_decode_json(Value) of
        {ok, Decoded} -> search_candidate_from_decoded(Decoded, Value, Opts);
        _ -> not_found
    end;
search_candidate_from_value(_Value, _Opts) ->
    not_found.

transaction_candidate_from_fields([], _Opts) ->
    not_found;
transaction_candidate_from_fields([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> transaction_candidate_from_fields(Rest, Opts);
        Value ->
            case transaction_candidate_from_value(Value, Opts) of
                {ok, _Result, _Raw} = Transaction -> Transaction;
                not_found -> transaction_candidate_from_fields(Rest, Opts)
            end
    end;
transaction_candidate_from_fields([_ | Rest], Opts) ->
    transaction_candidate_from_fields(Rest, Opts).

transaction_candidate_from_value(Value, Opts) when is_map(Value) ->
    case transaction_from_proxy_map(Value, hb_json:encode(Value), Opts) of
        {ok, _Result, _Raw} = Transaction -> Transaction;
        _ -> not_found
    end;
transaction_candidate_from_value(Value, Opts) when is_binary(Value) ->
    case try_decode_json(Value) of
        {ok, Decoded} -> transaction_candidate_from_decoded(Decoded, Value, Opts);
        _ -> not_found
    end;
transaction_candidate_from_value(_Value, _Opts) ->
    not_found.

transaction_candidate_from_decoded(Decoded, Raw, Opts) when is_map(Decoded) ->
    case transaction_from_proxy_map(Decoded, Raw, Opts) of
        {ok, _Result, _Raw} = Transaction -> Transaction;
        _ -> not_found
    end;
transaction_candidate_from_decoded(_Decoded, _Raw, _Opts) ->
    not_found.

search_candidate_from_decoded(Decoded, Raw, Opts) when is_map(Decoded) ->
    case search_from_proxy_map(Decoded, Raw, Opts) of
        {ok, _Result, _Raw} = Search -> Search;
        _ -> not_found
    end;
search_candidate_from_decoded(_Decoded, _Raw, _Opts) ->
    not_found.

candidate_from_fields([], _Opts) ->
    not_found;
candidate_from_fields([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> candidate_from_fields(Rest, Opts);
        Value ->
            case candidate_from_value(Value, first_found([{Msg, <<"uri">>}], Opts), Opts) of
                {ok, _Claim, _Raw} = Claim -> Claim;
                not_found -> candidate_from_fields(Rest, Opts)
            end
    end;
candidate_from_fields([_ | Rest], Opts) ->
    candidate_from_fields(Rest, Opts).

candidate_from_value(Value, URI, Opts) when is_map(Value) ->
    case is_claim_map(Value, Opts) of
        true -> {ok, Value, hb_json:encode(Value)};
        false ->
            case claim_from_proxy_map(URI, Value, hb_json:encode(Value), Opts) of
                {ok, _Claim, _Raw} = Claim -> Claim;
                _ -> not_found
            end
    end;
candidate_from_value(Value, URI, Opts) when is_binary(Value) ->
    case try_decode_json(Value) of
        {ok, Decoded} -> candidate_from_decoded(Decoded, URI, Value, Opts);
        _ -> not_found
    end;
candidate_from_value(_Value, _URI, _Opts) ->
    not_found.

candidate_from_decoded(Decoded, URI, Raw, Opts) when is_map(Decoded) ->
    case is_claim_map(Decoded, Opts) of
        true -> {ok, Decoded, Raw};
        false ->
            case claim_from_proxy_map(URI, Decoded, Raw, Opts) of
                {ok, _Claim, _Raw} = Claim -> Claim;
                _ -> not_found
            end
    end;
candidate_from_decoded(_Decoded, _URI, _Raw, _Opts) ->
    not_found.

claim_uri(Base, Req, Opts) ->
    case first_found(
        [
            {Req, <<"uri">>},
            {Req, <<"url">>},
            {Base, <<"uri">>},
            {Base, <<"url">>}
        ],
        Opts
    ) of
        not_found -> uri_from_parts(Base, Req, Opts);
        URI -> normalize_uri(URI)
    end.

uri_from_parts(Base, Req, Opts) ->
    ClaimName =
        first_found(
            [
                {Req, <<"claim-name">>},
                {Req, <<"name">>},
                {Base, <<"claim-name">>},
                {Base, <<"name">>}
            ],
            Opts
        ),
    ClaimID =
        first_found(
            [
                {Req, <<"claim-id">>},
                {Req, <<"claim_id">>},
                {Base, <<"claim-id">>},
                {Base, <<"claim_id">>}
            ],
            Opts
        ),
    case {ClaimName, ClaimID} of
        {Name, ID} when is_binary(Name), is_binary(ID) ->
            {ok, <<"lbry://", Name/binary, "#", ID/binary>>};
        _ ->
            {error, uri_not_found}
    end.

normalize_uri(<<"lbry://", _/binary>> = URI) ->
    {ok, URI};
normalize_uri(URL) when is_binary(URL) ->
    odysee_url_to_lbry_uri(URL);
normalize_uri(_URI) ->
    {error, invalid_uri}.

odysee_url_to_lbry_uri(URL) ->
    Path = maps:get(path, uri_string:parse(URL), <<>>),
    Parts = [Part || Part <- binary:split(Path, <<"/">>, [global]), Part =/= <<>>],
    case Parts of
        [Channel, Claim | _] ->
            {ok,
                <<
                    "lbry://",
                    (colon_to_hash(Channel))/binary,
                    "/",
                    (colon_to_hash(Claim))/binary
                >>};
        [Claim] ->
            {ok, <<"lbry://", (colon_to_hash(Claim))/binary>>};
        _ ->
            {error, invalid_odysee_url}
    end.

colon_to_hash(Part) ->
    case binary:split(Part, <<":">>) of
        [Name, ShortID] -> <<Name/binary, "#", ShortID/binary>>;
        _ -> Part
    end.

resolve_proxy(URI, Base, Req, Opts) ->
    sdk_proxy(<<"resolve">>, #{ <<"urls">> => [URI] }, Base, Req, Opts).

resolve_proxy_many(URIs, Base, Req, Opts) ->
    sdk_proxy(<<"resolve">>, #{ <<"urls">> => URIs }, Base, Req, Opts).

search_proxy(Params, Base, Req, Opts) ->
    sdk_proxy(<<"claim_search">>, Params, Base, Req, Opts).

sdk_proxy(Method, Params, Base, Req, Opts) ->
    Payload = hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"method">> => Method,
        <<"params">> => Params,
        <<"id">> => 1
    }),
    Msg = #{
        <<"method">> => <<"POST">>,
        <<"path">> => proxy_url(Base, Req, Opts),
        <<"content-type">> => <<"application/json">>,
        <<"body">> => Payload
    },
    case hb_http:request(Msg, Opts) of
        {ok, #{ <<"body">> := Body }} when is_binary(Body) -> {ok, Body};
        {ok, Body} when is_binary(Body) -> {ok, Body};
        {ok, Other} -> {error, {proxy_response_without_body, Other}};
        Error -> Error
    end.

search_params(Base, Req, Opts) ->
    hb_cache:ensure_all_loaded(
        maps:with(search_allowed_keys(), maps:merge(map_or_empty(Base), map_or_empty(Req))),
        Opts
    ).

claim_id_search_params(ClaimIDs, Base, Req, Opts) ->
    Params0 = search_params(Base, Req, Opts),
    Page = first_value([<<"page">>], Params0, Opts),
    PageSize = first_value([<<"page_size">>, <<"page-size">>], Params0, Opts),
    NoTotals = first_value([<<"no_totals">>, <<"no-totals">>], Params0, Opts),
    Params1 = Params0#{
        <<"claim_ids">> => ClaimIDs,
        <<"page">> => value_or(Page, 1),
        <<"page_size">> => value_or(PageSize, length(ClaimIDs)),
        <<"no_totals">> => value_or(NoTotals, true)
    },
    maps:without([<<"claim-id">>, <<"claim_id">>, <<"claim-ids">>], Params1).

map_or_empty(Map) when is_map(Map) -> Map;
map_or_empty(_Value) -> #{}.

search_allowed_keys() ->
    [
        <<"all_tags">>,
        <<"any_languages">>,
        <<"any_tags">>,
        <<"channel_ids">>,
        <<"claim_ids">>,
        <<"claim_type">>,
        <<"content_aspect_ratio">>,
        <<"duration">>,
        <<"exclude_shorts">>,
        <<"exclude_shorts_aspect_ratio_lte">>,
        <<"exclude_shorts_duration_lte">>,
        <<"fee_amount">>,
        <<"has_channel_signature">>,
        <<"has_no_source">>,
        <<"has_source">>,
        <<"limit_claims_per_channel">>,
        <<"name">>,
        <<"no_totals">>,
        <<"not_channel_ids">>,
        <<"not_tags">>,
        <<"order_by">>,
        <<"page">>,
        <<"page_size">>,
        <<"release_time">>,
        <<"remove_duplicates">>,
        <<"reposted_claim_id">>,
        <<"stream_types">>,
        <<"valid_channel_signature">>
    ].

proxy_url(Base, Req, Opts) ->
    case first_found(
        [
            {Req, <<"proxy-url">>},
            {Req, <<"proxy_url">>},
            {Base, <<"proxy-url">>},
            {Base, <<"proxy_url">>}
        ],
        Opts
    ) of
        not_found ->
            hb_opts:get(<<"lbry-proxy-url">>, ?DEFAULT_PROXY_URL, Opts);
        URL ->
            URL
    end.

claim_from_proxy(URI, Raw, Opts) ->
    maybe
        {ok, Decoded} ?= try_decode_json(Raw),
        claim_from_proxy_map(URI, Decoded, Raw, Opts)
    end.

claims_from_proxy(URIs, Raw, Opts) ->
    maybe
        {ok, Decoded} ?= try_decode_json(Raw),
        claims_from_proxy_map(URIs, Decoded, Raw, Opts)
    end.

search_from_proxy(Raw, Opts) ->
    maybe
        {ok, Decoded} ?= try_decode_json(Raw),
        search_from_proxy_map(Decoded, Raw, Opts)
    end.

transaction_from_proxy(Raw, Opts) ->
    maybe
        {ok, Decoded} ?= try_decode_json(Raw),
        transaction_from_proxy_map(Decoded, Raw, Opts)
    end.

claim_from_proxy_map(URI, Msg, Raw, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"error">>, Msg, not_found, Opts) of
        not_found -> claim_from_result(URI, Msg, Raw, Opts);
        Error -> {error, {proxy_error, Error}}
    end;
claim_from_proxy_map(_URI, _Msg, _Raw, _Opts) ->
    {error, invalid_proxy_response}.

search_from_proxy_map(Msg, Raw, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"error">>, Msg, not_found, Opts) of
        not_found -> search_from_result(Msg, Raw, Opts);
        Error -> {error, {proxy_error, Error}}
    end;
search_from_proxy_map(_Msg, _Raw, _Opts) ->
    {error, invalid_proxy_response}.

transaction_from_proxy_map(Msg, Raw, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"error">>, Msg, not_found, Opts) of
        not_found -> transaction_from_result(Msg, Raw, Opts);
        Error -> {error, {proxy_error, Error}}
    end;
transaction_from_proxy_map(_Msg, _Raw, _Opts) ->
    {error, invalid_proxy_response}.

claims_from_proxy_map(URIs, Msg, _Raw, Opts) when is_map(Msg) ->
    case hb_maps:get(<<"error">>, Msg, not_found, Opts) of
        not_found ->
            Result = hb_maps:get(<<"result">>, Msg, Msg, Opts),
            case is_map(Result) of
                true ->
                    Claims =
                        lists:filtermap(
                            fun(URI) ->
                                case hb_maps:get(URI, Result, not_found, Opts) of
                                    not_found -> false;
                                    Claim -> {true, {URI, Claim}}
                                end
                            end,
                            URIs
                        ),
                    {ok, maps:from_list(Claims)};
                false ->
                    {error, invalid_proxy_response}
            end;
        Error ->
            {error, {proxy_error, Error}}
    end;
claims_from_proxy_map(_URIs, _Msg, _Raw, _Opts) ->
    {error, invalid_proxy_response}.

search_from_result(Msg, Raw, Opts) ->
    Result = hb_maps:get(<<"result">>, Msg, Msg, Opts),
    case is_search_result(Result, Opts) of
        true -> {ok, Result, Raw};
        false -> {error, invalid_search_result}
    end.

transaction_from_result(Msg, Raw, Opts) ->
    Result = hb_maps:get(<<"result">>, Msg, Msg, Opts),
    case is_transaction_result(Result, Opts) of
        true -> {ok, Result, Raw};
        false -> {error, invalid_transaction_result}
    end.

claim_from_result(URI, Msg, Raw, Opts) ->
    Result = hb_maps:get(<<"result">>, Msg, Msg, Opts),
    case is_claim_map(Result, Opts) of
        true -> {ok, Result, Raw};
        false -> select_claim_result(URI, Result, Raw, Opts)
    end.

select_claim_result(URI, Result, Raw, Opts) when is_map(Result), is_binary(URI) ->
    case hb_maps:get(URI, Result, not_found, Opts) of
        not_found -> select_single_claim(Result, Raw, Opts);
        Claim -> normalize_result_claim(Claim, Raw, Opts)
    end;
select_claim_result(_URI, Result, Raw, Opts) when is_map(Result) ->
    select_single_claim(Result, Raw, Opts);
select_claim_result(_URI, _Result, _Raw, _Opts) ->
    {error, claim_not_found}.

select_single_claim(Result, Raw, Opts) ->
    Claims =
        [
            Claim
        ||
            {_Key, Claim} <- maps:to_list(Result),
            is_map(Claim),
            is_claim_map(Claim, Opts)
        ],
    case Claims of
        [Claim] -> {ok, Claim, Raw};
        [] -> {error, claim_not_found};
        _ -> {error, ambiguous_claim_result}
    end.

normalize_result_claim(Claim, Raw, Opts) when is_map(Claim) ->
    case is_claim_map(Claim, Opts) of
        true -> {ok, Claim, Raw};
        false ->
            case hb_maps:get(<<"error">>, Claim, not_found, Opts) of
                not_found -> {error, claim_not_found};
                Error -> {error, {claim_resolve_failed, Error}}
            end
    end;
normalize_result_claim(_Claim, _Raw, _Opts) ->
    {error, claim_not_found}.

normalize_claim(Claim, Raw, Opts) ->
    maybe
        {ok, ClaimID} ?= required_first([<<"claim_id">>, <<"claim-id">>], Claim, Opts),
        {ok, ClaimName} ?= required_first([<<"name">>, <<"claim-name">>], Claim, Opts),
        {ok, Value} ?= required_first([<<"value">>], Claim, Opts),
        CanonicalURL =
            first_value(
                [
                    <<"canonical_url">>,
                    <<"canonical-url">>,
                    <<"permanent_url">>,
                    <<"permanent-url">>,
                    <<"short_url">>,
                    <<"short-url">>
                ],
                Claim,
                Opts
            ),
        ValueType = first_value([<<"value_type">>, <<"value-type">>], Claim, Opts),
        base_claim_message(Claim, Raw, ClaimID, ClaimName, Value, CanonicalURL, ValueType, Opts)
    end.

normalize_search_result(Result, Raw, Opts) ->
    Items = search_items(Result, Opts),
    Claims = normalize_search_claims(Items, Raw, Opts),
    ClaimIDs = [hb_maps:get(<<"claim-id">>, Claim, Opts) || Claim <- Claims],
    Msg0 = #{
        <<"device">> => ?DEVICE,
        <<"content-type">> => <<"application/json">>,
        <<"body">> => Raw,
        <<"result">> => Result,
        <<"items">> => Items,
        <<"claims">> => Claims,
        <<"claim-ids">> => ClaimIDs
    },
    Optional = [
        {<<"page">>, first_value([<<"page">>], Result, Opts)},
        {<<"page-size">>, first_value([<<"page_size">>, <<"page-size">>], Result, Opts)},
        {<<"total-items">>, first_value([<<"total_items">>, <<"total-items">>], Result, Opts)},
        {<<"total-pages">>, first_value([<<"total_pages">>, <<"total-pages">>], Result, Opts)}
    ],
    lists:foldl(fun put_if_found_pair/2, Msg0, Optional).

normalize_claim_result_map(Result, Raw, Opts) ->
    Normalized =
        maps:from_list(
            lists:filtermap(
                fun({URI, Claim}) ->
                    case normalize_claim(Claim, Raw, Opts) of
                        Msg when is_map(Msg) -> {true, {URI, Msg}};
                        _ -> false
                    end
                end,
                maps:to_list(Result)
            )
        ),
    #{
        <<"device">> => ?DEVICE,
        <<"content-type">> => <<"application/json">>,
        <<"body">> => Raw,
        <<"result">> => Normalized
    }.

normalize_transaction_result(Result, Raw, Opts) ->
    maybe
        {ok, TxID} ?= required_first([<<"txid">>], Result, Opts),
        {ok, TxHex} ?= required_first([<<"hex">>, <<"tx-hex">>, <<"tx_hex">>], Result, Opts),
        Msg0 = #{
            <<"device">> => ?DEVICE,
            <<"view">> => <<"transaction">>,
            <<"content-type">> => <<"application/json">>,
            <<"body">> => Raw,
            <<"result">> => Result,
            <<"txid">> => TxID,
            <<"tx-hex">> => TxHex
        },
        Optional = [
            {<<"height">>, first_value([<<"height">>], Result, Opts)},
            {<<"inputs">>, first_value([<<"inputs">>], Result, Opts)},
            {<<"outputs">>, first_value([<<"outputs">>], Result, Opts)}
        ],
        lists:foldl(fun put_if_found_pair/2, Msg0, Optional)
    end.

search_items(Result, Opts) when is_map(Result) ->
    case first_value([<<"items">>, <<"claims">>], Result, Opts) of
        Items when is_list(Items) -> Items;
        _ -> []
    end;
search_items(_Result, _Opts) ->
    [].

normalize_search_claims(Items, Raw, Opts) ->
    lists:filtermap(
        fun(Claim) ->
            case normalize_claim(Claim, Raw, Opts) of
                Msg when is_map(Msg) -> {true, Msg};
                _ -> false
            end
        end,
        Items
    ).

base_claim_message(Claim, Raw, ClaimID, ClaimName, Value, CanonicalURL, ValueType, Opts) ->
    Msg0 = #{
        <<"device">> => ?DEVICE,
        <<"content-type">> => <<"application/json">>,
        <<"body">> => Raw,
        <<"claim">> => Claim,
        <<"claim-id">> => ClaimID,
        <<"claim-name">> => ClaimName,
        <<"value">> => Value
    },
    Msg1 = put_if_found(<<"canonical-url">>, CanonicalURL, Msg0),
    Msg2 = put_if_found(<<"value-type">>, ValueType, Msg1),
    Msg3 = put_if_found(<<"claim-store-path">>, claim_store_path(ClaimID), Msg2),
    Optional = [
        {<<"claim-proof-store-path">>, claim_proof_store_path(Claim, Opts)},
        {<<"txid">>, first_value([<<"txid">>], Claim, Opts)},
        {<<"nout">>, first_value([<<"nout">>], Claim, Opts)},
        {<<"height">>, first_value([<<"height">>], Claim, Opts)},
        {<<"claim-op">>, first_value([<<"claim_op">>, <<"claim-op">>], Claim, Opts)}
    ],
    lists:foldl(fun put_if_found_pair/2, Msg3, Optional).

claim_store_path(ClaimID) when is_binary(ClaimID) ->
    <<"odysee/claim-id/", ClaimID/binary>>;
claim_store_path(_ClaimID) ->
    not_found.

claim_proof_store_path(Claim, Opts) ->
    case {first_value([<<"txid">>], Claim, Opts), first_value([<<"nout">>], Claim, Opts)} of
        {TxID, NOut} when is_binary(TxID), is_integer(NOut) orelse is_binary(NOut) ->
            <<"odysee/claim-proof/", TxID/binary, "/", (path_int(NOut))/binary>>;
        _ ->
            not_found
    end.

path_int(Int) when is_integer(Int) ->
    integer_to_binary(Int);
path_int(Bin) when is_binary(Bin) ->
    Bin;
path_int(Value) ->
    hb_util:bin(Value).

is_claim_map(Map, Opts) when is_map(Map) ->
    first_value([<<"claim_id">>, <<"claim-id">>], Map, Opts) =/= not_found
        andalso first_value([<<"value">>], Map, Opts) =/= not_found;
is_claim_map(_Map, _Opts) ->
    false.

is_search_result(Result, Opts) when is_map(Result) ->
    case first_value([<<"items">>, <<"claims">>], Result, Opts) of
        Items when is_list(Items) -> true;
        _ -> false
    end;
is_search_result(_Result, _Opts) ->
    false.

is_transaction_result(Result, Opts) when is_map(Result) ->
    first_value([<<"txid">>], Result, Opts) =/= not_found
        andalso first_value([<<"hex">>, <<"tx-hex">>, <<"tx_hex">>], Result, Opts) =/= not_found;
is_transaction_result(_Result, _Opts) ->
    false.

required_txid(Base, Req, Opts) ->
    case first_found([{Req, <<"txid">>}, {Base, <<"txid">>}], Opts) of
        TxID when is_binary(TxID) -> {ok, TxID};
        _ -> {error, txid_not_found}
    end.

claim_uris(Base, Req, Opts) ->
    case first_value([<<"urls">>, <<"uris">>], Req, Opts) of
        URIs when is_list(URIs) ->
            normalize_uris(URIs);
        _ ->
            case first_value([<<"urls">>, <<"uris">>], Base, Opts) of
                URIs when is_list(URIs) -> normalize_uris(URIs);
                _ -> not_found
            end
    end.

claim_ids(Base, Req, Opts) ->
    case first_value([<<"claim_ids">>, <<"claim-ids">>], Req, Opts) of
        ClaimIDs when is_list(ClaimIDs) ->
            normalize_claim_ids(ClaimIDs);
        _ ->
            case first_value([<<"claim_ids">>, <<"claim-ids">>], Base, Opts) of
                ClaimIDs when is_list(ClaimIDs) -> normalize_claim_ids(ClaimIDs);
                _ -> not_found
            end
    end.

normalize_claim_ids(ClaimIDs) ->
    Normalized = [ClaimID || ClaimID <- ClaimIDs, is_binary(ClaimID), ClaimID =/= <<>>],
    case Normalized of
        [] -> {error, claim_ids_not_found};
        _ -> {ok, Normalized}
    end.

normalize_uris(URIs) ->
    Normalized =
        lists:filtermap(
            fun(URI) ->
                case normalize_uri(URI) of
                    {ok, NormalizedURI} -> {true, NormalizedURI};
                    _ -> false
                end
            end,
            URIs
        ),
    case Normalized of
        [] -> {error, uri_not_found};
        _ -> {ok, Normalized}
    end.

required_first(Keys, Map, Opts) ->
    case first_value(Keys, Map, Opts) of
        not_found -> {error, {missing, hd(Keys)}};
        Value -> {ok, Value}
    end.

first_value([], _Map, _Opts) ->
    not_found;
first_value([Key | Rest], Map, Opts) ->
    case hb_maps:get(Key, Map, not_found, Opts) of
        not_found -> first_value(Rest, Map, Opts);
        Value -> Value
    end.

first_found([], _Opts) ->
    not_found;
first_found([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_found(Rest, Opts);
        Value -> Value
    end;
first_found([_ | Rest], Opts) ->
    first_found(Rest, Opts).

put_if_found(_Key, not_found, Msg) -> Msg;
put_if_found(Key, Value, Msg) -> Msg#{ Key => Value }.

put_if_found_pair({_Key, not_found}, Msg) -> Msg;
put_if_found_pair({Key, Value}, Msg) -> Msg#{ Key => Value }.

value_or(not_found, Fallback) -> Fallback;
value_or(Value, _Fallback) -> Value.

try_decode_json(Raw) ->
    try {ok, hb_json:decode(Raw)}
    catch _:_ -> {error, invalid_json}
    end.

-ifdef(TEST).

resolve_fixture_claim_test() ->
    Claim = target_claim(),
    {ok, Msg} = resolve(#{}, #{ <<"claim">> => Claim }, #{}),
    ?assertEqual(
        <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
        hb_maps:get(<<"claim-id">>, Msg, #{})
    ),
    ?assertEqual(Claim, hb_json:decode(hb_maps:get(<<"body">>, Msg, #{}))).

resolve_proxy_result_test() ->
    URI = <<"lbry://@veritasium#f/why-is-it-so-easy-to-disrupt-gps#3">>,
    Claim = target_claim(),
    Raw = hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"result">> => #{ URI => Claim },
        <<"id">> => 1
    }),
    {ok, Msg} = resolve(#{}, #{ <<"uri">> => URI, <<"body">> => Raw }, #{}),
    ?assertEqual(
        <<"why-is-it-so-easy-to-disrupt-gps">>,
        hb_maps:get(<<"claim-name">>, Msg, #{})
    ),
    ?assertEqual(<<"stream">>, hb_maps:get(<<"value-type">>, Msg, #{})).

resolve_proxy_batch_result_test() ->
    URI1 = <<"lbry://@veritasium#f/why-is-it-so-easy-to-disrupt-gps#3">>,
    URI2 = <<"lbry://@lbry#3fda836a92faaceedfe398225fb9b2ee2ed1f01a">>,
    Claim1 = target_claim(),
    Claim2 = (target_claim())#{ <<"claim_id">> => <<"3fda836a92faaceedfe398225fb9b2ee2ed1f01a">> },
    Raw = hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"result">> => #{ URI1 => Claim1, URI2 => Claim2 },
        <<"id">> => 1
    }),
    {ok, Msg} = resolve(#{}, #{ <<"urls">> => [URI1, URI2], <<"body">> => Raw }, #{}),
    Result = hb_maps:get(<<"result">>, Msg, #{}),
    ?assertEqual(2, maps:size(Result)),
    ?assertEqual(
        <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
        hb_maps:get(<<"claim-id">>, hb_maps:get(URI1, Result, #{}), #{})
    ),
    ?assertEqual(
        <<"3fda836a92faaceedfe398225fb9b2ee2ed1f01a">>,
        hb_maps:get(<<"claim-id">>, hb_maps:get(URI2, Result, #{}), #{})
    ).

resolve_claim_ids_search_result_test() ->
    Claim = target_claim(),
    Result = #{
        <<"items">> => [Claim],
        <<"page">> => 1,
        <<"page_size">> => 1,
        <<"total_items">> => 1,
        <<"total_pages">> => 1
    },
    Raw = hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"result">> => Result,
        <<"id">> => 1
    }),
    {ok, Msg} = resolve(
        #{},
        #{
            <<"claim_ids">> => [<<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>],
            <<"body">> => Raw
        },
        #{}
    ),
    ?assertEqual(<<"claim-id-resolve">>, hb_maps:get(<<"view">>, Msg, #{})),
    ?assertEqual(
        [<<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>],
        hb_maps:get(<<"claim-ids">>, Msg, #{})
    ),
    ?assertEqual([Claim], hb_maps:get(<<"items">>, Msg, #{})).

search_proxy_result_test() ->
    Claim = target_claim(),
    Result = #{
        <<"items">> => [Claim],
        <<"page">> => 1,
        <<"page_size">> => 1,
        <<"total_items">> => 1,
        <<"total_pages">> => 1
    },
    Raw = hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"result">> => Result,
        <<"id">> => 1
    }),
    {ok, Msg} = search(#{}, #{ <<"body">> => Raw }, #{}),
    ?assertEqual(Result, hb_maps:get(<<"result">>, Msg, #{})),
    ?assertEqual([Claim], hb_maps:get(<<"items">>, Msg, #{})),
    ?assertEqual(
        [<<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>],
        hb_maps:get(<<"claim-ids">>, Msg, #{})
    ),
    ?assertEqual(1, hb_maps:get(<<"total-items">>, Msg, #{})).

search_accepts_supplied_result_test() ->
    Result = #{ <<"items">> => [target_claim()], <<"page">> => 2 },
    {ok, Msg} = search(#{}, #{ <<"result">> => Result }, #{}),
    ?assertEqual(2, hb_maps:get(<<"page">>, Msg, #{})),
    ?assertEqual(1, length(hb_maps:get(<<"claims">>, Msg, #{}))).

transaction_accepts_supplied_result_test() ->
    Result = #{
        <<"txid">> => <<"tx123">>,
        <<"hex">> => <<"0100000000">>,
        <<"height">> => 123
    },
    {ok, Msg} = transaction(#{}, #{ <<"result">> => Result }, #{}),
    ?assertEqual(<<"transaction">>, hb_maps:get(<<"view">>, Msg, #{})),
    ?assertEqual(<<"tx123">>, hb_maps:get(<<"txid">>, Msg, #{})),
    ?assertEqual(<<"0100000000">>, hb_maps:get(<<"tx-hex">>, Msg, #{})),
    ?assertEqual(123, hb_maps:get(<<"height">>, Msg, #{})).

search_params_removes_control_fields_test() ->
    Params = search_params(
        #{
            <<"proxy-url">> => <<"http://proxy">>,
            <<"page">> => 1,
            <<"index">> => 3,
            <<"accept-encoding">> => <<"gzip">>
        },
        #{
            <<"body">> => <<"{}">>,
            <<"origin">> => <<"http://localhost:9090">>,
            <<"sec-gpc">> => <<"1">>,
            <<"auth_token">> => <<"token">>,
            <<"include_is_my_output">> => true,
            <<"claim_type">> => [<<"stream">>]
        },
        #{}
    ),
    ?assertEqual(#{ <<"page">> => 1, <<"claim_type">> => [<<"stream">>] }, Params).

search_params_loads_linked_values_test() ->
    Opts = #{},
    {ok, ChannelIDs} = hb_cache:write([<<"channel-id">>], Opts),
    {ok, ClaimTypes} = hb_cache:write([<<"stream">>, <<"repost">>], Opts),
    {ok, OrderBy} = hb_cache:write([<<"release_time">>], Opts),
    Params = search_params(
        #{},
        #{
            <<"channel_ids">> =>
                {link, ChannelIDs, #{ <<"type">> => <<"link">>, <<"lazy">> => false }},
            <<"claim_type">> =>
                {link, ClaimTypes, #{ <<"type">> => <<"link">>, <<"lazy">> => false }},
            <<"order_by">> =>
                {link, OrderBy, #{ <<"type">> => <<"link">>, <<"lazy">> => false }},
            <<"page">> => 1,
            <<"page_size">> => 20
        },
        Opts
    ),
    ?assertEqual(
        #{
            <<"channel_ids">> => [<<"channel-id">>],
            <<"claim_type">> => [<<"stream">>, <<"repost">>],
            <<"order_by">> => [<<"release_time">>],
            <<"page">> => 1,
            <<"page_size">> => 20
        },
        Params
    ).

odysee_url_to_lbry_uri_test() ->
    ?assertEqual(
        {ok, <<"lbry://@veritasium#f/why-is-it-so-easy-to-disrupt-gps#3">>},
        odysee_url_to_lbry_uri(
            <<"https://odysee.com/@veritasium:f/why-is-it-so-easy-to-disrupt-gps:3">>
        )
    ).

target_claim() ->
    #{
        <<"claim_id">> => <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
        <<"canonical_url">> =>
            <<"lbry://@veritasium#f/why-is-it-so-easy-to-disrupt-gps#3">>,
        <<"name">> => <<"why-is-it-so-easy-to-disrupt-gps">>,
        <<"type">> => <<"claim">>,
        <<"value_type">> => <<"stream">>,
        <<"value">> => #{
            <<"title">> => <<"Why Is It So Easy To Disrupt GPS?">>,
            <<"description">> => <<"Something is disrupting GPS signals across Europe.">>,
            <<"source">> => #{
                <<"hash">> =>
                    <<"81a1fc78a95489d499214616773505d4ca78bb49279a7dafc6aa1b0a546b2eeb6253db951d1d5514388a3c7b57bea647">>,
                <<"media_type">> => <<"video/mp4">>,
                <<"name">> => <<"why-is-it-so-easy-to-disrupt.mp4">>,
                <<"sd_hash">> =>
                    <<"6ee8f762a2eedbd2b5eeade82ca4d0a6287f55db4195563cc52fc004701b7d55edcfad277a5141084bdf5fca3adb403a">>,
                <<"size">> => <<"653610679">>
            },
            <<"stream_type">> => <<"video">>,
            <<"thumbnail">> => #{ <<"url">> => <<"https://thumbnails.lbry.com/tz23G_UXCGA">> },
            <<"video">> => #{
                <<"duration">> => 2056,
                <<"height">> => 1080,
                <<"width">> => 1920
            }
        }
    }.

-endif.
