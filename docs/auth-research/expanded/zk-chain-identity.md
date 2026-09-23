# Chain-native identity, ZK authentication and proofs of existing accounts

Research date: 2026-09-21. Documentation only. No wallet creation, provider registration, live-account proof, dependencies, node changes or code implementation. Applied the security-review skill to credential privacy, replay, authority binding and recovery. Source inspection baseline: [native auth audit](../native-auth-audit.md). Protocol descriptions below are source-backed; HyperBEAM integration designs and experiment gates are proposals, not existing endpoints or tested integrations.

## Meeting-level conclusion

There are credible alternatives beyond an Odysee-operated magic-link server: Internet Identity's replicated identity/delegation service; Sui zkLogin and Aptos Keyless proof-backed OAuth accounts; and TLSNotary/Reclaim proofs of a user's existing web account. They solve different problems. None automatically recovers the RSA wallet that currently owns our uploads, revisions and encrypted playlists.

Evaluate two separate architectures:

1. **Login bridge, limited disruption:** verify an external proof in the request-auth boundary, privately bind its identity to the existing hosted wallet, issue a revocable node session, retain generic signed product messages. This changes the authentication factor, not custody. Never claim the resulting Odysee account becomes noncustodial merely because the upstream proof is decentralized.
2. **Native external authority, substantial migration:** product projections accept a versioned account/delegation authority instead of requiring the original same-committer signer. This needs all revision, moderation, playlist, preferences and ownership verification contracts redesigned together. Existing RSA decryption keys still require retention or an explicit encrypted-key migration. Do not silently substitute a chain address as an Arweave committer.

For mainstream adoption, evaluate optional login methods behind a familiar account screen. No chain purchase, seed phrase, proof-of-human ceremony, wallet extension or new app should be mandatory merely to watch a video or try a comment.

## Comparison

| Family | What the user experiences | What it actually proves | Additional dependency | Best role to investigate |
| --- | --- | --- | --- | --- |
| Internet Identity | Popup; passkey or supported social login | Delegated control of an app-specific principal | ICP identity canister, certificate trust and frontend availability | Optional passwordless identity provider |
| Sui zkLogin / Enoki | Familiar OAuth followed by proof generation | An ephemeral signer is authorized for an identity-derived Sui address | OAuth issuer, stable salt, prover, JWK/epoch verification | Privacy-preserving social-login bridge |
| Aptos Keyless / Federated Keyless | Familiar OAuth; temporary session keys | Keyless account authority bound to identity commitment | Issuer, pepper, prover, chain configuration/JWK authority | Alternative bridge; custom issuer comparison |
| Semaphore | Join eligible group; produce private proof | Membership and scoped non-duplication, not named creator ownership | Group admissions, root freshness, proof artifacts | Optional anonymous participation/anti-abuse |
| World ID | World credential/app verification | Credential/uniqueness under a selected policy | Issuers, verification network, credential enrollment | Optional anti-abuse, not required account login |
| TLSNotary | Login to old site; selectively prove account facts | Authenticated HTTPS response provenance to a verifier | Live legacy site, verifier/notary, browser tooling | Exceptional legacy ownership migration |
| Reclaim | Guided proof flow against old site | Signed attestation of configured extracted facts | Provider definition, attestors/TEE model and service availability | Managed migration-proof experiment |

## 1. Internet Identity / ICP

