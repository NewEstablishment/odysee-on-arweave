%%% @doc An OWNER-gated mutable reference: the "who owns this slot" companion to
%%% `~odysee-reference@1.0'. Where the reference device gates writes on the node
%%% OPERATOR (via `~meta@1.0/is-operator'), this device gates them on the
%%% per-resource OWNER -- the wallet that first wrote the slot. This is the
%%% ownership model account-level state such as user preferences needs: the
%%% account wallet owns its preferences, not whoever operates the node.
%%%
%%% On each write, `point' cryptographically verifies the request's signer
%%% commitment (`hb_message:verify') and records that committer as the slot's
%%% `owner'. The first verified write establishes ownership; a later write must be
%%% committed by that same owner or it is rejected (403). The owner is recorded as
%%% an explicit field because the cache retains only a message's content-id (hmac)
%%% commitment, not its wallet signature -- so ownership is pinned from the
%%% signature verified at write time rather than re-derived from the stored bytes.
%%% `current'/`resolve' read the stored `#{owner, preference}' back fresh (no
%%% in-memory cache), so the latest write wins and the owning wallet is
%%% observable. An unsigned (or unverifiable) write can never take ownership.
%%%
%%% Ownership is established by first-touch here, which is a demo simplification:
%%% in production the owner is the account wallet resolved by the auth system
%%% (`~secret@1.0' via `~auth-hook@1.0'), not merely the first writer, and the
%%% first-touch check-then-write is not atomic. The reference key is the caller's
%%% slot name; path separators are rejected so a key cannot steer the link outside
%%% this device's namespace.
%%%
%%% As with `~odysee-reference@1.0', every outcome is returned as `{ok, Map}'
%%% carrying an HTTP `status' (never a bare `{error, _}'), and the mutating key is
%%% `point' rather than the reserved AO-Core verb `set'.
-module(dev_odysee_owned_reference).
-implements(<<"owned-reference@1.0">>).
-device_libraries([lib_odysee_reference]).
-export([info/1, point/3, current/3, resolve/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

%%% The store namespace under which owned-reference links are kept.
-define(OWNED_CACHE, <<"owned-reference@1.0">>).

%% @doc Device info: the resolved keys this device exports.
info(_Opts) ->
    #{
        exports => [<<"point">>, <<"current">>, <<"resolve">>]
    }.

%% @doc Owner-gated write. The request must carry a verifiable signer commitment,
%% and that signer must be the slot's owner: the first verified write establishes
%% ownership; thereafter the caller must be committed by the owning wallet.
%% Stores the verified owner and the preference.
point(Base, Req, Opts) ->
    case reference_key(Base, Req, Opts) of
        {ok, NormKey} ->
            case verified_signer(lib_odysee_reference:signed_subject(Base, Req, Opts), Opts) of
                {ok, Writer} ->
                    case authorize(NormKey, Writer, Opts) of
                        true -> store(NormKey, Writer, Base, Req, Opts);
                        false -> lib_odysee_reference:unauthorized()
                    end;
                error ->
                    lib_odysee_reference:unauthorized()
            end;
        {error, Reason} ->
            lib_odysee_reference:error_response(Reason)
    end.

store(NormKey, Writer, Base, Req, Opts) ->
    case preference(Base, Req, Opts) of
        {ok, Preference} ->
            Stored = #{ <<"owner">> => Writer, <<"preference">> => Preference },
            case hb_cache:write(Stored, Opts) of
                {ok, Id} ->
                    LinkPath = link_path(NormKey),
                    ok = hb_cache:link(Id, LinkPath, Opts),
                    ?event(owned_reference,
                        {point, {key, NormKey}, {owner, Writer}, {id, Id}},
                        Opts
                    ),
                    {ok, #{
                        <<"status">> => 200,
                        <<"key">> => NormKey,
                        <<"owner">> => Writer,
                        <<"id">> => Id
                    }};
                {error, Reason} ->
                    lib_odysee_reference:error_response(Reason)
            end;
        {error, Reason} ->
            lib_odysee_reference:error_response(Reason)
    end.

%% @doc Return the CURRENT stored value for a reference key, read fresh through
%% the store so the latest owner-signed write wins.
current(Base, Req, Opts) ->
    case reference_key(Base, Req, Opts) of
        {ok, NormKey} ->
            case hb_cache:read(link_path(NormKey), Opts) of
                {ok, Value} ->
                    ?event(owned_reference,
                        {current, {key, NormKey}, {hit, true}},
                        Opts
                    ),
                    {ok, Value};
                not_found ->
                    lib_odysee_reference:error_response(not_found);
                {error, Reason} ->
                    lib_odysee_reference:error_response(Reason)
            end;
        {error, Reason} ->
            lib_odysee_reference:error_response(Reason)
    end.

%% @doc Alias for `current'.
resolve(Base, Req, Opts) ->
    current(Base, Req, Opts).

%% @doc Verify the subject's signer commitment and return the committer. An
%% unsigned message, or one whose signer commitment does not verify, yields
%% `error' -- so a forged or absent signature can never take or pass ownership,
%% regardless of whether the HTTP boundary verified the request.
verified_signer(Subject, Opts) ->
    case hb_message:signers(Subject, Opts) of
        [Writer | _] ->
            case hb_message:verify(Subject, signers, Opts) of
                true -> {ok, Writer};
                _ -> error
            end;
        [] ->
            error
    end.

