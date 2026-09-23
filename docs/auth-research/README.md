# Authentication research and proposed work plan

Date: 2026-09-21. Research-only; no authentication implementation or deployment approved by this report.

Expanded after the initial review: [Beyond the meeting — decentralized auth landscape, legacy magic links and adoption](expanded/README.md). That report broadens the candidate set and keeps selection open; the recommendation below records the initial narrower pass, not a final team decision.

## Recommendation

Make **account continuity, recovery and real session revocation** our next auth workstream, coordinated with Ayush's Google work. Then investigate **passkeys linked to that same account** as the strongest complementary login candidate; compare **outbound email codes/links** as convenience options. Keep Michael's incoming-email/DKIM idea as a bounded experiment, not a production dependency.

The core question is not which login button to add. It is: **after a new browser, lost cookie, unavailable node or recovery, can the user control the same content and decrypt the same private data—and can a stolen session be stopped?**

## Research inventory

Three parallel subagents covered native auth, email, and passkeys/devices. The primary agent covered recovery/custody, reviewed their reports, and synthesized this plan. The security-review skill informed the threat analysis; its generic examples were not adopted as application architecture. Evidence includes the checked-out code, decision records, the September 17 meeting transcript, and linked primary standards/vendor sources.

- [Native implementation and security audit](native-auth-audit.md): source inventory, actual primitives, gaps and evidence locations.
- [Email alternatives](email-auth-options.md): outbound code/link, inbound DKIM, private attestations, ZK Email and provider operations.
- [Passkeys and devices](passkeys-device-options.md): WebAuthn/RP origins, synced/hardware/hybrid credentials, PRF, QR/TV, wallet login and DBSC.
- [Recovery and key management](recovery-key-management.md): hosted backup, recovery kits, passwords/OPAQUE, cloud backup, guardians, threshold custody and delegated-key architecture.

This covers the practical authentication families relevant to this product, not every possible cryptographic construction or vendor. No live auth experiment, browser interoperability sweep, penetration test or restore exercise was performed. Existing test code is evidence of intended behavior, not a new passing execution. Ayush's unpublished work is not visible here.

## Main findings

1. **Login, identity, custody and recovery are separate.** A Google/email/passkey proof must privately resolve to the existing wallet, not generate a fresh owner each time.
2. **Current ownership is committer-bound.** Replacing a wallet cannot be papered over by changing a profile field; references and revisions reject foreign writers.
3. **Private data raises the recovery bar.** Preferences derive encryption material from the wallet's serialized bytes and address; playlists need the original RSA recipient key. Same display name or even same address is not sufficient proof of recovery compatibility.
4. **Existing primitives are not a complete auth product.** Private persistence and secret import/export/sync helpers exist, but session revocation, account binding, concurrency and recovery need explicit contracts. Review the native audit before reuse.
5. **Public provider identifiers are not wallet secrets.** OIDC uses stable issuer/subject identity plus verified tokens; never derive a private wallet from a public subject, email or callback. Google's email claim is not the stable account key. [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)
6. **Arbitrary-node portability changes the trust model.** Reading verified public content from a community node is different from trusting it with wallet custody, authentication or wallet-unlocking JavaScript. TEE claims require demonstrated attestation and key-release policy, not merely an architecture diagram.
7. **Recovery is part of security.** A weak fallback that can replace all strong factors determines practical takeover resistance. Recovery must be designed before claiming strong account protection.

## Alternatives at a glance

These are recommendations for investigation, not claims of implemented support. Detailed sources and failure cases are in the linked reports.

| Alternative | Good for | Principal limitation | Priority |
| --- | --- | --- | --- |
| Google/OIDC and other OIDC providers | Familiar federated login | Provider proof does not replicate/recover native wallet; provider dependency | Coordinate with Ayush |
| Passkeys linked to hosted account | Phishing-resistant login/step-up | RP/origin scope, enrollment and independent recovery required | First complementary method |
| Outbound email code or magic link | Accessible convenience/recovery UX | Mailbox compromise, phishing, delivery/abuse; lower assurance | Compare after binding design |
| Incoming DKIM challenge email | Meeting's mail-client-based alternative | Domain signature is not user consent; parsing/replay/provider-policy burden | Bounded research spike |
| ZK Email / private email attestation | Selective disclosure or uniform verifier assertion | Circuit/issuer/key-registry/prover trust, not wallet recovery | Requirement-driven later |
| FIDO hybrid / approved-device access | Another browser or TV | Approval is not lost-all-devices recovery; QR relay threat | Following passkey design |
| External-wallet login | Optional advanced-user access | Must link to native owner; signatures/keys not interchangeable | Optional |
| Encrypted recovery kit | Restore existing wallet independently | Loss/theft, exact serialization, secure import/export | Core investigation |
| Password / OPAQUE | Password option if product demands it | Guessing and recovery burden; no deterministic weak-password wallet | Conditional |
| Cloud encrypted backup | Convenient backup storage | Provider loss; decryption key must have independent protection | Optional complement |
| TOTP/SMS/additional hardware factors | Step-up or alternative factors | Not wallet backup; SMS has telecom risks | Factor-policy decision |
| Guardians / threshold custody | Distributed recovery/custody | Collusion, availability, audits; not drop-in RSA replacement | Larger later work |
| Delegated device keys / stable account root | Portable scoped authority and rotation | Changes every relevant native authority verifier | Separate architecture proposal |
| DBSC | Reduce stolen-cookie usefulness | Platform-specific session hardening, not identity/recovery | Later defense-in-depth |

