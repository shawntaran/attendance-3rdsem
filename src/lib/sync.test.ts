import { describe, expect, it } from "vitest";
import { odStateAll } from "./config";
import type { LoadResult, RemoteApi, RemoteRecord, SaveResult } from "./remote";
import { handleGet, handlePut, memoryRepo, type ApiResult } from "./server/plannerApi";
import {
  STORAGE_KEY,
  STORAGE_KEY_V2,
  clearLegacy,
  defaultState,
  readLegacy,
  tryValidateState,
  type AppState,
} from "./storage";
import { SyncEngine, newRecord, syncState, type CacheRecord, type LocalCache } from "./sync";

// ---- fakes -----------------------------------------------------------------

function mark(base: AppState, id: string, m: "attended" | "skipped" = "skipped"): AppState {
  const s = structuredClone(base);
  s.marks[id] = m;
  return s;
}

function toRecord(body: unknown): RemoteRecord | null {
  const b = body as { state: unknown; version: number; updatedAt: string | null };
  if (b.state === null) return null;
  return { state: tryValidateState(b.state)!, version: b.version, updatedAt: b.updatedAt };
}

/** The real request handlers over an in-memory database, plus a network switch. */
function fakeServer() {
  const repo = memoryRepo();
  const server = {
    repo,
    online: true,
    saves: 0,
    /** When set, the next save waits for this before answering. */
    hold: null as Promise<void> | null,
    api(): RemoteApi {
      const offline = { type: "error" as const, error: { kind: "offline" as const, message: "offline" } };
      const failure = (r: ApiResult) => ({
        type: "error" as const,
        error: { kind: "server" as const, message: JSON.stringify(r.body) },
      });
      return {
        async load(): Promise<LoadResult> {
          if (!server.online) return offline;
          const r = await handleGet(repo);
          if (r.status !== 200) return failure(r);
          return { type: "ok", record: toRecord(r.body) };
        },
        async save(state, expectedVersion): Promise<SaveResult> {
          if (!server.online) return offline;
          if (server.hold) {
            const h = server.hold;
            server.hold = null;
            await h;
          }
          server.saves++;
          const r = await handlePut(repo, { state: structuredClone(state), expectedVersion });
          if (r.status === 409) return { type: "conflict", current: toRecord(r.body) };
          if (r.status !== 200) return failure(r);
          return { type: "saved", record: toRecord(r.body)! };
        },
      };
    },
    serverState(): AppState | null {
      return repo.record ? tryValidateState(repo.record.state) : null;
    },
  };
  return server;
}

function memoryCache(initial: CacheRecord | null = null): LocalCache & { record: CacheRecord | null } {
  const cache = {
    record: initial ? structuredClone(initial) : null,
    async load() {
      return cache.record ? structuredClone(cache.record) : null;
    },
    async save(r: CacheRecord) {
      cache.record = structuredClone(r);
    },
  };
  return cache;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    removeItem: (k: string) => void delete data[k],
  };
}

function device(server: ReturnType<typeof fakeServer>, opts: { cache?: ReturnType<typeof memoryCache>; storage?: ReturnType<typeof memoryStorage> } = {}) {
  const cache = opts.cache ?? memoryCache();
  const storage = opts.storage ?? memoryStorage();
  const engine = new SyncEngine({
    remote: server.api(),
    cache,
    legacy: { read: () => readLegacy(storage), clear: () => clearLegacy(storage) },
    // Timers never fire on their own in tests; flush() and syncNow() drive everything.
    setTimer: () => 0,
    clearTimer: () => {},
    now: () => "2026-11-11T10:00:00.000Z",
  });
  return { engine, cache, storage };
}

const NOW = "2026-11-11T10:00:00.000Z";
const remoteAt = (state: AppState, version: number): RemoteRecord => ({ state, version, updatedAt: null });

// ---- syncState (pure reconciliation) -----------------------------------------

