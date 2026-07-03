# Odysee Hosted-Wallet Auth on HyperBEAM

How an Odysee user's existing login credential turns into a durable,
account-scoped signing key on a HyperBEAM node — the design, the code that
implements it on `victor/latest`, and how to run and verify all of it. No
prior context on either codebase is assumed; every term is defined on first
use.

## Why: Odysee users don't hold keys

Odysee users log in with an email/password or social login; they never manage
cryptographic keys directly. The credential a browser actually carries is the
**`auth_token`**: an opaque token minted by Odysee's `user/new` API once per
app installation. It is **per-installation and per-session** — it expires, and
one account accumulates many of them across devices. It only *gates access*;
it is not the user's identity.

The **per-account, durable identity is the wallet**: the LBRY seed and channel
keys, synced across a user's devices by wallet-sync. The channel key is what
signs claims and comments. (Both facts confirmed against the odysee-frontend
source and with the Odysee team.)

HyperBEAM, meanwhile, is a node where every meaningful request is *signed* —
a **commitment** is a cryptographic signature attached to a message, and a
**hosted wallet** is a keypair the node holds and signs with on a user's
behalf ("we host the wallets"). So the bridge problem is: map a keyless
Odysee credential to exactly one hosted wallet per *account*, so that wallet
can own the account's state.

## The model: credential → hook → provider → account wallet

Three HyperBEAM concepts:

