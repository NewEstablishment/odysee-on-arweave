# Architecture

Odysee on HyperBEAM: the Odysee video platform (built on the LBRY blockchain)
implemented on AO-Core, such that **any standard HyperBEAM node can help
serve Odysee trustlessly**. Legacy Odysee infrastructure (SDK proxy, blob
CDNs, comment server) remains the origin of raw bytes, but every fact served
to a client is re-derived from those bytes and carried as a content-addressed
commitment that any party — another node or the browser itself — can re-verify
without trusting the node that served it.

Companion documents: [lbry-data-model.md](lbry-data-model.md) (the byte-level
verification recipes), [data-sourcing.md](data-sourcing.md) (legacy endpoints
and per-store trust classification), [node-operators.md](node-operators.md)
(configuration recipes).

## AO-Core in brief

The minimum HyperBEAM background needed to read these documents:

- **Messages** are maps with binary keys (`<<"claim-id">>`), resolved key-by-key
  by **devices** (Erlang modules named `name@version`). A message without a
  `device` key resolves through the base `message@1.0` device, which simply
  returns stored values.
- **HTTP is the API.** `GET /<ID>` reads a message from the node's stores.
  `GET /<ID>/key` reads one key. Multi-segment paths resolve stepwise; a path
  with no device involvement falls back to a flat store read. Responses are
  encoded with the `httpsig@1.0` codec: message keys become HTTP headers or
  multipart body parts, and commitments travel in RFC-9421 `signature` /
  `signature-input` headers — so a plain HTTP response is a verifiable message.
- **Commitments** live in a message's `commitments` map:
  `CommitmentID => CommitmentMsg`. Each commitment names its
  `commitment-device`; `commit` and `verify` on any message dispatch to that
  device. A message's ID is derived from its commitments, so ID and
  verification share one mechanism.
- **Stores** are ordered lists of backends implementing the `hb_store`
  behaviour (`read`, `write`, `resolve`, `type`, `list`, …). Reads try each
  store in list order; the first success wins; `{error, not_found}` falls
  through. A store may return a fully-formed message map from a single
  `read/3`, which is how remote-API-backed stores materialize whole messages
  in one call.

## The three layers

### 1. `lbry@1.0` — the commitment and codec device

A single custom device implements the entire LBRY verification surface. It is
a *commitment device*: it never serves application endpoints, it only proves
things. Every piece of LBRY-derived data in the system is an ordinary
`message@1.0` map (readable via `GET /<ID>/key` with zero custom code) whose
commitments carry `commitment-device => <<"lbry@1.0">>`.

Commitment kinds are dispatched on the commitment's `evidence` field:

| `evidence` | evidence message contains | proof |
|---|---|---|
| `transaction` | raw LBRY transaction bytes | txid = reverse(sha256d(raw)) |
| `claim` | raw tx + parsed claim output | claim-id derivation from the claim script |
| `channel` | as `claim`, + `channel-id`, `public-key` | claim proof + key extraction from raw protobuf |
| `stream` | as `claim`, + `sd-hash` | claim proof + sd-hash extraction from raw protobuf |
| `descriptor` | raw stream-descriptor JSON blob | sha384(bytes) = sd-hash + structural parse |
| `blob` | raw encrypted blob bytes | sha384(bytes) = blob-hash |
| `attestation` | (rides on claim/stream evidence) | secp256k1 channel-signature verification |

The full commitment map layout, native-ID byte recipes, and anti-forgery rules
are specified in [lbry-data-model.md](lbry-data-model.md). Two properties fall
out of the single-device design: node operators pin exactly one
`trusted-devices` entry, and multiple commitment kinds coexist on one evidence
message under a single `commitment-device` (a stream claim typically carries a
stream commitment and an attestation commitment), keeping message-ID
computation well-defined.

Commitments are **content-addressed**: the commitment's `signature` is the
native LBRY identifier itself (base64url of the outpoint/txid/hash bytes), not
a signature by any wallet. No node vouches for the data; the data vouches for
itself, and `verify` re-runs the byte recipe from the committed raw bytes.

### 2. Read-only source stores

Five `hb_store` modules source data from legacy Odysee infrastructure and
construct committed evidence messages:

