%%% @doc Odysee channel identity compatibility device.
%%%
%%% This device normalizes channel claims and signing-channel envelopes into an
%%% AO-Core message while preserving the source claim data used for later
%%% comment and stream signature verification.
-module(dev_odysee_channel).
-implements(<<"odysee-channel@1.0">>).
-export([info/1, channel/3, from_claim/3, list/3, channel_list/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

-define(DEVICE, <<"odysee-channel@1.0">>).

%% @doc Return the public device API.
info(_Opts) ->
    #{ exports => [<<"channel">>, <<"from-claim">>, <<"list">>, <<"channel_list">>] }.

%% @doc Resolve/derive a channel identity message.
channel(Base, Req, Opts) ->
    from_claim(Base, Req, Opts).

%% @doc Normalize a channel claim or a stream claim's `signing_channel'.
from_claim(Base, Req, Opts) ->
    safe(fun() ->
        maybe
            {ok, Claim, SourceClaim} ?= ensure_channel_claim(Base, Req, Opts),
            ok_message(normalize_channel(Claim, SourceClaim, Opts))
        else
            Error -> Error
        end
    end).

list(Base, Req, Opts) ->
    safe(fun() ->
        Params = request_params(Base, Req, Opts),
        Identity = identity(Base, Req, Opts),
        Channels0 = channel_items_from_identity(Identity, Base, Req, Opts),
        Channels1 =
            case Channels0 of
                [] -> channel_items_from_params(Params, Base, Req, Opts);
                _ -> Channels0
            end,
        case Channels1 of
            {error, _Reason} = Error -> Error;
            _ -> ok_message(channel_list_result(Channels1, Params, Opts))
        end
    end).

channel_list(Base, Req, Opts) ->
    list(Base, Req, Opts).

safe(Fun) ->
    try Fun() of
        Res -> Res
    catch
        _:{error, Reason} -> {error, Reason};
        _:Reason -> {error, Reason}
    end.

ok_message(Msg) when is_map(Msg) -> {ok, Msg};
ok_message(Error) -> Error.

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

identity(Base, Req, Opts) ->
    case hb_ao:raw(<<"odysee-legacy-auth@1.0">>, <<"identify">>, Base, Req, Opts) of
        {ok, Identity} when is_map(Identity) -> Identity;
        _ -> #{}
    end.

channel_items_from_identity(Identity, Base, Req, Opts) ->
    User = hb_maps:get(<<"legacy-user">>, Identity, #{}, Opts),
    Direct = channel_values_from_sources([Identity, User], Opts),
    case channel_claims_from_values(Direct, Opts) of
        [] ->
            case channel_ids_from_sources([Identity, User], Opts) of
                [] -> [];
                ChannelIDs -> channel_claims_by_ids(ChannelIDs, Base, Req, Opts)
            end;
        Items ->
            Items
    end.

channel_items_from_params(Params, Base, Req, Opts) ->
    Direct = channel_values_from_sources([Params], Opts),
    case channel_claims_from_values(Direct, Opts) of
        [] ->
            case channel_ids_from_sources([Params], Opts) of
                [] -> proxy_channel_list(Params, Base, Req, Opts);
                ChannelIDs -> channel_claims_by_ids(ChannelIDs, Base, Req, Opts)
            end;
        Items ->
            Items
    end.

channel_values_from_sources(Sources, Opts) ->
    lists:append([channel_values_from_source(Source, Opts) || Source <- Sources]).

channel_values_from_source(Source, Opts) when is_map(Source) ->
    lists:append([
        value_list_raw(first_value([Key], Source, Opts))
    ||
        Key <- [
            <<"channels">>,
            <<"channel_claims">>,
            <<"channel-claims">>,
            <<"items">>,
            <<"claims">>
        ]
    ]);
channel_values_from_source(_Source, _Opts) ->
    [].

value_list_raw(not_found) ->
    [];
value_list_raw(Values) when is_list(Values) ->
    Values;
value_list_raw(Value) ->
    [Value].

channel_claims_from_values(Values, Opts) ->
    lists:filtermap(
        fun(Value) ->
            case channel_claim_from_value(Value, Opts) of
                {ok, Claim} -> {true, ensure_channel_list_claim(Claim, Opts)};
                not_found -> false
            end
        end,
        Values
    ).

channel_claim_from_value(Value, Opts) when is_map(Value) ->
    Candidates = [
        Value,
        hb_maps:get(<<"claim">>, Value, not_found, Opts),
        hb_maps:get(<<"channel">>, Value, not_found, Opts),
        hb_maps:get(<<"claim_info">>, Value, not_found, Opts),
        hb_maps:get(<<"claim-info">>, Value, not_found, Opts)
    ],
    find_in_list(fun(Candidate) -> channel_claim_candidate(Candidate, Opts) end, Candidates);
channel_claim_from_value(_Value, _Opts) ->
    not_found.

channel_claim_candidate(not_found, _Opts) ->
    not_found;
channel_claim_candidate(Value, Opts) when is_map(Value) ->
    case first_value([<<"claim_id">>, <<"claim-id">>, <<"claimId">>], Value, Opts) of
        not_found -> not_found;
        ClaimID0 ->
            ClaimID = hb_util:bin(ClaimID0),
            Name = first_value([<<"name">>, <<"claim-name">>, <<"claim_name">>], Value, Opts),
            ClaimName =
                case Name of
                    not_found -> <<"@", ClaimID/binary>>;
                    _ -> hb_util:bin(Name)
                end,
            {ok, Value#{
                <<"claim_id">> => ClaimID,
                <<"name">> => ClaimName,
                <<"value_type">> => <<"channel">>,
                <<"value">> => channel_value(Value, ClaimName, Opts)
            }}
    end;
channel_claim_candidate(_Value, _Opts) ->
    not_found.

channel_value(Value, ClaimName, Opts) ->
    Value0 = hb_maps:get(<<"value">>, Value, #{}, Opts),
    Existing = map_or_empty(Value0),
    Title = first_found([
        {Existing, <<"title">>},
        {Value, <<"title">>},
        {Value, <<"display_name">>},
        {Value, <<"display-name">>},
        {Value, <<"name">>}
    ], Opts),
    Description = first_found([{Existing, <<"description">>}, {Value, <<"description">>}], Opts),
    Thumbnail = first_found([
        {Existing, <<"thumbnail">>},
        {Value, <<"thumbnail">>},
        {Value, <<"thumbnail_url">>},
        {Value, <<"thumbnail-url">>}
    ], Opts),
    PublicKey = first_found([
        {Existing, <<"public_key">>},
        {Existing, <<"public-key">>},
        {Value, <<"public_key">>},
        {Value, <<"public-key">>}
    ], Opts),
    put_optional_pairs(Existing#{
        <<"title">> => title_or_name(Title, ClaimName)
    }, [
        {<<"description">>, Description},
        {<<"thumbnail">>, thumbnail_value(Thumbnail)},
        {<<"public_key">>, PublicKey},
        {<<"public_key_id">>, first_found([{Existing, <<"public_key_id">>}, {Value, <<"public_key_id">>}], Opts)}
    ]).

title_or_name(not_found, ClaimName) ->
    ClaimName;
title_or_name(Title, _ClaimName) ->
    Title.

thumbnail_value(not_found) ->
    not_found;
thumbnail_value(Thumbnail = #{}) ->
    Thumbnail;
thumbnail_value(Thumbnail) ->
    #{ <<"url">> => hb_util:bin(Thumbnail) }.

ensure_channel_list_claim(Claim, Opts) ->
    ClaimID = hb_util:bin(hb_maps:get(<<"claim_id">>, Claim, <<>>, Opts)),
    DefaultName = <<"@", ClaimID/binary>>,
    Name = hb_util:bin(hb_maps:get(<<"name">>, Claim, DefaultName, Opts)),
    Canonical = first_value([<<"canonical_url">>, <<"canonical-url">>, <<"permanent_url">>, <<"permanent-url">>], Claim, Opts),
    URL =
        case Canonical of
            not_found -> <<"lbry://", Name/binary, "#", (short_id(ClaimID))/binary>>;
            Value -> Value
        end,
    Meta = maps:merge(
        #{
            <<"claims_in_channel">> => 0,
            <<"effective_amount">> => <<"0">>
        },
        map_or_empty(hb_maps:get(<<"meta">>, Claim, #{}, Opts))
    ),
    Claim#{
        <<"canonical_url">> => URL,
        <<"permanent_url">> => first_value_or([<<"permanent_url">>, <<"permanent-url">>], Claim, URL, Opts),
        <<"short_url">> => first_value_or([<<"short_url">>, <<"short-url">>], Claim, URL, Opts),
        <<"meta">> => Meta,
        <<"confirmations">> => int_or_default(first_value([<<"confirmations">>], Claim, Opts), 1),
        <<"is_my_output">> => true
    }.

short_id(ClaimID) when byte_size(ClaimID) >= 1 ->
    binary:part(ClaimID, 0, min(1, byte_size(ClaimID)));
short_id(_ClaimID) ->
    <<"0">>.

first_value_or(Keys, Map, Default, Opts) ->
    case first_value(Keys, Map, Opts) of
        not_found -> Default;
        Value -> Value
    end.

channel_ids_from_sources(Sources, Opts) ->
    lists:usort(lists:append([channel_ids_from_source(Source, Opts) || Source <- Sources])).

channel_ids_from_source(Source, Opts) when is_map(Source) ->
    value_list(first_value([
        <<"channel_claim_ids">>,
        <<"channel-claim-ids">>,
        <<"channel_claim_id">>,
        <<"channel-claim-id">>,
        <<"claim_ids">>,
        <<"claim-ids">>,
        <<"claim_id">>,
        <<"claim-id">>,
        <<"default_channel_claim_id">>,
        <<"primary_channel_claim_id">>
    ], Source, Opts));
channel_ids_from_source(_Source, _Opts) ->
    [].

channel_claims_by_ids([], _Base, _Req, _Opts) ->
    [];
channel_claims_by_ids(ChannelIDs, Base, Req, Opts) ->
    PageSize = length(ChannelIDs),
    SearchReq = maps:merge(Req, #{
        <<"claim_ids">> => ChannelIDs,
        <<"claim_type">> => [<<"channel">>],
        <<"page">> => 1,
        <<"page_size">> => PageSize
    }),
    case hb_ao:raw(<<"odysee-claim@1.0">>, <<"search">>, Base, SearchReq, Opts) of
        {ok, Msg} ->
            [ensure_channel_list_claim(Item, Opts) || Item <- search_items(Msg, Opts)];
        _ ->
            []
    end.

search_items(Msg, Opts) ->
    case hb_maps:get(<<"items">>, Msg, not_found, Opts) of
        Items when is_list(Items) ->
            Items;
        _ ->
            case hb_maps:get(<<"result">>, Msg, #{}, Opts) of
                Result when is_map(Result) ->
                    case first_value([<<"items">>, <<"claims">>], Result, Opts) of
                        Items when is_list(Items) -> Items;
                        _ -> []
                    end;
                _ ->
                    []
            end
    end.

proxy_channel_list(Params, Base, Req, Opts) ->
    Payload = hb_json:encode(#{
        <<"jsonrpc">> => <<"2.0">>,
        <<"method">> => <<"channel_list">>,
        <<"params">> => proxy_channel_list_params(Params, Opts),
        <<"id">> => 1
    }),
    Msg0 = #{
        <<"method">> => <<"POST">>,
        <<"path">> => proxy_url(Base, Req, Opts),
        <<"content-type">> => <<"application/json">>,
        <<"body">> => Payload
    },
    Msg =
        case legacy_auth_token(Params, Base, Req, Opts) of
            not_found -> Msg0;
            Token -> Msg0#{ <<"x-lbry-auth-token">> => Token }
        end,
    case hb_http:request(Msg, Opts) of
        {ok, #{ <<"body">> := Body }} when is_binary(Body) -> channel_items_from_proxy_body(Body, Params, Opts);
        {ok, Body} when is_binary(Body) -> channel_items_from_proxy_body(Body, Params, Opts);
        _ -> []
    end.

proxy_channel_list_params(Params, Opts) ->
    lists:foldl(
        fun(Key, Acc) ->
            case hb_maps:get(Key, Params, not_found, Opts) of
                not_found -> Acc;
                Value -> Acc#{ Key => Value }
            end
        end,
        #{},
        proxy_channel_list_param_keys()
    ).

proxy_channel_list_param_keys() ->
    [
        <<"page">>,
        <<"page_size">>,
        <<"page-size">>,
        <<"resolve">>,
        <<"claim_ids">>,
        <<"claim-ids">>,
        <<"claim_id">>,
        <<"claim-id">>,
        <<"channel_ids">>,
        <<"channel-ids">>,
        <<"channel_id">>,
        <<"channel-id">>,
        <<"wallet_id">>,
        <<"wallet-id">>,
        <<"account_id">>,
        <<"account-id">>,
        <<"is_controlling">>,
        <<"is-controlling">>,
        <<"include_purchase_receipt">>,
        <<"include-purchase-receipt">>,
        <<"include_is_my_output">>,
        <<"include-is-my-output">>,
        <<"no_totals">>,
        <<"no-totals">>,
        <<"order_by">>,
        <<"order-by">>
    ].

legacy_auth_token(Params, Base, Req, Opts) ->
    case first_found(
        [
            {Params, <<"auth_token">>},
            {Params, <<"auth-token">>},
            {Params, <<"x-lbry-auth-token">>},
            {Params, <<"X-Lbry-Auth-Token">>},
            {Params, <<"x-odysee-demo-auth-token">>},
            {Params, <<"X-Odysee-Demo-Auth-Token">>},
            {Params, <<"authorization">>},
            {Params, <<"Authorization">>},
            {Req, <<"auth_token">>},
            {Req, <<"auth-token">>},
            {Req, <<"x-lbry-auth-token">>},
            {Req, <<"X-Lbry-Auth-Token">>},
            {Req, <<"x-odysee-demo-auth-token">>},
            {Req, <<"X-Odysee-Demo-Auth-Token">>},
            {Req, <<"authorization">>},
            {Req, <<"Authorization">>},
            {Base, <<"auth_token">>},
            {Base, <<"auth-token">>},
            {Base, <<"x-lbry-auth-token">>},
            {Base, <<"X-Lbry-Auth-Token">>},
            {Base, <<"x-odysee-demo-auth-token">>},
            {Base, <<"X-Odysee-Demo-Auth-Token">>},
            {Base, <<"authorization">>},
            {Base, <<"Authorization">>}
        ],
        Opts
    ) of
        not_found -> not_found;
        Token -> auth_token_value(Token)
    end.

auth_token_value(Token0) ->
    Token = trim(hb_util:bin(Token0)),
    Parts = binary:split(Token, <<" ">>),
    case Parts of
        [Scheme, Value] ->
            case hb_util:to_lower(Scheme) of
                <<"bearer">> -> trim(Value);
                _ -> token_param_value(Token)
            end;
        _ ->
            token_param_value(Token)
    end.

token_param_value(Token) ->
    case binary:split(Token, <<"auth_token=">>) of
        [_Prefix, Value] -> trim(strip_token_suffix(Value));
        _ -> Token
    end.

strip_token_suffix(Value) ->
    case binary:split(Value, <<"&">>) of
        [Token, _Rest] -> Token;
        _ -> Value
    end.

channel_items_from_proxy_body(Body, Params, Opts) ->
    case try_decode_json(Body) of
        {ok, Msg} when is_map(Msg) ->
            case hb_maps:get(<<"error">>, Msg, not_found, Opts) of
                not_found ->
                    Result = hb_maps:get(<<"result">>, Msg, Msg, Opts),
                    Items = [ensure_channel_list_claim(Item, Opts) || Item <- search_items(Result, Opts)],
                    case {Items, debug_proxy_response(Params, Opts)} of
                        {[], true} -> {error, proxy_response_debug(Msg, Result, Body, Opts)};
                        _ -> Items
                    end;
                Error ->
                    {error, legacy_channel_list_error(Error, Opts)}
            end;
        _ ->
            case debug_proxy_response(Params, Opts) of
                true ->
                    {error, #{
                        <<"message">> => <<"legacy channel_list returned invalid JSON">>,
                        <<"body_size">> => byte_size(Body)
                    }};
                false ->
                    []
            end
    end.

debug_proxy_response(Params, Opts) ->
    case hb_maps:get(<<"debug_proxy">>, Params, false, Opts) of
        true -> true;
        <<"true">> -> true;
        <<"1">> -> true;
        1 -> true;
        _ -> false
    end.

proxy_response_debug(Msg, Result, Body, Opts) ->
    #{
        <<"message">> => <<"legacy channel_list returned no items">>,
        <<"body_size">> => byte_size(Body),
        <<"top_level_keys">> => maps:keys(Msg),
        <<"result_keys">> => result_keys(Result),
        <<"result_total_items">> => hb_maps:get(<<"total_items">>, Result, not_found, Opts),
        <<"result_error">> => sanitized_result_error(Result, Opts)
    }.

