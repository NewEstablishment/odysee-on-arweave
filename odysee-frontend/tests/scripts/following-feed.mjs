import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { hyperbeamClaimSearchRequest } from '../../ui/util/hyperbeamSearch.ts';
import { searchPageHasMore, searchPageNeedsFetch } from '../../ui/util/searchPagination.ts';

// Exercise the actual integration function with controlled discovery and exact
// hydration. Fixtures are not evidence of a live legacy-source migration.
const source = fs.readFileSync(new URL('../../ui/util/hyperbeam.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function fetchHyperbeamSearch(');
const end = source.indexOf('\nasync function fetchNativeChannelClaimSearch', start);
const native = 'N'.repeat(43);
const legacy = 'a'.repeat(40);
const corpus = Array.from({ length: 9 }, (_, i) => ({
  id: `exact-${i}`,
  channel: i % 2 ? legacy : native,
  release_time: 100 - i,
}));
let requests = [];
let unavailable = new Set();
const context = {
  exports: {},
  paramValues: () => [],
  toNumber: (value, fallback) => Number(value ?? fallback),
  hyperbeamClaimSearchRequest,
  SEARCH_DEVICE: 'search@1.0',
  responsePayload: (value) => value,
  searchResultIds: async (value) => value,
  fetchPublicOrProxiedDeviceJson: async (path, request) => {
    assert.equal(path, 'search@1.0/query');
    requests.push(request);
    const selector = request.filter.find((filter) => filter.startsWith('channel_claim_id IN '));
    const channels = JSON.parse(selector.slice('channel_claim_id IN '.length));
    const ranked = corpus.filter((item) => channels.includes(item.channel));
    if (request.sort[0] === 'release_time:asc') ranked.reverse();
    return ranked.slice(request.offset || 0, (request.offset || 0) + request.limit).map((item) => item.id);
  },
  resolveImmutableClaimById: async (id) => {
    // Resolve out of order to catch accidental completion-order merging.
    await new Promise((resolve) => setTimeout(resolve, id.endsWith('0') ? 10 : 0));
    return unavailable.has(id) ? null : corpus.find((item) => item.id === id);
  },
};
vm.runInNewContext(ts.transpile(source.slice(start, end), { module: ts.ModuleKind.CommonJS }), context);
const search = context.exports.fetchHyperbeamSearch;
const options = { channel_ids: [native, legacy], page_size: 4, order_by: ['release_time'] };
const first = await search({ ...options, page: 1 });
assert.deepEqual(
  Array.from(first.items, (item) => item.id),
  ['exact-0', 'exact-1', 'exact-2', 'exact-3']
);
assert.equal(first.has_more, true);
unavailable = new Set(['exact-4', 'exact-5']);
const second = await search({ ...options, page: 2 });
assert.deepEqual(
  Array.from(second.items, (item) => item.id),
  ['exact-6', 'exact-7']
);
assert.equal(second.has_more, true, 'missing hydration must not truncate discovery');
assert.equal(searchPageHasMore(second.has_more, second.items.length, 4), true);
assert.equal(searchPageNeedsFetch(3, second.page), true, 'short hydrated pages can advance');
const third = await search({ ...options, page: 3 });
assert.equal(third.has_more, false);
assert.deepEqual(
  Array.from(third.items, (item) => item.id),
  ['exact-8']
);
assert.equal(searchPageNeedsFetch(3, third.page), false, 'completed pages are not requested repeatedly');
unavailable = new Set(corpus.slice(0, 4).map((item) => item.id));
const emptyHydration = await search({ ...options, page: 1 });
assert.equal(emptyHydration.items.length, 0);
assert.equal(emptyHydration.has_more, true, 'an entirely unavailable page is not discovery exhaustion');
assert.equal(searchPageNeedsFetch(2, emptyHydration.page), true);
unavailable.clear();
const oldest = await search({ ...options, page: 1, order_by: ['^release_time'] });
assert.deepEqual(
  Array.from(oldest.items, (item) => item.id),
  ['exact-8', 'exact-7', 'exact-6', 'exact-5']
);
const unfollowed = await search({ ...options, channel_ids: [native], page: 1 });
assert.ok(unfollowed.items.every((item) => item.channel === native));
assert.equal(requests.at(-1).offset, undefined, 'changed following starts with page one');
const refreshed = await search({ ...options, channel_ids: [native], page: 1 });
assert.deepEqual(
  Array.from(refreshed.items, (item) => item.id),
  Array.from(unfollowed.items, (item) => item.id)
);
assert.equal(searchPageHasMore(undefined, 4, 4), true, 'legacy callers retain count fallback');
assert.equal(searchPageHasMore(false, 4, 4), false, 'explicit exhaustion wins');

// Exercise the production reducer, not just the standalone pagination helper.
const reducer = fs.readFileSync(new URL('../../ui/redux/reducers/claims.ts', import.meta.url), 'utf8');
const reducerStart = reducer.indexOf('reducers[ACTIONS.CLAIM_SEARCH_COMPLETED]');
const reducerEnd = reducer.indexOf('reducers[ACTIONS.CLAIM_SEARCH_FAILED]', reducerStart);
const reducerContext = {
  reducers: {},
  ACTIONS: { CLAIM_SEARCH_COMPLETED: 'completed' },
  searchPageHasMore,
  handleClaimAction: () => ({}),
};
vm.runInNewContext(ts.transpile(reducer.slice(reducerStart, reducerEnd)), reducerContext);
const state = reducerContext.reducers.completed(
  { resolvingIds: [], failedToResolveIds: [] },
  {
    data: {
      query: '{}',
      urls: ['exact-6', 'exact-7'],
      page: 2,
      pageSize: 4,
      hasMore: true,
    },
  }
);
assert.equal(state.claimSearchByQueryLastPageReached['{}'], false);
assert.equal(state.claimSearchByQueryMiscInfo['{}'].page, 2);
assert.equal(state.claimSearchByQueryMiscInfo['{}'].hasMore, true);
// Actual component page selection: hash/filter navigation can be POP, not PUSH.
const component = fs.readFileSync(new URL('../../ui/component/claimListDiscover/view.tsx', import.meta.url), 'utf8');
const pageStart = component.indexOf('let effectivePage = page;');
const pageEnd = component.indexOf('options.page = effectivePage;', pageStart);
const pageContext = {
  page: 2,
  didSearchCriteriaChange: true,
  didNavigateForward: false,
  claimSearchResult: undefined,
  searchPageInfo: undefined,
  dynamicPageSize: 24,
};
vm.runInNewContext(ts.transpile(`${component.slice(pageStart, pageEnd)}\nresult = effectivePage;`), pageContext);
assert.equal(pageContext.result, 1, 'new sort/channel criteria start at page one even after POP navigation');
console.log('Following feed controlled mixed-source ordering/pagination/unfollow/refresh tests passed');