- A **device** is a named module of AO-Core (HyperBEAM's protocol) that
  resolves keys on messages — the unit of pluggable behavior.
- A **hook** is a device invoked at a lifecycle point; **`~auth-hook@1.0`** is
  the stock device that runs on every inbound request (`on/request`) and,
  when its `when` gate matches a credential in the request, asks a configured
  *secret provider* to turn that credential into signing material.
- **`~secret@1.0`** is the stock device that stores and reuses hosted
  wallets: given the same derived secret, it mints a wallet once and returns
  the same wallet forever after.

The pipeline:

```
browser credential (cookie auth_token / Authorization header)
  → ~auth-hook@1.0 on/request hook (when-gated)
  → ~odysee-auth@1.0 secret provider:
      extract bare token → resolve token→account → derive domain-tagged secret
  → ~secret@1.0 mints/reuses the ACCOUNT's hosted wallet
  → the request is signed by that wallet
```

A new user gets a wallet minted on first visit; an existing user has their
LBRY wallet imported. The `auth_token` remains a per-device access gate; the
wallet owns account state. Anonymous requests carry no credential, match no
gate, and pass through untouched.

## The devices

- **`~odysee-auth@1.0`** (`hyperbeam/src/preloaded/auth/dev_odysee_auth.erl`)
  — the secret provider. `generate/3` runs three steps:
  1. *Bare-token extraction* — the `auth_token` cookie-jar entry, or the
     `authorization` header with any `Bearer` scheme stripped, or the same
     field from the reshaped `priv/cookie` (see the hook bullet below).
     Cookie-form and header-form of one session converge on ONE token.
  2. *Account resolution* — first look up the token in the node's
     `odysee-session-accounts` config map (an offline stand-in for Odysee's
     `user/me` API); on a miss, if the node's `odysee-account-api` option
     names an Odysee account-API base URL (production: `https://api.odysee.com`),
     make a REAL `user/me` call — form-encoded `auth_token` in, a
     `{success, error, data}` envelope out, the account id being `data.id`
     (shapes measured against production and mirrored in the test suite's
     `hb_mock_server`). An API-rejected token → **401**; an unreachable API →
     **502** — an outage is never mistaken for a bad credential, and never
     silently self-resolves. With neither source configured the token
     self-resolves, so unconfigured nodes behave as before.
  3. *Domain-tagged derivation* — PBKDF2 (a slow password-to-key hash) over
     `odysee-account:<A>` for resolved accounts or `odysee-token:<T>`
     otherwise. This **domain separation** — distinct prefixes per input
     kind — means presenting a known account-id verbatim *as a token* cannot
     derive that account's wallet (a flaw an earlier demo actually had).
- **`~auth-hook@1.0`** (shared device, `dev_auth_hook.erl`) — its `when` gate
  gained `key_present/3`, which can match a *nested private* key. This
  matters because over real HTTP, `hb_http` reshapes the inbound `Cookie`
  header into `priv/cookie` *before* hooks run, and the old gate matched only
  flat top-level keys — so a browser cookie could never fire the hook over
  the wire. A gate of `[authorization, cookie, priv/cookie]` is what makes
  cookie login work in a real browser.
- **`~owned-reference@1.0`** (`dev_odysee_owned_reference.erl`) — owner-gated
  mutable storage for account-owned state such as preferences. On each write
  it cryptographically verifies the signer's commitment (`hb_message:verify`)
  and records that committer as the slot's `owner`; a later write must be
  committed by the same owner or it is rejected with 403. It is the
  account-owned counterpart of `~odysee-reference@1.0`, whose writes are
  gated to the **operator** — the wallet of the node itself — which is right
  for catalog pointers but wrong for user preferences. The owner is stored as
  an explicit field because HyperBEAM's cache retains only a message's
  content-id (hmac) commitment, not its wallet signature — the owner cannot
  be re-derived later. "First writer owns the slot" is a demo simplification;
  production ties the owner to the `~secret@1.0` account wallet.

A supporting fix: `ar_wallet:to_json` in `hyperbeam/src/core/lib/ar_wallet.erl`
could not export **secp256k1** keys (the LBRY wallet key type) to JWK — the
x/y coordinates were missing. Fixed standalone, with a round-trip test in
`hb_ecdsa_tests`; this is what makes importing a real LBRY key possible.

## What is proven (test suite)

`hyperbeam/src/core/test/hb_odysee_auth_test.erl` (19 tests, including
`account_api_resolves_user_me_test` against an `hb_mock_server` speaking
measured production envelopes) plus `hb_odysee_owned_reference_test.erl` (4):

- onboarding mints a hosted wallet; login reuses it
- two sessions of one account share ONE wallet; accounts are isolated
- multiple auth methods (cookie session, password-derived credential) resolve
  to one wallet
- unknown token on a configured node → 401
- owner-gated preferences: write, same-account update, read-back shows the
  account wallet as owner, a foreign account's write → 403
- migration: an existing secp256k1 key is imported into `~secret@1.0` keyed
  to the account, after which the account signs with it
- over real HTTP: onboarding, account identity, and **the browser cookie
  firing the hook** (a `Cookie` header derives the same wallet as the
  `Authorization` header)
- cross-node sync: two nodes sharing a `non-volatile` store resolve one
  account to the same wallet (the equivalent of Odysee's wallet-sync)

```bash
cd hyperbeam
HB_PORT=0 rebar3 eunit -m hb_odysee_auth_test,hb_odysee_owned_reference_test
HB_PORT=0 rebar3 device test -m dev_auth_hook   # shared-device regression
```

`HB_PORT=0` picks a free port; never run tests on 8734, the default node port.

## Reproducing the browser demo

```bash
cd hyperbeam
./scripts/odysee-auth-demo.sh                                    # demo sessions only
ODYSEE_ACCOUNT_API=https://api.odysee.com ./scripts/odysee-auth-demo.sh  # + real accounts
# open the printed URL: http://localhost:18736/~hyperbuddy@1.0/odysee-demo.html
```

With `ODYSEE_ACCOUNT_API` set, the page's "Bring your Odysee account" hero is
live: paste a real odysee.com `auth_token` (DevTools → Application → Cookies)
and the pipeline lights up stage by stage from real request outcomes — token
present, account vouched by the real API, hosted wallet revealed, stable
signature — with prove-it actions that re-send the token as a browser cookie
(same wallet) and tamper one character (rejected at the API stage; the node
never mints). Verified end-to-end against production with a real account
token.

The script boots one node with the session→account map, the `on/request` auth
hook, and `hyperbuddy-serve` for the demo UI
(`hyperbeam/priv/html/hyperbuddy@1.0/odysee-demo.html`, force-tracked past the
`priv/*` ignore). The page is served same-origin, so `document.cookie`
reaches the auth endpoints with no CORS. Each view shows the signing wallet
as a colour-coded badge: same-account views match, the isolation view
differs, the owned-preferences view ends in a red 403 on the foreign write.

A caveat for any JSON client (the demo UI already handles it): the JSON codec
lifts nested sub-messages to `<id>+link` references, so a `/commitments` JSON
body inlines only the *server operator's* commitment — the client wallet's
commitment sits behind a link entry. A JSON consumer must follow `*+link`
entries and exclude the operator address (learned from `/~meta@1.0/info`) to
surface the client signer.

## Relationship to the master auth stack

`master` already carries a `dev_odysee_auth` (merged as PR #2, Rave's work).
It derives the hosted wallet **per token**: PBKDF2 directly over the
`auth_token` with a constant salt, no validation, plus a
`legacy_api_headers/3` passthrough so devices can call `api.odysee.com` as
the user. The `victor/latest` version described here derives **per account**
and validates the token.

Account-keying matters because tokens are per-device and expire: per-token
wallets fragment one user into many identities, and a wallet that changes
whenever a token rotates can never own account state. Two sessions of one
account must reach ONE wallet. Compare the shapes yourself:

```bash
git show origin/master:hyperbeam/src/preloaded/auth/dev_odysee_auth.erl
```

## Out of scope (documented, not built)

- **TEE-ring custody** — hosting the wallets inside trusted execution
  environments (hardware enclaves), so even the node operator cannot extract
  them. Until that lands, the node sees plaintext tokens and hosts extractable
  wallets. For custodial (wallet-ignorant) users this is on the critical path,
  not deferrable.
- **Channel layer** — attribution, multi-channel switching, anonymous uploads.
- **SDK-export wiring for migration** — a test that imports a key directly
  stands in for exporting it from the LBRY SDK. (The
  `user/me` half is done: `odysee-account-api` resolves real tokens against
  production.)
- **`~process@1.0` versioned-latest preference storage** — the demo uses the
  lighter owner-gated store; versioned history remains a production option.

## History

Landed on `victor/latest` as: `c5f92e3` (auth deliverable), `bc6226a`
(standalone `ar_wallet` secp256k1 JWK-export fix), `a039f66` (migration act
uses secp256k1), `64f39b5` (demo launcher + tracked UI), `261ea94` (real
`user/me` resolution via `odysee-account-api`), `f433199` (live-account demo
hero). Doc commits: `f35ab49`, `405e177`.