result_keys(Result) when is_map(Result) ->
    maps:keys(Result);
result_keys(_Result) ->
    [].

sanitized_result_error(Result, Opts) when is_map(Result) ->
    case hb_maps:get(<<"error">>, Result, not_found, Opts) of
        not_found -> not_found;
        Error -> legacy_channel_list_error(Error, Opts)
    end;
sanitized_result_error(_Result, _Opts) ->
    not_found.

legacy_channel_list_error(Error, Opts) when is_map(Error) ->
    #{
        <<"code">> => hb_maps:get(<<"code">>, Error, not_found, Opts),
        <<"message">> => hb_maps:get(<<"message">>, Error, <<"legacy channel_list failed">>, Opts)
    };
legacy_channel_list_error(Error, _Opts) ->
    #{ <<"message">> => hb_util:bin(Error) }.

proxy_url(Base, Req, Opts) ->
    case first_found([{Req, <<"proxy-url">>}, {Req, <<"proxy_url">>}, {Base, <<"proxy-url">>}, {Base, <<"proxy_url">>}], Opts) of
        not_found -> hb_opts:get(<<"lbry-proxy-url">>, <<"https://api.na-backend.odysee.com/api/v1/proxy">>, Opts);
        URL -> URL
    end.

request_reserved_keys() ->
    [
        <<"auth-token">>,
        <<"auth_token">>,
        <<"authorization">>,
        <<"accept">>,
        <<"accept-bundle">>,
        <<"accept-encoding">>,
        <<"accept-language">>,
        <<"access-control-request-headers">>,
        <<"access-control-request-method">>,
        <<"ao-peer">>,
        <<"ao-peer-port">>,
        <<"ao-types">>,
        <<"body">>,
        <<"cache-control">>,
        <<"codec-device">>,
        <<"commitments">>,
        <<"connection">>,
        <<"content-length">>,
        <<"content-type">>,
        <<"debug_proxy">>,
        <<"device">>,
        <<"host">>,
        <<"legacy-auth-path">>,
        <<"legacy-auth-proof">>,
        <<"legacy-user-id">>,
        <<"method">>,
        <<"origin">>,
        <<"params64">>,
        <<"params-64">>,
        <<"path">>,
        <<"priv">>,
        <<"referer">>,
        <<"sec-fetch-dest">>,
        <<"sec-fetch-mode">>,
        <<"sec-fetch-site">>,
        <<"secret">>,
        <<"signature">>,
        <<"status">>,
        <<"user-agent">>,
        <<"x-forwarded-for">>,
        <<"x-lbry-auth-token">>,
        <<"X-Lbry-Auth-Token">>,
        <<"x-odysee-demo-auth-token">>,
        <<"X-Odysee-Demo-Auth-Token">>,
        <<"x-real-ip">>
    ].

