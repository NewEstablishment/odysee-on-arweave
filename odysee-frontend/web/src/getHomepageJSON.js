const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  HOMEPAGE_HYPERBEAM_AUTH_TOKEN,
  HOMEPAGE_SNAPSHOT_COMMITTER,
  HOMEPAGE_SNAPSHOT_LOOKBACK_HOURS,
} = require('../../config.cjs');
const {
  homepageClaimUri,
  homepageSnapshotPath,
  materializeHomepageData,
  readHomepageSnapshot,
  writeHomepageSnapshot,
} = require('./homepageMaterializer');
const { discoverHomepageSnapshots, publishHomepageSnapshots } = require('./homepageNativeSnapshot');

const memo = {};
const FORMAT = {
  ROKU: 'roku',
};
const NATIVE_SNAPSHOT_CACHE_MS = 60 * 1000;

function walkFiles(dir, handler) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  entries.forEach((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, handler);
      return;
    }

    handler(fullPath);
  });
}

function normalizeHomepageDir(dir) {
  walkFiles(dir, (fullPath) => {
    if (fullPath.endsWith('.js')) {
      fs.renameSync(fullPath, fullPath.replace(/\.js$/, '.cjs'));
    }
  });

  walkFiles(dir, (fullPath) => {
    if (fullPath.endsWith('.cjs')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const fixed = content.replace(/require\((['"])(.+?)\.js\1\)/g, 'require($1$2.cjs$1)');

      if (fixed !== content) {
        fs.writeFileSync(fullPath, fixed);
      }
    }
  });
}

function getHomepageSourceDir() {
  return process.env.CUSTOM_HOMEPAGE_DIR || path.resolve(__dirname, '../../custom/homepages/v2');
}

function getPreparedHomepageDir() {
  if (memo.preparedHomepageDir && fs.existsSync(memo.preparedHomepageDir)) {
    return memo.preparedHomepageDir;
  }

  const sourceDir = getHomepageSourceDir();
  if (!fs.existsSync(sourceDir)) {
    return null;
  }

  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odysee-homepages-'));
  fs.cpSync(sourceDir, runtimeDir, { recursive: true });
  normalizeHomepageDir(runtimeDir);
  memo.preparedHomepageDir = runtimeDir;
  return memo.preparedHomepageDir;
}

const loadAnnouncements = (homepageKeys) => {
  const announcements = {};
  homepageKeys.forEach((key) => {
    const file = path.join(__dirname, `../dist/announcement/${key.toLowerCase()}.md`);
    let announcement;

    try {
      announcement = fs.readFileSync(file, 'utf8');
    } catch {}

    announcements[key] = announcement ? announcement.trim() : '';
  });
  return announcements;
};

function loadHomepageData() {
  if (process.env.CUSTOM_HOMEPAGE !== 'true' || memo.homepageData) {
    return;
  }

  try {
    const preparedDir = getPreparedHomepageDir();
    const customPath = preparedDir && path.join(preparedDir, 'index.cjs');

    if (!customPath) {
      throw new Error(`Custom homepage directory not found at ${getHomepageSourceDir()}`);
    }

    memo.homepageData = require(customPath);
    memo.announcements = loadAnnouncements(Object.keys(memo.homepageData));
    memo.lastLoadError = undefined;
  } catch (err) {
    const message = err && err.stack ? err.stack : String(err);

    if (memo.lastLoadError !== message) {
      memo.lastLoadError = message;
      console.log('getHomepageJSON:', err); // eslint-disable-line no-console
    }
  }
}

async function refreshMaterializedHomepageData(snapshotPath) {
  if (!memo.materializePromise) {
    memo.materializePromise = materializeHomepageData(memo.homepageData)
      .then(async (data) => {
        await publishNativeHomepageData(data);
        writeHomepageSnapshot(snapshotPath, data);
        return data;
      })
      .finally(() => {
        memo.materializePromise = undefined;
      });
  }

  return memo.materializePromise;
}

async function publishNativeHomepageData(data) {
  const hasToken = Boolean(HOMEPAGE_HYPERBEAM_AUTH_TOKEN);
  const hasCommitter = Boolean(HOMEPAGE_SNAPSHOT_COMMITTER);
  if (!hasToken && !hasCommitter) return;
  if (!hasToken || !hasCommitter) {
    throw new Error('Homepage native snapshot publisher requires both auth token and committer');
  }
  await publishHomepageSnapshots(data, {
    authToken: HOMEPAGE_HYPERBEAM_AUTH_TOKEN,
    expectedCommitter: HOMEPAGE_SNAPSHOT_COMMITTER,
  });
  memo.nativeSnapshotData = data;
  memo.nativeSnapshotLoadedAt = Date.now();
}

async function readNativeHomepageData(languages) {
  if (!HOMEPAGE_SNAPSHOT_COMMITTER) return null;
  if (memo.nativeSnapshotData && Date.now() - memo.nativeSnapshotLoadedAt < NATIVE_SNAPSHOT_CACHE_MS) {
    return memo.nativeSnapshotData;
  }
  const snapshots = await discoverHomepageSnapshots(languages, HOMEPAGE_SNAPSHOT_COMMITTER, {
    lookbackHours: Number(HOMEPAGE_SNAPSHOT_LOOKBACK_HOURS),
  });
  const data = Object.fromEntries(
    Object.entries(snapshots).map(([language, snapshot]) => [language, snapshot.payload.homepage])
  );
  if (Object.keys(data).length) {
    memo.nativeSnapshotData = data;
    memo.nativeSnapshotLoadedAt = Date.now();
  }
  return data;
}

function isCurrentHomepageSnapshot(data) {
  const homepages = Object.values(data || {});
  const categories = homepages.flatMap((homepage) => Object.values((homepage && homepage.categories) || {}));
  const categoriesCurrent = categories.every(
    (category) =>
      !Array.isArray(category.immutableIds) ||
      Object.prototype.hasOwnProperty.call(category, 'immutableSigningChannelIds')
  );
  const bannersCurrent = homepages.every((homepage) =>
    (homepage?.featured?.items || []).every((item) => !homepageClaimUri(item?.url) || item.immutableId)
  );
  return Boolean(homepages.length && categories.length && categoriesCurrent && bannersCurrent);
}

async function getMaterializedHomepageData(forceRefresh = false) {
  loadHomepageData();
  if (!memo.homepageData) return {};

  const snapshotPath = homepageSnapshotPath();
  const snapshot = readHomepageSnapshot(snapshotPath);
  if (!forceRefresh) {
    try {
      const nativeData = await readNativeHomepageData(Object.keys(memo.homepageData));
      if (nativeData && isCurrentHomepageSnapshot(nativeData)) {
        const mergedData = snapshot ? { ...snapshot.data, ...nativeData } : nativeData;
        writeHomepageSnapshot(snapshotPath, mergedData);
        return mergedData;
      }
    } catch (error) {
      console.error('Native homepage snapshot discovery failed:', error); // eslint-disable-line no-console
    }

    if (snapshot && isCurrentHomepageSnapshot(snapshot.data)) return snapshot.data;
    throw new Error(snapshot ? 'Homepage snapshot format is outdated' : 'Homepage snapshot is unavailable');
  }

  return refreshMaterializedHomepageData(snapshotPath);
}

// ****************************************************************************
// v1
// ****************************************************************************
const getHomepageJsonV1 = async () => {
  const homepageData = await getMaterializedHomepageData();
  if (!Object.keys(homepageData).length) {
    return {};
  }

  const v1 = {};
  const homepageKeys = Object.keys(homepageData);
  homepageKeys.forEach((hp) => {
    v1[hp] = homepageData[hp].categories;
  });
  return v1;
};

// ****************************************************************************
// v2
// ****************************************************************************
const reformatV2Categories = (categories, format) => {
  if (format === FORMAT.ROKU) {
    return categories && Object.entries(categories).map(([key, value]) => value);
  } else {
    return categories;
  }
};

/**
 * getHomepageJsonV2
 *
 * @param format [?string] Request for custom format. See FORMAT above.
 * @param lang [?string] Only populates data for the requested homepage.
 *             NOTE: the key for all supported languages will still be created
 *             (for apps to define dropdown lists), just that the value is left
 *             empty.
 * @returns {{}}
 */
const getHomepageJsonV2 = async (format, lang) => {
  const homepageData = await getMaterializedHomepageData();
  if (!Object.keys(homepageData).length) {
    return {};
  }

  const v2 = {};
  const homepageKeys = Object.keys(homepageData);
  homepageKeys.forEach((hp) => {
    if (!lang || lang === hp) {
      v2[hp] = {
        categories: reformatV2Categories(homepageData[hp].categories, format),
        portals: homepageData[hp].portals,
        featured: homepageData[hp].featured,
        meme: homepageData[hp].meme,
        meme_android: homepageData[hp].meme_android,
        meme_android_apk: homepageData[hp].meme_android_apk,
        meme_android_google: homepageData[hp].meme_android_google,
        discover: homepageData[hp].discover,
        discoverNew: homepageData[hp]?.discoverNew,
        customBanners: homepageData[hp]?.customBanners,
        announcement: memo.announcements[hp],
      };
    } else {
      v2[hp] = null;
    }
  });
  return v2;
};

module.exports = {
  getMaterializedHomepageData,
  getHomepageJsonV1,
  getHomepageJsonV2,
  isCurrentHomepageSnapshot,
};
