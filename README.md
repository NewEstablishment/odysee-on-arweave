# odysee-on-arweave

Odysee on Arweave / HyperBEAM monorepo.

## Layout

| Path | Source | Role |
| --- | --- | --- |
| `hyperbeam/` | `NewEstablishment/odysee-on-arweave`, current live branch `rave/auth-upload`, commit `6211ae3` | Main HyperBEAM source of truth for this monorepo. Keep upstream edge alignment deliberate. |
| `odysee-frontend/` | `NewEstablishment/odysee-on-arweave`, current live branch `rave/auth-upload`, commit `6211ae3` | Odysee web client with HyperBEAM integration work. |
| `references/hyperbeam-bhavya/` | `permaweb/HyperBEAM`, branch `bhavyagor/odysee-bridge-devices`, commit `0cab8d2` | Reference snapshot for Bhavya's bridge/device approach. Do not develop here long term. |
| `references/hyperbeam-rave/` | `NewEstablishment/HyperBEAM`, branch `odysee-on-hb-rave`, commit `43e0f61` | Reference snapshot for Rave's bridge/device approach. Do not develop here long term. |
| `aidocs/` | Shared local docs | Plans, setup notes, comparisons, and decisions for the monorepo. |
| `aidocs-local/` | Ignored local docs | Personal Codex/session notes that should not be committed. |

Bhavya's bridge/device approach was the selected baseline and has been ported into `hyperbeam/`. The freshest shared work now lives on branches of `NewEstablishment/odysee-on-arweave`, with `rave/auth-upload` currently the newest checked branch by commit date. See [aidocs/source-branches.md](aidocs/source-branches.md), [aidocs/hyperbeam-approach-comparison.md](aidocs/hyperbeam-approach-comparison.md), and [aidocs/bhavya-port-validation.md](aidocs/bhavya-port-validation.md).

## Local Setup

Prerequisites:

- Erlang/OTP 27 and `rebar3` for HyperBEAM.
- Node.js `>=22.12.0` and `pnpm@10.33.0` for the frontend.
- Native build tools required by HyperBEAM, including `make` and a C compiler.

Build and run HyperBEAM:

```bash
cd hyperbeam
rebar3 compile
rebar3 shell
```

Smoke test the node from another terminal:

```bash
curl http://127.0.0.1:10000/~meta@1.0/info
```

The live `hyperbeam/` tree exposes `~odysee@1.0` and the broader ported Odysee/LBRY device set. For the verifying-cache demo, use:

```bash
cd hyperbeam
NODE_A_PORT=19734 NODE_B_PORT=19735 ./scripts/odysee-two-node-demo.sh
```

Point the frontend at Node A for local HyperBEAM-mode testing.

Set up the frontend:

```bash
cd odysee-frontend
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:10000 pnpm dev
```

The frontend reads `ODYSEE_HYPERBEAM_NODE_API` and routes HyperBEAM mode through `~odysee@1.0`. Without that environment variable it falls back to the original Odysee network path.

More detailed setup and validation notes are in [aidocs/local-development.md](aidocs/local-development.md). Source branch pins are in [aidocs/source-branches.md](aidocs/source-branches.md).