describe("syncState", () => {
  const base = defaultState();
  const a = mark(base, "2026-11-12@1");
  const b = mark(base, "2026-11-13@1");

  it("no record on the server: upload what this device has", () => {
    const d = syncState(newRecord(a, "legacy", STORAGE_KEY), null, NOW);
    expect(d.push).toBe(true);
    expect(d.record.state).toEqual(a);
  });

  it("never synced, same state as the cloud: adopt it and mark the legacy copy verified", () => {
    const d = syncState(newRecord(a, "legacy", STORAGE_KEY), remoteAt(a, 4), NOW);
    expect(d).toMatchObject({ push: false, legacyVerified: true });
    expect(d.record.baseVersion).toBe(4);
  });

  it("never synced, legacy data differs from the cloud: show the cloud, keep the local copy", () => {
    const d = syncState(newRecord(a, "legacy", STORAGE_KEY), remoteAt(b, 4), NOW);
    expect(d.push).toBe(false);
    expect(d.record.state).toEqual(b);
    expect(d.record.legacyKey).toBe(STORAGE_KEY);
    expect(d.record.conflict).toEqual({ kind: "initial", at: NOW, local: a, remote: b });
  });

  it("a fresh device with no data adopts the cloud", () => {
    const d = syncState(newRecord(defaultState(), "default"), remoteAt(b, 2), NOW);
    expect(d.record.state).toEqual(b);
    expect(d.record.conflict).toBeNull();
  });

  it("a fresh device that edited offline merges its edits onto the cloud", () => {
    const rec = { ...newRecord(a, "default"), pending: true };
    const d = syncState(rec, remoteAt(b, 2), NOW);
    expect(d.record.state.marks).toEqual({ ...a.marks, ...b.marks });
    expect(d.push).toBe(true);
  });

  it("same version with pending changes: push them", () => {
    const rec: CacheRecord = { ...newRecord(a, "cache"), base, baseVersion: 3, pending: true };
    expect(syncState(rec, remoteAt(base, 3), NOW).push).toBe(true);
  });

  it("newer cloud version and nothing pending: take it", () => {
    const rec: CacheRecord = { ...newRecord(base, "cache"), base, baseVersion: 3 };
    const d = syncState(rec, remoteAt(b, 4), NOW);
    expect(d).toMatchObject({ push: false, changedByRemote: true });
    expect(d.record.state).toEqual(b);
  });

  it("newer cloud version with pending changes: merge both", () => {
    const rec: CacheRecord = { ...newRecord(a, "cache"), base, baseVersion: 3, pending: true };
    const d = syncState(rec, remoteAt(b, 4), NOW);
    expect(d.record.state.marks).toEqual({ ...a.marks, ...b.marks });
    expect(d.record).toMatchObject({ baseVersion: 4, pending: true, conflict: null });
    expect(d.push).toBe(true);
  });

  it("the cloud went back in version (reset or restore): never overwrite it silently", () => {
    const rec: CacheRecord = { ...newRecord(a, "cache"), base: a, baseVersion: 9 };
    const d = syncState(rec, remoteAt(b, 2), NOW);
    expect(d.push).toBe(false);
    expect(d.record.conflict).toMatchObject({ kind: "initial", local: a, remote: b });
  });
});

// ---- the engine against a fake server ----------------------------------------

