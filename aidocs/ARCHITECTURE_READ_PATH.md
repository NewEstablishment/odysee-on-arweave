# The read path, step by step

What executes when a browser asks this node for an Odysee video, with code
references. Traced against the running demo, not from memory.

Worked example, the request the demo actually issues:

```
GET /~cache@1.0/read?read=odysee%2Fmedia%2Fstream-id%2F0e1b0b33...%3A0
```

Paths below are relative to the repo root. HyperBEAM dependency sources are
under `_build/default/lib/hb/src`, shown as `hb/...`.

---

## Layer 1: HTTP to the resolver

| # | What happens | Where |
|---|---|---|
| 1 | Cowboy dispatches every path to one catch-all handler. The node's whole config rides in the Cowboy env, so config can hot-swap without restarting the listener. | `hb/core/http/hb_http_server.erl:235` |
| 2 | `init/2` answers OPTIONS with a CORS 204, otherwise reads the body and calls `handle_request/3`. | `hb_http_server.erl:400` |
| 3 | The full relative ref is rebuilt as `<path>?<qs>`. **Headers and query keys merge into one flat message**, AO-Core treats them as the same namespace. | `hb/core/http/hb_http.erl:917` |
| 4 | `from_path/1` percent-decodes, splits at the first depth-aware `?`, then splits the path on `/`. The `/` characters inside the encoded `read=` value survive as **one opaque store path**. This is why the store path must be a query value, not path segments. | `hb/core/resolver/hb_singleton.erl:170` |
| 5 | A browser GET has no `content-type`, so the wire codec is `httpsig@1.0`. | `hb_http.erl:927` |
| 6 | `dev_meta:handle/2` turns the singleton into an ordered list of executable steps. `~cache@1.0` parses to `{as, cache@1.0, ...}`. | `hb/preloaded/node/dev_meta.erl:86`, `hb_singleton.erl:137` |
| 7 | Node `http-extra-opts` merge in. The demo sets `cache-control => [no-store]`, without it the resolution cache pins mutable objects at constant addresses. | `dev_meta.erl:241`, `src/hb_odysee_node.erl:149` |
| 8 | `hb_ao:resolve_many/2` folds the steps. Stage 1 binds the device, stage 2 checks the resolution cache, stage 5 resolves `read` to `dev_cache:read/3`. | `hb/core/resolver/hb_ao.erl:244`, `:307` |
| 9 | `dev_cache:read/3` calls `hb_cache:read/2`, which walks the **ordered store list**: first success wins, `not_found` falls through. | `hb/preloaded/node/dev_cache.erl:24`, `hb/core/store/hb_store.erl` |

## Layer 2: the store facade decides what the key means

`src/hb_store_odysee.erl`

| # | What happens | Where |
|---|---|---|
| 10 | `read/3`: normalize the key, canonicalize it, try fixtures, then go live. | `:83-97` |
| 11 | `canonical_read_path/1` recognises **bare** LBRY identifiers and rewrites them: 96-hex → `odysee/blob/`, 64-hex → `odysee/transaction/`, 40-hex → `odysee/claim-id/`, `<64hex>:<n>` → outpoint. This is why `?read=<txid>` works without a prefix. | `:850`, `:875` |
| 12 | Fixtures seam (offline tests) checked before any network call. A fixture hit **skips warming**. | `:662`, `:673` |
| 13 | `read_live/4` dispatches media first. `odysee/media/stream-id/X` rewrites to `odysee/stream-id/X` and **re-enters `read/3` recursively**, so the stream evidence is fetched and verified through the normal pipeline before any bytes are touched. | `:99`, `:373` |
| 14 | Two dispatch families. **SDK-located** (`odysee/claim/<uri>`, `odysee/claim-id/`, `odysee/channel/`) use `hb_odysee_client` purely as a *locator*. **Direct delegation** (`odysee/transaction/`, `odysee/stream-id/`, outpoints) calls the source store module directly. | `:110-196` |
| 15 | `outpoint_evidence/5` tries kind `stream`, and on failure retries as `claim`. This is what makes sourceless livestream claims resolve instead of 400. | `:259` |

## Layer 3: raw bytes become proof

