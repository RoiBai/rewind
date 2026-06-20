import { DBSchema, IDBPDatabase, deleteDB, openDB } from 'idb';
import { AppSettings, Episode, ReplayLog, StoredBlob } from './types';

const DB_NAME = 'rewind-local-db';
const DB_VERSION = 2;
const DB_KEY = 'rewind-active-db-name';
const SETTINGS_ID = 'app-settings';
const DB_OPEN_TIMEOUT_MS = 2500;

export const defaultSettings: AppSettings = {
  rewardEnabled: false,
  forceFullWatch: true,
  treats: 0
};

interface RewindDb extends DBSchema {
  episodes: {
    key: string;
    value: Episode;
    indexes: { 'by-createdAt': string };
  };
  replayLogs: {
    key: string;
    value: ReplayLog;
    indexes: { 'by-createdAt': string; 'by-episodeId': string };
  };
  blobs: {
    key: string;
    value: StoredBlob;
    indexes: { 'by-createdAt': string };
  };
  settings: {
    key: string;
    value: AppSettings & { id: string };
  };
}

let dbPromise: Promise<IDBPDatabase<RewindDb>> | undefined;
let activeDbName = readActiveDbName();

export function createId(prefix: string) {
  const random = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
}

function getDb() {
  if (!dbPromise) {
    const opening = withTimeout(
      openRewindDb(activeDbName),
      DB_OPEN_TIMEOUT_MS,
      `IndexedDB open timed out for ${activeDbName}.`
    );

    opening.catch(() => {
      if (dbPromise === opening) {
        dbPromise = undefined;
      }
    });
    dbPromise = opening;
  }

  return dbPromise;
}

function openRewindDb(name: string) {
  return openDB<RewindDb>(name, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        const episodes = db.objectStoreNames.contains('episodes')
          ? transaction.objectStore('episodes')
          : db.createObjectStore('episodes', { keyPath: 'id' });
        ensureIndex(episodes, 'by-createdAt', 'createdAt');

        const replayLogs = db.objectStoreNames.contains('replayLogs')
          ? transaction.objectStore('replayLogs')
          : db.createObjectStore('replayLogs', { keyPath: 'id' });
        ensureIndex(replayLogs, 'by-createdAt', 'createdAt');
        ensureIndex(replayLogs, 'by-episodeId', 'episodeId');

        const blobs = db.objectStoreNames.contains('blobs')
          ? transaction.objectStore('blobs')
          : db.createObjectStore('blobs', { keyPath: 'id' });
        ensureIndex(blobs, 'by-createdAt', 'createdAt');

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      },
      blocked() {
        console.warn('Rewind IndexedDB upgrade is blocked by another open tab.');
      },
      blocking() {
        console.warn('Rewind IndexedDB is blocking a newer app version.');
      },
      terminated() {
        dbPromise = undefined;
      }
  });
}

export async function loadInitialData() {
  const [settings, episodes] = await Promise.all([getSettings(), listEpisodes()]);
  return { settings, episodes, recovered: isRecoveryDb(activeDbName) };
}

export async function loadInitialDataWithRecovery() {
  try {
    return await loadInitialData();
  } catch (error) {
    console.warn('Primary Rewind local database failed to open.', error);
    return switchToFreshDatabase(error);
  }
}

export async function saveEpisode(episode: Episode) {
  const db = await getDb();
  await db.put('episodes', episode);
}

export async function updateEpisode(id: string, patch: Partial<Episode>) {
  const db = await getDb();
  const episode = await db.get('episodes', id);
  if (!episode) {
    throw new Error('Episode not found');
  }
  await db.put('episodes', { ...episode, ...patch });
}

export async function listEpisodes() {
  const db = await getDb();
  const episodes = await getAllByCreatedAt(db, 'episodes');
  return episodes.reverse();
}

export async function getEpisode(id: string) {
  const db = await getDb();
  return db.get('episodes', id);
}

export async function putVideoBlob(blob: Blob, kind: StoredBlob['kind']) {
  const db = await getDb();
  const id = createId(kind === 'raw-video' ? 'raw' : 'replay');
  await db.put('blobs', {
    id,
    blob,
    kind,
    createdAt: new Date().toISOString()
  });
  return id;
}

