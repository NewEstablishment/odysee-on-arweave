# Local Development

## Prerequisites

Use versions that match the imported projects:

- Erlang/OTP 27
- `rebar3`
- Node.js `>=22.12.0`
- `pnpm@10.33.0`
- `make` plus a working C compiler for HyperBEAM native components

## HyperBEAM

The live HyperBEAM source lives in `hyperbeam/`. It was initialized from upstream `edge` and now includes the selected Bhavya Odysee bridge/device baseline.

```bash
cd hyperbeam
rebar3 compile
rebar3 eunit
rebar3 shell
```

Smoke test:

```bash
curl http://127.0.0.1:10000/~meta@1.0/info
curl http://127.0.0.1:10000/~odysee@1.0/index
```

Focused bridge validation:

```bash
cd hyperbeam
HB_PORT=18742 rebar3 eunit -m hb_odysee_device_test
HB_PORT=18744 rebar3 eunit -m hb_lbry_commitment,hb_lbry_codec_test,hb_lbry_remote_store_test,hb_odysee_corpus_test
```

## Two-Node Bridge Demo

The port includes a two-node demo. Node B acts as the Odysee source store. Node A acts as the edge/cache and verifies Node B's native commitments before caching.

```bash
cd hyperbeam
NODE_A_PORT=19734 NODE_B_PORT=19735 ./scripts/odysee-two-node-demo.sh
```

Useful smoke checks after the demo starts:

```bash
curl -H 'accept: application/json' http://127.0.0.1:19734/~odysee@1.0/index
curl -H 'accept: application/json' 'http://127.0.0.1:19734/~cache@1.0/read?read=odysee/stream-id/346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169'
```

The `references/` trees are now comparison snapshots only. Do not make long-lived changes there.

## Frontend

The frontend lives in `odysee-frontend/`.

```bash
cd odysee-frontend
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:19734 pnpm dev
```

When `ODYSEE_HYPERBEAM_NODE_API` is set, the branch defaults the browser to HyperBEAM mode and routes canonical reads through `~odysee@1.0`. The browser mode key is `odysee-hyperbeam-mode`; valid values are `original`, `hybrid`, and `hyperbeam`.

For the legacy-auth hosted-wallet demo, keep `ODYSEE_HYPERBEAM_LEGACY_AUTH_TRUST=local-demo` unless the HB node is running in an explicitly trusted or TEE-attested environment. The local-demo mode allows bearer auth only to localhost/loopback HB nodes. A local fake verifier can be paired with `ODYSEE_HYPERBEAM_LEGACY_AUTH_DEMO_TOKEN=demotoken` so the debug-console action works without a real logged-in session.

Frontend validation:

```bash
cd odysee-frontend
pnpm check
pnpm test:e2e:smoke
```

Run the frontend against a node that exposes the required Odysee devices before treating HyperBEAM-mode browser behavior as validated.
