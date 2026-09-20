# Content restrictions

Content restrictions are evaluated by the HyperBEAM node that serves the
manifest and content. The browser does not call `api.odysee.com` for a locale or
geoblock list and does not use browser GPS, language, or account-country data.

```text
signed policy snapshot                         local DB-IP MMDB
          |                                           |
          v                                           v
request -> blacklist@1.0 request hook -> store read -> response hook -> 200, 451, or 503
                    |                                      |
                    +---- direct socket/proxy-safe IP -----+
```

The request hook catches identifiers already present in a route. The response
hook catches claim, signing-channel, outpoint, descriptor, stream, and generic
HyperBEAM identifiers that become visible only after resolution. For each
subject the device checks global providers first. Only when no global rule
matches and a geographic rule or country-bound source contains that subject
does it perform one local country lookup and evaluate the corresponding
regional entries. A global match never performs a country lookup.

## Policy message

A global provider may remain a legacy newline-delimited list of 43-character
HyperBEAM IDs. A structured provider is a generic message with a `rules` list:

```json
{
  "data-protocol": "content-policy",
  "expires-at": 1798761600000,
  "rules": [
    {
      "effect": "deny",
      "subjects": [
        { "type": "lbry-claim", "value": "0123456789abcdef0123456789abcdef01234567" },
        { "type": "lbry-channel", "value": "89abcdef0123456789abcdef0123456789abcdef" }
      ],
      "countries": ["DE", "FR"],
      "reason": "distribution-rights"
    },
    {
      "effect": "deny",
      "subject": { "type": "lbry-outpoint", "value": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:0" },
      "groups": ["EU"],
      "reason": "eu-only"
    }
  ]
}
```

Supported Odysee/LBRY subject types are `lbry-claim`, `lbry-channel`,
`lbry-id`, `lbry-outpoint`, and `lbry-hash`. `hyperbeam` remains the generic
message-ID namespace. Untyped 40-hex, 96-hex, outpoint, and HyperBEAM values
are inferred, but typed subjects are preferred where a claim and channel might
share the same 40-hex value.

`countries` uses ISO 3166-1 alpha-2 codes. `continents` uses the MMDB continent
code. `groups: ["EU"]` uses DB-IP's explicit European Union membership flag;
it is not equivalent to `continents: ["EU"]`. Rules without countries,
continents, or groups are global. Only `deny` is currently defined.

Country-specific sources are configured separately and may use the same rule
format or a compact JSON array compatible with an Odysee-style blocklist:

```json
[
  {
    "id": "0123456789abcdef0123456789abcdef01234567",
    "country": "DE",
    "reason": "distribution-rights"
  },
  {
    "id": "89abcdef0123456789abcdef0123456789abcdef",
    "type": "lbry-channel",
    "country": "DE",
    "reason": "court-order"
  }
]
```

The country selected in `blacklist-country-providers` is authoritative and is
applied to every entry from that source. The entry-level `country` is therefore
optional, but when present should agree with the source binding. An omitted
`type` is inferred as `lbry-id` for a 40-character claim or channel ID, allowing
it to match either form. Use an explicit type when the distinction matters.

The recommended provider is a committed, signed HyperBEAM message. Rotate the
configured immutable policy ID to publish a new snapshot, or use a provider
path whose signed result advances. `blacklist-trusted-signers` authenticates
the message, and `expires-at` prevents use after the stated Unix time in
milliseconds. With `blacklist-required-providers` enabled, a failed refresh
retains the last complete generation rather than installing a partial policy.

## Node configuration

This configuration requires the upstream patch in this branch. Add the
response hook only after pinning the merged HyperBEAM revision:

```json
{
  "blacklist-providers": ["<signed-policy-message-id>"],
  "blacklist-country-providers": {
    "DE": ["<signed-de-policy-message-id>"],
    "FR": ["<signed-fr-policy-message-id>"]
  },
  "blacklist-required-providers": true,
  "blacklist-trusted-signers": ["<policy-signer-address>"],
  "blacklist-country-db": "/var/lib/hyperbeam/dbip-country-lite.mmdb",
  "blacklist-country-timeout": 2000,
  "blacklist-fallback": "halt",
  "blacklist-timeout": 5000,
  "blacklist-trusted-proxies": ["127.0.0.1", "::1"],
  "on": {
    "response": [
      { "device": "blacklist@1.0" }
    ]
  }
}
```

`blacklist-providers` is the main global layer.
`blacklist-country-providers` maps ISO 3166-1 alpha-2 codes to one or more
provider messages. All configured sources are refreshed into one atomic local
generation, so selecting the viewer's country never performs a provider fetch
on the request path. With `blacklist-required-providers: true`, a failed global
or country-source refresh retains the prior complete generation.

The existing `config.json` request pipeline already ends with
`blacklist@1.0`; preserve that pipeline and merge the response hook rather than
replacing `on`. Do not configure `blacklist-trusted-proxies` unless those exact
addresses are controlled reverse proxies that overwrite `X-Real-IP`. Without a
match, the device uses the direct socket peer and ignores the header.

## Local country data

[DB-IP Country Lite](https://db-ip.com/db/download/ip-to-country-lite) publishes
a monthly MMDB database under CC BY 4.0. It is less accurate than DB-IP's paid
database and requires attribution. Its
[MMDB schema](https://db-ip.com/db/format/ip-to-country-lite/mmdb.html) includes
country ISO code, continent code, and European Union membership, which are the
only fields this policy path consumes.

Each node operator downloads or receives the artifact ahead of time, verifies
the artifact selected by its deployment process, installs it at the configured
local path, and restarts the node after an atomic replacement. The artifact may
be mirrored over content-addressed storage under its license, so request-time
operation remains decentralized even if operators share the same monthly data
release. No IP address is sent to the data publisher.

The upstream device uses [Locus](https://hexdocs.pm/locus/) to load and query
the local MMDB file. The application footer supplies the required DB-IP
attribution for the reference deployment. Operators that substitute a
different compatible MMDB dataset must satisfy that dataset's license and
adjust attribution.

## Enforcement details

- `451` means the node resolved the applicable location attributes and a deny
  rule matched, or a global deny rule matched.
- `503` with `reason: location-unavailable` means a subject was present in a
  geographic or country-bound source but the required location could not be
  evaluated. Other content is not blocked by that failure.
- Policy data can identify content, but must never contain viewer IPs,
  credentials, cookies, or other request-private values.
- Historical media must be requested by stream/outpoint. The direct
  descriptor-hash routes are intentionally unavailable when policy providers
  are configured because a hash-only request cannot prove which claim or
  channel authorized the media.
- Native uploads can be restricted by their generic HyperBEAM immutable ID.
- Frontend rendering reflects the node result; it is not a second enforcement
  layer. A different node may deliberately select another policy.

## Rollout

1. Submit `patches/blacklist-content-restrictions.patch` to upstream
   HyperBEAM and land its tests.
2. Update `rebar.config` to the merged upstream commit.
3. Publish and sign an initial policy snapshot.
4. Install a licensed MMDB artifact on each enforcing node.
5. Configure providers, trusted signers, database path, proxy trust, and both
   hooks.
6. Verify allowed, country-denied, EU-group-denied, global-denied, unavailable
   location, claim, channel, outpoint, and media-read cases before production.
