# Hyperstream Device

`hyperstream@1.0` is a generic, node-local control plane for live media
sessions. It coordinates participants and transports opaque signaling
envelopes. It can also link already-stored immutable media segments into
durable replay records.

The device does not carry media, parse SDP or ICE, terminate RTMP, provide
TURN credentials, select a peer topology, run an SFU, segment a stream, or
render a replay. Those responsibilities belong to application and media
adapters.

## Request Route

Send requests with `POST` to:

```text
/~hyperstream@1.0/<operation>
```

Use that literal direct route. A signed request commits
`device=hyperstream@1.0`, `path=<operation>`, the method, content type, and body.
The committed device and operation must match the direct route.

The public operations are:

| Operation | Purpose |
| --- | --- |
| `transport-key` | Return the node's public ephemeral transport key. |
| `create` | Create a session and its owner peer. |
| `join` | Join an existing session. |
| `heartbeat` | Renew a peer lease and optionally acknowledge an event cursor. |
| `leave` | Remove a peer. Leaving as the owner closes the session. |
| `signal` | Send one opaque envelope to one current peer generation. |
| `events` | Poll ordered events visible to the calling peer. |
| `session` | Read the current session, peer, cursor, and recording state. |
| `update` | Replace owner-controlled public session metadata. |
| `record` | Append an existing immutable media locator to the recording chain. |
| `close` | Close the session and persist a final replay manifest when recorded segments exist. |

Every response includes `device=hyperstream@1.0`, an integer `status`, and
`cache-control=no-store`. Successful `create` and `join` calls use status 201,
`signal` uses 202, `record` uses 201, and the other successful operations use
200.

### Sealed HTTP transport

`transport-key` is a public bootstrap operation. The demo sends a signed POST
with the literal JSON body `{}`; an unsigned capability client can bootstrap
without a peer credential. The response contains:

| Field | Value |
| --- | --- |
| `transport` | `hs1` |
| `algorithm` | `ECDH-P256-HKDF-SHA256-AES-256-GCM` |
| `key-id` | SHA-256 identity of the current public key |
| `public-key` | Uncompressed P-256 public key in base64url |

The client creates an ephemeral P-256 key pair, derives an AES-256 key with
ECDH and HKDF-SHA256, then encrypts the semantic JSON request. The `hs1`
envelope is a flat ASCII body containing the key ID, client public key,
96-bit nonce, and AES-GCM ciphertext plus tag. A successful operation returns
an `hs1r` body encrypted to the same transport context. Direction, operation,
and key ID are authenticated as additional data, so an envelope cannot be
replayed against another operation or direction.

A signer-authenticated client uses an ordinary signed outer HyperBEAM request;
a capability client may use an unsigned outer request and prove its peer token
inside the sealed body. Core HTTP parsing, hooks, response signing, and store
behavior need no Hyperstream exception: those layers see a flat sealed body
rather than SDP, ICE, capabilities, or semantic response fields. The node
process necessarily derives the session key and decrypts the body inside the
device. `hs1` protects data from incidental core, proxy, and store exposure; it
is not end-to-end secrecy from the trusted node operator. HTTPS is still
required outside loopback to authenticate the node endpoint and protect the
public-key bootstrap.

`Cache-Control: no-store` governs downstream caching, not HyperBEAM's internal
signed-message policy. A stock node with its default `store-all-signed=true`
may persist encrypted request messages at the cadence of heartbeat and event
polling. For ephemeral production traffic, use a dedicated Hyperstream node
with `store-all-signed=false` and retain bounded edge metrics instead. This is a
standard node setting; the device does not require a persistence bypass in core.

Malformed, stale-key, oversized, or plaintext HTTP bodies are rejected before
semantic dispatch. Errors that occur before a transport context is established
are public JSON; operation results and semantic errors after decryption are
sealed.

## Packaging and Stock-Node Installation

Hyperstream is a normal multi-module Forge device:

- `dev_hyperstream.erl` is the public root.
- `dev_hyperstream_coordinator.erl` owns node-local state.
- `dev_hyperstream_transport.erl` owns the ephemeral transport key and `hs1`
  envelopes.

It requires no changes to `hb_http`, request hooks, `message@1.0`, `meta@1.0`,
or the store implementation. Build and verify the package with:

```sh
rebar3 device package -d dev_hyperstream
rebar3 device verify -d dev_hyperstream
```

