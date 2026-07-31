const { spawn } = require('node:child_process');

const shouldMaterialize = process.env.CUSTOM_HOMEPAGE === 'true';
let child;

function run(args) {
  child = spawn(process.execPath, args, { stdio: 'inherit' });

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = undefined;
      if (signal) reject(new Error(`Child process terminated by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`Child process exited with code ${code ?? 1}`));
    });
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child?.kill(signal));
}

(async () => {
  if (shouldMaterialize) await run(['web/src/materializeHomepage.js']);
  await run(['web/cluster.js']);
})().catch((error) => {
  console.error(error); // eslint-disable-line no-console
  process.exitCode = 1;
});
