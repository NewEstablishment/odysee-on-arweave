const DB_NAME = 'odysee-livestream-replays';
const STORE_NAME = 'replays';
const DB_VERSION = 1;

export type LivestreamReplayEntry = {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  size: number;
  sourceType?: LivestreamReplaySourceType | null;
  channelId?: string | null;
  claimId?: string | null;
  uri?: string | null;
  title?: string | null;
  createdAt: number;
  durationMs: number;
};

export type LivestreamReplaySourceType = 'browser' | 'rtmp';

type SaveReplayOptions = {
  blob: Blob;
  sourceType?: LivestreamReplaySourceType;
  channelId?: string | null;
  claimId?: string | null;
  uri?: string | null;
  title?: string | null;
  startedAt: number;
  endedAt?: number;
  name?: string;
};

export type LivestreamReplayStorageEstimate = {
  supported: boolean;
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
  canPersist: boolean;
};

export function isLivestreamReplayStorageSupported() {
  return typeof indexedDB !== 'undefined';
}

export async function getLivestreamReplayStorageEstimate(): Promise<LivestreamReplayStorageEstimate> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  const estimate = storage?.estimate ? await storage.estimate().catch(() => null) : null;
  const persisted = storage?.persisted ? await storage.persisted().catch(() => null) : null;
  return {
    supported: isLivestreamReplayStorageSupported(),
    usage: typeof estimate?.usage === 'number' ? estimate.usage : null,
    quota: typeof estimate?.quota === 'number' ? estimate.quota : null,
    persisted,
    canPersist: typeof storage?.persist === 'function',
  };
}

export async function requestLivestreamReplayStoragePersistence() {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (typeof storage?.persist !== 'function') return false;
  return storage.persist();
}

function openDb(): Promise<IDBDatabase> {
  if (!isLivestreamReplayStorageSupported()) {
    return Promise.reject(new Error('Browser replay storage is not available.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('blocked', () => reject(new Error('Browser replay storage is blocked by another tab.')), {
      once: true,
    });
  });
}

function replayId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function replayName(options: SaveReplayOptions) {
  if (options.name) return options.name;
  const stamp = new Date(options.startedAt).toISOString().replace(/[:.]/g, '-');
  const base = options.title ? options.title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') : 'livestream-replay';
  return `${base || 'livestream-replay'}-${stamp}.webm`;
}

export function livestreamReplaySourceLabel(entry: LivestreamReplayEntry) {
  const sourceType = entry.sourceType || (entry.name?.includes('rtmp-replay') ? 'rtmp' : 'browser');
  switch (sourceType) {
    case 'rtmp':
      return __('RTMP capture');
    case 'browser':
    default:
      return __('Browser stream');
  }
}

export async function saveLivestreamReplay(options: SaveReplayOptions): Promise<LivestreamReplayEntry> {
  const endedAt = options.endedAt || Date.now();
  const entry: LivestreamReplayEntry = {
    id: replayId(),
    blob: options.blob,
    name: replayName(options),
    type: options.blob.type || 'video/webm',
    size: options.blob.size,
    sourceType: options.sourceType || 'browser',
    channelId: options.channelId,
    claimId: options.claimId,
    uri: options.uri,
    title: options.title,
    createdAt: endedAt,
    durationMs: Math.max(0, endedAt - options.startedAt),
  };

  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(entry);
  await new Promise<void>((resolve, reject) => {
    tx.addEventListener('complete', () => resolve(), { once: true });
    tx.addEventListener('error', () => reject(tx.error), { once: true });
  });
  db.close();
  return entry;
}

export async function getLivestreamReplay(id: string): Promise<LivestreamReplayEntry | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const request = tx.objectStore(STORE_NAME).get(id);
  const entry = await new Promise<LivestreamReplayEntry | undefined>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
  db.close();
  return entry || null;
}

export async function getLivestreamReplayFile(id: string): Promise<File | null> {
  const entry = await getLivestreamReplay(id);
  if (!entry) return null;
  return new File([entry.blob], entry.name, { type: entry.type });
}

export async function listLivestreamReplays(): Promise<LivestreamReplayEntry[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const request = tx.objectStore(STORE_NAME).getAll();
  const entries = await new Promise<LivestreamReplayEntry[]>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result || []), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
  db.close();
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteLivestreamReplay(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.addEventListener('complete', () => resolve(), { once: true });
    tx.addEventListener('error', () => reject(tx.error), { once: true });
  });
  db.close();
}