export async function getVideoBlob(id: string) {
  const db = await getDb();
  const record = await db.get('blobs', id);
  return record?.blob;
}

export async function addReplayLog(log: ReplayLog) {
  const db = await getDb();
  await db.put('replayLogs', log);
}

export async function listReplayLogs() {
  const db = await getDb();
  const logs = await getAllByCreatedAt(db, 'replayLogs');
  return logs.reverse();
}

export async function getSettings() {
  const db = await getDb();
  const record = await db.get('settings', SETTINGS_ID);
  return record ? stripSettingsId(record) : defaultSettings;
}

export async function saveSettings(settings: AppSettings) {
  const db = await getDb();
  await db.put('settings', { ...settings, id: SETTINGS_ID });
}

export async function incrementTreats() {
  const settings = await getSettings();
  const next = { ...settings, treats: settings.treats + 1 };
  await saveSettings(next);
  return next;
}

export async function deleteAllLocalData() {
  const db = await getDb();
  const tx = db.transaction(['episodes', 'replayLogs', 'blobs', 'settings'], 'readwrite');
  await Promise.all([
    tx.objectStore('episodes').clear(),
    tx.objectStore('replayLogs').clear(),
    tx.objectStore('blobs').clear(),
    tx.objectStore('settings').clear(),
    tx.done
  ]);
}

export async function resetLocalDatabase() {
  const currentDbName = activeDbName;
  const db = await dbPromise?.catch(() => undefined);
  db?.close();
  dbPromise = undefined;
  await withTimeout(deleteDB(currentDbName), 5000, 'Local database reset timed out.');
  if (currentDbName !== DB_NAME) {
    await deleteDB(DB_NAME).catch(() => undefined);
  }
  setActiveDbName(DB_NAME);
}

export async function getExportBundle() {
  const [episodes, replayLogs, settings] = await Promise.all([listEpisodes(), listReplayLogs(), getSettings()]);
  return {
    exportedAt: new Date().toISOString(),
    app: 'Rewind research prototype',
    episodes,
    replayLogs,
    settings
  };
}

function stripSettingsId(record: AppSettings & { id: string }): AppSettings {
  return {
    rewardEnabled: record.rewardEnabled,
    forceFullWatch: record.forceFullWatch,
    treats: record.treats
  };
}

async function switchToFreshDatabase(cause: unknown) {
  const db = await dbPromise?.catch(() => undefined);
  db?.close();
  dbPromise = undefined;
  const nextDbName = `${DB_NAME}-recovery-${Date.now().toString(36)}`;
  setActiveDbName(nextDbName);

  try {
    const data = await loadInitialData();
    return { ...data, recovered: true, recoveryReason: getErrorDetail(cause) };
  } catch (recoveryError) {
    setActiveDbName(DB_NAME);
    throw recoveryError;
  }
}

function readActiveDbName() {
  try {
    return window.localStorage.getItem(DB_KEY) || DB_NAME;
  } catch {
    return DB_NAME;
  }
}

function setActiveDbName(name: string) {
  activeDbName = name;
  try {
    if (name === DB_NAME) {
      window.localStorage.removeItem(DB_KEY);
    } else {
      window.localStorage.setItem(DB_KEY, name);
    }
  } catch {
    // IndexedDB can still work even if localStorage is unavailable.
  }
}

export function getErrorDetail(error: unknown) {
  if (error instanceof DOMException) {
    return `${error.name}: ${error.message}`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function isRecoveryDb(name: string) {
  return name !== DB_NAME;
}

function ensureIndex(
  store: {
    indexNames: DOMStringList;
    createIndex(name: string, keyPath: string | string[], options?: IDBIndexParameters): unknown;
  },
  name: string,
  keyPath: string | string[],
  options?: IDBIndexParameters
) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

async function getAllByCreatedAt<StoreName extends 'episodes' | 'replayLogs'>(
  db: IDBPDatabase<RewindDb>,
  storeName: StoreName
): Promise<RewindDb[StoreName]['value'][]> {
  try {
    return await db.getAllFromIndex(storeName, 'by-createdAt');
  } catch (error) {
    console.warn(`Falling back to unsorted ${storeName} read.`, error);
    const records = await db.getAll(storeName);
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timer));
  });
}
