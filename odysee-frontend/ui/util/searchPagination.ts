// Discovery page boundaries must not depend on how many locators hydrated.
export function searchPageHasMore(hasMore: boolean | undefined, itemCount: number, pageSize: number): boolean {
  return typeof hasMore === 'boolean' ? hasMore : itemCount >= pageSize;
}

export function searchPageNeedsFetch(requestedPage: number, completedPage: number | undefined): boolean {
  return requestedPage > (completedPage || 0);
}
