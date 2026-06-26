# HyperBEAM Auth Upload Demo

This implements the next proof from the June 23 call: a legacy-authenticated browser request can be converted into a HyperBEAM-signed request, write small bytes into the HyperBEAM store, receive an upload id, and read the bytes back.

Safety boundary:

- The local demo uses a fake token map, default token `demotoken`, and a local filesystem HyperBEAM store.
- It does not call production Odysee publish, upload, wallet, S3, or account mutation APIs.
- Real Odysee auth tokens should only be sent to localhost during this demo, or to a deliberately trusted/attested node later.

Native upload boundary:

- New uploads are not converted into Odysee blobs, sd_hashes, or stream descriptors.
- The uploaded file bytes are stored directly in the HyperBEAM store.
- Channel search treats legacy claim IDs and HyperBEAM upload IDs as separate content refs that can appear together.
- Native HyperBEAM upload items keep publish metadata on the item: thumbnail, title, description, tags, filename, content type, byte size, and sha256.

## What Changed

- `odysee-upload-demo@1.0` accepts a request only after `auth-hook@1.0` has consumed the legacy token and signed the request.
- The device rejects raw token fields if they reach storage directly.
- The upload response includes a cache/read id, signed request id, body path, legacy user id, signer list, filename, content type, byte size, and sha256.
- The upload response and channel index preserve title, description, tags, thumbnail URL, claim name, channel id, and channel name when provided.
- The upload device links each native upload under `odysee/hyperbeam-channel/<channel-id>/uploads/<upload-id>` when a `channel-id` is provided.
- `~odysee-upload-demo@1.0/channel?channel-id=...&legacy-claim-ids=...` returns both `legacy-claim-ids` and `hyperbeam-upload-ids`.
- `~odysee-claim@1.0/search` merges native HyperBEAM upload items into channel-scoped stream searches on page 1.
- Native upload search items are claim-shaped stream items, but their `value.source` contains `hyperbeam_upload_id` and `hyperbeam_body_path` instead of `sd_hash`.
- The frontend debug console now has an optional auth-token field, file picker, auth-proof action, and upload-demo action.
- `window.odyseeHyperbeamLegacyAuthUploadDemo(token, file)` exposes the same flow for manual browser-console testing.

## Run The Local Node

From `hyperbeam/`:

```sh
./scripts/odysee-auth-upload-demo.sh
```

Useful overrides:

```sh
NODE_PORT=19736 DEMO_TOKEN=demotoken DEMO_USER_ID=424242 ./scripts/odysee-auth-upload-demo.sh
```

The script prints the frontend env to use with `odysee-frontend`:

```sh
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18736
ODYSEE_HYPERBEAM_LEGACY_AUTH_TRUST=local-demo
ODYSEE_HYPERBEAM_LEGACY_AUTH_DEMO_TOKEN=demotoken
```

To validate a pasted real Odysee `auth_token`, keep the node local and point the verifier at a read-only `user/me`-compatible endpoint:

```sh
LEGACY_AUTH_URL=https://<odysee-user-me-endpoint> \
LEGACY_AUTH_TOKEN_MODE=form \
./scripts/odysee-auth-upload-demo.sh
```

In this mode the browser still sends the pasted token to the local HyperBEAM node as `X-Lbry-Auth-Token`, but `odysee-legacy-auth@1.0` validates it against `user/me` and associates the signed request with the returned legacy user id. The public `https://api.odysee.com/user/me` endpoint expects POST form auth, so the default verifier mode sends `auth_token` in an `application/x-www-form-urlencoded` request body and does not append the token to the verifier URL. The fake `demotoken` map remains the default when `LEGACY_AUTH_URL` is unset.

## Validate With Curl

The node prints copyable checks. The upload check posts bytes through the authenticated `?!` path, which triggers `auth-hook@1.0` before `odysee-upload-demo@1.0` stores anything.

Expected result:

- auth proof returns a signed `/commitments` response
- upload proof returns `ok: true`, `upload-id`, `signed-id`, `body-path`, and `sha256`
- channel proof returns the supplied legacy claim IDs plus the new HyperBEAM upload ID
- claim search proof returns `total-items: 2` and a `claim-ids+link` header for the merged legacy/native result message
- resolving the returned HyperBEAM upload ID returns a native stream item with title, description, tags, thumbnail, and native source metadata
- reading `~odysee-upload-demo@1.0/read?id=<upload-id>` returns the original bytes

## Validate In The Browser

Run the frontend with the printed env values, open the HyperBEAM debug console, paste the fake token or rely on `ODYSEE_HYPERBEAM_LEGACY_AUTH_DEMO_TOKEN`, choose a small file if desired, then click `upload demo`.

The result should show:

- the local trust gate passed
- HyperBEAM returned an upload id
- the upload response includes `legacy-user-id`
- the channel result includes `legacy-claim-ids`, `hyperbeam-upload-ids`, and typed `content-ids`
- the readback byte count and sha256 match the uploaded body
- debug events include `~odysee-legacy-auth@1.0` and `~odysee-upload-demo@1.0`

## Remaining Tracks

This is intentionally a small authenticated write proof. The next pieces are:

- production verifier wiring for legacy `user/me` or a smaller internal auth verifier
- TEE or trusted-node attestation before real bearer-token forwarding to a remote node
- large binary/chunked upload routing while preserving native HyperBEAM content refs
- moving the page-1 demo merge into a production-grade paginated native upload index
- wallet binding so a verified legacy account can move from hosted auth to user-owned Arweave signing
