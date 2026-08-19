import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:9090/UJZGituf4db3K7sKis9VY_JQk5BMsxTfbXxiNKI2gtc/#/$/search?q=test', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(25000);
const out = await p.evaluate(() => {
  const s = window.store.getState();
  const byId = s.claims.byId || {};
  const claims = Object.values(byId).slice(0, 4);
  return claims.filter((c) => c?.value?.title).slice(0, 3).map((c) => ({ title: c.value.title.slice(0, 30), desc: String(c.value.description || '').slice(0, 60), thumb: c.value.thumbnail?.url }));
});
console.log(JSON.stringify(out, null, 1));
await b.close();
