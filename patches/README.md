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

## 3. Link-ID vs write-ID divergence for committer-less commitments
(described proposal)

For a nested committed message, `hb_link:normalize` creates the link
under `hb_message:id(Child, all)` computed over the full child, while
`hb_cache:write` registers the IDs of the child's *committed view*
(`with_only_committed` narrowing). For httpsig-signed children the two
agree (the all-commitments ID accumulates commitment keys, invariant
under narrowing), but for a child whose commitments carry no
`committer`, `id(_, all)` maps to `committers => all`, which selects
zero commitments and silently recalculates an unsigned ID over whatever
keys are present — including uncommitted derived keys — so the link
dangles and any HTTP encode of the parent 500s. This repository routes
around it by only embedding children in committed-view form
(`dev_lbry_commitment:with_attestation_commitment/2`); upstream, the
two paths should derive the same ID for every commitment shape.
