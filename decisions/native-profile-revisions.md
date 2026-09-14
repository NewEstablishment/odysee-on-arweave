# Native profile metadata revisions

The original signed `type: channel` message remains the profile identity and
authority root. Its name is the stable handle, not editable display metadata.
Do not replace this ID on edits: comments, subscriptions, uploads and playlists
already bind to it. Authentication, Google linking and account recovery are
separate workstreams (Ayush); this feature uses the existing verified owner.

Display name (`title`), bio (`description`), avatar and banner change through
generic signed `odysee-profile-revision@1.0` full snapshots. Each snapshot has
`profile-id`, exact `previous-version`, and a contiguous positive `revision`.
The original profile is revision zero. Writes use `/id?0.%21=true&committers=all`;
discovery uses exact `query@1.0` selectors, followed by verified immutable reads.
No profile device, legacy `channel_update`, new authentication endpoint, or
reference-identity migration is required.

Projection accepts only same-root, same-committer contiguous chains. Gaps,
foreign writers, stale predecessors and conflicting siblings cannot advance
the profile. Equivalent commitment aliases collapse. A genuine fork stops at
the last unambiguous state; automatic fork repair is outside this slice.
Save uses a node/profile queue plus Web Lock, an expected-head check and exact
readback. Reverified locator hints bridge acknowledged query-index lag. This
is not a cross-device atomic compare-and-swap guarantee.

Friendly channel routes and the owner's channel list project current metadata.
Exact root and revision reads remain historical; `/$/id/<revision-id>` verifies
ancestry without replacing the selected version with a later snapshot. Account
hints and authority-bearing messages continue using the original handle/ID.
Existing committed author fields are not rewritten by a display-name edit.

Images reuse generic thumbnail byte writes. The editor accepts PNG, JPEG and
WebP with matching byte signatures, successful decoding, at most 5 MiB, and
dimensions at most 8192 × 8192. Snapshots contain immutable image IDs, never
browser File objects, arbitrary URL schemes, cookies or keys. Image selection
uploads public bytes immediately; Save attaches them to the profile. Cancel
does not erase uploaded bytes, and replacing/removing images cannot revoke
historical public snapshots. The editor explains this explicitly.

Validation commands: `pnpm run test:native-profiles`, frontend baseline checks,
and `HYPERBEAM_MANIFEST_URL=<isolated manifest> pnpm exec playwright test
--project=chromium tests/specs/native/hyperbeam-profile-edit.spec.ts --workers=1`.

Local acceptance (2026-09-14): profile/related frontend contracts, TypeScript,
lint (six pre-existing warnings), manifest build, all five cookie social
lifecycles, and Chromium profile editing/deletion regressions pass. Browser
coverage includes invalid images, failed-save retry, field/image clearing,
refresh, fresh readers, signed foreign/stale revisions and exact history.
Backend suites were not rerun for this frontend-only feature; no production
deployment or Google authentication changes are included.

The previous isolated node on 18811 exhausted its 256 MiB LMDB map during
testing. A fresh node on 18812 uses separate 2 GiB cache maps and private wallet
storage; the old data was not deleted. Runtime config discovery currently
splits at the first dot in a path, so avoid dotted parent directories for
`HB_CONFIG`. These are local test-environment findings, not feature dependencies.
