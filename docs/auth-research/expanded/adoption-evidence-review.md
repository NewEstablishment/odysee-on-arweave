# Independent adoption, accessibility and migration review

Research date: 2026-09-21. This is an independent challenge to [the proposed journeys](adoption-and-user-journeys.md), not another implementation proposal. No Odysee participant study, production funnel analysis or deployed-provider audit was performed. The security-review checklist informed consent, recovery, session and secret-handling questions; its generic cookie examples are not a substitute for callback-specific design.

## Meeting conclusion

**Do not choose a default login solely from cryptographic strength or another company's conversion numbers.** Choose a small set of candidate experiences, retain guest viewing, and evaluate return visits, recovery and ownership continuity as seriously as first signup. Passkeys deserve a prototype; the evidence does not establish that mandatory passkey-first onboarding is right for existing Odysee users today. Likewise, familiar email does not establish sufficient protection for creator recovery.

Decentralization is also not one user-visible property. Ask separately whether the user can change the content host, authentication provider, signing custodian and recovery provider. A seamless login that silently ties all four to one operator is convenient but not an independently portable account.

## Evidence ledger: what we know and cannot infer

| Primary evidence | Observation supported | Limit / useful implication |
| --- | --- | --- |
| [Ramat et al., SOUPS 2026](https://www.usenix.org/conference/soups2026/presentation/ramat) | Systematic inspection of 111 websites using 28 passkey-experience factors found uneven supporting features despite convergence in core support | Website inspection, not a randomized user-conversion trial. Test enrollment, discovery, deletion and return paths consistently; do not just add a button. This is the full 2026 paper, distinct from its 2025 poster. |
| [Daffalla et al., USENIX Security 2026](https://www.usenix.org/conference/usenixsecurity26/presentation/daffalla) | A qualitative study with 31 participants across Google, PayPal and LinkedIn found difficulties investigating/remediating adversarial passkeys | Not a population failure percentage or proof passkeys are worse than passwords. It motivates testing factor-management and compromise recovery, beyond successful normal sign-in. |
| [Zhou et al., SOUPS 2023](https://www.usenix.org/conference/soups2023/presentation/zhou) | Iterative MetaMask accessibility work involved 44 novice users, including 23 blind participants and one participant with low vision; redesign improved accessibility | One wallet/design context, not a blanket indictment of current wallets. An extension-mediated signing flow adds an accessibility surface Odysee cannot validate by testing its own page alone. |
| [Google's first-party passkey report, May 2024](https://security.googleblog.com/2024/05/passkeys-on-your-phone-computer-and-security-keys.html) | Google reports over one billion authentications across over 400 million accounts; describes password-manager sync and hardware security keys as different portability paths | Establishes feasibility at one large ecosystem's scale, not a conversion prediction for a new manifest app, arbitrary node domains or Odysee's audience. |
| [Internet Identity's product explanation](https://identity.internetcomputer.org/about) | Its own team reports 50% registration drop-off and describes introducing familiar OpenID alternatives | No disclosed controlled comparison here. It does not establish that passkeys caused all abandonment, nor that social login necessarily resolves it. |
| [FIDO Passkey Index 2025](https://fidoalliance.org/passkey-index-2025/) | Provider-contributed adoption and experience measurements show substantial deployments | Participating providers are not a random sample. Different denominators and selected enrolled users matter; do not reuse aggregates as an Odysee forecast. |
| [W3C accessible authentication guidance](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html) | Cognitive authentication burdens need permitted alternatives or assistance; copying/pasting and autofill are important | Accessibility conformance is not equivalent to account security or usable cross-device recovery. Evaluate both. |

These sources support specific design/tests, not an evidence-backed ranking of email versus passkeys versus wallets for our users. No conversion uplift or commercial ROI is claimed.

## Challenges to the initial plan

1. **“Offer recovery later” needs a risk boundary.** Progressive enrollment may reduce interruption but can accumulate unrecoverable content. Test explicit protection prompts before a creator's first meaningful upload and before valuable private-state accumulation. Do not promise recovery for name-only cookie accounts unless another recovery mechanism actually exists. Distinguish a dismissible suggestion from a condition for particular high-risk actions.
2. **A browser credential is not necessarily an account.** People can reasonably confuse the device, platform password manager, Odysee profile and content node. Ask them to explain what survives clearing browser data and losing a phone. A successful biometric prompt is not evidence they understand custody or recovery.
3. **Email familiarity does not mean clicked-browser login.** The inspected legacy behavior approves the initiating browser, whose tab polls for completion. Preserve that model deliberately or clearly explain a change. Mobile users opening mail in an embedded browser should not accidentally receive a second account/session. [Legacy evidence and alternatives](legacy-magic-links.md).
4. **Removing a passkey is not logging out every device.** Present login methods and active sessions as separate concepts. Security tests must include removing an attacker-enrolled method, revoking an attacker session and verifying no unwanted recovery method remains.
5. **An “independent backup” may still share one failure domain.** A passkey, mailbox and encrypted export all kept in the same cloud account are not independent against loss of that account. Ask users to demonstrate recovery without their normal provider, not just describe a backup.
6. **Do not market hosted signing as self-custody.** Keeping wallet terminology out of basic onboarding is reasonable; hiding an operator's ability to sign or access exported keys is not. Explain operational consequences in plain language, with detailed security information available.
7. **Migration success is not first-login success.** Landing on an empty native profile after legacy login can look like data loss. Account connected, channel ownership verified, and content/social import completed are three separate progress states.

## Three user-facing flows to compare

These are proposed copy/sequence experiments, not approved backend contracts. All require the same private account binding and verified native owner continuity; generic product writes remain unchanged.

### A. Familiar return, explicit original-browser approval

- Entry: “Continue with your existing Odysee account” and a separately labeled new-account option; guest viewing remains available.
- Email: “Approve the sign-in you started in Chrome on this device,” with a recognizable matching challenge and explicit confirmation. A code alternative can be pasted into the original tab.
- Completion: original browser resumes the intended action once. The email browser says which browser was approved; it does not silently acquire a full session too.
- Migration: show verified channel/account summary and import progress before inviting a stronger login method. Linking requires both legacy authority and destination-account consent.
- Plain-language custody disclosure: “Your account is secured by the operated signing service. Your chosen sign-in method restores access to this same account.” Do not use this wording until the deployment actually provides that guarantee.
- Evaluate: different browser/email app, original tab closed, stale email, two simultaneous requests, unrelated approval request, native account already active, and no inbox access.

### B. Email-free account, passkey first within this optional route

- Entry: “Create an account without email.” Explain that a passkey is saved by a device or password manager; do not imply Odysee receives the user's biometric.
- Enroll, show readable account identity, then offer a second independent recovery method. Keep “Use another method” discoverable without making a forest of provider buttons.
- Before durable private activity, distinguish “This device can sign in” from “You have tested recovery.” Optional compatible-wallet users take an explicitly advanced route; no seed phrase should be typed into an ordinary login page.
- Return on another device and restore an old private playlist. A passkey prompt working on the same phone is insufficient acceptance.
- Evaluate: unfamiliar credential-manager picker, cancel, old/shared hardware, unavailable sync provider, second OS ecosystem and assistive technology. Whether this route should be the overall default remains a product experiment.

### C. Creator continuity and provider exit

- Entry: creator signs in using an already enrolled method and sees verified channels; high-impact linking/removal uses recent stronger authentication according to an agreed policy.
- “Add another way to sign in” proves the new method and keeps the old one until an independent return test succeeds.
- Test recovery with original node/provider unavailable: same channel authority, existing uploads editable, historical private data readable. Show the exact limits if any part cannot be restored.
- A devices screen separates “Sign out this device,” “Sign out other devices,” and “Remove this sign-in method.” Explain if stolen underlying wallet material cannot be neutralized merely by these actions.
- Evaluate: creator with two accounts, shared production computer, lost mailbox, compromised recovery method, revoked custodian, and import interrupted midway. Never silently merge two signer identities.

## Persona-specific additional checks

| Cohort | Additional discriminating task |
| --- | --- |
| First-time casual viewer | Watch first; choose Follow; cancel login without losing playback/context; determine whether the account will survive clearing the browser |
| Returning legacy viewer | Recognize expected profile/history; distinguish pending import from missing data; complete original-tab approval across phone mail and desktop |
| Established creator | Reject an unsolicited linking request; identify a wrong destination account; remove adversarial method and session without stranding self |
| Privacy-focused user | Complete without forced Google/email/phone; identify what the provider/operator can observe; refuse an unnecessary profile/phone scope |
| TV/shared device | Approve a named device from phone; sign out/revoke it; verify that pairing did not grant account-recovery or wallet-export power |
| Low-end mobile/in-app browser | Cancel external-app handoff, resume safely, tolerate mail delay, and access fallback without camera/extension assumptions |
| Screen-reader/keyboard user | Complete provider dialog as well as our form; paste a full code; understand pending/expired status; manage sessions without icon-only ambiguity |
| Community-node visitor | Identify the read host versus login/custody operator; refuse a look-alike node requesting reusable account authority |

Accessibility work is not limited to auth inputs. Preserve focus and readable status during polling; avoid repeating countdowns excessively to screen readers; give visible labels and usable targets. W3C lists email-link authentication as an example technique, explicitly not a security assessment. Security-essential expiry can have exceptions under timing guidance; do not indiscriminately lengthen token validity in the name of accessibility. Instead test clear expiry, safe resend and preservation of nonsecret progress. [Email-link technique](https://www.w3.org/WAI/WCAG22/Techniques/general/G218.html), [timing guidance](https://www.w3.org/WAI/WCAG21/Understanding/timing-adjustable.html).

## Additional solution class: messenger identity, not decentralized custody

Telegram now documents an OIDC authorization-code flow with PKCE support, registered redirect URLs, server-side token exchange and validated identity tokens. Its new documentation distinguishes that flow from the archived HMAC login widget. This is another optional issuer for an audience already using that messenger, not a decentralized recovery primitive. Request only needed scopes; phone sharing and bot messaging are separate consent. Bind issuer/subject privately to the existing native account, never derive the native wallet from a mutable username. [Current Telegram login documentation](https://core.telegram.org/bots/telegram-login).

For our static manifest, an approved auth boundary would exchange the result and issue a constrained node session; generic content endpoints do not change. Vendor-hosted popup scripts are not automatically acceptable under the existing transport/CSP rules. An external redirect may be easier to isolate, subject to review. Provider ban/outage and audience willingness to link a messenger remain product risks; no claim about conversion benefit transfers from its marketing. Test whether adding this choice helps a real cohort before multiplying visible buttons. Self-hosted/federated issuers have a different operator trust story, while offline recovery files/device transfer have different usability burdens; none eliminates account binding, signer compatibility or recovery testing.

## Research protocol and measurable exit gates

Run formative moderated sessions before any live A/B test. Recruit deliberately across the cohorts above; small qualitative samples reveal failures but cannot estimate population conversion. Use disposable accounts and synthetic private content, never ask participants for real passwords, seed phrases, tokens or production creator credentials. Balance/order candidate flows to reduce learning effects. Observe first, then ask explanations so coaching does not contaminate task success.

Task script: follow a video → return on another device → add a method → approve a TV → revoke it → lose the original device/provider → restore old private state → identify and remove a deliberately suspicious method → resume a partially completed legacy migration. Add a host-switch task to see whether users understand which operator receives authority.

Record separately:

- **Completion:** attempts reaching intended action, same expected owner, versus mere callback success.
- **Integrity:** duplicate-account creation, wrong-account linkage, unintended device approval, missing private data. Treat these as release blockers, not funnel tradeoffs.
- **Lifecycle:** independent return/restore success, method/session removal correctness, provider-exit success.
- **Friction:** unassisted median/p95 completion time, handoffs, resend/expired-link incidents, cancellation recovery, support interventions.
- **Comprehension:** can the person identify where their credential lives, what recovery needs, who can sign, and what logout does? Report separately from satisfaction.
- **Coverage:** device/browser/mail-client/assistive-tech combinations, not just aggregate desktop Chrome success.

Define thresholds with product/security owners after measuring a baseline. Capture privacy-minimized event labels and coarse timings only; no full auth URLs, codes, email addresses, private keys, proofs or screen recordings containing real secrets. No automatic expansion of existing analytics transport. Do not infer a method is unpopular from its raw share when it is hidden deeper in the UI; record exposure and eligible-device denominators.

## Meeting-ready recommendation

Compare a legacy-familiar email transition, optional email-free passkey route, and creator-focused independent recovery journey against the **same account continuity requirements**. Keep the initial UI small while the research catalog is broad. Decide defaults only after observing actual Odysee users and actual supported devices. The most defensible success statement is: “Users can return to the same account and private data, understand who they trust, and recover or revoke access without accidental ownership loss”—not “we added decentralized login.”
