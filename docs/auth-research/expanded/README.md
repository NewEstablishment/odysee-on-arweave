# Beyond the meeting: authentication landscape and meeting brief

Research date: 2026-09-21. Expanded web/source research, not implementation or vendor selection. This deliberately goes beyond the initial [auth plan](../README.md).

**Present the flows:** Open [the offline HTML flow atlas](../auth-flows.html) in Chrome. Its 32 diagrams cover existing behavior and proposed alternatives, with user experience, integration changes, trust questions and source notes. Use arrow keys to navigate, **P** for presentation mode, **Esc** to exit, and **Print / PDF** to export all flows. The HTML works alone; linked detailed Markdown reports require the repository files.

## Main conclusion

**We can preserve legacy-style magic links, adopt decentralized login, and improve custody/recovery independently.** They are different choices, not mutually exclusive buttons. The meeting should choose which guarantees we want before picking a vendor or protocol.

The survey spans email, self-hosted identity services, Arweave-native wallets, distributed custody, federated/pseudonymous identities, capability delegation, chain/ZK identity, secret recovery and less conventional alternatives. Specialist reports include the user lifecycle, proposed Odysee integration, trust dependencies, adoption implications and validation/rejection tests. Proposed integrations are not established product support.

## Reading map

| Topic | Report | Main question |
| --- | --- | --- |
| Actual legacy flow and migration | [Legacy magic links](legacy-magic-links.md) | Which familiar behavior and account evidence can we preserve? |
| Arweave-native ecosystem | [Arweave-native options](arweave-native-options.md) | Can wallet/sign/decrypt tools fit our exact contracts? |
| MPC, sharing and enclaves | [Distributed custody](distributed-custody.md) | Who can use the key, and what survives provider shutdown? |
| Federation, DIDs and capabilities | [Decentralized protocols](decentralized-protocols.md) | What provides portable identity or limited authority? |
| Chain/ZK identity and legacy proofs | [ZK and chain identity](zk-chain-identity.md) | Can external proofs authorize the existing account? |
| Unusual recovery and long tail | [Recovery alternatives](unusual-recovery-and-long-tail.md) | Can independent parties help recover the same wallet? |
| Concrete integration contracts | [Infrastructure models](infrastructure-integration-models.md) | Exactly which boundary changes for each family? |
| Adoption and rollout | [User journeys](adoption-and-user-journeys.md), [independent evidence review](adoption-evidence-review.md) | Can people join, return, migrate and recover successfully? |

The earlier [native audit](../native-auth-audit.md), [email review](../email-auth-options.md), [passkeys/device report](../passkeys-device-options.md) and [key-management report](../recovery-key-management.md) remain supporting evidence.

## What legacy actually did

The inspected legacy code supports magic links **and** optional passwords. Its no-password path starts an email-verification transaction; the email approves the initiating installation/session and the original tab polls every five seconds. It is not simply a cookie carried to whichever browser clicks the link. The challenge has a 30-minute expiry and a separately scoped confirmation credential. Legacy server logout invalidates tokens. These are local-source findings; the detailed report pins commits, not the production deployment.

Three designs to discuss:

1. **Bridge:** retain legacy login temporarily as a trusted issuer; exchange a one-use, audience-bound verified account assertion at the native auth boundary.
2. **Replace:** run a native or self-hosted email issuer, privately binding verified methods to the current native wallet.
3. **Transition:** verify legacy access once for migration, explicitly bind the destination account, then enroll independent native login/recovery methods.

Each can preserve familiar email UX. None permits a browser fallback to legacy comment/upload APIs. Native account collisions cannot be resolved by copying DB merge logic: two wallets already own different immutable histories. Creator migration also needs explicit channel-ownership evidence beyond a matching email.

## Decentralization is a set of properties

| Property | Meeting question |
| --- | --- |
| Identity choice | Can users authenticate without Google, our email issuer or a specific vendor? |
| Custody | Who can sign, decrypt, export the wallet or change authorization policy? |
| Operator independence | Are quorum parties independent, or one company's replicas? |
| Host portability | Can users move nodes/domains without changing identity? |
| Recovery independence | Does recovery work after device, node or company disappearance? |
| Revocation | How quickly can a stolen device lose authority, including during partitions? |
| Data continuity | Can users edit existing objects and decrypt old private snapshots? |
| Client trust | Who serves code handling the unlocked key? |
| Privacy | What do issuers, relays, chains and nodes learn or correlate? |
| Accessibility | Does joining require a wallet, phone, gas, domain, hardware or identity proof? |

An independently verifiable signature does not remove a custodian. Export while a vendor operates is not recovery after it disappears. A publicly anchored account is not necessarily private.

## Landscape: alternatives, not a selected stack

