# Architecture

Odysee on HyperBEAM: the Odysee video platform (built on the LBRY blockchain)
implemented on AO-Core, such that **any standard HyperBEAM node can help
serve Odysee trustlessly**. Legacy Odysee infrastructure (SDK proxy, blob
CDNs, comment server) remains the origin of raw bytes, but every fact served
to a client is re-derived from those bytes and carried as a content-addressed
commitment that any peer node can re-verify without trusting the node that
served it. The end user's trust terminates in the serving node itself: a
browser runs whatever code that node serves, so client-side re-verification
of node-served data proves nothing. User-facing trust comes instead from
terminating the client's TLS connection **inside** a serving node running in
an attested trusted-execution environment — the bytes the browser receives
are then guaranteed by the enclave, not by JavaScript the same node could
have altered.

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
  `GET /<ID>/key` reads one key. Multi-segment paths resolve stepwise; an
  ID-rooted path with no device involvement short-circuits to a direct store
  read, and `/~cache@1.0/read` exposes arbitrary store paths. Responses are
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

- **Reads** are plain `GET` requests against message IDs and — via
  `/~cache@1.0/read` — store paths. Responses are httpsig-encoded messages;
  the browser parses the multipart/header encoding, extracts the `lbry@1.0`
  commitments, and re-runs the verification recipes in JavaScript. The node
  is a transport, not an oracle.
- **Writes** are `POST` requests carrying `?!=true` (or an inline `&!` path
  flag), which the stock `~auth-hook@1.0` request hook intercepts and signs
  with a node-hosted per-user wallet. See "Writes" below.

The browser never uses the legacy SDK proxy as a product backend. In
HyperBEAM mode, legacy `channel_sign` requests fail at the SDK facade before
transport, and the fetch boundary blocks the proxy host as a second guard.
Legacy livestream actions that require that signature are unavailable until a
native message contract exists.

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

**TEE routing nodes.** This is how end-user trust is actually established.
Serving nodes run inside attested trusted-execution environments and terminate
the client's TLS connection *inside* the enclave; routing nodes direct client
traffic across the attested mesh. Because the connection is bytes-correct from
inside a measured enclave, the client trusts what it receives without running
any verification of its own — which it could not meaningfully do anyway
against code the node itself served. The peer-to-peer commitment layer keeps
the enclaves honest with respect to each other (a TEE still verifies evidence
it replicates), so operators can form CDN-like topologies (range-request
fan-out, regional replication) without expanding the trust surface.

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

Verification happens **between nodes**, at two points. The end user does not
verify (see above — client-side checks of node-served data are meaningless);
their trust comes from the TEE-terminated connection.

1. **At construction** (seed nodes): the stores verify raw bytes before any
   message exists, so a seed's cache contains only self-consistent evidence.
2. **On the remote-read path** (serving nodes): `hb_store_remote_node` strips
   the peer's transport commitment and narrows the message to committed keys,
   but does not itself run cryptography. Operators close the gap by enabling
   `paranoid-verify` (re-verifies on every cache read/write) or by verifying
   explicitly after replication, so a malicious seed cannot seed a serving
   node's cache with forgeries. Because verification dispatches through
   `commitment-device`, the pinned `lbry@1.0` archive is what does the work.

Both points protect node caches and peers from each other. The commitment
layer is what lets an operator trust a peer's bytes without trusting the peer;
the TEE layer is what lets an end user trust a serving node.

### The bare-claim-id caveat (`?IS_ID`)

`GET /<ID>` short-circuits to a store read only when the first path segment
satisfies HyperBEAM's `?IS_ID` macro, which accepts binaries of byte size
42, 43 (base64url IDs), or 32 (native hashes). A bare 40-hex LBRY claim ID is
none of these, so `GET /9cc7f0e3de8db3b2ffd6dc0b4f1a0f0ca48a6b49` does not
trigger single-ID resolution on a stock node.

Two mitigations, in order of preference today:

- **Namespaced store paths work now**: the stock `~cache@1.0` device reads
  arbitrary store paths, so `GET /~cache@1.0/read?read=odysee/claim-id/<40hex>`
  reaches the facade store on any node that stacks it. All UI read paths use
  this form.
- **Anticipated upstream extension**: `?IS_ID` extended to accept 40-byte hex
  identifiers, enabling bare `GET /<claim-id>`. This is an upstream HyperBEAM
  change with its own justification, not part of this repository.

## Writes

There is no custom write device. Uploads, comments, reactions, playlists,
subscriptions, encrypted preference snapshots, and moderation events are
ordinary committed messages, using stock HyperBEAM machinery end to end:

1. The client sends `POST /id?0.%21=true&committers=all`. Scoping `!` to stage
   zero commits the application document once; a global `!` can also commit
   intermediate resolver stages and expose multiple locators for one semantic
   write. The stock `~auth-hook@1.0`
   request hook (in the default `on/request` pipeline) matches the `!` commit
   flag, derives a per-user secret via its secret provider (HTTP Basic by
   default; a cookie provider for anonymous-but-stable identity), obtains the
   user's node-hosted wallet from `~secret@1.0`, and signs the `!`-marked
   application message with a real RSA-PSS commitment. Transport, credential,
   browser fetch, and commit-control fields are removed before that commitment.
   The user never handles key material.
