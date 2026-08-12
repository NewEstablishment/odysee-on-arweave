%%% @doc `reply-id@1.0': deliver a stored message ID to commit-flag callers.
%%%
%%% A cookie secret provider appends a `set' message so its `set-cookie'
%%% reaches the response. That makes the final result the loaded message
%%% instead of the ID resolved by `id'. This request hook annotates the
%%% trailing `set' message with the first committed message's signed ID.
-module(dev_reply_id).
-implements(<<"reply-id@1.0">>).
-export([info/1, request/3]).

info(_Opts) ->
    #{ exports => [<<"request">>] }.

request(_Base, Req, Opts) ->
    Sequence = sequence_messages(hb_maps:get(<<"body">>, Req, [], Opts), Opts),
    {ok, Req#{ <<"body">> => annotate_id(Sequence, Opts) }}.

annotate_id(Sequence, Opts) ->
    WantsId =
        lists:any(
            fun(#{ <<"path">> := <<"id">> }) -> true; (_) -> false end,
            [Msg || Msg <- Sequence, is_map(Msg)]
        ),
    case [Msg || Msg <- Sequence, is_map(Msg), is_committed(Msg, Opts)] of
        [Posted | _] when WantsId ->
            Id = hb_message:id(Posted, signed, Opts),
            [
                case Msg of
                    #{ <<"path">> := <<"set">>, <<"set-cookie">> := _ } ->
                        Msg#{ <<"message-id">> => Id };
                    _ ->
                        Msg
                end
            ||
                Msg <- Sequence
            ];
        _ ->
            Sequence
    end.

is_committed(Msg, Opts) ->
    map_size(hb_maps:get(<<"commitments">>, Msg, #{}, Opts)) > 0.

sequence_messages(Sequence, _Opts) when is_list(Sequence) -> Sequence;
sequence_messages(Sequence, Opts) when is_map(Sequence) ->
    case hb_util:is_ordered_list(Sequence, Opts) of
        true -> hb_util:message_to_ordered_list(Sequence, Opts);
        false -> [Sequence]
    end;
sequence_messages(_Sequence, _Opts) -> [].
