# Native authentication: implementation audit and exploration plan

Date: 2026-09-21. Research only; no service calls, credential exports, node changes, application edits, or production experiments.

## Executive conclusion

The current application has a usable **cookie-controlled, node-hosted wallet**, not a portable account/session system. Its generic signing and immutable ownership contracts are valuable and should stay intact. Google/email/passkeys can authenticate a person, but none automatically transports the existing signing wallet, recovers encrypted history, creates revocable device sessions, or resolves simultaneous first enrollment on two nodes.

The upstream dependency already contains useful wallet import/export/sync/controller primitives. Their existence does **not** establish safe production synchronization: the inspected sync implementation returns full exported wallet records and its inner export request lacks the bundling protection explicitly required by the playlist integration. Review that boundary in isolation before using it.

Recommendation: first design a private, narrowly scoped credential/session-to-existing-wallet boundary for operated/trusted nodes, with atomic account enrollment and independent recovery. Keep all ordinary product writes on generic signed messages. Treat arbitrary community-node custody and signing-key rotation as separate decisions.

## Evidence and limits

- Application HEAD inspected: `cb64bc60da0766e4c56556a69997cd158060c101`; existing unrelated QA modifications preserved.
- Dependency pin: [rebar.config](../../rebar.config), line 5, HyperBEAM `2230df56e222adaf2aeefa945bc70c9db6b46cec`, plus checked-in narrow patches.
- Inspected actual dependency source under `_build/default/lib/hb`, application source, relevant decisions, and sibling source checkouts. Dependency paths below are local inspection evidence, not tracked application files.
- Sibling `HyperBEAM` HEAD `8413d8951b68e1f64807ec89e814c7dcc0970057`; sibling `odysee-on-arweave` HEAD `9c0465218d3d724bb56a50819d3d41fa72f03c81`. These are not the current application's authority.
- No native Google/OIDC implementation was found in the checked-out auth source searched. This is **not** a claim that Ayush has no unpublished work or that no other branch contains it.
- No restart/failover, live cookie-header capture, TEE attestation, synchronization, exploit, or browser authentication tests were run for this audit. Findings are source-level evidence and explicitly labelled risks, not a penetration-test sign-off.
- Applied the security-review skill to credential handling, session semantics, export surfaces, custody, and recovery; did not execute its illustrative mutation commands.

## What exists now

| Capability | Source evidence | Status / qualification |
| --- | --- | --- |
| Name-only native signup | [hyperbeamAccount.ts](../../odysee-frontend/ui/util/hyperbeamAccount.ts), lines 42–78 | Clears existing JS-visible native cookies, posts generic channel message, verifies profile against cookie owner. Not account linking. |
| Cookie auth provider | [hb_odysee_node.erl](../../src/hb_odysee_node.erl), lines 142–166; `config.json`, lines 166–169 | Active native provider is `cookie@1.0`, not the legacy compatibility auth provider. |
| Random browser secret | `_build/default/lib/hb/src/preloaded/auth/dev_cookie_auth.erl`, lines 14–29, 152–169 | Default secret generator uses 64 random bytes; later requests reuse cookie secret. |
| Hosted signing wallet | `_build/default/lib/hb/src/preloaded/auth/dev_secret.erl`, lines 177–182, 260–326 | Creates `ar_wallet:new()` when authenticated lookup finds no existing wallet. Wallet is random; cookie secret is a lookup/authentication credential, not a deterministic RSA wallet seed. |
| Private persistence | [cookie-identity-persistence decision](../../decisions/cookie-identity-persistence.md); dependency `dev_secret.erl`, lines 694–718 | Configured non-volatile private store plus in-memory warm cache. Same cookie + intact private store is intended to preserve committer after restart. No disaster recovery guarantee. |
| Profile hint recovery | [hyperbeamAccount.ts](../../odysee-frontend/ui/util/hyperbeamAccount.ts), lines 81–85; `hyperbeam.ts`, lines 747–786 | Restores UI for current cookie owner; localStorage grants no authority. Does not recover a lost cookie. |
| Sign out | [hyperbeamAccount.ts](../../odysee-frontend/ui/util/hyperbeamAccount.ts), lines 88–95; [app.ts](../../odysee-frontend/ui/redux/actions/app.ts), lines 536–541 | Deliberately retains credential and hides local account, then reloads. This is not credential revocation. |
| Import/export/sync | dependency `dev_secret.erl`, lines 199–217, 584–655 | Generic primitives exist. Not a finished authenticated account migration product. Security cautions below. |
| Controller access | dependency `dev_secret.erl`, lines 493–531, 669–677 | Wallet records can include controller addresses and required count. Default uses configured wallet admin/operator/node wallet. This is trusted-custodian authority, not threshold cryptographic key custody. |
| Private playlists | [private-playlists decision](../../decisions/private-playlists.md); `hyperbeam.ts`, lines 2652–2676 | Browser obtains the same owner's complete hosted keyfile in memory, with `accept-bundle: true`; RSA recipient identity tied to account wallet. |
| Private preferences | [dev_odysee_preference.erl](../../src/dev_odysee_preference.erl), lines 69–83, 134–138 | Node exports authenticated wallet internally; symmetric key is hash of domain, owner address and serialized wallet key. Restoring only a new account label is insufficient. |
| Legacy session adaptation | [dev_odysee_auth.erl](../../src/dev_odysee_auth.erl), lines 150–200 | Optional session-token→account resolution, then secret derivation; not current native signup. Not Google/OIDC validation. |

