# Migrating real LBRY/Odysee wallets into `~secret@1.0`

Status: design + code-level investigation. Every claim is tagged **[measured]**
(with a `file:line` citation you can open) or **[hypothesized]** (an inference not
yet proven against code we have on disk).

Scope note: the `odysee-frontend` clone referenced in the task is **not present**
on this machine (`/home/user/repos/HB5/odysee-frontend` does not exist —
**[measured]**, `ls` returns "No such file or directory"). The wallet-sync
*transport* endpoints therefore could not be read from frontend source; where a
claim depends only on the frontend it is marked **[hypothesized]**. Everything
about the wallet *format* and the *crypto* is read from the `lbry-sdk` daemon,
which is the authoritative producer/consumer of the encrypted wallet file.

---

## 0. TL;DR — the crux (question #3)

**The Odysee sync service stores an opaque wallet file it cannot decrypt.** The wallet
is compressed and encrypted client-side with a **user-held sync password** via
scrypt+AES before it ever leaves the client (`Wallet.pack` → `better_aes_encrypt`).
The server keeps only the ciphertext; the password is never transmitted.

Consequence: **a server-side bulk decrypt of all wallets is cryptographically
impossible for any user who set a real wallet password.** Migration must be
**lazy / client-side at next login**: the user (or the client on their behalf)
supplies the password, the node pulls the encrypted wallet file, decrypts it, extracts the
identity keys, and imports them into `~secret@1.0`.

The one escape hatch (**[measured]**, confirmed 2026-07-05): Odysee users who
never set a wallet password have their wallet files encrypted under the **empty
string**. The frontend defaults a missing password to `''`
(`odysee-frontend/extras/lbryinc/redux/actions/sync.ts:95`) and passes it
through `sync_apply`; `Wallet.pack` unconditionally encrypts with whatever
password it receives (`lbry-sdk/lbry/wallet/wallet.py:170-173`), so `''` is a
valid — and publicly known — key input. Those wallet files **are bulk-decryptable**
by anyone holding them, which means Odysee can run a server-side bulk
migration for the no-password cohort (likely the large majority of users).
Password-set users still require the lazy login-time path below.

---

## 1. LBRY wallet format

The wallet is a JSON document. Structure produced by `Wallet.to_dict`
(**[measured]** `lbry-sdk/lbry/wallet/wallet.py:134-140`):

```
{ "version", "name", "preferences", "accounts": [ <account dict>, ... ] }
```

Each account dict is produced by `Account.to_dict`
(**[measured]** `lbry-sdk/lbry/wallet/account.py:358-381`) and contains:

- `"seed"` — the BIP39 mnemonic seed phrase for the account (**[measured]**
  `account.py:359,368`).
- `"private_key"` — the account **master extended private key** (BIP32 xprv
  string), via `self.private_key.extended_key_string()` (**[measured]**
  `account.py:361`).
- `"certificates"` — **the channel private keys**, i.e. `self.channel_keys`
  (**[measured]** `account.py:379-380`).

### How channel private keys are stored

`channel_keys` is a map `channel_address => PEM-encoded private key`
(**[measured]** `account.py:567`:
`self.channel_keys[private_key.address] = private_key.to_pem().decode()`; read
back at `account.py:571` `self.channel_keys.get(channel_pubkey_hash)`). The
underlying curve is **secp256k1** (LBRY channel signing keys), stored as a
PEM text block.

### What is / isn't encrypted *inside* the JSON

`to_dict(encrypt_password=...)` AES-encrypts **only** `seed` and `private_key`
when a password is passed (**[measured]** `account.py:362-368`,
`aes_encrypt` = `double_sha256(password)` key + AES-CBC, `crypt.py:14-25`).
**The `certificates` map is written as plaintext PEM regardless** — it is added
unconditionally at `account.py:379-380` with no encryption step. So inside a
*decrypted* wallet JSON, channel keys are immediately usable PEM. (In the sync
path the whole document is then encrypted again by `pack`, see §2.)

---

## 2. Wallet-sync protocol and encryption

### The encrypted wallet file (authoritative, from the daemon)

