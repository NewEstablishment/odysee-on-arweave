const crypto = require('node:crypto');

const {
  hyperbeamNodeQueryPaths,
  hyperbeamNodeReadVerifiedMessages,
  hyperbeamNodeWriteNativeMessage,
} = require('./odyseeHyperbeamNode');

const SNAPSHOT_SCHEMA = 'odysee-homepage@1.0';
const SNAPSHOT_TYPE = 'homepage-snapshot';
const DEFAULT_LOOKBACK_HOURS = 168;

function snapshotEpochHour(timestamp) {
  return Math.floor(Number(timestamp) / 3600);
}

function homepageSnapshotMessage(language, homepage, timestamp = Math.floor(Date.now() / 1000)) {
  return {
    schema: SNAPSHOT_SCHEMA,
    type: SNAPSHOT_TYPE,
    language,
    'epoch-hour': snapshotEpochHour(timestamp),
    'created-at': timestamp,
    'content-hash': crypto.createHash('sha256').update(stableJson(homepage)).digest('base64url'),
    homepage,
  };
}

async function publishHomepageSnapshots(homepages, options = {}) {
  const write = options.write || hyperbeamNodeWriteNativeMessage;
  const readVerified = options.readVerified || hyperbeamNodeReadVerifiedMessages;
  const authToken = options.authToken;
  const expectedCommitter = options.expectedCommitter;
  const timestamp = options.timestamp || Math.floor(Date.now() / 1000);
  if (!authToken) throw new Error('Homepage snapshot publisher token is not configured');
  if (!expectedCommitter) throw new Error('Homepage snapshot publisher committer is not configured');

  const published = {};
  for (const [language, homepage] of Object.entries(homepages || {})) {
    const id = await write(homepageSnapshotMessage(language, homepage, timestamp), authToken);
    const [verified] = await readVerified([id], expectedCommitter);
    if (!verified || !isHomepageSnapshot(verified.payload, language)) {
      throw new Error(`Published ${language} homepage snapshot failed exact verification`);
    }
    published[language] = id;
  }
  return published;
}

async function discoverHomepageSnapshot(language, expectedCommitter, options = {}) {
  if (!language || !expectedCommitter) return null;
  const queryPaths = options.queryPaths || hyperbeamNodeQueryPaths;
  const readVerified = options.readVerified || hyperbeamNodeReadVerifiedMessages;
  const timestamp = options.timestamp || Math.floor(Date.now() / 1000);
  const lookbackHours = positiveInteger(options.lookbackHours, DEFAULT_LOOKBACK_HOURS);
  const currentEpoch = snapshotEpochHour(timestamp);

  for (let age = 0; age < lookbackHours; age += 1) {
    const paths = await queryPaths({
      schema: SNAPSHOT_SCHEMA,
      type: SNAPSHOT_TYPE,
      language,
      'epoch-hour': currentEpoch - age,
    });
    if (!paths.length) continue;
    const candidates = (await readVerified(paths, expectedCommitter)).filter(({ payload }) =>
      isHomepageSnapshot(payload, language)
    );
    candidates.sort(
      (left, right) =>
        Number(right.payload['created-at']) - Number(left.payload['created-at']) || right.id.localeCompare(left.id)
    );
    if (candidates.length) return candidates[0];
  }
  return null;
}

async function discoverHomepageSnapshots(languages, expectedCommitter, options = {}) {
  const entries = await Promise.all(
    Array.from(new Set((languages || []).map(String).filter(Boolean))).map(async (language) => {
      const snapshot = await discoverHomepageSnapshot(language, expectedCommitter, options);
      return [language, snapshot];
    })
  );
  return Object.fromEntries(
    entries.filter(([, snapshot]) => snapshot).map(([language, snapshot]) => [language, snapshot])
  );
}

function isHomepageSnapshot(payload, language) {
  if (
    !payload ||
    payload.schema !== SNAPSHOT_SCHEMA ||
    payload.type !== SNAPSHOT_TYPE ||
    payload.language !== language ||
    !Number.isSafeInteger(Number(payload['epoch-hour'])) ||
    !Number.isFinite(Number(payload['created-at'])) ||
    !payload.homepage ||
    typeof payload.homepage !== 'object'
  ) {
    return false;
  }
  const hash = crypto.createHash('sha256').update(stableJson(payload.homepage)).digest('base64url');
  return hash === payload['content-hash'];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  if (value === undefined) return undefined;
  return JSON.stringify(value);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

module.exports = {
  discoverHomepageSnapshot,
  discoverHomepageSnapshots,
  homepageSnapshotMessage,
  isHomepageSnapshot,
  publishHomepageSnapshots,
  snapshotEpochHour,
};
