export class DeviceRequestError extends Error {
  constructor(operation, status, reason) {
    super(`${operation}: ${reason || `HTTP ${status}`}`);
    this.name = "DeviceRequestError";
    this.operation = operation;
    this.status = status;
    this.reason = reason || "request-failed";
  }
}

export function randomId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createPeer(role, prefix = role) {
  return {
    id: `${prefix}-${crypto.randomUUID().slice(0, 12)}`,
    role,
    generation: 0,
    cursor: 0,
  };
}

export function defaultNodeEndpoint(currentUrl = window.location.href) {
  const url = new URL(currentUrl);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (loopbackHosts.has(url.hostname)) {
    return "http://127.0.0.1:18785";
  }
  const slot = url.hostname.match(/^demo(\d+)(\..+)$/);
  if (slot) {
    return `${url.protocol}//devhb${slot[1]}${slot[2]}`;
  }
  return url.origin;
}

export function peerConnectionConfiguration() {
  const configured = globalThis.HYPERSTREAM_RTC_CONFIGURATION;
  if (configured && typeof configured === "object") {
    return structuredClone(configured);
  }
  return {
    iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
  };
}

export function selectedCandidateRoute(reports) {
  let pair = null;
  reports.forEach((report) => {
    if (report.type === "transport" && report.selectedCandidatePairId) {
      pair = reports.get(report.selectedCandidatePairId) || pair;
    }
  });
  if (!pair) {
    reports.forEach((report) => {
      if (
        report.type === "candidate-pair" &&
        report.state === "succeeded" &&
        (report.nominated || report.selected)
      ) {
        pair = report;
      }
    });
  }
  if (!pair) {
    return null;
  }
  const local = reports.get(pair.localCandidateId);
  const remote = reports.get(pair.remoteCandidateId);
  const localType = local?.candidateType || "unknown";
  const remoteType = remote?.candidateType || "unknown";
  const protocol = local?.protocol || remote?.protocol || "unknown";
  return {
    label: `${localType} → ${remoteType} · ${protocol}`,
    roundTripTime: Number(pair.currentRoundTripTime || 0),
  };
}

export function normalizeEndpoint(value) {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("The HyperBEAM node must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("The HyperBEAM node URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("The HyperBEAM node URL must not contain a query or fragment.");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (url.protocol !== "https:" && !loopbackHosts.has(url.hostname)) {
    throw new Error("Non-loopback HyperBEAM nodes must use HTTPS.");
  }
  return url.href.replace(/\/+$/, "");
}

export function memberFields(sessionId, peer) {
  return {
    "session-id": sessionId,
    "peer-id": peer.id,
    "peer-generation": peer.generation,
  };
}

export function encodeInvite({ endpoint, sessionId, publisherId }) {
  const invite = {
    v: 1,
    n: normalizeEndpoint(endpoint),
    s: sessionId,
    h: publisherId,
  };
  const payload = JSON.stringify(invite);
  return bytesToBase64Url(new TextEncoder().encode(payload));
}

export function decodeInvite(hash) {
  if (hash.length > 4096) {
    throw new Error("This watch URL contains an oversized descriptor.");
  }
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const encoded = params.get("invite");
  if (!encoded) {
    throw new Error("This watch URL is missing its descriptor.");
  }

  let invite;
  try {
    const payload = new TextDecoder().decode(base64UrlToBytes(encoded));
    invite = JSON.parse(payload);
  } catch {
    throw new Error("This watch URL contains an invalid descriptor.");
  }

  if (
    invite?.v !== 1 ||
    typeof invite.n !== "string" ||
    typeof invite.s !== "string" ||
    typeof invite.h !== "string" ||
    !validIdentifier(invite.s) ||
    !validIdentifier(invite.h)
  ) {
    throw new Error("This watch URL contains an unsupported descriptor.");
  }

  const endpoint = normalizeEndpoint(invite.n);

  return {
    endpoint,
    sessionId: invite.s,
    publisherId: invite.h,
  };
}

export function validSessionDescription(value, expectedType) {
  return (
    value &&
    typeof value === "object" &&
    value.type === expectedType &&
    typeof value.sdp === "string" &&
    value.sdp.length > 0 &&
    value.sdp.length <= 262_144
  );
}

export function validIceCandidate(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.candidate === "string" &&
    value.candidate.length <= 65_536 &&
    (value.sdpMid == null ||
      (typeof value.sdpMid === "string" && value.sdpMid.length <= 256)) &&
    (value.sdpMLineIndex == null ||
      (Number.isInteger(value.sdpMLineIndex) &&
        value.sdpMLineIndex >= 0 &&
        value.sdpMLineIndex <= 65_535)) &&
    (value.usernameFragment == null ||
      (typeof value.usernameFragment === "string" &&
        value.usernameFragment.length <= 256))
  );
}