2. The node persists verified signed inbound messages to a dedicated
   `cache-http` filesystem store (`store-all-signed`, default on); every
   cache write also populates the `~match@1.0` reverse index in its target
   store, so query-serving nodes include `cache-http` in their `store` and
   `match-index` stacks.
3. Readers discover writes via `~query@1.0`'s exact-match index —
   `POST /~query@1.0/only` with equality selectors (schema, type, target,
   author) returns matching message paths — and hydrate them with exact
   immutable reads. Query selectors contain only committed application fields.
   If older writes produced multiple locators for one semantic message,
   deduplication preserves discovery order but prefers a locator whose exact
   named commitment verifies.
4. Native account ownership is the verified committer established by the
   cookie-derived node wallet. Claimed profile/channel fields are display
   metadata only. Product projections such as comment revisions, reactions,
   and subscriptions accept only contiguous same-committer chains. Public
   playlist content is an independently addressable immutable full snapshot;
   the pinned generic `reference@1.0` init commitment supplies its stable route
   and same-owner set messages select later snapshots.
   Historical LBRY ownership remains governed by its separately verified
   source evidence.

   The browser keeps only an active/saved profile hint. At authentication it
   asks the node for the cookie owner, exact-hydrates candidate channel
   profiles, and creates a native Redux user only for a same-committer match.
   Preference hydration follows that verification during startup.

Free channel subscriptions use `odysee-subscription@1.0`. A deterministic
`subscription-ref` combines the verified subscriber committer with a stable
channel reference (`native:<profile-id>` or `lbry:<full-channel-claim-id>`).
Follow, notification-preference, unfollow, and re-follow events revise that
same relationship. A future migration may seed missing roots from a one-time
legacy export, but imported roots must carry explicit provenance and normal
browser operation never reads or writes the legacy subscription service.
5. Peers replicate write traffic the same way they replicate evidence: via
   `hb_store_remote_node` against nodes that accepted the writes.

As with reads, authenticity checks are a *between-node* concern: a replicating
peer re-filters query results against their selectors, verifies each exact
commitment, and derives native ownership from that commitment's committer
before caching a write. `~query@1.0` remains a dumb locator index rather than
an authority. The end user trusts the TEE-terminated serving node rather than
verifying in the browser.

The configured cookie deployment persists hosted wallets in the node's private
store and warms recovered wallets in memory. A valid cookie therefore maps to
the same committer after a process restart. Credential verification excludes
the application `body`; only after the cookie is verified is the complete
message signed. Native comment text can consequently live in `body`, making an
exact immutable read the comment document while older `comment`/`text` fields
remain read-compatible.

Comments, reactions, and subscriptions model changes as contiguous append-only
revisions. Public playlists separate identity from content: each publish writes
an immutable full `odysee-playlist@1.0` snapshot, while the pinned external
`reference@1.0` device supplies the stable public identity. Its init commitment
is the playlist ID; later same-authority set messages point to new snapshots
without mutating earlier content. Readers hydrate and verify every candidate,
derive authority from the init committer, and select only a strictly newer
unambiguous set. Query order is never authority.

Private user preferences use the same separation. Each version is an immutable
cookie-signed `odysee-preferences@1.0` message containing only an AES-256-GCM
envelope. A generic `reference@1.0` init commitment is the stable preference
identity and same-owner set messages select newer snapshots. Readers discover
only locators, hydrate and verify every exact reference/snapshot commitment,
and fail closed on foreign ownership, stale changes, or conflicting tied
heads. The narrow `odysee-preference@1.0` device is not a write device: it
authenticates the cookie-owned hosted wallet and seals or opens owner-bound
ciphertext without storing preference state. Its private/no-store response is
the only plaintext boundary; credentials and key material never enter public
messages.

Preference writes use exact readback as their acknowledgement. Query/listener
discovery is eventually consistent and is never required to expose the new
reference before a valid save can complete.

HTTP delivery supports one RFC 7233 byte range. Range-aware cache/source stores
receive the requested bounds directly; locally materialized immutable bodies
are sliced at the HTTP boundary and returned as an unsigned derived `206`
representation, leaving the exact whole message as the verification surface.

Generic `search@1.0` provides ranked locator discovery for homepage, category,
and text-search requests. The frontend maps filters and sort before the query,
preserves locator order, and exact-hydrates every result; Meilisearch remains
an index, never an object or authority source. Native per-channel listings use
bounded `query@1.0` discovery over upload records and the same exact hydration
boundary.

Observational analytics are recorded by the reusable `analytics@1.0` device.
Odysee maps playback to generic subject engagement in the frontend, while the
device exposes only aggregate counts and wallet-authenticated reports. A
one-time owner-authenticated baseline preserves historical view totals; native
qualified engagement is added after cutover. These analytics remain
non-authoritative signals and do not affect content verification.

Other legacy-only interactive surfaces with no verifiable representation —
aggregate subscription counts and paid membership state — are excluded from
the trustless path and treated by the UI as progressive enhancements. The
video page renders fully from store reads alone.
