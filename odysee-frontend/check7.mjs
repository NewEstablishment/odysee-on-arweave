import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:9090/PTtlp9c6nTteQlCskdbqYI9qSs6ZGUHZQ_PKYon5Y7g/#/$/search?q=test', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (const t of [1000, 1000, 2000, 2000, 4000, 4000, 8000, 8000]) {
  await p.waitForTimeout(t);
  const snap = await p.evaluate(() => {
    const wrappers = [...document.querySelectorAll('.claim-preview__wrapper')];
    const loading = [...document.querySelectorAll('.claim-preview__loading, [class*="claim-preview-loading"], .claim-preview--loading')];
    const titles = [...document.querySelectorAll('.claim-preview__title')].length;
    const spinner = !!document.querySelector('.spinner, [class*="spinner"]');
    return { wrappers: wrappers.length, loading: loading.length, titles, spinner };
  });
  console.log(Date.now() % 100000, JSON.stringify(snap));
}
await b.close();
