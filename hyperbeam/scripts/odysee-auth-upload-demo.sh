#!/usr/bin/env bash
set -euo pipefail

export NODE_PORT="${NODE_PORT:-18736}"
export NODE_CACHE="${NODE_CACHE:-_build/odysee-auth-upload-cache}"
export DEMO_TOKEN="${DEMO_TOKEN:-demotoken}"
export DEMO_USER_ID="${DEMO_USER_ID:-424242}"
export DEMO_CHANNEL_ID="${DEMO_CHANNEL_ID:-local-demo-channel}"
export LEGACY_AUTH_URL="${LEGACY_AUTH_URL:-}"
export LEGACY_AUTH_TOKEN_MODE="${LEGACY_AUTH_TOKEN_MODE:-form}"
export LEGACY_AUTH_PEPPER="${LEGACY_AUTH_PEPPER:-local-demo-pepper}"
export HB_PORT="${HB_DEMO_SUPERVISOR_PORT:-0}"

export PATH="/opt/homebrew/opt/rust/bin:/opt/homebrew/opt/erlang@27/bin:/opt/homebrew/bin:${PATH}"

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

if port_in_use "${NODE_PORT}"; then
  echo "Odysee auth upload demo port conflict."
  echo "  NODE_PORT=${NODE_PORT} is already in use."
  echo
  echo "Use the existing node, stop it, or override the port:"
  echo "  NODE_PORT=19736 ./scripts/odysee-auth-upload-demo.sh"
  exit 1
fi

ERL=$(cat <<'ERL'
application:ensure_all_started(hb),

Port = list_to_integer(os:getenv("NODE_PORT")),
NodeCache = unicode:characters_to_binary(os:getenv("NODE_CACHE")),
DemoToken = unicode:characters_to_binary(os:getenv("DEMO_TOKEN")),
DemoUserID = unicode:characters_to_binary(os:getenv("DEMO_USER_ID")),
DemoChannelID = unicode:characters_to_binary(os:getenv("DEMO_CHANNEL_ID")),
LegacyAuthURL = unicode:characters_to_binary(os:getenv("LEGACY_AUTH_URL")),
LegacyAuthTokenMode = unicode:characters_to_binary(os:getenv("LEGACY_AUTH_TOKEN_MODE")),
LegacyAuthPepper = unicode:characters_to_binary(os:getenv("LEGACY_AUTH_PEPPER")),

LocalStore = #{
    <<"store-module">> => hb_store_fs,
    <<"name">> => NodeCache
},
VerifierConfig =
    case LegacyAuthURL of
        <<>> ->
            #{ <<"trusted-token-users">> => #{ DemoToken => DemoUserID } };
        _ ->
            #{
                <<"legacy-auth-url">> => LegacyAuthURL,
                <<"legacy-auth-token-mode">> => LegacyAuthTokenMode
            }
    end,
LegacyAuthAccessControl = maps:merge(VerifierConfig, #{
    <<"device">> => <<"odysee-legacy-auth@1.0">>,
    <<"legacy-auth-pepper">> => LegacyAuthPepper
}),
LegacyAuthProvider = LegacyAuthAccessControl#{
    <<"access-control">> => LegacyAuthAccessControl
},
CurlToken =
    case LegacyAuthURL of
        <<>> -> DemoToken;
        _ -> <<"<auth-token>">>
    end,
Node = hb_http_server:start_node(#{
    <<"port">> => Port,
    <<"store">> => LocalStore,
    <<"force-signed">> => false,
    <<"on">> => #{
        <<"request">> => #{
            <<"device">> => <<"auth-hook@1.0">>,
            <<"path">> => <<"request">>,
            <<"when">> => #{
                <<"keys">> => [
                    <<"authorization">>,
                    <<"!">>,
                    <<"auth_token">>,
                    <<"auth-token">>,
                    <<"x-lbry-auth-token">>,
                    <<"X-Lbry-Auth-Token">>,
                    <<"cookie">>
                ]
            },
            <<"secret-provider">> => LegacyAuthProvider
        }
    }
}),

io:format("~nOdysee auth upload demo is running.~n", []),
io:format("  Node: ~s~n", [Node]),
io:format("  Store: ~s~n", [NodeCache]),
io:format("  Demo channel id: ~s~n", [DemoChannelID]),
case LegacyAuthURL of
    <<>> ->
        io:format("  Legacy auth verifier: local trusted-token-users map~n", []),
        io:format("  Demo token: ~s~n", [DemoToken]),
        io:format("  Demo user id: ~s~n", [DemoUserID]);
    _ ->
        io:format("  Legacy auth verifier: ~s~n", [LegacyAuthURL]),
        io:format("  Legacy auth token mode: ~s~n", [LegacyAuthTokenMode]),
        io:format("  Paste a real Odysee auth_token in the debug console or curl header.~n", [])
end,
io:format("~nFrontend env:~n", []),
io:format("  ODYSEE_HYPERBEAM_NODE_API=~s~n", [Node]),
io:format("  ODYSEE_HYPERBEAM_LEGACY_AUTH_TRUST=local-demo~n", []),
case LegacyAuthURL of
    <<>> ->
        io:format("  ODYSEE_HYPERBEAM_LEGACY_AUTH_DEMO_TOKEN=~s~n", [DemoToken]);
    _ ->
io:format("  ODYSEE_HYPERBEAM_LEGACY_AUTH_DEMO_TOKEN=~n", [])
end,
io:format("~nAuth proof check:~n", []),
io:format("  curl -sS -H 'accept: application/json' -H 'x-lbry-auth-token: ~s' '~scommitments?!&body=odysee-auth-demo' | jq .~n", [CurlToken, Node]),
io:format("~nUpload proof check:~n", []),
io:format("  printf 'hello hyperbeam upload demo' | curl -sS -X POST -H 'accept: application/json' -H 'x-lbry-auth-token: ~s' -H 'content-type: text/plain' --data-binary @- '~s~s/upload?!&filename=demo.txt&content-type=text/plain&channel-id=~s&channel-name=@hyperbeam-demo&claim-name=native-demo&title=Native%20demo&description=Stored%20directly%20in%20HyperBEAM&tags=hyperbeam,native&thumbnail-url=https%3A%2F%2Fexample.test%2Fthumb.jpg' | jq .~n", [CurlToken, Node, <<"~odysee-upload-demo@1.0">>, DemoChannelID]),
io:format("  curl -sS '~s~s/channel?channel-id=~s&legacy-claim-ids=legacy-a,legacy-b' | jq .~n", [Node, <<"~odysee-upload-demo@1.0">>, DemoChannelID]),
io:format("  curl -i -sS -X POST -H 'content-type: text/plain' --data-binary '{\"items\":[{\"claim_id\":\"legacy-a\",\"name\":\"legacy-video\",\"value_type\":\"stream\",\"value\":{\"title\":\"Legacy video\",\"source\":{\"media_type\":\"video/mp4\",\"sd_hash\":\"legacy-sd\"}}}],\"page\":1,\"page_size\":20,\"total_items\":1}' '~s~s/search?channel_ids=~s&claim_type=stream' | sed -n '/^total-items:/p;/^claim-ids+link:/p'~n", [Node, <<"~odysee-claim@1.0">>, DemoChannelID]),
io:format("  curl -sS '~s~s/read?id=<upload-id>'~n~n", [Node, <<"~odysee-upload-demo@1.0">>]).
ERL
)

rebar3 shell --eval "${ERL}"
