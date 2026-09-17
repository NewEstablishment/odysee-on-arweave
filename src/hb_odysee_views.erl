%%% @doc Odysee integration for public media view totals.
%%%
%%% The reusable analytics device owns counters and baseline storage. This
%%% module only maps legacy claim IDs to the historical Odysee source, imports
%%% a missing baseline with the node signer, and returns generic aggregates.
-module(hb_odysee_views).

-export([counts/3]).

-define(DEFAULT_KEY, <<"odysee">>).
-define(BASELINE_VERSION, <<"legacy-view-api-v1">>).
-define(BASELINE_SOURCE, <<"legacy-view-api">>).
-define(MAX_COUNTS, 100).

counts(ClaimIDs0, Req, Opts) ->
    ClaimIDs = lists:sublist(normalize_ids(ClaimIDs0), ?MAX_COUNTS),
    Key = analytics_key(Req, Opts),
    case analytics_counts(Key, ClaimIDs, Req, Opts) of
        {ok, Initial} ->
            MissingLegacy = [
                ID
             || ID <- ClaimIDs,
                legacy_claim_id(ID),
                baseline_missing(ID, Initial)
            ],
            case ensure_legacy_baselines(Key, MissingLegacy, Opts) of
                ok -> analytics_counts(Key, ClaimIDs, Req, Opts);
                {error, _} = Error -> Error
            end;
        Error ->
            Error
    end.

normalize_ids(IDs) when is_list(IDs) ->
    stable_unique(lists:filtermap(fun normalized_id/1, IDs));
normalize_ids(_) ->
    [].

normalized_id(ID) ->
    case normalize_id(ID) of
        <<>> -> false;
        Normalized -> {true, Normalized}
    end.

stable_unique(Values) ->
    {Unique, _Seen} =
        lists:foldl(
            fun(Value, {Acc, Seen}) ->
                case sets:is_element(Value, Seen) of
                    true -> {Acc, Seen};
                    false -> {[Value | Acc], sets:add_element(Value, Seen)}
                end
            end,
            {[], sets:new([{version, 2}])},
            Values
        ),
    lists:reverse(Unique).

normalize_id(ID) when is_binary(ID) ->
    hb_util:to_lower(string:trim(ID));
normalize_id(ID) when is_list(ID) ->
    normalize_id(unicode:characters_to_binary(ID));
normalize_id(_) ->
    <<>>.

legacy_claim_id(ID) ->
    hb_odysee_util:valid_hex(ID, 20).

baseline_missing(ID, Counts) ->
    case maps:get(ID, Counts, undefined) of
        undefined -> true;
        Count -> not maps:is_key(<<"baseline-version">>, Count)
    end.

ensure_legacy_baselines(_Key, [], _Opts) ->
    ok;
ensure_legacy_baselines(Key, ClaimIDs, Opts) ->
    case hb_odysee_client:view_counts(ClaimIDs, Opts) of
        {ok, Values} when length(Values) =:= length(ClaimIDs) ->
            import_baselines(Key, lists:zip(ClaimIDs, Values), Opts);
        {ok, Other} ->
            {error, {invalid_legacy_view_counts, Other}};
        Error ->
            Error
    end.

import_baselines(_Key, [], _Opts) ->
    ok;
import_baselines(Key, [{SubjectID, Value0} | Rest], Opts) ->
    Value = non_negative_int(Value0),
    Fields = #{
        <<"key">> => Key,
        <<"subject-id">> => SubjectID,
        <<"value">> => Value,
        <<"version">> => ?BASELINE_VERSION,
        <<"cutover-at">> => 0,
        <<"source">> => ?BASELINE_SOURCE
    },
    case signed_node_request(Fields, Opts) of
        {ok, Signed} ->
            case dev_analytics:baseline(#{}, Signed, Opts) of
                {ok, Response} ->
                    case response_status(Response, Opts) of
                        Status when Status >= 200, Status < 300 -> import_baselines(Key, Rest, Opts);
                        Status -> {error, {baseline_import_failed, SubjectID, Status}}
                    end;
                Error ->
                    Error
            end;
        Error ->
            Error
    end.

signed_node_request(Fields, Opts) ->
    Wallet =
        case hb_opts:get(priv_wallet, undefined, Opts) of
            undefined -> hb_opts:get(<<"priv-wallet">>, undefined, Opts);
            Value -> Value
        end,
    case Wallet of
        undefined -> {error, missing_node_wallet};
        _ -> {ok, hb_message:commit(Fields, Opts#{ <<"priv-wallet">> => Wallet })}
    end.

analytics_counts(_Key, [], _Req, _Opts) ->
    {ok, #{}};
analytics_counts(Key, ClaimIDs, Req, Opts) ->
    AnalyticsReq = maps:merge(
        maps:with([<<"origin">>], Req),
        #{ <<"key">> => Key, <<"subject-ids">> => ClaimIDs }
    ),
    case dev_analytics:counts(#{}, AnalyticsReq, Opts) of
        {ok, Response} ->
            case response_status(Response, Opts) of
                Status when Status >= 200, Status < 300 ->
                    decode_counts(Response, Opts);
                Status ->
                    {error, {analytics_counts_failed, Status}}
            end;
        Error ->
            Error
    end.

decode_counts(Response, Opts) ->
    Body = hb_maps:get(<<"body">>, Response, <<"{}">>, Opts),
    try hb_json:decode(Body) of
        #{ <<"counts">> := Counts } when is_list(Counts) ->
            {ok,
                maps:from_list([
                    {maps:get(<<"subject-id">>, Count, <<>>), Count}
                 || Count <- Counts,
                    is_map(Count),
                    maps:get(<<"subject-id">>, Count, <<>>) =/= <<>>
                ])};
        Other ->
            {error, {invalid_analytics_counts, Other}}
    catch
        _:_ -> {error, invalid_analytics_counts_json}
    end.

analytics_key(Req, Opts) ->
    Default = hb_opts:get(<<"odysee-analytics-key">>, ?DEFAULT_KEY, Opts),
    case string:trim(hb_maps:get(<<"key">>, Req, Default, Opts)) of
        <<>> -> Default;
        Key -> Key
    end.

response_status(Response, Opts) ->
    hb_util:int(hb_maps:get(<<"status">>, Response, 200, Opts)).

non_negative_int(Value) ->
    max(0, hb_util:int(Value)).

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

normalize_ids_preserves_order_test() ->
    ?assertEqual(
        [<<"bbbb">>, <<"aaaa">>, <<"cccc">>],
        normalize_ids([<<" BBBB ">>, <<"aaaa">>, <<"bbbb">>, <<>>, "CCCC"])
    ).

legacy_claim_id_test() ->
    ?assert(legacy_claim_id(<<"0f462458e87ffccad6a93fa102eeaec1d51ab391">>)),
    ?assertNot(legacy_claim_id(<<"buyMM5krk81CNpKSWExfsKfe-ZuFuNwmwApjVIQtR_M">>)).

-endif.
