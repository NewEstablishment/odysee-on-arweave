%%% @doc Tests for the `reference@1.0' record device: a mutable reference
%%% created by an init record and moved only by authority-committed set records
%%% with strictly newer timestamps.
%%%
%%% Includes the settings-as-reference act: a user's settings live in a
%%% reference whose authority is the user's account wallet -- the account
%%% updates its own settings, anyone retrieves the latest, and a foreign wallet
%%% cannot move them.
%%%
%%% Offline: a fresh fs store and real wallets, no network.
-module(hb_reference_test).
-include_lib("eunit/include/eunit.hrl").
-include("include/hb.hrl").

%% @doc A fresh Opts with a private fs store.
opts(Tag) ->
    #{ <<"store">> => [hb_test_utils:test_store(hb_store_fs, Tag)] }.

%% @doc Create a reference carrying `Value', signed by `Wallet'; returns the
%% device's response map.
create(Value, Wallet, Opts) ->
    Msg = #{
        <<"device">> => <<"reference@1.0">>,
        <<"reference-value">> => Value
    },
    Signed = hb_message:commit(Msg, Opts#{ <<"priv-wallet">> => Wallet }),
    hb_ao:resolve(Signed, <<"create">>, Opts).

%% @doc Move `ReferenceID' to `Value' at `Timestamp', signed by `Wallet'.
update(ReferenceID, Value, Timestamp, Wallet, Opts) ->
    Msg = #{
        <<"device">> => <<"reference@1.0">>,
        <<"reference-id">> => ReferenceID,
        <<"reference-value">> => Value,
        <<"timestamp">> => Timestamp
    },
    Signed = hb_message:commit(Msg, Opts#{ <<"priv-wallet">> => Wallet }),
    hb_ao:resolve(Signed, <<"update">>, Opts).

%% @doc Resolve `current' and return `{Value, Authority, Timestamp, Source}'.
current(ReferenceID, Opts) ->
    Base = #{
        <<"device">> => <<"reference@1.0">>,
        <<"reference-id">> => ReferenceID
    },
    {ok, State} = hb_ao:resolve(Base, <<"current">>, Opts),
    {
        hb_ao:get(<<"reference-value">>, State, not_found, Opts),
        hb_ao:get(<<"authority">>, State, not_found, Opts),
        hb_util:int(hb_ao:get(<<"timestamp">>, State, 0, Opts)),
        hb_ao:get(<<"source">>, State, not_found, Opts)
    }.

address(Wallet) ->
    hb_util:human_id(ar_wallet:to_address(Wallet)).