channel_list_result(Items0, Params, Opts) ->
    Page = max(1, int_or_default(first_value([<<"page">>], Params, Opts), 1)),
    PageSize = max(1, int_or_default(first_value([<<"page_size">>, <<"page-size">>], Params, Opts), 99999)),
    Items = [ensure_channel_list_claim(Item, Opts) || Item <- Items0],
    TotalItems = length(Items),
    #{
        <<"device">> => ?DEVICE,
        <<"content-type">> => <<"application/json">>,
        <<"items">> => page_slice(Items, Page, PageSize),
        <<"result">> => #{
            <<"items">> => page_slice(Items, Page, PageSize),
            <<"page">> => Page,
            <<"page_size">> => PageSize,
            <<"total_items">> => TotalItems,
            <<"total_pages">> => total_pages(TotalItems, PageSize)
        },
        <<"body">> => hb_json:encode(#{
            <<"items">> => page_slice(Items, Page, PageSize),
            <<"page">> => Page,
            <<"page_size">> => PageSize,
            <<"total_items">> => TotalItems,
            <<"total_pages">> => total_pages(TotalItems, PageSize)
        })
    }.

page_slice(Items, Page, PageSize) ->
    Start = (Page - 1) * PageSize,
    lists:sublist(lists:nthtail(min(Start, length(Items)), Items), PageSize).