## Six distinct contracts that need decisions

1. **Authentication:** evidence that caller controls a Google identity, email, passkey or recovery credential.
2. **Account binding:** a private association from authenticated identity to the existing hosted wallet/account root. Linking requires proof of both current account authority and new provider; matching an email or handle is not proof.
3. **Session authority:** individual revocable browser/device grants, not a lifetime reusable root credential.
4. **Custody/portability:** which nodes may obtain/use the wallet and what happens when one disappears.
5. **Product ownership:** current projections accept exact same-committer revisions. Changing signer does not automatically preserve ownership.
6. **Decryption continuity:** historical preferences/playlists must remain decryptable. Session rotation and signing-key replacement are different operations.

## Source-level risks to prioritize

### A. Sign out currently does not revoke access

The current implementation explicitly retains the cookie. A copied credential remains usable; hiding UI is not a stolen-session defense. Neither the inspected `dev_secret` export list nor the account helper establishes a per-device expiry/revocation registry.

Proposed work: model server-side sessions separately from the stable wallet, with expiry, per-device revocation, global invalidation and reauthentication. This should live at the request-auth/secret boundary, not in product CRUD devices. Private revocation state must be checked before a new signature is made. Document propagation/outage behavior across nodes; immutable historical writes remain valid history.

### B. Cookie security attributes need an explicit production contract

`dev_cookie_auth:store_secret/3` lines 102–109 stores the secret as a scalar cookie value. `dev_cookie:normalize_cookie_value/1` lines 458–468 gives scalar values empty attributes and flags. At this source boundary there is no explicit `HttpOnly`, `Secure`, `SameSite`, or lifetime. A deployment layer may add them; no live capture was performed.

Frontend fresh signup clears cookies using `document.cookie` (lines 42–48), so making cookies HttpOnly requires replacing that mechanism with an authenticated server-side lifecycle operation. Do not merely add HttpOnly and leave account-switch/signup behavior silently broken. Explicitly test CSRF/origin checks and cookie path/domain scoping. Different localhost ports are not isolated cookie hosts; local tests should use genuinely separate hosts or isolated browser contexts.

### C. Wallet sync is a primitive, not a safe ready-made API

In inspected `dev_secret:sync/3`, lines 614–655:

- The destination constructs an export request signed with node credentials (or a selected `as` identity).
- The source authorizes wallet access through its auth/controller machinery.
- The destination persists records returned by export.
- The function ultimately returns `{ok, ExportedWallets}`, not just successful IDs.
- The constructed inner export request has no explicit `accept-bundle: true`.

The playlist decision documents that an unbundled nested-wallet reply can offload wallet material into the public message store; its frontend explicitly requests a bundle to prevent this. Therefore both inner export serialization and outer sync response are release-blocking review topics **before enabling sync**. The audit did not invoke either route, so this is an identified dangerous code path requiring controlled validation, not a claim of observed production leakage.

