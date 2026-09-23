# Decentralized authentication, federation and capability protocols

Research date: 2026-09-21. Primary-source web research and current local architecture analysis; no implementation, deployments, live authentication, wallet exports, or security testing. Security-review skill used for credential handling, replay, authorization and custody analysis. This is a landscape, not a claim that every conceivable protocol has been exhausted. Recommendations and Odysee integration designs below are hypotheses to validate.

## The distinction that prevents a misleading comparison

“Decentralized login” describes several different problems:

1. **Bring your identifier/authenticator:** authenticate an existing wallet, Nostr key, ATProto account, personal domain or credential wallet.
2. **Move between hosts:** retain an identifier while changing the authority/provider serving it.
3. **Delegate limited authority:** permit a device, moderator or app without handing over a root signing key.
4. **Recover/rotate authority:** replace lost or compromised keys without replacing the social identity.
5. **Retain encrypted history:** recover the actual historical decryption key, not merely a new signing identity.

No protocol below gives Odysee all five just by adding a login button. Our [native audit](../native-auth-audit.md) establishes that current product revisions require the same verified committer; private playlists require the hosted RSA wallet and preferences depend on its serialized key material. A login proof can select that existing wallet at a private authentication boundary. Substituting a different signer requires a deliberate versioned authority change across projections. A DID document or wallet signature cannot decrypt existing RSA-wrapped history.

## Common Odysee integration contract (proposed, not an existing endpoint)

Keep ordinary uploads/comments/follows/preferences as generic committed messages. Add external proofs only at a narrow request-auth boundary:

- Begin authentication: create a private expiring transaction containing random challenge, browser-session binding, expected issuer/account/origin, intended action (`login`, `link`, `recover`) and approved return location.
- Finish: verify the protocol-specific proof; atomically consume the transaction; resolve a namespaced external identity to an existing internal account/wallet; issue a revocable same-origin device session. A provider ID is an identifier, never secret key entropy.
- Link: require current account reauthentication **and** control of the new method. Never merge by display name, email resemblance, ENS name, Nostr alias or handle alone.
- Keep proof tokens, mappings, private identifiers and wallet material out of immutable public messages/indexes. Return no-store/private responses. Arbitrary identity discovery URLs need SSRF/DNS-rebinding defenses and response-size/time limits.
- Changing external auth method must preserve the exact existing committer and ciphertext access. Session revocation and private-key compromise are distinct.

The following are conceptual fields, not a proposed public account device: `auth_transaction`, `proof_kind`, `verified_subject`, `issuer_or_namespace`, `session_binding`, `expires_at`, `existing_wallet_ref`, `credential_status`. Provider evidence must be verified before constructing this record. A distributed binding store needs atomic enrollment; two nodes must not mint unrelated wallets for the same first login.

## 1. Wallet-signature login: SIWE, SIWS and chain-agnostic SIWx

**Protocol evidence.** SIWE standardizes a human-readable signed login challenge with domain, account, URI, chain, nonce and timestamps. EOA verification differs from contract-wallet verification; ERC-1271 validity can change with blockchain state, affecting sessions. Solana's SIWS supplies a wallet-standard sign-in flow; CAIP-122 describes chain-agnostic message fields and namespace-specific verification rather than one universal verifier. [SIWE](https://eips.ethereum.org/EIPS/eip-4361), [SIWS implementation/specification](https://github.com/phantom/sign-in-with-solana), [CAIP-122](https://standards.chainagnostic.org/CAIPs/caip-122)

**User experience/adoption hypothesis.** Strong for existing crypto users: connect extension/mobile wallet, read the domain and sign; no payment should be requested. Poor compulsory onboarding for ordinary viewers if they must first install a wallet, understand networks and protect a seed. Mobile deep-link/QR and return-to-browser behavior require real testing. Offer as an advanced additional credential, not the only entrance.

**Our fit.** Initially LOGIN only: verify signature over a fresh session-bound challenge, privately bind `(namespace, chain, address)` to the current hosted RSA owner. Ethereum/Solana keys do not become that RSA key. Direct product signing is a separate commitment-codec/authority decision. Never derive the hosted secret from public wallet address or an arbitrary signature.

