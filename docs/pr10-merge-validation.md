# PR #10 master integration — 2026-09-17

Merged master `8c6b0d4` into `feat/encrypted-private-playlists` at `47b8df9`.
This is a normal merge; neither branch history nor immutable content is rewritten.

## Resolution decisions

- Keep the PR's generic server-ranked channel/Following discovery, exact
  hydration, verified upload projection and transient-read cache eviction.
- Retain master's native notifications, homepage/category continuation,
  query-scoped loading and immutable outpoint store routing.
- Preserve native signing-channel URLs during upload hydration. The first
  browser run caught an automatically merged change replacing them with generic
  immutable URLs, which hid Follow after unfollow. Legacy outpoints retain their
  immutable routing.
- Keep explicit discovery continuation even when some search locators cannot
  hydrate. Release the merged visible-tile pagination wait for completed ranked
  pages, while preserving snapshot/category target-fill behavior.
- Extend Following acceptance to three pages with unavailable locators on both
  full pages; retain sort, empty-page, unfollow and refresh coverage.

## Validation

- Backend compile and all 371 device/core tests pass.
- TypeScript, frontend checks (six existing warnings), native contract suites,
  Following regressions, homepage materializer tests and static-manifest
  contracts pass.
- The production bundle and static-manifest asset validation pass using the
  existing generated homepage input.
- All four Chromium checks pass on the final isolated `:18812` manifest
  `b6sLSj91mY_gLB7BnsOVPEvzz6YQtMaGlqtGPLXGBgs`: three-page Following,
  private/public playlist deletion with offline retry and exact history, and
  profile metadata/images with identity and authorization checks. Discovery is
  controlled in the Following test; the browser uses real signed node messages.
- Full `build:manifest` homepage regeneration is blocked on the isolated test
  node: search returns no immutable locators. This does not certify a fresh
  homepage generation against a populated production index.
- The separate EUnit runner times out in the existing analytics authentication
  fixture; it is not a pass.
- Live mixed legacy/native search acceptance still needs a populated source
  index. Controlled discovery tests do not certify live legacy sourcing.
- Master's notification notes already record a reload/read-receipt account
  race; passing notification contracts do not close that browser issue.

No production deployment or merge into master is performed by this validation.
