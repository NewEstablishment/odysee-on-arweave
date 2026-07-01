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
        maybe
            {ok, Claim, Raw} ?= find_or_fetch_claim(Base, Req, Opts),
            ok_message(normalize_claim(Claim, Raw, Opts))
        else
            Error -> Error
        end
    end).

%% @doc Search claims using the SDK proxy `claim_search' method.
search(Base, Req, Opts) ->
    safe(fun() ->
        Params = search_params(Base, Req),
        case find_or_fetch_search(Base, Req, Opts) of
            {ok, Result0, Raw} ->
                Result = merge_native_upload_search(Result0, Params, Opts),
                ok_message(normalize_search_result(Result, Raw, Opts));
            {error, Reason} ->
                search_fallback(Params, Reason, Opts)
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
            find_or_fetch_native_or_proxy_claim(Base, Req, Opts)
    end.

find_or_fetch_native_or_proxy_claim(Base, Req, Opts) ->
    case native_claim_candidate(Base, Req, Opts) of
        {ok, _Claim, _Raw} = Claim ->
            Claim;
        not_found ->
            maybe
                {ok, URI} ?= claim_uri(Base, Req, Opts),
                {ok, Raw} ?= resolve_proxy(URI, Base, Req, Opts),
                claim_from_proxy(URI, Raw, Opts)
            end
    end.

find_or_fetch_search(Base, Req, Opts) ->
    case search_candidate(Base, Req, Opts) of
        {ok, _Result, _Raw} = Search ->
            Search;
        not_found ->
            maybe
                {ok, Raw} ?= search_proxy(search_params(Base, Req), Base, Req, Opts),
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
        not_found ->
            case search_candidate_from_value(Req, Opts) of
                {ok, _Result, _Raw} = Search -> Search;
                not_found -> search_candidate_from_fields(Candidates, Opts)
            end
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

search_params(Base, Req) ->
    maps:without(search_reserved_keys(), maps:merge(map_or_empty(Base), map_or_empty(Req))).

map_or_empty(Map) when is_map(Map) -> Map;
map_or_empty(_Value) -> #{}.

merge_native_upload_search(Result, Params, Opts) ->
    append_native_upload_items(Result, native_upload_search_items(Params, Opts), Opts).

search_fallback(Params, Reason, Opts) ->
    NativeItems = native_upload_search_items(Params, Opts),
    Result = append_native_upload_items(empty_search_result(Params, Reason, Opts), NativeItems, Opts),
    Raw = hb_json:encode(#{ <<"jsonrpc">> => <<"2.0">>, <<"result">> => Result, <<"id">> => 1 }),
    ok_message(normalize_search_result(Result, Raw, Opts)).

native_upload_search_items(Params, Opts) ->
    ChannelIDs = native_upload_channel_ids(Params, Opts),
    case native_upload_search_allowed(ChannelIDs, Params, Opts) of
        true ->
            lists:append([
                native_channel_claim_items(ChannelID, Opts)
            ||
                ChannelID <- ChannelIDs
            ]);
        false ->
            []
    end.

empty_search_result(Params, Reason, Opts) ->
    #{
        <<"items">> => [],
        <<"page">> => int_or_default(first_value([<<"page">>], Params, Opts), 1),
        <<"page_size">> => int_or_default(first_value([<<"page_size">>, <<"page-size">>], Params, Opts), 20),
        <<"total_items">> => 0,
        <<"total_pages">> => 0,
        <<"hyperbeam_proxy_error">> => hb_util:bin(io_lib:format("~p", [Reason]))
    }.

native_upload_search_allowed([], _Params, _Opts) ->
    false;
native_upload_search_allowed(_ChannelIDs, Params, Opts) ->
    first_page(Params, Opts) andalso stream_claim_search(Params, Opts).

native_upload_channel_ids(Params, Opts) ->
    case first_value(
        [
            <<"channel_ids">>,
            <<"channel-ids">>,
            <<"channel_id">>,
            <<"channel-id">>,
            <<"channel_claim_id">>,
            <<"channel-claim-id">>
        ],
        Params,
        Opts
    ) of
        not_found -> [];
        Value -> value_list(Value)
    end.

append_native_upload_items(Result, [], _Opts) ->
    Result;
append_native_upload_items(Result, NativeItems, Opts) ->
    Items = search_items(Result, Opts),
    {MergedItems, AddedCount} = merge_native_upload_items(Items, NativeItems, Opts),
    Result1 = Result#{ <<"items">> => MergedItems },
    increment_total_items(Result1, AddedCount, Opts).

merge_native_upload_items(Items, NativeItems, Opts) ->
    NativeByID = native_items_by_id(NativeItems, Opts),
    {ReplacedItems, SeenIDs} = replace_native_duplicates(Items, NativeByID, sets:new(), [], Opts),
    Additions = [
        Item
    ||
        Item <- NativeItems,
        not sets:is_element(item_claim_id(Item, Opts), SeenIDs)
    ],
    {ReplacedItems ++ Additions, length(Additions)}.

native_items_by_id(Items, Opts) ->
    lists:foldl(
        fun(Item, Acc) ->
            case item_claim_id(Item, Opts) of
                not_found -> Acc;
                ID -> Acc#{ ID => Item }
            end
        end,
        #{},
        Items
    ).

replace_native_duplicates([], _NativeByID, SeenIDs, Acc, _Opts) ->
    {lists:reverse(Acc), SeenIDs};
replace_native_duplicates([Item | Rest], NativeByID, SeenIDs, Acc, Opts) ->
    ID = item_claim_id(Item, Opts),
    case maps:get(ID, NativeByID, not_found) of
        not_found ->
            replace_native_duplicates(Rest, NativeByID, SeenIDs, [Item | Acc], Opts);
        Native ->
            replace_native_duplicates(Rest, NativeByID, sets:add_element(ID, SeenIDs), [Native | Acc], Opts)
    end.

item_claim_id(Item, Opts) when is_map(Item) ->
    first_value(
        [
            <<"claim_id">>,
            <<"claim-id">>,
            <<"hyperbeam_upload_id">>,
            <<"hyperbeam-upload-id">>
        ],
        Item,
        Opts
    );
item_claim_id(_Item, _Opts) ->
    not_found.

increment_total_items(Result, Count, Opts) ->
    case first_value([<<"total_items">>, <<"total-items">>], Result, Opts) of
        not_found ->
            Result;
        Value ->
            Result#{ <<"total_items">> => int_value(Value) + Count }
    end.

first_page(Params, Opts) ->
    int_value(first_value([<<"page">>], Params, Opts)) =< 1.

stream_claim_search(Params, Opts) ->
    case first_value([<<"claim_type">>, <<"claim-type">>], Params, Opts) of
        not_found ->
            true;
        Value ->
            lists:member(<<"stream">>, value_list(Value))
    end.

value_list(Values) when is_list(Values) ->
    [hb_util:bin(Value) || Value <- Values, hb_util:bin(Value) =/= <<>>];
value_list(Value) when is_binary(Value) ->
    [trim(Part) || Part <- binary:split(Value, <<",">>, [global]), trim(Part) =/= <<>>];
value_list(Value) ->
    [hb_util:bin(Value)].

int_value(Value) when is_integer(Value) ->
    Value;
int_value(Value) when is_binary(Value) ->
    try binary_to_integer(Value)
    catch _:_ -> 1
    end;
int_value(_Value) ->
    1.

int_or_default(Value, _Default) when is_integer(Value) ->
    Value;
int_or_default(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value)
    catch _:_ -> Default
    end;
int_or_default(_Value, Default) ->
    Default.

native_claim_candidate(Base, Req, Opts) ->
    case native_upload_id(Base, Req, Opts) of
        not_found -> not_found;
        UploadID -> native_upload_claim_from_id(UploadID, Opts)
    end.

native_upload_id(Base, Req, Opts) ->
    case first_found(
        [
            {Req, <<"upload-id">>},
            {Req, <<"upload_id">>},
            {Req, <<"hyperbeam-upload-id">>},
            {Req, <<"hyperbeam_upload_id">>},
            {Req, <<"claim-id">>},
            {Req, <<"claim_id">>},
            {Base, <<"upload-id">>},
            {Base, <<"upload_id">>},
            {Base, <<"hyperbeam-upload-id">>},
            {Base, <<"hyperbeam_upload_id">>},
            {Base, <<"claim-id">>},
            {Base, <<"claim_id">>}
        ],
        Opts
    ) of
        not_found -> native_upload_id_from_uri(Base, Req, Opts);
        Value -> hb_util:bin(Value)
    end.

native_upload_id_from_uri(Base, Req, Opts) ->
    case first_found(
        [
            {Req, <<"uri">>},
            {Req, <<"url">>},
            {Base, <<"uri">>},
            {Base, <<"url">>}
        ],
        Opts
    ) of
        not_found -> not_found;
        URI -> native_upload_id_from_uri_value(hb_util:bin(URI))
    end.

native_upload_id_from_uri_value(<<"hb://upload/", UploadID/binary>>) ->
    UploadID;
native_upload_id_from_uri_value(URI) ->
    case binary:split(URI, <<"#">>, [global]) of
        [_] ->
            not_found;
        Parts ->
            lists:last(Parts)
    end.

native_upload_claim_from_id(UploadID0, Opts) ->
    case native_path_id(UploadID0) of
        {ok, UploadID} ->
            case native_read_upload(UploadID, Opts) of
                {ok, Upload} ->
                    Claim = native_upload_claim_item(UploadID, Upload, Opts),
                    {ok, Claim, hb_json:encode(Claim)};
                _ ->
                    not_found
            end;
        _ ->
            not_found
    end.

native_read_upload(UploadID, Opts) ->
    case read_native_upload_record(native_upload_path(UploadID), Opts) of
        {ok, _Upload} = Found -> Found;
        _ -> read_native_upload_record(UploadID, Opts)
    end.

native_channel_claim_items(ChannelID, Opts) ->
    case native_path_id(ChannelID) of
        {ok, SafeChannelID} ->
            lists:filtermap(
                fun(UploadID) ->
                    case native_upload_for_channel(SafeChannelID, UploadID, Opts) of
                        {ok, Upload} when is_map(Upload) ->
                            {true, native_upload_claim_item(UploadID, Upload, Opts)};
                        _ ->
                            false
                    end
                end,
                lists:usort(
                    native_upload_id_index(native_channel_upload_index_path(SafeChannelID), Opts)
                        ++ hb_cache:list(native_channel_upload_root(SafeChannelID), Opts)
                        ++ native_upload_ids(Opts)
                )
            );
        _ ->
            []
    end.

native_upload_id_index(Path, Opts) ->
    case hb_cache:read(Path, Opts) of
        {ok, Stored} -> decode_native_upload_id_index(hb_cache:ensure_all_loaded(Stored, Opts));
        _ -> []
    end.

decode_native_upload_id_index(Stored) when is_list(Stored) ->
    [hb_util:bin(ID) || ID <- Stored, hb_util:bin(ID) =/= <<>>];
decode_native_upload_id_index(Stored) when is_binary(Stored) ->
    try hb_json:decode(Stored) of
        IDs when is_list(IDs) -> decode_native_upload_id_index(IDs);
        _ -> []
    catch
        _:_ -> []
    end;
decode_native_upload_id_index(_Stored) ->
    [].

native_upload_ids(Opts) ->
    hb_cache:list(native_upload_root(), Opts).

native_upload_for_channel(ChannelID, UploadID, Opts) ->
    case read_native_upload_record(native_channel_upload_path(ChannelID, UploadID), Opts) of
        {ok, _Upload} = Found ->
            Found;
        _ ->
            case read_native_upload_record(native_upload_path(UploadID), Opts) of
                {ok, Upload} ->
                    case first_value([<<"channel-id">>, <<"channel_id">>], Upload, Opts) of
                        ChannelID -> {ok, Upload};
                        _ -> not_found
                    end;
                Other ->
                    Other
            end
    end.

read_native_upload_record(Path, Opts) ->
    case hb_cache:read(Path, Opts) of
        {ok, Stored} -> decode_native_upload_record(hb_cache:ensure_all_loaded(Stored, Opts));
        Error -> Error
    end.

decode_native_upload_record(Stored) when is_map(Stored) ->
    {ok, Stored};
decode_native_upload_record(Stored) when is_binary(Stored) ->
    try hb_json:decode(Stored) of
        Upload when is_map(Upload) -> {ok, Upload};
        _ -> {ok, Stored}
    catch
        _:_ -> {ok, Stored}
    end;
decode_native_upload_record(Stored) ->
    {ok, Stored}.

native_upload_claim_item(UploadID, Upload, Opts) ->
    Body = hb_maps:get(<<"body">>, Upload, <<>>, Opts),
    ClaimName = native_upload_claim_name(Upload, Opts),
    ContentType = native_upload_content_type(Upload, Opts),
    Source = #{
        <<"media_type">> => ContentType,
        <<"name">> => native_upload_filename(Upload, Opts),
        <<"size">> => native_upload_size(Upload, Body, Opts),
        <<"sha256">> => native_upload_sha256(Upload, Body, Opts),
        <<"hyperbeam_upload_id">> => UploadID,
        <<"hyperbeam_body_path">> => native_upload_body_path(Upload, Body, Opts)
    },
    Value =
        lists:foldl(fun put_if_found_pair/2, #{
            <<"title">> => native_upload_title(Upload, ClaimName, Opts),
            <<"source">> => Source,
            <<"stream_type">> => native_upload_stream_type(ContentType)
        }, [
            {<<"description">>, first_value([<<"description">>], Upload, Opts)},
            {<<"tags">>, native_upload_tags(Upload, Opts)},
            {<<"thumbnail">>, native_upload_thumbnail(Upload, Opts)}
        ]),
    lists:foldl(fun put_if_found_pair/2, #{
        <<"claim_id">> => UploadID,
        <<"name">> => ClaimName,
        <<"type">> => <<"claim">>,
        <<"value_type">> => <<"stream">>,
        <<"canonical_url">> => native_upload_canonical_url(Upload, UploadID, ClaimName, Opts),
        <<"permanent_url">> => native_upload_canonical_url(Upload, UploadID, ClaimName, Opts),
        <<"value">> => Value,
        <<"meta">> => #{},
        <<"hyperbeam_upload_id">> => UploadID,
        <<"is_hyperbeam_upload">> => true,
        <<"is_channel_signature_valid">> => native_upload_has_channel(Upload, Opts)
    }, [
        {<<"signing_channel">>, native_upload_signing_channel(Upload, Opts)}
    ]).

native_path_id(Value) ->
    Bin = hb_util:bin(Value),
    case Bin =/= <<>> andalso binary:match(Bin, <<"/">>) =:= nomatch of
        true -> {ok, Bin};
        false -> {error, invalid_id}
    end.

native_channel_upload_root(ChannelID) ->
    <<"odysee/hyperbeam-channel/", ChannelID/binary, "/uploads">>.

native_channel_upload_index_path(ChannelID) ->
    <<"odysee/hyperbeam-channel/", ChannelID/binary, "/upload-ids">>.

native_channel_upload_path(ChannelID, UploadID) ->
    <<(native_channel_upload_root(ChannelID))/binary, "/", UploadID/binary>>.

native_upload_path(UploadID) ->
    <<"odysee/hyperbeam-upload/", UploadID/binary>>.

native_upload_root() ->
    <<"odysee/hyperbeam-upload">>.

native_upload_size(Upload, Body, Opts) ->
    case hb_maps:get(<<"size">>, Upload, not_found, Opts) of
        not_found -> byte_size(Body);
        Size -> Size
    end.

native_upload_sha256(Upload, Body, Opts) ->
    case hb_maps:get(<<"sha256">>, Upload, not_found, Opts) of
        not_found -> hb_util:to_hex(crypto:hash(sha256, Body));
        Sha -> Sha
    end.

native_upload_filename(Upload, Opts) ->
    case first_value([<<"filename">>, <<"file-name">>, <<"name">>], Upload, Opts) of
        not_found -> <<"hyperbeam-upload-demo.bin">>;
        Value -> hb_util:bin(Value)
    end.

native_upload_content_type(Upload, Opts) ->
    case first_value([<<"content-type">>, <<"file-type">>, <<"mime-type">>], Upload, Opts) of
        not_found -> <<"application/octet-stream">>;
        Value -> hb_util:bin(Value)
    end.

native_upload_claim_name(Upload, Opts) ->
    case first_value([<<"claim-name">>, <<"claim_name">>, <<"name">>, <<"title">>, <<"filename">>], Upload, Opts) of
        not_found -> <<"hyperbeam-upload">>;
        Value -> native_safe_name(hb_util:bin(Value))
    end.

native_upload_title(Upload, ClaimName, Opts) ->
    case first_value([<<"title">>], Upload, Opts) of
        not_found -> ClaimName;
        Value -> hb_util:bin(Value)
    end.

native_upload_tags(Upload, Opts) ->
    case first_value([<<"tags">>, <<"tag">>], Upload, Opts) of
        not_found -> not_found;
        Value -> value_list(Value)
    end.

native_upload_thumbnail(Upload, Opts) ->
    case first_value([<<"thumbnail-url">>, <<"thumbnail_url">>], Upload, Opts) of
        not_found -> not_found;
        URL -> #{ <<"url">> => hb_util:bin(URL) }
    end.

native_upload_body_path(Upload, Body, Opts) ->
    case hb_maps:get(<<"body-path">>, Upload, not_found, Opts) of
        not_found -> native_upload_body_path(Body, Opts);
        BodyPath -> BodyPath
    end.

native_upload_body_path(Body, Opts) when is_binary(Body) ->
    <<"data/", (hb_path:hashpath(Body, Opts))/binary>>;
native_upload_body_path(_Body, _Opts) ->
    not_found.

native_upload_stream_type(<<"video/", _/binary>>) ->
    <<"video">>;
native_upload_stream_type(<<"audio/", _/binary>>) ->
    <<"audio">>;
native_upload_stream_type(<<"image/", _/binary>>) ->
    <<"image">>;
native_upload_stream_type(_ContentType) ->
    <<"binary">>.

native_upload_signing_channel(Upload, Opts) ->
    case first_value([<<"channel-id">>, <<"channel_id">>], Upload, Opts) of
        not_found ->
            not_found;
        ChannelID ->
            ChannelIDBin = hb_util:bin(ChannelID),
            ChannelName = native_upload_channel_name(Upload, Opts),
            ChannelURL = <<"lbry://", ChannelName/binary, "#", ChannelIDBin/binary>>,
            #{
                <<"claim_id">> => ChannelIDBin,
                <<"name">> => ChannelName,
                <<"normalized_name">> => ChannelName,
                <<"value_type">> => <<"channel">>,
                <<"canonical_url">> => ChannelURL,
                <<"permanent_url">> => ChannelURL,
                <<"short_url">> => ChannelURL,
                <<"value">> => #{ <<"title">> => ChannelName }
            }
    end.

native_upload_has_channel(Upload, Opts) ->
    first_value([<<"channel-id">>, <<"channel_id">>], Upload, Opts) =/= not_found.

native_upload_canonical_url(Upload, UploadID, ClaimName, Opts) ->
    case first_value([<<"channel-id">>, <<"channel_id">>], Upload, Opts) of
        not_found ->
            <<"lbry://", ClaimName/binary, "#", UploadID/binary>>;
        ChannelID ->
            <<
                "lbry://",
                (native_upload_channel_name(Upload, Opts))/binary,
                "#",
                (hb_util:bin(ChannelID))/binary,
                "/",
                ClaimName/binary,
                "#",
                UploadID/binary
            >>
    end.

native_upload_channel_name(Upload, Opts) ->
    case first_value([<<"channel-name">>, <<"channel_name">>], Upload, Opts) of
        not_found -> <<"@hyperbeam">>;
        Name -> native_upload_ensure_channel_name(hb_util:bin(Name))
    end.

native_upload_ensure_channel_name(<<"@", _/binary>> = Name) ->
    native_safe_name(Name);
native_upload_ensure_channel_name(Name) ->
    <<"@", (native_safe_name(Name))/binary>>.

native_safe_name(Bin) ->
    Trimmed = trim(Bin),
    Normalized = iolist_to_binary([native_safe_name_char(native_char_lower(C)) || C <- binary_to_list(Trimmed)]),
    case native_trim_hyphens(Normalized) of
        <<>> -> <<"hyperbeam-upload">>;
        Name -> Name
    end.

native_safe_name_char(C) when C >= $a, C =< $z ->
    C;
native_safe_name_char(C) when C >= $0, C =< $9 ->
    C;
native_safe_name_char($@) ->
    $@;
native_safe_name_char(_) ->
    $-.

native_char_lower(C) when C >= $A, C =< $Z ->
    C + 32;
native_char_lower(C) ->
    C.

native_trim_hyphens(<<"-", Rest/binary>>) ->
    native_trim_hyphens(Rest);
native_trim_hyphens(Bin) when byte_size(Bin) > 0 ->
    Size = byte_size(Bin),
    case binary:last(Bin) of
        $- -> native_trim_hyphens(binary:part(Bin, 0, Size - 1));
        _ -> Bin
    end;
native_trim_hyphens(Bin) ->
    Bin.

search_reserved_keys() ->
    [
        <<"access-token">>,
        <<"access_token">>,
        <<"auth-token">>,
        <<"auth_token">>,
        <<"authorization">>,
        <<"body">>,
        <<"claim-search-result">>,
        <<"claim_search_result">>,
        <<"content-type">>,
        <<"device">>,
        <<"include_is_my_output">>,
        <<"include_purchase_receipt">>,
        <<"method">>,
        <<"path">>,
        <<"proxy-url">>,
        <<"proxy_url">>,
        <<"raw-result">>,
        <<"raw_result">>,
        <<"result">>,
        <<"search-result">>,
        <<"search_result">>
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
        {<<"claim-op">>, first_value([<<"claim_op">>, <<"claim-op">>], Claim, Opts)},
        {<<"is-channel-signature-valid">>,
            first_value([<<"is_channel_signature_valid">>, <<"is-channel-signature-valid">>], Claim, Opts)}
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

trim(Bin) ->
    iolist_to_binary(string:trim(binary_to_list(Bin))).

put_if_found(_Key, not_found, Msg) -> Msg;
put_if_found(Key, Value, Msg) -> Msg#{ Key => Value }.

put_if_found_pair({_Key, not_found}, Msg) -> Msg;
put_if_found_pair({Key, Value}, Msg) -> Msg#{ Key => Value }.

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

resolve_native_upload_id_test() ->
    Store = hb_test_utils:test_store(hb_store_volatile, <<"odysee-claim-native-resolve">>),
    ok = hb_store:start(Store),
    Wallet = ar_wallet:new(),
    Opts = #{ <<"store">> => Store, <<"priv-wallet">> => Wallet },
    UploadReq = hb_message:commit(#{
        <<"path">> => <<"/~odysee-upload-demo@1.0/upload">>,
        <<"method">> => <<"POST">>,
        <<"legacy-user-id">> => <<"42">>,
        <<"channel-id">> => <<"channel-resolve">>,
        <<"channel-name">> => <<"@native-demo">>,
        <<"title">> => <<"Resolvable native video">>,
        <<"description">> => <<"Resolve native metadata">>,
        <<"tags">> => <<"hb,resolve">>,
        <<"thumbnail-url">> => <<"https://example.test/resolve-thumb.jpg">>,
        <<"claim-name">> => <<"resolvable-native-video">>,
        <<"filename">> => <<"resolvable-native.mp4">>,
        <<"content-type">> => <<"video/mp4">>,
        <<"body">> => <<"resolvable native bytes">>
    }, Opts),
    {ok, UploadID} = hb_cache:write(UploadReq, Opts),
    ok = hb_cache:link(UploadID, native_upload_path(UploadID), Opts),
    {ok, Msg} = resolve(#{}, #{ <<"claim-id">> => UploadID }, Opts),
    ?assertEqual(UploadID, hb_maps:get(<<"claim-id">>, Msg, #{})),
    ?assertEqual(<<"stream">>, hb_maps:get(<<"value-type">>, Msg, #{})),
    ?assertEqual(true, hb_maps:get(<<"is-channel-signature-valid">>, Msg, #{})),
    Value = hb_maps:get(<<"value">>, Msg, #{}),
    ?assertEqual(<<"Resolvable native video">>, maps:get(<<"title">>, Value)),
    ?assertEqual(<<"Resolve native metadata">>, maps:get(<<"description">>, Value)),
    ?assertEqual([<<"hb">>, <<"resolve">>], maps:get(<<"tags">>, Value)),
    Source = maps:get(<<"source">>, Value),
    ?assertEqual(UploadID, maps:get(<<"hyperbeam_upload_id">>, Source)),
    ?assertEqual(false, maps:is_key(<<"sd_hash">>, Source)).

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

search_merges_native_channel_uploads_test() ->
    Store = hb_test_utils:test_store(hb_store_volatile, <<"odysee-claim-native-channel">>),
    ok = hb_store:start(Store),
    Wallet = ar_wallet:new(),
    Opts = #{ <<"store">> => Store, <<"priv-wallet">> => Wallet },
    UploadReq = hb_message:commit(#{
        <<"path">> => <<"/~odysee-upload-demo@1.0/upload">>,
        <<"method">> => <<"POST">>,
        <<"legacy-user-id">> => <<"42">>,
        <<"channel-id">> => <<"channel-merge">>,
        <<"channel-name">> => <<"@native-demo">>,
        <<"title">> => <<"Native merged video">>,
        <<"description">> => <<"Native item metadata">>,
        <<"tags">> => <<"hb,upload">>,
        <<"thumbnail-url">> => <<"https://example.test/native-thumb.jpg">>,
        <<"claim-name">> => <<"native-merged-video">>,
        <<"filename">> => <<"native-merged.mp4">>,
        <<"content-type">> => <<"video/mp4">>,
        <<"body">> => <<"native video bytes">>
    }, Opts),
    {ok, UploadID} = hb_cache:write(UploadReq, Opts),
    ok = hb_cache:link(UploadID, native_upload_path(UploadID), Opts),
    Result = #{
        <<"items">> => [target_claim()],
        <<"page">> => 1,
        <<"page_size">> => 20,
        <<"total_items">> => 1
    },
    {ok, Msg} =
        search(
            #{},
            #{
                <<"result">> => Result,
                <<"channel_ids">> => [<<"channel-merge">>],
                <<"claim_type">> => [<<"stream">>]
            },
            Opts
        ),
    ClaimIDs = hb_maps:get(<<"claim-ids">>, Msg, #{}),
    ?assert(lists:member(<<"346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169">>, ClaimIDs)),
    ?assert(lists:member(UploadID, ClaimIDs)),
    ?assertEqual(2, hb_maps:get(<<"total-items">>, Msg, #{})),
    [NativeItem] =
        [
            Item
        ||
            Item <- hb_maps:get(<<"items">>, Msg, #{}),
            maps:get(<<"claim_id">>, Item, not_found) =:= UploadID
        ],
    NativeValue = maps:get(<<"value">>, NativeItem),
    ?assertEqual(true, maps:get(<<"is_channel_signature_valid">>, NativeItem)),
    ?assertEqual(<<"Native merged video">>, maps:get(<<"title">>, NativeValue)),
    ?assertEqual(<<"Native item metadata">>, maps:get(<<"description">>, NativeValue)),
    ?assertEqual([<<"hb">>, <<"upload">>], maps:get(<<"tags">>, NativeValue)),
    ?assertEqual(
        #{ <<"url">> => <<"https://example.test/native-thumb.jpg">> },
        maps:get(<<"thumbnail">>, NativeValue)
    ),
    NativeSource = maps:get(<<"source">>, NativeValue),
    ?assertEqual(UploadID, maps:get(<<"hyperbeam_upload_id">>, NativeSource)),
    ?assertEqual(false, maps:is_key(<<"sd_hash">>, NativeSource)).

search_prefers_native_upload_duplicate_test() ->
    UploadID = <<"native-upload-1">>,
    Existing = #{
        <<"claim_id">> => UploadID,
        <<"value">> => #{ <<"source">> => #{ <<"sd_hash">> => <<"legacy-descriptor">> } }
    },
    Native = #{
        <<"claim_id">> => UploadID,
        <<"is_hyperbeam_upload">> => true,
        <<"value">> => #{
            <<"source">> => #{
                <<"hyperbeam_upload_id">> => UploadID
            }
        }
    },
    Result = append_native_upload_items(
        #{
            <<"items">> => [target_claim(), Existing],
            <<"total_items">> => 2
        },
        [Native],
        #{}
    ),
    Items = maps:get(<<"items">>, Result),
    ?assertEqual(2, length(Items)),
    ?assertEqual(2, maps:get(<<"total_items">>, Result)),
    [Merged] = [Item || Item <- Items, maps:get(<<"claim_id">>, Item, not_found) =:= UploadID],
    ?assertEqual(true, maps:get(<<"is_hyperbeam_upload">>, Merged)),
    Source = maps:get(<<"source">>, maps:get(<<"value">>, Merged)),
    ?assertEqual(UploadID, maps:get(<<"hyperbeam_upload_id">>, Source)),
    ?assertEqual(false, maps:is_key(<<"sd_hash">>, Source)).

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
        #{ <<"proxy-url">> => <<"http://proxy">>, <<"page">> => 1 },
        #{
            <<"body">> => <<"{}">>,
            <<"auth_token">> => <<"token">>,
            <<"include_is_my_output">> => true,
            <<"claim_type">> => [<<"stream">>]
        }
    ),
    ?assertEqual(#{ <<"page">> => 1, <<"claim_type">> => [<<"stream">>] }, Params).

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