**Trust/recovery.** Self-custodied wallet removes a Google/email issuer dependency but transfers loss/phishing risk to the wallet. Smart-account recovery depends on its controllers/contracts and chain state. RPC access becomes a dependency for contract signatures; the verifier must specify chain and fail safely on unavailable/stale evidence. Account/wallet compromise needs unlink/revoke policy and a second recovery method.

**Spike/kill criterion.** Link one browser wallet and one mobile wallet to an existing native account, cold-login elsewhere, then edit old content and decrypt a private playlist. Reject wrong domain, wrong chain, reused nonce, wrong session and changed smart-wallet authority. Stop if the integration requires token ownership, blind transaction signing, exporting an external wallet's private key, or changing the native committer.

## 2. Nostr: portable key identity and remote signing

**Protocol evidence.** NIP-07 exposes public-key lookup and event signing through `window.nostr`; it is an optional draft browser/extension interface. NIP-46 provides encrypted client↔remote-signer requests via relays, distinguishes the remote signer key from the actual user key, and supports per-method permissions. Its logout hint is not sufficient security enforcement. [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md), [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md)

NIP-98 authenticates an HTTP request using a signed ephemeral event with exact URL, method and recent timestamp; body-hash binding is only recommended by the base text. Our write/login adaptation would require body/challenge binding and one-time consumption rather than assuming a time window prevents replay. [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md)

**User experience.** Existing Nostr users can approve through an extension or phone signer without giving the website their `nsec`. New users still need a signer and a recovery story. Remote signing can avoid repeated root-key exposure and is particularly interesting for desktop↔phone adoption. Never offer “paste your Nostr private key” as the ordinary login path.

**Our fit.** LOGIN adapter binding the verified user pubkey to the existing RSA wallet. NIP-46 is also a useful **design precedent** for an Odysee remote signer, but its event signing is not HyperBEAM/RSA signing; transplanting its transport does not implement our signer or private-playlist opening. The native signing service must enforce message type/action/target policy, not expose an unrestricted root-signing oracle.

**Trust/recovery/censorship.** User-held keys remove a central identity issuer; relays and remote signer still influence availability and metadata privacy. NIP-46 custody depends on who runs the signer. These NIPs do not by themselves give our account a canonical key-rotation/recovery history. A new Nostr pubkey cannot silently replace an old linked credential without another authorized path.

**Spike/kill criterion.** Extension + remote-signer login to one already-linked disposable account; reject replay, wrong body/URL and confusion between bunker/user pubkeys; revoke the client and verify both signer and native session reject it. Stop if mobile onboarding requires copying root secrets or relay outage silently selects another owner.

## 3. LNURL-auth: phone-wallet login with domain-specific identities

