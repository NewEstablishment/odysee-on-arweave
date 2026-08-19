import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:9090/lcWEwajrYYDlkMPgQyKbciJfhPO6fCGzpKHhlnd9rRk/#/$/search?q=test', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(30000);
const cards = await p.$$eval('li, .claim-preview__wrapper, .claim-preview, [class*="claim-preview"]', (els) =>
  els.filter((e) => e.className && String(e.className).includes('claim-preview')).map((e, i) => ({
    i, cls: String(e.className).slice(0, 60),
    loading: String(e.className).includes('loading') || !!e.querySelector('[class*="loading"], [class*="placeholder"]'),
    text: (e.textContent || '').trim().slice(0, 40),
    href: e.querySelector('a')?.getAttribute('href') || '',
  })).slice(0, 8)
);
console.log(JSON.stringify(cards, null, 1));
const st = await p.evaluate(() => {
  const s = window.store.getState();
  const key = Object.keys(s.search.resultsByQuery)[0];
  const uris = s.search.resultsByQuery[key].uris;
  return uris.slice(0, 5).map((u) => ({ u: u.slice(8, 24), resolving: (s.claims.resolvingUris || []).includes(u), inByUri: u in (s.claims.byUri || {}) }));
});
console.log(JSON.stringify(st, null, 1));
await b.close();
