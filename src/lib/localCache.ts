// This device's copy of the planner: the state shown, the last state the
// cloud confirmed, and whether there are changes still to send. Kept in
// IndexedDB; falls back to localStorage where IndexedDB is unavailable
// (some private-browsing modes).

import type { MergeConflict } from "./merge";
import { tryValidateState, type AppState } from "./storage";
import type { CacheRecord, LocalCache, SyncConflict } from "./sync";

const DB_NAME = "skip-planner";
const STORE = "kv";
const KEY = "cache";
const FALLBACK_KEY = "skip-planner:cache";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseConflict(v: unknown): SyncConflict | null {
  if (!isObject(v) || typeof v.at !== "string") return null;
  const local = tryValidateState(v.local);
  if (!local) return null;
  if (v.kind === "initial") {
    const remote = tryValidateState(v.remote);
    return remote ? { kind: "initial", at: v.at, local, remote } : null;
  }
  if (v.kind === "merge" && Array.isArray(v.conflicts)) {
    const conflicts = v.conflicts.filter(
      (c): c is MergeConflict => isObject(c) && typeof c.path === "string",
    );
    return { kind: "merge", at: v.at, local, conflicts };
  }
  return null;
}

/** Validate a stored record. Anything unreadable is treated as no cache. */
export function parseCacheRecord(v: unknown): CacheRecord | null {
  if (!isObject(v) || v.schema !== 1) return null;
  const state = tryValidateState(v.state);
  if (!state) return null;
  const base: AppState | null = v.base === null ? null : tryValidateState(v.base);
  if (v.base !== null && !base) return null;
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

export async function loadLocalCache(): Promise<CacheRecord | null> {
  try {
    const raw = await tx("readonly", (s) => s.get(KEY));
    const parsed = parseCacheRecord(raw);
    if (parsed) return parsed;
  } catch {
    // fall through to the fallback copy
  }
  try {
    const raw = window.localStorage.getItem(FALLBACK_KEY);
    return raw ? parseCacheRecord(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveLocalCache(record: CacheRecord): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put(structuredClone(record), KEY));
    try {
      window.localStorage.removeItem(FALLBACK_KEY);
    } catch {
      // ignore
    }
  } catch {
    // IndexedDB unavailable: keep the copy in localStorage instead.
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(record));
  }
}

export const localCache: LocalCache = { load: loadLocalCache, save: saveLocalCache };
