import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MANIFEST_CONTENT_TYPE = 'application/x.arweave-manifest+json';
export const MANIFEST_ID_REGEX = /^[A-Za-z0-9_-]{43}$/;

const RESERVED_PATH_CHARACTERS = /[~&()+=]/;
const CONTENT_TYPES = new Map([
  ['.css', 'text/css'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'application/javascript'],
  // application/json bodies are structurally parsed by the node's /id handler
  // (translation keys become message keys/headers), so store JSON files opaquely.
  ['.json', 'text/plain'],
  ['.map', 'text/plain'],
  ['.mjs', 'application/javascript'],
  ['.mp4', 'video/mp4'],
  ['.otf', 'font/otf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain'],
  ['.wasm', 'application/wasm'],
  ['.webm', 'video/webm'],
  ['.webmanifest', 'text/plain'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml'],
]);

export function contentTypeForPath(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

export function assertManifestPath(relativePath) {
  const normalized = String(relativePath).split(path.sep).join('/');
  const segments = normalized.split('/');

  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..') ||
    RESERVED_PATH_CHARACTERS.test(normalized)
  ) {
    throw new Error(`Unsafe manifest path: ${relativePath}`);
  }

  return normalized;
}

export async function listStaticFiles(directory) {
  const root = path.resolve(directory);
  const rootStat = await fs.stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error(`Static build directory not found: ${root}`);

  const files = [];

  async function visit(currentDirectory) {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${absolutePath}`);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push({
          absolutePath,
          path: assertManifestPath(path.relative(root, absolutePath)),
        });
      }
    }
  }

  await visit(root);
  return files;
}

export async function validateStaticBuild(directory) {
  const files = await listStaticFiles(directory);
  if (!files.some((file) => file.path === 'index.html')) {
    throw new Error(`Static build has no index.html: ${path.resolve(directory)}`);
  }
  return files;
}

export function createPathManifest(fileIds) {
  const entries = fileIds instanceof Map ? [...fileIds.entries()] : Object.entries(fileIds);
  entries.sort(([left], [right]) => left.localeCompare(right));

  const paths = {};
  for (const [relativePath, id] of entries) {
    const safePath = assertManifestPath(relativePath);
    if (!MANIFEST_ID_REGEX.test(id)) throw new Error(`Invalid stored ID for ${safePath}: ${id}`);
    paths[safePath] = { id };
  }

  if (!paths['index.html']) throw new Error('Path manifest requires index.html');

  return {
    manifest: 'arweave/paths',
    version: '0.1.0',
    index: { path: 'index.html' },
    paths,
  };
}

function normalizeStoredId(candidate) {
  if (typeof candidate !== 'string') return '';
  const value = candidate.trim().replace(/^['"]|['"]$/g, '');
  if (MANIFEST_ID_REGEX.test(value)) return value;

  try {
    const url = new URL(value, 'http://manifest.local');
    return (
      url.pathname
        .split('/')
        .filter(Boolean)
        .find((segment) => MANIFEST_ID_REGEX.test(segment)) || ''
    );
  } catch {
    return '';
  }
}

function jsonIdCandidates(value) {
  if (!value || typeof value !== 'object') return [];

  const candidates = [];
  for (const key of ['message-id', 'message_id', 'id', 'path', 'read-path', 'read_path', 'url']) {
    candidates.push(value[key]);
  }

  if (value.commitments && typeof value.commitments === 'object') {
    candidates.push(...Object.keys(value.commitments));
  }

  for (const key of ['result', 'data']) {
    candidates.push(...jsonIdCandidates(value[key]));
  }

  if (typeof value.body === 'string') {
    candidates.push(value.body);
    try {
      candidates.push(...jsonIdCandidates(JSON.parse(value.body)));
    } catch {}
  } else {
    candidates.push(...jsonIdCandidates(value.body));
  }

  return candidates;
}

export async function storedIdFromResponse(response) {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HyperBEAM write failed with ${response.status}: ${body.slice(0, 500)}`);
  }

  const candidates = [
    response.headers.get('message-id'),
    response.headers.get('id'),
    response.headers.get('path'),
    response.headers.get('read-path'),
    response.headers.get('location'),
    response.headers.get('url'),
  ];

  try {
    candidates.push(...jsonIdCandidates(JSON.parse(body)));
  } catch {
    candidates.push(body);
  }

  for (const candidate of candidates) {
    const id = normalizeStoredId(candidate);
    if (id) return id;
  }

  throw new Error(`HyperBEAM write returned no stored message ID: ${body.slice(0, 500)}`);
}

