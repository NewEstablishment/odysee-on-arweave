# Decision: build against upstream `permaweb/hyperbeam` `edge`

## Issue

Three candidate HyperBEAM baselines exist:

1. Upstream `permaweb/hyperbeam` `edge` (the Forge device template's
   default dependency).
2. The vendored `hyperbeam/` snapshot on this repo's `master` (edge
   `3e610d0` + the Odysee team's modifications, now stale vs upstream).
3. `~/src/hyperbeam` checkout, currently on `neo/edge-1.0` with
   uncommitted work-in-progress (parts do not compile).

## Decision

Upstream `edge` (option 1), as pinned by the generated `rebar.config`.
A clean-room device project must build against a published substrate;
the vendored snapshot exists only as a porting reference, and local
uncommitted WIP is not a dependency. If `neo/edge-1.0` lands upstream,
switching the dep branch is a one-line change.

## Known consequence

Bare `GET /<claim-id>` with a 40-hex LBRY claim ID does not satisfy
`?IS_ID` (accepts byte sizes 42/43/32, `hb.hrl:10`), so single-ID
resolution to a store read will not trigger for bare claim IDs on a
stock node. Mitigations, in order of preference:

- Store-namespaced paths (`odysee/claim-id/<id>` etc.) work today with
  no kernel change: multi-part deviceless paths fall back to a flat
  store read.
- The anticipated (and explicitly sanctioned) upstream change: extend
  `?IS_ID` to accept 40-byte hex IDs. To be proposed as its own
  HyperBEAM PR with separate justification, not landed from this repo.
