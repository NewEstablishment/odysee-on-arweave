# Auth Migration Bridge

## Summary

The current system already has the pieces needed for a practical migration path:

- legacy Odysee sessions are based on an `auth_token` cookie
- the frontend mirrors that token into `X-Lbry-Auth-Token` and legacy `auth_token` params
- HyperBEAM can sign requests with node-hosted wallets through `auth-hook@1.0`
- `secret@1.0` can host wallets behind a pluggable access-control device
- the frontend already has Arweave wallet association flows that prove address ownership

The important product split is that legacy tokens should be a migration credential, not the long-term native identity. Existing users can use the legacy token to claim or bind a HyperBEAM/Arweave identity. New users should be able to start from an Arweave/HB-native identity and never depend on the legacy DB for login.

## Current Infra

Legacy auth is cookie-first. `odysee-frontend/ui/util/saved-passwords.ts` stores the value under the cookie name `auth_token`. `odysee-frontend/ui/index.tsx` overrides `Lbryio.getAuthToken` and `Lbryio.setAuthToken` so the app reads and writes that cookie. `odysee-frontend/ui/redux/middleware/auth-token.ts` copies the cookie value into `X-Lbry-Auth-Token` after a successful user fetch/authentication.

Legacy internal API calls use the token in more than one shape. `odysee-frontend/extras/lbryinc/lbryio.ts` adds `auth_token` to query/body params for direct `api.lbry.com` calls, and its HyperBEAM helper is already shaped to send both `X-Lbry-Auth-Token` and `auth_token` when a node-backed internal API device exists.

HyperBEAM full mode can forward auth headers. `odysee-frontend/ui/lbry.ts` builds HyperBEAM node request headers from the saved `auth_token`, `X-Lbry-Auth-Token`, `X-Odysee-User-Id`, and `Authorization`, but only when `shouldSendHyperbeamAuthHeaders()` is true. In `odysee-frontend/ui/util/hyperbeamMode.ts`, that currently means full HyperBEAM mode, not hybrid mode.

The current HyperBEAM bridge is intentionally public/read-first. `hyperbeam/docs/build/odysee-hyperbeam-bridge.md` says authenticated search flags like `include_purchase_receipt` and `include_is_my_output` stay on the existing SDK/proxy path until authenticated HyperBEAM forwarding is added. The actual Odysee HB devices reinforce that: `~odysee-claim@1.0/search` strips credential-like fields and those authenticated flags, while `~odysee-file@1.0`, `~odysee-subscription@1.0`, and `~odysee-file-reaction@1.0` reject private credentials for their public count/reaction reads.

The frontend has some device names for future product surfaces, such as `~odysee-internal-apis@1.0`, `~odysee-product-events@1.0`, and `~odysee-search@1.0`. Those devices are not present in `hyperbeam/src/preloaded/odysee` right now, and the frontend device whitelist currently only enables `~odysee@1.0` as a canonical native device. So auth design for those product surfaces is still ahead of the implementation.

There is already a legacy DB-backed Arweave wallet association path. `odysee-frontend/ui/redux/actions/payments.ts` registers an Arweave address by getting the active public key, signing the address with Wander/ArConnect, and calling `arweave/address/add` through `Lbryio.call`. That proves address ownership to the legacy API and stores account-linked Arweave status for tips/payments.

## HyperBEAM Auth Fit

The default HyperBEAM node config wires `auth-hook@1.0` into `on.request`. It activates when the request has `authorization` or `!`. The default provider is `http-auth@1.0`, which is why `?!` produces a Basic challenge locally.

For Odysee, the stock `cookie@1.0` provider is probably not quite enough by itself. It creates and maintains its own `secret-*` cookies. That is useful for new HB-native sessions, but it does not directly interpret the existing `auth_token` cookie as an Odysee account session.

Sam's "could import them without changing the cookie" idea points to a small Odysee-specific auth provider/access-control device:

- read existing credentials from `Cookie: auth_token=...`, `X-Lbry-Auth-Token`, or `auth_token`
- validate the token against the legacy API or a constrained legacy token verifier
- resolve the stable legacy user/account id
- look up the associated Arweave/HB wallet if one exists
- return a stable secret or key id to `auth-hook@1.0`/`secret@1.0`
- strip token material before anything becomes a public committed message

That lets HB accept today's cookie without changing the browser login cookie. If the HB node is not same-origin with Odysee, the browser will not send the cookie by default, so the current explicit `X-Lbry-Auth-Token` forwarding remains the practical local/dev path. If HB is reverse-proxied under the same site, the raw cookie path becomes more natural.

