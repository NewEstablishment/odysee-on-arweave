#!/usr/bin/env bash
set -euo pipefail

# Launches a single HyperBEAM node for the Odysee wallet-MIGRATION demo and
# serves the demo UI same-origin. Unlike the auth demo, this node PRE-HOSTS
# account-one's existing LBRY channel key: at boot it imports a real secp256k1
# channel key (the migration-suite fixture) into ~secret@1.0, keyed to
# account-one, persisted non-volatile. Thereafter the node signs account-one's
# requests with that MIGRATED channel identity -- the browser only decrypts
# client-side and triggers node-signing, never handling a signing key.
#
#   ./scripts/odysee-migrate-demo.sh
#   MIGRATE_DEMO_PORT=19737 ./scripts/odysee-migrate-demo.sh   # override the port
#
# In production the imported key is the user's own channel key, decrypted
# client-side from their wallet-sync blob and uploaded; the account is resolved
# via a real user/me call. Here the fixture key + demo account map stand in.

export MIGRATE_DEMO_PORT="${MIGRATE_DEMO_PORT:-18737}"
export HB_PORT="${MIGRATE_DEMO_SUPERVISOR_PORT:-0}"

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    ss -ltn "( sport = :$1 )" 2>/dev/null | grep -q ":$1"
  fi
}

if port_in_use "${MIGRATE_DEMO_PORT}"; then
  echo "Odysee migrate demo port ${MIGRATE_DEMO_PORT} is already in use."
  echo "Stop the earlier node or override the port:"
  echo "  MIGRATE_DEMO_PORT=19737 ./scripts/odysee-migrate-demo.sh"
  exit 1
fi

ERL=$(cat <<'ERL'
application:ensure_all_started(hb),

Port = list_to_integer(os:getenv("MIGRATE_DEMO_PORT")),

Accounts = #{
    <<"sess-one-laptop">> => <<"account-one">>,
    <<"sess-one-phone">>  => <<"account-one">>,
    <<"sess-two-laptop">> => <<"account-two">>
},

Hook = #{
    <<"device">> => <<"auth-hook@1.0">>,
    <<"path">> => <<"request">>,
    <<"when">> => #{
        <<"keys">> => [
            <<"x-odysee-auth-token">>, <<"odysee-auth-token">>,
            <<"x-lbry-auth-token">>, <<"cookie">>, <<"priv/cookie">>
        ]
    },
    <<"secret-provider">> => #{
        <<"device">> => <<"odysee-auth@1.0">>,
        <<"access-control">> => #{ <<"device">> => <<"odysee-auth@1.0">> }
    }
},

%% Isolate the priv-store so the non-volatile migrated wallet lands in a demo
%% directory rather than the shared cache-priv.
PrivStore = [#{ <<"store-module">> => hb_store_fs, <<"name">> => <<"cache-migrate-demo-priv">> }],

ServerWallet = ar_wallet:new(),
ServerID = hb_util:human_id(ar_wallet:to_address(ServerWallet)),

Node = hb_http_server:start_node(#{
    <<"port">> => Port,
    <<"priv-wallet">> => ServerWallet,
    <<"odysee-session-accounts">> => Accounts,
    <<"priv-store">> => PrivStore,
    <<"hyperbuddy-serve">> => #{
        <<"odysee-migrate-demo.html">> => <<"odysee-migrate-demo.html">>
    },
    <<"on">> => #{ <<"request">> => Hook }
}),

%% Bind this process to the node so the boot import reads the live node opts.
hb_http_server:set_proc_server_id(ServerID),

%% Account-one's existing LBRY channel key (the migration-suite fixture), as it
%% would arrive after client-side decrypt of the user's wallet-sync blob.
Pem = <<
    "-----BEGIN PRIVATE KEY-----\n"
    "MIGEAgEAMBAGByqGSM49AgEGBSuBBAAKBG0wawIBAQQgTR/rBa6+7FSfQGwoPYGp\n"
    "+43dVZJfzHfzf0wBO7M2vWGhRANCAATdndp4L1wmxMH4iROIkK7IUW2VPXhAu/gP\n"
    "uA+ZDDOqat4gAxdU86ss/YlmWuuaB89RIR6iurUY5v9yN5oI0akp\n"
    "-----END PRIVATE KEY-----\n"
>>,
Jwk = lbry_channel_key:pem_to_jwk(Pem),
MigratedAddress = hb_util:human_id(ar_wallet:to_address(ar_wallet:from_json(Jwk))),

Opts = hb_http_server:get_opts(#{ <<"http-server">> => ServerID }),
{ok, ImportResult} =
    hb_ao:resolve(
        #{
            <<"device">> => <<"secret@1.0">>,
            <<"access-control">> => #{ <<"device">> => <<"odysee-auth@1.0">> }
        },
        #{
            <<"path">> => <<"import">>,
            <<"persist">> => <<"non-volatile">>,
            <<"key">> => hb_escape:encode_quotes(Jwk),
            <<"cookie">> => <<"auth_token=sess-one-laptop">>
        },
        Opts
    ),
Imported = hb_maps:get(<<"imported">>, ImportResult, undefined, #{}),

%% import_wallets drops failed registrations and still returns {ok, ...}, so an
%% empty/absent `imported' means the boot import did NOT bind the migrated key.
%% Fail loudly rather than announce an identity the node cannot actually sign as.
case Imported of
    [MigratedAddress] -> ok;
    _ ->
        io:format(standard_error,
            "FATAL: boot import did not register ~s (got ~p); aborting.~n",
            [MigratedAddress, Imported]),
        halt(1)
end,

io:format("~nOdysee migrate demo is running.~n", []),
io:format("  Open: ~s~s~n", [Node, <<"~hyperbuddy@1.0/odysee-migrate-demo.html">>]),
io:format("  account-one now signs as its migrated channel identity: ~s~n", [MigratedAddress]),
io:format("  boot import confirmed: ~p~n~n", [Imported]).
ERL
)

rebar3 shell --eval "${ERL}"