describe("initial cloud migration", () => {
  it("uploads the localStorage v3 state, verifies it, then clears the legacy key", async () => {
    const server = fakeServer();
    const legacy = mark(defaultState(), "2026-11-12@1", "attended");
    legacy.settings.odState = odStateAll(false);
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
    const { engine, cache } = device(server, { storage });

    await engine.start();

    expect(server.serverState()).toEqual(legacy); // marks and OD settings preserved
    expect(server.repo.record?.version).toBe(1);
    expect(storage.data[STORAGE_KEY]).toBeUndefined();
    expect(cache.record).toMatchObject({ baseVersion: 1, pending: false, legacyKey: null });
    expect(engine.getSnapshot().status).toBe("synced");
  });

  it("migrates a v2 state through the existing migration on the way up", async () => {
    const server = fakeServer();
    const { windowEnd: _w, extraWorkingDays: _x, ...v2settings } = mark(defaultState(), "2026-11-12@1").settings;
    const storage = memoryStorage({
      [STORAGE_KEY_V2]: JSON.stringify({ settings: { ...v2settings, cushionHours: 2 }, marks: { "2026-11-12@1": "skipped" } }),
    });
    const { engine } = device(server, { storage });
    await engine.start();
    expect(server.serverState()?.settings).toMatchObject({ cushionHours: 2, windowEnd: "2026-12-05" });
    expect(server.serverState()?.marks).toEqual({ "2026-11-12@1": "skipped" });
    expect(storage.data[STORAGE_KEY_V2]).toBeUndefined();
  });

  it("keeps the legacy key while the upload fails, and clears it once it succeeds", async () => {
    const server = fakeServer();
    server.repo.fail = true;
    const legacy = mark(defaultState(), "2026-11-12@1");
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
    const { engine } = device(server, { storage });

    await engine.start();
    expect(engine.getSnapshot().status).toBe("error");
    expect(storage.data[STORAGE_KEY]).toBeDefined();
    expect(engine.getSnapshot().state).toEqual(legacy);

    server.repo.fail = false;
    await engine.syncNow();
    expect(server.serverState()).toEqual(legacy);
    expect(storage.data[STORAGE_KEY]).toBeUndefined();
  });

  it("if the cloud already has a different state, overwrites neither and offers recovery", async () => {
    const server = fakeServer();
    const cloud = mark(defaultState(), "2026-11-16@1");
    await handlePut(server.repo, { state: cloud, expectedVersion: 0 });
    const legacy = mark(defaultState(), "2026-11-12@1");
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
    const { engine, cache } = device(server, { storage });

    await engine.start();

    expect(server.serverState()).toEqual(cloud); // untouched
    expect(server.repo.record?.version).toBe(1);
    expect(engine.getSnapshot().state).toEqual(cloud);
    expect(engine.getSnapshot().conflict).toMatchObject({ kind: "initial", local: legacy });
    expect(storage.data[STORAGE_KEY]).toBeDefined(); // local copy preserved
    expect(cache.record?.conflict?.local).toEqual(legacy);

    await engine.resolveConflict("device");
    expect(server.serverState()).toEqual(legacy);
    expect(server.repo.record?.version).toBe(2);
    expect(storage.data[STORAGE_KEY]).toBeUndefined();
    expect(engine.getSnapshot().conflict).toBeNull();
  });

  it("choosing the cloud copy keeps the cloud and clears the legacy key", async () => {
    const server = fakeServer();
    const cloud = mark(defaultState(), "2026-11-16@1");
    await handlePut(server.repo, { state: cloud, expectedVersion: 0 });
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(mark(defaultState(), "2026-11-12@1")) });
    const { engine } = device(server, { storage });
    await engine.start();
    await engine.resolveConflict("cloud");
    expect(server.serverState()).toEqual(cloud);
    expect(server.repo.record?.version).toBe(1);
    expect(storage.data[STORAGE_KEY]).toBeUndefined();
  });

  it("an empty database and no local data creates the record with defaults", async () => {
    const server = fakeServer();
    const { engine } = device(server);
    await engine.start();
    expect(server.serverState()).toEqual(defaultState());
  });
});