An operator can include the source in the normal Forge preload build, point a
node at the generated preloaded store, or publish and load the signed package
through HyperBEAM's standard `trusted-devices` or
`trusted-device-signers` policy. A stock node will not execute an arbitrary
untrusted third-party archive; that standard trust configuration is the only
installation step beyond normal node options. See
[Device packaging](device-packaging.md).

## Peer Authentication

A peer is bound to at least one of these credentials:

- A verified request signer. Every field used by the device must be committed.
- A client-generated random `peer-token` between 16 and 512 bytes. The device
  retains only its SHA-256 hash in memory.

The standalone demo creates one browser-local RSA-PSS/SHA-512 identity per
`HyperstreamClient` and signs every outer request. That signer is the peer
credential, so the demo does not create or place peer tokens in watch URLs.

A generic capability client generates its `peer-token` before `create` or
`join`, then sends the same token and server-issued `peer-generation` on later
calls. Restricted-session `join-token` values must be distributed through a
separate authenticated channel. Capabilities exist only inside the sealed
semantic body. Never put them in query strings, URL fragments, browser storage,
logs, session or peer metadata, signal bodies, diagnostics, or durable
recording descriptors.

All member operations require:

| Field | Meaning |
| --- | --- |
| `session-id` | Session identifier returned by `create`. |
| `peer-id` | Application-selected peer identifier. |
| `peer-generation` | Fencing value returned by `create` or `join`. |
| Verified signer or sealed `peer-token` | Credential bound to that peer generation. |

Rejoining a departed or expired `peer-id` assigns a new monotonically increasing
generation. Signals addressed to an older generation cannot be read by the new
peer.

Peer IDs, peer roles, and metadata are application-supplied coordination
labels, not verified identities. Credentials prevent takeover after a peer has
registered, but an open session cannot prevent a participant from being first
to claim an unused peer ID. Applications that need authoritative roles must bind
them to verified signers or enforce an admission policy outside this device.

## Creating and Joining

`create` requires `request-id` and `peer-id`. It accepts:

| Field | Default | Meaning |
| --- | --- | --- |
| `session-id` | Deterministically derived | Printable identifier, at most 128 bytes. |
| `access` | `restricted` | `restricted` or explicitly `open`. |
| `metadata` | `{}` | Bounded public application metadata visible to members. |
| `peer-token` | Required without a signer | Client-held peer capability inside the sealed body. |
| `join-token` | None | Raw restricted-session capability inside the sealed body. |
| `join-token-hash` | None | A 43-character base64url SHA-256 hash of the restricted-session capability. |

`join` requires `request-id`, `session-id`, and `peer-id`. It also accepts
bounded public `metadata`, a capability peer's new `peer-token`, and the raw
sealed `join-token` for a restricted session.

An open session accepts any otherwise valid peer. A restricted session accepts
the owner signer or a capability peer that proves possession of the join token.
Applications distribute join tokens out of band.

`request-id` makes identical `create` and `join` retries idempotent. Reusing the
same request ID with different fields returns a conflict.

## Leases and Session State

Each peer has an expiry time. `heartbeat` renews it and accepts an optional
non-negative `ack-cursor`. An owner heartbeat also renews the session lease.

`session` returns the public session metadata, live peers, lease times, current
and oldest cursors, recording head, segment count, and latest replay ID. Peer
metadata and session metadata are visible to every joined member and must never
contain secrets.

`update` is owner-only and replaces the complete session metadata map. `leave`
removes a non-owner immediately. Owner `leave` and `close` close the session.
A closed tombstone remains briefly so authenticated peers receive an explicit
closed result instead of an ambiguous missing session.

## WebRTC and P2P Signaling

`signal` requires:

| Field | Meaning |
| --- | --- |
| `request-id` | Sender-scoped idempotency key. |
| `to-peer-id` | Current target peer. |
| `connection-id` | Application-selected negotiation or peer-connection ID. |
| `kind` | Optional opaque type, default `signal`. |
| `content-type` | Optional type, default `application/json`. |
| `body` | Bounded JSON-compatible or binary payload. |

The body can contain an offer, answer, trickled ICE candidate, renegotiation
message, encrypted application message, or another application-defined
protocol. Hyperstream preserves the envelope and order without interpreting it.
A signal is visible only to the target peer generation. Lifecycle events such
as peer joins, peer departures, session updates, recording progress, and session
closure are visible to current members.

Signal idempotency is scoped to the sender's peer generation and the retained
event window. A rejoined peer may reuse an old request ID; once history has
expired, clients must treat a retry as a new signal and renegotiate or
resynchronize at the application layer.

