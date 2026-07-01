const { fetchStreamUrl } = require('./fetchStreamUrl');

const config = require('../../config.cjs');

const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const { getHomepage } = require('./homepageApi');

const { getHtml } = require('./html');

const { getMinVersion } = require('./minVersion');

const { getOEmbed } = require('./oEmbed');

const { getRss } = require('./rss');

const { getFarcasterManifest } = require('./farcaster');

const { handleFramePost } = require('./frame');

const { getTempFile } = require('./tempfile');

const { getSpinnerHtml } = require('./spinner');

const { getLlmsTxt } = require('./llms');

const Router = require('@koa/router');

// So any code from 'lbry-redux'/'lbryinc' that uses `fetch` can be run on the server
global.fetch = globalThis.fetch;
const router = new Router();
const RSS_MEDIA_AUTH_DEFAULT_TTL_SECONDS = 600;
const RSS_MEDIA_AUTH_MAX_TTL_SECONDS = 600;
const AUTH_TOKEN_COOKIE = 'auth_token';
const HYPERBEAM_AUTH_DEVICE_PREFIX = '/$/api/hyperbeam-auth-device/v1';
const HYPERBEAM_UPLOAD_PATH = '/~odysee-upload@1.0/write?!=true';
const HYPERBEAM_UPLOAD_CHUNK_PATH = '/~odysee-upload@1.0/chunk?!=true';
const HYPERBEAM_UPLOAD_FINALIZE_PATH = '/~odysee-upload@1.0/finalize?!=true';
const HYPERBEAM_UPLOAD_INDEX_PATH = '/~odysee-upload@1.0/index?!=true';
const HYPERBEAM_UPLOAD_LIST_PATH = '/~odysee-upload@1.0/list';
const HYPERBEAM_UPLOAD_DELETE_PATH = '/~odysee-upload@1.0/delete?!=true';
const HYPERBEAM_THUMBNAIL_UPLOAD_PATH = '/~odysee-product-events@1.0/thumbnail-upload';
const HYPERBEAM_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const HYPERBEAM_UPLOAD_MANIFEST_TYPE = 'application/vnd.odysee.hyperbeam-upload-manifest+json';
const HYPERBEAM_UPLOAD_MANIFEST_KIND = 'odysee-hyperbeam-chunked-upload';
const HYPERBEAM_AUTH_DEVICE_PATHS = new Set([
  '/~odysee-account@1.0/preference-get',
  '/~odysee-account@1.0/preference-set',
  '/~odysee-account@1.0/settings-get',
  '/~odysee-account@1.0/settings-set',
  '/~odysee-account@1.0/settings-clear',
  '/~odysee-account@1.0/user-exists',
  '/~odysee-account@1.0/user-new',
  '/~odysee-account@1.0/user-signin',
  '/~odysee-account@1.0/user-me',
  '/~odysee-account@1.0/user-email-resend-token',
  '/~odysee-comment@1.0/create',
  '/~odysee-comment@1.0/edit',
  '/~odysee-comment@1.0/pin',
  '/~odysee-comment@1.0/abandon',
  '/~odysee-comment@1.0/reaction-react',
  '/~odysee-comment@1.0/setting-get',
  '/~odysee-comment@1.0/setting-list',
  '/~odysee-comment@1.0/setting-update',
  '/~odysee-comment@1.0/setting-block-word',
  '/~odysee-comment@1.0/setting-unblock-word',
  '/~odysee-comment@1.0/setting-list-blocked-words',
  '/~odysee-comment@1.0/moderation-block',
  '/~odysee-comment@1.0/moderation-unblock',
  '/~odysee-comment@1.0/moderation-block-list',
  '/~odysee-comment@1.0/moderation-add-delegate',
  '/~odysee-comment@1.0/moderation-remove-delegate',
  '/~odysee-comment@1.0/moderation-list-delegates',
  '/~odysee-comment@1.0/moderation-am-i',
  '/~odysee-file@1.0/view-count',
  '/~odysee-file-reaction@1.0/list',
  '/~odysee-subscription@1.0/sub-count',
]);

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;

  const prefix = `${name}=`;
  const cookies = String(cookieHeader).split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }

  return null;
}

function hyperbeamNodeUrl() {
  return String(config.HYPERBEAM_BASE_URL || config.ODYSEE_HYPERBEAM_NODE_API || '').replace(/\/+$/, '');
}

