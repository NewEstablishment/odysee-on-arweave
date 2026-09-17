%%% @doc Public Odysee file compatibility reads backed by generic analytics.
%%%
%%% Historical sourcing belongs here, not in analytics@1.0. The endpoint
%%% accepts stable product IDs, imports missing legacy baselines once, and
%%% returns the generic public totals without user authentication.
-module(dev_odysee_file).
-implements(<<"odysee-file@1.0">>).

-export([info/1, 'view-count'/3, view_count/3]).

info(_Opts) ->
    #{ exports => [<<"view-count">>, <<"view_count">>] }.

'view-count'(Base, Req, Opts) ->
    view_count(Base, Req, Opts).

view_count(_Base, Req, Opts) ->
    ClaimIDs = request_ids(Req, Opts),
    case ClaimIDs of
        [] ->
            error_response(400, <<"At least one claim ID is required.">>);
        _ ->
            case hb_odysee_views:counts(ClaimIDs, Req, Opts) of
                {ok, CountsByID} ->
                    Counts = [maps:get(ID, CountsByID, empty_count(ID)) || ID <- normalize_ids(ClaimIDs)],
                    json_response(#{
                        <<"counts">> => Counts,
                        <<"view_counts">> => [maps:get(<<"total">>, Count, 0) || Count <- Counts]
                    });
                {error, Reason} ->
                    error_response(502, iolist_to_binary(io_lib:format("~p", [Reason])))
            end
    end.

request_ids(Req, Opts) ->
    Value = hb_ao:get_first(
        [
            {Req, <<"claim-ids">>},
            {Req, <<"claim_ids">>},
            {Req, <<"claim-id">>},
            {Req, <<"claim_id">>},
            {Req, <<"subject-ids">>}
        ],
        [],
        Opts
    ),
    parse_ids(Value).

parse_ids(Value) when is_list(Value) ->
    [to_binary(ID) || ID <- Value, to_binary(ID) =/= <<>>];
parse_ids(Value) when is_binary(Value) ->
    [ID || ID <- binary:split(Value, <<",">>, [global]), ID =/= <<>>];
parse_ids(_) ->
    [].

normalize_ids(IDs) ->
    stable_unique([hb_util:to_lower(string:trim(ID)) || ID <- IDs]).

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

to_binary(Value) when is_binary(Value) -> string:trim(Value);
to_binary(Value) when is_list(Value) -> string:trim(unicode:characters_to_binary(Value));
to_binary(_) -> <<>>.

empty_count(ID) ->
    #{
        <<"subject-id">> => ID,
        <<"raw">> => 0,
        <<"qualified">> => 0,
        <<"baseline">> => 0,
        <<"total">> => 0
    }.

json_response(Body) ->
    {ok, #{
        <<"status">> => 200,
        <<"content-type">> => <<"application/json">>,
        <<"cache-control">> => [<<"no-store">>],
        <<"body">> => hb_json:encode(Body)
    }}.

error_response(Status, Reason) ->
    {ok, #{
        <<"status">> => Status,
        <<"content-type">> => <<"application/json">>,
        <<"cache-control">> => [<<"no-store">>],
        <<"body">> => hb_json:encode(#{ <<"error">> => Reason })
    }}.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

normalize_ids_preserves_order_test() ->
    ?assertEqual(
        [<<"bbbb">>, <<"aaaa">>, <<"cccc">>],
        normalize_ids([<<" BBBB ">>, <<"aaaa">>, <<"bbbb">>, <<"CCCC">>])
    ).

-endif.
