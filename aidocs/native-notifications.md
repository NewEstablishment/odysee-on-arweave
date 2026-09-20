# Native in-app notifications

Implemented on `codex/native-notifications`, starting from master `8f5623e`.

## Behavior

The header bell and notifications page show replies to the viewer's native
comments and new uploads from native channels whose subscription bell is on.
The page supports All, Replies, and New uploads filters, mark all as read,
individual read actions, and dismissal. Links retain the exact content identity
and the logical comment reference. Signing out clears the private inbox.

New follows still default to notifications off. Upload notifications start at
the current uninterrupted bell opt-in; disabling the bell or unfollowing removes
that channel's uploads from the projection. Re-enabling starts a new interval.
Upload timestamps have second precision, so the opt-in boundary is rounded to
that precision. Replies cover existing eligible native replies as well as new
ones; self activity, deleted/hidden/blocked comments, suppressed ancestors, and
restricted targets are excluded. Upload edits are not new-upload notifications.

The app refreshes on focus, when becoming visible, and every 30 seconds while
visible. Concurrent inbox refreshes share a request. Existing source query
caches can add up to another refresh interval before new activity appears.

## HyperBEAM contract

The inbox is a projection of existing committed messages. Generic
`query@1.0/only` discovers candidates; exact commitment verification and
verified committers establish authority. The adapter reuses the existing
comment revision/moderation and subscription projections. A channel profile
and its upload must have the same verified owner; claimed profile fields and
query results are not authority.

Read, seen, and dismissed state uses append-only
`odysee-notification-receipt@1.0` messages with type `notification-receipt` and
signature scope `native-notification-receipt-v1`. Public fields contain the
AES-GCM envelope, owner selector, and update time. Plaintext contains the same
schema, active profile ID, operation, and notification IDs. Stable IDs are
`reply:<logical-comment-reference>` and `upload:<immutable-upload-ID>`.

The existing authenticated `odysee-preference@1.0` seal/open boundary supplies
cryptography only. Receipts are ordinary cookie-signed messages written through
`/id?0.%21=true&committers=all`; they are separate from the shared preferences
blob. Exact readback verifies the committer, envelope, profile, and plaintext
before acknowledging a save. No custom notification device, fan-out database,
mutable inbox object, or legacy notification service is involved.

Receipt operations form a union: read also implies seen, and dismiss implies
both read and seen. Independent tabs therefore cannot overwrite each other's
acknowledgments. Acknowledged receipts remain in memory through query indexing
lag; account changes discard that cache and invalidate in-flight work. Redux
notification state is not persisted to browser storage. Loading and save
failures surface in the UI rather than silently falling back to a legacy API.

## Limits

- This is in-app polling, without browser push, email, legacy import, or legacy
  channel upload notifications.
- State belongs to the current node-hosted cookie identity. Cross-device account
  recovery remains dependent on the migration's identity work.
- Receipt batches contain at most 200 IDs. Discovery hydration is bounded to
  four workers per source collection and errors above 10,000 paths per batch;
  it does not silently truncate an inbox. There is no receipt compaction or
  notification pagination yet, so long-lived/high-volume accounts need a later
  performance pass.
- Current native upload edit/delete support is limited by master. This change
  does not introduce another upload revision contract.

## Validation

Earlier implementation validation passed:

- Ten focused projection, bell-transition, authority, moderation, encryption,
  multi-tab receipt union, index-lag, concurrency, batching, error/readback, and
  account-switch tests: `pnpm run test:native-notifications`.
- TypeScript type check and frontend check (zero errors; six existing warnings
  in unchanged livestream code).
- Existing native comment revisions, message verification, comment controls,
  reactions, playlists, subscriptions, preferences, homepage materialization,
  and static-manifest regression suites.
- Existing live cookie-owned comment, reaction, playlist, subscription, and
  preference lifecycle suites against the isolated local node.
- The real-node Playwright workflow: account creation, bell follow, upload and
  reply discovery, verified authors, rendered filters, mark all read, header
  dismissal, receipt persistence after reload, comment links, and sign-out.
- Backend compile/device preload and production frontend bundle compilation.
- `git diff --check`.

Demo revalidation on September 16, 2026 passed all ten focused notification
tests, TypeScript, the frontend check (zero errors and six existing warnings),
and `git diff --check`. The interactive demo displayed a signed upload and a
reply notification. However, the real-node Playwright workflow failed twice
after reload with `The notification account changed. Please retry.` during
the read-state persistence check. That failure remains unresolved; the current
browser lifecycle cannot be reported as passing. The sample video also failed
playback in the embedded demo browser.

The full `build:manifest` command was attempted but stopped during homepage
materialization: the isolated node has no populated search index, so search
returned no immutable locators. The standalone production bundle compiled;
a published production-manifest lifecycle still needs the configured populated
search backend. Backend EUnit/core device suites were not run for this
frontend-only change.

## Reproducing the browser test

Use a disposable local node with cookie auth, generic query/write support,
match indexing, and the existing preference seal/open device. The test creates
two accounts and immutable fixtures. With the node running, start Vite in
`odysee-frontend/`:

```sh
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18809 HYPERBEAM_STATIC_MANIFEST=true pnpm exec vite --host 127.0.0.1 --port 1337
```

In another terminal in that directory:

```sh
BASE_URL=http://127.0.0.1:1337 HYPERBEAM_BASE_URL=http://127.0.0.1:18809 pnpm run test:native-cookie-notifications
```

Install the Playwright Chromium version expected by the repo, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing compatible browser executable.
`NOTIFICATION_SCREENSHOT` optionally saves the rendered inbox screenshot.

The browser harness forwards native same-origin requests to the real node and
loads actual frontend modules and the React app from Vite. It does not mock
account, content, query, verification, encryption, or receipt data. Vite HMR
client errors caused by the synthetic manifest path are excluded from its app
error assertion; other uncaught app errors fail the test.
