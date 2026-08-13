const { spawn } = require('node:child_process');

const shouldMaterialize = process.env.CUSTOM_HOMEPAGE === 'true';
const materializeIntervalMs = Number(process.env.HOMEPAGE_MATERIALIZE_INTERVAL_MS || 60 * 60 * 1000);
const children = new Set();
let homepageRefreshPromise;

function run(args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  children.add(child);

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (signal) reject(new Error(`Child process terminated by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`Child process exited with code ${code ?? 1}`));
    });
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => children.forEach((child) => child.kill(signal)));
}

async function refreshHomepage() {
  if (!homepageRefreshPromise) {
    homepageRefreshPromise = run(['web/src/materializeHomepage.js'])
      .catch((error) => {
        console.error('Homepage refresh failed; retaining the previous snapshot:', error); // eslint-disable-line no-console
      })
      .finally(() => {
        homepageRefreshPromise = undefined;
      });
  }

  return homepageRefreshPromise;
}

if (shouldMaterialize) {
  refreshHomepage();
  if (Number.isFinite(materializeIntervalMs) && materializeIntervalMs > 0) {
    const timer = setInterval(refreshHomepage, materializeIntervalMs);
    timer.unref();
  }
}

run(['web/cluster.js']).catch((error) => {
  console.error(error); // eslint-disable-line no-console
  process.exitCode = 1;
});
