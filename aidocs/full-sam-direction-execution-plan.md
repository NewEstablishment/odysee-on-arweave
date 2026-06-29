# Full Sam-Direction Execution Plan

Source: 2026-06-29 transcript, with Sam's comments treated as the definite direction.

## Objective

Move Odysee-on-HyperBEAM from a demo that uses custom bridge devices toward a store-first architecture where normal HyperBEAM auth signs writes, generic reads resolve both native and legacy IDs, and query/discovery progressively move into store-backed primitives.

## Checklist

### Phase 1: Native Auth And Upload Loop

- [x] Use Odysee cookie/header tokens through the existing HyperBEAM auth-hook path.
- [x] Prove signed upload writes do not persist auth-token fields.
- [x] Read native upload bytes through `~cache@1.0/read?read=<id>`.
- [x] Render a native upload in the frontend through the SSR read route.
- [x] Add reusable smoke coverage for upload, readback, index/list, and browser render.

### Phase 2: Generic Legacy Read Fallback

- [x] Add `hb_store_odysee` to the default store stack after local stores and before network gateways.
- [x] Normalize raw 40-byte Odysee claim IDs to `odysee/claim-id/<id>`.
- [x] Prove `~cache@1.0/read?read=<claim-id>` returns a signed legacy claim.
- [x] Add focused store coverage for bare claim ID reads.
- [x] Route frontend claim-ID resolve paths through generic cache reads when a claim ID is available.

### Phase 3: Store-Backed Query And Discovery

- [x] Implement the first `hb_store_odysee:list/3` surface for channel uploads by channel claim ID.
- [x] Add focused tests for the channel upload list surface using fixtures.
- [x] Expose a generic HTTP smoke for `~cache@1.0/list?list=<channel-id>/claims`.
- [x] Route frontend channel `claim_search` calls through generic cache list/read when `channel_ids` are available.
- [x] Keep broad fuzzy/full-text search as explicitly out of scope until there is a dedicated indexing design.

### Phase 4: Custom Device Retirement

- [x] Inventory each Odysee device still used by the frontend and mark it as store read, computation, authenticated mutation, or legacy-only.
- [x] Replace read-only device calls with generic store reads/lists wherever the store now supports the shape.
- [x] Keep authenticated account/comment/preference mutations on devices until there is a generic signed state-transition path.
- [x] Define what behavior `~odysee-upload@1.0` provides that generic `~cache@1.0/write` does not.
- [x] Block removal of `~odysee-upload@1.0` until a generic user-writable signed upload route exists.

### Phase 5: Media And Range Semantics

- [x] Keep the current demo media shape as a HyperBEAM upload manifest with chunk IDs until the final storage shape is decided.
- [x] Add range-read semantics for native uploaded media in the SSR read route.
- [x] Validate range behavior through the reusable upload smoke.
- [x] Document that final native media shape remains blocked on an architecture decision.
- [x] Document the verification tradeoff for partial reads versus full-object verification.

### Phase 6: Production Auth Shape

- [x] Document same-origin production deployment so cookies can flow directly to HyperBEAM.
- [x] Keep localhost auth shims as development-only support until production routing is decided.
- [x] Define migration behavior as blocked pending the existing-user, anonymous-user, and new-user key model decision.

## Current Execution Focus

Phases 1 through 4 are now executed to the point that is possible without making an architecture decision that Sam explicitly left open. The remaining executable work is Phase 5 and Phase 6, but both depend on choosing the native media object/chunk shape and the production auth/migration shape.

## Execution Notes

### Generic Read And List Paths

- `hb_store_odysee` is in the default store stack after local stores and before Arweave/gateway stores.
- Raw 40-character claim IDs resolve through the store as `odysee/claim-id/<id>`.
- `dev_cache:list/3` exposes store lists through `~cache@1.0/list`.
- `hb_store_odysee:list/3` supports channel claim lists through `<channel-id>/claims` and `odysee/channel-id/<channel-id>/claims`.
- Node and browser frontend helpers now try `~cache@1.0/read` for concrete claim-ID resolves.
- Node and browser frontend helpers now try `~cache@1.0/list` plus `~cache@1.0/read` for channel-scoped `claim_search` calls.

### Device Inventory