Also inspect: who may trigger destination sync, whether arbitrary target URLs permit SSRF, who may select `as`, signature verification before controller counting, source/destination peer pinning, partial import failures, idempotency, rollback/replay, and no-store/private transport. `verify_controllers` counts `hb_message:signers`; establish where those signatures are verified rather than assuming signer metadata is evidence. Do not assert an exploit until the complete request boundary is traced.

Controller allowlists are not TEE attestation or a quorum signing protocol. Current full-wallet replication exposes the signing key to each authorized recipient; revoking a node later cannot erase a copy it already obtained.

### D. Do not derive auth secrets from a public provider/account ID

Legacy compatibility `dev_odysee_auth:derive_key/4`, lines 250–262, uses domain-prefixed account ID (when account mapping is configured), default constant salt and PBKDF2. That does not make an account ID secret. The adapter is not the configured native provider, but it must **not** be copied as a Google `sub`→secret design. A publicly reproducible authentication secret is an unsafe foundation even if the legitimate token resolution step normally validates a session. A full exploit depends on the surrounding routes and was not attempted.

Google documents `sub` as stable/unique and email as unsuitable for the unique identifier; issuer/audience/expiry/signature and flow nonce checks remain essential. Use verified `(issuer, subject)` to look up a private binding to a randomly generated wallet, not as raw secret entropy. Token strings rotate and are also not durable account IDs. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)

OAuth integration should follow authorization-code/PKCE, redirect and replay defenses appropriate to its client type; do not assume a static manifest can safely contain a client secret. A narrow trusted authentication endpoint does not require restoring product SSR. [OAuth Security BCP, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)

### E. Same login at two nodes can still create two owners

Because new hosted wallets are random, two isolated nodes missing a wallet can independently create different signing addresses even if they derive the same lookup credential. Private persistence only resolves repeats on a node with that record. Existing generic sync can move an already-existing wallet but is not evidence of atomic first-enrollment coordination.

Required invariant: one canonical provider binding to one existing wallet, atomically established before product writes. During network partition, either a designated authority/quorum is reachable or enrollment fails/pends; independently minting wallets and merging later conflicts with same-committer product history.

### F. Recovery must preserve decryption and exact ownership

Private playlists wrap content keys to the existing RSA wallet. Preferences derive encryption from the serialized wallet JSON string. A recovered key with different serialization may have the same RSA address but a different preference-derived key. Test byte-preserving backup/restore and import normalization explicitly; do not claim this failure has been reproduced.

The frontend wallet-key cache is a process-memory map in `hyperbeam.ts`, lines 2657–2675. Existing signout reload discards page memory, but future SPA account switching must explicitly clear sensitive caches and cancel in-flight old-account requests. A stolen exported wallet survives cookie/session revocation; key compromise requires a separate rotation/delegation and encryption migration design. Historical ciphertext already decrypted by an attacker cannot be made secret again.

## TEE and sibling-repository findings

[Architecture](../architecture.md) describes TEE-terminated serving connections and trusted routing. The pinned dependency includes generated documentation for `dev_green_zone` and `dev_snp`; the green-zone documentation describes secure joining and **node identity** cloning. Matching source modules were not located in the searched dependency `src` tree. This documentation is not evidence that a current Odysee deployment attests nodes, synchronizes per-user wallet records, prevents rollback, or revokes expelled nodes.

Before using a TEE claim, require a concrete build/deployment reference, measured code/config allowlist, TLS-key-to-attestation binding, freshness verification, sealed storage behavior, backup procedure and trust-root rotation. Even an attested runtime needs account-enrollment and session consistency contracts.

Sibling legacy code contains useful concepts, not a transplantable native auth stack:

- `/Users/bhavya_gor/work/odysee-api/app/wallet/oauth.go`, lines 57–69 and 195–198: issuer discovery and an OIDC library verifier configured with client ID; lines 97 onward map provider subject into a database-backed SDK wallet account. This relies on a legacy API/database/SDK architecture and is not native wallet portability.
- `/Users/bhavya_gor/work/odysee/internal-apis/app/oauth/google.go`, lines 21–31: Google OAuth configuration is for YouTube read-only access; file name alone does not establish Google account login.
- Sibling HyperBEAM trees contain cookie/secret primitives but older product architectures. Do not replace the current generic write path with them.

