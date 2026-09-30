import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DIST = path.join(ROOT, 'web', 'dist', 'public');
const ASSETS = path.join(DIST, 'assets');
const HTML_FILE = path.join(DIST, 'index.html');

function invariant(condition, message) {
  if (!condition) throw new Error(`[style-chunks] ${message}`);
}

invariant(fs.existsSync(HTML_FILE), 'Missing production build; run pnpm run build first');

const html = fs.readFileSync(HTML_FILE, 'utf8');
const initialStylesheets = [
  ...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+\.css)["'][^>]*>/g),
].map((match) => match[1]);
invariant(initialStylesheets.length === 1, `Expected one initial stylesheet, found ${initialStylesheets.length}`);

const entryFile = path.basename(initialStylesheets[0]);
const cssFiles = fs.readdirSync(ASSETS).filter((file) => file.endsWith('.css'));
invariant(cssFiles.includes(entryFile), `Initial stylesheet ${entryFile} is missing from the build`);

const cssByFile = new Map(cssFiles.map((file) => [file, fs.readFileSync(path.join(ASSETS, file), 'utf8')]));
const entryCss = cssByFile.get(entryFile);
invariant(entryCss.includes('--tw-spacing:'), 'Initial stylesheet is missing the Tailwind spacing theme');
invariant(entryCss.includes('--tw-font-weight-semibold:'), 'Initial stylesheet is missing the Tailwind font theme');

const routeDefinitions = [
  {
    label: 'studio',
    marker: '.tw\\:\\[animation\\:countdown-sweep_',
    scope: '.odysee-route-styles--studio',
  },
  {
    label: 'publishing',
    marker: '.tw\\:\\[animation\\:publish-file-info-in_',
    scope: '.odysee-route-styles--publish',
  },
  {
    label: 'memberships',
    marker: 'banner_DonorPortal',
    scope: '.odysee-route-styles--memberships',
  },
];
const jsFiles = fs.readdirSync(ASSETS).filter((file) => file.endsWith('.js'));
const routeFiles = new Map();

for (const route of routeDefinitions) {
  const matches = [...cssByFile]
    .filter(([, css]) => css.includes(route.scope) && css.includes(route.marker))
    .map(([file]) => file);
  invariant(matches.length === 1, `Expected one ${route.label} route stylesheet, found ${matches.length}`);

  const [routeFile] = matches;
  const routeCss = cssByFile.get(routeFile);
  invariant(routeFile !== entryFile, `${route.label} utilities leaked into the initial stylesheet`);
  invariant(!html.includes(routeFile), `${route.label} stylesheet is linked from the initial document`);
  invariant(
    jsFiles.some((jsFile) => fs.readFileSync(path.join(ASSETS, jsFile), 'utf8').includes(routeFile)),
    `${route.label} stylesheet is not reachable from a JavaScript chunk`
  );
  invariant(routeCss.includes('@layer utilities'), `${route.label} stylesheet is outside the utilities layer`);
  routeFiles.set(route.label, routeFile);
}
invariant(
  new Set(routeFiles.values()).size === routeDefinitions.length,
  'Route families were merged into one stylesheet'
);

const sizeKb = (file) => (fs.statSync(path.join(ASSETS, file)).size / 1024).toFixed(2);
console.log(
  `[style-chunks] OK: initial ${sizeKb(entryFile)} KB; ${[...routeFiles]
    .map(([label, file]) => `${label} ${sizeKb(file)} KB`)
    .join('; ')}`
);
