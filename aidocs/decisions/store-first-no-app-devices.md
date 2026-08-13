# Decision: reads are stores, writes are hooked generic messages

## Issue

The prior work carries ~14 `~odysee-*@1.0` application devices (claim,
stream, stream-descriptor, comment, account, search, upload, reactions,
subscription, file, policy, references, auth, publish-gate). The brief
for this port: minimize custom devices so any standard HyperBEAM node
can join the system; talk to stores via `GET /ID` wherever possible.

The vendored `hb_store_odysee` also reaches *up* into those app devices
via `hb_ao:raw(<<"odysee-*@1.0">>, ...)` for its live reads — a layering
inversion that makes the store unusable without the whole device fleet.

## Decision

- **Reads**: only stores. The clean-room stores perform their own HTTP
  against the legacy endpoints (SDK proxy, blob CDN) through `hb_http`,
  then construct evidence messages and commitments via the ported
  `dev_lbry_commitment` library. No app device is consulted on any read
  path. Store modules are plain OTP-app modules (not Forge-packaged), so
  seed nodes run this repo as a rebar3 dependency; pure serving nodes
  need only stock HyperBEAM + `trusted-devices` (`lbry@1.0`) +
  `hb_store_remote_node` pointed at seed peers.
- **Writes**: the default `~auth-hook@1.0` request hook (`?!=true`
  commit key) signs the user's POST with a node-hosted per-user wallet;
  uploads and comments are ordinary committed messages written to the
  cache and discovered via `~query@1.0`'s match index — the architecture
  rave/moderation already proved for native comments, with no custom
  device.
- Dropped entirely: the legacy-API bridge devices, the tier-1
  (SDK-attested) verified-stream path, `dev_odysee_claim_proof` /
  `dev_lbry_claim_output` (superseded by `dev_lbry_tx` + `lbry@1.0`),
  `dev_odysee_publish_gate` (unreferenced; victor/reduce-safe-devices
  already deletes it), and the option-fishing request surfaces.

## Consequence

Legacy-only interactive features that have no verifiable representation
(fuzzy search via Meilisearch/lighthouse, view counts, subscription
counts, legacy Commentron writes) are out of the trustless serving path.
The UI treats them as progressive enhancements; the video page must
render fully from store reads alone.