- `hb_store_odysee` — the facade. Owns the `odysee/...` path namespace
  (`odysee/claim-id/<40hex>`, `odysee/outpoint/<txid>:<nout>`,
  `odysee/blob/<96hex>`, …), classifies bare LBRY-shaped keys, performs
  locator lookups against the SDK proxy for mutable namespaces (claim-id and
  URI resolution), and delegates byte fetching to the stores below.
- `hb_store_lbry_transaction` — raw transactions by 64-hex txid.
- `hb_store_lbry_claim_output` — claim/channel/stream evidence by
  `<txid>:<nout>` outpoint, with optional ancestry walking for update claims.
- `hb_store_lbry_stream_descriptor` — parsed descriptors by 96-hex sd-hash.
- `hb_store_lbry_blob` — encrypted blobs by 96-hex sha384.

All are read-only (`write`/`link`/`group` unimplemented; the store dispatcher
falls through) and `remote`-scoped, so they sit naturally behind local caches
in a store stack: a verified fact is fetched from legacy infrastructure once,
written to the local cache with its commitments, and served from disk
thereafter. Every store verifies bytes *before* constructing a message — a
hash mismatch from a CDN is a read failure, never a served message. Endpoint
details and per-store verification obligations: [data-sourcing.md](data-sourcing.md).

The stores are plain OTP-application modules of this repository, not
Forge-packaged devices. Only nodes that source from legacy infrastructure
(seed nodes, below) need them.

### 3. The UI

The Odysee web application is a fully static SPA, uploaded as an Arweave path
manifest and served by any HyperBEAM node via the `manifest@1.0` device:
`GET /<ManifestID>` serves the index page, `GET /<ManifestID>/assets/app.js`
serves assets, and the default `manifest-404: fallback` behaviour provides SPA
client-side routing. No web server, proxy, or SSR tier exists.

The UI talks to nodes over two channels:

- **Reads** are plain `GET /<path>` requests against store paths and message
  IDs. Responses are httpsig-encoded messages; the browser parses the
  multipart/header encoding, extracts the `lbry@1.0` commitments, and re-runs
  the verification recipes in JavaScript. The node is a transport, not an
  oracle.
- **Writes** are `POST` requests carrying `?!=true` (or an inline `&!` path
  flag), which the stock `~auth-hook@1.0` request hook intercepts and signs
  with a node-hosted per-user wallet. See "Writes" below.

## Node roles

**Seed nodes** run this repository as a rebar3 application on top of the
HyperBEAM dependency: the five stores in their store stack, plus the
`lbry@1.0` device. They are the bridge to legacy Odysee infrastructure — the
only nodes that speak to the SDK proxy or blob CDNs. Their output is ordinary
committed messages in an ordinary HyperBEAM cache, served over the standard
HTTP surface.

