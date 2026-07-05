%%% @doc Offline tests for the `~odysee-auth@1.0' secret-provider device
%%% (`dev_odysee_auth'), wired as the secret-provider of `~auth-hook@1.0', plus
%%% an end-to-end demonstration of the Odysee hosted-wallet auth model.
%%%
%%% The baseline tests assert the provider contract: a request carrying a known
%%% Odysee cookie becomes committed after the hook runs; the same token twice
%%% derives the identical key (determinism), whether it arrives as a raw `cookie'
%%% header, an `authorization' header, or the parsed `priv/cookie' map the HTTP
%%% layer leaves; and a request with no token is left uncommitted (pass-through).
%%%
%%% The demo then exercises the account model agreed in the design discussions:
%%% <ol>
%%%   <li>onboarding: a session mints a node-hosted wallet, the user never
%%%       handling a key;</li>
%%%   <li>login as access: the same session reaches the same wallet;</li>
%%%   <li>ACCOUNT identity: many session tokens of one account share ONE wallet;</li>
%%%   <li>isolation: distinct accounts get distinct wallets;</li>
%%%   <li>account-owned preferences: the account wallet writes a preference via
%%%       `~owned-reference@1.0', any of its sessions updates the same slot, a
%%%       read-back shows the account wallet as owner, and a foreign account's
%%%       write is rejected;</li>
%%%   <li>token validation: on a node configured with a session->account map, an
%%%       unknown token is rejected rather than minting a wallet.</li>
%%% </ol>
%%%
%%% Over-the-wire variants drive a real Cowboy server: a session presented as a
%%% browser `Cookie' header fires the hook (the gate matches the reshaped
%%% `priv/cookie') and signs, deriving the SAME wallet as the equivalent
%%% `Authorization' header.
%%%
%%% All tests are offline: real wallets (`ar_wallet:new'), an ephemeral port
%%% (`port => 0'), no network. In-process acts drive the genuine `~auth-hook@1.0'
%%% handler (the `request'/`body' contract `dev_meta:resolve_hook' builds).
-module(hb_odysee_auth_test).
-include_lib("eunit/include/eunit.hrl").
-include("include/hb.hrl").
-include("include/lbry_test_keys.hrl").

%%% ==================== Shared helpers ====================

%% @doc The secret-provider hook base wiring `~odysee-auth@1.0' as both the
%% secret-provider and the `~secret@1.0' access-control device. The `when' gate
%% fires on a top-level `cookie' or `authorization' key (the in-process shape) or
%% a `priv/cookie' key (the shape a browser cookie takes over real HTTP, once the
%% `~cookie@1.0' codec has reshaped the inbound `Cookie' header). A request with
%% none of these -- an anonymous request -- does not fire the hook.
hook_base() ->
    #{
        <<"device">> => <<"auth-hook@1.0">>,
        <<"path">> => <<"request">>,
        <<"when">> => #{
            <<"keys">> =>
                [<<"authorization">>, <<"cookie">>, <<"priv/cookie">>]
        },
        <<"secret-provider">> =>
            #{
                <<"device">> => <<"odysee-auth@1.0">>,
                <<"access-control">> =>
                    #{ <<"device">> => <<"odysee-auth@1.0">> }
            }
    }.

%% @doc Start a live node and return its server id, so that the `~secret@1.0'
%% device the hook calls can read/persist node options. The server id is the
%% operator wallet's address (see `hb_http_server:new_server'), which lets us
%% recover the live options from the Cowboy environment on each hook run.
start_live_node(ServerWallet) ->
    _Node = hb_http_server:start_node(#{
        <<"port">> => 0,
        <<"priv-wallet">> => ServerWallet
    }),
    ServerID = hb_util:human_id(ar_wallet:to_address(ServerWallet)),
    hb_http_server:set_proc_server_id(ServerID),
    ServerID.