`events` accepts `after` and `limit`. Results are ordered by cursor and include
`next-cursor`, `oldest-cursor`, `current-cursor`, and `has-more`. Clients persist
the next cursor locally, poll again, and use `heartbeat/ack-cursor` to report
progress. A cursor older than retained history returns `cursor-expired`, which
requires a session refresh and application-level resynchronization.

Hyperstream supports mesh, publisher-to-viewer, relay, and SFU arrangements
without choosing one. Peer metadata can advertise roles and capabilities, while
session metadata can publish non-secret playback or signaling descriptors.

## RTMP Ingest

RTMP support is an adapter boundary:

1. An ingest service authenticates and terminates RTMP.
2. It joins Hyperstream as the publisher, relay, or gateway peer.
3. It advertises non-secret capabilities or playback endpoints in metadata.
4. It produces WebRTC, HLS, or another live output for viewers.
5. When recording is enabled, it writes finalized media segments through a
   normal HyperBEAM store path and calls `record` with their immutable locators.

RTMP stream keys, signed ingest URLs, bearer tokens, TURN credentials, and
private origin addresses must remain in the adapter's credential boundary.
They must not be placed in Hyperstream metadata.

## Recording and Replay

Recording is available only to the signer-authenticated owner when that signer
is also in `hyperstream-recording-signers`. If the option is absent, the device
uses `cache_writers`; if both lists are empty, recording is disabled. The media
adapter first writes a finalized media object to a configured HyperBEAM store.
It then calls `record` with:

| Field | Meaning |
| --- | --- |
| `request-id` | Recording idempotency key. |
| `expected-index` | Next one-based segment index. |
| `previous` | Current recording head; omit for the first segment. |
| `segment` | Bounded public descriptor containing an immutable `id`. |

The segment `id` must be a 43-character base64url HyperBEAM ID or a
`data/<id>` locator, and the object must already be readable from the configured
store. Applications can add fields such as container, content type, duration,
timeline position, initialization segment, or discontinuity markers. The
device preserves these fields but assigns them no media semantics.
Only the locator is interpreted and validated. Every other descriptor field is
persisted verbatim, so the recording adapter is responsible for ensuring the
complete descriptor is public and contains no credentials, signaling payloads,
private origin addresses, or other secrets.

Each accepted call writes:

- A content-addressed `hyperstream-recording-segment@1.0` entry containing the
  descriptor and a link to the previous recording entry.
- A content-addressed live `hyperstream-replay@1.0` snapshot pointing at the
  new recording head.

The response returns `recording-head`, `replay-id`, `segment-index`, and
`segment-count`. Writing a live replay snapshot on every append preserves a
recoverable replay locator even if the in-memory session later disappears.
An explicit `close` writes a closed replay manifest linked to the preceding
live manifest.

The device enforces both a segment-count ceiling and an aggregate encoded
descriptor-byte ceiling per session. Recording entries and replay manifests
are deterministic for the same accepted state. If the final replay write
fails, the session remains logically closed with finalization pending; retrying
`close` attempts the same manifest rather than reopening the stream or creating
a timestamp-dependent variant.

The coordinator constructs these records after authenticating the verified
owner signer. Their `publisher` field is the coordinator's assertion about that
verified request; the stored records are not themselves direct publisher-signed
attestations. Applications needing portable publisher provenance should store
and link a separately signed media or replay manifest.

Replay playback starts with an ordinary immutable read of `replay-id`, walks
the recording chain from `recording-head`, reverses it into ascending index
order, and lets the media adapter interpret the descriptors. A generic chain
is not by itself a browser-playable media format.

## Configuration

| Option | Default |
| --- | ---: |
| `hyperstream-namespace` | `default` |
| `hyperstream-peer-ttl-ms` | 45,000 |
| `hyperstream-session-ttl-ms` | 120,000 |
| `hyperstream-event-ttl-ms` | 120,000 |
| `hyperstream-tombstone-ttl-ms` | 300,000 |
| `hyperstream-max-sessions` | 1,000 |
| `hyperstream-max-peers-per-session` | 1,024 |
| `hyperstream-max-events-per-session` | 4,096 |
| `hyperstream-max-event-bytes-per-session` | 8,388,608 |
| `hyperstream-max-signal-bytes` | 262,144 |
| `hyperstream-max-metadata-bytes` | 16,384 |
| `hyperstream-max-read-events` | 100 |
| `hyperstream-max-recording-segments-per-session` | 10,000 |
| `hyperstream-max-recording-descriptor-bytes-per-session` | 67,108,864 |
| `hyperstream-max-pending-calls-per-session` | 128 |
| `hyperstream-recording-signers` | Inherits `cache_writers`; otherwise `[]` |