| Device | Current classification | Retirement status |
| --- | --- | --- |
| `~odysee-claim@1.0` | Legacy read/search/transaction computation | Partially replaced for concrete claim-ID reads and channel-ID lists. Still needed for URI-only resolve, broad search, and transaction/proof paths. |
| `~odysee-stream@1.0` | Playback/media computation | Still needed until native media storage and range semantics are decided. |
| `~odysee-channel@1.0` | Channel normalization/signing-channel computation | Still needed behind store-backed channel reads and comment attribution until generic channel state exists. |
| `~odysee-account@1.0` | Authenticated user state mutation/read | Kept deliberately. Preferences/settings need a signed mutable-state path before removal. |
| `~odysee-comment@1.0` | Authenticated comments, moderation, comment reads | Kept deliberately. Comment writes need generic signed state transitions before removal. |
| `~odysee-file@1.0` | View counts | Kept as aggregate/application state, not a pure object read. |
| `~odysee-file-reaction@1.0` | File reaction state | Kept as aggregate/application state. |
| `~odysee-reaction@1.0` | Comment reaction state | Kept as aggregate/application state. |
| `~odysee-subscription@1.0` | Subscription count state | Kept as aggregate/application state. |
| `~odysee-upload@1.0` | Authenticated upload session, chunking, finalize, index/list | Kept until generic signed write can cover session ownership, chunk manifests, index updates, and upload listing. |
| `~odysee-stream-descriptor@1.0` | Legacy descriptor translation | Backend legacy compatibility only. Not a retirement priority until media shape changes. |
| `~odysee-blob@1.0` | Legacy blob translation | Backend legacy compatibility only. Not a retirement priority until media shape changes. |
| `~odysee-claim-proof@1.0` | Legacy proof verification | Backend legacy compatibility only. Keep for verifiable legacy reads. |
| `~odysee-product-events@1.0` | Frontend utility listing for product-event style calls | No server implementation found in this tree during inventory; not part of current generic store path. |

### Why `~odysee-upload@1.0` Cannot Be Removed Yet

Generic `~cache@1.0/write` can write cache/store data for trusted writers, but it does not currently provide the user-facing upload behavior that the frontend needs:

- Authenticated user ownership through the auth hook.
- Session-level chunk writes.
- Finalization into a media manifest.
- Indexing uploaded claims by user/channel.
- Listing uploaded native publishes for the UI.
- Guardrails that prevent auth tokens from being persisted.

The current direction is therefore to keep `~odysee-upload@1.0` as the temporary upload state-transition device while reads and discovery move to generic store interfaces.

### Blocked Architecture Items

- Native media final shape is not decided. The choices discussed were single object, larger chunks, Arweave-aligned chunks, and LBRY-compatible chunks. Current code keeps the manifest/chunk shape and supports HTTP range responses against it.
- Production auth deployment direction is same-origin HyperBEAM so cookies flow directly to the node. The localhost auth bridge remains a development shim until production routing is decided. Existing users, anonymous users, and new users still need a concrete migration/key model.
- Broad fuzzy/full-text search remains out of scope. Store-backed exact lookup/listing is now implemented; fuzzy discovery needs a dedicated indexing design.

### Media Range Status

The SSR route `/$/api/hyperbeam-upload/v1/read/:id` now supports byte ranges for native chunk-manifest uploads:

- Full reads still return `200`.
- Valid `Range: bytes=start-end` reads return `206`, `Accept-Ranges: bytes`, `Content-Range`, and the exact requested byte slice.
- Invalid ranges return `416` with `Content-Range: bytes */<size>`.
- The implementation fetches and slices current HyperBEAM chunks. That gives browser/player seeking behavior for the current demo shape without pretending that partial reads independently verify the full object.

Verification rule: a node can verify the full stored object/chunks when synchronizing. A browser range response is a trusted served slice from that already-stored object, not an independently complete object verification proof.

### Production Auth Direction

Production should make Odysee itself a HyperBEAM-served same-origin surface, or route HyperBEAM behind the same site origin, so the existing `auth_token` cookie can be consumed by the auth hook without cross-domain cookie workarounds.

Localhost/demo behavior can keep the current proxy/manual-token shim because local development cannot naturally receive `odysee.com` cookies. That shim should not be treated as the production architecture.

Migration remains a product/security decision:

- Existing logged-in users can initially be mapped from the current Odysee auth token to their existing wallet/key association.
- Anonymous users can keep a generated local identity for the first prototype.
- New users should probably receive a HyperBEAM-native key identity, while legacy ECDSA wallet keys are imported only where needed.
