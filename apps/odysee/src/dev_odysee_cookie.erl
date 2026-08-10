%%% @doc Stable anonymous browser identity for Odysee request signing.
-module(dev_odysee_cookie).
-implements(<<"odysee-cookie@1.0">>).
-export([info/1, generate/3, finalize/3]).

-define(COOKIE_NAME, <<"odysee-hyperbeam-secret">>).

info(_Opts) ->
    #{ exports => [<<"generate">>, <<"finalize">>] }.

generate(_Base, Request, Opts) ->
    Secret =
        case cookie_secret(Request, Opts) of
            undefined -> hb_util:encode(crypto:strong_rand_bytes(64));
            Existing -> normalize_secret(Existing)
        end,
    {ok, Request#{ <<"secret">> => [Secret] }}.

finalize(Base, Request, Opts) ->
    case {
        hb_maps:find(<<"secret">>, Base, Opts),
        hb_maps:find(<<"body">>, Request, Opts)
    } of
        {{ok, Secrets}, {ok, Sequence}} ->
            Secret = first_secret(Secrets),
            SetCookie =
                <<
                    ?COOKIE_NAME/binary, "=\"", Secret/binary,
                    "\"; Path=/; HttpOnly; SameSite=Lax"
                >>,
            {ok, Sequence ++ [
                #{ <<"path">> => <<"set">>, <<"set-cookie">> => SetCookie }
            ]};
        _ ->
            {error, no_request}
    end.

cookie_secret(Request, Opts) ->
    PrivateCookies = hb_private:get(<<"cookie">>, Request, #{}, Opts),
    case maps:get(?COOKIE_NAME, PrivateCookies, undefined) of
        undefined -> cookie_header_secret(hb_maps:get(<<"cookie">>, Request, <<>>, Opts));
        Cookie -> cookie_value(Cookie)
    end.

cookie_header_secret(Cookies) when is_list(Cookies) ->
    first_defined([cookie_header_secret(Cookie) || Cookie <- Cookies]);
cookie_header_secret(Cookies) when is_binary(Cookies) ->
    Prefix = <<?COOKIE_NAME/binary, "=">>,
    Pairs = binary:split(Cookies, <<";">>, [global]),
    first_defined([
        case binary:split(trim(Pair), <<"=">>) of
            [?COOKIE_NAME, Value] -> unquote(Value);
            _ -> undefined
        end
    || Pair <- Pairs, binary:match(trim(Pair), Prefix) =:= {0, byte_size(Prefix)}
    ]);
cookie_header_secret(_) ->
    undefined.

cookie_value(#{ <<"value">> := Value }) -> cookie_value(Value);
cookie_value(Value) when is_binary(Value) -> unquote(Value);
cookie_value(_) -> undefined.

normalize_secret(Secret) when byte_size(Secret) =:= 64 -> hb_util:encode(Secret);
normalize_secret(Secret) -> Secret.

first_secret([Secret | _]) -> normalize_secret(Secret);
first_secret(Secret) -> normalize_secret(Secret).

first_defined([undefined | Rest]) -> first_defined(Rest);
first_defined([Value | _]) -> Value;
first_defined([]) -> undefined.

trim(Value) -> string:trim(Value).

unquote(<<$\", Rest/binary>>) when byte_size(Rest) > 0 ->
    case binary:last(Rest) of
        $\" -> binary:part(Rest, 0, byte_size(Rest) - 1);
        _ -> Rest
    end;
unquote(Value) -> Value.
