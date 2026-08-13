# Odysee on HyperBEAM: store-first demo

This branch serves verified historical Odysee content and native signed writes
from a HyperBEAM store stack. It has one product frontend,
`odysee-frontend/`, and no application-device layer for claims, streams,
comments, or uploads.

## Components

| Component | Responsibility |
| --- | --- |
| `lbry@1.0` | Verifies and commits LBRY evidence. |
| `odysee-auth@1.0` | Maps an auth session to a stable account signing identity. |
| `reply-id@1.0` | Returns the stored ID for a committed write. |
| `search@1.0` | Generic full-text discovery. |
| `hb_store_odysee` | Classifies compatibility locators and sources verified immutable messages. |
| Four `hb_store_lbry_*` stores | Transactions, claim outputs, stream descriptors, and blobs. |

Cold historical reads fetch and verify source evidence, then populate local
storage. Warm reads are local. Native uploads, channels, and comments are
ordinary committed messages written through `/id` and found through generic
query/search.

## Build and start

Prerequisites: Erlang/OTP 27 or newer, `rebar3`, Node.js 22.12 or newer,
`pnpm` 10.33.0, and network access for live historical reads.

Build the canonical frontend and publish the local device store:

```sh
cd odysee-frontend
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18800 pnpm run build:manifest

cd ..
HB_PORT=18734 rebar3 device local --device-src apps/odysee/src
```

Stop the temporary `device local` node after it publishes
`_build/device-local-store`, then start a write-capable demo node. The command
below explicitly enables arbitrary tokens for local demonstration and reduces
the PBKDF2 cost so the smoke is fast. Never use either setting in production.

```sh
HB_PRELOADED_STORE=_build/device-local-store rebar3 shell --eval 'application:ensure_all_started(hackney), application:ensure_all_started(inets), Overrides = #{<<"port">> => 18800, <<"priv-wallet">> => ar_wallet:new(), <<"odysee-auth-allow-unvalidated-tokens">> => true, <<"odysee-auth-pbkdf2-iterations">> => 1, <<"odysee-auth-pbkdf2-key-length">> => 64, <<"http-extra-opts">> => #{<<"force-message">> => true, <<"cache-control">> => [<<"no-store">>]}}, Node = hb_odysee_node:start_upload(Overrides), Opts = hb_odysee_node:upload_opts(Overrides), {ok, Manifest} = hb_odysee_ui:publish("odysee-frontend/web/dist/public", Opts), io:format("~n=== NODE ~s~n=== MANIFEST ~s~n", [Node, Manifest]), receive stop -> ok end.'
```

Open the printed manifest ID:

```text
http://127.0.0.1:18800/<MANIFEST>/#/
```

`cache-control: no-store` prevents the HTTP resolution cache from pinning a
mutable locator to stale content during development.

For the normal SSR application instead of the static manifest:

```sh
cd odysee-frontend
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18800 pnpm run dev:web-server
```

Open `http://localhost:9090`. Run only one frontend supervisor.

## Verify a native write

The demo node accepts an explicit token header. A production node must validate
the token through `odysee-session-accounts` or `odysee-account-api`.

```sh
NODE=http://127.0.0.1:18800
TOKEN=local-demo-user

curl -X POST "$NODE/id?!=true&committers=all" \
  -H "x-odysee-auth-token: $TOKEN" \
  -H "content-type: video/mp4" \
  -H "type: stream" \
  -H "title: my video" \
  --data-binary @video.mp4
```

The reply is the permanent message ID. Read the bytes back with
`GET /<message-id>` and inspect the owner at:

```text
GET /<message-id>/commitments/<message-id>/committer
```

The same token produces the same signing identity. A different token produces
a different signer. Omitting the token from a committed write returns `401`.
Tokens and derived secrets are not included in the stored message.

## Verify the frontend upload flow

With HyperBEAM on `18800` and the SSR frontend on `9090`:

```sh
cd odysee-frontend
pnpm run test:native-upload-revisions
pnpm run test:hyperbeam-upload-smoke
```

The smoke writes media and a metadata root, appends a valid owner update,
injects an attacker-signed tombstone and confirms it is ignored, appends the
owner tombstone, discovers and projects the chain, and compares the served media
bytes exactly with the uploaded bytes.

## Full validation

```sh
rebar3 device test --with-core

cd odysee-frontend
pnpm run fmt:check
pnpm run typecheck:tsc
pnpm run check
node --check web/src/odyseeHyperbeamNode.js
node --check web/src/fetchStreamUrl.js
```

`--with-core` is required for store and HTTP coverage. After changing a device,
rerun `rebar3 device local --device-src apps/odysee/src` before manual node
testing; compilation does not republish the local device store.

## Current limitations

- Unpatched upstream `query@1.0` can fail on an empty result. The proposed fix
  is `patches/dev-query-match-error-tuple.patch`.
- HTTP range propagation through the cache path is incomplete, so seeking is
  weaker than whole-object playback.
- Reactions, view/subscriber counts, and full historical moderation are not
  rebuilt.
- Some dormant frontend compatibility routes still name removed Odysee product
  devices. The current upload mutation path does not use them.
- Production requires an account-resolution source; the demo's arbitrary-token
  option is deliberately unsafe outside local development.

`ARCHITECTURE_READ_PATH.md` traces the verified historical read path in detail.
