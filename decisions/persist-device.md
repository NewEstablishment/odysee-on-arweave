# Decision: `persist@1.0` — app-layer persistence for hook-committed writes

## Original prompt (as understood)

Verify uploads, comment rendering + writing, video loading, and auth
end-to-end in the browser, with screenshots, everything working as a
user expects. Kernel discipline: zero/minimal HB edits.

## The problem chain (all upstream, all found during this verification)

`POST /id?!=true` on a cookie-auth node 500'd. The chain:

1. `dev_cookie_auth:finalize` appends a `set` message (carrying
   `set-cookie`) to the request's message sequence.
2. Resolving `/id` yields a bare ID binary; the appended `set` step
   makes AO-Core load that ID from the cache as its base.
3. The hook-signed message was never persisted (`store-all-signed` runs
   at wire decode, before request hooks — the gap already documented on
   the `fix/store-hook-signed-requests` repro branch), so the load
   misses.
4. The miss shape `{error, not_found}` is unhandled in
   `hb_cache_control:lookup` → `{case_clause, ...}` 500. (With the
   `~http-auth@1.0` provider nothing is appended, so `/id` "worked"
   while silently persisting nothing.)

## Options

- **Fix in HB** (persist hook-signed messages post-hook): correct
  long-term, but requires an upstream design decision on the canonical
  identity of the posted item (documented on the repro branch). Not ours
  to make unilaterally; review forbids non-trivial kernel edits.
- **App-layer pipeline stage** (chosen): the `on/request` pipeline is
  node configuration. A device appended after the auth hook can persist
  whatever the hook committed. No kernel edits; ~60 lines; generic.

## Shape of `persist@1.0`

- `request/3` writes each committed message in the post-hook sequence
  via `hb_cache:write`, then **aliases the resolver-visible identities**
  to the stored path: the write registers the committed-view content id
  and commitment ids, but a caller holds the id the resolver hands out —
  the full content id (uncommitted keys included), which is what
  resolving `id` returns. Three distinct identities; `hb_store:link`
  closes the gap.
- The stored id is merged into the cookie provider's trailing `set`
  message under `message-id` (`id` itself is a reserved device key that
  `set` filters), so the client learns what it stored. The frontend
  write-response readers accept `message-id`.
- Uncommitted messages are untouched: requests the auth hook declined to
  sign persist nothing, so plain GETs cost no writes.

Wired into `hb_odysee_node:cookie_auth_hooks/1`. Regression:
`cookie_commit_post_persists_test` (POST → 200 + Set-Cookie +
message-id → readback by id → `~query@1.0` discovery).

## Found along the way (fixed frontend-side)

- `target` is reserved at the HB HTTP layer (hook dispatch key, ANS-104
  base field): requests carrying it 500. The native comment/control
  schema now uses `claim-id` / `target-id`. Signature payloads are
  unchanged (the serializer's `target` label fills from `claim-id`).
- Header-encoded flat messages mojibake non-ASCII text (browsers decode
  headers as latin-1): `responseHeadersObject` reinterprets high-byte
  values as UTF-8, fail-open.
- `name:<43-char-id>` URIs (the post-publish redirect shape) now resolve
  through the immutable route.
- The upload index step targeted the dropped `~odysee-upload@1.0`
  device; it is now a plain committed native message (the comment
  pattern), then read back through the verified resolver so the published
  claim carries the node-checked committer and channel attribution.

## Deliberately out of scope

Upload **edit/delete** are append-only revision chains over the generic
`/id` write path, mirroring comments (`ui/util/nativeUploadRevisions.ts`):
an edit appends a metadata revision, a delete appends a tombstone, and the
root id stays the claim id so URLs never change. The UI's upload form and
comment box remain login-gated (stock Odysee behavior;
`Lbry.channel_sign` needs a real account + channel), so those surfaces were
verified to the gate and the underlying native writes verified from the
browser context directly.
