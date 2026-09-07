// Re-populates the full-text search index from the node's own stores by
// replaying every native upload through `~search@1.0/write` — the same hook
// the node fires on cache writes. Needed whenever the Meilisearch database
// is recreated (e.g. an incompatible Meilisearch upgrade): cache-write
// indexing only covers new writes, and nothing rebuilds history on boot.
//
// Upload edit/delete revisions are collapsed first: a deleted chain is not
// indexed at all, and an edited chain is indexed once, as the root document
// carrying the newest metadata.
//
// Usage: node scripts/reindex-node-uploads-to-search.mjs [--node-url http://127.0.0.1:18801]

const args = process.argv.slice(2);
const nodeUrl = (valueOf('--node-url') || process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18801').replace(
  /\/+$/,
  ''
);

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function queryPaths(selectors) {
  const response = await fetch(`${nodeUrl}/~query@1.0/only`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      ...selectors,
      only: Object.keys(selectors),
      return: 'paths',
      'cache-control': ['no-store', 'no-cache'],
    }),
  });
  if (!response.ok) throw new Error(`query failed with ${response.status}`);
  const body = await response.json();
  return Object.entries(body)
    .filter(([key]) => key !== 'status')
    .map(([, value]) => String(value));
}

async function readMessage(id) {
  const response = await fetch(`${nodeUrl}/${encodeURIComponent(id)}/serialize~json@1.0`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`read ${id} failed with ${response.status}`);
  const payload = await response.json();
  delete payload.commitments;
  return payload;
}

async function writeToSearch(payload) {
  const response = await fetch(`${nodeUrl}/~search@1.0/write`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ body: payload }),
  });
  if (!response.ok) throw new Error(`search write failed with ${response.status}`);
}

const ids = await queryPaths({ schema: 'odysee-upload@1.0', type: 'upload' });
console.log(`found ${ids.length} upload messages`);

const messages = new Map();
for (const id of ids) {
  try {
    messages.set(id, await readMessage(id));
  } catch (error) {
    console.warn(`skipping unreadable ${id}: ${error.message}`);
  }
}

// Group revisions under their roots and pick each chain's effective state.
const revisionsByRoot = new Map();
for (const [id, payload] of messages) {
  const rootRef = payload['revision-of'];
  if (!rootRef) continue;
  const list = revisionsByRoot.get(rootRef) || [];
  list.push({ id, payload });
  revisionsByRoot.set(rootRef, list);
}

let indexed = 0;
let deleted = 0;
for (const [id, payload] of messages) {
  if (payload['revision-of']) continue; // revisions are not standalone documents
  const revisions = (revisionsByRoot.get(id) || []).sort(
    (left, right) => Number(left.payload.revision || 0) - Number(right.payload.revision || 0)
  );
  const tip = revisions[revisions.length - 1];
  if (tip && tip.payload.state === 'deleted') {
    deleted += 1;
    continue;
  }
  const document = { ...payload };
  if (tip) {
    for (const key of ['title', 'description', 'thumbnail-url', 'license', 'release-time']) {
      if (tip.payload[key] !== undefined) document[key] = tip.payload[key];
    }
  }
  try {
    await writeToSearch(document);
    indexed += 1;
  } catch (error) {
    console.warn(`index failed for ${id}: ${error.message}`);
  }
}

console.log(`indexed ${indexed} uploads, skipped ${deleted} deleted chains`);