%% @doc The current server-bound options for the live node.
server_opts(ServerID) ->
    hb_http_server:get_opts(#{ <<"http-server">> => ServerID }).

%% @doc Run the `~auth-hook@1.0' request hook over a request, mirroring the
%% `request'/`body' shape that `dev_meta:resolve_hook' builds. Options are read
%% fresh from the live node so that a wallet minted by `~secret@1.0' on a prior
%% run is visible (and therefore reused) on the next.
run_hook(Request, ServerID) ->
    hb_ao:resolve(
        hook_base(),
        #{
            <<"path">> => <<"request">>,
            <<"request">> => Request,
            <<"body">> => [Request]
        },
        server_opts(ServerID)
    ).

%% @doc Return the signers of a message, excluding the node's own operator
%% wallet (which is not relevant to whether the client request was committed by
%% the hook).
client_signers(Msg, ServerAddress, Opts) ->
    [
        Signer
    ||
        Signer <- hb_message:signers(Msg, Opts),
        Signer =/= ServerAddress
    ].

%%% ==================== Baseline provider contract ====================

%% @doc A request carrying a known Odysee cookie becomes committed after the
%% hook runs, and the same cookie yields the identical signing wallet across
%% requests (determinism observed end-to-end through the hook + `~secret@1.0').
cookie_commits_request_test() ->
    ServerWallet = ar_wallet:new(),
    ServerID = start_live_node(ServerWallet),
    ServerAddress = hb_util:human_id(ar_wallet:to_address(ServerWallet)),
    Cookie = <<"auth_token=odysee-session-known">>,
    Request =
        #{
            <<"path">> => <<"hello">>,
            <<"body">> => <<"Test data">>,
            <<"cookie">> => Cookie
        },
    {ok, #{ <<"request">> := Signed }} = run_hook(Request, ServerID),
    Signers = client_signers(Signed, ServerAddress, server_opts(ServerID)),
    ?event({cookie_commits, {found_signers, Signers}}),
    ?assertEqual(1, length(Signers)),
    [Signer] = Signers,
    % A second request with the same cookie must be signed by the same address,
    % demonstrating the determinism of the derived secret end-to-end.
    Request2 = Request#{ <<"body">> => <<"Test data 2">> },
    {ok, #{ <<"request">> := Signed2 }} = run_hook(Request2, ServerID),
    ?assertEqual(
        [Signer],
        client_signers(Signed2, ServerAddress, server_opts(ServerID))
    ).

%% @doc The same cookie always derives the identical secret/key. Asserted by
%% invoking the device's `generate' key directly through AO-Core, twice, and
%% comparing the returned keys.
deterministic_secret_test() ->
    Provider = #{ <<"device">> => <<"odysee-auth@1.0">> },
    Cookie = <<"auth_token=odysee-session-deterministic">>,
    Req = #{ <<"path">> => <<"generate">>, <<"cookie">> => Cookie },
    {ok, Key1} = hb_ao:resolve(Provider, Req, #{}),
    {ok, Key2} = hb_ao:resolve(Provider, Req, #{}),
    ?event({deterministic_secret, {key1, Key1}, {key2, Key2}}),
    ?assert(is_binary(Key1)),
    ?assertEqual(Key1, Key2),
    % A different cookie must derive a different key.
    {ok, OtherKey} =
        hb_ao:resolve(
            Provider,
            #{
                <<"path">> => <<"generate">>,
                <<"cookie">> => <<"auth_token=different-session">>
            },
            #{}
        ),
    ?assertNotEqual(Key1, OtherKey).

%% @doc The `authorization' header is used as a fallback source for the Odysee
%% token when no `cookie' is present, and it too is derived deterministically.
authorization_fallback_test() ->
    Provider = #{ <<"device">> => <<"odysee-auth@1.0">> },
    Req =
        #{
            <<"path">> => <<"generate">>,
            <<"authorization">> => <<"Bearer odysee-token-abc">>
        },
    {ok, Key1} = hb_ao:resolve(Provider, Req, #{}),
    {ok, Key2} = hb_ao:resolve(Provider, Req, #{}),
    ?assert(is_binary(Key1)),
    ?assertEqual(Key1, Key2).

%% @doc The token delivered as a parsed cookie under `priv/cookie' (exactly as
%% the HTTP layer leaves it after running an inbound `cookie' header through the
%% `~cookie@1.0' codec, before the request hook runs) derives the SAME secret/key
%% as the equivalent raw `cookie' header. This proves cross-path determinism: the
%% same Odysee session yields the same node-hosted wallet whether the token
%% arrived in-process (raw header) or over real HTTP (parsed into `priv/cookie').
priv_cookie_matches_raw_cookie_test() ->
    Provider = #{ <<"device">> => <<"odysee-auth@1.0">> },
    Cookie = <<"auth_token=odysee-session-crosspath">>,
    % The raw-header path: the token arrives as the `cookie' header verbatim.
    {ok, RawKey} =
        hb_ao:resolve(
            Provider,
            #{ <<"path">> => <<"generate">>, <<"cookie">> => Cookie },
            #{}
        ),
    % The real-HTTP path: the `~cookie@1.0' codec has already parsed the inbound
    % `cookie' header, stripped the raw key, and stored the parsed token under
    % `priv/cookie'. We reproduce that exact post-parse shape directly, with no
    % raw `cookie' key present.
    Reshaped =
        hb_private:set(
            #{ <<"path">> => <<"generate">> },
            <<"cookie">>,
            #{ <<"auth_token">> => <<"odysee-session-crosspath">> },
            #{}
        ),
    ?assertEqual(undefined, maps:get(<<"cookie">>, Reshaped, undefined)),
    {ok, PrivKey} = hb_ao:resolve(Provider, Reshaped, #{}),
    ?event({priv_cookie_crosspath, {raw_key, RawKey}, {priv_key, PrivKey}}),
    ?assert(is_binary(PrivKey)),
    ?assertEqual(RawKey, PrivKey),
    % A different session delivered via `priv/cookie' must derive a different key.
    OtherReshaped =
        hb_private:set(
            #{ <<"path">> => <<"generate">> },
            <<"cookie">>,
            #{ <<"auth_token">> => <<"odysee-session-other">> },
            #{}
        ),
    {ok, OtherKey} = hb_ao:resolve(Provider, OtherReshaped, #{}),
    ?assertNotEqual(PrivKey, OtherKey).

%% @doc A request with no cookie (and no authorization header) is left
%% uncommitted: the `when' condition does not match, so the hook passes the
%% request through unchanged and adds no client signature.
no_cookie_passthrough_test() ->
    ServerWallet = ar_wallet:new(),
    ServerID = start_live_node(ServerWallet),
    ServerAddress = hb_util:human_id(ar_wallet:to_address(ServerWallet)),
    Request =
        #{
            <<"path">> => <<"hello">>,
            <<"body">> => <<"Test data">>
        },
    {ok, Result} = run_hook(Request, ServerID),
    Opts = server_opts(ServerID),
    Signed = hb_maps:get(<<"request">>, Result, Request, Opts),
    ?assertEqual(
        [],
        client_signers(Signed, ServerAddress, Opts)
    ).

%%% ==================== Demo: the account model ====================

%% Three sessions across two accounts. Tokens are opaque and per-installation;
%% the account map resolves each to its owning account, exactly as Odysee's
%% `user/me' resolves an `auth_token' to an account.
-define(ACCOUNT_ONE, <<"account-one">>).
-define(ACCOUNT_TWO, <<"account-two">>).

%% @doc The node's session->account map, keyed on the BARE `auth_token' value.
%% The provider extracts the bare token from either a cookie or an
%% `authorization' header, so one entry per session serves both encodings.
accounts() ->
    #{
        <<"sess-one-laptop">> => ?ACCOUNT_ONE,
        <<"sess-one-phone">> => ?ACCOUNT_ONE,
        <<"sess-two-laptop">> => ?ACCOUNT_TWO,
        %% A credential from a DIFFERENT auth method (a username/password-derived
        %% token) that also resolves to account-one. In production the mapping is
        %% one `~secret' commitment per method (email, username+password, cookie);
        %% here the account map stands in for that resolution.
        <<"pw:account-one">> => ?ACCOUNT_ONE
    }.

%% @doc Wrap a bare session token as an Odysee `auth_token' cookie header.
cookie(Token) ->
    <<"auth_token=", Token/binary>>.

%% @doc Start a live node carrying the session->account map and an isolated
%% on-disk store (so owned-reference writes do not bleed across tests), bound to
%% this process so a minted wallet is reused across hook runs.
start_account_node(Tag) ->
    ServerWallet = ar_wallet:new(),
    _Node =
        hb_http_server:start_node(#{
            <<"port">> => 0,
            <<"priv-wallet">> => ServerWallet,
            <<"store">> => [hb_test_utils:test_store(hb_store_fs, Tag)],
            <<"odysee-session-accounts">> => accounts()
        }),
    ServerID = hb_util:human_id(ar_wallet:to_address(ServerWallet)),
    hb_http_server:set_proc_server_id(ServerID),
    ServerID.

%% @doc Sign a bare request carrying the given session cookie through the hook,
%% returning the single client wallet address that signed it, or `none'.
signer_via_cookie(Token, ServerID) ->
    Request =
        #{
            <<"path">> => <<"preferences">>,
            <<"body">> => <<"probe">>,
            <<"cookie">> => cookie(Token)
        },
    {ok, #{ <<"request">> := Signed }} = run_hook(Request, ServerID),
    case client_signers(Signed, ServerID, server_opts(ServerID)) of
        [Signer] -> Signer;
        [] -> none
    end.

%% @doc Sign a bare request carrying the given session token as an
%% `authorization' header (a different credential encoding/method than a cookie),
%% returning the single client wallet address that signed it, or `none'.
signer_via_auth(Token, ServerID) ->
    Request =
        #{
            <<"path">> => <<"preferences">>,
            <<"body">> => <<"probe">>,
            <<"authorization">> => <<"Bearer ", Token/binary>>
        },
    {ok, #{ <<"request">> := Signed }} = run_hook(Request, ServerID),
    case client_signers(Signed, ServerID, server_opts(ServerID)) of
        [Signer] -> Signer;
        [] -> none
    end.

%% @doc Act 1 -- onboarding. A session the node has never seen mints a hosted
%% wallet; the user supplied only a cookie and never handled a key.
onboarding_mints_wallet_test() ->
    ServerID = start_account_node(<<"onboard">>),
    ?assertNotEqual(none, signer_via_cookie(<<"sess-one-laptop">>, ServerID)).

%% @doc Act 2 -- login as access. Presenting the same session again reaches the
%% same hosted wallet.
login_reuses_wallet_test() ->
    ServerID = start_account_node(<<"login">>),
    First = signer_via_cookie(<<"sess-one-laptop">>, ServerID),
    Second = signer_via_cookie(<<"sess-one-laptop">>, ServerID),
    ?assertNotEqual(none, First),
    ?assertEqual(First, Second).

%% @doc Act 3 -- ACCOUNT identity (the crux). Two different session tokens that
%% resolve to the same account share ONE wallet.
sessions_of_one_account_share_wallet_test() ->
    ServerID = start_account_node(<<"account">>),
    Laptop = signer_via_cookie(<<"sess-one-laptop">>, ServerID),
    Phone = signer_via_cookie(<<"sess-one-phone">>, ServerID),
    ?assertNotEqual(none, Laptop),
    ?assertEqual(Laptop, Phone).

%% @doc Act 4 -- isolation. A session of a different account gets a different
%% wallet, so account state cannot cross accounts.
distinct_accounts_are_isolated_test() ->
    ServerID = start_account_node(<<"isolation">>),
    One = signer_via_cookie(<<"sess-one-laptop">>, ServerID),
    Two = signer_via_cookie(<<"sess-two-laptop">>, ServerID),
    ?assertNotEqual(none, One),
    ?assertNotEqual(none, Two),
    ?assertNotEqual(One, Two).

%% @doc Write a preference to `~owned-reference@1.0' as the account behind
%% `Token': the hook signs the request with the account wallet, and the signed
%% request is routed to the device's `point'. Returns the device response.
write_pref(Token, Key, Preference, ServerID) ->
    Request =
        #{
            <<"device">> => <<"owned-reference@1.0">>,
            <<"key">> => Key,
            <<"preference">> => Preference,
            <<"cookie">> => cookie(Token)
        },
    {ok, #{ <<"request">> := Signed }} = run_hook(Request, ServerID),
    hb_ao:resolve(Signed, <<"point">>, server_opts(ServerID)).

%% @doc Read a preference slot back, returning `{Preference, Owner}'.
read_pref(Key, ServerID) ->
    Opts = server_opts(ServerID),
    Base = #{ <<"device">> => <<"owned-reference@1.0">>, <<"key">> => Key },
    {ok, Value} = hb_ao:resolve(Base, <<"current">>, Opts),
    {
        hb_ao:get(<<"preference">>, Value, not_found, Opts),
        hb_ao:get(<<"owner">>, Value, not_found, Opts)
    }.

%% @doc Act 5 -- account-owned preferences. The account wallet writes a
%% preference; a second session of the SAME account updates the same slot; a
%% read-back shows the account wallet as owner and the latest value; a different
%% account's write is rejected (403) and does not mutate the slot.
preferences_owned_by_account_test() ->
    ServerID = start_account_node(<<"prefs">>),
    Owner = signer_via_cookie(<<"sess-one-laptop">>, ServerID),
    Key = <<"prefs:account-one">>,
    ?assertMatch(
        {ok, #{ <<"status">> := 200 }},
        write_pref(<<"sess-one-laptop">>, Key, <<"theme=dark">>, ServerID)
    ),
    ?assertMatch(
        {ok, #{ <<"status">> := 200 }},
        write_pref(<<"sess-one-phone">>, Key, <<"theme=light">>, ServerID)
    ),
    ?assertEqual({<<"theme=light">>, Owner}, read_pref(Key, ServerID)),
    ?assertMatch(
        {ok, #{ <<"status">> := 403 }},
        write_pref(<<"sess-two-laptop">>, Key, <<"hijack">>, ServerID)
    ),
    ?assertEqual({<<"theme=light">>, Owner}, read_pref(Key, ServerID)).

%% @doc Token validation. On a node configured with a session->account map, a
%% mapped session signs, but an UNKNOWN token is rejected (401) rather than
%% self-resolving into a wallet -- an unknown session is not a valid credential.
token_validation_rejects_unknown_test() ->
    ServerID = start_account_node(<<"tokenval">>),
    ?assertNotEqual(none, signer_via_cookie(<<"sess-one-laptop">>, ServerID)),
    Request =
        #{
            <<"path">> => <<"preferences">>,
            <<"body">> => <<"probe">>,
            <<"cookie">> => cookie(<<"sess-unknown">>)
        },
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        run_hook(Request, ServerID)
    ).

%% @doc Multiple auth methods, one wallet. A session presented as a cookie and a
%% username/password-derived credential presented as an `authorization' header
%% both resolve to account-one, so they share ONE wallet -- the property behind
%% "one `~secret' commitment per method, all reaching the same wallet".
multiple_methods_one_wallet_test() ->
    ServerID = start_account_node(<<"multimethod">>),
    ViaCookie = signer_via_cookie(<<"sess-one-laptop">>, ServerID),
    ViaPassword = signer_via_auth(<<"pw:account-one">>, ServerID),
    ?assertNotEqual(none, ViaCookie),
    ?assertEqual(ViaCookie, ViaPassword).

%% @doc Import an existing wallet (JSON-encoded) into `~secret@1.0', bound to the
%% account that `Token' resolves to via the `~odysee-auth@1.0' access-control, so
%% the account's sessions subsequently sign with it.
import_wallet(WalletJson, Token, ServerID) ->
    hb_ao:resolve(
        #{
            <<"device">> => <<"secret@1.0">>,
            <<"access-control">> => #{ <<"device">> => <<"odysee-auth@1.0">> }
        },
        #{
            <<"path">> => <<"import">>,
            <<"key">> => hb_escape:encode_quotes(WalletJson),
            <<"cookie">> => cookie(Token)
        },
        server_opts(ServerID)
    ).

%% @doc Migration of an existing user's wallet. An ECDSA secp256k1 key -- the
%% LBRY wallet key type, standing in for a user's existing wallet exported from
%% the SDK/wallet servers -- is imported into `~secret@1.0' keyed to the account;
%% thereafter the account's sessions sign with the IMPORTED wallet rather than a
%% freshly-minted one, preserving the user's existing identity. In production the
%% account is resolved via `user/me' and the key is the user's own LBRY key.
migration_imports_existing_wallet_test() ->
    ServerID = start_account_node(<<"migration">>),
    Existing = {PrivKey, _} = ar_wallet:new_ecdsa(),
    ExistingAddress = hb_util:human_id(ar_wallet:to_address(Existing)),
    ?assertMatch(
        {ok, _},
        import_wallet(ar_wallet:to_json(PrivKey), <<"sess-one-laptop">>, ServerID)
    ),
    ?assertEqual(
        ExistingAddress,
        signer_via_cookie(<<"sess-one-laptop">>, ServerID)
    ).

%% @doc Migration of REAL LBRY channel keys through the full pipeline. Each key
%% is a genuine secp256k1 channel key recovered from an LBRY wallet-sync blob;
%% `lbry_channel_key:pem_to_jwk' converts its PEM to the JWK `~secret@1.0'
%% imports, and it is bound to an account. Two distinct users' channel keys are
%% migrated to two accounts: each account's session then signs with ITS migrated
%% channel identity (the address derived from the real key), and the two accounts
%% remain isolated. This is the account map + `pem_to_jwk' standing in for the
%% production path (decrypt the sync blob upstream, resolve the account via
%% `user/me', import the user's own channel key).
migration_imports_real_lbry_channel_keys_test() ->
    ServerID = start_account_node(<<"real-migration">>),
    [{PemOne, _}, {PemTwo, _} | _] = ?LBRY_CHANNEL_KEYS,
    MigratedAddress =
        fun(Pem) ->
            Jwk = lbry_channel_key:pem_to_jwk(Pem),
            Wallet = ar_wallet:from_json(Jwk),
            {Jwk, hb_util:human_id(ar_wallet:to_address(Wallet))}
        end,
    {JwkOne, AddressOne} = MigratedAddress(PemOne),
    {JwkTwo, AddressTwo} = MigratedAddress(PemTwo),
    ?assertMatch({ok, _}, import_wallet(JwkOne, <<"sess-one-laptop">>, ServerID)),
    ?assertMatch({ok, _}, import_wallet(JwkTwo, <<"sess-two-laptop">>, ServerID)),
    ?assertEqual(AddressOne, signer_via_cookie(<<"sess-one-laptop">>, ServerID)),
    ?assertEqual(AddressOne, signer_via_cookie(<<"sess-one-phone">>, ServerID)),
    ?assertEqual(AddressTwo, signer_via_cookie(<<"sess-two-laptop">>, ServerID)),
    ?assertNotEqual(AddressOne, AddressTwo).