- `Wallet.pack(password)` — `zlib.compress(to_json())` then
  `better_aes_encrypt(password, ...)` (**[measured]** `wallet.py:170-173`).
- `Wallet.unpack(password, encrypted)` — `better_aes_decrypt` then
  `zlib.decompress` then `json.loads` (**[measured]** `wallet.py:176-188`).
- `better_aes_encrypt` (**[measured]** `crypt.py:44-51`): random 16-byte IV,
  `key = scrypt(password, salt=IV)` with **N=8192, r=16, p=1** (defaults at
  `crypt.py:69`; the params are also serialized inline as the prefix
  `b's:8192:16:1:'`), then AES-CBC + PKCS7. Output is base64.
- `better_aes_decrypt` (**[measured]** `crypt.py:54-63`) reads the
  `s:N:r:p:` prefix and re-derives the scrypt key from the supplied password.

**KDF summary [measured]:** transport layer = **scrypt (N=8192, r=16, p=1)** →
AES-256-CBC. Inner per-field layer (seed/private_key) = **double-SHA256** →
AES-CBC. Two different KDFs, same password in the sync path.

### Server-side apply / merge

`jsonrpc_sync_apply(password, data=None, ...)` (**[measured]**
`lbry-sdk/lbry/extras/daemon/daemon.py:1968-2008`): "password to decrypt
incoming and encrypt outgoing data". It calls
`wallet.merge(self.wallet_manager, password, data)` (**[measured]**
`daemon.py:1994`).

`Wallet.merge` (**[measured]** `wallet.py:190-214`): if `password` is None the
data is plain JSON, otherwise `self.unpack(password, data)`. It then merges
accounts by `pubkey.address`, calling `Account.keys_from_dict` /
`Account.from_dict`. After apply, `maybe_migrate_certificates` normalizes the
channel-key map (**[measured]** `daemon.py:1996`, `account.py:576-588`).

### The transport endpoints (frontend, not on disk)

**[hypothesized]** The historical LBRY/Odysee wallet-sync API is
`POST .../sync/get` (returns the stored encrypted wallet file + a `hash`) and
`POST .../sync/set` (stores a new encrypted wallet file, guarded by the previous `hash` for
optimistic concurrency), keyed by `auth_token`. The `hash` is `Wallet.hash`
(**[measured]** the value exists: `wallet.py:158-168`, a SHA256 over the
encryption password + preferences hash + per-account hashes) — note this hash
folds in `encryption_password`, so it is a change-detector, **not** a decryption
key. The exact endpoint paths/param names could not be confirmed because the
frontend clone is absent; confirm against `lbryinc`/`ui/redux` before coding.

---

## 3. Server-side mass migration feasibility (the crux, expanded)

**[measured]** The sync password is the *only* input to the scrypt KDF that
produces the AES key (`crypt.py:46,59`). It is supplied to the daemon as the
`password` argument of `sync_apply` (`daemon.py:1968,1982`) and is never part of
the stored encrypted wallet file (the encrypted wallet file is the output of `pack`, `wallet.py:170-173`). The
sync service stores ciphertext only.

Therefore:

- **Password-protected wallets: server-side bulk decrypt is impossible**
  **[measured, by construction]**. Odysee's sync service and internal-apis hold
  the encrypted wallet file but not the password, and cannot derive the key. Migration for these
  users is necessarily **lazy**: the password must be presented at login.

- **No-password wallets: bulk-decryptable [measured].** LBRY still
  requires *a* password to `pack` (the assertion at `wallet.py:171` forbids
  packing a locked wallet, but an empty/constant string is a valid password),
  and the Odysee frontend defaults a missing password to the **empty string**
  (`odysee-frontend/extras/lbryinc/redux/actions/sync.ts:95`). Those wallet files can
  be decrypted by anyone holding them — which
  Odysee's servers would. This is the *only* route to a true server-side bulk
  migration, and its existence/value must be verified in frontend source. Do not
  assume it.

