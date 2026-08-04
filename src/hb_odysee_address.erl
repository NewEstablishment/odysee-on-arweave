%%% @doc Deterministic `?IS_ID'-shaped addresses for Odysee content.
%%%
%%% `GET /(id)' short-circuits to a store read only for 43, 42 or 32 byte
%%% ids. No LBRY-native identifier qualifies (claim id 40 hex, txid 64,
%%% sd-hash 96), so without this those objects are reachable only through
%%% `/~cache@1.0/read', a path rather than an id. `hb_store_odysee' links
%%% the alias to the object it materializes; the derivation is pure, so a
%%% client can address content it has never fetched.
-module(hb_odysee_address).
-compile({no_auto_import, [alias/1]}).
-export([alias/1]).

%% @doc The address of the object at a canonical `odysee/' store path.
alias(Path) when is_binary(Path) ->
    hb_util:encode(crypto:hash(sha256, <<"odysee-alias:v1:", Path/binary>>)).

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

%% Addresses must satisfy `?IS_ID' or nothing short-circuits, and must match
%% the documented derivation or another implementation cannot reproduce them.
alias_is_id_shaped_and_matches_specification_test() ->
    Path = <<"odysee/claim-id/", (binary:copy(<<"c">>, 40))/binary>>,
    ?assertEqual(43, byte_size(alias(Path))),
    ?assertEqual(
        hb_util:encode(crypto:hash(sha256, <<"odysee-alias:v1:", Path/binary>>)),
        alias(Path)
    ),
    ?assertNotEqual(alias(Path), alias(<<Path/binary, "x">>)).

-endif.
