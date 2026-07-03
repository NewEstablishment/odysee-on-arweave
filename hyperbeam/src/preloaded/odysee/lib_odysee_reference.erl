%%% @doc Helpers shared by the odysee reference devices (`~odysee-reference@1.0'
%%% and `~owned-reference@1.0'): request-parameter extraction, the signed-subject
%%% selector, and the unified `{ok, #{status => ...}}' response shapes. Factored
%%% here (a statically-bundled `lib_' module) so the two sibling devices share one
%%% copy of the parameter/response contract rather than duplicating it.
-module(lib_odysee_reference).
-export([param/4, param_paths/3, signed_subject/3, unauthorized/0, error_response/1]).
-include("include/hb.hrl").

%% @doc Read the first present, non-empty binary value among `Keys' from either
%% the request or the base message.
param(Base, Req, Keys, Opts) ->
    case hb_maps:get_first(param_paths(Base, Req, Keys), not_found, Opts) of
        Value when is_binary(Value), byte_size(Value) > 0 -> {ok, Value};
        _ -> {error, {missing_required, hd(Keys)}}
    end.

%% @doc The (message, key) lookup pairs for `param', trying the request before
%% the base for each key.
param_paths(Base, Req, Keys) ->
    lists:flatmap(
        fun(Key) ->
            [{Req, Key}, {Base, Key}]
        end,
        Keys
    ).

%% @doc Prefer whichever of the request or base carries a commitment, so a
%% signer check sees the signer regardless of invocation shape (a committed
%% message resolved in-process as the base, or a signed HTTP request body). On an
%% unsigned request the request is returned.
signed_subject(Base, Req, Opts) ->
    case hb_message:signers(Req, Opts) of
        [] ->
            case hb_message:signers(Base, Opts) of
                [] -> Req;
                _ -> Base
            end;
        _ ->
            Req
    end.

%% @doc The 403 response. Carried as `{ok, #{status => 403}}' (never a bare
%% `{error, _}') so the reserved-`set'-verb `hb_util:ok' wrapper cannot throw and
%% the HTTP layer maps the status directly.
unauthorized() ->
    {ok, #{ <<"status">> => 403, <<"message">> => <<"Unauthorized.">> }}.

%% @doc Map an internal error reason to an `{ok, #{status => ...}}' response.
error_response(not_found) ->
    {ok, #{ <<"status">> => 404, <<"message">> => <<"Reference not found.">> }};
error_response({missing_required, Key}) ->
    {ok, #{
        <<"status">> => 400,
        <<"message">> => <<"Missing required field.">>,
        <<"field">> => Key
    }};
error_response({invalid_key, Key}) ->
    {ok, #{
        <<"status">> => 400,
        <<"message">> => <<"Invalid reference key.">>,
        <<"field">> => Key
    }};
error_response(Reason) ->
    {ok, #{
        <<"status">> => 500,
        <<"message">> => hb_util:bin(io_lib:format("~p", [Reason]))
    }}.