Inline request values are checked with byte and nesting limits before use.
Event count, aggregate event bytes, TTL, peer count, session count, and
idempotency history are also bounded. Mailbox admission checks return
`429 coordinator-busy` when the observed queue length reaches
`hyperstream-max-pending-calls-per-session`. The check is intentionally paired
with ingress rate limits; simultaneous senders can race between observation and
enqueue, so it is not a substitute for an edge concurrency ceiling.

The complete recording idempotency history is retained until the session
tombstone expires and is therefore bounded by the segment ceiling. The
aggregate descriptor-byte option independently caps each durable recording
chain. `hyperstream-max-recording-requests` remains accepted as a legacy alias
for the segment ceiling when the newer option is absent. Operators must still
enforce storage capacity, retention, bandwidth, and garbage collection at the
adapter/store boundary.

Decoded device limits do not replace an HTTP ingress limit. Configure the
reverse proxy or gateway to reject oversized fixed-length and chunked bodies
before HyperBEAM buffers them. Apply per-address or authenticated-principal rate
limits to `transport-key`, `create`, `join`, and `signal`; otherwise clients can
consume CPU, session capacity, and event memory. Closed tombstones count toward
session capacity until their TTL expires.

## Deployment Boundary

One coordinator process serializes each session. A slow store write for one
recording therefore does not block unrelated sessions.

Live state and the `hs1` P-256 key are memory-only and belong to one Erlang
node. A deployment must route every request for a session to that node. A node
restart rotates the key and loses membership and signaling state; clients must
fetch `transport-key` again, recreate or rejoin, and renegotiate. Routing one
client to a different node produces the same recovery requirement. The latest
successfully returned replay ID and immutable recording chain remain readable.

A proxy must preserve the literal route, enforce HTTPS and pre-buffer body
limits, apply admission and rate controls, disable request and response body
logging, and avoid caching regardless of downstream headers. Even though those
bodies are ciphertext after bootstrap, metadata, traffic volume, and public
bootstrap fields remain observable. Session affinity is mandatory until
coordination is moved to shared state.

The demo configuration sets `store-all-signed=false`, applies conservative
coordination limits, and leaves `hyperstream-recording-signers=[]`, which
disables `record`. Add explicit trusted signer addresses only when a recording
adapter and durable-store policy are deployed.

The device uses HTTP requests and cursor polling. It does not expose a
device-level WebSocket, distribute ownership across nodes, terminate RTMP,
provision TURN or an SFU, transcode, segment, or serve media. Those remain
adapter responsibilities. Recording requires an external adapter to write
finalized immutable segments first. A replay chain is generic metadata, not
automatically browser-playable media.

## Standalone Broadcast Demo

The demo under [`demos/hyperstream/`](../../demos/hyperstream/README.md)
exercises the device from independent browser pages while keeping media outside
the HyperBEAM mailbox. The broadcaster page first creates an open signed
Hyperstream session. Before allocating a MediaMTX path, the adapter joins the
session through its internal HyperBEAM origin and verifies the live session,
protocol, owner metadata, publisher membership, and starting state. It returns
a short-lived challenge containing its temporary peer coordinates. The owner
sends a targeted proof signal bound to that challenge, connection, and exact
publisher and adapter generations. The HTTP completion endpoint returns only
acceptance; the adapter delivers media credentials exclusively through a
targeted signal visible to the owner generation. It then accepts one stream
through browser WHIP or, where enabled, external OBS/RTMP. MediaMTX remuxes the
source into one full-segment fragmented MP4 HLS rendition. The owner publishes
a `hyperstream-hls-p2p@1` playback descriptor without publish credentials
through `update` only after its HTTPS manifest is readable.

Each `/watch.html` tab creates its own signed identity, joins the Hyperstream
session, runs its event cursor and heartbeat, and reads that descriptor. Hls.js
and P2P Media Loader fetch the encoded HLS segments. A deployment-owned
WebTorrent-compatible WSS tracker helps viewers form WebRTC data channels and
exchange segments, reducing origin downloads when peers are reachable. The
manifest and every segment remain available through HTTPS, so a viewer switches
to ordinary HTTP HLS when tracker, P2P, UDP, or peer delivery is unavailable.
Viewer correctness therefore requires only normal outbound HTTPS on port 443;
TURN is not a playback dependency. TURN can improve the P2P connection ratio on
restrictive networks, at the cost of relay bandwidth.