async function readJsonBody(ctx) {
  if (ctx.request && ctx.request.body && Object.keys(ctx.request.body).length) {
    return ctx.request.body;
  }

  const chunks = [];
  await new Promise((resolve, reject) => {
    ctx.req.on('data', (chunk) => chunks.push(chunk));
    ctx.req.on('end', resolve);
    ctx.req.on('error', reject);
  });

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function postHyperbeamAuthDevice(ctx) {
  const devicePath = `/${ctx.params.device}/${ctx.params.method}`;
  const nodeUrl = hyperbeamNodeUrl();

  if (!nodeUrl || !HYPERBEAM_AUTH_DEVICE_PATHS.has(devicePath)) {
    ctx.status = 404;
    ctx.body = { error: 'unsupported hyperbeam auth device path' };
    return;
  }

  const authToken = getRequestAuthToken(ctx);
  const requestBody = await readJsonBody(ctx);
  const body = authToken ? { ...requestBody, auth_token: authToken } : requestBody;

  const response = await postJson(`${nodeUrl}${devicePath}`, body);

  ctx.status = response.statusCode;
  ctx.set('Cache-Control', 'no-store');
  ctx.set('Content-Type', response.headers['content-type'] || 'application/json');
  ctx.body = response.body;
}

async function postHyperbeamUpload(ctx) {
  const nodeUrl = hyperbeamNodeUrl();

  if (!nodeUrl) {
    ctx.status = 404;
    ctx.body = { error: 'hyperbeam node unavailable' };
    return;
  }

  const cookieHeader = ctx.get('cookie');
  const authToken = ctx.cookies.get(AUTH_TOKEN_COOKIE) || getCookieValue(cookieHeader, AUTH_TOKEN_COOKIE);

  const response = await postStream(`${nodeUrl}${HYPERBEAM_UPLOAD_PATH}`, ctx.req, {
    'content-type': ctx.get('content-type') || 'application/octet-stream',
    ...(ctx.get('content-length') ? { 'content-length': ctx.get('content-length') } : {}),
    ...(authToken ? { 'x-odysee-auth-token': authToken } : {}),
  });

  ctx.status = response.statusCode;
  ctx.set('Cache-Control', 'no-store');
  copyHeader(ctx, response.headers, 'content-type');
  copyHeader(ctx, response.headers, 'id');
  copyHeader(ctx, response.headers, 'path');
  copyHeader(ctx, response.headers, 'read-path');
  copyHeader(ctx, response.headers, 'url');
  copyHeader(ctx, response.headers, 'signers');
  copyHeader(ctx, response.headers, 'signers+link');
  ctx.body = response.body;
}

async function postHyperbeamLargeUpload(ctx) {
  const nodeUrl = hyperbeamNodeUrl();

  if (!nodeUrl) {
    ctx.status = 404;
    ctx.body = { error: 'hyperbeam node unavailable' };
    return;
  }

  const authToken = getRequestAuthToken(ctx);
  if (!authToken) {
    ctx.status = 401;
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { error: 'auth_token cookie required' };
    return;
  }

  const startedAt = Date.now();
  const contentType = ctx.get('content-type') || 'application/octet-stream';
  const filename = ctx.get('x-odysee-filename') || null;
  const chunks = [];
  const fileHash = crypto.createHash('sha256');
  let pending = Buffer.alloc(0);
  let totalBytes = 0;

  for await (const part of ctx.req) {
    pending = Buffer.concat([pending, part]);

    while (pending.length >= HYPERBEAM_UPLOAD_CHUNK_SIZE) {
      const chunk = pending.subarray(0, HYPERBEAM_UPLOAD_CHUNK_SIZE);
      pending = pending.subarray(HYPERBEAM_UPLOAD_CHUNK_SIZE);
      chunks.push(await writeHyperbeamUploadChunk(nodeUrl, authToken, chunk, chunks.length));
      fileHash.update(chunk);
      totalBytes += chunk.length;
    }
  }

  if (pending.length) {
    chunks.push(await writeHyperbeamUploadChunk(nodeUrl, authToken, pending, chunks.length));
    fileHash.update(pending);
    totalBytes += pending.length;
  }

  const manifest = {
    type: HYPERBEAM_UPLOAD_MANIFEST_KIND,
    version: 1,
    filename,
    content_type: contentType,
    size: totalBytes,
    sha256: fileHash.digest('hex'),
    chunk_size: HYPERBEAM_UPLOAD_CHUNK_SIZE,
    chunk_count: chunks.length,
    chunks,
    created_at: new Date(startedAt).toISOString(),
  };
  const manifestBody = Buffer.from(JSON.stringify(manifest));
  const finalizeResponse = await postBuffer(`${nodeUrl}${HYPERBEAM_UPLOAD_FINALIZE_PATH}`, manifestBody, {
    'content-type': HYPERBEAM_UPLOAD_MANIFEST_TYPE,
    'content-length': manifestBody.length,
    'x-odysee-auth-token': authToken,
  });
  const finalizeJson = parseJsonBuffer(finalizeResponse.body);

  ctx.status = finalizeResponse.statusCode;
  ctx.set('Cache-Control', 'no-store');
  copyHeader(ctx, finalizeResponse.headers, 'content-type');
  copyHeader(ctx, finalizeResponse.headers, 'id');
  copyHeader(ctx, finalizeResponse.headers, 'path');
  copyHeader(ctx, finalizeResponse.headers, 'read-path');
  copyHeader(ctx, finalizeResponse.headers, 'url');
  copyHeader(ctx, finalizeResponse.headers, 'signers');
  copyHeader(ctx, finalizeResponse.headers, 'signers+link');
  ctx.body = {
    id: finalizeJson && finalizeJson.id ? finalizeJson.id : finalizeResponse.headers.id,
    read_path: finalizeJson && finalizeJson.read_path ? finalizeJson.read_path : finalizeResponse.headers['read-path'],
    size: totalBytes,
    sha256: manifest.sha256,
    chunk_size: HYPERBEAM_UPLOAD_CHUNK_SIZE,
    chunk_count: chunks.length,
    chunks,
  };
}

async function postHyperbeamUploadIndex(ctx) {
  const nodeUrl = hyperbeamNodeUrl();

  if (!nodeUrl) {
    ctx.status = 404;
    ctx.body = { error: 'hyperbeam node unavailable' };
    return;
  }

  const authToken = getRequestAuthToken(ctx);
  if (!authToken) {
    ctx.status = 401;
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { error: 'auth_token cookie required' };
    return;
  }

  const requestBody = await readJsonBody(ctx);
  const claim = requestBody.claim || requestBody;
  const encodedClaim = Buffer.from(JSON.stringify(claim)).toString('base64url');
  const response = await postJson(
    `${nodeUrl}${HYPERBEAM_UPLOAD_INDEX_PATH}`,
    { claim },
    {
      authorization: `Bearer ${authToken}`,
      'x-odysee-auth-token': authToken,
      'auth-token': authToken,
      'x-odysee-upload-claim': encodedClaim,
    }
  );
  const contentType = String(response.headers['content-type'] || '');

  ctx.status = response.statusCode;
  ctx.set('Cache-Control', 'no-store');
  if (contentType.includes('text/html') || looksLikeHtml(response.body)) {
    ctx.set('Content-Type', 'application/json');
    ctx.body = {
      error: 'HyperBEAM upload index returned HTML instead of JSON',
      status: response.statusCode,
      route: HYPERBEAM_UPLOAD_INDEX_PATH,
      hyperbeam_details: response.headers.details || response.headers['www-authenticate'] || undefined,
      html: htmlResponseDetails(response.body),
    };
    return;
  }

  ctx.set('Content-Type', contentType || 'application/json');
  ctx.body = response.body;
}

async function postHyperbeamThumbnailUpload(ctx) {
  const nodeUrl = hyperbeamNodeUrl();

  if (!nodeUrl) {
    ctx.status = 404;
    ctx.body = { error: 'hyperbeam node unavailable' };
    return;
  }

  const requestBody = await readJsonBody(ctx);
  const response = await postJson(`${nodeUrl}${HYPERBEAM_THUMBNAIL_UPLOAD_PATH}`, requestBody, {
    host: new URL(nodeUrl).host,
  });

  ctx.status = response.statusCode;
  ctx.set('Cache-Control', 'no-store');
  ctx.set('Content-Type', response.headers['content-type'] || 'application/json');
  ctx.body = response.body;
}

async function postHyperbeamUploadList(ctx) {
  const nodeUrl = hyperbeamNodeUrl();

  if (!nodeUrl) {
    ctx.status = 404;
    ctx.body = { error: 'hyperbeam node unavailable' };
    return;
  }

  const requestBody = await readJsonBody(ctx);
  const authToken = getRequestAuthToken(ctx);
  const channelIds = ctx.get('x-odysee-channel-ids');
  const claimIds = ctx.get('x-odysee-claim-ids');
  const headers = {
    ...(authToken ? { 'x-odysee-auth-token': authToken } : {}),
    ...(channelIds ? { 'x-odysee-channel-ids': channelIds } : {}),
    ...(claimIds ? { 'x-odysee-claim-ids': claimIds } : {}),
  };
  const response = await postJson(`${nodeUrl}${HYPERBEAM_UPLOAD_LIST_PATH}`, requestBody, headers);

  ctx.status = response.statusCode;
  ctx.set('Cache-Control', 'no-store');
  ctx.set('Content-Type', response.headers['content-type'] || 'application/json');
  ctx.body = response.body;
}

async function postHyperbeamUploadDelete(ctx) {
  const nodeUrl = hyperbeamNodeUrl();

  if (!nodeUrl) {
    ctx.status = 404;
    ctx.body = { error: 'hyperbeam node unavailable' };
    return;
  }

  const authToken = getRequestAuthToken(ctx);
  if (!authToken) {
    ctx.status = 401;
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { error: 'auth_token cookie required' };
    return;
  }

  const requestBody = await readJsonBody(ctx);
  const uploadId = String(
    requestBody.id ||
      requestBody.immutable_id ||
      requestBody.immutableId ||
      requestBody.upload_id ||
      requestBody.uploadId ||
      requestBody.claim_id ||
      requestBody.claimId ||
      ''
  ).trim();
  if (!uploadId) {
    ctx.status = 400;
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { error: 'upload id required' };
    return;
  }

  const response = await postJson(
    `${nodeUrl}${HYPERBEAM_UPLOAD_DELETE_PATH}`,
    { id: uploadId, immutable_id: uploadId },
    {
      'x-odysee-auth-token': authToken,
      'x-odysee-upload-id': uploadId,
    }
  );

  ctx.status = response.statusCode;
  ctx.set('Cache-Control', 'no-store');
  ctx.set('Content-Type', response.headers['content-type'] || 'application/json');
  ctx.body = response.body;
}

async function getHyperbeamLargeUpload(ctx) {
  const nodeUrl = hyperbeamNodeUrl();
  const id = ctx.params.id;

  if (!nodeUrl) {
    ctx.status = 404;
    ctx.body = { error: 'hyperbeam node unavailable' };
    return;
  }

  const manifestResponse = await getBuffer(hyperbeamReadUrl(nodeUrl, id), { accept: 'application/json' });
  const manifest = await uploadManifestFromResponse(nodeUrl, id, manifestResponse);

  if (!manifest || manifest.type !== HYPERBEAM_UPLOAD_MANIFEST_KIND || !Array.isArray(manifest.chunks)) {
    ctx.status = manifestResponse.statusCode;
    copyHeader(ctx, manifestResponse.headers, 'content-type');
    ctx.body = manifestResponse.body;
    return;
  }

  const totalSize = Number(manifest.size);
  const hasSize = Number.isFinite(totalSize) && totalSize >= 0;
  const range = parseByteRange(ctx.get('range'), hasSize ? totalSize : null);
  if (ctx.get('range') && hasSize && !range) {
    ctx.status = 416;
    ctx.set('Cache-Control', 'no-store');
    ctx.set('Accept-Ranges', 'bytes');
    ctx.set('Content-Range', `bytes */${totalSize}`);
    return;
  }

  if (ctx.method === 'HEAD') {
    ctx.status = range ? 206 : 200;
    ctx.set('Cache-Control', 'no-store');
    ctx.set('Accept-Ranges', 'bytes');
    ctx.set('Content-Type', manifest.content_type || 'application/octet-stream');
    ctx.set('X-Odysee-Hyperbeam-Upload-Id', id);
    ctx.set('X-Odysee-Hyperbeam-Chunk-Count', String(manifest.chunks.length));
    if (range) {
      ctx.set('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
      ctx.set('Content-Length', String(range.end - range.start + 1));
    } else if (hasSize) {
      ctx.set('Content-Length', String(totalSize));
    }
    return;
  }

  ctx.respond = false;
  ctx.res.statusCode = range ? 206 : 200;
  ctx.res.setHeader('Cache-Control', 'no-store');
  ctx.res.setHeader('Accept-Ranges', 'bytes');
  ctx.res.setHeader('Content-Type', manifest.content_type || 'application/octet-stream');
  ctx.res.setHeader('X-Odysee-Hyperbeam-Upload-Id', id);
  ctx.res.setHeader('X-Odysee-Hyperbeam-Chunk-Count', String(manifest.chunks.length));
  if (range) {
    ctx.res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
    ctx.res.setHeader('Content-Length', String(range.end - range.start + 1));
  } else if (hasSize) {
    ctx.res.setHeader('Content-Length', String(totalSize));
  }

  try {
    let offset = 0;
    for (const chunk of manifest.chunks) {
      const chunkSize = Number(chunk.size);
      const nextOffset = offset + (Number.isFinite(chunkSize) ? chunkSize : 0);
      if (range && Number.isFinite(chunkSize) && (nextOffset <= range.start || offset > range.end)) {
        offset = nextOffset;
        continue;
      }

      const chunkResponse = await getBuffer(hyperbeamReadUrl(nodeUrl, chunk.id));
      if (range && Number.isFinite(chunkSize)) {
        const start = Math.max(0, range.start - offset);
        const end = Math.min(chunkResponse.body.length - 1, range.end - offset);
        if (start <= end) ctx.res.write(chunkResponse.body.subarray(start, end + 1));
      } else {
        ctx.res.write(chunkResponse.body);
      }
      offset = nextOffset;
    }
    ctx.res.end();
  } catch (error) {
    ctx.res.destroy(error);
  }
}

async function uploadManifestFromResponse(nodeUrl, id, response) {
  const payload = parseJsonBuffer(response.body);
  const direct = responsePayload(payload);
  if (direct && direct.type === HYPERBEAM_UPLOAD_MANIFEST_KIND && Array.isArray(direct.chunks)) return direct;

  const linkMediaId = await mediaIdFromHyperbeamLink(nodeUrl, id, direct);
  const mediaId = linkMediaId || mediaIdFromClaim(direct);
  if (!mediaId) return direct;

  const mediaResponse = await getBuffer(hyperbeamReadUrl(nodeUrl, mediaId), { accept: 'application/json' });
  const manifest = responsePayload(parseJsonBuffer(mediaResponse.body));
  if (manifest && manifest.type === HYPERBEAM_UPLOAD_MANIFEST_KIND && Array.isArray(manifest.chunks)) return manifest;
  if (mediaId !== id) return uploadManifestFromResponse(nodeUrl, mediaId, mediaResponse);
  return manifest;
}

async function mediaIdFromHyperbeamLink(nodeUrl, id, claim) {
  if (!claim || typeof claim !== 'object') return '';

  const hyperbeam = claim.hyperbeam || claim['hyperbeam'];
  if (hyperbeam && typeof hyperbeam === 'object') {
    const mediaId = mediaIdFromClaim({ hyperbeam });
    if (mediaId) return mediaId;
  }

  const hyperbeamResponse = await getBuffer(`${hyperbeamReadUrl(nodeUrl, id)}/hyperbeam`, {
    accept: 'application/json',
  });
  if (hyperbeamResponse.statusCode < 200 || hyperbeamResponse.statusCode >= 300) return '';
  return mediaIdFromHeaders(hyperbeamResponse.headers) || mediaIdFromClaim(responsePayload(parseJsonBuffer(hyperbeamResponse.body)));
}

function responsePayload(payload) {
  if (!payload) return payload;
  const body = typeof payload.body === 'string' ? parseJsonString(payload.body) : null;
  const value = body || payload;

  if (value && value.result !== undefined) return value.result;
  if (value && value.data !== undefined) return value.data;
  return value;
}

function mediaIdFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') return '';
  const readPath = String(headers.read_path || headers['read-path'] || '').replace(/^\/+/, '');
  return String(headers.media_id || headers['media-id'] || headers.upload_id || headers['upload-id'] || readPath || '').replace(
    /^\/+/,
    ''
  );
}

function mediaIdFromClaim(claim) {
  if (!claim || typeof claim !== 'object') return '';

  const hyperbeam = claim.hyperbeam || claim['hyperbeam'];
  const source = claim.value && claim.value.source ? claim.value.source : {};
  return String(
    (hyperbeam && (hyperbeam.media_id || hyperbeam.mediaId || hyperbeam.upload_id || hyperbeam.uploadId)) ||
      source.sd_hash ||
      source.sdHash ||
      ''
  ).replace(/^\//, '');
}

function parseByteRange(header, totalSize) {
  if (!header || !Number.isFinite(totalSize) || totalSize <= 0) return null;
  const match = String(header).match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return null;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(0, totalSize - suffixLength);
    return { start, end: totalSize - 1 };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : totalSize - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalSize) return null;

  return { start, end: Math.min(end, totalSize - 1) };
}

function hyperbeamReadUrl(nodeUrl, id) {
  const path = String(id)
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${nodeUrl}/${path}`;
}

function getRequestAuthToken(ctx) {
  const cookieHeader = ctx.get('cookie');
  return (
    ctx.cookies.get(AUTH_TOKEN_COOKIE) ||
    getCookieValue(cookieHeader, AUTH_TOKEN_COOKIE) ||
    ctx.get('x-odysee-auth-token') ||
    ctx.get('x-lbry-auth-token')
  );
}

async function writeHyperbeamUploadChunk(nodeUrl, authToken, chunk, index) {
  const sha256 = crypto.createHash('sha256').update(chunk).digest('hex');
  const response = await postBuffer(`${nodeUrl}${HYPERBEAM_UPLOAD_CHUNK_PATH}`, chunk, {
    'content-type': 'application/octet-stream',
    'content-length': chunk.length,
    'x-odysee-auth-token': authToken,
    'x-odysee-upload-chunk-index': String(index),
    'x-odysee-upload-chunk-sha256': sha256,
  });
  const body = parseJsonBuffer(response.body);
  const id = body && body.id ? body.id : response.headers.id;

  if (response.statusCode < 200 || response.statusCode >= 300 || !id) {
    throw new Error(`HyperBEAM chunk write failed at ${index}: ${response.statusCode}`);
  }

  return {
    index,
    id,
    size: chunk.length,
    sha256,
  };
}

function copyHeader(ctx, headers, name) {
  const value = headers[name];
  if (value) ctx.set(name, value);
}

function parseJsonBuffer(body) {
  try {
    return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
  } catch {
    return null;
  }
}

function parseJsonString(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function looksLikeHtml(body) {
  return /<!doctype html|<html[\s>]/i.test(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || ''));
}

function htmlResponseDetails(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  const title = text.match(/<title>([^<]*)<\/title>/i)?.[1];
  const bodyText = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    title: title || null,
    text: bodyText.slice(0, 500),
  };
}

function postJson(url, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  return postBuffer(url, body, {
    'content-type': 'application/json',
    'content-length': body.length,
    ...extraHeaders,
  });
}

function postStream(url, stream, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        insecureHTTPParser: true,
        headers: extraHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on('error', reject);
    stream.on('error', reject);
    stream.pipe(req);
  });
}

function postBuffer(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        insecureHTTPParser: true,
        headers: extraHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

function getBuffer(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        insecureHTTPParser: true,
        headers: extraHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function getStreamUrl(ctx) {
  const { claimName, claimId } = ctx.params;
  return await fetchStreamUrl(claimName, claimId);
}

function buildRssMediaRedirectUrl(streamUrl, now = Date.now()) {
  let redirectUrl;

  try {
    redirectUrl = new URL(streamUrl);
  } catch {
    return null;
  }

  if (!isAllowedRssMediaRedirectUrl(redirectUrl)) {
    return null;
  }

  redirectUrl.searchParams.set('download', 'true');
  redirectUrl.searchParams.set('magic', String(Math.round(now / 1000)));
  if (!addRssMediaAuthParams(redirectUrl, now)) {
    return null;
  }
  return redirectUrl.toString();
}

function addRssMediaAuthParams(redirectUrl, now) {
  const secret = config.RSS_MEDIA_AUTH_SECRET;
  if (!secret) {
    return true;
  }

  const parts = getRssMediaStreamParts(redirectUrl);
  if (!parts) {
    return false;
  }

  const ttlSeconds = getRssMediaAuthTTLSeconds();
  if (!ttlSeconds) {
    return false;
  }

  const expiration = Math.round(now / 1000) + ttlSeconds;
  const signature = signRssMediaAuth(secret, parts.claimId, parts.sdHash, expiration);
  redirectUrl.searchParams.set('rss_claim', parts.claimId);
  redirectUrl.searchParams.set('rss_sd', parts.sdHash);
  redirectUrl.searchParams.set('rss_exp', String(expiration));
  redirectUrl.searchParams.set('rss_sig', signature);
  return true;
}

function getRssMediaStreamParts(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const streamsIndex = parts.indexOf('streams');
  const version = parts[streamsIndex - 1];
  const claimId = parts[streamsIndex + 1];
  const sdHash = normalizeRssMediaAuthSD(parts[streamsIndex + 2]);

  if (streamsIndex < 0 || version !== 'v6' || !claimId || !sdHash || !/^[0-9a-f]{40}$/i.test(claimId)) {
    return null;
  }
  return {
    claimId: claimId.toLowerCase(),
    sdHash,
  };
}

function normalizeRssMediaAuthSD(value) {
  if (!value) {
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(value).toLowerCase();
  } catch {
    return null;
  }
  const withoutExtension = decoded.replace(/\.[^.]*$/, '');
  if (!/^[0-9a-f]{6,96}$/.test(withoutExtension)) {
    return null;
  }
  return withoutExtension;
}

function getRssMediaAuthTTLSeconds() {
  const rawTTL = config.RSS_MEDIA_AUTH_TTL_SECONDS || String(RSS_MEDIA_AUTH_DEFAULT_TTL_SECONDS);
  if (!/^\d+$/.test(rawTTL)) {
    return 0;
  }
  const ttlSeconds = Number.parseInt(rawTTL, 10);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > RSS_MEDIA_AUTH_MAX_TTL_SECONDS) {
    return 0;
  }
  return ttlSeconds;
}

function signRssMediaAuth(secret, claimId, sdHash, expiration) {
  return crypto
    .createHmac('sha256', secret)
    .update(`rss-v1\n${claimId.toLowerCase()}\n${sdHash.toLowerCase()}\n${expiration}`)
    .digest('base64url');
}

function getHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedRssMediaRedirectUrl(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  const playerHostname = getHostname(config.PLAYER_SERVER);

  return hostname === playerHostname || hostname === 'odycdn.com' || hostname.endsWith('.odycdn.com');
}

const rssMiddleware = async (ctx) => {
  const rss = await getRss(ctx);

  if (rss.startsWith('<?xml')) {
    ctx.set('Content-Type', 'application/xml');
  }

  ctx.body = rss;
};

const oEmbedMiddleware = async (ctx) => {
  const oEmbed = await getOEmbed(ctx);
  ctx.body = oEmbed;
};

const tempfileMiddleware = async (ctx) => {
  const temp = await getTempFile(ctx);
  ctx.body = temp;
};

const rssMediaMiddleware = async (ctx) => {
  const streamUrl = await getStreamUrl(ctx);

  if (!streamUrl) {
    ctx.status = 404;
    ctx.body = '';
    return;
  }

  const redirectUrl = buildRssMediaRedirectUrl(streamUrl);
  if (!redirectUrl) {
    ctx.status = 502;
    ctx.body = 'Invalid stream URL';
    return;
  }

  ctx.set('Cache-Control', 'no-store');
  ctx.redirect(redirectUrl);
};

const fcManifestMiddleware = async (ctx) => {
  const manifest = await getFarcasterManifest(ctx);
  ctx.set('Content-Type', 'application/json');
  ctx.body = manifest;
};

router.get(`/$/favicon`, async (ctx) => {
  const domain = ctx.query.d;
  if (!domain || typeof domain !== 'string' || !/^[a-z0-9.-]+$/i.test(domain)) {
    ctx.status = 400;
    return;
  }

  const faviconCache = router._faviconCache || (router._faviconCache = new Map());
  const cached = faviconCache.get(domain);
  if (cached) {
    if (cached.status === 404) {
      ctx.status = 404;
      ctx.body = '';
      return;
    }
    ctx.set('Content-Type', cached.contentType);
    ctx.set('Cache-Control', 'public, max-age=604800');
    ctx.body = cached.buffer;
    return;
  }

  async function tryFetch(url) {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      if (ct.startsWith('image/') || ct.includes('icon')) {
        return { buffer: Buffer.from(await res.arrayBuffer()), contentType: ct };
      }
    }
    return null;
  }

  function serve(result) {
    faviconCache.set(domain, result);
    ctx.set('Content-Type', result.contentType);
    ctx.set('Cache-Control', 'public, max-age=604800');
    ctx.body = result.buffer;
  }

  // Try common paths in parallel
  const paths = ['/favicon.ico', '/favicon-32x32.png', '/favicon-16x16.png', '/apple-touch-icon.png'];
  const results = await Promise.allSettled(paths.map((p) => tryFetch(`https://${domain}${p}`)));
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      serve(r.value);
      return;
    }
  }

  // Fallback: parse HTML for <link rel="icon">
  try {
    const html = await fetch(`https://${domain}`, { redirect: 'follow', signal: AbortSignal.timeout(3000) }).then((r) =>
      r.text()
    );
    const match =
      html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i) ||
      html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
    if (match && match[1]) {
      let iconUrl = match[1];
      if (iconUrl.startsWith('//')) iconUrl = 'https:' + iconUrl;
      else if (iconUrl.startsWith('/')) iconUrl = `https://${domain}${iconUrl}`;
      else if (!iconUrl.startsWith('http')) iconUrl = `https://${domain}/${iconUrl}`;
      const result = await tryFetch(iconUrl);
      if (result) {
        serve(result);
        return;
      }
    }
  } catch {}

  faviconCache.set(domain, { status: 404 });
  ctx.status = 404;
  ctx.body = '';
});