total_pages(0, _PageSize) ->
    0;
total_pages(TotalItems, PageSize) ->
    (TotalItems + PageSize - 1) div PageSize.

ensure_channel_claim(Base, Req, Opts) ->
    case channel_candidate(Base, Req, Opts) of
        {ok, _Claim, _SourceClaim} = Channel ->
            Channel;
        not_found ->
            case hb_ao:raw(<<"odysee-claim@1.0">>, <<"resolve">>, Base, Req, Opts) of
                {ok, ClaimMsg} ->
                    case candidate_from_value(ClaimMsg, Opts) of
                        {ok, _Claim, _SourceClaim} = Channel -> Channel;
                        not_found -> {error, channel_not_found}
                    end;
                Error ->
                    Error
            end
    end.

channel_candidate(Base, Req, Opts) ->
    Candidates = [
        {Req, <<"channel">>},
        {Req, <<"signing-channel">>},
        {Req, <<"signing_channel">>},
        {Req, <<"claim">>},
        {Req, <<"source">>},
        {Req, <<"body">>},
        {Base, <<"channel">>},
        {Base, <<"signing-channel">>},
        {Base, <<"signing_channel">>},
        {Base, <<"claim">>},
        {Base, <<"source">>},
        {Base, <<"body">>}
    ],
    case candidate_from_value(Base, Opts) of
        {ok, _Claim, _SourceClaim} = Channel -> Channel;
        not_found -> candidate_from_fields(Candidates, Opts)
    end.

