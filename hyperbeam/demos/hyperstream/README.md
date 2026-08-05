# Hyperstream Broadcast Demo

This standalone technical demo exercises the generic `hyperstream@1.0` device
without the Odysee frontend. It separates control from media delivery:

```text
Broadcaster
   | signed Hyperstream session and lifecycle calls
   +---------------------------------------------> HyperBEAM
   |
   | one WHIP or RTMP contribution
   v
MediaMTX ---- full-segment fMP4 HLS over HTTPS ----> Viewers
                                                       ^
                                                       |
                  private WebTorrent tracker <---------+
                  optional P2P segment exchange
```

HyperBEAM remains the signed, sealed session and control plane. It owns the
session, peer leases, ordered lifecycle events, targeted opaque signals, and
owner-controlled playback metadata. It does not parse media protocols or carry
media bytes. MediaMTX is an external media adapter: it accepts one browser WHIP
or, when enabled, OBS/RTMP contribution and remuxes that stream into
full-segment fragmented MP4 HLS. Hls.js and P2P Media Loader fetch those encoded
segments over HTTPS and opportunistically exchange them between viewers through
WebRTC data channels.

Media allocation happens only after control-plane admission. The broadcaster
creates a signed Hyperstream session first. The adapter joins that session
through its internal HyperBEAM origin, verifies the live status, protocol,
owner metadata, publisher membership, and starting state, and returns a
short-lived challenge containing its temporary peer coordinates. The owner
sends a targeted proof signal bound to the challenge, connection, and exact
publisher and adapter generations. The completion endpoint returns only
`accepted`; the adapter delivers the media credentials back exclusively through
an adapter-to-owner targeted Hyperstream signal. Allocation is serialized,
idempotent for each session/publisher pair, and capped across active MediaMTX
paths and pending reservations.

The broadcaster page is `/`. The independent viewer page is
`/watch.html#invite=...`. Every page creates an in-memory RSA-PSS/SHA-512
identity and signs its outer HyperBEAM requests. It obtains the node's public
ephemeral P-256 key from `transport-key`, then seals semantic request and
response bodies with the `hs1` P-256 ECDH, HKDF-SHA256, and AES-256-GCM
transport. The trusted HyperBEAM node decrypts those envelopes to coordinate
the session; the scheme is not secrecy from the node operator.

## Prerequisites

- Node.js 22 or newer.
- A HyperBEAM node containing the normal Forge-packaged `hyperstream@1.0`
  device.
- MediaMTX 1.20.0 or a compatible release.
- HTTPS for every non-loopback deployment.

MediaMTX remuxes but does not transcode. Sources must already use codecs that
the chosen ingest and browser HLS path support. The included browser source is
H.264 video. For OBS, use H.264 video and AAC audio, with a two-second keyframe
interval. The two-second GOP is required for the configured two-second HLS
segment target; less frequent keyframes make segments and live latency longer.

## Local run

Start HyperBEAM from `hyperbeam/`:

```sh
HB_CONFIG=demos/hyperstream/hyperbeam-config.json \
  HB_PORT=18785 rebar3 device local
```

The supplied node config sets `store-all-signed=false`, because otherwise a
stock node can retain encrypted heartbeat and polling requests. It also leaves
`hyperstream-recording-signers=[]`, so recording is disabled until an operator
deploys an adapter and durable-store policy.

Install and build the browser bundle from `hyperbeam/demos/hyperstream/`:

```sh
npm ci
npm run build
npm test
```

Start MediaMTX with the supplied configuration:

```sh
mediamtx deploy/mediamtx.yml
```

Start the demo server from the same directory. Use a stable, randomly generated
media-token secret in any persistent deployment:

