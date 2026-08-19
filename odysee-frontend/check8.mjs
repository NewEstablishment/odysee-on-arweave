import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
// Delay claim hydration so the loading phase is observable.
await p.route('**/~cache@1.0/**', async (route) => {
  await new Promise((r) => setTimeout(r, 5000));
  await route.continue();
});
await p.goto('http://localhost:9090/PTtlp9c6nTteQlCskdbqYI9qSs6ZGUHZQ_PKYon5Y7g/#/$/search?q=test', { waitUntil: 'domcontentloaded', timeout: 90000 });
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(2000);
  const snap = await p.evaluate(() => ({
    wrappers: document.querySelectorAll('.claim-preview__wrapper').length,
    titles: document.querySelectorAll('.claim-preview__title').length,
    skeleton: document.querySelectorAll('.claim-preview__loading, .claim-preview-loading, [class*="loading"]').length,
    spinner: document.querySelectorAll('.spinner, [class*="spinner"]').length,
  }));
  console.log(i * 2 + 's', JSON.stringify(snap));
}
await b.close();
