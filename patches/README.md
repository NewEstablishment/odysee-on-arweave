# Proposed upstream HyperBEAM changes

These narrow fixes are applied idempotently to pinned dependencies during
compilation and should land upstream before their hooks are removed. Any
proposal beyond this list must take the form of a terse (<= 20 lines, test +
fix) branch on a dependency worktree, and only for defects demonstrably owned
by that dependency rather than this application.

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
