# HyperBEAM Approach Comparison

## Inputs

Compared snapshots:

- Bhavya: `permaweb/HyperBEAM` branch `bhavyagor/odysee-bridge-devices`, commit `0cab8d2`
- Rave: `NewEstablishment/HyperBEAM` branch `odysee-on-hb-rave`, commit `43e0f61`
- Upstream base for the monorepo: `permaweb/HyperBEAM` branch `edge`, commit `3e610d0`

Both candidate branches include similar low-level LBRY bridge work, including codec modules under `src/preloaded/codec`, bridge helpers under `src/core/lib`, store modules under `src/core/store`, and a shared `test/odysee_bridge_corpus.eterm` fixture.

## High-Level Difference

Bhavya's branch is the more complete bridge implementation. It has a broad Odysee device surface, a written bridge contract, a two-node demo script, and additional store/device coverage. Its Odysee device modules under `src/preloaded/odysee` total about 11.6k lines across separate devices for claims, streams, stream descriptors, channels, comments, reactions, file stats, subscriptions, policy, and source commitments.

Rave's branch is smaller and more facade-oriented. It has a single `src/preloaded/odysee/dev_odysee.erl` of about 858 lines plus the lower-level LBRY codec/store pieces. It is easier to inspect, but it does not cover the same set of Odysee product surfaces or policy/read-only adapters.

## Concrete Findings

Bhavya-only material:

- `docs/build/odysee-hyperbeam-bridge.md`, which defines the bridge contract, device set, store split, playback surface, and integration boundaries.
- `scripts/odysee-two-node-demo.sh`.
- Odysee devices for claim, stream, stream descriptor, channel, comment, reaction, file view count, file reaction, subscription count, claim proof, claim output, and policy.
- Store additions including `hb_store_odysee.erl` and `hb_store_lbry_stream_descriptor.erl`.
- Broader remote store tests, including extra coverage around native LBRY stream descriptors and Odysee source paths.

Rave material worth retaining as reference:

- A compact `~odysee@1.0` facade with resolve, source, transaction, descriptor, blob, stream graph, verified stream, range, media, and SDK-style paths.
- A simpler shape for early frontend compatibility checks.
- Similar base LBRY codec/store/test corpus work that can help identify accidental divergence while porting.

Shared or near-shared material:

- LBRY codec devices for blobs, transactions, channels, claims, streams, stream descriptors, and channel attestations.
- Bridge helpers for proxy reads, attestations, stream descriptors, transaction parsing, claim protobuf handling, and source commitments.
- Core tests for LBRY codec behavior and Odysee device behavior.

## Recommendation

Use Bhavya's branch as the primary porting baseline. It is closer to a complete read-only Odysee bridge and matches the needed product surfaces: playback, claims, channels, comments, reactions, file stats, subscriptions, and policy checks.

Keep Rave's branch as a reference for a smaller facade and for validating frontend expectations around `~odysee@1.0`, but do not use it as the main source of truth. It lacks too much of the bridge contract and product-surface coverage.

Keep upstream `hyperbeam/` alignment with `permaweb/HyperBEAM` `edge` deliberate. The Odysee work has been ported forward from Bhavya's branch into the live source path. Long term, prefer the external device-package boundary where practical so Odysee bridge devices do not require unnecessary HyperBEAM core edits.

## Port Status

Bhavya's bridge baseline is now in `hyperbeam/`. The port includes the Odysee devices, LBRY codecs, LBRY bridge helpers, Odysee/LBRY stores, corpus fixture, bridge docs, and two-node demo script.

Validation found two follow-up fixes that are included in the live source path:

- `hb_util:decode/1` now uses the checked base64url decoder. The unchecked decoder corrupted some 48-byte native IDs and broke native commitment verification.
- `~odysee@1.0` now accepts `uri64`, `url64`, and `target64` target aliases so the frontend branch's generated `resolve` and `media` URLs work against the bridge.

## Porting Plan

1. Done: keep `hyperbeam/` compiling against upstream edge before adding Odysee code.
2. Done: port the Bhavya Odysee bridge modules and tests into the live source path.
3. Done: port the narrow core/store hooks needed by the bridge.
4. Done: make `~odysee@1.0` compatible with the frontend branch's `uri64` helper paths.
5. Next: decide whether later cleanup should keep this in-tree or extract it into a dedicated external device package.
6. Next: add broader browser-level regression coverage once the frontend app flow is stable enough for repeatable Playwright smoke tests.

## Current Monorepo Rule

Do not develop inside `references/hyperbeam-bhavya/` or `references/hyperbeam-rave/` except for deliberate snapshot refreshes. Use those directories to inspect prior work and compare behavior while the selected implementation is ported into the shared source of truth.