## Recommended Identity Model

Use two tracks during migration.

Track 1: legacy account migration.

An existing Odysee user authenticates with the current `auth_token`. The HB auth provider validates the token and maps it to a stable `user_id`. If the legacy account already has an Arweave address association, HB uses that address as the identity anchor. If not, the user can connect Wander/ArConnect and sign a binding challenge. The legacy DB records the account-to-address binding for migration and account recovery.

The HB node can then either host a wallet for that identity through `secret@1.0`, or treat the user's Arweave wallet as the primary signer and use node-hosted wallets only as delegated execution/session wallets.

Track 2: native account creation.

A new user starts with an Arweave wallet or an HB-generated hosted wallet session. The identity anchor is the Arweave address, not a legacy `user_id`. Profile/preferences/session state should live in an AO/HB-native registry or process, not in the legacy DB. A node-hosted wallet can improve UX, but it should be controlled by wallet signatures or HB cookies generated after wallet proof, not by an Odysee `auth_token`.

## Trust Boundary

The legacy-token path is not decentralized auth. It is a migration bridge. It still trusts Odysee's legacy account system to say who the user is.

A TEE node improves the story if raw tokens must be presented to the node, because the token verifier and wallet association can run inside a measured environment. But the trust root is still mixed: legacy API/DB plus the TEE measurement. To get to native decentralized auth, token-based access should only bootstrap wallet binding or delegated hosted-wallet setup.

## Proposed Implementation Slices

1. Document the credential contract.

Define the accepted incoming credential shapes:

- `Cookie: auth_token=...`
- `X-Lbry-Auth-Token: ...`
- `auth_token` request field for compatibility

Define the normalized identity output:

- `legacy-user-id`
- `arweave-address`, when bound
- `auth-source`
- `migration-state`

2. Add an Odysee legacy auth provider device.

Create an HB preloaded device that implements the generator/access-control shape expected by `auth-hook@1.0` and `secret@1.0`. It should validate a legacy token, return a stable identity-derived secret or key id, and never emit the raw token in committed output.

3. Add a binding endpoint.

Expose a flow where a legacy-authenticated user signs an Arweave address challenge and binds that address to the account. The existing `arweave/address/add` flow is the current closest production path and can be reused or mirrored.

4. Enable authenticated HB paths only where needed.

Do not make all read devices auth-aware. Start with the currently blocked authenticated search/user-context surfaces, such as `include_is_my_output` and `include_purchase_receipt`, and any future product API devices.

5. Add native signup/auth separately.

Build a native wallet challenge flow that does not call `user/new` and does not require a legacy `auth_token`. The output should be an HB/AO-native identity/session, with optional node-hosted wallet persistence.

## Open Questions

Should migrated users get a node-hosted wallet automatically after token validation, or only after signing an Arweave binding challenge?

Should the stable HB wallet key id be based on legacy `user_id`, bound Arweave address, or both?

Where should the account-to-wallet binding live long term: legacy DB during migration only, AO process, Arweave data item, or a signed HB registry state?

Should HB accept raw `auth_token` directly in production, or should Odysee issue a narrower short-lived HB migration token after normal legacy login?

Can the HB node be served under the same Odysee site so the existing cookie is naturally available, or should the frontend continue explicit header forwarding?

## Recommendation

Start with a legacy-token-to-wallet-binding bridge, not a full replacement auth system.

The first useful code milestone is an `odysee-legacy-auth@1.0` provider that accepts the existing `auth_token` cookie/header, validates it, maps it to a stable identity, and lets `auth-hook@1.0` sign requests with a node-hosted wallet. Immediately pair that with an Arweave address binding challenge so the migration has an exit ramp.

For new users, skip legacy `user/new` entirely. Make Arweave/HB identity the account root, then add hosted-wallet convenience on top.

## Planning Target

The MVP should prove that an existing logged-in Odysee user can reach a HyperBEAM node without changing their current cookie, and that HyperBEAM can convert that legacy session into a stable signing authority.

The MVP should not try to replace the whole login system. It should answer four questions:

- can the HB node read the same effective credential the web app already uses?
- can the HB node verify that credential without leaking it into committed output?
- can a verified legacy account resolve to one stable HB wallet identity?
- can that wallet identity later be bound to an Arweave address and used without the legacy token?

## MVP Request Flow

1. User is already logged into Odysee.
2. Browser calls a HyperBEAM authenticated path.
3. Credential reaches HB through one of the existing shapes:

