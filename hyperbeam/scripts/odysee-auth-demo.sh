#!/usr/bin/env bash
set -euo pipefail

# Launches a single HyperBEAM node wired for the Odysee hosted-wallet auth demo
# and serves the demo UI same-origin, so a browser's own cookie reaches the auth
# endpoints with no CORS. Open the printed URL and click through the views.
#
#   ./scripts/odysee-auth-demo.sh
#   AUTH_DEMO_PORT=19736 ./scripts/odysee-auth-demo.sh   # override the port

export AUTH_DEMO_PORT="${AUTH_DEMO_PORT:-18736}"
export HB_PORT="${AUTH_DEMO_SUPERVISOR_PORT:-0}"

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    ss -ltn "( sport = :$1 )" 2>/dev/null | grep -q ":$1"
  fi
}

if port_in_use "${AUTH_DEMO_PORT}"; then
  echo "Odysee auth demo port ${AUTH_DEMO_PORT} is already in use."
  echo "Stop the earlier node or override the port:"
  echo "  AUTH_DEMO_PORT=19736 ./scripts/odysee-auth-demo.sh"
  exit 1
fi

ERL=$(cat <<'ERL'
application:ensure_all_started(hb),

Port = list_to_integer(os:getenv("AUTH_DEMO_PORT")),

%% Session token -> account. Two tokens of account-one (laptop + phone), one of
%% account-two, plus a password-derived credential of account-one; the stand-in
%% for Odysee's user/me lookup. Absent this map every token self-resolves.
Accounts = #{
    <<"sess-one-laptop">> => <<"account-one">>,
    <<"sess-one-phone">>  => <<"account-one">>,
    <<"sess-two-laptop">> => <<"account-two">>,
    <<"pw:account-one">>  => <<"account-one">>
},

%% The on/request hook: fire on an authorization header, a raw cookie, or the
%% reshaped priv/cookie (the shape a browser cookie takes over real HTTP), then
%% derive/reuse the account's hosted wallet via ~odysee-auth@1.0 / ~secret@1.0.
Hook = #{
    <<"device">> => <<"auth-hook@1.0">>,
    <<"path">> => <<"request">>,
    <<"when">> => #{
        <<"keys">> => [<<"authorization">>, <<"cookie">>, <<"priv/cookie">>]
    },
    <<"secret-provider">> => #{
        <<"device">> => <<"odysee-auth@1.0">>,
        <<"access-control">> => #{ <<"device">> => <<"odysee-auth@1.0">> }
    }
},

Node = hb_http_server:start_node(#{
    <<"port">> => Port,
    <<"priv-wallet">> => ar_wallet:new(),
    <<"odysee-session-accounts">> => Accounts,
    <<"hyperbuddy-serve">> => #{ <<"odysee-demo.html">> => <<"odysee-demo.html">> },
    <<"on">> => #{ <<"request">> => Hook }
}),

io:format("~nOdysee auth demo is running.~n", []),
io:format("  Open: ~s~s~n~n", [Node, <<"~hyperbuddy@1.0/odysee-demo.html">>]).
ERL
)

rebar3 shell --eval "${ERL}"