```sh
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

Open <http://127.0.0.1:4173/>. Choose **Browser WHIP demo** to publish the
included loop, or **External OBS / RTMP** to receive a short-lived server and
stream key. The watch URL appears only after the HLS manifest is reachable.

## Runtime configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `HOST` | Demo-server bind address. | `127.0.0.1` |
| `PORT` | Demo-server HTTP port. | `4173` |
| `HYPERBEAM_ORIGIN` | Public HyperBEAM origin used by browsers. | `http://127.0.0.1:18785` |
| `HYPERSTREAM_HYPERBEAM_INTERNAL` | Internal HyperBEAM origin used to join the session and verify the targeted owner proof. | `HYPERBEAM_ORIGIN`, then `http://127.0.0.1:18785` |
| `HYPERSTREAM_WHIP_BASE` | Public MediaMTX WHIP base URL. | Same-origin `/whip` |
| `HYPERSTREAM_HLS_BASE` | Public MediaMTX HLS base URL. | Same-origin `/hls` |
| `HYPERSTREAM_MEDIAMTX_API` | Credential-free loopback MediaMTX API origin used for active-path accounting and cleanup. | `http://127.0.0.1:9997` |
| `HYPERSTREAM_MEDIAMTX_HLS_INTERNAL` | Loopback MediaMTX HLS origin used to calculate live-segment digests. | `http://127.0.0.1:8888` |
| `HYPERSTREAM_TRACKER_URL` | Deployment-owned WebTorrent tracker URL. | Same-origin `/tracker` over WS/WSS |
| `HYPERSTREAM_RTMP_BASE` | Optional public RTMP server URL exposed to broadcasters. | Disabled |
| `HYPERSTREAM_MEDIA_TOKEN_SECRET` | HMAC secret for media IDs and distinct publish, tracker, and release capabilities. | Random per process |
| `HYPERSTREAM_MEDIA_TOKEN_TTL_SECONDS` | Publish-credential admission lifetime. | `900` |
| `HYPERSTREAM_TRACKER_TOKEN_TTL_SECONDS` | Media-reservation-scoped tracker URL lifetime; accepted range is 900 through 604800 seconds. | `86400` |
| `HYPERSTREAM_MAX_MEDIA_SESSIONS` | Adapter-wide active-path and pending-reservation ceiling; accepted range is 1 through 100. | `64` |
| `HYPERSTREAM_MAX_ADMISSION_CHALLENGES` | Simultaneous owner-proof challenge ceiling; accepted range is 8 through 1024. | `128` |
| `HYPERSTREAM_ADMISSION_CHALLENGE_TTL_SECONDS` | Lifetime of a one-time targeted owner-proof challenge; accepted range is 15 through 40 seconds. | `30` |
| `HYPERSTREAM_TRACKER_MAX_PEERS` | Tracker connection and per-swarm peer ceiling. | `2048` |
| `HYPERSTREAM_MEDIA_SESSION_RATE` | Admission requests allowed per client per minute. | `20` |
| `HYPERSTREAM_MEDIA_SESSION_CLIENTS` | Maximum remembered rate-limit client set. | `4096` |

The generated media ID includes a truncated HMAC authenticity suffix, so random
or modified path names fail closed. Its tracker URL includes a separate
expiring HMAC capability tied to the active media reservation. That read-side
WebSocket capability is published in the owner-controlled Hyperstream playback
descriptor so invited viewers can enter the tracker; it cannot authorize WHIP,
RTMP, or release. It does not bind a protocol info hash: the tracker instead
permits only one announced swarm per connection, limits each client address to
32 connections, requires a first announce within 10 seconds, and closes a
connection after 180 seconds without an announce. A socket also closes when its
capability expires and is revoked when the media reservation is released. The
generated watch URL contains the node origin, session ID, and publisher ID.

The short-lived WHIP bearer token or RTMP stream key and the separate release
token are sent only through the owner-targeted Hyperstream credential signal.
They never appear in the HTTP completion response, session metadata, watch URL,
diagnostics, or recording descriptors. Publish credentials expire after 15
minutes by default. The release token has a different HMAC scope and authorizes
only teardown of its exact media reservation.

