#!/usr/bin/env bash
set -euo pipefail

export NODE_PORT="${NODE_PORT:-18744}"
export NODE_CACHE="${NODE_CACHE:-_build/odysee-meili-node-cache}"
export HB_PORT="${HB_DEMO_SUPERVISOR_PORT:-0}"
export MEILI_PORT="${MEILI_PORT:-7700}"
export MEILI_CONTAINER="${MEILI_CONTAINER:-odysee-hyperbeam-meili}"
export MEILI_IMAGE="${MEILI_IMAGE:-getmeili/meilisearch:v1.37}"
export MEILI_DATA="${MEILI_DATA:-$(pwd)/_build/odysee-meili-data}"
export MEILI_INDEX="${MEILI_INDEX:-odysee_claims}"
export MEILI_URL="${MEILI_URL:-http://127.0.0.1:${MEILI_PORT}}"
export USE_SUDO_DOCKER="${USE_SUDO_DOCKER:-0}"

export PATH="/opt/homebrew/opt/rust/bin:/opt/homebrew/opt/erlang@27/bin:/opt/homebrew/bin:${PATH}"

docker_cmd() {
  if [ "${USE_SUDO_DOCKER}" = "1" ]; then
    sudo docker "$@"
  else
    docker "$@"
  fi
}

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

if port_in_use "${NODE_PORT}"; then
  echo "Odysee Meilisearch demo port conflict."
  echo "  NODE_PORT=${NODE_PORT} is already in use."
  echo
  echo "Use the existing node, stop it, or override the port:"
  echo "  NODE_PORT=19744 ./scripts/odysee-meili-search-demo.sh"
  exit 1
fi

mkdir -p "${MEILI_DATA}"

if docker_cmd ps -a --format '{{.Names}}' | grep -Fxq "${MEILI_CONTAINER}"; then
  docker_cmd rm -f "${MEILI_CONTAINER}" >/dev/null
fi

docker_cmd pull "${MEILI_IMAGE}"
docker_cmd run -d \
  --name "${MEILI_CONTAINER}" \
  -p "${MEILI_PORT}:7700" \
  -e MEILI_ENV=development \
  -v "${MEILI_DATA}:/meili_data" \
  "${MEILI_IMAGE}" >/dev/null

for _ in $(seq 1 40); do
  if curl -fsS "${MEILI_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl -fsS "${MEILI_URL}/health" >/dev/null

ERL=$(cat <<'ERL'
application:ensure_all_started(hb),

Port = list_to_integer(os:getenv("NODE_PORT")),
NodeCache = unicode:characters_to_binary(os:getenv("NODE_CACHE")),
MeiliURL = unicode:characters_to_binary(os:getenv("MEILI_URL")),
MeiliIndex = unicode:characters_to_binary(os:getenv("MEILI_INDEX")),

LocalStore = #{
    <<"store-module">> => hb_store_fs,
    <<"name">> => NodeCache
},
Node = hb_http_server:start_node(#{
    <<"port">> => Port,
    <<"store">> => LocalStore,
    <<"force-signed">> => false,
    <<"meili-url">> => MeiliURL,
    <<"meili-index">> => MeiliIndex
}),

io:format("~nOdysee Meilisearch demo is running.~n", []),
io:format("  HyperBEAM node: ~s~n", [Node]),
io:format("  Meilisearch: ~s~n", [MeiliURL]),
io:format("  Meilisearch index: ~s~n", [MeiliIndex]),
io:format("~nHealth check:~n", []),
io:format("  curl -sS '~s~s/health' | jq .~n", [Node, <<"~odysee-search@1.0">>]),
io:format("~nIndex a demo document:~n", []),
io:format("  curl -sS -X POST -H 'content-type: application/json' --data-binary '{\"documents\":[{\"id\":\"demo-1\",\"claimId\":\"demo-1\",\"name\":\"hyperbeam-meili-demo\",\"title\":\"HyperBEAM Meilisearch Demo\",\"description\":\"Search indexed through HyperBEAM\"}]}' '~s~s/index' | jq .~n", [Node, <<"~odysee-search@1.0">>]),
io:format("~nIndex legacy Odysee claim_search results:~n", []),
io:format("  curl -sS -X POST -H 'content-type: application/json' --data-binary '{\"query\":\"s=nature&size=5&claimType=file\",\"pages\":1}' '~s~s/index-legacy' | jq .~n", [Node, <<"~odysee-search@1.0">>]),
io:format("~nQuery Meilisearch through HyperBEAM:~n", []),
io:format("  curl -sS '~s~s/query?q=hyperbeam&limit=5' | jq .~n", [Node, <<"~odysee-search@1.0">>]),
io:format("  curl -sS '~s~s/query?q=nature&limit=5' | jq .~n", [Node, <<"~odysee-search@1.0">>]),
io:format("  curl -sS '~s~s/search?meili=true&query=s%3Dhyperbeam%26size%3D5' | jq .~n~n", [Node, <<"~odysee-search@1.0">>]).
ERL
)

rebar3 shell --eval "${ERL}"
