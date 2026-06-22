# Bhavya Port Validation

Date: 2026-06-22

## Result

Bhavya's HyperBEAM Odysee bridge/device branch is the better baseline and has been ported into `hyperbeam/`.

The port includes:

- Odysee device modules under `src/preloaded/odysee`
- LBRY codec devices under `src/preloaded/codec`
- LBRY bridge helpers under `src/core/lib`
- Odysee/LBRY store modules under `src/core/store`
- Odysee bridge tests and corpus fixtures
- `docs/build/odysee-hyperbeam-bridge.md`
- `scripts/odysee-two-node-demo.sh`

Because this monorepo imports source snapshots instead of git submodules, the `native/lib/secp256k1` submodule content was also imported at the commit referenced by Bhavya's source tree so HyperBEAM can compile from a plain checkout.

## Fixes Found During Validation

The raw port needed two compatibility fixes:

- `hb_util:decode/1` now uses `b64veryfast:decode64_url/1` instead of the unchecked decoder. The unchecked decoder corrupted at least one valid 48-byte native commitment ID and caused native commitment tests to fail.
- `~odysee@1.0` accepts `uri`, `uri64`, `url64`, and `target64` target aliases. The frontend branch generates `uri64` for `resolve` and `media` paths, while Bhavya's original device only accepted `claim-id`, `name`, `url`, and `target`.

## Validation Commands

HyperBEAM compile:

```bash
cd hyperbeam
rebar3 compile
```

Focused Odysee device test:

```bash
HB_PORT=18742 rebar3 eunit -m hb_odysee_device_test
```

Result: all 26 tests passed.

Focused commitment, codec, remote store, and corpus tests:

```bash
HB_PORT=18744 rebar3 eunit -m hb_lbry_commitment,hb_lbry_codec_test,hb_lbry_remote_store_test,hb_odysee_corpus_test
```

Result: all 56 tests passed.

The combined focused suite also reported all 82 tests passed. The separate runs above are the clean-exit validation record.

## End-To-End Smoke

Started the local two-node bridge demo:

```bash
cd hyperbeam
NODE_A_PORT=19734 NODE_B_PORT=19735 NODE_A_CACHE=_build/odysee-e2e-node-a-cache NODE_B_CACHE=_build/odysee-e2e-node-b-cache ./scripts/odysee-two-node-demo.sh
```

Validated Node A device availability:

```bash
curl -H 'accept: application/json' http://localhost:19734/~odysee@1.0/index
```

Result: HTTP 200 with `device: odysee@1.0`.

Validated the two-node remote store path:

```bash
curl -H 'accept: application/json' 'http://localhost:19734/~cache@1.0/read?read=odysee/stream-id/346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169'
```

Result: HTTP 200 with the expected claim ID, stream store path, descriptor hash, source hash, and Odysee/native commitments.

Validated the frontend helper against the local bridge:

```bash
cd odysee-frontend
ODYSEE_HYPERBEAM_NODE_API=http://localhost:19734 node -e '<load web/src/odyseeHyperbeamNode and resolve the test URI>'
```

Result: the helper reported `configured: true`, generated a `~odysee@1.0/media?uri64=...` URL, and resolved claim `346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169` through `~odysee@1.0/resolve`.

Validated the playback-facing media path with a one-byte range request:

```bash
curl --max-time 30 -D - -o /tmp/odysee-hb-media-byte.bin -H 'range: bytes=0-0' 'http://localhost:19734/~odysee@1.0/media?uri64=bGJyeTovL3doeS1pcy1pdC1zby1lYXN5LXRvLWRpc3J1cHQtZ3BzIzM0NmMxZmVkMGZiYzJmMGIzZWNjOGJmMzkxNWFhOGFhYTAyOWMxNjk'
```

Result: HTTP 206, `content-type: video/mp4`, `content-length: 1`, `content-range: bytes 0-0/653610679`, with the expected claim ID and descriptor hash.