- same-site `Cookie: auth_token=...`
- explicit `X-Lbry-Auth-Token`
- legacy-compatible `auth_token` field

4. `odysee-legacy-auth@1.0` extracts the token and validates it.
5. The provider resolves a stable legacy account identity.
6. The provider derives or looks up the HB wallet key id for that identity.
7. `auth-hook@1.0` asks `secret@1.0` to create or use the hosted wallet.
8. The request is signed by the hosted wallet.
9. The response never exposes the raw `auth_token`.

The same browser cookie can remain untouched. The HB side should adapt to the legacy cookie, not the other way around.

## Device Plan

### `odysee-legacy-auth@1.0`

This device should implement the provider/access-control behavior needed by `auth-hook@1.0` and `secret@1.0`.

Inputs:

- `cookie`
- `x-lbry-auth-token`
- `auth_token`

Outputs:

- normalized authenticated identity
- stable secret or key id for the hosted wallet
- no raw token in public output
- request-scoped `legacy-auth-proof` so `secret@1.0` can reuse an existing hosted wallet without receiving the raw token

Validation options:

- call the existing legacy user endpoint, likely equivalent to `user/me`
- call a smaller internal verifier endpoint if one exists or is added
- later, run verifier logic inside the TEE node if token handling needs that trust boundary

Stable identity choice:

- use legacy `user_id` for the first migration proof
- prefer bound Arweave address once the account has one
- avoid deriving wallet identity from the raw token, because token rotation should not create a new HB wallet
- require a node-held pepper when deriving hosted-wallet access secrets from legacy identity, because `user_id` alone is not secret material

Implementation status:

- `hyperbeam/src/preloaded/auth/dev_odysee_legacy_auth.erl` now implements `odysee-legacy-auth@1.0`
- supported credential inputs are `Cookie: auth_token=...`, `X-Lbry-Auth-Token`, `x-lbry-auth-token`, `auth_token`, and `auth-token`
- local/dev verification can use a configured `trusted-token-users` map
- production verification can point `legacy-auth-url` or `odysee-legacy-auth-url` at an internal-apis style `user/me` endpoint
- hosted-wallet secret derivation requires `legacy-auth-pepper` or `odysee-legacy-auth-pepper`
- the provider strips raw credentials and emits `legacy-user-id`, `auth-source`, `legacy-auth-path`, and `legacy-auth-proof`
- the access-control side accepts either fresh token authentication or the request-scoped proof generated during the auth-hook flow

Validation status:

- focused device package test passes with `HB_PORT=18761 rebar3 device test --module dev_odysee_legacy_auth`
- tests cover token extraction, missing-token rejection, raw credential stripping, stable secret derivation across token rotation, direct commit/verify, internal-apis `user/me` response parsing, and auth-hook signer reuse for two tokens mapped to the same legacy account

### Hosted wallet use

For the first proof, `secret@1.0` can use `in-memory` persistence. That avoids durable key storage while testing the flow.

For a real migration environment, the plan should move to `non-volatile` persistence only after:

- access-control verification is explicit
- key ids are stable across sessions
- wallet export/sync policy is decided
- operators know whether this is running in ordinary HB, trusted infrastructure, or TEE

## Browser Delivery Plan

Same-site production path:

- serve HB under an Odysee-controlled origin where the existing cookie is naturally available
- make sure CORS and credential forwarding are deliberate
- do not require a renamed cookie or a second migration cookie for the MVP

Local/dev path:

- keep forwarding `X-Lbry-Auth-Token` from the current frontend helpers
- use full HyperBEAM mode for authenticated tests
- keep hybrid mode public/read-mostly until authenticated devices are actually present

Frontend demo path:

- `odysee-frontend/ui/util/hyperbeamLegacyAuth.ts` exposes a guarded legacy-auth demo helper
- `window.odyseeHyperbeamLegacyAuthDemo()` runs the same helper from the browser console
- the HyperBEAM debug console shows the configured legacy-auth trust mode and has a "run legacy auth demo" action
- the demo calls `~odysee-legacy-auth@1.0/identify` and then an authenticated `/commitments` request so it can show both identity normalization and auth-hook signing
- the browser demo sends the existing `X-Lbry-Auth-Token` header only when the configured HB node passes the frontend trust gate
- `ODYSEE_HYPERBEAM_LEGACY_AUTH_DEMO_TOKEN` can provide a fake local verifier token for demos where the browser is not logged into a real legacy account
- same-origin HB routes include credentials for the unchanged-cookie proof; cross-origin local demos omit browser credentials and use the explicit header token to avoid wildcard-CORS credential failures
- `ODYSEE_HYPERBEAM_LEGACY_AUTH_TRUST=local-demo` allows only localhost/loopback HB nodes
- remote HB nodes should stay blocked until the trust mode is explicitly changed for a measured TEE or controlled trusted-node environment

