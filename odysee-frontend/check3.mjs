import { chromium } from 'playwright';
const url = 'http://localhost:9090/Z6hJXjLthawbFkKBzirsSlCYsxwhi-WBxUjn1a3bsSI/#/$/search?q=test';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(25000);
const out = await p.evaluate(() => {
  const s = window.store.getState();
  const key = Object.keys(s.search.resultsByQuery || {})[0];
  const uris = s.search.resultsByQuery[key].uris || [];
  const byUri = s.claims.byUri || s.claims.claimsByUri || {};
  const byId = s.claims.byId || {};
  return uris.slice(0, 6).map((u) => {
    const v = byUri[u];
    const claim = typeof v === 'string' ? byId[v] : v;
    return { u: u.slice(0, 30), mapped: typeof v, title: claim?.value?.title, thumb: claim?.value?.thumbnail?.url, ch: claim?.signing_channel?.value?.title || claim?.signing_channel?.name };
  });
});
console.log(JSON.stringify(out, null, 1));
await b.close();