candidate_from_fields([], _Opts) ->
    not_found;
candidate_from_fields([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> candidate_from_fields(Rest, Opts);
        Value ->
            case candidate_from_value(Value, Opts) of
                {ok, _Claim, _SourceClaim} = Channel -> Channel;
                not_found -> candidate_from_fields(Rest, Opts)
            end
    end;
candidate_from_fields([_ | Rest], Opts) ->
    candidate_from_fields(Rest, Opts).

candidate_from_value(Value, Opts) when is_binary(Value) ->
    case try_decode_json(Value) of
        {ok, Decoded} -> candidate_from_value(Decoded, Opts);
        _ -> not_found
    end;
candidate_from_value(Value, Opts) when is_map(Value) ->
    Claim = hb_maps:get(<<"claim">>, Value, Value, Opts),
    case channel_from_claim(Claim, Opts) of
        {ok, Channel} ->
            {ok, Channel, Claim};
        not_found ->
            case signing_channel_from_claim(Claim, Opts) of
                {ok, Channel} -> {ok, Channel, Claim};
                not_found -> not_found
            end
    end;
candidate_from_value(_Value, _Opts) ->
    not_found.

channel_from_claim(Claim, Opts) when is_map(Claim) ->
    case value_type(Claim, Opts) of
        <<"channel">> -> {ok, Claim};
        not_found ->
            case has_channel_public_key(Claim, Opts) of
                true -> {ok, Claim};
                false -> not_found
            end;
        _ -> not_found
    end;
channel_from_claim(_Claim, _Opts) ->
    not_found.

signing_channel_from_claim(Claim, Opts) when is_map(Claim) ->
    case first_value([<<"signing_channel">>, <<"signing-channel">>], Claim, Opts) of
        Channel when is_map(Channel) -> {ok, Channel};
        _ -> not_found
    end;
signing_channel_from_claim(_Claim, _Opts) ->
    not_found.

normalize_channel(Claim, SourceClaim, Opts) ->
    maybe
        {ok, ClaimID} ?= required_first([<<"claim_id">>, <<"claim-id">>], Claim, Opts),
        {ok, ClaimName} ?= required_first([<<"name">>, <<"claim-name">>], Claim, Opts),
        {ok, Value} ?= required(<<"value">>, Claim, Opts),
        PublicKey = first_value([<<"public_key">>, <<"public-key">>], Value, Opts),
        Msg0 = #{
            <<"device">> => ?DEVICE,
            <<"content-type">> => <<"application/json">>,
            <<"body">> => hb_json:encode(Claim),
            <<"claim">> => Claim,
            <<"value">> => Value,
            <<"claim-id">> => ClaimID,
            <<"channel-id">> => ClaimID,
            <<"claim-name">> => ClaimName,
            <<"channel-name">> => ClaimName,
            <<"claim-store-path">> => <<"odysee/claim-id/", ClaimID/binary>>,
            <<"channel-store-path">> => <<"odysee/channel/", ClaimID/binary>>,
            <<"identity-type">> => <<"channel">>
        },
        Msg1 =
            case SourceClaim =:= Claim of
                true -> Msg0;
                false -> Msg0#{ <<"source-claim">> => SourceClaim }
            end,
        Optional = [
            {<<"value-type">>, value_type(Claim, Opts)},
            {<<"canonical-url">>, canonical_url(Claim, Opts)},
            {<<"permanent-url">>, first_value([<<"permanent_url">>, <<"permanent-url">>], Claim, Opts)},
            {<<"short-url">>, first_value([<<"short_url">>, <<"short-url">>], Claim, Opts)},
            {<<"title">>, first_value([<<"title">>], Value, Opts)},
            {<<"description">>, first_value([<<"description">>], Value, Opts)},
            {<<"thumbnail">>, thumbnail_url(Value, Opts)},
            {<<"tags">>, first_value([<<"tags">>], Value, Opts)},
            {<<"languages">>, first_value([<<"languages">>], Value, Opts)},
            {<<"public-key">>, PublicKey},
            {<<"public-key-id">>, first_value([<<"public_key_id">>, <<"public-key-id">>], Value, Opts)},
            {<<"signature-valid">>, first_value([<<"signature_valid">>, <<"signature-valid">>], SourceClaim, Opts)},
            {<<"committer-format">>, public_key_format(PublicKey)},
            {<<"ao-committer">>, PublicKey},
            {<<"claim-proof-store-path">>, claim_proof_store_path(Claim, Opts)},
            {<<"txid">>, first_value([<<"txid">>], Claim, Opts)},
            {<<"nout">>, first_value([<<"nout">>], Claim, Opts)},
            {<<"height">>, first_value([<<"height">>], Claim, Opts)},
            {<<"claim-op">>, first_value([<<"claim_op">>, <<"claim-op">>], Claim, Opts)}
        ],
        lists:foldl(fun put_optional/2, Msg1, Optional)
    end.

required(Key, Map, Opts) ->
    case hb_maps:get(Key, Map, not_found, Opts) of
        not_found -> {error, {missing, Key}};
        Value -> {ok, Value}
    end.

required_first(Keys, Map, Opts) ->
    case first_value(Keys, Map, Opts) of
        not_found -> {error, {missing, hd(Keys)}};
        Value -> {ok, Value}
    end.

value_type(Claim, Opts) ->
    first_value([<<"value_type">>, <<"value-type">>], Claim, Opts).

canonical_url(Claim, Opts) ->
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
    ).

