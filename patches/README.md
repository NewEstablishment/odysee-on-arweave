# Proposed upstream HyperBEAM changes

Application behavior remains usable on the pinned stock node unless a section
explicitly documents a feature that activates only after its patch lands.
Defect fixes should remain terse and test-focused. Deliberately accepted
upstream features may be larger when they are generic HyperBEAM capabilities,
preserve backward compatibility, and include their complete dependency and
test surface.

## 1. `hyperbeam-is-id-lbry-claim-ids.patch`

Extend `?IS_ID` to accept 40-character (20-byte hex) LBRY claim IDs, so
bare `GET /<claim-id>` resolves as a single-ID store read. Applies
cleanly to current `edge` (`git apply --check` verified). Without it,
claim reads use `GET /~cache@1.0/read?read=odysee/claim-id/<id>`, which
works on stock nodes unmodified.

## 2. `dev-cache-forward-range.patch`

Forward byte-range request fields (`start`/`end`, or an RFC-7233 `range`)
from `~cache@1.0/read` to the store. Without it, `dev_cache:read/3` passes
only the location to `hb_cache:read/2`, so a store-backed media read never
sees the range and reassembles the whole object — a 653 MB video timed out.
`hb_store:read` already accepts a request map and `hb_store_odysee`'s
`request_range/2` already honors the fields; this only wires the range
through. Ranged media then returns 206 with a *targeted blob fetch*
(~3s cold for a 1 MB slice, seek anywhere) instead of a full-object read.
Verified live: `start`/`end` and `range: bytes=X-Y` both yield 206 with
`Content-Range`; non-range reads are unchanged. Applies cleanly to the
pinned dep (`git apply --check` verified).

This is preferred over slicing a full reassembly in `hb_http:encode_reply`:
forwarding the range lets the store fetch only the blobs the slice needs,
so a seek costs one small fetch, not a whole-video reassembly per request.

## 3. `dev-query-match-error-tuple.patch`

`dev_query:match/4` crashes with `case_clause` on every query that has no
results, so `~query@1.0` returns HTTP 500 rather than a successful empty result
(or a not-found result for first-item modes).
`hb_cache:store_match/2` returns `{error, not_found}` on an empty match
(and `hb_cache:match/2` does the same on the `match@1.0` path), but
`dev_query:match/4` only has clauses for `{ok, _}` and a bare `not_found`.
Nothing produces the bare atom, so the miss path is unreachable and every
miss is a 500. This is independent of configuration: no `match-index`
setting avoids it, because an empty result is `{error, not_found}` either
way. Observed on every video page load in this application, where the
frontend issues a `POST /~query@1.0/only`. The patch maps misses to `[]`, `0`,
or `false` according to the requested aggregate type, retains `not_found` for
first-item modes, and adds focused upstream EUnit assertions. Applies cleanly
to the pinned dep (`git apply --check` verified).

## 4. `blacklist-content-restrictions.patch`

Expand upstream `blacklist@1.0` from a request-only newline-ID blacklist into a
backward-compatible generic content-policy device. Structured policy snapshots
support typed subjects, global/country/continent/country-group denies, optional
trusted signers and expiry, atomic replacement, and request plus response
enforcement. The existing newline-delimited HyperBEAM ID format is unchanged.
Global sources are checked before location resolution. ISO-code-keyed country
providers support separate signed sources and compact JSON entries containing
`id`, optional `type`, optional `country`, and `reason`.

Country attributes are resolved locally from an operator-supplied MMDB through
Locus. The HTTP layer supplies the private direct socket peer; `X-Real-IP` is
used only for an explicit trusted proxy. DB-IP's EU membership field is exposed
as the `EU` country group and remains distinct from the European continent.

The patch compiles on the pinned dependency and its upstream device suite
covers legacy compatibility, country rules, EU membership, unavailable
locations, country-source selection, global short-circuiting, trusted-proxy
handling, generation replacement, and one-million-rule parsing. The feature is
not activated in `config.json` until upstream merges it and this repository
pins the merged revision.
