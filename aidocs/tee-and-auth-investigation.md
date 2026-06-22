# TEE And Auth Investigation

## Summary

The local HyperBEAM node can run normally on this Mac, but it cannot run as a real TEE node here. HyperBEAM TEE support is AMD SEV-SNP oriented, which requires a Linux host with SNP-capable AMD hardware, BIOS support, KVM SEV-SNP enabled, `/dev/sev`, and the hb-os VM build/runtime stack.

The auth components Sam mentioned are real and already wired into the default node request path:

- `auth-hook@1.0`
- `http-auth@1.0`
- `cookie@1.0`
- `secret@1.0`

The `?!` path behavior is also real on the local default node. Without credentials it returns a Basic-auth challenge. With an `Authorization: Basic ...` header, the request succeeds and returns signed commitments.

## TEE Findings

Local HyperBEAM docs say TEE support goes through `~snp@1.0`, specifically for AMD SEV-SNP attestation. The docs describe:

- generating an attestation report when called in an appropriate environment
- verifying a remote node's attestation report
- checking report data, debug policy, trusted software measurements, and certificate chain

The local `hyperbeam/docs/run/tee-nodes.md` page is mostly placeholder text and points to `permaweb/hb-os` for real setup and deployment.

The current imported HyperBEAM tree has generated docs for `dev_snp` and `hb_snp_nif`, but the corresponding source files are not present under `hyperbeam/src`. That means this checkout can describe the SNP device from generated docs, but it does not appear able to build or run the SNP device implementation directly from local source.

The hb-os repository is the practical TEE path. Its README describes an SEV-SNP VM builder/runner that builds SNP kernel, OVMF, QEMU, base image, guest image, attestation tools, and dm-verity protected guest images. The host prerequisites include SNP BIOS settings, a SNP-enabled Linux kernel, CPU flags including `sev_snp`, KVM parameters `sev`, `sev_es`, and `sev_snp` all set to `Y`, and `snphost ok` passing.

Conclusion: we can run a normal HyperBEAM node locally, and we can prepare code/config locally, but a real TEE node needs a separate AMD SEV-SNP Linux host or cloud instance plus hb-os. This Mac is useful as the control/build/investigation workstation, not the TEE host.

## Auth Findings

The default node config in `hb_opts` includes an `on.request` hook chain:

- rate limit
- `auth-hook@1.0`
- name resolution
- manifest
- blacklist

The auth hook activates when the request contains either:

- `authorization`
- `!`

That matches Sam's note about adding `?!` to a path. AO-Core HTTP parsing treats query parameters as message keys. So `?!` creates a `!` key, which makes the default auth hook relevant even if no `Authorization` header is present.

The default secret provider for the hook is:

- device: `http-auth@1.0`
- access-control: `http-auth@1.0`

`http-auth@1.0` derives a secret from the HTTP Basic credentials using PBKDF2. If there is no authorization header, it returns:

- status `401`
- `www-authenticate: Basic`
- details `No authorization header provided.`

`secret@1.0` is the node-hosted wallet device. It can:

- generate a wallet
- import a wallet
- list hosted wallet key IDs
- commit/sign with a hosted wallet after access-control passes
- export/sync wallets where authorized
- persist hosted wallets as `client`, `in-memory`, or `non-volatile`

`cookie@1.0` is both a cookie codec and an auth provider. It can store generated secrets in cookies and later verify/commit using those secrets. `auth-hook@1.0` can use either HTTP auth or cookie auth as its secret provider.

## Local Verification

The local node was already running on `http://localhost:8734`.

Unauthenticated `?!` challenge:

```bash
curl -i 'http://localhost:8734/~meta@1.0/info/address?!'
```

Returned `401` with `www-authenticate: Basic`.

Authenticated `?!` request:

```bash
curl -i -H 'accept: application/json' \
  -H 'Authorization: Basic dXNlcjpwYXNz' \
  'http://localhost:8734/~meta@1.0/info/address?!'
```

Returned `200` with commitments in the JSON response.

Focused preloaded-device auth tests:

```bash
env HB_PORT=18760 rebar3 device test \
  --devices dev_auth_hook,dev_http_auth,dev_cookie,dev_secret \
  --timeout 30
```

Passed all 52 tests, including:

- `auth-hook@1.0: cookie_test`
- `auth-hook@1.0: http_auth_test`
- `auth-hook@1.0: chained_preprocess_test`
- `auth-hook@1.0: when_test`
- `secret@1.0: commit_with_cookie_wallet_test`
- `secret@1.0: sync_wallets_test`
- `secret@1.0: sync_non_volatile_wallets_test`

## Recommended Next Steps

For auth:

1. Decide whether the Odysee/HyperBEAM bridge should start with HTTP Basic, cookies, or both.
2. Build a small browser-facing proof using `?!` and cookie auth, because Basic auth is useful for proving the flow but not enough for a polished user login.
3. Define the hosted-wallet persistence mode for early testing. `in-memory` is safest for development; `non-volatile` is the path for restart survival.
4. Design the user-facing identity model: whether a user owns/imports a wallet, gets a node-hosted wallet, or uses a node-hosted session wallet as an execution authority.
5. Write an Odysee-specific auth hook config, then test it with `rebar3 device test` plus live curl/browser flows.

For TEE:

1. Treat the local Mac as non-TEE.
2. Pick or provision an AMD SEV-SNP Linux host.
3. Validate host readiness with hb-os checks: CPU flags, KVM SEV params, `/dev/sev`, TPM, and `snphost ok`.
4. Clone hb-os on the TEE host and run the hb-os setup/build/start workflow.
5. Reconcile this monorepo's HyperBEAM branch with the hb-os configured `hb_branch`.
6. Confirm whether the live HyperBEAM branch used by hb-os includes `dev_snp` and `hb_snp_nif`, since this local imported branch only has generated docs for them.