export function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function safeBodySize(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

export function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function responseHasMore(value) {
  return value === true || value === "true";
}

export function retryableRequestError(error) {
  return (
    !(error instanceof DeviceRequestError) ||
    error.status === 429 ||
    error.status >= 500
  );
}

export function membershipLost(error) {
  return (
    error instanceof DeviceRequestError &&
    ((error.status === 404 && error.reason === "peer-not-found") ||
      (error.status === 410 && error.reason === "peer-expired"))
  );
}

const HYPERSTREAM_DEVICE = "hyperstream@1.0";
const HYPERSTREAM_PATH = "/~hyperstream@1.0";
const TRANSPORT_ALGORITHM = "ECDH-P256-HKDF-SHA256-AES-256-GCM";
const HB_DERIVED = new Set([
  "method",
  "target-uri",
  "authority",
  "scheme",
  "request-target",
  "path",
  "query",
  "query-param",
]);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class HyperstreamClient {
  constructor(endpoint, onRequest = () => {}) {
    this.endpoint = normalizeEndpoint(endpoint);
    this.onRequest = onRequest;
    this.requestCount = 0;
    this.cacheProved = false;
    this.identity = createSigningIdentity();
    this.transport = null;
  }

  async probe() {
    const started = performance.now();
    const response = await fetch(`${this.endpoint}/~meta@1.0/info`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      throw new Error(`HyperBEAM probe returned HTTP ${response.status}.`);
    }
    await response.text();
    return Math.round(performance.now() - started);
  }

  async call(operation, body, { silent = false } = {}) {
    const started = performance.now();
    let response;
    let text = "";
    let data = {};

    try {
      if (!validTransportOperation(operation)) {
        throw new Error("The Hyperstream operation is invalid.");
      }
      const transport = await this.transportContext();
      const requestBody = await encryptTransportRequest(operation, body, transport);
      response = await this.signedPost(
        operation,
        requestBody,
        "application/octet-stream",
        "application/octet-stream",
      );
      text = await response.text();
      data = await decryptTransportResponse(operation, text, transport);
    } catch (error) {
      this.requestCount += 1;
      this.onRequest({
        operation,
        status: response?.status || "ERR",
        duration: Math.round(performance.now() - started),
        bytes: textEncoder.encode(text).byteLength,
        error: true,
        reason: error instanceof Error ? error.message : "network-error",
        silent,
      });
      throw error;
    }

    this.requestCount += 1;
    const status = Number(data.status || response.status);
    const cacheControl = response.headers.get("cache-control") || data["cache-control"] || "";
    this.cacheProved ||= cacheControl.toLowerCase().includes("no-store");
    const summary = {
      operation,
      status,
      duration: Math.round(performance.now() - started),
      bytes: new TextEncoder().encode(text).byteLength,
      error: !response.ok || status >= 400,
      reason: typeof data.reason === "string" ? data.reason : response.statusText,
      silent,
    };
    this.onRequest(summary);

    if (summary.error) {
      throw new DeviceRequestError(operation, status, summary.reason);
    }
    return data;
  }

  async transportContext() {
    if (!this.transport) {
      this.transport = this.createTransportContext().catch((error) => {
        this.transport = null;
        throw error;
      });
    }
    return this.transport;
  }

  async createTransportContext() {
    const operation = "transport-key";
    const started = performance.now();
    let response;
    let text = "";
    let data = {};
    let transport;

    try {
      response = await this.signedPost(
        operation,
        textEncoder.encode("{}"),
        "application/json",
        "application/json",
      );
      text = await response.text();
      data = text ? JSON.parse(text) : {};
      const status = Number(data.status || response.status);
      if (response.ok && status < 400) {
        transport = await createTransportContext(data);
      }
    } catch (error) {
      this.requestCount += 1;
      this.onRequest({
        operation,
        status: response?.status || "ERR",
        duration: Math.round(performance.now() - started),
        bytes: textEncoder.encode(text).byteLength,
        error: true,
        reason: error instanceof Error ? error.message : "network-error",
        silent: false,
      });
      throw error;
    }

    this.requestCount += 1;
    const status = Number(data.status || response.status);
    const cacheControl = response.headers.get("cache-control") || data["cache-control"] || "";
    this.cacheProved ||= cacheControl.toLowerCase().includes("no-store");
    const summary = {
      operation,
      status,
      duration: Math.round(performance.now() - started),
      bytes: textEncoder.encode(text).byteLength,
      error: !response.ok || status >= 400,
      reason: typeof data.reason === "string" ? data.reason : response.statusText,
      silent: false,
    };
    this.onRequest(summary);

    if (summary.error) {
      throw new DeviceRequestError(operation, status, summary.reason);
    }
    return transport;
  }

  async signedPost(operation, body, contentType, accept) {
    const identity = await this.identity;
    const headers = await hbSignedHeaders(
      identity,
      "POST",
      operation,
      contentType,
      body,
    );
    headers.accept = accept;
    return fetch(`${this.endpoint}${HYPERSTREAM_PATH}/${operation}`, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  }
}

async function createSigningIdentity() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 4096,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-512",
    },
    false,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  if (typeof publicKey.n !== "string") {
    throw new Error("The browser did not export a usable signing identity.");
  }
  return {
    privateKey: keyPair.privateKey,
    keyId: `publickey:${bytesToBase64(base64UrlToBytes(publicKey.n))}`,
  };
}

