# Reactions

Odysee reactions combine two independently verifiable layers:

1. Native likes and dislikes are cookie-signed `odysee-reaction@1.0`
   messages written through the generic stage-scoped `/id` route.
2. Historical reactions are imported from an authoritative database export as
   node-signed generic messages. The public legacy reaction API is not an
   import source because it exposes aggregate totals, not the contributing
   user records.

No reaction application device is involved. Discovery uses `query@1.0`, exact
messages are hydrated normally, and the frontend verifies every commitment
before projection.

## Historical import contract

The importer consumes a complete point-in-time export:

```json
{
  "snapshot-at": 1788940800000,
  "source": "legacy-odysee-db",
  "reactions": [
    {
      "user-id": "12345",
      "claim-id": "0123456789abcdef0123456789abcdef01234567",
      "subject": "content",
      "reaction": "like",
      "updated-at": 1788937200000,
      "native-owner": "optional-43-character-hyperbeam-owner"
    }
  ]
}
```

`snapshot-at` and `updated-at` are Unix milliseconds. `subject` defaults to
`content` and may also be `comment`. The export must include every currently
active reaction. Missing records are interpreted as removals relative to the
checkpoint. Imports must be ordered by `snapshot-at`. An older snapshot, or
changed input that reuses the checkpoint's timestamp, is rejected.

The operator invokes the importer in the running node's Erlang environment:

```erlang
hb_odysee_legacy_reactions:import_file(
    "/run/odysee/legacy-reactions.json",
    "/run/secrets/legacy-reaction-hmac",
    "/var/lib/hyperbeam/legacy-reactions.checkpoint"
).
```

The HMAC secret must contain at least 32 bytes and must remain stable for every
incremental export. Raw legacy user IDs are never written to HyperBEAM or to
the checkpoint. They become opaque stable `legacy-user-ref` values first.

For each change the importer writes an append-only
`odysee-legacy-reaction@1.0` record. It also writes one compact
`odysee-legacy-reaction-summary@1.0` message per affected target, containing
the totals and any authoritative legacy-to-native owner mappings. Unchanged
rows produce no messages. A deleted row produces a contiguous removal record
and a replacement summary.

The node wallet signs imported records and summaries. The frontend accepts a
historical summary only when its verified committer is the address reported by
that HyperBEAM node. Conflicting summaries at the same `snapshot-at` fail
closed.

## Identity and counting

An aggregate count cannot establish which user reacted. Exact migration needs
an authoritative mapping from a legacy user to a native HyperBEAM owner. When
that mapping is present in the export, the summary carries it as a node-attested
link. The mapping is one-to-one and permanent across checkpoints. A later
import cannot move either principal to another identity. Once established, the
importer applies that mapping to all rows for the legacy user, so later exports
do not need to repeat `native-owner` on every row.

Projection follows these rules:

- An unlinked legacy reaction contributes once to the historical total.
- A linked legacy reaction is shown as the native owner's current reaction
  until that owner writes a native event for the same target.
- The first native set, switch, or removal supersedes the linked historical
  state, so the user is never counted twice.
- A removed native root is valid only as an inert state. It exists so a user's
  first native action can remove an imported reaction without manufacturing a
  temporary active reaction.
- If no authoritative identity mapping exists, the importer leaves the legacy
  principal unlinked. The application does not guess identity from profile or
  channel metadata.

The current Odysee account system does not itself provide the legacy-to-native
mapping. Supplying `native-owner` therefore requires a separate, authoritative
account-link export or a future dual-authentication flow. This limitation is
explicit: inferred mappings would allow one user to suppress another user's
reaction.

## Legacy database export

The first-party legacy database stores one row per user and publication. A
full export can be produced from `reaction`, `reaction_type`, and `publish_v2`:

```sql
SELECT
  CAST(r.user_id AS CHAR) AS user_id,
  p.claim_id,
  rt.name AS reaction,
  UNIX_TIMESTAMP(r.updated_at) * 1000 AS updated_at
FROM reaction AS r
JOIN reaction_type AS rt ON rt.id = r.reaction_type_id
JOIN publish_v2 AS p ON p.id = r.publish_new_id
WHERE rt.name IN ('like', 'dislike');
```

The export pipeline must wrap these rows with one fixed `snapshot-at`. It may
add `native-owner` only from an authoritative identity table or attestation.
Do not derive it from display names, email hashes, claimed channels, or browser
state.

Run imports serially. Keep the input export, HMAC secret, checkpoint, and node
wallet outside the repository and protect them as credentials or private user
data.