| Family / examples | Opportunity | Main Odysee fit |
| --- | --- | --- |
| Legacy/native email; Ory, GoTrue, Better Auth, Auth.js | Familiar onboarding; controlled auth operation | Private issuer-to-existing-wallet binding |
| Passkeys / security keys / hybrid / PRF | Strong login; protected recovery wrapper | Login and PRF recovery are separate experiments |
| Wander Connect / extension / Arweave.app / Wallet Kit / WAuth | Ecosystem-native RSA and embedded UX | Verify signing/decrypt compatibility; ANS-104 is not automatically our commitment format |
| MetaMask Embedded/Web3Auth/tKey | Familiar identity plus sharing variants | Existing-wallet wrapping or auth binding |
| Lit / OpenSigner | Programmable secrets or self-hostable sharing | Protect/recover existing serialized RSA wallet |
| Privy / Turnkey / Dynamic / Dfns | Managed auth/custody/policy | Compare auth-only and supported recovery; do not assume RSA custody |
| SIWE / SIWS / Nostr / LNURL | Existing user-controlled credentials | Optional login adapters with signer onboarding costs |
| ATProto / IndieAuth / Solid | Choice of identity host and social identity | Federation adapter with issuer-authority verification |
| DID/PLC/webvh/ION / KERI | Verifiable controller/key history | Future account authority model, not turnkey login |
| UCAN / zcap / Biscuit / GNAP | Scoped device/tool/moderator authority | Restrict current signer; direct device signing needs verifier changes |
| Internet Identity / Sui zkLogin / Aptos Keyless | Delegated/ZK familiar login | Proof bridge; chain key is not historical RSA key |
| Juicebox / Anastasis / Signal-style recovery / OPAQUE | Distributed/hardware-assisted secret recovery | Protect wallet/envelope; analyze issuer/quorum availability |
| Guardian / smart-account / hardware recovery | Recover or replace controllers | Distinguish key restoration from rotation and old-data recovery |
| VC / OpenID4VP / zkTLS / ZK Email | External account/attribute proofs | Migration evidence under explicit issuer/witness trust |
| Semaphore / proof-of-human | Anonymous eligibility or anti-abuse | Separate from account control and creator ownership |
| FedCM / DBSC | Federation UX or session-theft protection | Supporting browser infrastructure, not recovery |

Primary sources and limits appear in each report. Long-tail items have differing research depth, made explicit in the [coverage ledger](coverage-ledger.md).

## Three paths we could combine or compare

### A. Familiar UX, operated auth with user escape

Email and Ayush's Google flow → private account binding → revocable sessions → same hosted wallet. Add passkeys and independent recovery. A temporary legacy bridge handles migration. Self-hosted identity tools need not become product backends.

Benefit: less conceptual change for existing users; generic writes preserved. Cost: operated issuer/custody remains a trust and availability dependency until independent recovery is proven.

### B. Familiar UX, distributed protection of the existing key

Email/passkey/provider proof → authorized shares/secret release → decrypt exact existing RSA wallet → approved signer/session → native writes.

Benefit: changes recovery trust without immediately replacing every owner. Cost: full wallet eventually exists at an endpoint; quorum independence, client integrity and provider-outage recovery must be proven. Rewrapping cannot revoke a copied wallet.

### C. Portable controller, scoped devices and replaceable signers

Stable account/controller history → delegated device/tool keys → verified native actions. DIDs/KERI/capabilities/chain-account designs offer references.

Benefit: long-term delegation, device management and rotation. Cost: a new authority contract across projections plus historical encryption recovery; not a small login patch.

No path is selected. Familiar email onboarding can coexist with B or C; optional external identities can coexist with A.

## Meeting agenda

1. **User promise:** email-free option, zero-wallet onboarding, creator-grade security, arbitrary-node access—which are launch requirements?
2. **Trust promise:** operated custody, independent recovery, or user-controlled signing? What must survive our company/provider disappearing?
3. **Legacy continuity:** approve-original-tab, code-first, or both? Who attests channel ownership?
4. **Authority:** retain current wallet with better sessions or fund controller/delegation redesign?
5. **Audience:** which external identities are useful to actual users rather than merely interesting?
6. **Experiments:** compare a few prototypes using identical existing-account fixtures and user tasks, not ten production integrations.

Proposed learning portfolio: one email migration journey; one Arweave-native journey; one distributed recovery of an existing wallet; one federated/ZK login; and one scoped-device grant. This is not a commitment to ship five methods.

Each should test new-device return, original-node loss, provider outage, stolen-session revoke, concurrent enrollment, wrong-account linking and old private-data decryption. Measure completion of the intended Follow/Comment/Upload action, not just a successful callback.

## Evidence limits

- Source-confirmed: current native ownership/encryption constraints and inspected legacy session/token flow.
- Documented: protocol mechanisms and product capabilities/version warnings; not independent certification.
- Proposed: Odysee adapters, envelopes, custody handoffs and migration flows absent from current code.
- Unverified: deployed legacy version, Ayush's unpublished work, vendor uptime/prices/disaster recovery, browser compatibility, conversion and implementation security.

This is a broad, traceable landscape, not a claim that finite research enumerates every possible future protocol. No auth code, production configuration, shared node, mail sender or live wallet changed.
