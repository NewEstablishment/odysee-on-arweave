// Operator reconciliation of native upload search documents. --watch keeps it current.
import { setTimeout as delay } from "node:timers/promises";
import { collectUploads, uploadSearchDocuments } from "./native-upload-search.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const node = option(
  "--node-url",
  process.env.HYPERBEAM_BASE_URL || "http://127.0.0.1:18801",
).replace(/\/+$/, "");
const meili = (process.env.MEILI_URL || "http://127.0.0.1:7700").replace(/\/+$/, "");
const index = encodeURIComponent(process.env.MEILI_INDEX || "odysee_claims");
const key = process.env.MEILI_MASTER_KEY || process.env.ODYSEE_SEARCH_API_KEY;
const headers = {
  "content-type": "application/json",
  ...(key ? { authorization: "Bearer " + key } : {}),
};
const interval = Number(option("--interval-ms", "5000"));
if (!Number.isFinite(interval) || interval < 1000)
  throw new Error("interval-ms must be at least 1000");

async function api(path, method = "GET", body) {
  const response = await fetch(meili + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Object.assign(new Error("Search operation failed (" + response.status + ")"), {
      status: response.status,
    });
  return response.json();
}

async function complete(task) {
  if (task.taskUid === undefined) throw new Error("Search did not acknowledge a task");
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const state = await api("/tasks/" + task.taskUid);
    if (state.status === "succeeded") return;
    if (["failed", "canceled"].includes(state.status)) throw new Error("Search task failed");
    await delay(200);
  }
  throw new Error("Search task timed out");
}

async function reconcile() {
  const documents = uploadSearchDocuments(await collectUploads(node));
  if (args.includes("--dry-run")) {
    console.log(
      JSON.stringify({ activeUploads: documents.length, locators: documents.map((doc) => doc.id) }),
    );
    return;
  }
  const base = "/indexes/" + index;
  let settings;
  try {
    settings = await api(base + "/settings");
  } catch (error) {
    if (error.status !== 404) throw error;
    await complete(
      await api("/indexes", "POST", { uid: decodeURIComponent(index), primaryKey: "search_id" }),
    );
    settings = await api(base + "/settings");
  }
  const required = [
    "schema",
    "source_system",
    "search_id",
    "claim_type",
    "channel_claim_id",
    "media_type",
    "tags",
    "language",
    "release_time",
    "nsfw",
    "fee",
    "duration",
    "has_source",
  ];
  const filterableAttributes = [
    ...new Set([...(settings.filterableAttributes || []), ...required]),
  ];
  const sortableAttributes = [
    ...new Set([...(settings.sortableAttributes || []), "release_time", "effective_amount"]),
  ];
  if (
    JSON.stringify(filterableAttributes) !== JSON.stringify(settings.filterableAttributes) ||
    JSON.stringify(sortableAttributes) !== JSON.stringify(settings.sortableAttributes)
  ) {
    await complete(
      await api(base + "/settings", "PATCH", { filterableAttributes, sortableAttributes }),
    );
  }
  const existing = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await api(base + "/documents/fetch", "POST", {
      filter: 'schema = "odysee-upload@1.0"',
      offset,
      limit: 1000,
    });
    existing.push(...page.results);
    if (page.results.length < 1000) break;
  }
  const same = (a, b) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b || {}).sort());
  const byKey = new Map(existing.map((doc) => [doc.search_id, doc]));
  const changed = documents.filter((doc) => !same(doc, byKey.get(doc.search_id)));
  // Replace full documents; PATCH would retain cleared fields.
  for (let i = 0; i < changed.length; i += 500)
    await complete(await api(base + "/documents", "POST", changed.slice(i, i + 500)));
  const keep = new Set(documents.map((doc) => doc.search_id));
  const obsolete = existing.filter((doc) => !keep.has(doc.search_id)).map((doc) => doc.search_id);
  for (let i = 0; i < obsolete.length; i += 500)
    await complete(await api(base + "/documents/delete-batch", "POST", obsolete.slice(i, i + 500)));
  console.log(
    JSON.stringify({
      activeUploads: documents.length,
      replaced: changed.length,
      removedObsoleteSearchDocuments: obsolete.length,
    }),
  );
}

do {
  try {
    await reconcile();
  } catch (error) {
    console.error(error.message);
    if (!args.includes("--watch")) {
      process.exitCode = 1;
      break;
    }
  }
  if (args.includes("--watch")) await delay(interval);
} while (args.includes("--watch"));
