# Odysee analytics device

The Odysee-specific analytics device will build on the generic `analytics@1.0`
implementation while keeping Odysee view qualification separate from generic
page visits.

## First contract

Events use the generic `subject-id` field supplied by the integration layer. The
device does not interpret its format.

For the Odysee adapter, the existing live HyperBEAM response shows two cases:

- legacy claim: stable logical `claim-id`; current edited revision is `txid:nout`
- native upload: stable logical `record-id`; current media bytes are `data-id`

The revision/outpoint and media ID are event metadata, not the analytics subject.

- `start`: a playback session begins after the player reports `playing`
- `heartbeat`: periodic playback position/duration update
- `pause`: playback pauses
- `end`: playback session ends

A view session has a random in-memory `view-id`, a server-side record, and a
monotonic playback position. The server rejects impossible regressions,
excessive durations, unknown sessions, and events for a different video.

Reports keep separate counters:

- `raw-plays`: accepted playback starts
- `qualified-views`: sessions meeting the configured minimum playback evidence
- `suspicious-plays`: sessions failing validation or triggering abuse limits

This is an anti-inflation signal, not proof that a human watched a video. Raw
events remain auditable; qualification rules must be versioned and visible in
reports.

## Cutover model

This is a hard cutover from legacy Odysee analytics to HyperBEAM. There is no
long-term dual-write path.

Before cutover, export one versioned baseline mapping each legacy logical claim
identity to its analytics `subject-id`. Preserve the cutover timestamp and the
current revision/outpoint as audit metadata; the outpoint is not the subject key.

After cutover:

- legacy counts are read-only baseline values;
- HyperBEAM records only post-cutover playback events;
- reports show `baseline + qualified post-cutover views`;
- every event is idempotent by `(subject-id, view-id, event)`;
- no browser request writes to both legacy analytics and HyperBEAM.

## Boundaries

- Generic `analytics@1.0` remains reusable for ordinary page analytics.
- Odysee playback identity and qualification belong to
  `odysee-analytics@1.0`.
- After cutover, the browser sends events to the configured HyperBEAM node
  rather than the legacy Watchman endpoint.
- Account/wallet identity, if used later, is an additional signal and never the
  sole definition of a view.