router.get(`/$/minVersion/v1/get`, async (ctx) => getMinVersion(ctx));
router.get(`/$/api/auth-token/v1/get`, async (ctx) => {
  const cookieHeader = ctx.get('cookie');
  const authToken = ctx.cookies.get(AUTH_TOKEN_COOKIE) || getCookieValue(cookieHeader, AUTH_TOKEN_COOKIE);
  const cookieNames = cookieHeader
    .split(';')
    .map((part) => part.trim().split('=')[0])
    .filter(Boolean);

  ctx.set('Cache-Control', 'no-store');
  ctx.body = {
    auth_cookie_present: Boolean(authToken),
    cookie_names: cookieNames,
  };
});
router.post(`${HYPERBEAM_AUTH_DEVICE_PREFIX}/:device/:method`, postHyperbeamAuthDevice);
router.post(`/$/api/hyperbeam-upload/v1/write`, postHyperbeamUpload);
router.post(`/$/api/hyperbeam-upload/v1/large`, postHyperbeamLargeUpload);
router.post(`/$/api/hyperbeam-upload/v1/index`, postHyperbeamUploadIndex);
router.post(`/$/api/hyperbeam-upload/v1/list`, postHyperbeamUploadList);
router.post(`/$/api/hyperbeam-upload/v1/delete`, postHyperbeamUploadDelete);
router.post(`/$/api/hyperbeam-thumbnail/v1/upload`, postHyperbeamThumbnailUpload);
router.head(`/$/api/hyperbeam-upload/v1/read/:id`, getHyperbeamLargeUpload);
router.get(`/$/api/hyperbeam-upload/v1/read/:id`, getHyperbeamLargeUpload);
router.get(`/$/api/content/v1/get`, async (ctx) => getHomepage(ctx, 1));
router.get(`/$/api/content/v2/get`, async (ctx) => getHomepage(ctx, 2));
router.get(`/$/download/:claimName/:claimId`, async (ctx) => {
  const streamUrl = await getStreamUrl(ctx);

  if (streamUrl) {
    const downloadUrl = buildRssMediaRedirectUrl(streamUrl);
    if (!downloadUrl) {
      ctx.status = 502;
      ctx.body = 'Invalid stream URL';
      return;
    }
    ctx.append('odysee-download', 'true');
    ctx.redirect(downloadUrl);
  }
});
router.get(`/$/stream/:claimName/:claimId`, async (ctx) => {
  const streamUrl = await getStreamUrl(ctx);

  if (streamUrl) {
    ctx.redirect(streamUrl);
  }
});
router.get(`/$/activate`, async (ctx) => {
  ctx.redirect(`https://sso.odysee.com/auth/realms/Users/device`);
});
// to add a path for a temp file on the server, customize this path
router.get('/.well-known/farcaster.json', fcManifestMiddleware);
router.get('/.well-known/:filename', tempfileMiddleware);
router.get(`/$/rss/media/:claimName/:claimId/:filename`, rssMediaMiddleware);
router.get(`/rss/:claimName/:claimId`, rssMiddleware);
router.get(`/rss/:claimName::claimId`, rssMiddleware);
router.get(`/rss/:channelRef`, rssMiddleware);
router.get(`/$/rss/:claimName/:claimId`, rssMiddleware);
router.get(`/$/rss/:claimName::claimId`, rssMiddleware);
router.get(`/$/rss/:channelRef`, rssMiddleware);
router.get(`/$/oembed`, oEmbedMiddleware);
router.get(`/$/spinner`, async (ctx) => {
  ctx.set('Content-Type', 'text/html');
  ctx.body = getSpinnerHtml(ctx);
});
router.get(`/$/llms.txt`, async (ctx) => {
  const llmsTxt = await getLlmsTxt();

  if (!llmsTxt) {
    ctx.status = 404;
    ctx.body = 'llms.txt not found';
    return;
  }

  ctx.set('Content-Type', 'text/plain; charset=utf-8');
  ctx.body = llmsTxt;
});
router.post(`/$/frame`, async (ctx) => {
  // Minimal JSON parser to avoid external dependencies
  try {
    const chunks = [];
    await new Promise((resolve) => {
      ctx.req.on('data', (c) => chunks.push(c));
      ctx.req.on('end', resolve);
    });
    const raw = Buffer.concat(chunks).toString('utf8');

    try {
      ctx.request.body = raw ? JSON.parse(raw) : {};
    } catch (e) {
      ctx.request.body = {};
    }
  } catch (e) {
    ctx.request.body = {};
  }

  await handleFramePost(ctx);
});
router.get('*', async (ctx, next) => {
  const requestedUrl = ctx.url;

  // Dev SSE livereload (web/index.js) must not be served as SPA HTML — router runs before that middleware.
  if (ctx.path === '/__livereload') {
    await next();
    return;
  }

  if (config.DYNAMIC_ROUTES_FIRST) {
    // Dynamic-first: let static middleware handle assets
    if (requestedUrl.startsWith('/public/') || requestedUrl === '/sw.js') {
      await next();
      return;
    }
  } else {
    // Static-first (prod): if a /public/ asset wasn't found by static, avoid claim collision
    if (
      requestedUrl.startsWith('/public/') &&
      (requestedUrl.endsWith('.js') || requestedUrl.endsWith('.css') || requestedUrl.startsWith('/public/assets/'))
    ) {
      ctx.status = 404;
      ctx.body = 'Resource not found';
      ctx.set('Cache-Control', 'no-store');
      return;
    }
    // Don't serve HTML for missing static files — return 404 so the browser
    // doesn't register HTML as a service worker or parse it as JSON.
    if (requestedUrl === '/sw.js' || requestedUrl.endsWith('.json') || requestedUrl.endsWith('.map')) {
      ctx.status = 404;
      ctx.body = 'Resource not found';
      ctx.set('Cache-Control', 'no-store');
      return;
    }
  }

  const html = await getHtml(ctx);

  // Only set body if not already redirecting (3xx status)
  if (ctx.status < 300 || ctx.status >= 400) {
    ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    ctx.set('Content-Type', 'text/html; charset=utf-8');
    ctx.body = html;
  }
});
module.exports = router;
