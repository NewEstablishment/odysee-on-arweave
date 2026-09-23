# Arweave-native wallets and embedded authentication

Research date: 2026-09-21. Documentation/source research, not an integration test, security audit, deployed-feature claim, or recommendation to require cryptocurrency ownership. Uses the security-review checklist for custody, origins, authorization and recovery. Read with [native audit](../native-auth-audit.md) and [recovery analysis](../recovery-key-management.md).

## Meeting takeaway

There are useful ecosystem options beyond Google or writing our own email login: Wander Connect for embedded onboarding, Wander extension/mobile for existing wallet users, and Arweave.app for installation-free user custody. None is a drop-in replacement for our hosted cookie wallet. The central decision is whether an external wallet merely authenticates to the **existing** hosted owner, becomes the actual content signer, or holds a recovery copy. Those are different projects.

For broad adoption, investigate embedded login and optional external-wallet linking, not mandatory wallet installation. For stronger independence, investigate user-held same-key recovery plus a proven direct-signing path. Do not choose a provider until its complete-key escape and historical-private-data restoration have been demonstrated.

## Hard compatibility requirements from this repository

- Product writes use generic committed messages, not ordinary Arweave transfers or an AO application process API. Exact message hydration derives authority from the selected verified committer. An address returned by a wallet UI is not authentication.
- Existing revisions, references, follows and controls require the authorized original owner. Generating a replacement wallet cannot preserve these contracts without an explicit versioned authority-transition design.
- [Preference crypto](../../../src/dev_odysee_preference.erl), line 134, hashes a domain, address and the serialized private wallet value. A signature-only external wallet cannot supply that material; even equivalent RSA keys with different serialization require compatibility testing.
- [WeaveMail](../../../odysee-frontend/ui/util/weavemail.ts), lines 11–91, wraps a random AES key using RSA-OAEP/SHA-256 and currently decrypts through an imported JWK. A permissioned wallet decrypt API could potentially unwrap the same content key without exporting the wallet, but requires an intentional adapter and exact algorithm/envelope tests. It does not solve the preference KDF.
- Current manifest delivery remains static and same-origin for cookie-authorized writes. An auth verifier or private binding service may be a narrow security boundary; no new product CRUD proxy or required SSR path follows from selecting a wallet.

These conclusions are our integration analysis, not claims made by the wallet vendors.

## Candidate inventory

| Candidate | What it actually provides | Best role here | Main unresolved condition |
| --- | --- | --- | --- |
| Wander Connect | Embedded wallet plus familiar authentication | Optional mainstream onboarding or wallet-based login | Existing-key import, full-key escape, independent recovery and exact native signing |
| Wander extension/mobile | User-controlled Arweave wallet, permissioned signing/decrypt APIs | Optional advanced-user auth/recovery | Same-owner linking and mobile/browser flow; avoid per-comment prompts |
| Arweave.app + Connector | Local-first web wallet and cross-window communication | No-install self-custody alternative | Key-backup burden, origin storage/popup behavior, compatible signer/decrypt |
| Arweave Wallet Kit | Wallet-selection/integration abstraction | UI adapter after choosing authority model | Does not provide account recovery or native authorization by itself |
| WAuth | Social-login SDK exposing Arweave-style wallet APIs | Comparative prototype/source reference | Custody/export/security/operations require deeper validation |
| Othent KMS | Historical Auth0/Google KMS-backed wallet | Migration lesson, not new adoption | Documented deprecation warning; old integration samples remain online |
| Arpass | Emerging password/passkey encrypted-vault design on Arweave | Research reference for recovery envelopes | Not a demonstrated native Odysee login integration or audited recommendation |
| AO web wallets / offline vaults | Wallet/account or transaction tools | Optional specialist routes | Tool existence is not a portable-auth contract |

## Wander Connect: strongest embedded-wallet candidate to investigate

The official introduction describes familiar login, an embedded interface and wallet API parity with the extension. Its custody scheme splits a key into device/server shares and reconstructs it on the user's device after authentication. This is secret sharing with reconstruction, **not threshold signing**. Vendor claims of component audits do not establish a full application audit. [Introduction](https://docs.wander.app/wander-connect/intro)

