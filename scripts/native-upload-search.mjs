// Operator-side projection; shares the browser's verified revision rules.
import { createHash } from "node:crypto";
import {
  collapseNativeUploadRevisions,
  normalizeNativeUploadRevision,
} from "../odysee-frontend/ui/util/nativeUploadRevisions.ts";

export function searchId(id) {
  return createHash("sha256").update(id).digest("base64url");
}

export function uploadSearchDocuments(verified) {
  const records = verified
    .map(({ messageId, payload, owner }) =>
      normalizeNativeUploadRevision(payload, messageId, owner),
    )
    .filter(Boolean);
  const messages = new Map(verified.map((message) => [message.messageId, message]));
  return collapseNativeUploadRevisions(records)
    .filter((tip) => tip.state !== "deleted")
    .map((tip) => {
      const rootMessage = messages.get(tip.record_id);
      const root = rootMessage?.payload;
      if (!root || !tip.hyperbeam_message_id) throw new Error("Upload root is unavailable");
      const tags = tip.tags || [];
      const contentType = root["content-type"] || "application/octet-stream";
      return {
        search_id: searchId(tip.record_id),
        id: tip.hyperbeam_message_id,
        doc_id: tip.hyperbeam_message_id,
        immutable_id: tip.hyperbeam_message_id,
        record_id: tip.record_id,
        data_id: tip.data_id,
        schema: "odysee-upload@1.0",
        source_system: "native-upload-projection",
        search_group: tip.record_id,
        claim_id: tip.record_id,
        claim_type: "stream",
        channel_claim_id: rootMessage.channelVerified ? tip.channel_id : "",
        channel_name: rootMessage.channelVerified ? tip.channel_name : "",
        title: tip.title || "",
        name: tip.name || "",
        description: tip.description || "",
        thumbnail_url: tip.thumbnail_url || "",
        tags,
        language: tip.languages || [],
        license: tip.license || "",
        license_url: tip.license_url || "",
        release_time: Number(tip.release_time ?? tip.timestamp ?? 0),
        content_type: contentType,
        media_type: contentType.split("/")[0],
        duration: Number(root["video-duration"] || root["audio-duration"] || 0),
        nsfw: tags.some((tag) => ["mature", "nsfw"].includes(tag.toLowerCase())) ? 1 : 0,
        fee: 0,
        has_source: true,
        has_channel: rootMessage.channelVerified ? 1 : 0,
        has_thumbnail: tip.thumbnail_url ? 1 : 0,
        effective_amount: 0,
        is_public: true,
        state: "active",
      };
    });
}

export function queryPaths(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value?.paths) return queryPaths(value.paths);
  return Object.keys(value || {})
    .filter((key) => /^[1-9]\d*$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => String(value[key]));
}

export async function readVerifiedUpload(node, id, request = fetch) {
  if (!/^[\w-]{43}$/.test(id)) throw new Error("Invalid discovery locator");
  const get = async (path) => {
    const response = await request(`${node}/${path}`, {
      headers: { accept: "application/json", "accept-bundle": "true" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Exact upload read failed (${response.status})`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  const [payload, check, committer] = await Promise.all([
    get(`${id}/serialize~json@1.0`),
    get(`${id}/verify?commitment-ids=${id}`),
    get(`${id}/commitments/${id}/committer`),
  ]);
  const body = (value) => value?.body ?? value;
  const owner = body(committer);
  if (!payload || typeof payload !== "object") return null;
  if (body(check) !== true && body(check) !== "true") return null;
  if (typeof owner !== "string" || !owner) return null;
  // JSON serialization retains immutable links for list/multiline fields.
  // Load only product fields; verification remains on the exact parent ID.
  for (const field of [
    "title",
    "description",
    "thumbnail-url",
    "license",
    "license-url",
    "tags",
    "languages",
  ]) {
    const link = payload[`${field}+link`];
    if (link) {
      if (!/^[\w-]{43}$/.test(link)) throw new Error("Invalid linked upload field");
      payload[field] = body(await get(`${link}/serialize~json@1.0`));
    }
  }
  return { messageId: id, payload, owner };
}

export async function collectUploads(node, request = fetch) {
  const response = await request(`${node}/~query@1.0/only`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      schema: "odysee-upload@1.0",
      type: "upload",
      only: ["schema", "type"],
      return: "paths",
      "cache-control": ["no-store", "no-cache"],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Upload discovery failed (${response.status})`);
  const ids = [...new Set(queryPaths(await response.json()))];
  const result = [];
  // Abort on transport failure before touching search; don't mistake an outage for deletion.
  for (let i = 0; i < ids.length; i += 8)
    result.push(
      ...(await Promise.all(
        ids.slice(i, i + 8).map((id) => readVerifiedUpload(node, id, request)),
      )),
    );
  const verified = result.filter(Boolean);
  for (const item of [...verified]) {
    const root = item.payload["revision-of"];
    if (root && !verified.some((entry) => entry.messageId === root)) {
      const loaded = await readVerifiedUpload(node, root, request);
      if (loaded) verified.push(loaded);
    }
  }
  // Finish predecessor chains even when discovery has not indexed each link.
  for (let cursor = 0; cursor < verified.length; cursor++) {
    const previous = verified[cursor].payload["previous-version"];
    if (
      /^[\w-]{43}$/.test(previous || "") &&
      !verified.some((entry) => entry.messageId === previous)
    ) {
      const loaded = await readVerifiedUpload(node, previous, request);
      if (loaded) verified.push(loaded);
    }
  }
  const channels = new Map();
  for (const item of verified) {
    if (item.payload["revision-of"]) continue;
    const channelId = item.payload["channel-id"];
    if (!/^[\w-]{43}$/.test(channelId || "")) continue;
    if (!channels.has(channelId))
      channels.set(channelId, await readVerifiedUpload(node, channelId, request));
    const channel = channels.get(channelId);
    item.channelVerified = channel?.owner === item.owner && channel?.payload?.type === "channel";
  }
  return verified;
}
