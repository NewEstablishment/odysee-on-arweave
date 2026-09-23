# Distributed custody, embedded wallets, MPC and TEE options

Research date: 2026-09-21. Primary-source web research plus the [native source audit](../native-auth-audit.md). Research only: no accounts purchased, credentials exported, services started, production requests made, or application code changed. The security-review skill informed the threat and acceptance questions. Vendor statements below are documented capabilities, **not independently audited deployment guarantees**.

## Meeting takeaway

There are credible alternatives beyond another centralized login endpoint. The most relevant experiment is **protecting our existing RSA wallet with distributed recovery or a programmable encrypted vault**, not automatically replacing it with an embedded Ethereum wallet.

Our product already binds edits, follows, profiles and private history to the exact existing owner. An attractive vendor login screen can otherwise produce a new, incompatible identity. The practical question is: can the user log in naturally, recover the same signing/decryption authority, and leave the vendor without losing it?

## Terminology that changes the decision

- **Secret sharing:** enough shares reconstruct a secret somewhere. That endpoint can then use or steal the complete secret.
- **Threshold signing:** participants produce a signature without reconstructing the signing key during normal operation. Supported algorithms matter.
- **Threshold decryption/key release:** participants authorize decrypting a stored envelope; the enclosed RSA wallet can still become complete at the recipient. This is not threshold RSA signing.
- **TEE custody:** hardware isolation protects a complete key during use. Authentication, upgrades, attestation, cloud dependencies and rollback remain trust boundaries.
- **Distributed deployment:** multiple replicas under one company are availability redundancy, not necessarily independent control.
- **Non-custodial:** an overloaded product label. Ask exactly who can change the authorization policy, recover a factor, replace the served client, approve enclave upgrades, or assemble sufficient shares.

## Existing-infrastructure constraints

The [native audit](../native-auth-audit.md) establishes the following source-level constraints:

1. HyperBEAM's cookie authenticates access to a node-hosted random RSA wallet. Product writes stay generic committed messages, not vendor-specific comment/upload APIs.
2. Current projections demand the same verified committer. An ECDSA/Ed25519 account is not the same owner as the existing RSA account.
3. Private playlists wrap content keys to the existing RSA wallet; preference encryption depends on serialized wallet material. Preserve the key **and the serialization needed for historical decryption**.
4. Session revocation cannot revoke a private key already exported to a browser or node.
5. Browser-side generic signing would require deliberate integration/policy work. Existing support for temporary private-playlist key export does not authorize silently replacing the hosted signing model.
6. Wallet import/export/sync boundaries require review before use. No report here assumes existing sync is production safe.

### Three integration shapes

| Shape | What changes | Existing ownership | Main new obligation |
| --- | --- | --- | --- |
| Vendor proves login; our private account binding selects the original wallet | Request-auth boundary and private binding/session store | Preserved | Vendor remains authentication dependency; our nodes still hold complete wallet |
| Vendor/network protects an encrypted copy or wrapping key for the original wallet | Recovery/enrollment boundary; wallet restoration or remote signing adapter | Can be preserved, subject to exact restoration | Prove arbitrary-secret/envelope support, endpoint secrecy, recovery and independent escape |
| Vendor wallet becomes the product signer | Signer/verifier adapter plus versioned account delegation and private-data migration | **Not preserved automatically** | Cross-product authority migration, rotation rules and encryption redesign |

These are proposed designs, not features currently implemented. No credential, email, provider token, wallet or recovery share belongs in a public generic message. Even encrypted key backups should remain in a deliberately reviewed private backup store rather than being casually published forever.

## Candidate 1: MetaMask Embedded Wallets / Web3Auth / tKey

