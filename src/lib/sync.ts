// Keeps the planner state in step between this device's cache and the cloud.
//
// The local record holds:
//   state        what the UI shows (and edits)
//   base         the last state the server confirmed, at baseVersion
//   pending      state has changes the server has not confirmed yet
//
// state + base together are the pending-write queue: the changes still to send
// are exactly "state minus base", and they survive reloads and offline spells
// because the record lives in IndexedDB. Whenever the server turns out to have
// moved on, local and remote changes are merged path by path (see merge.ts);
// a real clash keeps the cloud value and preserves this device's version in
// `conflict` until the person chooses. Nothing pending is ever dropped on a
// failed request: it stays in the record and is retried.

import { applyLocalValues, mergeStates, statesEqual, type MergeConflict } from "./merge";
import type { FailureKind, LoadResult, RemoteApi, RemoteRecord, SaveResult, SyncFailure } from "./remote";
import { defaultState, migrateState, type AppState } from "./storage";

export type SyncConflict =
  /** Whole states differ and cannot be merged (first launch, or the server was reset). */
  | { kind: "initial"; at: string; local: AppState; remote: AppState }
  /** Some paths were changed differently on this device and another one. */
  | { kind: "merge"; at: string; local: AppState; conflicts: MergeConflict[] };

export interface CacheRecord {
  schema: 1;
  state: AppState;
  base: AppState | null;
  /** 0 = the server has never confirmed anything for this device. */
  baseVersion: number;
  pending: boolean;
  /** Where `state` came from before the first sync. */
  origin: "cache" | "legacy" | "default";
  /** A localStorage key from the pre-cloud app, kept until the cloud copy is verified. */
  legacyKey: string | null;
  conflict: SyncConflict | null;
}

export function newRecord(state: AppState, origin: CacheRecord["origin"], legacyKey: string | null = null): CacheRecord {
  return { schema: 1, state, base: null, baseVersion: 0, pending: false, origin, legacyKey, conflict: null };
}

/** Bring every copy in a record (shown, confirmed base, conflict copies) up to the current baseline revision. */
export function migrateRecord(rec: CacheRecord): CacheRecord {
  const conflict: SyncConflict | null =
    rec.conflict === null
      ? null
      : rec.conflict.kind === "initial"
        ? { ...rec.conflict, local: migrateState(rec.conflict.local), remote: migrateState(rec.conflict.remote) }
        : { ...rec.conflict, local: migrateState(rec.conflict.local) };
  return { ...rec, state: migrateState(rec.state), base: rec.base ? migrateState(rec.base) : null, conflict };
}

/**
 * Reconcile against the cloud copy after migrating it, so a device that
 * migrated and a cloud row that has not yet never look different just because
 * of the baseline correction. If the cloud row itself is on an older revision,
 * the confirmed base is set to the raw row, which makes the migrated values a
 * normal pending change: they are pushed once and the row is upgraded.
 */
export function syncWithMigration(rec: CacheRecord, raw: RemoteRecord | null, now: string): SyncDecision {
  if (raw === null) return syncState(rec, null, now);
  const migrated: RemoteRecord = { ...raw, state: migrateState(raw.state) };
  const decision = syncState(rec, migrated, now);
  if (migrated.state === raw.state || decision.record.baseVersion !== raw.version) return decision;
  const record: CacheRecord = {
    ...decision.record,
    base: raw.state,
    pending: !statesEqual(decision.record.state, raw.state),
  };
  return { ...decision, record, push: decision.push || record.pending };
}

export interface SyncDecision {
  record: CacheRecord;
  /** The record has changes the server should get now. */
  push: boolean;
  /** The visible state changed because of the server. */
  changedByRemote: boolean;
  /** The server holds exactly the legacy state, so the legacy key can go. */
  legacyVerified: boolean;
}

function takeRemote(rec: CacheRecord, remote: RemoteRecord): CacheRecord {
  return { ...rec, state: remote.state, base: remote.state, baseVersion: remote.version, pending: false, origin: "cache" };
}

function addConflict(existing: SyncConflict | null, next: SyncConflict): SyncConflict {
  // An unresolved whole-state conflict keeps its original local copy.
  if (existing?.kind === "initial") return existing;
  if (existing?.kind === "merge" && next.kind === "merge") {
    const byPath = new Map(existing.conflicts.map((c) => [c.path, c]));
    for (const c of next.conflicts) byPath.set(c.path, { ...c, local: byPath.get(c.path)?.local ?? c.local });
    return { ...next, local: existing.local, conflicts: [...byPath.values()] };
  }
  return next;
}