async function hbSignedHeaders(identity, method, path, contentType, body) {
  const contentHash = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  const fields = {
    "content-digest": `sha-256=:${bytesToBase64(contentHash)}:`,
    "content-type": contentType,
    device: HYPERSTREAM_DEVICE,
    method,
    path,
    type: "single",
  };
  const covered = [
    "content-digest",
    "content-type",
    "device",
    "method",
    "path",
    "type",
  ];
  const baseItems = covered
    .map((component) =>
      HB_DERIVED.has(component) ? `"@${component}"` : `"${component}"`,
    )
    .join(" ");
  const baseParams = `(${baseItems});alg="rsa-pss-sha512";keyid="${identity.keyId}"`;
  const base =
    covered.map((component) => `"${component}": ${fields[component]}`).join("\n") +
    `\n"@signature-params": ${baseParams}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "RSA-PSS", saltLength: 64 },
      identity.privateKey,
      textEncoder.encode(base),
    ),
  );
  const wireParams = `(${covered
    .map((component) => `"${component}"`)
    .join(" ")});alg="rsa-pss-sha512";keyid="${identity.keyId}"`;
  return {
    ...fields,
    "codec-device": "httpsig@1.0",
    "signature-input": `comm-http=${wireParams}`,
    signature: `comm-http=:${bytesToBase64(signature)}:`,
  };
}

async function createTransportContext(descriptor) {
  if (
    descriptor?.transport !== "hs1" ||
    descriptor?.algorithm !== TRANSPORT_ALGORITHM ||
    !validTransportPart(descriptor?.["key-id"])
  ) {
    throw new Error("The HyperBEAM node returned an unsupported transport key.");
  }
  const nodePublic = strictBase64UrlToBytes(descriptor["public-key"], 65);
  if (nodePublic[0] !== 4) {
    throw new Error("The HyperBEAM node returned an invalid transport key.");
  }
  const nodeKey = await crypto.subtle.importKey(
    "raw",
    nodePublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const clientKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const clientPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", clientKeys.publicKey),
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: nodeKey },
    clientKeys.privateKey,
    256,
  );
  const saltSource = new Uint8Array(nodePublic.length + clientPublic.length);
  saltSource.set(nodePublic);
  saltSource.set(clientPublic, nodePublic.length);
  const salt = await crypto.subtle.digest("SHA-256", saltSource);
  const keyMaterial = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: textEncoder.encode(
        `${HYPERSTREAM_DEVICE}/transport/${descriptor["key-id"]}`,
      ),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return {
    key,
    keyId: descriptor["key-id"],
    clientPublic: bytesToBase64Url(clientPublic),
  };
}

async function encryptTransportRequest(operation, value, transport) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = textEncoder.encode(JSON.stringify(value));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: transportAdditionalData("request", operation, transport.keyId),
        tagLength: 128,
      },
      transport.key,
      plaintext,
    ),
  );
  return textEncoder.encode(
    [
      "hs1",
      transport.keyId,
      transport.clientPublic,
      bytesToBase64Url(nonce),
      bytesToBase64Url(encrypted),
    ].join("."),
  );
}

async function decryptTransportResponse(operation, envelope, transport) {
  const parts = envelope.split(".");
  if (
    parts.length !== 4 ||
    parts[0] !== "hs1r" ||
    parts[1] !== transport.keyId
  ) {
    throw new Error("The HyperBEAM node returned an invalid transport response.");
  }
  const nonce = strictBase64UrlToBytes(parts[2], 12);
  const encrypted = strictBase64UrlToBytes(parts[3]);
  if (encrypted.length < 16) {
    throw new Error("The HyperBEAM node returned an invalid transport response.");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: transportAdditionalData("response", operation, transport.keyId),
      tagLength: 128,
    },
    transport.key,
    encrypted,
  );
  const value = JSON.parse(textDecoder.decode(plaintext));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The HyperBEAM node returned an invalid JSON response.");
  }
  return value;
}

function transportAdditionalData(direction, operation, keyId) {
  return textEncoder.encode(
    `hyperstream-transport@1\u0000${direction}\u0000${operation}\u0000${keyId}`,
  );
}

function validTransportPart(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function validTransportOperation(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[a-z0-9-]+$/.test(value)
  );
}

function strictBase64UrlToBytes(value, expectedLength) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error("The HyperBEAM node returned invalid transport encoding.");
  }
  const bytes = base64UrlToBytes(value);
  if (
    bytesToBase64Url(bytes) !== value ||
    (expectedLength !== undefined && bytes.length !== expectedLength)
  ) {
    throw new Error("The HyperBEAM node returned invalid transport encoding.");
  }
  return bytes;
}

export class Telemetry {
  constructor(logElement, emptyElement, maxRows = 80) {
    this.logElement = logElement;
    this.emptyElement = emptyElement;
    this.maxRows = maxRows;
    this.startAt = 0;
  }

  reset() {
    this.logElement.querySelectorAll(".event-row").forEach((row) => row.remove());
    this.emptyElement.hidden = false;
    this.startAt = performance.now();
  }

  add({ source = "browser", code = "INFO", message, meta = "", error = false }) {
    this.emptyElement.hidden = true;
    const row = document.createElement("div");
    row.className = `event-row${error ? " error" : ""}`;

    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = this.startAt
      ? `+${((performance.now() - this.startAt) / 1000).toFixed(2)}s`
      : new Date().toLocaleTimeString([], { hour12: false });

    const sourceNode = document.createElement("span");
    sourceNode.className = "event-source";
    sourceNode.textContent = source;

    const codeNode = document.createElement("span");
    codeNode.className = "event-code";
    codeNode.textContent = code;

    const messageNode = document.createElement("span");
    messageNode.className = "event-message";
    messageNode.textContent = message;

    const metaNode = document.createElement("span");
    metaNode.className = "event-meta";
    metaNode.textContent = meta;

    row.append(time, sourceNode, codeNode, messageNode, metaNode);
    this.logElement.append(row);

    while (this.logElement.querySelectorAll(".event-row").length > this.maxRows) {
      this.logElement.querySelector(".event-row")?.remove();
    }
    this.logElement.scrollTop = this.logElement.scrollHeight;
  }
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64UrlToBytes(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validIdentifier(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0);
      return code >= 33 && code <= 126;
    })
  );
}
