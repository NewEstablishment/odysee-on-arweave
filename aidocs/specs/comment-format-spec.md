# Comment Format Specification

Status: **implemented** — this documents the behavior in the current tree
(`odysee-frontend/ui/util/hyperbeam.ts`, `ui/util/nativeCommentControls.ts`);
it is a description of reality, not a proposal. Divergences from the playlist
spec are listed at the end as alignment work.

## 1. The comment message

A plain committed message, written through the generic commit path
(`POST ?!=true` → `auth-hook@1.0` → `persist@1.0`). No comment device exists;
`odysee-comment@1.0` in the `schema` field is a format label only.

| Key | Type | Rule |
| --- | --- | --- |
| `type` | `comment` | Query selector. |
| `schema` | `odysee-comment@1.0` | Query selector; versioned. |
| `claim-id` | 40-hex | The target content's claim id. (`target` is unusable — reserved by the HTTP hook layer.) |
| `parent` | `root` \| comment id | Thread position selector. |
| `parent-id` | ID | Parent comment for replies. |
| `author`, `channel-id` | 40-hex channel id | The authoring channel. |
| `channel-name` | binary | Display name at write time. |
| `comment` | binary | The text. Required. |
| `state` | `active` \| … | Projection filter. |
| `channel-signature`, `signing-ts` | binary | Legacy channel signature (`channel_sign`) over the comment; verified against channel evidence. |
| `timestamp` | unix int | Display metadata only, never ordering. |
| `support-amount`, `support-tx-id`, `sticker`, `mentioned-channels`, `is-protected`, `replies`, `is-pinned` | misc | Product metadata. |

## 2. Revisions (edits)

Append-only, same law the playlist spec adopted from here:

| Key | Rule |
| --- | --- |
| `revision-of` | Logical root comment ID. |
| `previous-version` | Physical message ID of the prior revision. |
| `revision` | Monotonic counter from 0. |
| `updated-at`, `revision-timestamp`, `operation: edit` | Display metadata. |

Current view accepts only a contiguous, same-author, signature-valid chain.

## 3. Controls (moderation)

Channel-owner actions are append-only `odysee-comment-control@1.0` messages
(hide, pin, creator-heart, creator-channel-block), targeted via
`claim-id`/`target-id`. The latest valid, *authorized* control event wins;
the original comment is never mutated. Historical Commentron data merges at
the read boundary and is being retired.

## 4. Discovery and projection

One target-wide `~query@1.0/only` request with selectors
(`schema`, `type`, `claim-id`/`author`, `state`) returns message paths;
the client hydrates and projects: logical-root dedup, latest-valid-revision
selection, hierarchy, counts, sort, pagination, control application.

## 5. Alignment gaps vs the playlist spec

1. `claim-id` (target) and `author`/`channel-id` are 40-hex legacy ids;
   playlist rule says immutable IDs with legacy ids as resolution keys only.
   Comments should adopt the same rule in one sweep (playlist spec, open
   decision 6).
2. `timestamp`/`updated-at` ride in the message; they are display-only today
   but the spec should state that explicitly to keep them out of ordering.
3. Ownership still rides legacy `channel_sign` — replaced by native creator
   authority when the auth workstream lands (shared caveat).
4. No `title`-style canonical-payload definition is written down for the
   signature; pin the exact signed bytes alongside the playlist decision.
