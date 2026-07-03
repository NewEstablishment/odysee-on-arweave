# Odysee Hosted-Wallet Auth on HyperBEAM

How Odysee sessions map onto HyperBEAM's native auth stack (`~auth-hook@1.0`,
`~secret@1.0`), what the current deliverable proves, and how to reproduce it.
Landed on `victor/latest` as: `c5f92e3` (auth deliverable), `bc6226a`
(standalone `ar_wallet` secp256k1 JWK-export fix), `a039f66` (migration act uses
secp256k1), `64f39b5` (demo launcher + tracked UI).

## Identity model

Two facts anchor the design (confirmed with Niko/Sam in the 06-23 → 07-01
meetings, and by the odysee-frontend source):

- The Odysee `auth_token` is **per-installation/per-session**, not per-account.
  It is minted by `user/new` per install, expires, and there are many per
  account. It only *gates access*; it is not the identity.
- The **per-account persistent identity is the wallet** (LBRY seed / channel
  keys), synced across devices by wallet-sync; the channel key is what signs
  claims and comments.

The HyperBEAM translation:

```
browser credential (cookie auth_token / Authorization header)
  → ~auth-hook@1.0 on/request hook (when-gated)
  → ~odysee-auth@1.0 secret provider:
      extract bare token → resolve token→account → derive domain-tagged secret
  → ~secret@1.0 mints/reuses the ACCOUNT's hosted wallet
  → the request is signed by that wallet
```

The user never handles a key ("we host the wallets"): a new user gets a wallet
minted on first visit; an existing user has their LBRY wallet imported. The
cookie remains a per-device access gate; the wallet owns account state.

## The devices

- **`~odysee-auth@1.0`** (`src/preloaded/auth/dev_odysee_auth.erl`) — the
  secret provider. `generate/3` runs three steps:
  1. *Bare-token extraction* — the `auth_token` cookie-jar entry, or the
     `authorization` header with any `Bearer` scheme stripped, or the same
     field from the reshaped `priv/cookie`. Cookie-form and header-form of one
     session converge on ONE token.
  2. *Account resolution* — `hb_maps:find` in the node's
     `odysee-session-accounts` map (the offline stand-in for Odysee's
     `user/me`). Mapped → the account; unknown token on a configured node →
     **401**; no map at all → the token self-resolves (unconfigured nodes are
     unchanged).
  3. *Domain-tagged derivation* — PBKDF2 over `odysee-account:<A>` or
     `odysee-token:<T>`. The domain separation means presenting a known
     account-id verbatim as a token can NOT derive that account's wallet
     (the security flaw the preliminary demo had).
- **`~auth-hook@1.0`** (shared device, `dev_auth_hook.erl`) — the `when` gate
  gained `key_present/3` so it can match a *nested private* key. Over real
  HTTP the inbound `Cookie` header is reshaped into `priv/cookie` *before* the
  hook runs, so a gate of `[authorization, cookie, priv/cookie]` is what makes
  a browser cookie actually fire the hook over the wire. Anonymous requests
  match none of these and pass through untouched.
- **`~owned-reference@1.0`** (`dev_odysee_owned_reference.erl`) — owner-gated
  mutable storage for account-owned state (preferences). On each write it
  cryptographically verifies the signer commitment (`hb_message:verify`) and
  records that committer as the slot's `owner`; a later write must be committed
  by the same owner or it is 403'd. This is the account-owned counterpart of
  `~odysee-reference@1.0`, whose writes are operator-gated (right for catalog
  pointers, wrong for user preferences). Ownership is stored as an explicit
  field because the cache retains only a message's content-id (hmac)
  commitment, not its wallet signature. "First writer owns the slot" is a demo
  simplification; production ties the owner to the `~secret@1.0` account
  wallet.

## What is proven (test suite)

`src/core/test/hb_odysee_auth_test.erl` (18 tests) +
`hb_odysee_owned_reference_test.erl` (4):

- onboarding mints a hosted wallet; login reuses it
- two sessions of one account share ONE wallet; accounts are isolated
- multiple auth methods (cookie session, password-derived credential) resolve
  to one wallet
- unknown token on a configured node → 401
- owner-gated preferences: write, same-account update, read-back shows the
  account wallet as owner, foreign account's write → 403
- migration: an existing **secp256k1** key (the LBRY wallet key type) is
  imported into `~secret@1.0` keyed to the account, after which the account
  signs with it (enabled by the `ar_wallet:to_json` fix in `bc6226a`)
- over real HTTP: onboarding, account identity, and **the browser cookie firing
  the hook** (a `Cookie` header derives the same wallet as the `Authorization`
  header)
- cross-node sync: two nodes sharing a `non-volatile` store resolve one account
  to the same wallet (the ring / wallet-sync property)

```bash
cd hyperbeam
HB_PORT=0 rebar3 eunit -m hb_odysee_auth_test,hb_odysee_owned_reference_test
HB_PORT=0 rebar3 device test -m dev_auth_hook   # shared-device regression
```

## Reproducing the browser demo

```bash
cd hyperbeam
./scripts/odysee-auth-demo.sh
# open the printed URL: http://localhost:18736/~hyperbuddy@1.0/odysee-demo.html
```

The script boots one node with the session→account map, the `on/request` auth
hook, and `hyperbuddy-serve` for the demo UI
(`priv/html/hyperbuddy@1.0/odysee-demo.html`, force-tracked past the `priv/*`
ignore). The page is served same-origin, so `document.cookie` reaches the auth
endpoints with no CORS. Each view shows the signing wallet as a colour-coded
badge: same-account views match, the isolation view differs, the
owned-preferences view ends in a red 403 on the foreign write.

A JSON-client caveat the UI already handles: the JSON codec lifts nested
sub-messages to `<id>+link` refs, so a `/commitments` JSON body carries only
the *server operator's* commitment inline — the client wallet's commitment is
behind a link. Any JSON consumer must follow `*+link` entries and exclude the
operator address (from `/~meta@1.0/info`) to surface the client signer.

## Out of scope (documented, not built)

- **TEE-ring custody** — until the TEE ring lands, the node sees plaintext
  tokens and hosts extractable wallets. For wallet-ignorant (custodial) users
  this is on the critical path, not deferrable.
- **Channel layer** — attribution, multi-channel switching, anonymous uploads.
- **Real `user/me` / SDK-export wiring** — the `odysee-session-accounts` map
  and the import act stand in for them.
- **`~process@1.0` versioned-latest preference storage** — the demo uses the
  lighter owner-gated store; versioned history remains a production option.