| # | What happens | Where |
|---|---|---|
| 16 | The transaction store fetches hex from the SDK proxy, decodes, and builds the message. | `src/hb_store_lbry_transaction.erl:23`, `src/hb_odysee_client.erl:46` |
| 17 | `transaction_message/1` parses the raw bytes, attaches `raw` as base64url, and commits over **exactly `["raw","txid"]`** with alg `sha-256d`. The parsed fields are convenience, deliberately outside the commitment. | `src/dev_lbry_commitment.erl:175` |
| 18 | The commitment carries **no committer and no wallet signature**. Its "signature" is the native LBRY identifier itself. The data vouches for itself; no node is trusted. | `dev_lbry_commitment.erl` |
| 19 | Consequence: `hb_message:verify` with default selection checks **nothing** on these messages. `commitment-ids => all` is mandatory. | see §Gotchas |
| 20 | `evidence_result/2` is the fail-closed exit for every evidence read: verify, narrow to committed keys, write locally. | `hb_store_odysee.erl:345` |
| 21 | Media: `reassemble_stream/2` parses the descriptor, then fetches each blob and **re-checks its SHA-384 before use**, decrypts and concatenates. A hash mismatch is a read failure, never a served video. | `src/hb_odysee_bridge.erl:173`, `src/hb_store_lbry_blob.erl:44` |

## Layer 4: caching, addressing, response

| # | What happens | Where |
|---|---|---|
| 22 | After a live read returning a map, `warm_addresses/5` links the canonical path's **alias**, plus the bare request key when it is an outpoint (immutable, so the shortcut cannot go stale). | `hb_store_odysee.erl:587` |
| 23 | `alias(Path) = base64url(sha256("odysee-alias:v1:" ++ Path))`, 43 chars, `?IS_ID`-shaped, a pure function computable offline by any client. | `src/hb_odysee_address.erl:14` |
| 24 | `link_local/4` writes the message first (the id is only known after writing), then links each address to it. | `hb_store_odysee.erl:599` |
| 25 | Response encoding: fields ≤ 4096 bytes become **HTTP headers**, larger ones move to a multipart body. Commitments become `signature` and `signature-input`. | `hb/preloaded/codec/dev_httpsig_conv.erl:768`, `dev_httpsig_siginfo.erl` |
| 26 | The message's own `status` key sets the HTTP status, which is how media returns 200 (full) or 206 (range). | `hb_http.erl:528` |

So an ordinary HTTP response **is** a verifiable message:

```
txid:            d22e243be78d...
raw:             AQAAAAKConULCnjLdPQnQ43-Vpqt...
signature-input: comm-...=("raw" "txid");alg="lbry@1.0/sha-256d"
signature:       comm-...=:0i4kO+eNTdS1/L6/gA3OvAZrHfGwQrNjkQ5fUH0dYfY=:
```

Recompute `reverse(sha256d(raw))`, compare to `txid`. The node is a transport,
not an oracle.

---

## Gotchas found while tracing

- **Default verify selection checks nothing here.** Content-addressed
  commitments have no committer, and the default selection covers only
  `httpsig@1.0` commitments. Always pass `commitment-ids => all`. A caller
  using defaults gets `true` while verifying zero commitments.
- **Fixtures skip warming.** `read/3` only warms on the live branch, so
  fixture-based tests never exercise aliasing.
- **Media responses are not evidence.** `full_media_response/2` builds a plain
  map and never passes through `evidence_result/2`, so no verify runs on the
  media envelope itself. The *blobs* are hash-checked during reassembly, which
  is where the guarantee actually comes from.
- **Evidence messages are written twice**, once in `evidence_result/2` and
  again in `link_local/4` to learn the id.
- **Two independent fixture seams** exist with different key namespaces: the
  facade keys by canonical `odysee/...` path, the sub-stores by bare hash.

## Known bug: the alias serves unverifiable data

`GET /<alias>` returns the message content but **no commitments**. Measured on
the running node:

```
via path:   3 commitments  (hmac-sha256, rsa-pss-sha512, lbry@1.0/sha-256d)
via alias:  0 commitments
```

So an alias fetch hands a peer bytes it cannot check, which defeats the point
of making content addressable to peers and routers.

The in-process read (`hb_cache:read(alias, Opts)`) **does** carry commitments;
only the HTTP path loses them, so the fault is in response construction for the
`?IS_ID` short-circuit, not in the link target. A first fix that pointed the
link at a commitment id did **not** resolve it and was reverted.

`skeleton_blob_serves_and_addresses_test` now asserts commitments are present
before verifying, and **currently fails**, which is correct: it was previously
passing vacuously, because verifying an empty commitment set returns true.

Until this is fixed, treat the path form as the verifiable address and the
alias as a convenience locator.
