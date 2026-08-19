import { chromium } from 'playwright';
const url = 'http://localhost:9090/lcWEwajrYYDlkMPgQyKbciJfhPO6fCGzpKHhlnd9rRk/#/$/search?q=test';
const b = await chromium.launch();
const p = await b.newPage();
const bad = [];
p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 150)); });
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(25000);
const state = await p.evaluate(() => {
  const s = window.store?.getState?.();
  if (!s) return { nostore: true };
  const search = s.search;
  const key = Object.keys(search.resultsByQuery || {})[0];
  const uris = search.resultsByQuery?.[key]?.uris || [];
  const byUri = s.claims.byUri || {};
  return {
    key,
    total: uris.length,
    unresolved: uris.filter((u) => !byUri[u] || typeof byUri[u] === 'string' ? !byUri[u] : false),
    sample: uris.slice(0, 6).map((u) => ({ u, v: typeof byUri[u], val: byUri[u] === null ? 'null' : undefined })),
  };
});
const imgs = await p.$$eval('.claim-preview img, .claim-thumbnail img, img', (els) => els.map((e) => e.currentSrc || e.src).filter((s) => s && !s.startsWith('data:')).slice(0, 6));
const channels = await p.$$eval('.claim-preview__author, [class*="channel-name"], .claim-preview-metadata a', (els) => els.map((e) => e.textContent.trim()).slice(0, 8));
console.log('STATE', JSON.stringify(state, null, 1).slice(0, 1500));
console.log('IMGS', JSON.stringify(imgs, null, 1));
console.log('CHANNELS', JSON.stringify(channels));
console.log('BAD', JSON.stringify([...new Set(bad)].slice(0, 10), null, 1));
await b.close();
