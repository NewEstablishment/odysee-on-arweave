# HyperBEAM Call Demo Goal

Goal for the June 26 call: show that the migration path can use a pasted Odysee auth token locally, resolve the user's real owned channels, store a new upload natively in HyperBEAM with Odysee metadata, and render that new upload alongside legacy Odysee claim IDs without touching production publish/upload systems.

## Demo Path

1. Open the local frontend at `http://127.0.0.1:9090/`.
2. Open the Odysee request log in the lower-right corner.
3. Leave mode on `HyperBEAM`.
4. Paste a valid Odysee `auth_token` into the password field.
5. Click `run call demo`.

The result should show green checks for:

- `tokenValidated`
- `ownedChannelsResolved`
- `nativeUploadStored`
- `uploadReadbackMatched`
- `mixedChannelResolved`
- `nativeUploadResolved`
- `searchDeviceUsed`
- `recsysDeviceUsed`

## What To Say

- Auth-required work goes through the local authenticated HyperBEAM path.
- Public search/recommendation work goes through the separate `odysee-search@1.0` device.
- New uploads are native HyperBEAM uploads, not Odysee blobs or sd_hash descriptors.
- Upload metadata stays attached to the native item: title, description, tags, thumbnail URL, filename, content type, size, and sha256.
- Channel resolution can carry both legacy claim IDs and native HyperBEAM upload IDs.

## Evidence In The Result

- `ownedChannels` contains the real channels returned by Odysee `channel_list`.
- `selectedChannel` is the owned channel used for the native upload.
- `legacyClaims` contains legacy stream claims already on that channel, when available.
- `upload` contains the native HyperBEAM upload ID and metadata.
- `channel` contains `legacy-claim-ids`, `hyperbeam-upload-ids`, and typed `content-ids`.
- `nativeClaim.value.source` contains `hyperbeam_upload_id` and `hyperbeam_body_path`, not `sd_hash`.
- `searchBoundary.poweredBy` should be `hyperbeam`.
- `recsysBoundary.gid` should be `hyperbeam-demo`.

## Safety Boundary

This demo validates the auth token against Odysee `user/me` and reads legacy channel/search data. It does not call production Odysee publish, wallet, S3, blob, or account mutation APIs. The write is to the local HyperBEAM filesystem store only.

## If The UI Is Awkward

The same flow is available from the browser console as:

```js
window.odyseeHyperbeamCallDemo()
```

Use this only after pasting the token into the debug console once, or pass the token directly for local testing.
