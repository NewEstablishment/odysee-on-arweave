# Proposed upstream HyperBEAM changes

Nothing in this repository depends on these landing; the system runs on
stock nodes today. Any proposal beyond this list must take the form of a
terse (<= 20 lines, test + fix) branch on a HyperBEAM worktree, and only
for defects that are demonstrably HyperBEAM's, not this application's.

## 1. `hyperbeam-is-id-lbry-claim-ids.patch`

Extend `?IS_ID` to accept 40-character (20-byte hex) LBRY claim IDs, so
bare `GET /<claim-id>` resolves as a single-ID store read. Applies
cleanly to current `edge` (`git apply --check` verified). Without it,
claim reads use `GET /~cache@1.0/read?read=odysee/claim-id/<id>`, which
works on stock nodes unmodified.

## 2. RFC-7233 Range support for binary responses (described)

The HTTP layer ignores `Range` request headers, so large binaries
(video, audio) always arrive as full-body 200s; browsers treat such
media as unseekable. Native byte-range slicing in `hb_http:encode_reply`
(206/`Content-Range`/`Accept-Ranges`) would give every HyperBEAM-served
binary browser-grade seeking with no application code.