has_channel_public_key(Claim, Opts) ->
    case hb_maps:get(<<"value">>, Claim, not_found, Opts) of
        Value when is_map(Value) ->
            first_value([<<"public_key">>, <<"public-key">>], Value, Opts) =/= not_found;
        _ ->
            false
    end.

thumbnail_url(Value, Opts) ->
    case first_value([<<"thumbnail">>], Value, Opts) of
        Thumbnail when is_map(Thumbnail) -> first_value([<<"url">>], Thumbnail, Opts);
        Other -> Other
    end.

public_key_format(not_found) -> not_found;
public_key_format(_PublicKey) -> <<"lbry-channel-public-key">>.

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
    Bin.

first_value([], _Map, _Opts) ->
    not_found;
first_value([Key | Rest], Map, Opts) when is_map(Map) ->
    case hb_maps:get(Key, Map, not_found, Opts) of
        not_found -> first_value(Rest, Map, Opts);
        Value -> Value
    end;
first_value(_Keys, _Map, _Opts) ->
    not_found.

first_found([], _Opts) ->
    not_found;
first_found([{Msg, Key} | Rest], Opts) when is_map(Msg) ->
    case hb_maps:get(Key, Msg, not_found, Opts) of
        not_found -> first_found(Rest, Opts);
        Value -> Value
    end;