**Verified mechanism.** Current documentation presents passkey/OpenID authentication followed by a delegated session key; native canisters obtain the authenticated principal. App principals are origin-specific. The protocol derives them independently of the currently enrolled device; it also describes recovery-device/phrase methods. Alternative origins are deliberately restricted to controlled sites, not arbitrary third-party frontends. The specification lists at most 100 and requires certified canister-hosted alternative-origin configuration. [Integration guide](https://docs.internetcomputer.org/guides/authentication/internet-identity/), [protocol specification](https://docs.internetcomputer.org/references/internet-identity-spec/).

**Important source discrepancy.** The current integration guide describes static-site hosting of the `.well-known` document more generally, while the protocol specification retains canister-hosting/certification requirements. Do not advertise arbitrary HyperBEAM origins until a pinned current implementation demonstrates which rule is enforced. This is an unresolved compatibility question, not permission to weaken origin checks.

**Proposed full Odysee flow:** user selects Internet Identity → popup obtains delegation → browser signs a fresh Odysee challenge with the delegated key → auth boundary validates certificate/delegation, expiry, exact challenge, origin and replay state → privately look up or explicitly link principal to the existing wallet → issue node-local session → ordinary `/id` writes continue under the same RSA owner. Reauthentication reuses the binding, never mints a new wallet solely because a device changed.

The IC specification defines canister signatures and certified trust chains; this is not a normal OIDC JWT that a generic JWT library can accept. An external verifier must implement the applicable certification and delegation checks, including the trusted signer and chain root, rather than trusting a browser-supplied principal string. [IC interface specification](https://docs.internetcomputer.org/references/ic-interface-spec/).

**Infrastructure and trust proposal:** use a reviewed library/verifier at our narrow auth boundary, or a separately operated verifier whose response is authenticated and challenge-bound. The latter is easier but creates another service to trust. Replicated ICP execution is not absence of governance, software-update, availability or frontend trust. Our hosted RSA custody remains separately trusted. Pin allowed II canister/root configuration; reject a different canister presenting a syntactically valid certificate.

**Adoption and recovery:** promising passkey UX with multiple authentication methods; unfamiliar branding/popup is a measurable adoption cost. Ask users to add an independent recovery factor while they still have access. Recovery of the II principal should reconnect the native binding, but cannot restore a lost Odysee wallet backup. An operated-origin allowlist can be manageable; arbitrary community nodes must not be granted our principal namespace or keys automatically.

**Experiment / kill criterion:** two controlled HTTPS origins, second device, removed first factor, expired delegation and substituted principal; demonstrate identical native owner and decryption after reauthentication. Kill as launch candidate if external verification requires trusting an unvalidated browser assertion, if adding an independent operated origin changes identity unexpectedly, or if an II outage leaves no pre-enrolled alternative. Measure completion against email/passkey baseline; do not reuse provider marketing conversion numbers as our forecast.

## 2. Sui zkLogin, including managed Enoki

**Verified mechanism.** Browser creates an ephemeral key, binds it and expiry into the OAuth nonce, obtains issuer JWT, salt and a Groth16 proof, and signs with the ephemeral key. The stable address depends on issuer, subject, OAuth audience and salt. A proof without the session signature is insufficient. Public verification hides selected identity fields, but the salt/proving services receive sensitive inputs. There is no persistent private key for the resulting Sui address. This does not produce an RSA decryption key. [Technical reference](https://docs.sui.io/sui-stack/zklogin-integration/zklogin).

**Full bridge proposal:** complete that flow → sign our single-use, domain-separated login challenge as a personal message → independently verify address, proof, current permitted epoch and message → bind verified address to existing native wallet → issue limited Odysee session. Linking from an existing account requires its current authentication too. Do not accept a decoded JWT, an address claimed by the frontend, or the ZK proof alone as login.

There is a concrete offchain bridge starting point: Mysten's Rust verifier handles personal messages (intent scope 3) and requires the claimed author for that scope. It accepts an optional current epoch; an Odysee service must obtain authoritative freshness itself rather than allowing the browser to choose an old epoch. The repository is a component to review, not a production integration endorsement. [Official verifier source](https://github.com/MystenLabs/zklogin-verifier).

**Salt/recovery consequences.** The integration guide offers user-held, stored or master-seed-derived salts; derived salts bind continuity to the master seed and client ID. It documents mainnet hosted-prover enrollment and separation of production/test configuration. Losing the salt is not recoverable from OAuth alone. [Integration guide](https://docs.sui.io/sui-stack/zklogin-integration/integration-guide).

**Design analysis:** a salt service that releases salt to whoever passes the same OAuth login is not an independent user factor against compromise of that login. Evaluate the deployed release policy, not a blanket “2FA” label. A prover seeing JWT/salt impacts privacy; an operator could also censor or fail. Replicate/backup salt authority and document an exit strategy. Changing OAuth client registration, issuer or provider may change external identity and needs an explicit native-account linking/migration ceremony.

**Enoki alternative.** Enoki packages login-provider configuration, salt/address creation and sponsored Sui transactions. This reduces integration burden but adds a vendor dependency; sponsorship only matters if we actually write Sui transactions, not for ordinary HyperBEAM content. [Enoki documentation](https://docs.enoki.mystenlabs.com/).

**UX/operation proposal:** users should see familiar login and bounded progress, not transaction fees or chain jargon. Compare managed versus self-hosted prover cost, cold-start latency, mobile timeouts and rate limits using quotations/benchmarks before selection; no dollar estimate is established here. Use an independently enrolled native recovery method, not “sign in with a different provider” unless that provider was explicitly linked beforehand.

**Experiment / kill criterion:** login twice with different ephemeral keys and same identity → unchanged owner; salt backup restore → old encrypted playlists open; replay, wrong audience, expired epoch and author substitution rejected; provider/prover failure leads to recoverable alternative. Kill if preserving existing owner requires exposing RSA material to an untrusted prover, if client-ID migration cannot be planned, or if latency/availability loses against direct OIDC without a required privacy benefit.

## 3. Aptos Keyless and Federated Keyless

**Verified mechanism and availability.** Aptos publishes working Google Keyless and Auth0 Federated Keyless examples. Current TypeScript SDK documentation exposes construction from JWT, ephemeral key, proof and federated JWK location, plus asynchronous signature verification capable of fetching required chain state. This is implemented ecosystem machinery, not proof of turnkey HyperBEAM compatibility. [Official examples](https://github.com/aptos-labs/aptos-keyless-example), [SDK account API](https://aptos-labs.github.io/aptos-ts-sdk/%40aptos-labs/ts-sdk-7.2.0/classes/PrivateCode.FederatedKeylessAccount.html).

**Pepper is a real authority dependency.** Accepted AIP-81 specifies a provider/app/user-bound private blinding factor obtained through a VUF service. It explicitly describes a centralized service, possible future distribution, and loss of the VUF secret as catastrophic absent cached pepper. Do not infer today's production topology from the future design. [AIP-81](https://github.com/aptos-foundation/AIPs/blob/main/aips/aip-81.md).

**Federation distinction.** SDK methods can install issuer JWKs at an account-controlled onchain location. “Federated” here is not a proof that every issuer or JWK publisher is independently trustworthy. Pin the JWK authority and define rotation/compromise governance. [SDK Keyless API](https://aptos-labs.github.io/aptos-ts-sdk/%40aptos-labs/ts-sdk-7.2.0/classes/PrivateCode.Keyless.html).

**Full proposed flow:** choose approved issuer → create ephemeral session key and nonce → authenticate → obtain pepper/proof → sign an Odysee-domain login challenge → reviewed verifier checks the appropriate Keyless variant, message, expiry and current approved JWK state → privately bind the identity to native RSA wallet → node session. Preserve origin and challenge binding even if the chain account itself is portable.

**What this could buy us:** custom/community-controlled OIDC issuers with proof-backed assertions, without insisting all users have Google. But a self-hosted issuer can already issue direct OIDC proofs; justify the extra ZK/chain/pepper machinery with a concrete privacy or interoperability requirement. User experience can remain OAuth-like; outage surface includes issuer, prover, pepper and verification state. Recovery must survive more than a forgotten browser key. A different issuer or pepper setup is not automatically the same native user.

**Experiment / kill criterion:** compare standard and federated issuer flows on a disposable network; verify wrong JWK location, issuer and expired keys fail; same-account login survives temporary-key replacement and pepper restore. Pin SDK/network revisions and benchmark external verification without importing transaction-only assumptions. Kill if an operator can change trusted JWKs unnoticed, pepper continuity has no independently tested restore plan, or support for our required challenge format remains ambiguous.

**Research limit:** direct aptos.dev pages and linked AIP-61/AIP-96 URLs failed retrieval during this pass. Conclusions rely on available official SDK, example and AIP-81 material; exact current production decentralization and service SLAs remain vendor/operator questions, not verified facts.

## 4. Semaphore: anonymous membership, not account recovery

Semaphore V4 provides identity commitments, group membership proofs and scope-specific double-signaling prevention; official JavaScript and contract components exist. It does not decide who deserves admission into the group. [Semaphore V4 documentation](https://docs.semaphore.pse.dev/).

**Proposed flow:** eligible user registers a commitment through a chosen admissions policy → client fetches authenticated current group state → generates proof bound to action and challenge → node verifies proof, admitted root, nullifier policy and rate limits → optional anonymous action authorization. Native signed comment attribution still needs a consciously designed contract; a group proof must not silently become “owns this creator channel.”

**Fit:** potential privacy-preserving community polls, member eligibility or limited anonymous reporting. Poor choice as our main durable account because it intentionally hides which member acted. Identity-secret loss and group re-enrollment need a policy, and revoked/stale roots must be bounded. Independent origins require explicit action scope separation to prevent linking or replay. Local proof computation can burden low-end devices; benchmark before UI promises.

**Experiment / kill criterion:** one user cannot double-signal within scope; different scopes remain unlinkable under intended threat model; removed member cannot use stale root indefinitely. Reject for creator migration/recovery if the requirement is merely “a real member is probably the owner.” Membership cannot satisfy it.

## 5. World ID: optional proof-of-human, version-sensitive

World's published API describes proof verification and action policies. However, the newer World ID 4 specification changes nullifiers to single-use and introduces session proofs, authenticator changes and optional recovery agents. A generic “store nullifier forever as user ID” recipe is therefore unsafe across versions. The newer specification also leaves production operator-diversity questions to be established. Pin SDK/protocol/deployment rather than assuming all documentation describes the same shipped network. [API documentation](https://docs.world.org/reference/api), [World ID 4 specification](https://github.com/worldcoin/world-id-protocol/blob/main/docs/world-id-4-specs/README.md).

**Proposed flow:** existing user elects optional verification → request explicitly names accepted credential, action, audience and fresh challenge → credential app produces the appropriate proof → verifier checks root/issuer/policy and version-correct replay/session rules → grant a narrowly defined anti-abuse benefit, not content ownership or wallet recovery.

**User/adoption analysis:** making biometric or government-document enrollment a condition for ordinary participation would exclude users and materially change Odysee's product posture. Do not impose KYC through an auth experiment. Proof of uniqueness also does not prove good behavior or that the holder owns a legacy channel. Credential operators, recovery agents, network access and enrollment availability all belong in the trust model. Provide equally usable non-World paths if tested at all.

**Experiment / kill criterion:** optional anti-abuse trial only, with explicit consent and privacy review; separate uniqueness from named account. Reject as baseline authentication if enrollment becomes mandatory, stable-account binding depends on obsolete nullifier semantics, or the team cannot explain recovery/operator authority to users.

## 6. TLSNotary: prove a legacy account without exporting its cookie

TLS by itself does not make a browser transcript transferable proof. TLSNotary adds an online verifier to the session; portable notary attestations make another verifier depend on the selected notary. Its June 2026 clarification explicitly distinguishes selective-disclosure integrity from honesty of an outsourced witness. Onchain checking does not eliminate that witness. [TLSNotary FAQ](https://tlsnotary.org/docs/faq/), [public-verifiability explanation](https://tlsnotary.org/blog/2026/06/17/public-verifiability/).

**Concrete migration proposal:**

1. Native user requests migration and authenticates the destination wallet. Create a one-time challenge bound to destination owner, origin, intended legacy account/channel and expiry.
2. In an isolated proof flow, user signs into the existing legacy account using its normal magic link/session. A verifier participates in an authenticated request that returns authoritative account-to-channel ownership, not merely a public profile.
3. Reveal only the necessary stable account/channel relationship, response origin and request/response structure. Keep legacy cookies, email address, unrelated channel lists and private content hidden.
4. Bind the proof session and presentation to the migration challenge; if the legacy endpoint cannot echo a nonce, the online verifier must bind its fresh session to our challenge rather than pretend the server signed it.
5. Verify exact HTTPS source, parser semantics, freshness, authenticated-account relationship and approved verifier/notary. Reconfirm the destination native owner. Record a minimal migration attestation and conflict policy; never publish the source cookie or raw transcript.
6. Import permitted social state under explicit provenance. A proof of account access does not resurrect deleted comments, override moderation or recover a lost legacy wallet key.

**Why this is relevant:** a cooperating legacy backend could issue a much simpler signed migration assertion. TLSNotary is attractive mainly when the source cannot/will not add such a route yet its existing authenticated response contains the necessary fact. Since we have legacy/backend access, compare that simpler authority path first.

**Compatibility/UX:** official tooling includes browser-extension and Rust verifier examples. The FAQ currently lists TLS 1.2 support with TLS 1.3 on the roadmap; endpoint compatibility must be measured. Extension installation, extra login and proof progress likely add friction versus an in-product signed migration handoff. [Quick start](https://tlsnotary.org/docs/quick_start/), [verifier deployment](https://tlsnotary.org/docs/extension/verifier/).

**Threat/kill criteria:** stop if legacy returns no authoritative channel relationship; a public page is not enough. Reject altered JSON paths, ambiguous duplicate keys, selective disclosure hiding revocation/delegation flags, stale sessions, a different destination owner and replay. Benchmark source WAF/rate limits, TLS compatibility and response-size costs. Kill if credentials leak to verifier logs, if proving flow requires granting an opaque extension excessive privileges, or if a first-party migration attestation offers the same assurance with substantially less friction.

## 7. Reclaim: managed zkTLS/attestation alternative

Reclaim provides guided source-site proof flows and configurable providers. Its verifier output distinguishes trusted extracted/context data from unverified `publicData`. The SDK recommends pinning the expected provider version/hash. This matters: successful signature verification alone does not prove that the right ownership question was asked. [Flow overview](https://docs.reclaimprotocol.org/), [verification usage](https://docs.reclaimprotocol.org/manual/js-sdk/usage), [message anatomy](https://docs.reclaimprotocol.org/troubleshooting/anatomy).

**Full proposed Odysee flow:** create a server-side proof request for an approved legacy-ownership provider/version → set challenge/destination context → user follows guided legacy login → receive proof → validate witnesses/attestations, context, freshness, provider version and extracted immutable account/channel relationship → consume challenge → bind migration to currently authenticated native owner. Never accept unverified callback fields or `publicData` as authority.

**Trust caution:** current Reclaim material discusses different cryptographic/TEE components. Do not combine the privacy claims of one mode with the operational deployment of another. Its own “Trust Package” contains automated source-check claims; these are vendor-maintained evidence pointers, not an independent security audit or our verification. Obtain the precise deployed attestor code measurement, signer allowlist, key rotation and mode before selection. [Architecture](https://docs.reclaimprotocol.org/understanding-the-tech), [vendor trust package](https://trust.reclaimprotocol.org/section/whitepaper).

**Adoption/operation:** potentially easier than building our own extension integration, but adds guided handoff, vendor availability and recurring proof cost. No current price/latency SLA is asserted here. New provider parsers require maintenance as legacy pages/APIs change. User must see what will be disclosed and be able to decline. Recovery of an old account still depends on that source's login/recovery system.

**Experiment / kill criterion:** implement only a disposable provider proof after authorization, using fixture accounts. Tamper provider hash, extracted field, context and witness; all must fail. Confirm source cookies never reach our backend/artifacts. Kill if ownership proof cannot distinguish channel owner from editor/viewer, or vendor export/verification cannot continue under a documented outage/exit plan.

## 8. Adjacent ZK email and “prove anything” ideas

ZK Email can prove predicates over signed email while withholding unrelated content, but it does not turn any historical welcome email into current account authority. Fresh challenge, recipient/sender semantics, DKIM key history, replay and intended destination still matter. See [email auth options](../email-auth-options.md) for the existing dedicated analysis. Combining it with legacy migration is an additional protocol, not a substitute for the source's ownership semantics.

General ZK proof systems, TEEs or TLS proofs can hide/verifiably compute a predicate; they cannot repair a predicate that only proves a username appeared on a page. The meeting should agree the **exact authorized fact** first: “this currently authenticated legacy account controls channel X and authorizes binding to native owner Y for this one-time request.”

## Experiments to prioritize, without committing to adoption

| Priority | Bounded experiment | Success evidence | Stop condition |
| --- | --- | --- | --- |
| 1 | Legacy signed assertion versus zkTLS feasibility | Actual authoritative account/channel field and scope identified | Only public identity/handle match available |
| 2 | Internet Identity external challenge verifier | Valid delegation accepted; forged/stale/wrong-origin rejected; same native owner on second device | Depends on trusting client-supplied principal or unresolved origin rules |
| 3 | Sui personal-message bridge | Independent proof verification plus stable RSA binding through salt restore | New Sui address treated as old RSA owner or hidden salt dependency |
| 4 | Aptos federated comparison | Custom issuer/JWK authority and pepper restore understood | “Federated” claim has no operational trust/rotation policy |
| 5 | Optional anonymous/anti-abuse proof | Measurable abuse benefit without forced identity enrollment | Becomes mandatory KYC or claimed creator-ownership proof |

For each: collect median/tail login completion, failure and abandonment rates, mobile/browser compatibility, support burden, operator outage recovery, cost per successful login/migration, and whether a non-provider recovery path works. These are experiment measurements to collect, not numbers invented in this report.

## Questions to take into the meeting

- Are we trying to hide identity from public readers, from our serving nodes, from the prover, or from every operator? Those are different architectures.
- Is a second blockchain dependency acceptable solely for authentication, and who maintains its verifier/configuration?
- Does the new method reconnect to the same native wallet with the original node offline, including decrypting old data?
- Can a user lose Google, a salt/pepper service, a device or one domain and still recover through an independently enrolled factor?
- For legacy migration, why not use a narrowly scoped first-party signed ownership assertion if the backend is ours to operate?
- What happens when two valid legacy claims target different native owners? Require conflict policy and auditable authorization, not last-write-wins account takeover.
- Which proof facts remain private and which minimal migration attestations become permanent public evidence?
- What exact benefit over passkeys/email justifies each additional prover, issuer, chain, notary or hardware dependency?

No candidate here is selected or production-certified. The best immediate outcome is a small set of comparable demonstrations with honest custody and recovery claims.