The documented Recovery File is a backup of the **device share**, not clearly a standalone complete RSA JWK. The described restore still needs the server share. Therefore downloading it alone does not prove survival of vendor shutdown, censorship, or loss of backend records. Ask for a supported complete-key export and test recovery while provider endpoints are blocked. [Recovery File specification](https://www.wander.app/help/what-is-a-wander-connect-recovery-file)

The SDK exposes iframe/popup customization and configurable frontend/backend URLs. Those configuration fields do not prove the full service is self-hostable with equivalent security. Pin a tested version: currently viewed examples mix package/class naming, making copy-paste integration unsafe. [SDK options](https://docs.wander.app/wander-connect/options)

Proposed integration paths:

1. **Login credential only:** enroll a verified wallet public key while the existing cookie owner is authenticated; future origin/session-bound signed challenges reopen that owner's hosted wallet. This preserves existing content and ciphertext but retains Odysee custody and a private binding/revocation service. A wallet's displayed address alone is never enough.
2. **External signer for new accounts:** new user's wallet signs the supported HyperBEAM commitment representation. This requires a compatibility spike, not a switch from `/id` to a bundler. Keep writes generic and prove reads select the intended committer.
3. **Existing-key migration:** user explicitly exports/imports the same native key through an audited flow. Availability of arbitrary JWK import into Connect was not established here. Do not expose a production key to discover whether it works. Merely linking two wallet addresses does not migrate authority.

Adoption benefits are plausible, not measured: fewer setup concepts, no mandatory extension, potentially familiar login. Costs include a second consent UI, backup education, login/provider outages and support for lost device shares. User research must count all steps through the first successful comment, not stop at an authentication callback. Introductory documentation's trial client ID is not a current pricing/SLA commitment; obtain actual commercial terms and quotas before planning scale.

The public [Wander repository](https://github.com/wanderwallet/Wander) identifies extension/mobile/embedded products and an MIT license. This is source availability, not proof that all hosted infrastructure, provider agreements or production service guarantees are covered. The published older extension audits cannot automatically certify today's embedded flow.

## Wander extension/mobile: optional self-custody, not default onboarding

The extension supports importing a keyfile; recovery documentation distinguishes seed/keyfile recovery from unrecoverable loss. That makes same-RSA-key custody technically plausible, subject to explicit user consent and a disposable test. An imported arbitrary keyfile need not have an original seed phrase. [Import documentation](https://www.wander.app/help/browser-extensions---settings-how-to-create-or-import-additional-wallets), [recovery limits](https://www.wander.app/help/how-do-i-access-my-wallet-if-i-forget-my-password)

Permissions include public-key/address access, transaction signing and decrypt. Request the minimum; listing all addresses is not needed for a single login. API-mediated decrypt is preferable to routinely exporting a user's complete key, but exact envelope interoperability remains untested. [Permission API](https://docs.wander.app/api/connect), [decrypt API](https://docs.wander.app/api/decrypt)

Critical signer distinction:

- `signDataItem()` produces ANS-104 data-item bytes, not proof that our current generic HTTP/message commitment format accepts them unchanged. [Data-item API](https://docs.wander.app/api/sign-dataitem)
- Raw `signature()` is deprecated; do not build around it just because old SDK examples expose it. [Deprecation](https://docs.wander.app/api/signature)
- `signMessage()` hashes input before signing and documents its own verification procedure. It can authenticate a carefully specified challenge, but is not interchangeable with arbitrary transaction/commitment signing. [Message-signing API](https://docs.wander.app/api/sign-message)

A wallet-authenticated hosted session avoids a popup per like/comment, but is still hosted signing authority. Delegating scoped session keys for genuinely client-side signing would require consistent changes to current same-committer projectors. Revoking app permissions or disconnecting the wallet does not necessarily revoke an already-issued Odysee session; both lifecycles need explicit handling.

## Arweave.app: genuinely useful no-install alternative

The project describes local-first self-custody, keyfile/passphrase import/export, and a cross-domain connector. Users authorize a wallet window to service application requests while private keys stay in the wallet origin. This offers portability across application origins without putting the root key in every app. It still depends on users preserving backups and authentic wallet frontend code. [Wallet source](https://github.com/jfbeats/ArweaveWebWallet), [Arweave setup guide](https://docs.arweave.org/developers/wallets/arweave-wallet)

The connector uses local browser communication and allows a custom wallet-provider URL. Its README documents popup fallback for constrained iframe storage, but old browser-specific statements are not a current compatibility matrix. Test current Safari/iOS, Firefox, Brave and Chrome with storage partitioning and popup blocking. Never instruct users to disable browser privacy protections as the only supported flow. [Connector protocol/source](https://github.com/jfbeats/ArweaveWalletConnector)

For Odysee, offer this under “Use an existing wallet,” with native login-challenge verification or a tested exact signing adapter. Keep explicit restore/export instructions. Self-hosting or immutable hosting can reduce one website dependency but does not make a malicious or stale wallet bundle safe. Verify licenses at the selected exact version before bundling/forking; no complete license/legal review was performed here.

## Wallet Kit, WAuth and Othent: avoid conflating integration with custody

Wallet Kit unifies wallet strategies and React components; it is not an identity database, proof verifier or recovery service. The inspected [repository](https://github.com/labscommunity/arweave-wallet-kit) labels its implementation beta and MIT-licensed. Its [current documentation](https://docs.arweavekit.com/) explicitly advises against adding Othent because deprecation was planned by the end of 2025. This establishes a warning against new use, **not independent verification of the actual service shutdown date**. Stale samples can still mention Othent.

[Othent's published SDK](https://www.npmjs.com/package/@othent/kms) describes Auth0 and Google KMS backing. It is a useful reminder that an Arweave address does not imply decentralized key availability. Moving tokens to a new address is also not migration of Odysee's old same-owner histories or encrypted data.

[WAuth's SDK](https://www.npmjs.com/package/@wauth/sdk) advertises social providers, connected-wallet management and AO signing. The linked [source repository](https://github.com/subspace-dev/wauth) includes a backend, with [Bun/PocketBase-related layout](https://github.com/subspace-dev/wauth/tree/main/backend). This is not enough evidence to call it decentralized custody or production-ready. The SDK package declares MIT, but no independent audit, SLA, safe full-key escape, or complete server custody trace was established. Inspect token validation, generation/storage/export and account-linking proofs before any real user pilot. Its historical raw-signature examples need reconciliation with modern wallet APIs.

## Other unusual ecosystem leads

- **Arpass:** its [security policy](https://github.com/technoblest/arpass-spec/blob/main/SECURITY.md) describes a password/passkey/recovery-factor encrypted vault on permanent storage and discloses metadata/privacy history. Useful questions: can a recovery envelope hold our exact wallet bytes, survive provider loss and avoid public identifiers? Treat as an emerging design to evaluate, not proof of independent audit or a supported Odysee authenticator. Permanent ciphertext has long-lived guessing and metadata risks.
- **Permafrost/offline wallet flow:** Arweave.app documents offline transaction handoff. Potential root-recovery or creator emergency-signing tool, but unsuitable for everyday likes/comments and not yet a demonstrated HyperBEAM commitment signer.
- **aoWebWallet:** [project source](https://github.com/michielpost/aoWebWallet) documents keyfile import and AO tooling, MIT license and hackathon origin. It is another signer UX reference, not evidence of multi-device recovery or a replacement auth protocol.
- **Passkeys inside an embedded wallet:** authenticate access to that wallet's service/origin; they do not magically turn a passkey into the existing RSA key or grant arbitrary node-origin portability. Require exact key-custody and recovery evidence from the chosen provider.

## Browser and operational acceptance

Keep a stable HTTPS app origin even if immutable manifest paths change. Verify callback allowlists, wallet-origin permission prompts, CSP `frame-src`/`connect-src`, postMessage source/origin checks, popup user activation, redirects, third-party storage blocking, private browsing, mobile app handoff, account changes and browser back behavior. Never use wildcard message origins for privileged responses. Wallet callbacks are not themselves native account authorization.

A pure signed login challenge need not submit an on-chain transaction or require a funded wallet. Native writes still consume operator storage/compute; permanent publication or bundled settlement has its own payment/sponsorship policy. Separate SDK/service pricing, auth-provider/SMS/email expense, node operations, storage and support rather than promising “free blockchain login.” No current quote or paid plan was verified.

User journeys to measure: guest-to-first-comment, returning user on new phone, lost all devices, provider outage, creator with valuable old channel, users refusing a Google account, shared computer logout, disabled third-party storage and screen-reader/mobile use. Record completion/time/drop-off, consent comprehension, recovery success and support interventions. No adoption percentages are inferred from vendor claims.

## Proposed disposable prototypes and rejection criteria

| Prototype | Success gate | Stop/reject if |
| --- | --- | --- |
| Wallet challenge → existing hosted owner | Enrollment proves both existing account and wallet; replay/wrong-origin rejected; same owner restored after new login | Address-only login, silent account merge, or new wallet minted for existing account |
| Wander/Arweave.app generic native write | Signed object accepted and exact verifier sees intended original owner; revisions work after reload | Requires deprecated arbitrary-sign API or bypassing signature checks |
| WeaveMail permissioned decrypt | Same existing RSA recipient decrypts historical envelope without app private-key export | Different key/algorithm or only newly created ciphertext works |
| Preferences continuity | Historical preferences restore using preserved exact KDF input or explicit tested migration | Address matches but old ciphertext cannot open |
| Vendor escape | With provider offline, independent tool restores same signing/decrypt capability | “Backup” is only a share requiring vanished provider |
| Existing key import | Disposable original hosted key imported, address retained, no logging/public persistence | Product requires silently changing owner or exposing real keys to diagnostic tooling |
| Mobile/privacy flow | First write completes with default privacy settings and no compulsory wallet funding | Popup/storage workarounds dominate or inaccessible wallet UI blocks core use |

No prototype above was run. Prioritize challenge-to-existing-owner and provider-escape demonstrations before a large SDK integration. Contact maintainers only after the team approves outreach; this research did not send messages or create accounts.

## Questions to take to the meeting

1. Is optional self-custody a launch requirement or a later escape hatch?
2. May a third-party wallet authenticate a hosted Odysee key, or must the wallet itself sign content?
3. Will a chosen provider import/export the complete existing RSA key, and can users recover when that provider disappears?
4. Can we retain the old preference decryption material without normalizing it into incompatible bytes?
5. Which origin/domain owns wallet permission, passkey and callback continuity when nodes change?
6. Who funds permanent storage and supports lost-key cases without imposing cryptocurrency onboarding?
7. Is it acceptable to launch with private operator binding and optional wallet login while a genuinely delegated portable identity remains a separate architecture project?