**Serving nodes** run stock HyperBEAM with two configuration entries: a
`trusted-devices` pin for `lbry@1.0` (or a `trusted-device-signers` entry
naming the publisher's address), and one or more `hb_store_remote_node`
entries pointed at seed peers. They replicate evidence messages from seeds via
`/~cache@1.0/read`, verify them through `lbry@1.0`, cache locally, and serve
clients. A serving node never contacts legacy infrastructure and needs no code
from this repository — the device loads from its published Forge archive.
Config recipes for both roles: [node-operators.md](node-operators.md).

**TEE routing nodes (future).** A third tier would run serving nodes inside
attested trusted-execution environments, with routing nodes directing client
traffic across an attested mesh. Because execution honesty is then
hardware-attested, thin clients could elect to skip browser-side
re-verification and trust the enclave's signature over results, and operators
could form CDN-like topologies (range-request fan-out, regional replication)
without expanding the trust surface. Nothing in the current design blocks
this: commitments remain content-addressed and independently checkable, so TEE
attestation is a latency/effort optimization layered on top, not a
replacement for the trust model.

## Trust model

Legacy SDK/CDN endpoints are **untrusted locators and transports**. The SDK
proxy may lie about which claim a name resolves to or which outpoint is
current — that is a liveness/currentness concern, not an integrity one
(see the ClaimTrie gap in [lbry-data-model.md](lbry-data-model.md#known-gaps)).
It cannot forge content: every fact in an evidence message is re-derived from
committed raw bytes (raw transaction, raw claim protobuf, raw blob), and the
channel public key is always extracted from the raw channel claim — never
taken from SDK JSON.

Commitments carry no node signature. Consequences:

- Any node can serve any evidence message; there is nothing to impersonate.
- Verification is `hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, Opts)`.
  The `commitment-ids => all` selection is **required**: the default selection
  covers only `httpsig@1.0` commitments, and the committers-based selection
  (`hb_message:verify(Msg)`) covers only commitments with a `committer` field
  — `lbry@1.0` commitments, being content-addressed, have neither. A caller
  using the defaults verifies nothing.

Verification happens at three points:

1. **At construction** (seed nodes): the stores verify raw bytes before any
   message exists, so a seed's cache contains only self-consistent evidence.
2. **On the remote-read path** (serving nodes): `hb_store_remote_node` strips
   the peer's transport commitment and narrows the message to committed keys,
   but does not itself run cryptography. Operators close the gap by enabling
   `paranoid-verify` (re-verifies on every cache read/write) or by verifying
   explicitly after replication, so a malicious seed cannot seed a serving
   node's cache with forgeries. Because verification dispatches through
   `commitment-device`, the pinned `lbry@1.0` archive is what does the work.
3. **In the browser**: the UI re-runs the recipes from
   [lbry-data-model.md](lbry-data-model.md) over the httpsig-decoded message.
   This check is sufficient on its own — points 1 and 2 protect node caches
   and peers, not the end user, whose trust terminates in their own client.

### The bare-claim-id caveat (`?IS_ID`)

`GET /<ID>` short-circuits to a store read only when the first path segment
satisfies HyperBEAM's `?IS_ID` macro, which accepts binaries of byte size
42, 43 (base64url IDs), or 32 (native hashes). A bare 40-hex LBRY claim ID is
none of these, so `GET /9cc7f0e3de8db3b2ffd6dc0b4f1a0f0ca48a6b49` does not
trigger single-ID resolution on a stock node.

Two mitigations, in order of preference today:

- **Namespaced store paths work now**: `GET /odysee/claim-id/<40hex>` is a
  multi-segment deviceless path, which stock resolution retries as a flat
  store read; the facade store answers it. All UI read paths use this form.
- **Anticipated upstream extension**: `?IS_ID` extended to accept 40-byte hex
  identifiers, enabling bare `GET /<claim-id>`. This is an upstream HyperBEAM
  change with its own justification, not part of this repository.

## Writes

There is no custom write device. Uploads, comments, and moderation events are
ordinary committed messages, using stock HyperBEAM machinery end to end:

1. The client sends `POST /<path>?!=true`. The stock `~auth-hook@1.0`
   request hook (in the default `on/request` pipeline) matches the `!` commit
   flag, derives a per-user secret via its secret provider (HTTP Basic by
   default; a cookie provider for anonymous-but-stable identity), obtains the
   user's node-hosted wallet from `~secret@1.0`, and signs both the request
   and the `!`-marked message with real RSA-PSS commitments. The user never
   handles key material.
2. The node persists verified signed inbound messages to its cache
   (`store_all_signed`, default on), which also populates the `~match@1.0`
   reverse index as a side effect of every cache write.
3. Readers discover writes via `~query@1.0`'s exact-match index —
   `POST /~query@1.0/only` with equality selectors (schema, type, target,
   author) returns matching message paths — and hydrate them with generic
   `/~cache@1.0/read` calls.
4. *Ownership* semantics ride inside the message as an LBRY channel signature
   over a canonical statement, verified client-side against the channel's
   committed public key. The node-wallet commitment from step 1 establishes
   only a stable pseudonymous writer identity; it confers no authority.
5. Peers replicate write traffic the same way they replicate evidence: via
   `hb_store_remote_node` against nodes that accepted the writes.

Readers re-filter query results against their selectors and re-verify channel
signatures client-side; `~query@1.0` stays a dumb index and the serving node
stays untrusted for write authenticity, exactly as for reads.

Legacy-only interactive surfaces with no verifiable representation — fuzzy
text search, view counts, subscription counts, legacy comment writes — are
excluded from the trustless path and treated by the UI as progressive
enhancements. The video page renders fully from store reads alone.