**Protocol evidence.** Server creates a random `k1`; a compatible Bitcoin wallet signs it with a domain-derived linking key; server verifies signature and consumes the unused challenge. The full hostname affects the key, so changing `auth.example` to `login.example` changes the login identity. The spec itself warns that seed portability varies between wallet derivation formats. This is authentication, not a Lightning payment. [LUD-04](https://github.com/lnurl/luds/blob/luds/04.md)

**Our fit/user experience.** QR login is attractive for desktop/TV users already carrying a compatible wallet. LOGIN only: map that domain-scoped key to the existing native wallet. Use one intentional stable authentication domain or an explicit cross-domain linking/handoff scheme; arbitrary HyperBEAM node hostnames cannot independently infer the same LNURL identity. The wallet callback must authorize only the browser transaction that initiated the challenge, with phishing-resistant confirmation context.

**Trust/recovery.** No email provider required, but wallet custody and derivation compatibility matter. Domain loss becomes an account-portability issue. Host-domain pseudonyms reduce trivial cross-site key correlation, not all network tracking. Native device-session revocation remains our responsibility.

**Spike/kill criterion.** Two compatible wallets on phone→desktop, seed restore in the chosen supported wallet family, and a changed-node-host test. Reject if the intended arbitrary-domain experience produces different identities without a clear recovery/linking path. Optional niche method, not compulsory launch auth.

## 4. ATProto/Bluesky: federated login and a portable-account precedent

**Protocol evidence.** ATProto OAuth supports identity-only scope, but clients must resolve DID→PDS→authorization server and verify that final subject/issuer are authoritative. It uses authorization code, PKCE, PAR, DPoP and public client metadata. A malicious PDS must not authenticate an arbitrary DID. A static browser client is possible; metadata/callback availability is still required. [ATProto OAuth](https://atproto.com/specs/oauth)

**Our fit/adoption.** A “Continue with Bluesky/ATProto” option could bring an existing social identity without forcing wallet installation. Bind DID, not changeable handle, to the existing native owner. Our manifest needs stable discoverable client metadata and a return flow across manifest versions; implementing OAuth does not require moving product reads/writes into PDS/XRPC. Discovery and proof verification can sit at the existing request-auth boundary.

**Portability evidence.** ATProto migration changes DID service/signing metadata and moves account data; recovery depends on retained rotation authority. Its guidance explicitly distinguishes adversarial migration when an old host is unavailable. This is a valuable acceptance model, not proof that simply supporting ATProto login migrates Odysee wallets. [Migration](https://atproto.com/guides/account-migration), [Recovery](https://atproto.com/guides/account-recovery)

**Trust.** `did:plc` uses signed linked operations and rotation keys, but the reference design has a central directory collecting/validating updates; transparent history is not the same as no registry operator. Provider login availability, DID resolution and metadata fetching remain dependencies. [PLC method](https://github.com/did-method-plc/did-method-plc)

**Spike/kill criterion.** Authenticate an account, change its handle/PDS in a disposable environment, and require the same native owner afterward. Include attacker-controlled PDS claiming victim DID and discovery SSRF cases. Stop if we cannot bind issuer authority to DID or if initial login creates another owner after migration. Suitable optional login spike; designing an Odysee-native PLC-like account root is a larger authority project.

## 5. Personal-domain federation: IndieAuth and Solid-OIDC

**IndieAuth evidence.** A user's URL identifies them; clients discover authorization metadata, perform a code flow and receive verified identity information. The protocol includes token revocation. Users can choose their authorization provider rather than everyone sharing one provider. [IndieAuth specification](https://indieauth.spec.indieweb.org/)

**Solid evidence.** Solid-OIDC uses WebIDs, issuer declarations, code/PKCE and proof-of-possession concepts for access across independently hosted resources. A WebID must authorize the issuer; accepting arbitrary issuer claims would impersonate other WebIDs. Published version 0.1.0 is explicitly work in progress, not a W3C Recommendation. [Solid-OIDC](https://solidproject.org/TR/oidc)

**Our fit/user experience.** Both are LOGIN adapters for advanced creators who already have a domain/identity provider. Entering a personal URL may be pleasant for technical creators but imposes domain/provider concepts on ordinary viewers. Do not require a Solid Pod or move Odysee data into one merely to use identity. Privately bind verified canonical URL/WebID and issuer authority to the existing native wallet.

**Trust/recovery.** Domain registrar/DNS/TLS/hosting and selected issuer are authorities. Hosting migration can retain identity while domain renewal/loss can undermine it. Provider token revocation must also invalidate native derived sessions according to a defined policy; two unrelated session systems do not automatically propagate logout. No built-in restoration of our RSA ciphertext keys.

**Spike/kill criterion.** One self-hosted identity and one independent provider, provider change with stable identifier, domain takeover simulation and malicious issuer mismatch. Stop as a launch method if successful onboarding requires ordinary users to operate a domain/server. Retain as optional federation, not “fully trustless” login.

## 6. DID methods: useful account roots, not complete login products

DID Core separates identifier, verification relationships and service discovery; specific methods determine creation/update/deactivation and trust. A DID is not automatically a person, mailbox, anti-bot proof or recovery system. Authentication keys and capability-delegation keys should not be treated as interchangeable just because they occur in one document. [DID Core](https://www.w3.org/TR/did-core/)

| Method/family | Actual decentralization/recovery property | Odysee assessment |
| --- | --- | --- |
| `did:key` | Deterministic local public-key identifier; cannot itself update/deactivate | Excellent short-lived device/delegation principal; inadequate standalone recoverable creator identity |
| `did:web` | HTTPS/DNS-hosted document; updates by controlling hosting | Simple creator/domain identity; domain/operator dependence and historical-key ambiguity require care |
| `did:plc` | Hash-derived genesis plus linked signed updates/rotation; directory orders accepted operations | Useful stable-root/migration precedent; directory governance and recovery authority explicit |
| `did:ion` / Sidetree | DID operations anchored through Bitcoin; resolver/node infrastructure | Stronger registry independence at significantly larger operational/availability cost; investigate only for a genuine external anchoring requirement |
| `did:webvh` | Web-hosted identifier with verifiable history, key pre-rotation and optional witness machinery | Interesting middle ground for auditable rotation without assuming plain mutable HTTPS is enough |

Sources: [did:key](https://w3c-ccg.github.io/did-key-spec/), [did:web](https://w3c-ccg.github.io/did-method-web/), [PLC](https://github.com/did-method-plc/did-method-plc), [ION](https://identity.foundation/ion/), [ION implementation](https://github.com/decentralized-identity/ion), [did:webvh v1.0](https://identity.foundation/didwebvh/v1.0/).

**Integration alternatives.** (A) DID only as an additional login identifier: resolve authorized authentication key, verify challenge, select existing hosted wallet. Least authority disruption. (B) DID/controller as canonical account identity: messages carry verifiable delegation/history linking current signer to stable account; every projection validates that history and preserves historical authorization semantics. This is an architectural migration, not a profile-field edit. Neither automatically supplies the old RSA decryption key.

**Adoption.** Users should see familiar account names and recovery options, not choose DID methods. Client/SDK, resolver and wallet interoperability determines feasibility. Do not interpret published standard status as proof of current library maintenance: DIDKit was archived July 10, 2025, with maintainers pointing to `ssi` and mobile libraries instead. Check implementation version, audits and ownership before selection. [DIDKit maintainer notice](https://github.com/spruceid/didkit)

**Spike/kill criterion.** Reproduce rotate/revoke/recover/offline-resolve using a chosen method, then replay old/new product events through a proposed verifier. Reject stale/forked controller history and unavailable required revocation evidence. Stop if the design relies on trusting the latest arbitrary HTTP JSON or treats a new DID key as automatically authorized to modify old same-owner native messages.

## 7. Capability systems: UCAN, zcap and Biscuit

**Protocol evidence.** UCAN separates delegation and invocation; attenuation limits delegated authority and proof chains establish its origin. The inspected specification also has revocation and required replay defenses. Offline signature verification is possible, but learning a newly issued revocation still requires distribution/current state. Do not equate offline verification with immediate offline revocation. [UCAN specification](https://github.com/ucan-wg/spec)

Zcap provides signed capability delegation/invocation with constrained authority; its published index currently points to v0.4.0-rc.6. It is not a universal user-login UX or final W3C standard. Biscuit is a separate signed attenuable authorization-token family with policy evaluation and revocation documentation, worth comparing when a full DID stack is unnecessary. [Zcap specification](https://w3c-ccg.github.io/zcap-spec/v0.4.0-rc.6/), [Biscuit documentation](https://www.biscuitsec.org/docs/)

**Our fit.** The strongest use cases are per-device grants, limited creator assistants/moderators, upload tools and temporary sessions. First option: capabilities authorize the trusted hosted signer to perform narrowly defined operations, preserving current RSA committer. Second option: devices sign product messages themselves with proof chains, requiring versioned projection/authority changes. Generic `/id` storage need not become product-specific, but product verification must understand delegated authority before accepting it.

**Data contract proposal.** Signed grant identifies root/account, recipient device key, allowed action/target, expiry and parent proof; invocation binds exact request bytes and unique operation identifier. A revoke event/status source invalidates the grant and descendants. Never put bearer capabilities granting private access in publicly readable messages. Public verification proofs and private secret-bearing capabilities require separate handling. Limits must be applied before signing, not only in UI.

**Adoption/trust.** User-facing “Allow this laptop to comment for 30 days” or “Moderator can hide comments but cannot delete uploads” is understandable; raw capability chains are not. Root recovery and signer custody remain separate. Short expiry reduces stale-revocation exposure but increases renewal dependence. Runtime version/format pinning and library audit required; no Erlang implementation suitability established here.

**Spike/kill criterion.** One comment-only device grant; successful allowed operation; denied upload/private-key export; narrower redelegation; rejected scope widening, replay and expired grants; revocation from another device across two nodes. Stop if a restricted session can request unrestricted root-key export, or if the deployment cannot state its maximum stale-revocation interval.

## 8. Verifiable credentials, OpenID4VP and privacy-preserving attestations

**Protocol evidence.** VC Data Model expresses issuer/holder/verifier claims; trust in an issuer's claim remains a relying-party decision. OpenID4VP transports requested credential presentations, including holder binding and session nonce/audience requirements. Presentations without holder binding do not establish replay-resistant control of the subject. Credential format, issuer trust and status policy must be selected; a generic VC logo is not an authentication guarantee. [VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/), [OpenID4VP 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)

**Our fit.** Especially interesting for **legacy creator ownership attestation**, not mandatory viewer identity. A trusted migration authority could attest that a verified legacy channel belongs to a particular native owner/holder key; the user later presents a fresh bound proof without resending legacy credentials. This is a proposed trust contract and does not prove the historical mapping by itself. Could also attest age/organization/moderator eligibility with data minimization if actually needed; never introduce identity/KYC requirements merely because the technology exists.

**Adoption/recovery.** Credential-wallet app and consent/QR flows add friction. Existing credential ecosystems may reduce this for a subset of users; no Odysee audience penetration established. Wallet loss/reissue, issuer compromise, credential expiry/status and correlation all need policies. Selective disclosure can reduce unnecessary attributes, not eliminate issuer trust or all correlation.

**Spike/kill criterion.** Issue synthetic legacy-ownership attestation, present to a second node with fresh challenge, reject stolen/copied presentation and wrong owner, then revoke/reissue. Stop if the proof exposes email/legacy credentials publicly or merely proves possession of a downloadable document rather than bound authority.

## 9. KERI: key-event histories without a universal blockchain

KERI is a further research class: self-certifying identifiers, linked key-event histories, pre-rotation and receipt/witness machinery for verifiable key state. It is not an off-the-shelf sign-in screen. Its value here is studying how to distinguish current authorized keys, recover/rotate and detect conflicting histories without treating an index as authority. [KERI specification](https://trustoverip.github.io/kswg-keri-specification/)

**Our fit hypothesis.** Could inform a stable native account controller whose device keys change, retaining an auditable relationship to old signers. It introduces resolver/event processing, witness availability and explicit fork/freshness policies. User-visible key management must be hidden behind clear device/recovery operations. Existing RSA-encrypted data still needs an independent historical decryption-key strategy.

**Spike/kill criterion.** Disposable controller, two devices, next-key commitment, rotation, conflicting event histories, and unavailable witnesses. Compare complexity against a deliberately narrower native signed account-grant/reference design. Stop if the only benefit is replacing our append-only vocabulary with a much larger ecosystem while leaving custody/recovery unproved. Standards/documentation availability is verified; operational fit and library audit are not.

## 10. GNAP: richer authorization negotiation

GNAP is IETF Standards Track RFC 9635 (October 2024). A client instance requests access/subject information, proves possession of its key, negotiates user interaction, continues the grant and receives manageable access tokens. Redirect, user-code and asynchronous interactions are described. It standardizes delegation negotiation, not a decentralized key-custody network. [RFC 9635](https://www.rfc-editor.org/rfc/rfc9635.html)

**Our fit hypothesis.** Potentially useful for creator upload tools, TV authorization and explicit device grants where a structured request for exact permissions is clearer than an unrestricted browser session. Map validated grants to permitted use of the existing hosted signer; generic product messages remain unchanged. The authorization server remains an authority and availability dependency. Selecting GNAP does not supply the same RSA owner on a second node, or prove old encrypted-history recovery.

**User/adoption/dependency.** Users see approval/code prompts rather than GNAP terminology. Standard publication is established; no current Odysee-compatible Erlang implementation or partner integration has been validated. A new authorization-server ecosystem may be disproportionate before ordinary sessions are correct.

**Spike/kill criterion.** One tool requests upload-only access, completes phone approval, rotates/revokes its grant and fails a comment/private-key-export request. Compare against OAuth device flow plus narrow grants. Stop if GNAP adds an entire authorization service without solving a demonstrated interaction or interoperability need.

## 11. FedCM: browser-mediated federation, not decentralized custody

FedCM supplies browser-mediated identity-provider account selection and credential exchange intended to reduce dependence on cross-site tracking mechanisms. The browser coordinates relying-party and identity-provider endpoints; the provider remains the identity issuer. It is a browser API rather than a replacement for proof validation, account linking, wallet recovery or a complete decentralized identity protocol. [W3C FedCM](https://www.w3.org/TR/fedcm/), [Chrome overview](https://developer.chrome.com/docs/identity/fedcm/overview)

**Our fit hypothesis.** Could improve supported-browser Google or future self-hosted-provider sign-in while preserving a static manifest. A verified provider assertion still goes through the private binding/session boundary. Federation configuration, accounts/token endpoints and controlled origins must be available; merely hosting arbitrary manifest copies does not enroll every node as a trusted relying party. Coordinate with Ayush rather than introducing a competing Google path.

**Adoption/security/recovery.** Familiar browser UI can reduce custom login prompts, but current browser/provider support must be tested on the actual target matrix, with a non-FedCM fallback. Browser mediation does not remove provider suspension, consent confusion, native-session revocation or lost-key recovery. Do not advertise it as provider independence.

**Spike/kill criterion.** Same existing provider account through FedCM and approved fallback must resolve to the identical native owner; test cancellation, provider account switching, private mode and unsupported browser. Stop if an origin-specific API prevents the chosen deployment model or fallback creates duplicate owners. Treat as UX/transport optimization after account-binding correctness.

## Decision matrix: what each could realistically do here

| Family | Additive LOGIN adapter | Direct existing RSA ownership/decryption | New authority model needed for native device signing | Sensible initial audience |
| --- | --- | --- | --- | --- |
| SIWE/SIWS/SIWx | Yes | No | Yes | Existing wallet users |
| Nostr extension/remote signer | Yes | No | Yes | Existing Nostr users |
| LNURL-auth | Yes, domain-scoped | No | Yes | Compatible Bitcoin-wallet users |
| ATProto OAuth | Yes | No | Yes if adopting account-root semantics | Existing Bluesky/ATProto users |
| IndieAuth / Solid | Yes | No | Yes | Personal-domain / Solid users |
| DID methods alone | Need challenge/login profile | No | Yes | Infrastructure, not visible onboarding |
| UCAN / zcap / Biscuit | After root authentication | Only through authorized existing signer | Yes for independently signed product writes | Devices, moderators, automation |
| VC / OpenID4VP | With issuer/holder-binding policy | No | Yes for authority replacement | Migration attestations; targeted claims |
| KERI | Needs application authentication flow | No | Yes | Long-term portable account infrastructure |
| GNAP | Grants can carry authenticated subject info | No | Yes for new signer authority | Creator tools and device authorization |
| FedCM | Browser-mediated provider login | No | Not by itself | Supported-browser federation UX |

## What to discuss in the meeting

1. **Do we want provider choice, user custody, host portability, or all three?** These are separate costs and deliverables. Optional decentralized login can be useful even while the same native signing wallet remains custodied.
2. **Best additive experiments:** ATProto login for social-user adoption; wallet-signature login for existing crypto users; Nostr remote-signing login for users already carrying a signer. Measure onboarding completion on mobile before choosing.
3. **Best architectural experiment:** a narrow device capability authorizing the existing signer, with negative tests for private-key export and unrelated product actions. This addresses actual multi-device/revocation needs without prematurely replacing all immutable-owner checks.
4. **Best migration-specific experiment:** an explicitly trusted, holder-bound legacy-channel ownership attestation. It does not replace proving legacy ownership at issuance.
5. **Keep native root redesign separate:** compare DID/PLC/webvh/KERI designs on forks, rollback, key compromise, revocation freshness, recovery and ciphertext continuity—not on the word “decentralized.”

All experimental flows must additionally prove same native owner across refresh/new browser/approved node failover; original node unavailable; false linking denied; concurrent enrollment does not create two owners; old sessions revoked; old private playlist/preferences readable; no credential/proof/private key in public `/id` payloads or logs. No empirical adoption metrics or live interoperability claims are made by this research.