A persistent deployment must set a stable media-token secret. After an adapter
process restart, a media ID with a valid HMAC suffix is accepted for HLS reads,
digests, tracker reconnection, and release only while MediaMTX reports that path
active. This lets an existing MediaMTX publisher and viewers recover without
persisting publish credentials. A random replacement secret deliberately makes
those old paths unverifiable, and a MediaMTX restart still ends the live media
connection.

## Network and deployment

The supplied MediaMTX and Caddy templates use these ports:

| Port | Exposure | Purpose |
| --- | --- | --- |
| `443/tcp` | Public | Demo pages, HyperBEAM when proxied, WHIP control, HLS, and WSS tracker. |
| `1935/tcp` | Local/test when the generic configuration enables RTMP | OBS/RTMP contribution; disabled by the public demo2 configuration. |
| `8189/udp` and `8189/tcp` | Public when browser WHIP is enabled | Broadcaster-to-MediaMTX WebRTC media. |
| `8888/tcp` | Loopback | MediaMTX HLS origin behind Caddy. |
| `8889/tcp` | Loopback | MediaMTX WHIP HTTP endpoint behind Caddy. |
| `9092/tcp` | Loopback in the demo2 template | Demo server and MediaMTX HTTP auth callback. |
| `9997/tcp`, `9998/tcp` | Loopback | MediaMTX API and metrics. |

The generic `deploy/mediamtx.yml` keeps plaintext RTMP available for local
integration testing. The public `demo2.zephyrdev.xyz` deployment instead uses
`deploy/mediamtx.demo2.yml`, which disables RTMP and accepts browser WHIP only.
It runs MediaMTX as the dedicated `hyperstream-media` user through
`deploy/hyperstream-mediamtx.service`: HLS, WHIP HTTP, API, and metrics bind to
loopback, while only the WHIP ICE UDP/TCP listener binds publicly. Caddy exposes
the page, HLS, WHIP control, and tracker on HTTPS/WSS port 443.

The demo2 MediaMTX template advertises the server's direct public address for
ICE. A CDN-proxied hostname is not an ICE endpoint unless the CDN also proxies
UDP/TCP 8189. Update `webrtcAdditionalHosts` if the demo server address changes;
do not substitute the orange-cloud hostname.

Install the MediaMTX binary and adapt that service, the appropriate MediaMTX
configuration, and `deploy/Caddyfile.demo2` to the target host. Keep
`/api/media-auth`, the MediaMTX API, and the internal HLS digest source reachable
only from loopback; the public Caddy auth route deliberately returns 404.
Persist `HYPERSTREAM_MEDIA_TOKEN_SECRET` with mode-restricted service
configuration. Terminate public page, HLS, WHIP-control, tracker, and HyperBEAM
traffic with HTTPS, preserve the literal `/~hyperstream@1.0/<operation>` route,
route a session to one HyperBEAM node, reject oversized bodies, rate-limit
admission, and disable request/response body logging.

When Caddy is behind Cloudflare, configure the global `servers` options with
Cloudflare's current IPv4 and IPv6 ranges, `trusted_proxies_strict`, and
`client_ip_headers CF-Connecting-IP X-Forwarded-For`. The `{client_ip}` rate
keys in `deploy/Caddyfile.demo2` assume this trusted-proxy parsing is active.

Viewer playback correctness does not depend on UDP, inbound firewall rules, a
working tracker, or another peer. Every encoded segment remains available by
ordinary HLS over HTTPS on port 443, and the player drops back to HTTP-only HLS
if P2P initialization or delivery fails. TURN is therefore not required for
playback. Supplying TURN can improve the fraction of viewers that form P2P data
channels behind restrictive NATs, but relayed P2P traffic then consumes TURN
bandwidth. The shipped viewer P2P configuration is STUN-only unless
`globalThis.HYPERSTREAM_RTC_CONFIGURATION` supplies TURN. Browser WHIP and RTMP
contribution have their own public-port requirements listed above.

Fatal media errors use at most four recovery attempts with delays capped at
four seconds. A P2P runtime error first rebuilds the player in HTTP-only mode;
30 seconds of stable playback resets the recovery budget. Exhausting the budget
stops playback and exposes an explicit retry control instead of looping
indefinitely.