describe("local cache, offline and failures", () => {
  it("restores from the cache immediately, even with the server unreachable", async () => {
    const server = fakeServer();
    const first = device(server);
    await first.engine.start();
    first.engine.update(mark(first.engine.getSnapshot().state, "2026-11-12@1"));
    await first.engine.flush();

    server.online = false;
    const second = device(server, { cache: first.cache });
    await second.engine.start();
    expect(second.engine.getSnapshot().state.marks).toEqual({ "2026-11-12@1": "skipped" });
    expect(second.engine.getSnapshot().status).toBe("offline");
  });

  it("offline edits stay pending in the cache and reach the cloud on reconnect", async () => {
    const server = fakeServer();
    const { engine, cache } = device(server);
    await engine.start();

    server.online = false;
    engine.update(mark(engine.getSnapshot().state, "2026-11-12@1"));
    engine.update(mark(engine.getSnapshot().state, "2026-11-13@1", "attended"));
    await engine.flush();
    expect(engine.getSnapshot().status).toBe("offline");
    expect(cache.record?.pending).toBe(true);
    expect(cache.record?.state.marks).toEqual({ "2026-11-12@1": "skipped", "2026-11-13@1": "attended" });
    expect(server.serverState()?.marks).toEqual({});

    // A reload while still offline keeps the pending edits.
    const reloaded = device(server, { cache });
    await reloaded.engine.start();
    expect(reloaded.engine.getSnapshot().state.marks).toEqual(cache.record?.state.marks);

    server.online = true;
    await reloaded.engine.syncNow();
    expect(server.serverState()?.marks).toEqual({ "2026-11-12@1": "skipped", "2026-11-13@1": "attended" });
    expect(reloaded.engine.getSnapshot().status).toBe("synced");
  });

  it("a failed write never discards the pending change", async () => {
    const server = fakeServer();
    const { engine, cache } = device(server);
    await engine.start();
    server.repo.fail = true;
    engine.update(mark(engine.getSnapshot().state, "2026-11-12@1"));
    await engine.flush();
    expect(engine.getSnapshot().status).toBe("error");
    expect(cache.record).toMatchObject({ pending: true });
    expect(engine.getSnapshot().state.marks).toEqual({ "2026-11-12@1": "skipped" });

    server.repo.fail = false;
    await engine.syncNow();
    expect(server.serverState()?.marks).toEqual({ "2026-11-12@1": "skipped" });
    expect(cache.record?.pending).toBe(false);
  });

  it("an invalid state on the server is reported and never overwritten", async () => {
    const server = fakeServer();
    server.repo.record = { state: { settings: { theme: "neon" }, marks: {} }, version: 5, updatedAt: "x" };
    const { engine } = device(server);
    await engine.start();
    engine.update(mark(engine.getSnapshot().state, "2026-11-12@1"));
    await engine.flush();
    expect(engine.getSnapshot().status).toBe("error");
    expect(server.repo.record.version).toBe(5);
    expect(engine.getSnapshot().state.marks).toEqual({ "2026-11-12@1": "skipped" });
  });

  it("edits made while a save is in flight stay pending and follow it", async () => {
    const server = fakeServer();
    const { engine } = device(server);
    await engine.start();
    let release!: () => void;
    server.hold = new Promise<void>((r) => (release = r));
    engine.update(mark(engine.getSnapshot().state, "2026-11-12@1"));
    const flushing = engine.flush();
    await Promise.resolve();
    engine.update(mark(engine.getSnapshot().state, "2026-11-13@1"));
    release();
    await flushing;
    await engine.flush();
    expect(server.serverState()?.marks).toEqual({ "2026-11-12@1": "skipped", "2026-11-13@1": "skipped" });
    expect(engine.getRecord().pending).toBe(false);
  });
});