function requestHeaders(contentType, authToken) {
  return {
    accept: 'application/json',
    'accept-bundle': 'false',
    'content-type': contentType,
    ...(authToken ? { 'x-odysee-auth-token': authToken } : {}),
  };
}

async function writeStoredMessage(nodeUrl, body, contentType, authToken, fetchImpl) {
  const response = await fetchImpl(`${nodeUrl}/id?!=true&committers=all`, {
    method: 'POST',
    headers: requestHeaders(contentType, authToken),
    body,
  });
  return storedIdFromResponse(response);
}

async function verifyManifestIndex(nodeUrl, manifestId, expectedIndex, fetchImpl) {
  const response = await fetchImpl(`${nodeUrl}/${manifestId}`, { headers: { accept: 'text/html' } });
  if (!response.ok) throw new Error(`Published manifest returned ${response.status}`);

  const actualIndex = Buffer.from(await response.arrayBuffer());
  if (!actualIndex.equals(expectedIndex))
    throw new Error('Published manifest index does not match the built index.html');
}

export async function publishStaticManifest({
  directory,
  nodeUrl,
  authToken = '',
  concurrency = 4,
  verify = true,
  fetchImpl = globalThis.fetch,
  onProgress = () => {},
}) {
  if (typeof fetchImpl !== 'function') throw new Error('A Fetch API implementation is required');

  const normalizedNodeUrl = String(nodeUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(normalizedNodeUrl)) throw new Error('A valid HyperBEAM node URL is required');

  const files = await validateStaticBuild(directory);
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, files.length));
  const fileIds = new Map();
  let nextIndex = 0;
  let completed = 0;

  async function uploadNext() {
    while (nextIndex < files.length) {
      const file = files[nextIndex++];
      const body = await fs.readFile(file.absolutePath);
      const id = await writeStoredMessage(normalizedNodeUrl, body, contentTypeForPath(file.path), authToken, fetchImpl);
      fileIds.set(file.path, id);
      completed += 1;
      onProgress({ completed, total: files.length, path: file.path, id });
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => uploadNext()));

  const manifest = createPathManifest(fileIds);
  const manifestId = await writeStoredMessage(
    normalizedNodeUrl,
    JSON.stringify(manifest),
    MANIFEST_CONTENT_TYPE,
    authToken,
    fetchImpl
  );

  if (verify) {
    const expectedIndex = await fs.readFile(path.join(path.resolve(directory), 'index.html'));
    await verifyManifestIndex(normalizedNodeUrl, manifestId, expectedIndex, fetchImpl);
  }

  return {
    id: manifestId,
    url: `${normalizedNodeUrl}/${manifestId}`,
    fileCount: files.length,
    manifest,
  };
}

function argumentValue(args, name, fallback) {
  const directIndex = args.indexOf(name);
  if (directIndex !== -1) return args[directIndex + 1] || fallback;
  const prefix = `${name}=`;
  return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(
      'Usage: pnpm publish:manifest [-- --dir web/dist/public --node http://127.0.0.1:10000 --concurrency 4 --no-verify]\n' +
        'Environment: HYPERBEAM_BASE_URL or ODYSEE_HYPERBEAM_NODE_API, and optional ODYSEE_AUTH_TOKEN.\n'
    );
    return;
  }

  const directory = path.resolve(argumentValue(args, '--dir', 'web/dist/public'));
  const nodeUrl = argumentValue(
    args,
    '--node',
    process.env.HYPERBEAM_BASE_URL || process.env.ODYSEE_HYPERBEAM_NODE_API || ''
  );
  const concurrency = Number(argumentValue(args, '--concurrency', '4'));
  const authToken = process.env.ODYSEE_AUTH_TOKEN || process.env.LBRY_AUTH_TOKEN || '';
  let lastReported = 0;

  const result = await publishStaticManifest({
    directory,
    nodeUrl,
    authToken,
    concurrency,
    verify: !args.includes('--no-verify'),
    onProgress({ completed, total }) {
      if (completed === total || completed - lastReported >= 25) {
        lastReported = completed;
        process.stderr.write(`Uploaded ${completed}/${total} files\n`);
      }
    },
  });

  process.stdout.write(`Manifest ID: ${result.id}\nManifest URL: ${result.url}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  });
}
