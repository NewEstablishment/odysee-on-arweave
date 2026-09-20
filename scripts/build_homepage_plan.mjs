import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'odysee-frontend/custom/homepages/v2/index.cjs');
const outputDirectory = path.join(root, 'priv');
const output = path.join(outputDirectory, 'homepage-plan.json.gz');
const temporary = path.join(outputDirectory, `homepage-plan.json.${process.pid}`);

await mkdir(outputDirectory, { recursive: true });
const homepages = (await import(source)).default;
await writeFile(temporary, `${JSON.stringify(homepages)}\n`);

await new Promise((resolve, reject) => {
  const input = createReadStream(temporary);
  const gzip = createGzip({ level: 9 });
  const destination = createWriteStream(output);
  input.on('error', reject);
  gzip.on('error', reject);
  destination.on('error', reject);
  destination.on('finish', resolve);
  input.pipe(gzip).pipe(destination);
});

await unlink(temporary);
process.stdout.write(`${output}\n`);