first_found([_ | Rest], Opts) ->
    first_found(Rest, Opts).

find_in_list(_Fun, []) ->
    not_found;
find_in_list(Fun, [Item | Rest]) ->
    case Fun(Item) of
        not_found -> find_in_list(Fun, Rest);
        Result -> Result
    end.

value_list(not_found) ->
    [];
value_list(Values) when is_list(Values) ->
    [hb_util:bin(Value) || Value <- Values, hb_util:bin(Value) =/= <<>>];
value_list(Value) when is_binary(Value) ->
    [trim(Part) || Part <- binary:split(Value, <<",">>, [global]), trim(Part) =/= <<>>];
value_list(Value) ->
    value_list(hb_util:bin(Value)).

int_or_default(not_found, Default) ->
    Default;
int_or_default(Value, _Default) when is_integer(Value) ->
    Value;
int_or_default(Value, Default) ->
    try binary_to_integer(hb_util:bin(Value)) of
        Int -> Int
    catch
        _:_ -> Default
    end.

trim(Bin) ->
    iolist_to_binary(string:trim(binary_to_list(Bin))).

put_optional_pairs(Msg, Pairs) ->
    lists:foldl(fun put_optional/2, Msg, Pairs).

put_optional({_Key, not_found}, Msg) -> Msg;
put_optional({Key, Value}, Msg) -> Msg#{ Key => Value }.

