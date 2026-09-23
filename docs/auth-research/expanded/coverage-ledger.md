# Coverage, evidence depth and open research questions

Date: 2026-09-21. This ledger prevents a long list of names from being mistaken for complete implementation diligence. See the [meeting brief](README.md).

## Method

The expanded pass used separate research agents for legacy magic links, distributed custody, decentralized protocols, Arweave-native options, chain/ZK identity, unusual recovery and independent adoption evidence. The primary agent researched complementary primary sources, inspected native integration points and selected legacy code, read the reports, and documented common integration models and user journeys. The earlier narrower pass is retained rather than silently rewritten as comprehensive work.

Searches followed distinct mechanisms, not only meeting keywords: key possession, federation, private-key custody, threshold secret release, verifiable identity history, delegated capabilities, proof-backed OAuth, web-account attestations, anti-abuse proofs and recovery without a seed. Primary standards, maintainers' code/docs and original research were preferred over comparison/affiliate articles. Product marketing was treated as a claim, not an independent audit.

Depth labels:

- **Local trace:** actual source paths/commits reviewed; no implied live deployment test.
- **Mechanism study:** primary documentation and a concrete proposed Odysee lifecycle/integration/threat/test analysis.
- **Screened:** representative primary source checked, niche and blockers identified; not full implementation review.
- **Baseline:** covered in earlier dedicated reports, cross-linked rather than duplicated.
- **Not evaluated:** no operational, security, commercial or user test established.

## Topic coverage

| Topic / candidates | Depth | Report |
| --- | --- | --- |
| Native cookie/secret/account ownership, restart persistence and revocation gaps | Local trace | [Native audit](../native-auth-audit.md) |
| Legacy magic links, optional password, polling, merge, hosted wallet, logout | Local trace | [Legacy](legacy-magic-links.md) |
| Native issuer versus legacy bridge versus combined transition | Mechanism study / proposal | [Legacy](legacy-magic-links.md) |
| Ory, Supabase/GoTrue, Better Auth, Auth.js, managed issuer | Screened implementation alternatives | [Legacy](legacy-magic-links.md) |
| Outbound code/link, inbound DKIM, ZK Email, email attestations | Baseline mechanism study | [Email](../email-auth-options.md) |
| Passkey/RP/origin, hybrid, PRF, TV/device approval, DBSC | Baseline mechanism study | [Passkeys](../passkeys-device-options.md) |
| Wander Connect, Wander extension/mobile, Arweave.app/Connector | Mechanism study | [Arweave](arweave-native-options.md) |
| Wallet Kit, WAuth, Othent warning, Arpass, offline/AO wallet tools | Screened | [Arweave](arweave-native-options.md) |
| MetaMask Embedded/Web3Auth/tKey, Lit current and legacy architectures | Mechanism study | [Custody](distributed-custody.md) |
| Privy, Turnkey, Dynamic, Dfns, OpenSigner | Mechanism study at documented contract level; no internal audit | [Custody](distributed-custody.md) |
| SIWE, SIWS, CAIP SIWx | Mechanism study | [Protocols](decentralized-protocols.md) |
| Nostr browser/remote signer/HTTP auth; LNURL-auth | Mechanism study | [Protocols](decentralized-protocols.md) |
| ATProto OAuth and account migration | Mechanism study | [Protocols](decentralized-protocols.md) |
| IndieAuth / Solid-OIDC | Mechanism study | [Protocols](decentralized-protocols.md) |
| DID key/web/plc/ion/webvh, KERI | Comparative mechanism study; no resolver implementation audit | [Protocols](decentralized-protocols.md) |
| UCAN / zcap / Biscuit | Comparative mechanism study; native capability design proposed | [Protocols](decentralized-protocols.md) |
| VC/OpenID4VP, GNAP, FedCM | Mechanism study | [Protocols](decentralized-protocols.md) |
| Internet Identity external delegation verification | Mechanism study; origin-support discrepancy unresolved | [Chain/ZK](zk-chain-identity.md) |
| Sui zkLogin/Enoki, Aptos Keyless/federated | Mechanism study; some Aptos sources unavailable | [Chain/ZK](zk-chain-identity.md) |
| Semaphore/World ID | Mechanism study for eligibility, not persistent ownership | [Chain/ZK](zk-chain-identity.md) |
| TLSNotary/Reclaim zkTLS for legacy proofs | Mechanism study / proposed migration evidence | [Chain/ZK](zk-chain-identity.md) |
| Juicebox, GNU Anastasis, Signal SVR2/SVR3 | Mechanism study | [Recovery](unusual-recovery-and-long-tail.md) |
| OPAQUE, threshold OPRF/SPHINX | Mechanism study | [Recovery](unusual-recovery-and-long-tail.md) |
| Guardians/Safe; ERC-1271/4337/7579 and EIP-7702 | Mechanism distinctions and recovery study | [Recovery](unusual-recovery-and-long-tail.md) |
| PRF/hardware hmac-secret protected backup | Mechanism study; actual browser matrix untested | [Recovery](unusual-recovery-and-long-tail.md) |
| Matrix secret storage/cross-signing | Screened design comparison | [Recovery](unusual-recovery-and-long-tail.md) |
| SQRL, client certs/WebID-TLS, OpenPGP, S/MIME, SSH | Screened long tail | [Recovery](unusual-recovery-and-long-tail.md) |
| DNS/domain control, identity-based email encryption | Screened long tail | [Recovery](unusual-recovery-and-long-tail.md) |
| Password login, recovery kit, cloud backup, SMS/TOTP | Baseline; no provider procurement | [Key management](../recovery-key-management.md) |
| User adoption, accessibility, migration and incident recovery | Primary evidence plus proposed user study | [Journeys](adoption-and-user-journeys.md), [independent review](adoption-evidence-review.md) |

