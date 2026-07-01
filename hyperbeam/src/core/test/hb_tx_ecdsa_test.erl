-module(hb_tx_ecdsa_test).
-include_lib("eunit/include/eunit.hrl").
-include("include/hb.hrl").

ecdsa_commitment_verifies_test() ->
    Wallet = ar_wallet:new_ecdsa(),
    Opts = #{ <<"priv-wallet">> => Wallet },
    Committed =
        hb_message:commit(
            #{ <<"tag1">> => <<"value1">> },
            Opts,
            #{ <<"device">> => <<"tx@1.0">>, <<"type">> => ?ECDSA_SIGN_TYPE }
        ),
    ?assert(hb_message:verify(Committed, all, Opts)),
    {ok, _, Commitment} =
        hb_message:commitment(
            #{ <<"commitment-device">> => <<"tx@1.0">> },
            Committed,
            Opts
        ),
    ?assertEqual(?ECDSA_SIGN_TYPE, hb_maps:get(<<"type">>, Commitment, not_found, Opts)).