Media path names contain an HMAC-derived authenticity suffix, and each tracker
URL carries a separate expiring HMAC capability tied to the active media
reservation. The owner publishes that read-side tracker capability in playback
metadata so invited viewers can open the tracker; it cannot authorize ingest or
release. The tracker does not bind that connection to an exact protocol info
hash. Instead, each authorized connection may announce only one swarm and is
subject to a 32-connection per-client limit, a 10-second first-announce
deadline, and a 180-second idle-announce deadline. A socket also closes when its
capability expires and is revoked when the reservation is released. WHIP/RTMP
publish credentials use a separate media-scoped HMAC token and expire after 15
minutes by default; another media-scoped token authorizes release. Media
allocation is serialized, idempotent per session/publisher pair, and capped
across active MediaMTX paths and pending reservations. The configurable ceiling
cannot exceed 100.

MediaMTX is a deployment adapter, not part of the device. It does no
transcoding. The browser test source is H.264; OBS should use H.264/AAC and a
two-second keyframe interval to match the configured two-second HLS segment
target. Longer GOPs increase segment duration and live latency.

Build and test the demo bundle before running it:

```sh
cd demos/hyperstream
npm ci
npm run build
npm test
```

Start MediaMTX with `deploy/mediamtx.yml`, then run `server.mjs` with the public
origins for HyperBEAM, WHIP, HLS, the tracker, and optional RTMP:

```sh
mediamtx deploy/mediamtx.yml

HOST=127.0.0.1 \
PORT=4173 \
HYPERBEAM_ORIGIN=http://127.0.0.1:18785 \
HYPERSTREAM_HYPERBEAM_INTERNAL=http://127.0.0.1:18785 \
HYPERSTREAM_WHIP_BASE=http://127.0.0.1:8889 \
HYPERSTREAM_HLS_BASE=http://127.0.0.1:8888 \
HYPERSTREAM_MEDIAMTX_API=http://127.0.0.1:9997 \
HYPERSTREAM_MEDIAMTX_HLS_INTERNAL=http://127.0.0.1:8888 \
HYPERSTREAM_TRACKER_URL=ws://127.0.0.1:4173/tracker \
HYPERSTREAM_RTMP_BASE=rtmp://127.0.0.1:1935 \
HYPERSTREAM_MEDIA_TOKEN_SECRET=replace-with-a-random-secret \
node server.mjs
```

The server-only adapter variables are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HYPERSTREAM_HYPERBEAM_INTERNAL` | Public `HYPERBEAM_ORIGIN`, then `http://127.0.0.1:18785` | Node origin used to join the session and verify the targeted owner proof before media allocation. |
| `HYPERSTREAM_MEDIAMTX_API` | `http://127.0.0.1:9997` | Credential-free loopback API used to reconcile active paths and release publishers. |
| `HYPERSTREAM_MEDIAMTX_HLS_INTERNAL` | `http://127.0.0.1:8888` | Loopback HLS origin used to calculate SHA-256 references for live segments. |
| `HYPERSTREAM_MAX_MEDIA_SESSIONS` | `64` | Adapter-wide ceiling across active paths and pending reservations. |
| `HYPERSTREAM_MAX_ADMISSION_CHALLENGES` | `128` | Maximum simultaneous owner-proof challenges; accepted range is 8 through 1024. |
| `HYPERSTREAM_ADMISSION_CHALLENGE_TTL_SECONDS` | `30` | Owner-proof challenge lifetime; accepted range is 15 through 40 seconds. |
| `HYPERSTREAM_TRACKER_TOKEN_TTL_SECONDS` | `86400` | Media-reservation-scoped tracker URL lifetime; accepted range is 900 through 604800 seconds. |

`HYPERSTREAM_MEDIA_TOKEN_TTL_SECONDS` defaults to `900`,
`HYPERSTREAM_TRACKER_MAX_PEERS` defaults to `2048`,
`HYPERSTREAM_MEDIA_SESSION_RATE` defaults to `20`, and
`HYPERSTREAM_MEDIA_SESSION_CLIENTS` defaults to `4096`. They bound publish-token
lifetime, tracker capacity, and media-session admission. The media-session cap
accepts values only from 1 through 100. A persistent deployment must provide a
stable `HYPERSTREAM_MEDIA_TOKEN_SECRET`; the random per-process fallback
invalidates outstanding publish, tracker, and release capabilities on restart.
With a stable secret, a restarted adapter recognizes an HMAC-authenticated media
ID only while the MediaMTX API reports that path active, allowing HLS reads,
digests, tracker reconnection, and release to recover without persisting publish
credentials. A MediaMTX or HyperBEAM restart still ends the corresponding live
media or coordination state.