try_decode_json(Raw) ->
    try {ok, hb_json:decode(Raw)}
    catch _:_ -> {error, invalid_json}
    end.

-ifdef(TEST).

channel_from_direct_claim_test() ->
    Claim = channel_claim(),
    {ok, Msg} = channel(#{}, #{ <<"claim">> => Claim }, #{}),
    ?assertEqual(<<"f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1">>, hb_maps:get(<<"channel-id">>, Msg, #{})),
    ?assertEqual(<<"@veritasium">>, hb_maps:get(<<"channel-name">>, Msg, #{})),
    ?assertEqual(<<"3082010a0282010100">>, hb_maps:get(<<"public-key">>, Msg, #{})).

channel_from_stream_signing_channel_test() ->
    StreamClaim = stream_claim(),
    {ok, Msg} = channel(#{}, #{ <<"claim">> => StreamClaim }, #{}),
    ?assertEqual(<<"@veritasium">>, hb_maps:get(<<"channel-name">>, Msg, #{})),
    ?assertEqual(StreamClaim, hb_maps:get(<<"source-claim">>, Msg, #{})),
    ?assertEqual(true, hb_maps:get(<<"signature-valid">>, Msg, #{})).

channel_from_claim_message_test() ->
    Claim = channel_claim(),
    ClaimMsg = #{
        <<"claim">> => Claim,
        <<"claim-id">> => hb_maps:get(<<"claim_id">>, Claim, #{}),
        <<"claim-name">> => hb_maps:get(<<"name">>, Claim, #{}),
        <<"value">> => hb_maps:get(<<"value">>, Claim, #{})
    },
    {ok, Msg} = channel(ClaimMsg, #{}, #{}),
    ?assertEqual(<<"channel">>, hb_maps:get(<<"value-type">>, Msg, #{})).

channel_rejects_unsigned_stream_test() ->
    ?assertMatch(
        {error, channel_not_found},
        channel(#{}, #{ <<"claim">> => maps:remove(<<"signing_channel">>, stream_claim()) }, #{})
    ).

channel_list_from_claims_test() ->
    Claim = channel_claim(),
    {ok, Msg} = channel_list(#{}, #{ <<"channel_claims">> => [Claim] }, #{}),
    Result = hb_maps:get(<<"result">>, Msg, #{}),
    [Item] = hb_maps:get(<<"items">>, Result, #{}),
    ?assertEqual(hb_maps:get(<<"claim_id">>, Claim, #{}), hb_maps:get(<<"claim_id">>, Item, #{})),
    ?assertEqual(true, hb_maps:get(<<"is_my_output">>, Item, #{})).

legacy_auth_token_accepts_bearer_header_test() ->
    Req = #{ <<"X-Lbry-Auth-Token">> => <<"Bearer fresh_token">> },
    ?assertEqual(<<"fresh_token">>, legacy_auth_token(#{}, #{}, Req, #{})).

legacy_auth_token_accepts_params_token_test() ->
    Params = #{ <<"auth_token">> => <<"fresh_token">> },
    ?assertEqual(<<"fresh_token">>, legacy_auth_token(Params, #{}, #{}, #{})).

channel_claim() ->
    #{
        <<"claim_id">> => <<"f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1">>,
        <<"canonical_url">> => <<"lbry://@veritasium#f">>,
        <<"name">> => <<"@veritasium">>,
        <<"value_type">> => <<"channel">>,
        <<"value">> => #{
            <<"title">> => <<"Veritasium">>,
            <<"description">> => <<"An element of truth.">>,
            <<"public_key">> => <<"3082010a0282010100">>,
            <<"public_key_id">> => <<"bLGr4w">>,
            <<"thumbnail">> => #{ <<"url">> => <<"https://thumbnails.lbry.com/veritasium">> },
            <<"tags">> => [<<"science">>, <<"education">>]
        }
    }.

stream_claim() ->
    #{
        <<"claim_id">> => <<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>,
        <<"name">> => <<"why-is-it-so-easy-to-disrupt-gps">>,
        <<"value_type">> => <<"stream">>,
        <<"value">> => #{ <<"title">> => <<"Why Is It So Easy To Disrupt GPS?">> },
        <<"signing_channel">> => channel_claim(),
        <<"signature_valid">> => true
    }.

-endif.