Fallback path:

- allow an explicit `auth_token` request field for compatibility with existing internal API call shapes
- strip it immediately after verification

## Binding Plan

The migration bridge should quickly move users from "legacy token authenticated" to "wallet-bound".

1. User authenticates through existing Odysee session.
2. User connects Wander/ArConnect.
3. Frontend asks the wallet to sign a challenge that includes:

- Odysee account/user id or an opaque account binding nonce
- Arweave address
- HB node id or audience
- timestamp / expiry
- purpose string for account binding

4. Backend or HB verifier checks the signature.
5. The account-to-address binding is stored.
6. Future HB identity resolution prefers the bound Arweave address over the legacy `user_id`.

The current `arweave/address/add` path is the nearest existing implementation pattern. The auth migration version should reuse that proof shape if possible, but clarify whether the binding is for payment address, login identity, hosted-wallet controller, or all of the above.

## Native Signup Plan

Native signup should not call legacy `user/new`.

The native flow should be:

1. User connects or creates an Arweave wallet.
2. User signs a challenge scoped to Odysee/HB login.
3. HB or AO-native registry creates a profile/session for the wallet address.
4. Optional hosted wallet is created for convenience.
5. Hosted wallet access is controlled by wallet proof or an HB-native cookie, not an Odysee `auth_token`.

The legacy DB can still learn about native accounts later for compatibility, but it should not be the root authority for those accounts.

## Security Rules

Raw legacy tokens are bearer credentials. Treat them as secrets.

Rules for the MVP:

- never commit raw tokens into AO-Core messages
- never include raw tokens in logs, debug console output, commitment IDs, or public response bodies
- prefer short verifier responses over forwarding full user records
- bind hosted wallets to stable user/address identity, not to token value
- make token validation revocation-aware
- require explicit mode/config before accepting legacy credentials on public HB nodes

Rules for TEE:

- TEE can reduce token exposure to ordinary node operators
- TEE does not make legacy auth decentralized
- attestation should identify the verifier code and wallet-hosting policy before users trust the node with migration credentials

## Rollout Phases

Phase 1: local proof.

- implement `odysee-legacy-auth@1.0`
- validate `X-Lbry-Auth-Token` path locally
- prove `auth-hook@1.0` signs with one stable hosted wallet for the same legacy account
- prove token stripping in signed output

Phase 2: unchanged-cookie proof.

- run HB behind an Odysee-controlled same-site route or local equivalent
- prove the browser can use the existing `auth_token` cookie without setting a new one
- verify CORS/credentials behavior explicitly

Phase 3: wallet binding.

- add binding challenge flow
- bind legacy account to Arweave address
- prefer address-derived identity for HB wallet key id
- keep legacy token only as recovery/migration fallback

Phase 4: native account path.

- build wallet-signature login without legacy auth
- create HB/AO-native profile/session
- optionally provision hosted wallet
- keep compatibility writes to legacy DB out of the root auth path

## Validation Checklist

- unauthenticated HB auth path returns a clear auth-needed response
- existing `auth_token` cookie path works when same-site
- `X-Lbry-Auth-Token` path works in local/full HB mode
- `auth_token` field path works for compatibility calls
- token validation failure does not create a wallet
- token rotation does not create a second wallet for the same stable identity
- raw token is absent from response body, headers that are not explicitly auth headers, commitments, logs, and cache keys
- authenticated search/user-context behavior works only on intended devices
- public read devices remain public and credential-free
- bound Arweave address can become the preferred identity anchor
- native wallet-signature login works without legacy DB auth

## Near-Term Decisions

The first implementation pass needs these decisions:

1. Should token verification call the existing legacy API, a new narrow verifier endpoint, or direct DB access from HB infrastructure?
2. Should the first stable key id be `legacy-user-id`, `arweave-address`, or `legacy-user-id + arweave-address`?
3. Should the first hosted wallet be created automatically on valid legacy auth, or only after wallet binding?
4. Will the first browser proof use same-site cookies, explicit `X-Lbry-Auth-Token`, or both?
5. Which authenticated product surface should prove the value first: user-context claim search, internal API user profile, publish/upload, or hosted-wallet signing only?