%% @doc The `odysee-account-api' option resolves tokens with a real `user/me'
%% call against an Odysee internal-apis deployment. Mocked here with the
%% envelope shapes the production API returns: two sessions the API attributes
%% to one user id share ONE wallet, distinct users differ, an API-rejected
%% token is 401, and an unreachable API is 502 -- an outage is never mistaken
%% for a bad credential (and never a silent self-resolve fallback).
account_api_resolves_user_me_test() ->
    {ok, ApiURL, Handle} =
        hb_mock_server:start([{"/user/me", user_me, fun user_me_mock/1}]),
    Opts = #{ <<"odysee-account-api">> => ApiURL },
    Provider = #{ <<"device">> => <<"odysee-auth@1.0">> },
    Generate =
        fun(Token) ->
            hb_ao:resolve(
                Provider,
                #{
                    <<"path">> => <<"generate">>,
                    <<"authorization">> => <<"Bearer ", Token/binary>>
                },
                Opts
            )
        end,
    {ok, Laptop} = Generate(<<"api-sess-laptop">>),
    {ok, Phone} = Generate(<<"api-sess-phone">>),
    ?assertEqual(Laptop, Phone),
    {ok, Foreign} = Generate(<<"api-sess-other">>),
    ?assertNotEqual(Laptop, Foreign),
    ?assertMatch(
        {error, #{ <<"status">> := 401 }},
        Generate(<<"api-sess-expired">>)
    ),
    hb_mock_server:stop(Handle),
    ?assertMatch(
        {error, #{ <<"status">> := 502 }},
        Generate(<<"api-sess-laptop">>)
    ).

%% @doc A `user/me' handler answering with the production envelope shapes: a
%% form-encoded `auth_token' parameter in, a `{"success", "error", "data"}'
%% JSON envelope out, the user record's `id' identifying the account. Two
%% tokens belong to one user, one to another, anything else is rejected the
%% way the production API rejects an invalid token (403, `success: false').
user_me_mock(Req) ->
    Query = hb_maps:get(<<"body">>, Req, <<>>, #{}),
    Params = maps:from_list(uri_string:dissect_query(Query)),
    case maps:get(<<"auth_token">>, Params, undefined) of
        <<"api-sess-laptop">> -> user_me_user(777);
        <<"api-sess-phone">> -> user_me_user(777);
        <<"api-sess-other">> -> user_me_user(888);
        _ ->
            {403,
                hb_json:encode(#{
                    <<"success">> => false,
                    <<"error">> =>
                        <<"you are not authorized to perform this action">>,
                    <<"data">> => null
                })
            }
    end.

user_me_user(Id) ->
    {200,
        hb_json:encode(#{
            <<"success">> => true,
            <<"error">> => null,
            <<"data">> => #{ <<"id">> => Id, <<"has_verified_email">> => true }
        })
    }.

%%% ==================== Over-the-wire ====================

%% @doc Start a live HTTP node with the request hook and session->account map
%% installed on `on/request', returning the node URL and its operator wallet.
http_node() ->
    ServerWallet = ar_wallet:new(),
    Node =
        hb_http_server:start_node(#{
            <<"port">> => 0,
            <<"priv-wallet">> => ServerWallet,
            <<"odysee-session-accounts">> => accounts(),
            <<"on">> => #{ <<"request">> => hook_base() }
        }),
    {Node, ServerWallet}.

%% @doc Send a request over real HTTP carrying the session as an `Authorization'
%% header, returning the single client signer address (or `none').
http_signer_via_auth(Node, Token, ServerWallet) ->
    {ok, Response} =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"pref">>,
                <<"authorization">> => <<"Bearer ", Token/binary>>
            },
            #{}
        ),
    one_signer(hb_test_utils:client_commitment_signers(Response, ServerWallet)).

