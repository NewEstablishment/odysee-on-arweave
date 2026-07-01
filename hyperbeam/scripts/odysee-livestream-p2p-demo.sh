#!/usr/bin/env bash
set -euo pipefail

export NODE_PORT="${NODE_PORT:-8734}"
export NODE_CACHE="${NODE_CACHE:-_build/odysee-livestream-p2p-cache}"
export HB_PORT="${HB_DEMO_SUPERVISOR_PORT:-0}"

export PATH="/opt/homebrew/opt/rust/bin:/opt/homebrew/opt/erlang@27/bin:/opt/homebrew/bin:${PATH}"

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

if port_in_use "${NODE_PORT}"; then
  echo "Odysee livestream P2P demo port conflict."
  echo "  NODE_PORT=${NODE_PORT} is already in use."
  echo
  echo "Use the existing node, stop it, or override the port:"
  echo "  NODE_PORT=18734 ./scripts/odysee-livestream-p2p-demo.sh"
  exit 1
fi

ERL=$(cat <<'ERL'
application:ensure_all_started(hb),

NodePort = list_to_integer(os:getenv("NODE_PORT")),
NodeCache = unicode:characters_to_binary(os:getenv("NODE_CACHE")),

Node = hb_http_server:start_node(#{
    <<"port">> => NodePort,
    <<"store">> => [
        #{
            <<"store-module">> => hb_store_fs,
            <<"name">> => NodeCache
        }
    ],
    <<"force-signed">> => false
}),

io:format("~nOdysee livestream P2P demo is running.~n", []),
io:format("  HyperBEAM node: ~s~n", [Node]),
io:format("  Frontend env: ODYSEE_HYPERBEAM_NODE_API=~s~n", [Node]),
io:format("  Room check: curl -sS -X POST -H 'content-type: application/json' '~s~s' -d '{\"room_id\":\"demo\",\"peer_id\":\"check\",\"role\":\"viewer\"}' | jq .~n~n", [Node, <<"/~odysee-livestream-p2p@1.0/announce">>]).
ERL
)

rebar3 shell --eval "${ERL}"
