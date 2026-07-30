import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4173", 10);
const root = fileURLToPath(new URL(".", import.meta.url));
const configuredNode = process.env.HYPERBEAM_ORIGIN;
const nodeSource = configuredNode ? new URL(configuredNode).origin : "http: https:";
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/watch.html", ["watch.html", "text/html; charset=utf-8"]],
  ["/favicon.ico", ["favicon.svg", "image/svg+xml"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/broadcaster.js", ["broadcaster.js", "text/javascript; charset=utf-8"]],
  ["/watch.js", ["watch.js", "text/javascript; charset=utf-8"]],
  ["/shared.js", ["shared.js", "text/javascript; charset=utf-8"]],
]);
const headers = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    `default-src 'none'; script-src 'self'; style-src 'self'; connect-src ${nodeSource} stun: turn: turns:; img-src 'self' data:; media-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
};

function reply(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    ...headers,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method || "")) {
    reply(response, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url || "/", "http://localhost").pathname;
  } catch {
    reply(response, 400, "Bad Request\n");
    return;
  }

  const entry = files.get(pathname);
  if (!entry) {
    reply(response, 404, "Not Found\n");
    return;
  }

  const [filename, contentType] = entry;
  const path = fileURLToPath(new URL(filename, `file://${root}`));
  try {
    const metadata = await stat(path);
    response.writeHead(200, {
      ...headers,
      "Content-Type": contentType,
      "Content-Length": metadata.size,
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(path).pipe(response);
  } catch {
    reply(response, 500, "Internal Server Error\n");
  }
});

server.listen(port, host);
