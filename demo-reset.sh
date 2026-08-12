#!/bin/bash
# Reset the demo DATA (drop uploads + accounts) WITHOUT touching the UI. The UI
# lives in a read-only filesystem store named `ui-store' -- deliberately NOT in
# the `cache-*' namespace, so `rm -rf cache-*' (clearing the data caches) can
# never delete it. It also survives crashes because fs writes are synchronous.
#
# After running this, start the node in THIS terminal with:
#     HB_CONFIG=config.json rebar3 shell
#
# If you REBUILT the frontend and want the new bundle served, first run:
#     rm -rf ui-store .demo-manifest
# then run this script; it will republish the UI once.
set -e
cd "$(dirname "$0")"

echo "==> Stopping any node on 18801..."
lsof -nP -tiTCP:18801 -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true
pkill -9 -f "rebar3 shell" 2>/dev/null || true
sleep 3
rm -f erl_crash.dump

echo "==> Wiping upload/account data (UI is kept)..."
rm -rf cache-odysee-demo cache-http

if [ ! -s .demo-manifest ] || [ ! -d ui-store ]; then
  echo "==> UI store missing; publishing the UI once into ui-store (~30s)..."
  MAN=$(HB_PORT=0 HB_PRELOADED_STORE=_build/device-local-store rebar3 shell --eval '
    application:ensure_all_started(hackney),
    Store = #{ <<"store-module">> => hb_store_fs, <<"name">> => <<"ui-store">> },
    {ok, M} = hb_odysee_ui:publish("odysee-frontend/web/dist/public", #{ <<"store">> => [Store] }),
    io:format("~n===MANIFEST=== ~s~n", [M]),
    halt(0).' < <(sleep 240) 2>&1 | grep -a "===MANIFEST===" | tail -1 | awk '{print $2}')
  echo "$MAN" > .demo-manifest
fi

MAN=$(cat .demo-manifest)
echo ""
echo "==> Clean slate ready. Now start the node in THIS terminal:"
echo ""
echo "    HB_CONFIG=config.json rebar3 shell"
echo ""
echo "Then open:"
echo "    http://127.0.0.1:18801/${MAN}/#/"