describe("cross-device sync", () => {
  async function twoDevices() {
    const server = fakeServer();
    const a = device(server);
    const b = device(server);
    await a.engine.start();
    await b.engine.start();
    return { server, a: a.engine, b: b.engine };
  }

  it("a change on one device appears on the other at its next sync", async () => {
    const { a, b } = await twoDevices();
    a.update(mark(a.getSnapshot().state, "2026-11-12@1"));
    await a.flush();
    const before = b.getSnapshot().remoteRevision;
    await b.syncNow();
    expect(b.getSnapshot().state.marks).toEqual({ "2026-11-12@1": "skipped" });
    expect(b.getSnapshot().remoteRevision).toBe(before + 1);
  });

  it("simultaneous edits to different classes and settings merge, nothing lost", async () => {
    const { server, a, b } = await twoDevices();
    a.update(mark(a.getSnapshot().state, "2026-11-12@1"));
    const bs = mark(b.getSnapshot().state, "2026-11-13@1", "attended");
    bs.settings.odState["od-2026-10-30"] = { on: false, inPortal: false };
    b.update(bs);
    await a.flush();
    await b.flush(); // stale version -> 409 -> merge -> retry
    await a.syncNow();
    const expected = { "2026-11-12@1": "skipped", "2026-11-13@1": "attended" };
    expect(server.serverState()?.marks).toEqual(expected);
    expect(server.serverState()?.settings.odState["od-2026-10-30"].on).toBe(false);
    expect(a.getSnapshot().state).toEqual(b.getSnapshot().state);
    expect(a.getSnapshot().conflict).toBeNull();
    expect(b.getSnapshot().conflict).toBeNull();
  });

  it("the same class marked differently: cloud wins, this device's value is kept for recovery", async () => {
    const { server, a, b } = await twoDevices();
    a.update(mark(a.getSnapshot().state, "2026-11-12@1", "attended"));
    b.update(mark(b.getSnapshot().state, "2026-11-12@1", "skipped"));
    await a.flush();
    await b.flush();
    expect(server.serverState()?.marks).toEqual({ "2026-11-12@1": "attended" });
    const conflict = b.getSnapshot().conflict;
    expect(conflict).toMatchObject({ kind: "merge", conflicts: [{ path: "mark/2026-11-12@1", local: '"skipped"' }] });

    await b.resolveConflict("device");
    expect(server.serverState()?.marks).toEqual({ "2026-11-12@1": "skipped" });
    await a.syncNow();
    expect(a.getSnapshot().state.marks).toEqual({ "2026-11-12@1": "skipped" });
  });

  it("duplicate sync events change nothing", async () => {
    const { server, a } = await twoDevices();
    const saves = server.saves;
    const rev = a.getSnapshot().remoteRevision;
    await Promise.all([a.syncNow(), a.syncNow(), a.syncNow()]);
    await a.syncNow();
    expect(server.saves).toBe(saves);
    expect(server.repo.record?.version).toBe(1);
    expect(a.getSnapshot().remoteRevision).toBe(rev);
  });

  it("a device back from a network outage catches up and sends its own edits", async () => {
    const { server, a, b } = await twoDevices();
    server.online = false;
    b.update(mark(b.getSnapshot().state, "2026-11-13@1"));
    await b.flush();
    server.online = true;
    a.update(mark(a.getSnapshot().state, "2026-11-12@1"));
    await a.flush();
    await b.syncNow();
    expect(server.serverState()?.marks).toEqual({ "2026-11-12@1": "skipped", "2026-11-13@1": "skipped" });
    await a.syncNow();
    expect(a.getSnapshot().state.marks).toEqual(server.serverState()?.marks);
  });
});

describe("access key", () => {
  it("a refused key keeps edits pending, does not retry in a loop, and syncs once the key is fixed", async () => {
    const server = fakeServer();
    let locked = true;
    const api = server.api();
    const unauthorized = { type: "error" as const, error: { kind: "unauthorized" as const, message: "needs key" } };
    const timers: number[] = [];
    const cache = memoryCache();
    const engine = new SyncEngine({
      remote: {
        load: () => (locked ? Promise.resolve(unauthorized) : api.load()),
        save: (s, v) => (locked ? Promise.resolve(unauthorized) : api.save(s, v)),
      },
      cache,
      legacy: { read: () => null, clear: () => {} },
      setTimer: (_fn, ms) => timers.push(ms),
      clearTimer: () => {},
    });
    await engine.start();
    engine.update(mark(engine.getSnapshot().state, "2026-11-12@1"));
    timers.length = 0; // ignore the debounce timer from update()
    await engine.flush();

    expect(engine.getSnapshot()).toMatchObject({ status: "error", failureKind: "unauthorized" });
    expect(cache.record?.pending).toBe(true);
    expect(timers).toEqual([]); // no retry timer for a wrong key
    expect(server.repo.record).toBeNull();

    locked = false; // the key was entered
    await engine.syncNow();
    expect(server.serverState()?.marks).toEqual({ "2026-11-12@1": "skipped" });
    expect(engine.getSnapshot()).toMatchObject({ status: "synced", failureKind: null });
  });
});