/**
 * Reconcile the local record with what the server has. Pure: decides the new
 * record and whether to push, without doing any I/O.
 */
export function syncState(rec: CacheRecord, remote: RemoteRecord | null, now: string): SyncDecision {
  const same = { changedByRemote: false, legacyVerified: false };

  // No record on the server yet (first launch anywhere, or the row was deleted):
  // upload what this device has. The insert only succeeds if nobody beat us to it.
  if (remote === null) {
    return { record: { ...rec, base: null, baseVersion: 0, pending: true }, push: true, ...same };
  }

  // This device has never synced: decide how its local data meets the cloud's.
  if (rec.baseVersion === 0) {
    if (statesEqual(rec.state, remote.state)) {
      return { record: takeRemote(rec, remote), push: false, changedByRemote: false, legacyVerified: rec.legacyKey !== null };
    }
    if (rec.origin === "default" && !rec.pending) {
      return { record: takeRemote(rec, remote), push: false, changedByRemote: true, legacyVerified: false };
    }
    if (rec.origin === "default") {
      // A fresh device edited offline: its changes are on top of the defaults.
      return mergeOnto(rec, defaultState(), remote, now);
    }
    // Existing local data (legacy localStorage or an unsynced cache) that differs
    // from the cloud. Show the cloud, keep this device's copy for the person to choose.
    const conflict: SyncConflict = { kind: "initial", at: now, local: rec.state, remote: remote.state };
    return {
      record: { ...takeRemote(rec, remote), legacyKey: rec.legacyKey, conflict: addConflict(rec.conflict, conflict) },
      push: false,
      changedByRemote: true,
      legacyVerified: false,
    };
  }

  if (remote.version === rec.baseVersion) {
    if (rec.pending) return { record: rec, push: true, ...same };
    if (!statesEqual(rec.state, remote.state)) {
      return { record: takeRemote(rec, remote), push: false, changedByRemote: true, legacyVerified: false };
    }
    return { record: rec, push: false, ...same };
  }

  if (remote.version > rec.baseVersion) {
    if (!rec.pending) return { record: takeRemote(rec, remote), push: false, changedByRemote: true, legacyVerified: false };
    return mergeOnto(rec, rec.base ?? defaultState(), remote, now);
  }

  // The server is behind what this device already saw: it was reset or restored.
  // Never overwrite it silently.
  const conflict: SyncConflict = { kind: "initial", at: now, local: rec.state, remote: remote.state };
  return {
    record: { ...takeRemote(rec, remote), legacyKey: rec.legacyKey, conflict: addConflict(rec.conflict, conflict) },
    push: false,
    changedByRemote: true,
    legacyVerified: false,
  };
}

function mergeOnto(rec: CacheRecord, base: AppState, remote: RemoteRecord, now: string): SyncDecision {
  let merged: AppState;
  let conflicts: MergeConflict[];
  try {
    ({ merged, conflicts } = mergeStates(base, rec.state, remote.state));
  } catch {
    // The two sides cannot be combined into a valid state: treat it as a whole-state conflict.
    const conflict: SyncConflict = { kind: "initial", at: now, local: rec.state, remote: remote.state };
    return {
      record: { ...takeRemote(rec, remote), legacyKey: rec.legacyKey, conflict: addConflict(rec.conflict, conflict) },
      push: false,
      changedByRemote: true,
      legacyVerified: false,
    };
  }
  const pending = !statesEqual(merged, remote.state);
  const record: CacheRecord = {
    ...rec,
    state: merged,
    base: remote.state,
    baseVersion: remote.version,
    pending,
    origin: "cache",
    conflict:
      conflicts.length > 0
        ? addConflict(rec.conflict, { kind: "merge", at: now, local: rec.state, conflicts })
        : rec.conflict,
  };
  return { record, push: pending, changedByRemote: !statesEqual(merged, rec.state), legacyVerified: false };
}

// ---- The engine ------------------------------------------------------------

export type SyncStatus = "connecting" | "synced" | "saving" | "pending" | "offline" | "error";

export interface SyncSnapshot {
  ready: boolean;
  state: AppState;
  status: SyncStatus;
  /** Detail for the status, e.g. why sync failed. */
  message: string | null;
  /** Why the last request failed, or null. "unauthorized" means the access key is missing or wrong. */
  failureKind: FailureKind | null;
  conflict: SyncConflict | null;
  /** Bumps whenever the visible state changes because of another device. */
  remoteRevision: number;
}