%% @doc Send a request over real HTTP carrying the session as a browser `Cookie'
%% header, returning the single client signer address (or `none'). The HTTP layer
%% reshapes the inbound cookie into `priv/cookie' before the hook runs; the gate
%% matches it there, so the hook fires and signs.
http_signer_via_cookie(Node, Token, ServerWallet) ->
    {ok, Response} =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"pref">>,
                <<"cookie">> => cookie(Token)
            },
            #{}
        ),
    one_signer(hb_test_utils:client_commitment_signers(Response, ServerWallet)).

one_signer([Signer]) -> Signer;
one_signer([]) -> none;
one_signer(Signers) -> Signers.

%% @doc Act 1 over the wire -- a session presented over real HTTP mints a
%% node-hosted wallet that signs the request.
http_onboarding_over_the_wire_test() ->
    {Node, ServerWallet} = http_node(),
    ?assertNotEqual(
        none,
        http_signer_via_auth(Node, <<"sess-one-laptop">>, ServerWallet)
    ).

%% @doc Acts 3 & 4 over the wire -- two sessions of one account signed by one
%% wallet, a different account by a different wallet, all over real HTTP.
http_account_identity_over_the_wire_test() ->
    {Node, ServerWallet} = http_node(),
    Laptop = http_signer_via_auth(Node, <<"sess-one-laptop">>, ServerWallet),
    Phone = http_signer_via_auth(Node, <<"sess-one-phone">>, ServerWallet),
    Foreign = http_signer_via_auth(Node, <<"sess-two-laptop">>, ServerWallet),
    ?assertNotEqual(none, Laptop),
    ?assertEqual(Laptop, Phone),
    ?assertNotEqual(Laptop, Foreign).

%% @doc The browser cookie fires the hook over the wire. A session delivered as
%% a `Cookie' header (reshaped by the HTTP layer into `priv/cookie' before the
%% hook runs) derives the SAME wallet as the equivalent `Authorization' header --
%% closing the gap where a reshaped cookie could not match the gate.
http_cookie_fires_over_the_wire_test() ->
    {Node, ServerWallet} = http_node(),
    ViaBearer = http_signer_via_auth(Node, <<"sess-one-laptop">>, ServerWallet),
    ViaCookie = http_signer_via_cookie(Node, <<"sess-one-laptop">>, ServerWallet),
    ?assertNotEqual(none, ViaCookie),
    ?assertEqual(ViaBearer, ViaCookie).

%% @doc Start a live HTTP node over a caller-provided store, so two nodes can
%% share one store (the wallet-sync analog of a ring).
shared_store_node(Store) ->
    ServerWallet = ar_wallet:new(),
    Node =
        hb_http_server:start_node(#{
            <<"port">> => 0,
            <<"priv-wallet">> => ServerWallet,
            <<"store">> => Store,
            <<"odysee-session-accounts">> => accounts(),
            <<"on">> => #{ <<"request">> => hook_base() }
        }),
    {Node, ServerWallet}.

%% @doc Sign over real HTTP asking `~secret@1.0' to persist the minted wallet
%% non-volatilely (to the shared store), returning the single client signer.
http_signer_persisted(Node, Token, ServerWallet) ->
    {ok, Response} =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"pref">>,
                <<"authorization">> => <<"Bearer ", Token/binary>>,
                <<"persist">> => <<"non-volatile">>
            },
            #{}
        ),
    one_signer(hb_test_utils:client_commitment_signers(Response, ServerWallet)).