**What Odysee would need for a bulk export:** direct DB access to the sync
service's wallet-file store (keyed by auth_token/account) — which they operate — **plus**
the per-user password. They have the former, not the latter. So the realistic
"mass import all existing wallets" plan Sam described is: bulk-export the
*ciphertext* + account mapping now, but the *decrypt+import* step still runs
per-user with the password (lazy), unless the default-passphrase cohort is
confirmed.

---

## 4. Mapping into HyperBEAM `~secret@1.0`

### Which key matters

- **Channel certificate secp256k1 keys (`certificates` map)** are the user's
  *identity*: they sign channels, claims, and comments (verified by commentron).
  These are what a hosted-wallet identity node needs to preserve. This is the
  primary migration target.
- The account `seed` / master `private_key` (BIP32 xprv) governs on-chain LBC
  funds and derives future addresses. `ar_wallet` has no BIP32 hierarchy concept;
  importing it as an ar_wallet key is not meaningful for AO-Core signing. Treat
  fund custody as out of scope for identity migration (**[hypothesized]** — the
  identity deliverable only needs the channel signing key).

### The import API (measured)

`dev_secret.erl` exposes `generate/3, import/3, list/3, commit/3, export/3,
sync/3` (**[measured]** `hyperbeam/src/preloaded/auth/dev_secret.erl:168`).

- `import(Base, Request, Opts)` (**[measured]** `dev_secret.erl:202`) takes a
  `key` (JSON-encoded secret) or extracts it from the cookie, then
  `import_wallets/4` (`dev_secret.erl:221`).
- Keys are parsed with **`ar_wallet:from_json(Key)`** (**[measured]**
  `dev_secret.erl:255,476,572`) — i.e. the import format is a **JWK**.
- `persist` option controls storage: `client` (not persisted), `in-memory`,
  `non-volatile` (segmented `priv_store`) (**[measured]** `dev_secret.erl:79-88`).
- The generate path mints `ar_wallet:new()` (**[measured]** `dev_secret.erl:181`)
  — migration replaces this with an *import* of the user's real key.

`ar_wallet` supports `{ecdsa, secp256k1}` with `from_json`/`to_json` (JWK), and
the secp256k1 x/y export gap was fixed (per project memory / migration test).

### The keying: account → wallet

`dev_odysee_auth.erl` derives the secret deterministically:
`resolve_account(Token)` → account id (via `odysee-session-accounts` map or a
real `user/me` call, **[measured]** `dev_odysee_auth.erl:312-360`), then
`hb_crypto:pbkdf2(Alg, Token/account, Salt, Iterations, KeyLength)`
(**[measured]** `dev_odysee_auth.erl:394-407`), and `generate/3` mints/reuses the
per-account wallet (**[measured]** `dev_odysee_auth.erl:130-133`).

The existing migration test proves the mechanism: it imports a locally-generated
secp256k1 key via `import_wallet(ar_wallet:to_json(PrivKey), Session, ServerID)`
and then all sessions for that account sign with the **imported** wallet, not a
fresh one (**[measured]**
`hyperbeam/src/core/test/hb_odysee_auth_test.erl:442-453`). Migration = do this
with the user's *real* LBRY channel key instead of a test key.

### The one required conversion — built and verified

LBRY channel keys are **secp256k1 PEM** (`account.py:567`); `ar_wallet:from_json`
wants a **JWK**. The conversion extracts the secp256k1 private scalar `d` and
public `x`/`y` and base64url-encodes them into a JWK. This is the single new
codec piece; the rest was already wiring.

It now exists as **`lbry_channel_key:pem_to_jwk/1`**
(`hyperbeam/src/core/lib/lbry_channel_key.erl`), using OTP's `public_key` to
decode the PKCS8 PEM, and it is **verified end-to-end** against REAL channel keys
(**[measured]**):

- `hb_lbry_channel_key_test` (5 tests) — three genuine channel keys, generated by
  coincurve and packed with the LBRY SDK's own crypto (regenerate via
  `hyperbeam/scripts/gen-lbry-channel-keys.py`), convert to JWK whose private
  scalar equals the key's known scalar byte-for-byte; conversion is
  deterministic (idempotent re-migration); the migrated key signs and verifies;
  distinct keys stay distinct; a non-secp256k1 PEM is rejected.