**What the primary docs establish:** familiar social/email/custom authentication; SDK obtains an authentication share from the network. The architecture page describes tKey reconstructing the signing key. The MPC page distinguishes SSS reconstruction from TSS partial signing and describes device/authentication/backup factors. Do not conflate these variants or import a blanket “key never reconstructed” claim. The tKey repository is available for self-host-oriented integration. [Architecture](https://docs.metamask.io/embedded-wallets/architecture/), [MPC variants](https://docs.metamask.io/embedded-wallets/features/mpc/), [tKey source](https://github.com/MetaMask/tkey), [product authentication overview](https://docs.metamask.io/embedded-wallets/).

**Proposed Odysee flow:** user signs in using email/Google → obtains required factors → unlocks a high-entropy wrapping secret → decrypts the original RSA wallet envelope → authenticated trusted-node import/session creation, or an explicitly approved client signing boundary → normal generic writes. Using tKey's recovered secret as a domain-separated wrapping-key input is a **design hypothesis**, not a verified built-in RSA backup API. Do not derive encryption from a publicly observable signature or public provider identifier.

**Fit:** interesting for distributed recovery without forcing wallet literacy. Direct embedded EVM-wallet substitution is not an existing-owner solution; no compatible hosted-RSA import/signing contract was established in reviewed docs.

**Trust/failures:** OAuth account takeover, device-share loss, quorum availability, authentication-connection configuration, malicious served JavaScript and enough-party collusion. A 2-of-3 story is only independent if the actual share custodians and recovery paths are independent. A second factor recoverable through the same compromised email is not equivalent to independent possession.

**User adoption:** seed phrase can be absent from signup; explain “save recovery method” progressively. A new-device login may need a second factor, which should be tested honestly rather than promised as one-click. TV/private-mode/share-clearing flows need explicit recovery UX.

**Exit:** require actual export/restore of the key corresponding to the displayed account, not merely an SDK export method existing. Prove app/auth-provider shutdown recovery before removal. Keep exact SDK/network/mode documented; SDK branding retains Web3Auth identifiers despite MetaMask branding.

**Prototype gate:** recover one synthetic existing RSA wallet on a fresh device using factors; lose the app's original domain and original node; verify same owner, old playlist decrypt, old preferences decrypt, and ordinary edit. Separately demonstrate the documented factor threshold, not a developer admin reset.

## Candidate 2: Lit — distinguish current Chipotle from older Datil

**Current documentation changed the analysis.** The live entry point describes Chipotle as a chain-secured TEE runtime with on-chain permissions and immutable actions. It is not safe to describe all current Lit operation using an older threshold-network explainer. Current secret primitives include PKP-backed encryption and code-bound derived-action encryption; permitted code can expose secrets if authorized incorrectly. [Current architecture entry point](https://developer.litprotocol.com/), [secret lifecycle](https://developer.litprotocol.com/lit-actions/secrets).

Older **Datil** docs describe custom Wrapped Keys: encrypt a key, use access-control conditions, decrypt to a single node, then operate on its plaintext inside an action. Default wrapped-key helpers cover K256 and Ed25519; arbitrary custom action code is described. The documentation also notes a private DynamoDB metadata store. That dependency should not disappear behind a “decentralized” label. [Datil custom Wrapped Keys](https://datil.developer.litprotocol.com/user-wallets/wrapped-keys/custom-wrapped-keys).

**Two experiments worth keeping:**

1. **Private RSA recovery vault:** encrypt the exact serialized wallet under a fresh data key; protect that key through a code-bound vault; authorize release only to an authenticated, attested recipient and fresh session. Restore original owner at the narrow auth boundary. This preserves current generic product architecture but exposes the full key at the recipient.
2. **Remote RSA signing/decryption action:** keep the wallet enclosed in an audited action, verify a user-intent-bound request, return only the exact signature or authorized cryptographic result. RSA library/runtime limits, message canonicalization, RSA-PSS parameters, OAEP compatibility and preference derivation need testing. This is **not demonstrated native Lit RSA support**, and private-playlist browser key-export assumptions would need redesign.

**Self-host possibility:** Chipotle publishes source and local/production deployment guidance. Operating it means owning TEE configuration, chain/RPC dependencies, release governance, monitoring and attestation evidence. Self-hosting is not automatically compatibility with the hosted service's existing keys. The docs describe hosted upgrade governance and customizable self-host governance; review who can approve code that receives root keys. [Self-hosting](https://developer.litprotocol.com/architecture/self-hosting), [upgrade governance](https://developer.litprotocol.com/architecture/verification/upgrade-governance).

**Trust/failures:** hardware vulnerabilities, stale chain reads, upgrade authorities, action authorization mistakes, RPC outage, billing expiry and key-service unavailability. A valid enclave quote alone does not prove correct user policy or rollback resistance. Public permission metadata may correlate identities even when ciphertext is private.

**Adoption:** user need not see a token, chain or PKP if Odysee sponsors usage, but someone must fund/operate it. Avoid forcing gas acquisition simply to comment. Browser static assets can request a scoped operation; never embed an account-wide management key in the manifest.

**Escape:** independent encrypted backup of the original RSA wallet, key recovery procedure, action/version records and ciphertext copies. Prove recovery with the hosted gateway disabled; open source alone does not recover hosted root keys.

**Prototype gate:** one existing RSA account, no plaintext in response/log/public store; exact signature verifies; other account/replayed request/modified content denied; authenticated destination receives only intended authority; old ciphertext decrypts; hosted endpoint outage and action upgrade scenarios exercised.

## Candidate 3: Privy

Privy's described security architecture uses two encrypted shares, combined temporarily in AWS Nitro Enclaves. Its policy documentation separates authorization keys/quorums from the wallet key and notes some policy checks occur outside the enclave. This is **TEE plus secret sharing**, not automatically independently operated threshold signing. [Security architecture](https://docs.privy.io/guide/security/architecture/), [authorization and policy controls](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls).

**Proposed fit:** polished authentication/account linking can be used as evidence at our own private binding boundary while preserving the hosted RSA wallet. Do not create a new Privy wallet just to obtain a login unless we actually need that wallet. Alternatively a supported external-key wrapping mechanism could protect our original RSA envelope, but arbitrary RSA custody was **not established** in reviewed docs.

**User flow:** email/social/passkey login → verify provider proof server-side → resolve existing private binding → issue revocable same-origin session → native generic writes. Linking requires current owner plus the new credential, not email-string equality. This is an integration proposal, not an existing native adapter.

**Trust/adoption:** good potential for familiar onboarding; central service, authentication methods and upgrade infrastructure remain dependencies. Product-specific policies need exact binding to HyperBEAM message bytes; a crypto transfer limit is not authorization to edit an Odysee channel.

**Escape/blockers:** user export applies to supported wallets, not proof that our RSA key is supported. Get key formats, owner/control modes, recovery semantics, account-export schema and outage recovery in writing. Separate service-authorized wallets from end-user-controlled wallets; “embedded” does not choose custody for us.

**Prototype gate:** use provider authentication without changing owner, link/unlink safely, revoke one device, block replay, survive loss of the provider through a previously enrolled independent recovery method. Confirm no new hidden signer is introduced.

## Candidate 4: Turnkey

Turnkey publishes enclave-oriented infrastructure and QuorumOS description. Its wallet docs list secp256k1/Ed25519 account curves, raw-payload signing, and import/export. The inspected table does not establish existing RSA-wallet custody; “network agnostic” raw signing still depends on supported algorithms. [Wallets and curves](https://docs.turnkey.com/features/wallets), [QuorumOS](https://docs.turnkey.com/products/transaction-automation/features/security/quorum-os).

**Fit:** a useful benchmark for passkey-authenticated remote custody, granular policies and user authorization. For today's Odysee, prefer proving an authentication binding or supported envelope service rather than swapping the RSA owner. A custom signing service using similar attestation ideas is a separate build, not “integrating Turnkey.”

**Flow:** user approves a request through configured authenticator → service verifies policy → enclave signs supported payload → application verifies and submits. To fit our current writer, either that signature proves login to a private existing-wallet binding, or a new native commitment implementation and ownership migration are necessary.

**Trust/origins:** cloud/TEE and upgrade governance, correct policy and authenticator enrollment, recovery administrators and hosted availability. Passkeys still have relying-party scope; a domain-independent wallet identifier does not make WebAuthn work automatically at arbitrary community nodes.

**Escape:** import/export gives a planned exit for supported keys while access works. Obtain and test an independent backup before service failure. SDK source or attestation is not an assurance that an offline user can recover a key after all vendor services disappear.

**Prototype gate:** demand a concrete supported existing-RSA story first. If absent, evaluate only as auth provider or future delegated signer. Do not spend a week integrating an EVM signer then discover historical private playlists cannot open.

## Candidate 5: Dynamic — compare TEE and MPC offerings separately

Dynamic has documentation for enclave-based wallets and separate TSS-MPC pages marked **beta**. Those MPC pages describe user/server shares, optional backup, ECDSA/EdDSA/BIP-340 signing and key export. Import/export docs describe reconstructing the full key for export. The old architecture page contains future-tense recovery claims: these cannot be treated as completed current guarantees. [TEE architecture](https://docs.dynamic.xyz/wallets/embedded-wallets/architecture-security), [MPC overview](https://docs.dynamic.xyz/wallets/mpc/overview), [MPC import/export](https://docs.dynamic.xyz/wallets/mpc/import-export).

**Fit/flow:** use familiar auth and verified private binding to our existing wallet, or investigate share-based envelope protection. Direct threshold RSA support is not established. Pin the chosen product generation and SDK; do not mix promises from both architectures.

**Adoption:** configurable login and embedded account UI may reduce engineering work; recovery/configuration complexity remains. Iframe export and CSP/allowed-origin requirements must work on the actual node-served static manifest, mobile browsers and any supported custom domains. [Frontend/iframe requirements](https://docs.dynamic.xyz/wallets/embedded-wallets/create-embedded-wallets).

**Trust/exit:** distinguish user-held independent backup from provider-mediated export. If a logout, storage clear or new device removes the user share, recovery must not quietly collapse to the same compromised email. Vendor availability and relay availability remain relevant even with MPC.

**Prototype gate:** select a stable supported offering or explicitly accept beta risk; prove exact export identity, device-loss recovery and provider-disabled restore; then test our RSA wrapping hypothesis separately. A future-tense doc is a question for the vendor, not a pass.

## Candidate 6: Dfns

Dfns' inspected wallet-key schema lists ECDSA, EdDSA and Schnorr with elliptic-curve choices. A separate credentials guide supports RSA for **API authentication credentials**. These are different roles: RSA credential support does not establish threshold RSA wallet signing. [Wallet key schema](https://docs.dfns.co/api-reference/keys/get-key), [credential algorithms](https://docs.dfns.co/guides/developers/generate-a-key-pair), [signing API](https://docs.dfns.co/api-reference/sign).

**Fit:** a candidate for managed policy-controlled signing or future custody work, not a demonstrated plug-in for our existing RSA owner. Ask about actual deployment topology, independently held shares, supported import formats, end-user policy ownership and offline disaster recovery. No self-host/offline-recovery guarantee is asserted here without a verified product-specific contract.

**Flow:** user authentication plus action approval → custody signing request → signature returned → native verified write only if compatible codec/account authority exists. For current RSA state, an authentication-only binding is less invasive; encrypted-envelope custody would need a separately documented facility.

**Adoption:** passkey/action approvals may suit high-value creators, but repeated approvals for every like/comment would harm ordinary use. Scoped, expiring sessions can improve UX only if server enforcement genuinely bounds authority.

**Prototype gate:** exact existing-wallet import/sign/decrypt proof or classify as future migration-only. Measure approval friction, signing latency and operational quotas under realistic social-write load; do not equate transaction-throughput marketing with our workload.

## Candidate 7: Openfort / OpenSigner / Shield

OpenSigner is an unusually relevant self-hostable reference: source, MIT license, 2-of-3 Shamir design, browser iframe reconstruction and recovery methods are described by its own docs. Ethereum/Solana support is advertised, not existing RSA-wallet support. Shield is the key-management/recovery component; do not treat a self-hosted Shield server as automatically the entire wallet stack. [OpenSigner](https://www.opensigner.dev/), [source](https://github.com/openfort-xyz/opensigner), [Openfort changelog](https://www.openfort.io/changelog).

**Proposed adaptation:** independently operate the recovery/share components; protect a random key wrapping the exact RSA wallet rather than reinterpret RSA as a 32-byte EC scalar. Keep original wallet in memory only at an approved boundary after a valid quorum. This needs dedicated envelope integration/security review, not a drop-in supported feature claim.

**Why explore:** it can inform a self-hosted, familiar email/passkey recovery experience without permanently depending on a commercial wallet API. It is more concrete than inventing a new sharing scheme from scratch.

**Trust:** if Odysee hosts all shares, serves the iframe, controls identity recovery and can replace client code, “two shares” does not by itself remove Odysee's effective control. Separate operators, user-held entropy, reproducible pinned code and an independently verifiable recovery client are meaningful improvements. Endpoint reconstruction still exposes the complete wallet.

**Maintenance:** published source/changelog is evidence of an available project, not a completed audit of our adaptation. The repository's audit wording and later product audit statements are not automatically the same audited version. Pin a commit, obtain report/scope and test dependency/security updates before adoption.

**Adoption:** “continue with email” can remain familiar. Optional password/passkey recovery upgrades should explain consequences without exposing secret-share jargon. If automatic email recovery alone unlocks every factor, it inherits mailbox-takeover risk.

**Prototype gate:** operate components locally with synthetic identities, wrap and restore one original RSA wallet; take each component offline in turn; clear device storage; prove intended threshold and independent escape. No product-page claim substitutes for these tests.

## Odd but useful combination: threshold-wrapped RSA, not threshold RSA

This deserves its own experiment across candidates because it avoids a common false choice between centralized custody and replacing every product owner:

1. Preserve the existing serialized wallet and associated encryption-version metadata.
2. Generate a random envelope key and encrypt that payload using an authenticated, versioned envelope.
3. Split/protect **the envelope key**, not an ad hoc RSA integer, using a reviewed scheme or programmable vault.
4. Independently authenticate recovery participants and bind release to an explicit account, destination, nonce, purpose and expiry.
5. Restore only into an approved endpoint; verify address and existing ciphertext before claiming success.
6. Keep ordinary signed product writes and exact historical reads unchanged.

This is an architectural proposal, not permission to invent cryptography. It reduces dependence on one backup custodian but does not solve full-key compromise after reconstruction, browser XSS, malicious approved endpoints or old leaked backups. Re-sharing a wrapping key does not erase a full RSA wallet someone already recovered.

## Practical decision matrix

| Candidate | Distinctive value | Current-RSA direct support established? | Most plausible first fit |
| --- | --- | --- | --- |
| MetaMask Embedded / tKey | Auth/device/backup sharing ecosystem | No | Envelope/recovery experiment; auth binding |
| Lit Chipotle | Programmable encrypted secrets, attested execution, self-host option | No built-in RSA proof | Custom RSA vault or constrained remote-signing research |
| Lit Datil Wrapped Keys | Explicit custom-key wrapping precedent | Custom code only; not verified RSA | Reference/prototype with version-specific support confirmation |
| Privy | Familiar auth plus enclave policy/custody | No | Auth evidence mapped to existing wallet |
| Turnkey | Enclave remote signing/policies | No in inspected curve table | Auth/controller proof; future delegated signer |
| Dynamic | Embedded UX, distinct MPC option | No; reviewed MPC docs beta | Auth binding or envelope feasibility |
| Dfns | Policy-controlled managed signing | RSA credentials ≠ RSA custody | Auth/enterprise comparison; migration-only until proven |
| OpenSigner | Self-hostable share/recovery reference | No | Independently operated wrapper prototype |

“No established support” means reviewed evidence does not demonstrate it, not a claim that a vendor can never implement it. None was purchased or contacted.

## User acceptance and cost questions

For **all** candidates, measure rather than assume:

- Signup completion and time to first comment on mobile/desktop; no forced wallet extension, token purchase or seed ceremony for ordinary viewers.
- Return on a new device, lost browser storage, email changed/lost, passkey sync unavailable and original node unavailable.
- Creator safety: adding/removing login methods requires reauthentication; recovery triggers clear notifications and optional delay for high-value accounts.
- Account linking preserves owner, channel, follow graph and private history; duplicate users are not silently merged using email display strings.
- Manifest CSP/iframe/redirect restrictions, custom-domain registration and WebAuthn RP limits; private browsing and tracking protection.
- Provider can observe login identities/timing; public chains or permission records can introduce correlation. Minimize exposed identifiers.
- Cost categories: monthly active authenticated users, wallet/key count, recovery traffic, signature/decryption calls, email/SMS delivery, network/chain funding, premium MFA, export/support tiers, TEE hardware, monitoring and independent audits. **No unverified dollar estimates are quoted.** Ask for pricing against expected reads/writes/recovery volume and outage SLAs.

## Recommended exploration order — not a selection yet

1. **OpenSigner-style independently hosted wrapper** and **Lit code-bound RSA vault**: highest learning value for existing ownership/decryption continuity.
2. **MetaMask/tKey envelope recovery**: evaluate concrete factor independence and provider-loss escape.
3. **Privy/Turnkey/Dynamic/Dfns auth-only comparison**: determine whether buying familiar onboarding is worthwhile without changing product custody.
4. Only after those results, consider **direct non-RSA signer/delegation migration**. That is a cross-product account model project, not a login patch.

Common pass gate: source node and one chosen vendor endpoint unavailable; a previously enrolled independent recovery path restores the same owner; old private playlists/settings open; new generic edits verify; stolen/revoked session cannot sign or export; replay/foreign-link attempts fail; no secret appears in public storage or artifacts. Record exact implementation versions, measured latency and which trust parties were required.

## Limits and follow-ups

This report covers concrete representative systems and combinations, not every possible vendor or cryptographic construction. No vendor claims were penetration-tested; no latency, uptime, pricing or independent recovery was benchmarked. Several documentation generations coexist, especially Lit and Dynamic. Vendor selection needs exact versions, supported algorithms, audit scope, export/recovery contract and a disposable proof. Root synthesis should preserve the distinction between live current documentation, legacy documentation and proposed Odysee integrations.
