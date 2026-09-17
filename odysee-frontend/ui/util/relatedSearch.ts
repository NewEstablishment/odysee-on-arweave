const RECOMMENDATION_TAG_LIMIT = 5;
const RECOMMENDATION_QUERY_LIMIT = 512;

/**
 * Builds the full-text query used as the local replacement for the legacy
 * `related_to` recommendation service. Lead with a small bounded set of tags
 * so Meilisearch's last-term matching keeps the topical anchors, then retain
 * the title as additional ranking context and as the tag-less fallback.
 */
export function getRecommendationSearchQuery(title: string, tags: Array<string> | null | undefined = []): string {
  const normalizedTitle = normalizeRecommendationTerm(title);
  const queryParts: Array<string> = [];
  const seen = new Set<string>();
  let tagCount = 0;

  for (const rawTag of Array.isArray(tags) ? tags : []) {
    if (tagCount >= RECOMMENDATION_TAG_LIMIT) break;
    const tag = normalizeRecommendationTerm(rawTag);
    const normalizedTag = tag.toLocaleLowerCase();
    if (!tag || seen.has(normalizedTag)) continue;

    queryParts.push(tag);
    seen.add(normalizedTag);
    tagCount += 1;
  }

  if (normalizedTitle) queryParts.push(normalizedTitle);

  return queryParts.join(' ').slice(0, RECOMMENDATION_QUERY_LIMIT).trim();
}

function normalizeRecommendationTerm(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}
