# Playlist deletion through generic references

Deletion is an owner-signed `odysee-playlist-deletion@1.0` snapshot followed
by an ordinary `reference@1.0` set pointing to that snapshot. There is no
playlist deletion device, storage mutation, or legacy collection API call.

The marker contains only schema/type, reference/profile IDs, exact previous
reference message ID, deletion timestamp and deleted state. It contains no
title, item list, thumbnail, private plaintext or key material. Private playlist
deletion has the same publicly observable terminal marker as public deletion;
the existence/owner of the reference was already public.

The set commits `playlist-state: deleted` and `previous-reference`. Readers
verify the init, set and marker independently, bind all three to the init
committer, and require matching reference/profile IDs and timestamps. A valid
delete must be strictly newer and name the projected head as its predecessor.
Foreign writers, foreign markers, stale predecessors and conflicting timestamp
ties cannot delete a playlist. A selected deletion is terminal in the product
projection; subsequent reference sets cannot restore it. Generic reference
device behavior is unchanged: the product projection owns this terminal rule.

Save/delete share an integration-layer queue and Web Lock. Reverified locator
hints retain acknowledged reference updates through index lag and reload.
Other readers converge when their query index observes the update. This is not
cross-device compare-and-swap: conflicting concurrent saves/deletes can require
a retry against the newly observed head. Ambiguous transport failures must not
be presented as verified success.

Libraries exclude terminal references and their historical snapshot IDs. The
stable URL renders a metadata-free deleted state, including for signed-out
readers of a previously private playlist. Exact old snapshot URLs remain
addressable: public snapshots stay public, and private snapshots still require
the same owner wallet. Deletion does not erase bytes or revoke copies/keys.
Built-in local lists cannot be deleted through this operation. Old standalone
snapshots without a stable reference are not deletion targets.

The confirmation requires the playlist name for saved lists, explains the
history limitation, and removes local state only after exact verified readback.
Errors retain the confirmation and show a retryable error. The UI does not offer
restore or public-to-private conversion.

Offline retry: unavailable owner/reference evidence must never be cached as a
successful negative read. Shared native reads deduplicate in-flight requests and
cache successful values, including empty query lists, but evict null/undefined
results and errors. A stale completion cannot evict a newer cache entry. The
deletion guard distinguishes unavailable verification from a verified foreign
owner; neither can authorize a write. Retry re-reads evidence without a reload
or waiting for the 30-second TTL. Google authentication and node storage policy
are unchanged.
The offline status banner is loaded with the app: lazy-loading it on the first
offline event suspended the UI while its chunk was unreachable, hiding the
confirmation. Offline recovery must not require downloading its own UI.

Validation: `test:native-playlists`, `test:native-cookie-playlists`, and
`tests/specs/native/hyperbeam-playlist-deletion.spec.ts` cover the contract and
private/public browser lifecycle. Set `HYPERBEAM_MANIFEST_URL` for browser tests.

Local acceptance on 2026-09-14: frontend contract suites, TypeScript, manifest
build and formatting/lint pass (six pre-existing warnings). Isolated signed-cookie
lifecycles pass for playlists, comments, reactions, subscriptions and preferences.
Chromium checks cover private/public deletion, library and stable-URL refresh,
fresh readers, exact historical access, and retry after a failed reference write.
That original write-503 test did not cover offline preflight. The added browser
regression expires warm reads before going offline, asserts no write and a
retryable verification message, then reconnects and requires completion within
30 seconds without reloading, for both private and public playlists.
No backend source changed; backend suites were not rerun for this slice. This
does not certify production deployment, replication or physical data removal.
