# Decision: Meilisearch backs `~search@1.0`

## Decision

Use the existing Meilisearch service as the full-text engine for the generic
`search@1.0` device. HyperBEAM remains responsible for selecting indexable
messages, extracting text, retaining immutable locators, and exposing the
device contract. Meilisearch owns tokenization, ranking, filtering, sorting,
and index storage.

## Rationale

The historical Odysee corpus is already imported into Meilisearch and the
browser previously depended on a direct Lighthouse/Meilisearch path. Routing
the same index through HyperBEAM removes that second browser data mode while
keeping the mature ranking and operational tooling needed for the corpus.
Using one index for imported legacy documents and native cache writes also
avoids split ranking and pagination.

An embedded SQLite FTS5 prototype was rejected for the current system. It
would introduce a second index, duplicate the large historical corpus, and
require the application to reconcile independently ranked result sets. The
device boundary remains generic enough for another backend later, but the
node configuration and operator documentation must describe the backend in
use rather than an aspirational alternative.

## Contracts

- The device returns ordered immutable locators; callers hydrate objects
  separately.
- Cache writes enqueue indexing asynchronously and succeed even if the search
  service is unavailable.
- Operators explicitly restrict indexable message kinds and skip domain
  identifiers; private/auth/social-control records are not public documents.
- The importer and native writer share the `odysee_claims` index and hashed
  `search_id` primary-key convention.
- Browser product calls go through the HyperBEAM integration boundary, not a
  direct Lighthouse or Meilisearch client.

## Consequences

Search availability now depends on the configured Meilisearch service, but
ordinary message writes do not. Rebuilds must use the importer's staging and
checkpoint flow. Backend ranking order is authoritative for a query; hydration
may remove invalid or unavailable objects but must not silently reorder hits.
