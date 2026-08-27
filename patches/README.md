# Proposed upstream HyperBEAM changes

These narrow fixes are applied idempotently to pinned dependencies during
compilation and should land upstream before their hooks are removed. Any
proposal beyond this list must take the form of a terse (<= 20 lines, test +
fix) branch on a dependency worktree, and only for defects demonstrably owned
by that dependency rather than this application.
An explicitly accepted generic upstream feature may be larger when it preserves
backward compatibility and includes its complete dependency and test surface.
Sections state when a staged patch is not yet activated by this application.

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
or `false` according to the requested aggregate type and retains `not_found`
for first-item modes.

The same semantic message may have more than one commitment locator after
authentication and application signing. The expanded patch preserves discovery
order but prefers a locator whose named commitment verifies, falling back to
the first locator only for unsigned indexed messages. This keeps query generic
while ensuring a stale resolver-stage locator does not hide the exact committed
application message.

## 4. `reference-message-operations.patch`

The canonical `reference@1.0` default resolver dereferences unknown keys to the
current value. Its exclude list omitted reserved `message@1.0` operations, so
`/<reference-id>/verify` verified the pointed-at snapshot and exact committer
lookup could not reach the init/set commitment. The patch keeps `id`,
`commitments`, `committers`, `committed`, and `verify` bound to `message@1.0`
and adds a regression assertion. It is applied idempotently to the pinned
external dependency during compilation.

## 5. `secret-default-persist.patch`

`secret@1.0` otherwise hard-codes new hosted wallets to `in-memory`, so a valid
browser cookie can resolve to another wallet after a restart. The patch adds a
generic `secret-default-persist` node option; `config.json` selects
`non-volatile`, while upstream behavior remains unchanged unless configured.
Recovered wallets are warmed in memory so the same cookie keeps the same
committer.

The patch also removes the application `body` from credential verification.
The cookie is verified first and the complete application message is then
signed, preventing ordinary document bodies such as comment text from being
interpreted as verifier messages.

## 6. `hyperbeam-hb-beamr-otp29.patch`

HyperBEAM's `hb_beamr` driver passes `long *` and `char **` values to the OTP
29 `ei` API, whose current signatures require `int *`, `size_t *`, and
`const char **`. Current compilers reject those incompatible pointers. This
patch uses the API's declared types and makes the WebAssembly memory bounds
check overflow-safe; it does not change the driver protocol.

## 7. `hb-http-single-range.patch`

HyperBEAM's HTTP layer otherwise ignores a browser `Range` header when the
resolved message body has already been materialized, returning a full `200`
response that cannot seek reliably. This patch implements one satisfiable
RFC 7233 byte range for binary `GET` responses, returns `206` with exact
`Accept-Ranges`, `Content-Range`, and `Content-Length` fields, and returns
`416` for malformed or unsatisfiable ranges. It removes whole-message digest
and signature headers from the derived partial representation; the complete
immutable message remains the verification surface. Multipart ranges are not
implemented.

## 8. `blacklist-content-restrictions.patch`

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