The generic `deploy/mediamtx.yml` enables plaintext RTMP for local integration
testing. The public demo2 deployment uses `deploy/mediamtx.demo2.yml` and
disables RTMP. Its dedicated `hyperstream-mediamtx.service` runs under the
`hyperstream-media` account and exposes pages, HLS, WHIP control, and the WSS
tracker through HTTPS on port 443. Only MediaMTX's browser-WHIP ICE listener is
public on `8189/udp` and `8189/tcp`; HLS `8888/tcp`, WHIP HTTP `8889/tcp`, API
`9997/tcp`, and metrics `9998/tcp` stay on loopback. The demo page server and
MediaMTX auth callback use loopback `9092/tcp`. The public proxy returns 404 for
`/api/media-auth`; publish credentials are checked only through the loopback
callback.

The broadcaster shows Hyperstream calls, session state, cursor and viewer
membership, sanitized WHIP routing, ingest frame and byte counters, HLS
readiness, and each viewer's acknowledged delivery mode. The viewer shows
device and lifecycle activity, tracker and P2P events, per-segment source, HTTP
fallback, HTTP and P2P bytes, P2P upload and ratio, peer count, buffer depth,
live latency, decoded frames and frame rate, dimensions, and segment counts.
Diagnostics omit credentials, SDP, ICE candidates, and peer addresses. Fatal
media errors have a four-attempt recovery budget with exponential delays capped
at four seconds. P2P failure first rebuilds HTTP-only playback; 30 seconds of
stable playback resets the budget, while exhaustion becomes an explicit
terminal error and manual retry instead of an unbounded loop.

The URL fragment is a public locator, not authorization. It contains no publish
credential, peer token, join capability, signing key, SDP, or ICE body. Open
admission is suitable only for this technical demo; private streams need signer
admission or an out-of-band restricted-session capability. Abrupt tab closure
is handled by the peer lease expiring because `pagehide` cannot reliably finish
a signed asynchronous leave.

P2P viewers can learn network-address information about connected peers. Use
relay-only TURN when peer IP privacy outweighs relay cost. The supplied player
is STUN-only unless `globalThis.HYPERSTREAM_RTC_CONFIGURATION` provides TURN.
MediaMTX's one-rendition master can change its advertised bandwidth and
resolution with the source. The player normalizes those dynamic attributes
before P2P Media Loader assigns stream identity, keeping identical viewers in
one swarm rather than fragmenting it.

Every P2P-delivered segment is hashed in the viewer and compared with a SHA-256
reference fetched from the same HTTPS application origin. Peer bytes fail
closed on mismatch or when the reference is unavailable. Trusted HTTPS-origin
bytes start the same check in the background without waiting, so digest-service
load or failure cannot defeat playback fallback. The digest service reads the
corresponding full segment through the viewer's MediaMTX HLS session. It
validates the segment name, media response type, and size, while bounded
positive caches, session-scoped negative caches, per-address rate control, and
global concurrency control limit origin work. This detects peer corruption
relative to the live origin, but the digest service is HTTPS-origin trusted and
mutable. It is not a signed immutable HyperBEAM manifest and does not provide
historical verification after origin retention expires.

MediaMTX serves one source rendition and does not transcode. The device's
recording primitives exist, but the supplied adapter sets MediaMTX recording off
and does not store segments in HyperBEAM or call `record`. Replay playback is
therefore not wired into this demo. The complete hybrid system also has not been
load-tested with hundreds of viewers; peer and memory ceilings are safeguards,
not evidence of that capacity.

## Validation

Build HyperBEAM and run the focused device suite:

```sh
HOME=/tmp/odysee-hb-home rebar3 as hyperbeam compile
HOME=/tmp/odysee-hb-home HB_PORT=0 rebar3 device test -d dev_hyperstream
```

The suite covers signed `transport-key` bootstrap, sealed and
operation-bound HTTP request/response bodies, plaintext rejection, targeted
visibility and cursor delivery, idempotency, signer and token authority,
peer-generation fencing, restricted membership, payload and mailbox limits,
recording signer policy, missing media, deterministic retry, and the bounded
durable recording and replay chain.