- `hb_odysee_auth_test:migration_imports_real_lbry_channel_keys_test` — two real
  channel keys migrate through `~secret@1.0` keyed to two accounts; each
  account's sessions then sign with ITS real channel identity, and the accounts
  remain isolated.

The decrypt half is **[measured]** in `scripts/gen-lbry-channel-keys.py`: empty-
password-set wallet files decrypt with no secret (bulk cohort), password-set wallet files need the
password (lazy cohort). Decryption is best done in the client/importer that
holds the sync password, so HyperBEAM only ever receives a JWK — the
`dev_secret` import path is unchanged.

---

## 5. Recommended architecture

**Lazy per-login migration** (primary), with an optional server-assisted bulk
pass only for a confirmed no-password cohort.

### Why lazy
§3 shows the server cannot decrypt password-protected wallets. The password only
exists at the moment the user authenticates. So the decrypt+import must happen
in that window.

### Flow (per login)
1. User authenticates with `auth_token` → node resolves account via `user/me`
   (existing path, `dev_odysee_auth.erl:312-360`).
2. Client (or a trusted importer) obtains the encrypted wallet file for that account
   (`sync/get`, **[hypothesized]** endpoint) and the user's **wallet password**.
3. Decrypt: `better_aes_decrypt(password, encrypted wallet file)` → `zlib` → JSON
   (mirror `wallet.py:176-188`).
4. Extract each account's `certificates` (channel PEM keys).
5. Convert PEM → JWK (§4 conversion).
6. `POST .../~secret@1.0/import` with the JWK, keyed to the resolved account,
   `persist=non-volatile` (`dev_secret.erl:202,221`).
7. Thereafter every session of that account signs with the imported channel key
   (proven pattern, `hb_odysee_auth_test.erl:442-453`).
8. Idempotency: importing the same key yields the same address; a second login
   must not double-import. Gate on "is a wallet already hosted for this account?"
   (the generate path already reuses an existing wallet — `dev_secret.erl:175`
   comment / `dev_odysee_auth.erl:18-19,42`).

### Where the decrypt should run
**[hypothesized]** Prefer **client-side decrypt**, node-side import: the node
receives only a JWK, never the plaintext seed or the sync password. This keeps
the password off the server entirely and matches the `persist=client` philosophy.
If a TEE/`~snp@1.0` node is available, an in-enclave decrypt is an acceptable
alternative (password enters only the enclave).

### Phased plan
1. **PEM→JWK converter + tests — DONE ([measured]).** `lbry_channel_key:pem_to_jwk/1`
   + `hb_lbry_channel_key_test` (5) + the real-key end-to-end act in
   `hb_odysee_auth_test`. Real channel keys migrate through `~secret@1.0` and sign
   as their original identity.
2. **Decrypt harness — [measured] in `scripts/gen-lbry-channel-keys.py`** (proves
   the empty-password/bulk vs password/lazy split against the LBRY SDK's own
   `better_aes_decrypt`). Production decrypt still to be wired client-side/in-TEE:
   reimplement `better_aes_decrypt` (scrypt N=8192/r=16/p=1 + AES-CBC) in the
   importer; confirm against `crypt.py:44-63`.
3. **Wallet-file fetch** — implement/confirm the `sync/get` call and account keying
   (frontend source: `odysee-on-arweave/odysee-frontend/extras/lbryinc/redux/actions/sync.ts`).
4. **Lazy import at login** — wire steps 1–8 into the auth-hook login path;
   idempotent, one wallet per account.
5. **Optional bulk pass** — the no-password cohort is confirmed decryptable
   (empty-string passphrase, `sync.ts:95`): the server decrypts those wallet files and
   imports in batch. Password-set users always fall through to lazy.

### Open items to confirm (all currently [hypothesized])
- Exact `sync/get`/`sync/set` endpoints, params, and `hash` concurrency rule
  (read `extras/lbryinc/redux/actions/sync.ts` in full).
- Whether the account seed/xprv needs migrating at all, or only channel keys.
