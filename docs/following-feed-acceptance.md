# Following-feed acceptance

## Contract

Follow relationships remain owner-verified `odysee-subscription@1.0` events.
Following supplies native profile IDs and full legacy channel claim IDs together
to one generic `search@1.0` request. The index applies channel selectors, ordering,
limit and offset; exact immutable hydration preserves that discovery order.
Do not concatenate independently ranked native and legacy pages or post-filter
ranked pages in React.

The integration response carries `has_more` based on discovery, not the number
of successfully hydrated records. Redux retains the completed discovery page;
the list and scroll trigger use this metadata even when missing evidence leaves
a short or empty visible page. Existing callers without this metadata retain
their previous count-based behavior. Following remounts its list when the set of
followed IDs changes, resetting pagination and previous-list display state.
New sort/filter criteria also start at page one when they have no cached result,
including hash/POP navigation; cached sparse results restore their recorded
discovery page rather than inferring it from the visible item count.

## Regressions

`pnpm run test:following-feed` executes the actual search integration function
and search-completed reducer with controlled native/legacy channel fixtures.
It checks interleaved newest/oldest order, asynchronous hydration order,
page boundaries despite unavailable locators, exhaustion, changed channel
selectors after unfollow and repeated refresh. These fixtures do not establish
LBRY source verification or live search-engine correctness.

`HYPERBEAM_MANIFEST_URL=<isolated-manifest> pnpm exec playwright test
--project=chromium tests/specs/native/hyperbeam-following.spec.ts --workers=1`
uses real node-signed profiles, uploads, follows and unfollows. Only generic
search discovery is intercepted with a controlled ordered locator corpus.
The previous manifest fails by never requesting page two after one unavailable
locator shortens the first page. Browser testing additionally reproduced a
sort change retaining page two and skipping the first results. The test checks
feed ordering, refresh and
unfollow persistence. It creates synthetic records on the configured node;
run only against an isolated test node.

Final local Chromium run on 2026-09-14: PASS, including a partially unavailable
page, an entirely unavailable first page (without scrolling), chronological
ordering changes, follow/unfollow writes and refreshed feed state. Manifest:
`DakkQY3sRN-ASlk4-bx7fzUu9bsZ8IoVUEw2ZspXw10` on isolated node `:18812`.

TypeScript, formatting/lint (six pre-existing warnings), manifest build, the
frontend contract suites and signed-cookie subscription lifecycle pass locally.
Backend suites were not rerun: this slice changes only frontend integration,
Redux/list state and test/documentation files.

September 17 master integration: Chromium passes with 66 uploads across three
pages and missing locators on both full pages. Completed ranked pages release
the category continuation's visible-tile wait. Native signing-channel URLs
remain channel URLs after upload hydration, keeping Follow available after
unfollow. See [merge validation](pr10-merge-validation.md) for the broader checks
and remaining environment limits.

## Remaining live acceptance

The local 18812 validation node has local stores only, with no running populated
search backend or legacy source stack. Full mixed-source acceptance requires a
configured node and search index containing known legacy channels/outpoints and
verified native upload projections. Rehearse follow both, newest/oldest ordering,
multiple pages, unfollow each, reload, missing-source recovery and index lag on
that exact release manifest. Do not label controlled fixtures a completed legacy
migration or a production-scale acceptance test.

Exact totals, stable tie ordering under concurrent index changes, Top/Trending
ranking parity and search failover are not certified by this chronological-feed
slice. No Google authentication, custom device or legacy browser API is added.