## Diagnostics

The broadcaster console exposes:

- Hyperstream session, owner, generation, cursor, peer count, signed device
  calls, sealed lifecycle signals, and manifest publication;
- MediaMTX path and ingest state, sanitized WHIP candidate route, frames, bytes,
  effective frame rate, HLS manifest readiness, and tracker publication;
- a stable keyed viewer roster showing join, playback acknowledgement, and each
  viewer's reported HTTPS or P2P-assisted delivery mode.

Each watch page exposes:

- its independently signed peer identity, generation, event cursor, heartbeat,
  session updates, and targeted playback acknowledgements;
- HLS manifest and playlist events, tracker state and warnings, P2P peer joins
  and departures, individual segment source, and HTTP fallback events;
- HTTP bytes, P2P download and upload bytes, P2P ratio, peer count, buffer depth,
  live latency, decoded frames and frame rate, video dimensions, and segment
  counts;
- HTTPS and P2P integrity-check counts, the most recent validation result, and
  explicit peer-segment rejection reasons before fallback.

The event rails report operation names, timings, cursors, payload sizes, and
sanitized states. They do not render credentials, SDP, ICE candidates, peer
addresses, or ports. Browser storage is not used.

## Current boundaries

- The viewer swarm is opportunistic. Peers can fail to connect, disappear, or
  contribute nothing; HTTPS remains the independent fallback.
- P2P WebRTC connections disclose network-address information to connected
  peers. The default is STUN-only; use an explicit relay-only TURN configuration
  if peer IP privacy outweighs relay bandwidth.
- MediaMTX emits a one-rendition master whose advertised bandwidth and
  resolution can change with the live source. The player normalizes those
  dynamic attributes before P2P Media Loader sees the master, keeping identical
  viewers in one stable stream identity rather than fragmenting the swarm.
- Every P2P-delivered segment is hashed in the viewer and compared with a
  SHA-256 reference fetched from a same-origin HTTPS endpoint. P2P bytes fail
  closed on mismatch or when the reference cannot be obtained. Trusted
  HTTPS-origin bytes start the same check in the background without blocking
  playback, so digest-service load or failure cannot defeat fallback. The
  endpoint reads the corresponding full segment through the viewer's loopback
  MediaMTX HLS session. Segment names, response type, and maximum size are
  checked; the server bounds positive caches, short-lived shared negative caches,
  per-address request rate, and global digest concurrency. This detects peer
  corruption relative to the live origin, but the digest service is trusted and
  mutable: it is not a signed immutable HyperBEAM manifest and does not provide
  historical verification after origin retention expires.
- Peer validation allows the adapter's bounded five-second cold digest lookup
  to finish before the P2P request is considered stalled. HTTPS downloads start
  immediately, so this integrity-check allowance does not delay fallback
  playback.
- MediaMTX serves one source rendition and performs no transcoding. Unsupported
  source codecs, audio layouts, or long keyframe intervals must be corrected at
  the encoder or by adding a separate transcoding and rendition tier.
- `record` and `close` already create immutable recording-chain and replay
  manifests after an allowlisted owner links stored segments. The supplied
  MediaMTX adapter has recording disabled and is not wired to write HyperBEAM
  segments or invoke those operations, so replay playback is not yet available
  in this demo.
- Hyperstream coordination and its `hs1` key are node-local and restart-lost.
  Viewers must rejoin after a restart; completed immutable recording chains,
  when an adapter supplies them, survive independently.
- The tracker and app have explicit peer ceilings, but the complete system has
  not been load-tested with hundreds of simultaneous viewers. Separate the
  tracker, add observability, and capacity-test the edge, origin, tracker, and
  HyperBEAM polling path before claiming that scale.

The open session is appropriate for a public technical demo, not private-stream
authorization. A session ID is a locator. Private deployments must enforce
signer admission or distribute restricted-session capabilities through a
separate authenticated channel.