%% @doc Cross-node wallet sync (the ring / wallet-sync property). Two independent
%% nodes share one non-volatile store. The same account, presented to each node,
%% resolves to the SAME hosted wallet -- node B reuses the wallet node A minted
%% and persisted -- so a user's identity follows them across nodes, not just
%% across the sessions of one node (which Act 3 shows). A different account still
%% resolves to a different wallet on both.
cross_node_sync_test() ->
    Store = [hb_test_utils:test_store(hb_store_fs, <<"crossnode">>)],
    {NodeA, WalletA} = shared_store_node(Store),
    {NodeB, WalletB} = shared_store_node(Store),
    OnA = http_signer_persisted(NodeA, <<"sess-one-laptop">>, WalletA),
    OnB = http_signer_persisted(NodeB, <<"sess-one-laptop">>, WalletB),
    ?assertNotEqual(none, OnA),
    ?assertEqual(OnA, OnB),
    OtherOnB = http_signer_persisted(NodeB, <<"sess-two-laptop">>, WalletB),
    ?assertNotEqual(OnB, OtherOnB).

%% @doc The temporary demo UI is served same-origin by the node itself (via the
%% `hyperbuddy-serve' option), so a browser page can reach the node's endpoints
%% with its own cookie and no CORS. Asserts the page is served as HTML.
frontend_served_same_origin_test() ->
    ServerWallet = ar_wallet:new(),
    Node =
        hb_http_server:start_node(#{
            <<"port">> => 0,
            <<"priv-wallet">> => ServerWallet,
            <<"odysee-session-accounts">> => accounts(),
            <<"hyperbuddy-serve">> =>
                #{ <<"odysee-demo.html">> => <<"odysee-demo.html">> },
            <<"on">> => #{ <<"request">> => hook_base() }
        }),
    {ok, Response} =
        hb_http:get(Node, <<"/~hyperbuddy@1.0/odysee-demo.html">>, #{}),
    ContentType = hb_maps:get(<<"content-type">>, Response, <<>>, #{}),
    Body = hb_maps:get(<<"body">>, Response, <<>>, #{}),
    ?assertNotEqual(nomatch, binary:match(ContentType, <<"text/html">>)),
    ?assertNotEqual(nomatch, binary:match(Body, <<"Auth Demo">>)).
