// Request handling for /api/planner, kept free of Next.js and Supabase so it
// can be tested with an in-memory repository.

import { tryValidateState, validateState, type AppState } from "../storage";

export interface StoredRecord {
  /** Raw JSON from the database; validated before it is returned. */
  state: unknown;
  version: number;
  updatedAt: string;
}

/** The only database operations the API needs. Each is a single atomic statement. */
export interface PlannerRepo {
  get(): Promise<StoredRecord | null>;
  /** Create the record at version 1. "exists" if it is already there. */
  insert(state: AppState): Promise<StoredRecord | "exists">;
  /** Replace the state and bump the version, only if it is still expectedVersion. */
  update(state: AppState, expectedVersion: number): Promise<StoredRecord | "stale">;
}

export interface ApiResult {
  status: number;
  body: unknown;
}

/** What GET and a successful PUT return. version 0 and state null mean "no record yet". */
export interface PlannerPayload {
  state: AppState | null;
  version: number;
  updatedAt: string | null;
}

export const MAX_BODY_BYTES = 256 * 1024;

function payload(record: StoredRecord | null): PlannerPayload | "invalid" {
  if (!record) return { state: null, version: 0, updatedAt: null };
  const state = tryValidateState(record.state);
  if (!state) return "invalid";
  return { state, version: record.version, updatedAt: record.updatedAt };
}

function dbError(err: unknown): ApiResult {
  // The message stays in the server logs; the client only needs to know it failed.
  console.error("planner_state database error", err);
  return { status: 502, body: { error: "database_error" } };
}

const INVALID_STORED: ApiResult = {
  status: 500,
  body: { error: "invalid_stored_state", message: "The saved record does not pass validation; it was not changed." },
};

export async function handleGet(repo: PlannerRepo): Promise<ApiResult> {
  let record: StoredRecord | null;
  try {
    record = await repo.get();
  } catch (err) {
    return dbError(err);
  }
  const body = payload(record);
  return body === "invalid" ? INVALID_STORED : { status: 200, body };
}

export async function handlePut(repo: PlannerRepo, body: unknown): Promise<ApiResult> {
  if (typeof body !== "object" || body === null) {
    return { status: 400, body: { error: "invalid_body" } };
  }
  const { state: rawState, expectedVersion } = body as Record<string, unknown>;
  if (typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return { status: 400, body: { error: "invalid_expected_version" } };
  }
  let state: AppState;
  try {
    state = validateState(rawState);
  } catch (err) {
    return { status: 400, body: { error: "invalid_state", message: err instanceof Error ? err.message : "invalid" } };
  }

  // The new version is always decided here (expected + 1, or 1 on insert);
  // nothing in the request body can set it.
  let result: StoredRecord | "exists" | "stale";
  try {
    result = expectedVersion === 0 ? await repo.insert(state) : await repo.update(state, expectedVersion);
  } catch (err) {
    return dbError(err);
  }

  if (result === "exists" || result === "stale") {
    // Someone else wrote first. Send back what is there now so the client can merge.
    let current: StoredRecord | null;
    try {
      current = await repo.get();
    } catch (err) {
      return dbError(err);
    }
    const now = payload(current);
    if (now === "invalid") return INVALID_STORED;
    return { status: 409, body: { error: "conflict", ...now } };
  }

  const saved = payload(result);
  return saved === "invalid" ? INVALID_STORED : { status: 200, body: saved };
}

/** An in-memory repository with the same atomic semantics, for tests and local fakes. */
export function memoryRepo(initial: StoredRecord | null = null): PlannerRepo & { record: StoredRecord | null; fail: boolean } {
  const repo = {
    record: initial,
    fail: false,
    tick: 0,
    async get() {
      if (repo.fail) throw new Error("db down");
      return repo.record ? structuredClone(repo.record) : null;
    },
    async insert(state: AppState) {
      if (repo.fail) throw new Error("db down");
      if (repo.record) return "exists" as const;
      repo.record = { state: structuredClone(state), version: 1, updatedAt: new Date(++repo.tick).toISOString() };
      return structuredClone(repo.record);
    },
    async update(state: AppState, expectedVersion: number) {
      if (repo.fail) throw new Error("db down");
      if (!repo.record || repo.record.version !== expectedVersion) return "stale" as const;
      repo.record = {
        state: structuredClone(state),
        version: expectedVersion + 1,
        updatedAt: new Date(++repo.tick).toISOString(),
      };
      return structuredClone(repo.record);
    },
  };
  return repo;
}