%% @doc An init record creates a reference whose authority is its committer and
%% whose value reads back.
create_defaults_authority_to_committer_test() ->
    Opts = opts(<<"ref-create">>),
    Wallet = ar_wallet:new(),
    {ok, Created} = create(<<"v1">>, Wallet, Opts),
    ?assertMatch(#{ <<"status">> := 200 }, Created),
    ReferenceID = hb_ao:get(<<"reference-id">>, Created, not_found, Opts),
    ?assertNotEqual(not_found, ReferenceID),
    ?assertEqual(
        {<<"v1">>, address(Wallet), 0, <<"init">>},
        current(ReferenceID, Opts)
    ).

%% @doc An authority-committed set with a strictly newer timestamp moves the
%% reference; the resolved state reflects the new value.
authority_update_with_newer_timestamp_applies_test() ->
    Opts = opts(<<"ref-update">>),
    Wallet = ar_wallet:new(),
    {ok, Created} = create(<<"v1">>, Wallet, Opts),
    ReferenceID = hb_ao:get(<<"reference-id">>, Created, not_found, Opts),
    ?assertMatch(
        {ok, #{ <<"status">> := 200 }},
        update(ReferenceID, <<"v2">>, 10, Wallet, Opts)
    ),
    ?assertEqual(
        {<<"v2">>, address(Wallet), 10, <<"set">>},
        current(ReferenceID, Opts)
    ).

%% @doc A set committed by a wallet other than the authority is rejected (403)
%% and the state is unchanged.
foreign_update_rejected_test() ->
    Opts = opts(<<"ref-foreign">>),
    Authority = ar_wallet:new(),
    Foreign = ar_wallet:new(),
    {ok, Created} = create(<<"v1">>, Authority, Opts),
    ReferenceID = hb_ao:get(<<"reference-id">>, Created, not_found, Opts),
    ?assertMatch(
        {ok, #{ <<"status">> := 403 }},
        update(ReferenceID, <<"hijack">>, 10, Foreign, Opts)
    ),
    ?assertEqual(
        {<<"v1">>, address(Authority), 0, <<"init">>},
        current(ReferenceID, Opts)
    ).

%% @doc A set whose timestamp is not strictly newer is rejected (409) and the
%% state is unchanged.
stale_timestamp_rejected_test() ->
    Opts = opts(<<"ref-stale">>),
    Wallet = ar_wallet:new(),
    {ok, Created} = create(<<"v1">>, Wallet, Opts),
    ReferenceID = hb_ao:get(<<"reference-id">>, Created, not_found, Opts),
    ?assertMatch(
        {ok, #{ <<"status">> := 200 }},
        update(ReferenceID, <<"v2">>, 10, Wallet, Opts)
    ),
    ?assertMatch(
        {ok, #{ <<"status">> := 409 }},
        update(ReferenceID, <<"replay">>, 10, Wallet, Opts)
    ),
    ?assertMatch(
        {ok, #{ <<"status">> := 409 }},
        update(ReferenceID, <<"older">>, 3, Wallet, Opts)
    ),
    ?assertEqual(
        {<<"v2">>, address(Wallet), 10, <<"set">>},
        current(ReferenceID, Opts)
    ).

%% @doc An unsigned init cannot create a reference (403), and an unknown
%% reference id resolves to 404.
unsigned_create_and_unknown_id_test() ->
    Opts = opts(<<"ref-unsigned">>),
    Unsigned = #{
        <<"device">> => <<"reference@1.0">>,
        <<"reference-value">> => <<"v1">>
    },
    ?assertMatch(
        {ok, #{ <<"status">> := 403 }},
        hb_ao:resolve(Unsigned, <<"create">>, Opts)
    ),
    Missing = #{
        <<"device">> => <<"reference@1.0">>,
        <<"reference-id">> => <<"does-not-exist">>
    },
    ?assertMatch(
        {ok, #{ <<"status">> := 404 }},
        hb_ao:resolve(Missing, <<"current">>, Opts)
    ).

%% @doc An explicit `authority' on an init overrides the committer (the
%% bootstrap-publisher shape): the named authority can move the reference and
%% the creating publisher cannot.
explicit_authority_overrides_committer_test() ->
    Opts = opts(<<"ref-bootstrap">>),
    Publisher = ar_wallet:new(),
    User = ar_wallet:new(),
    Msg = #{
        <<"device">> => <<"reference@1.0">>,
        <<"reference-value">> => <<"v1">>,
        <<"authority">> => address(User)
    },
    Signed = hb_message:commit(Msg, Opts#{ <<"priv-wallet">> => Publisher }),
    {ok, Created} = hb_ao:resolve(Signed, <<"create">>, Opts),
    ReferenceID = hb_ao:get(<<"reference-id">>, Created, not_found, Opts),
    ?assertMatch(
        {ok, #{ <<"status">> := 403 }},
        update(ReferenceID, <<"publisher-move">>, 10, Publisher, Opts)
    ),
    ?assertMatch(
        {ok, #{ <<"status">> := 200 }},
        update(ReferenceID, <<"user-move">>, 10, User, Opts)
    ),
    ?assertEqual(
        {<<"user-move">>, address(User), 10, <<"set">>},
        current(ReferenceID, Opts)
    ).

%% @doc The settings act: a user's settings are a reference whose authority is
%% the user's account wallet. The account updates its own settings, the latest
%% version is retrievable by reference id, and a foreign account cannot move it.
settings_as_reference_test() ->
    Opts = opts(<<"ref-settings">>),
    AccountWallet = ar_wallet:new(),
    ForeignAccount = ar_wallet:new(),
    {ok, Created} = create(<<"theme=dark">>, AccountWallet, Opts),
    ReferenceID = hb_ao:get(<<"reference-id">>, Created, not_found, Opts),
    ?assertMatch(
        {ok, #{ <<"status">> := 200 }},
        update(ReferenceID, <<"theme=light">>, 1, AccountWallet, Opts)
    ),
    ?assertMatch(
        {ok, #{ <<"status">> := 403 }},
        update(ReferenceID, <<"theme=hacked">>, 2, ForeignAccount, Opts)
    ),
    ?assertEqual(
        {<<"theme=light">>, address(AccountWallet), 1, <<"set">>},
        current(ReferenceID, Opts)
    ).
