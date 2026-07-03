%%% @doc Tests for the owner-gated mutable reference device
%%% (`~owned-reference@1.0'): a slot whose writes are gated on the per-resource
%%% OWNER (the wallet that first wrote it), not the node operator.
%%%
%%% These exercise the device directly with real wallets (no auth hook): the
%%% first signed write establishes ownership and its committer is observable on
%%% read-back; the same owner updates in place; a foreign wallet's write is
%%% rejected (403) and does not mutate the slot; an unsigned write cannot take
%%% ownership. The auth demo (`hb_odysee_auth_test') exercises the same device
%%% through the account wallet minted by `~auth-hook@1.0'/`~secret@1.0'.
%%%
%%% Offline: a fresh fs store and real wallets, no network.
-module(hb_odysee_owned_reference_test).
-include_lib("eunit/include/eunit.hrl").
-include("include/hb.hrl").

%% @doc A fresh Opts with a private fs store.
opts(Tag) ->
    #{ <<"store">> => [hb_test_utils:test_store(hb_store_fs, Tag)] }.

%% @doc Commit a preference-write to `Key' carrying `Preference', signed by
%% `Wallet', and resolve the device's `point'.
point(Key, Preference, Wallet, Opts) ->
    Msg =
        #{
            <<"device">> => <<"owned-reference@1.0">>,
            <<"key">> => Key,
            <<"preference">> => Preference
        },
    Signed = hb_message:commit(Msg, Opts#{ <<"priv-wallet">> => Wallet }),
    hb_ao:resolve(Signed, <<"point">>, Opts).

%% @doc Resolve `current' for `Key' and return `{Preference, Owner}'.
current(Key, Opts) ->
    Base = #{ <<"device">> => <<"owned-reference@1.0">>, <<"key">> => Key },
    {ok, Value} = hb_ao:resolve(Base, <<"current">>, Opts),
    Preference = hb_ao:get(<<"preference">>, Value, not_found, Opts),
    Owner = hb_ao:get(<<"owner">>, Value, not_found, Opts),
    {Preference, Owner}.

address(Wallet) ->
    hb_util:human_id(ar_wallet:to_address(Wallet)).

%% @doc The first signed write establishes ownership; a read-back returns the
%% stored preference and its committer is the owning wallet.
first_write_establishes_owner_and_readback_committer_test() ->
    Opts = opts(<<"owned-first">>),
    Wallet = ar_wallet:new(),
    Key = <<"prefs:account-one">>,
    ?assertMatch({ok, #{ <<"status">> := 200 }}, point(Key, <<"theme=dark">>, Wallet, Opts)),
    ?assertEqual({<<"theme=dark">>, address(Wallet)}, current(Key, Opts)).

%% @doc The owner updates the slot in place; the latest value wins and the
%% committer is still the owner.
owner_updates_in_place_test() ->
    Opts = opts(<<"owned-update">>),
    Wallet = ar_wallet:new(),
    Key = <<"prefs:account-one">>,
    ?assertMatch({ok, #{ <<"status">> := 200 }}, point(Key, <<"theme=dark">>, Wallet, Opts)),
    ?assertMatch({ok, #{ <<"status">> := 200 }}, point(Key, <<"theme=light">>, Wallet, Opts)),
    ?assertEqual({<<"theme=light">>, address(Wallet)}, current(Key, Opts)).

%% @doc A foreign wallet's write to an owned slot is rejected (403) and the
%% slot's value is unchanged.
foreign_writer_rejected_test() ->
    Opts = opts(<<"owned-foreign">>),
    Owner = ar_wallet:new(),
    Foreign = ar_wallet:new(),
    Key = <<"prefs:account-one">>,
    ?assertMatch({ok, #{ <<"status">> := 200 }}, point(Key, <<"theme=dark">>, Owner, Opts)),
    ?assertMatch({ok, #{ <<"status">> := 403 }}, point(Key, <<"hijack">>, Foreign, Opts)),
    ?assertEqual({<<"theme=dark">>, address(Owner)}, current(Key, Opts)).

%% @doc An unsigned write cannot take ownership of an empty slot (403).
unsigned_write_rejected_test() ->
    Opts = opts(<<"owned-unsigned">>),
    Key = <<"prefs:account-one">>,
    Unsigned =
        #{
            <<"device">> => <<"owned-reference@1.0">>,
            <<"key">> => Key,
            <<"preference">> => <<"theme=dark">>
        },
    ?assertMatch(
        {ok, #{ <<"status">> := 403 }},
        hb_ao:resolve(Unsigned, <<"point">>, Opts)
    ).