export interface LocalCache {
  load(): Promise<CacheRecord | null>;
  save(record: CacheRecord): Promise<void>;
}

export interface LegacyStore {
  read(): { state: AppState; key: string } | null;
  clear(): void;
}

export interface SyncDeps {
  remote: RemoteApi;
  cache: LocalCache;
  legacy: LegacyStore;
  now?: () => string;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Delay before local edits are sent. */
  debounceMs?: number;
}

const MAX_PUSH_ATTEMPTS = 5;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

export class SyncEngine {
  private rec: CacheRecord = newRecord(defaultState(), "default");
  private ready = false;
  private connected = false;
  private saving = false;
  private failure: SyncFailure | null = null;
  private remoteRevision = 0;
  private listeners = new Set<(s: SyncSnapshot) => void>();
  private chain: Promise<void> = Promise.resolve();
  private syncQueued = false;
  private debounce: unknown = null;
  private retry: unknown = null;
  private retryCount = 0;
  private disposed = false;
  private snapshot: SyncSnapshot;

  private readonly now: () => string;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly debounceMs: number;

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.debounceMs = deps.debounceMs ?? 800;
    this.snapshot = this.buildSnapshot();
  }

  // ---- public API

  subscribe(fn: (s: SyncSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getSnapshot(): SyncSnapshot {
    return this.snapshot;
  }

  /** The record as it is now (for tests and the exit flush). */
  getRecord(): CacheRecord {
    return this.rec;
  }

  /** Load the local copy at once, then reconcile with the cloud. */
  start(): Promise<void> {
    return this.run(async () => {
      const cached = await this.safeCacheLoad();
      if (cached) {
        // Apply any baseline correction at once, so the right numbers show
        // and are cached even with sync locked, unconfigured or offline.
        this.rec = migrateRecord(cached);
        if (!statesEqual(this.rec.state, cached.state) || this.rec.base !== cached.base) await this.persist();
      } else {
        const legacy = this.deps.legacy.read();
        this.rec = legacy
          ? newRecord(migrateState(legacy.state), "legacy", legacy.key)
          : newRecord(defaultState(), "default");
        await this.persist();
      }
      this.ready = true;
      this.emit();
      await this.doSync();
    });
  }

  /** A local edit: shown and cached at once, sent to the cloud after a short pause. */
  update(state: AppState): void {
    if (this.disposed || statesEqual(state, this.rec.state)) return;
    this.rec = { ...this.rec, state, pending: true };
    void this.persist();
    this.emit();
    this.schedulePush(this.debounceMs);
  }

  /** Fetch the cloud state and reconcile (polling, focus, reconnect). Coalesces repeated calls. */
  syncNow(): Promise<void> {
    if (this.syncQueued || !this.ready) return this.chain;
    this.syncQueued = true;
    return this.run(async () => {
      this.syncQueued = false;
      await this.doSync();
    });
  }

  /** Send pending changes now instead of waiting for the debounce. */
  flush(): Promise<void> {
    if (this.debounce !== null) {
      this.clearTimer(this.debounce);
      this.debounce = null;
    }
    return this.run(() => this.pushLoop());
  }

  /** Wait until every queued operation has finished. */
  idle(): Promise<void> {
    return this.chain;
  }

  /**
   * Settle a conflict. "cloud" keeps what is shown now and drops this device's
   * copy; "device" puts this device's version (whole state, or just the clashing
   * values) back and sends it.
   */
  resolveConflict(choice: "cloud" | "device"): Promise<void> {
    return this.run(async () => {
      const conflict = this.rec.conflict;
      if (!conflict) return;
      if (choice === "cloud") {
        this.rec = { ...this.rec, conflict: null };
        if (this.rec.legacyKey && !this.rec.pending && this.rec.baseVersion > 0) this.clearLegacy();
        await this.persist();
        this.emit();
        return;
      }
      const state = conflict.kind === "initial" ? conflict.local : applyLocalValues(this.rec.state, conflict.conflicts);
      this.rec = { ...this.rec, state, pending: true, conflict: null };
      await this.persist();
      this.emit();
      await this.pushLoop();
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounce !== null) this.clearTimer(this.debounce);
    if (this.retry !== null) this.clearTimer(this.retry);
    this.listeners.clear();
  }

  // ---- internals

  private run(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(async () => {
      if (this.disposed) return;
      try {
        await fn();
      } catch (err) {
        // A bug must not wedge the queue or lose the record; report and carry on.
        console.error("sync error", err);
        this.failure = { kind: "server", message: "Unexpected sync error. Your changes are kept on this device." };
        this.emit();
      }
    });
    this.chain = next;
    return next;
  }

  private schedulePush(ms: number) {
    if (this.debounce !== null) this.clearTimer(this.debounce);
    this.debounce = this.setTimer(() => {
      this.debounce = null;
      void this.run(() => this.pushLoop());
    }, ms);
  }

  private scheduleRetry() {
    if (this.retry !== null || this.disposed) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.retryCount);
    this.retryCount++;
    this.retry = this.setTimer(() => {
      this.retry = null;
      void this.syncNow();
    }, delay);
  }

  private succeeded() {
    this.failure = null;
    this.connected = true;
    this.retryCount = 0;
  }

  private failed(error: SyncFailure) {
    this.failure = error;
    this.emit();
    // Retrying cannot fix a missing or wrong key; wait for a new one (syncNow).
    if (error.kind !== "unauthorized") this.scheduleRetry();
  }

  private async doSync(): Promise<void> {
    const result: LoadResult = await this.deps.remote.load();
    if (result.type === "error") {
      this.failed(result.error);
      return;
    }
    this.succeeded();
    await this.apply(syncWithMigration(this.rec, result.record, this.now()));
  }

  private async apply(decision: SyncDecision): Promise<void> {
    this.rec = decision.record;
    if (decision.changedByRemote) this.remoteRevision++;
    if (decision.legacyVerified) this.clearLegacy();
    await this.persist();
    this.emit();
    if (decision.push) await this.pushLoop();
  }

  private async pushLoop(): Promise<void> {
    for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS && this.rec.pending && !this.disposed; attempt++) {
      const sent = this.rec.state;
      this.saving = true;
      this.emit();
      const result: SaveResult = await this.deps.remote.save(sent, this.rec.baseVersion);
      this.saving = false;

      if (result.type === "error") {
        this.failed(result.error);
        return;
      }
      this.succeeded();

      if (result.type === "conflict") {
        // Someone else saved first: merge with what they saved, then try again.
        const decision = syncWithMigration(this.rec, result.current, this.now());
        this.rec = decision.record;
        if (decision.changedByRemote) this.remoteRevision++;
        if (decision.legacyVerified) this.clearLegacy();
        await this.persist();
        this.emit();
        if (!decision.push) return;
        continue;
      }

      // Saved. Edits made while the request was in flight stay pending.
      const stillPending = !statesEqual(this.rec.state, sent);
      this.rec = {
        ...this.rec,
        base: result.record.state,
        baseVersion: result.record.version,
        pending: stillPending,
        origin: "cache",
      };
      await this.persist();
      this.emit();
      if (this.rec.legacyKey && !stillPending && !this.rec.conflict) await this.verifyLegacy();
    }
    if (this.rec.pending && !this.disposed && this.failure?.kind !== "unauthorized") this.scheduleRetry();
  }

  /** Read the record back and only then drop the pre-cloud localStorage copy. */
  private async verifyLegacy(): Promise<void> {
    const check = await this.deps.remote.load();
    if (check.type !== "ok" || !check.record) return;
    const { record } = check;
    if (
      record.version === this.rec.baseVersion &&
      this.rec.base &&
      statesEqual(migrateState(record.state), this.rec.base)
    ) {
      this.clearLegacy();
      await this.persist();
      this.emit();
    }
  }

  private clearLegacy() {
    try {
      this.deps.legacy.clear();
      this.rec = { ...this.rec, legacyKey: null };
    } catch {
      // keep the key; it is harmless and will be retried
    }
  }

  private async safeCacheLoad(): Promise<CacheRecord | null> {
    try {
      return await this.deps.cache.load();
    } catch {
      return null;
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.deps.cache.save(this.rec);
    } catch (err) {
      console.error("local cache save failed", err);
    }
  }

  private status(): SyncStatus {
    if (!this.ready) return "connecting";
    if (this.saving) return "saving";
    if (this.failure) return this.failure.kind === "offline" ? "offline" : "error";
    if (this.rec.pending) return "pending";
    if (!this.connected) return "connecting";
    return "synced";
  }

  private buildSnapshot(): SyncSnapshot {
    return {
      ready: this.ready,
      state: this.rec.state,
      status: this.status(),
      message: this.failure?.message ?? null,
      failureKind: this.failure?.kind ?? null,
      conflict: this.rec.conflict,
      remoteRevision: this.remoteRevision,
    };
  }

  private emit() {
    this.snapshot = this.buildSnapshot();
    for (const fn of this.listeners) fn(this.snapshot);
  }
}
