// This device's copy of the planner: the state shown, the last state the
// cloud confirmed, and whether there are changes still to send. Kept in
// IndexedDB; falls back to localStorage where IndexedDB is unavailable
// (some private-browsing modes).

import type { MergeConflict } from "./merge";
import { migrateState, tryValidateState, type AppState } from "./storage";
import type { CacheRecord, LocalCache, SyncConflict } from "./sync";

const DB_NAME = "skip-planner";
const STORE = "kv";
/** The pre-accounts cache: one planner per device, under this key. */
const LEGACY_KEY = "cache";
const LEGACY_FALLBACK_KEY = "skip-planner:cache";
/** Since accounts: one cache per person on this device. */
const keyFor = (user: string) => `cache:${user}`;
const fallbackFor = (user: string) => `skip-planner:cache:${user}`;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseConflict(v: unknown): SyncConflict | null {
  if (!isObject(v) || typeof v.at !== "string") return null;
  const valid = tryValidateState(v.local);
  if (!valid) return null;
  const local = migrateState(valid);
  if (v.kind === "initial") {
    const remote = tryValidateState(v.remote);
    return remote ? { kind: "initial", at: v.at, local, remote: migrateState(remote) } : null;
  }
  if (v.kind === "merge" && Array.isArray(v.conflicts)) {
    const conflicts = v.conflicts.filter(
      (c): c is MergeConflict => isObject(c) && typeof c.path === "string",
    );
    return { kind: "merge", at: v.at, local, conflicts };
  }
  return null;
}

/** Validate and migrate (state and base alike) a stored record. Anything unreadable is treated as no cache. */
export function parseCacheRecord(v: unknown): CacheRecord | null {
  if (!isObject(v) || v.schema !== 1) return null;
  const validState = tryValidateState(v.state);
  if (!validState) return null;
  const state = migrateState(validState);
  const validBase: AppState | null = v.base === null ? null : tryValidateState(v.base);
  if (v.base !== null && !validBase) return null;
  const base = validBase ? migrateState(validBase) : null;
  const { baseVersion, pending, origin, legacyKey } = v;
  if (typeof baseVersion !== "number" || !Number.isSafeInteger(baseVersion) || baseVersion < 0) return null;
  if (typeof pending !== "boolean") return null;
  if (origin !== "cache" && origin !== "legacy" && origin !== "default") return null;
  if (legacyKey !== null && typeof legacyKey !== "string") return null;
  return {
    schema: 1,
    state,
    base,
    baseVersion,
    pending,
    origin,
    legacyKey,
    conflict: v.conflict == null ? null : parseConflict(v.conflict),
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

async function loadKey(key: string, fallback: string): Promise<CacheRecord | null> {
  try {
    const raw = await tx("readonly", (st) => st.get(key));
    const parsed = parseCacheRecord(raw);
    if (parsed) return parsed;
  } catch {
    // fall through to the fallback copy
  }
  try {
    const raw = window.localStorage.getItem(fallback);
    return raw ? parseCacheRecord(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

async function saveKey(key: string, fallback: string, record: CacheRecord): Promise<void> {
  try {
    await tx("readwrite", (st) => st.put(structuredClone(record), key));
    try {
      window.localStorage.removeItem(fallback);
    } catch {
      // ignore
    }
  } catch {
    // IndexedDB unavailable: keep the copy in localStorage instead.
    window.localStorage.setItem(fallback, JSON.stringify(record));
  }
}

export function loadLocalCache(user: string): Promise<CacheRecord | null> {
  return loadKey(keyFor(user), fallbackFor(user));
}

export function saveLocalCache(user: string, record: CacheRecord): Promise<void> {
  return saveKey(keyFor(user), fallbackFor(user), record);
}

/** This person's cache on this device. */
export function localCacheFor(user: string): LocalCache {
  return { load: () => loadLocalCache(user), save: (rec) => saveLocalCache(user, rec) };
}

/** The planner this device had before accounts, if any. */
export function loadPreAccountsCache(): Promise<CacheRecord | null> {
  return loadKey(LEGACY_KEY, LEGACY_FALLBACK_KEY);
}

/** Forget the pre-accounts planner on this device (after it moved into an account). */
export async function clearPreAccountsCache(): Promise<void> {
  try {
    await tx("readwrite", (st) => st.delete(LEGACY_KEY));
  } catch {
    // ignore
  }
  try {
    window.localStorage.removeItem(LEGACY_FALLBACK_KEY);
  } catch {
    // ignore
  }
}