Enterprise SAML/managed identity can be treated as another explicitly trusted authentication issuer if a business requirement appears; no SAML implementation/provider evaluation was performed. S/MIME/OpenPGP login is a niche enrolled-key variant covered in the email report. Biometrics are normally local authenticator activation, not a new server-side account identity to collect.

## Deployment alternatives to decide first

- **A — Operated origin and trusted custody cluster:** stable auth origin, privately consistent account/session mapping, backed-up wallet custody, generic signed product writes. Closest to current architecture; recommended initial proposal, with explicit operator trust.
- **B — Multiple approved node origins with private trusted/attested custody:** adds identity consistency, attestation admission, secure wallet distribution, revocation propagation and origin compatibility. More decentralized serving does not eliminate these requirements.
- **C — User-held root/delegated signers:** less reliance on hosted custody, but significant signature/encryption/authority-contract and recovery UX work. Do not quietly introduce it as a frontend auth toggle.

All preserve exact historical immutable content. None makes arbitrary third-party node code safe to receive a usable private wallet. Choose the node trust class before selecting passkey RP layout or email/OIDC callback routing.

## What we should pick up next

| Work package | Concrete deliverable | Acceptance gate / dependency |
| --- | --- | --- |
| 1. Account/session contract | Document stable account binding, custody, per-device sessions, link/unlink, logout/revocation and failure semantics | Agree with Ayush; distinguish identity/session/root-key identifiers |
| 2. Existing-boundary security review | Review cookie attributes, CSRF/origins, export/import/sync, credential leakage and compatibility adapter | Source findings reproduced safely on disposable HTTPS environment before patch plan |
| 3. Same-wallet restore experiment | Disposable account with public revisions, private playlist and encrypted preferences, restored on another approved node | Original node absent; same committer, editable history and old ciphertext readable; wrong owner rejected |
| 4. Enrollment/race/revocation experiment | Concurrent provider login and device revocation across two disposable nodes | No duplicate wallet; replay rejected; partition/rollback behavior documented |
| 5. Passkey experiment | Register/remove multiple credentials for the existing account; hybrid and recovery walkthrough | No replacement wallet; origin/replay/linking failures rejected; real browser/provider matrix |
| 6. Email experiments | Outbound code vs link comparison; separate hostile inbound-DKIM fixtures with Michael | Bound, expiring, single-use challenges; no mailbox-string merges; abuse/privacy policy |
| 7. Decision and implementation tickets | Choose deployment model and primary/recovery factors; size and assign changes | Team agrees scope; no unsupported security or portability claims |

Do packages 1–2 first; do not start by implementing every method. Package 3 is the most useful subsequent proof/demo. Ayush retains Google ownership; proposed coordination with Michael/Sam follows the meeting discussion, not a new assignment made on their behalf.

## Shared acceptance checklist

- Existing anonymous/cookie account can enroll a method without changing wallet, references, private data or authorship.
- Fresh browser, second device, unavailable original node and lost-all-devices cases have explicit outcomes.
- Same provider login at two nodes cannot silently create two accounts; matching email strings cannot merge accounts.
- Logout, device revocation, factor removal and wallet compromise are separate tested events.
- Challenges are purpose/audience/origin/session bound, short-lived and atomically single-use; recovery does not bypass those checks.
- Stolen cookie replay, malicious node, hostile QR, account switching, stale revocation and cross-account import are rejected or have documented bounded residual risk.
- No credentials, raw emails, provider-account mapping or wallet material appear in public immutable messages, caches, analytics, screenshots or harness artifacts.
- Recovery reads old real private fixtures; new empty data or a same-name profile is not a pass.
- Legacy channel ownership requires its own proof/migration contract; Google/mailbox login alone is insufficient.

## Slack-ready update

> Finished a parallel auth exploration covering the current HyperBEAM flow, email, passkeys, device pairing and recovery. The main gap is keeping the same account/wallet across new devices and nodes—not just adding login buttons. Google stays with Ayush. Our next pick should be the account/session contract, real logout/revocation and a same-wallet recovery test that also restores private playlists/settings. Passkeys look like the best complementary login option; email codes are a convenience option, while incoming DKIM/ZK email need more validation. Findings and acceptance plans are documented; no auth code or shared services changed.