%% @doc Whether a write by `Writer' (a verified committer address) is authorized:
%% it must match the slot's recorded owner. An empty slot is claimed by the
%% caller.
authorize(NormKey, Writer, Opts) ->
    case current_owner(NormKey, Opts) of
        {ok, Owner} -> Owner =:= Writer;
        no_owner -> true
    end.

%% @doc The owner of a slot: the `owner' recorded on the stored value, or
%% `no_owner' if the slot is empty.
current_owner(NormKey, Opts) ->
    case hb_cache:read(link_path(NormKey), Opts) of
        {ok, Value} ->
            case hb_maps:find(<<"owner">>, Value, Opts) of
                {ok, Owner} -> {ok, Owner};
                error -> no_owner
            end;
        _ ->
            no_owner
    end.

%% @doc The reference key, normalized. Accepts `key' or `reference'. A key
%% containing a path separator is rejected, so it cannot steer the link outside
%% this device's namespace.
reference_key(Base, Req, Opts) ->
    case lib_odysee_reference:param(Base, Req, [<<"key">>, <<"reference">>], Opts) of
        {ok, Key} ->
            NormKey = hb_ao:normalize_key(Key),
            case binary:match(NormKey, <<"/">>) of
                nomatch -> {ok, NormKey};
                _ -> {error, {invalid_key, Key}}
            end;
        Error ->
            Error
    end.

%% @doc The preference payload being written. Accepts `preference' or `value'.
preference(Base, Req, Opts) ->
    lib_odysee_reference:param(Base, Req, [<<"preference">>, <<"value">>], Opts).

link_path(NormKey) ->
    << ?OWNED_CACHE/binary, "/", NormKey/binary >>.

-ifdef(TEST).

test_opts(Tag) ->
    #{ <<"store">> => [hb_test_utils:test_store(hb_store_fs, Tag)] }.

point_req(Key, Preference) ->
    #{
        <<"device">> => ?OWNED_CACHE,
        <<"key">> => Key,
        <<"preference">> => Preference
    }.

signed_by(Wallet, Msg, Opts) ->
    hb_message:commit(Msg, Opts#{ <<"priv-wallet">> => Wallet }).

%% First verified write claims ownership and stores the preference; a
%% subsequent write by the SAME owner updates it in place.
owner_establishes_and_updates_slot_test() ->
    Owner = ar_wallet:new(),
    Opts = test_opts(<<"owned-ref-owner">>),
    Key = <<"preferences">>,
    First = signed_by(Owner, point_req(Key, <<"v1">>), Opts),
    ?assertMatch({ok, #{ <<"status">> := 200 }}, point(First, #{}, Opts)),
    {ok, Value1} = current(point_req(Key, <<>>), #{}, Opts),
    ?assertEqual(<<"v1">>, hb_maps:get(<<"preference">>, Value1, not_found, Opts)),

    Second = signed_by(Owner, point_req(Key, <<"v2">>), Opts),
    ?assertMatch({ok, #{ <<"status">> := 200 }}, point(Second, #{}, Opts)),
    {ok, Value2} = current(point_req(Key, <<>>), #{}, Opts),
    ?assertEqual(<<"v2">>, hb_maps:get(<<"preference">>, Value2, not_found, Opts)).

%% A different verified wallet cannot overwrite a slot another wallet owns.
wrong_signer_cannot_overwrite_test() ->
    Owner = ar_wallet:new(),
    Attacker = ar_wallet:new(),
    Opts = test_opts(<<"owned-ref-wrong-signer">>),
    Key = <<"preferences">>,
    ?assertMatch(
        {ok, #{ <<"status">> := 200 }},
        point(signed_by(Owner, point_req(Key, <<"owned">>), Opts), #{}, Opts)
    ),
    ?assertMatch(
        {ok, #{ <<"status">> := 403 }},
        point(signed_by(Attacker, point_req(Key, <<"hijacked">>), Opts), #{}, Opts)
    ),
    {ok, Value} = current(point_req(Key, <<>>), #{}, Opts),
    ?assertEqual(<<"owned">>, hb_maps:get(<<"preference">>, Value, not_found, Opts)).

%% An unsigned write can never take ownership.
unsigned_write_is_rejected_test() ->
    Opts = test_opts(<<"owned-ref-unsigned">>),
    ?assertMatch(
        {ok, #{ <<"status">> := 403 }},
        point(point_req(<<"preferences">>, <<"v1">>), #{}, Opts)
    ),
    ?assertMatch(
        {ok, #{ <<"status">> := 404 }},
        current(point_req(<<"preferences">>, <<>>), #{}, Opts)
    ).

%% A key with a path separator cannot steer the link out of the namespace.
key_with_separator_is_rejected_test() ->
    Owner = ar_wallet:new(),
    Opts = test_opts(<<"owned-ref-badkey">>),
    Req = signed_by(Owner, point_req(<<"../escape">>, <<"v1">>), Opts),
    ?assertMatch({ok, #{ <<"status">> := 400 }}, point(Req, #{}, Opts)).

-endif.
