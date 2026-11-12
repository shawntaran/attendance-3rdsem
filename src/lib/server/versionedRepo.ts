// The planner record as an append-only list of versions: every save adds a
// new row whose id is fixed by its version ("v1", "v2", ...), and a unique
// index on `version` backs that up. Creating a row whose id or version already
// exists is refused atomically by the database, so "save as version n+1"
// succeeds for exactly one writer: that is the compare-and-swap the API needs,
// without relying on transactions. The newest row is the current state.
//
// Kept free of any SDK so its rules can be tested with an in-memory store.

import type { AppState } from "../storage";
import type { PlannerRepo, StoredRecord } from "./plannerApi";

export interface VersionRow {
  version: number;
  /** The state as a JSON string. */
  state: string;
  createdAt: string;
}

/** The few storage operations needed. `create` must be atomic on the version. */
export interface VersionStore {
  latest(): Promise<VersionRow | null>;
  /** "exists" if a row for this version is already there. */
  create(version: number, state: string): Promise<VersionRow | "exists">;
  remove(version: number): Promise<void>;
  /** Delete every row with a version below this one. */
  pruneBelow(version: number): Promise<void>;
}

export interface VersionedRepoOptions {
  /** How many recent versions to keep as history. */
  keep?: number;
  /** Prune every this many versions, to save requests. */
  pruneEvery?: number;
}

function toRecord(row: VersionRow): StoredRecord {
  let state: unknown;
  try {
    state = JSON.parse(row.state);
  } catch {
    // Left as the raw string: validation fails and the API reports it,
    // without ever writing over it.
    state = row.state;
  }
  return { state, version: row.version, updatedAt: row.createdAt };
}

export function versionedRepo(store: VersionStore, options: VersionedRepoOptions = {}): PlannerRepo {
  const keep = options.keep ?? 200;
  const pruneEvery = options.pruneEvery ?? 25;

  return {
    async get() {
      const row = await store.latest();
      return row ? toRecord(row) : null;
    },

    async insert(state: AppState) {
      // Rows are only ever pruned while newer ones exist, so "no rows at all"
      // really means no record. Two first inserts race on creating v1; one loses.
      if (await store.latest()) return "exists";
      const created = await store.create(1, JSON.stringify(state));
      return created === "exists" ? "exists" : toRecord(created);
    },

    async update(state: AppState, expectedVersion: number) {
      const next = expectedVersion + 1;
      const created = await store.create(next, JSON.stringify(state));
      if (created === "exists") return "stale";

      // Versions are contiguous, so v(n+1) can only be free if the record is
      // still at n, or if n+1 was pruned long ago (a client hundreds of saves
      // behind). Rule the second case out: our row must be the newest.
      const latest = await store.latest();
      if (!latest || latest.version !== next) {
        try {
          await store.remove(next);
        } catch {
          // A leftover older row is never read as current; harmless.
        }
        return "stale";
      }

      if (next % pruneEvery === 0 && next > keep) {
        try {
          await store.pruneBelow(next - keep);
        } catch (err) {
          console.error("planner history prune failed", err);
        }
      }
      return toRecord(created);
    },
  };
}

/** In-memory store with the same atomic rules, for tests. */
export function memoryVersionStore() {
  const rows = new Map<number, VersionRow>();
  let tick = 0;
  const store = {
    rows,
    fail: false,
    async latest() {
      if (store.fail) throw new Error("db down");
      let best: VersionRow | null = null;
      for (const r of rows.values()) if (!best || r.version > best.version) best = r;
      return best ? { ...best } : null;
    },
    async create(version: number, state: string) {
      if (store.fail) throw new Error("db down");
      if (rows.has(version)) return "exists" as const;
      const row = { version, state, createdAt: new Date(++tick).toISOString() };
      rows.set(version, row);
      return { ...row };
    },
    async remove(version: number) {
      rows.delete(version);
    },
    async pruneBelow(version: number) {
      for (const v of [...rows.keys()]) if (v < version) rows.delete(v);
    },
  };
  return store;
}
