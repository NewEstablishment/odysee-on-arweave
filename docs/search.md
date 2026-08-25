# `~search@1.0` — generic full-text search

`search@1.0` is a generic HyperBEAM device that indexes eligible cached
messages in Meilisearch and returns ordered immutable locators. It does not
hydrate results or implement Odysee-specific ranking, moderation, grouping, or
presentation.

## Components

- `src/dev_search.erl` is the device surface. `write` is a transparent cache
  hook; `query` returns message IDs in Meilisearch ranking order.
- `src/hb_search.erl` flattens searchable text, owns the asynchronous writer,
  and talks to Meilisearch over HTTP.
- `scripts/import-chainquery-meili.mjs` imports historical Chainquery records
  into the same index. Both writers use a hashed `search_id` primary key and
  retain the immutable locator in `id`/`doc_id`.

## Node configuration

```json
{
  "search-backend-url": "http://127.0.0.1:7700",
  "search-index": "odysee_claims",
  "search-api-key": "optional",
  "search-index-markers": [
    {
      "field": "schema",
      "values": [
        "odysee-upload@1.0",
        "odysee-channel@1.0",
        "odysee-playlist@1.0",
        "odysee-comment@1.0"
      ]
    },
    "claim-name"
  ],
  "on": {
    "cache-write": [
      { "device": "search@1.0", "path": "write" }
    ]
  }
}
```

The marker allow-list prevents authentication, reaction, subscription,
moderation, static-asset, and evidence messages from becoming public search
documents. `search-skip-fields` supplies product-specific identifiers that the
generic engine should exclude. Without markers the generic default is to index
any message containing searchable text.

Indexing is asynchronous and cannot fail the original cache write. Linked
submessages are loaded one level so title, description, and tag data are
indexed instead of their link IDs.

## Query and hydration

```text
GET /~search@1.0/query?q=<terms>&limit=<n>
```

The response is a ranked list of immutable IDs. Browser code calls this
through the SDK-shaped HyperBEAM integration, hydrates each locator through
the normal read path, preserves backend order, and then ingests the normalized
claims into Redux. A search hit is never the source of truth for the object.

## Operations

Run Meilisearch separately at the configured URL. The generic hook handles
new native writes; the importer handles historical backfill and uses staged,
checkpointed rebuilds so a live index is not replaced in place.

The focused backend unit tests do not require a live Meilisearch service.
Set `SEARCH_LIVE=1` only when intentionally exercising the live write/query
round trip.
