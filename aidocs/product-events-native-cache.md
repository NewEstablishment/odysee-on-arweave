# Thumbnail upload: drop the custom device, write to the native cache

Branch `victor/product-events-native`. Deletes the custom
`~odysee-product-events@1.0` device and moves the whole thumbnail-upload flow to
the frontend proxy, which signs and writes directly to HyperBEAM's native,
trust-gated `~cache@1.0/write`. The proxy's HB-native signer is
**verified working against a live node** (see Verification below).

## Before (what shipped)

- Custom device `dev_odysee_product_events` exported one key, `thumbnail_upload`,
  whose only precondition was `require_post` — **no signer/committer/cache_writers
  check**. It base64-decoded an image and called `hb_cache:write` **directly**,
  bypassing the cache device's trust gate.
- The Koa proxy (`web/src/routes.js`) sent a **plain, unsigned** POST.
- Net: an **anonymous, unauthenticated write into the node's cache** — arbitrary
  bytes, no size/rate limit. A DoS/storage-abuse surface, opened deliberately so
  a pre-auth publish UI could upload without a wallet.

## After (this branch)

- **The custom device is gone.** The node keeps only its generic
  `~cache@1.0` — no Odysee-specific upload code.
- **The proxy does everything** (`postHyperbeamThumbnailUpload`):
  1. decodes the image + content-type from the request (the base64 / `data:` URL
     convenience that used to live in the device),
  2. **signs** a native `~cache@1.0/write` with a server-held wallet JWK
     (self-contained HB-native signer using Node `crypto`; see the three details
     below),
  3. reshapes the response to the `{type, message, url, id}` contract the client
     already expects, with `url = /~cache@1.0/read?read=<id>`.
- **The node's `cache_writers` gate authorizes the write.** The proxy's address
  must be listed in `cache_writers` (the two-node demo launcher provisions a
  trusted writer and prints its address). An unsigned or untrusted write is
  rejected (403) — the anonymous hole is closed **by the native gate**, not by
  bespoke code.

## The two real design decisions (this is the conversation for Rave)

### 1. Content-type is not stored by the native cache
The native write is content-addressed. Writing a **binary** body gives a stable
id but the cache does not retain a content-type; writing a **map** body retains
fields but does not return a content-addressed path. This is exactly what the
custom device was papering over by calling `hb_cache:write` with a
`{body, content-type}` map directly.

**This branch's choice:** write the **raw bytes** (content-addressed id) and let
the **frontend** serve the read URL as an image — it always knows a thumbnail is
an image. That keeps the node fully generic (the whole point of going native).
Alternative if the node must self-describe the bytes: a small content-type
sidecar/convention, or a native-cache enhancement to carry content-type on a
content-addressed write. Worth deciding explicitly.

### 2. Where the proxy's key lives
The proxy holds a **server-side wallet JWK** (`HYPERBEAM_CACHE_WRITER_JWK`) and is
the **single trusted cache writer**; its address goes in the node's
`cache_writers`. The browser never signs (there is no user wallet in this flow),
and the operator does **not** auto-sign every POST (that would just launder the
anonymous write under the operator's key). The trust boundary is: only the proxy
may write, and only because the operator explicitly trusted its address.

## Verification (executed — WORKS end to end)

The proxy signer (`hbSignedHeaders` in `web/src/routes.js`) was run — its exact
functions, verbatim — against a live node booted from this worktree with the
writer address in `cache-writers`. **[measured]**:

- Signed `~cache@1.0/write` → **HTTP 200 / ao-status 200**, content stored
  content-addressed (`data/Ff1v…`), and a readback returns the exact bytes.
- The same content unsigned / from an untrusted key → **403** ("Not authorized
  to write to the cache").
- The signer uses only Node's `crypto` (RSA-PSS/SHA-512, salt 64) + an Arweave
  wallet JWK — **no aoconnect**. `@permaweb/aoconnect` was a dead end: `0.0.63`
  (the frontend's pin) can't sign HB requests at all, and even `@latest` produces
  httpsig HyperBEAM does not attribute a committer to.

### The three details that make an external HB-native signature verify

These were recovered by reading HyperBEAM's `dev_httpsig` source and confirmed
against a live node; they are non-obvious and not derivable from the wire alone:

1. **`content-digest` binds the body.** The signed base lists `content-digest`
   (`sha-256=:<base64(sha256(body))>:`), not `body`; the raw bytes go in the HTTP
   body so HB recomputes and matches it on verify.
2. **Derived-component `@`-asymmetry.** In the signed base's `@signature-params`
   list, RFC-9421 *derived* components (`method`, `path`, `authority`, `scheme`,
   `target-uri`, `request-target`, `query`, `query-param`) take an `@` prefix
   (`"@method"`, `"@path"`) — but the component *lines* use the raw names
   (`"method": POST`). The **wire** `signature-input` header uses the raw names
   with **no** `@`; HB re-adds the `@` when it rebuilds the base to verify. So the
   bytes you sign differ from the header you send.
3. **`comm-` label.** HB's inbound parser hard-matches
   `signature`/`signature-input` values beginning with `comm-`
   (`dev_httpsig_siginfo:siginfo_to_commitments`); any other dictionary label is
   silently ignored, so the signature is treated as absent. The dictionary label
   must therefore be `comm-<name>`.

### Deployment requirement

Set `HYPERBEAM_CACHE_WRITER_JWK` (the proxy's Arweave wallet, JSON or a path) and
add its address (`base64url(sha256(modulus))`) to the node's `cache_writers`. The
browser never signs; the operator does not auto-sign (no confused-deputy); only
the proxy's key can write, and only because the operator trusted its address.
The two-node demo launcher provisions a trusted writer and prints its address.
