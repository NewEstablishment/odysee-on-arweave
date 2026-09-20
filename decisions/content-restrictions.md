# Decision: content restrictions are node policy

## Issue

The historical Odysee browser obtains a viewer locale from a centralized HTTP
endpoint, downloads a separate claim/channel geoblock list, and makes the block
decision in JavaScript. That design depends on Web2 availability, exposes the
policy decision only at the presentation layer, and can be bypassed by reading
media from another browser route.

HyperBEAM already has a node-selected `blacklist@1.0` request hook, but the
pinned implementation recognizes only newline-delimited HyperBEAM message IDs.
It cannot express LBRY claim/channel subjects, geographic conditions, policy
replacement, response-time subjects, or local country resolution.

## Decision

Expand upstream `blacklist@1.0` as a backward-compatible, generic content-policy
device. Do not introduce an Odysee policy device.

- Existing newline-delimited HyperBEAM ID providers retain their behavior.
- Global providers are evaluated before location resolution. Country-bound
  providers map ISO country codes to separate signed sources and are consulted
  only after one local country lookup.
- Structured, optionally signed policy snapshots add typed subjects and deny
  conditions for countries, continents, and country groups.
- Country sources may use compact JSON entries with `id`, optional `type`,
  optional `country`, and `reason`; their configured country binding remains
  authoritative.
- Request hooks reject subjects already visible in the route. Response hooks
  reject subjects revealed only after an immutable/store read.
- The node resolves the direct peer IP through a local MMDB database. Forwarded
  client IPs are accepted only from an explicit trusted-proxy allowlist.
- A geographic rule returns `503 location-unavailable` when the required local
  location attributes cannot be resolved. Unaffected content remains available.
- Policy refresh installs a complete generation atomically, so removed rules do
  not survive a snapshot replacement. Global and country sources are refreshed
  ahead of requests. Production configurations require every provider refresh
  to succeed and may restrict policies to trusted signers.
- The browser neither obtains a locale nor downloads a policy list. It renders
  node `451` and affected `503` results as unavailable.

DB-IP Country Lite in MMDB format is the reference local dataset. Every node
keeps its own copy and performs lookups locally; it does not call DB-IP or an
Odysee location API while serving a request. Its EU-membership field maps to the
generic `EU` country group, which is intentionally distinct from the `EU`
continent code.

## Consequences

The serving node, not browser JavaScript, becomes the enforcement boundary.
The viewer IP remains request-private and is neither committed nor added to a
policy message. Signed policy snapshots can be distributed and independently
selected by node operators, while database acquisition and updates remain an
operator responsibility.

Historical media responses carry the committed LBRY claim and signing-channel
identifiers needed by the response hook. Direct descriptor-hash media routes
are disabled whenever policy providers are configured; the frontend uses the
stream/outpoint route so a claim or channel rule cannot be bypassed.

Country databases are heuristic data, not cryptographic proof of physical
location. VPNs, relays, mobile routing, and database errors remain possible.
Nodes also remain free to select a different policy or no policy, consistent
with HyperBEAM's decentralized operator model.

The implementation is maintained as
[`patches/blacklist-content-restrictions.patch`](../patches/blacklist-content-restrictions.patch)
until the accepted upstream change lands. The pinned HyperBEAM revision and
default node configuration must not enable the response hook before that merge.