## Custody alternatives worth comparing

| Alternative | Benefits | Main risks / unfinished contract |
| --- | --- | --- |
| Operated auth/custody nodes; community nodes read-only | Small trust boundary; practical near-term availability and session revocation | Operated service dependency, secure replicated private storage and atomic enrollment still required |
| Full-wallet replication to approved nodes | Same signer can be available on multiple nodes | Every approved node can obtain full authority; export/sync safety, stale session rejection and node compromise containment |
| Authenticated remote signing, no wallet replication to serving nodes | Keeps wallet at a smaller custody boundary | Availability/latency and explicit user-intent binding; avoid generic arbitrary-signing oracle |
| User-controlled wallet/recovery backup imported only into trusted node | Provider-independent recovery and same key possible | Backup loss/phishing, import exposure, serializer compatibility; needs supported recovery UX |
| New signer delegated by a stable account root | Potential clean key rotation and per-device signing | Current same-committer projections do not implement this; requires deliberate versioned authority migration across every product and encryption domain |
| Threshold custody / attested multi-party signing | Potentially avoids one custodian holding full authority | Major cryptographic/operational work, not equivalent to existing controller-count checks; explicit scope and independent review |

## Recommended isolated experiments, in order

1. **Boundary inventory:** get Ayush's exact auth branch/commit and provider contract. Identify canonical account ID, binding store, enrollment owner, key custody and session issuance. Do not infer completed Google work from meeting discussion.
2. **Session contract proof:** disposable account; record identity and a private snapshot; sign out/revoke; old cookie cannot sign/export/open; fresh authorized login returns the same owner and decrypts history. Current UI-only logout should fail the strong version, by design.
3. **Enrollment race:** same verified provider identity logs into two isolated nodes simultaneously. Assert exactly one wallet binding or explicit failure, never two independently valid account owners. Include partition and lost acknowledgement.
4. **Existing-account linking:** prove native wallet plus provider; bind without changing committer; replay/foreign-provider linking denied; unlink cannot remove the final recovery path without warning and reauthentication.
5. **Safe export/sync proof:** synthetic wallets only, disposable nodes/private stores; inspect bundled/unbundled responses and public-cache writes without retaining keys in artifacts; assert unauthorized caller/peer cannot access or cause import/export; return metadata-only acknowledgements. Do not run this against shared nodes.
6. **Cross-node failover:** replicate approved private custody plus required public state; make source unavailable; new login on destination preserves owner and decrypts old preferences/playlists. Separately test browser origin/session handoff and data-discovery availability.
7. **Recovery serialization:** export/import with equivalent keyfile field order/format variations; identify whether prefs need canonicalization or versioned migration before changing existing encryption.
8. **Security headers/CSRF:** production-like HTTPS cookie capture; verify intended flags/path/domain, origin checks, failed CSRF cannot sign, and signup/account switching still work with HttpOnly cookies.
9. **Compromise and revocation:** stolen session, revoked node, expired provider proof, replayed callback, stale replica and offline revocation propagation; define allowed stale window or fail-closed policy before testing.
10. **Restart/restore:** only disposable or operator-authorized nodes, preserve same private identity plus public history; verify append-only edits after restore. An upload cache backup alone is insufficient.

Every experiment should publish only fixture IDs, status codes, expected/actual assertions and source versions. Never put wallet keys, cookies, provider tokens, email challenges or raw private records in reports, manifests, public signed messages or committed harness fixtures.

## Decision questions for the team

- Is launch portability across operated nodes under one origin, or arbitrary unrelated domains?
- Who may host the full user signing key, and can community nodes be reads-only initially?
- Is Google a login credential, a recovery credential, or both? What if access to it is lost?
- Which authority atomically creates/links `(issuer, subject)` to the existing wallet?
- Can account A switch to account B without deleting the only credential for A?
- How is a stolen device revoked while other devices retain the same wallet and encrypted history?
- What recovery path survives loss of both cookie and one node's private store?
- Does the first release preserve the current signer forever, or explicitly implement delegation/rotation?

The first deliverable should be an agreed account/session/custody contract and failure matrix, not another login button.