## Material source/version traps discovered

1. Legacy email link approves the original session, rather than necessarily logging in the clicked browser. Preserve this distinction when comparing replacement UX.
2. Wander Connect's documented recovery file is a device share, not demonstrated complete offline recovery.
3. Wallet Kit warns against Othent while example code still includes it. A historical sample is not current adoption guidance; actual shutdown was not independently tested.
4. Lit current Chipotle TEE docs and older Datil threshold/wrapped-key docs describe different generations. Do not combine their guarantees.
5. Dynamic has separate TEE/MPC documentation, with reviewed MPC docs marked beta. Pin the exact offering.
6. Dfns RSA authentication credentials do not prove RSA wallet custody/signing support.
7. DIDKit is archived; standard publication does not ensure the chosen SDK is maintained.
8. Internet Identity guide/spec origin-hosting statements differ; validate pinned behavior before claiming arbitrary-node portability.
9. Aptos pepper/VUF availability and Sui salt/audience continuity are distinct hidden dependencies behind a familiar OAuth screen.
10. World ID versions change nullifier/session semantics; old sample identity mapping is not universally safe.
11. Safe's recovery notification warning is historically dated; do not claim the current product necessarily has the same behavior.
12. A documented vendor export route is not evidence of provider-independent disaster recovery.

## What this research cannot honestly certify

- Every possible product or future protocol. The map covers materially distinct relevant classes and representative implementations; obscure variants are grouped where their trust/compatibility problems are the same.
- Current live deployment of the legacy source or Ayush's private branch.
- Current operational independence, prices, support guarantees or all production components of any vendor.
- Formal cryptographic security or correctness of a new composition of otherwise established components.
- Working browser/OS/provider combinations, especially PRF restore and cross-origin identity continuity.
- Native RSA import/export, exact commitment signing or old-private-data recovery for any external candidate without a prototype.
- Conversion/retention improvement on the Odysee audience. Case studies generate hypotheses, not transferable percentages.

No candidate accounts were registered, vendors contacted, live keys exported, chains funded, services started, or new repos required. Research added documents only and preserved existing QA edits.

## Follow-up evidence requests for the meeting

1. Obtain the exact Google-auth branch/commit and agree shared account-binding semantics with Ayush.
2. Confirm production legacy email/provider/version, supported account/channel evidence and permission to build a migration assertion.
3. Choose a small candidate portfolio; request exact SDK releases/licenses, relevant audit scope, trust topology and disaster-recovery runbook.
4. For vendor systems, ask for an existing-RSA support demonstration or reclassify as auth-only/wrapper research. Do not pay for a large integration based on a chain-support logo.
5. Run each chosen design against identical disposable native fixtures and outage/replay/linking tests in [integration models](infrastructure-integration-models.md).
6. Run user tasks across legacy/new/creator/privacy/mobile/TV cohorts before selecting the default login UX.

Further research should target one of these evidence gaps or a genuinely different trust mechanism, rather than indefinitely collecting interchangeable brand names.
