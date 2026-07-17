# Proposed upstream HyperBEAM changes

Changes this project would benefit from in `permaweb/hyperbeam` `edge`.
Neither is required to run: the system works on stock nodes today. Each
belongs in its own upstream PR with its own justification; nothing in
this repository depends on them landing.

## 1. `hyperbeam-is-id-lbry-claim-ids.patch`

Extend `?IS_ID` to accept 40-character (20-byte hex) LBRY claim IDs, so
bare `GET /<claim-id>` resolves as a single-ID store read. Applies
cleanly to current `edge` (`git apply --check` verified). Without it,
claim reads use the namespaced form
`GET /~cache@1.0/read?read=odysee/claim-id/<id>`, which works on stock
nodes unmodified.

## 2. Flat store-path fallback (described proposal)

`flat-store-path-fallback.reference.erl` is the reference
implementation (from the earlier vendored tree, where it proved out):
when a multi-segment, fully device-free resolution terminates in
`{error, not_found}`, retry the joined path as a single flat store read
(`hb_cache:read(#{ <<"read">> => <<"p1/p2/...">> })`). This makes every
store namespace directly addressable as `GET /odysee/claim/<uri>` etc.,
rather than only through `~cache@1.0/read`. The guard is conservative:
every step must be a plain pathed map with no `device` key, so no
device resolution semantics change. Needs re-basing onto the current
`edge` resolver's terminal handling.
