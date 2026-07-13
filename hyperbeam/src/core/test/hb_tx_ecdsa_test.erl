%%% @doc Reproducible core test for the `tx@1.0' ECDSA (secp256k1) commitment
%%% (Phase 3 #9). `dev_tx' is a preloaded device excluded from `src_dirs', so its
%%% in-module tests cannot be run via `rebar3 eunit --module=dev_tx'; this core
%%% test exercises the same path through the public `hb_message' API, so it runs
%%% under standard `rebar3 eunit'. Offline: a real secp256k1 wallet, no network.
-module(hb_tx_ecdsa_test).
-include_lib("eunit/include/eunit.hrl").
-include("include/hb.hrl").

-define(ECDSA_TYPE, <<"ecdsa-secp256k1-sha256">>).

ecdsa_commitment_verifies_test() ->
    Wallet = ar_wallet:new_ecdsa(),
    Opts = #{ <<"priv-wallet">> => Wallet },
    Structured = #{ <<"tag1">> => <<"value1">> },
    Committed =
        hb_message:commit(
            Structured,
            Opts,
            #{ <<"device">> => <<"tx@1.0">>, <<"type">> => ?ECDSA_TYPE }
        ),
    ?assert(hb_message:verify(Committed, all, Opts)),
    {ok, _, Commitment} =
        hb_message:commitment(
            #{ <<"commitment-device">> => <<"tx@1.0">> },
            Committed,
            Opts
        ),
    ?assertEqual(
        ?ECDSA_TYPE,
        hb_maps:get(<<"type">>, Commitment, not_found, Opts)
    ).

ecdsa_commitment_rejects_tamper_test() ->
    Wallet = ar_wallet:new_ecdsa(),
    Opts = #{ <<"priv-wallet">> => Wallet },
    Committed =
        hb_message:commit(
            #{ <<"tag1">> => <<"value1">> },
            Opts,
            #{ <<"device">> => <<"tx@1.0">>, <<"type">> => ?ECDSA_TYPE }
        ),
    Tampered = Committed#{ <<"tag1">> => <<"tampered">> },
    ?assertNot(hb_message:verify(Tampered, all, Opts)).

rsa_wallet_rejected_for_ecdsa_commitment_test() ->
    Wallet = ar_wallet:new(?RSA_KEY_TYPE),
    Opts = #{ <<"priv-wallet">> => Wallet },
    ?assertThrow(
        {wrong_wallet_to_sign,
            {request_type, ?ECDSA_TYPE},
            {wallet_type, ?RSA_KEY_TYPE}},
        hb_message:commit(
            #{ <<"tag1">> => <<"value1">> },
            Opts,
            #{ <<"device">> => <<"tx@1.0">>, <<"type">> => ?ECDSA_TYPE }
        )
    ).

ecdsa_wallet_rejected_for_rsa_commitment_test() ->
    Wallet = ar_wallet:new_ecdsa(),
    Opts = #{ <<"priv-wallet">> => Wallet },
    ?assertThrow(
        {wrong_wallet_to_sign,
            {request_type, ?RSA_SIGN_TYPE},
            {wallet_type, ?ECDSA_KEY_TYPE}},
        hb_message:commit(
            #{ <<"tag1">> => <<"value1">> },
            Opts,
            #{ <<"device">> => <<"tx@1.0">>, <<"type">> => ?RSA_SIGN_TYPE }
        )
    ).
