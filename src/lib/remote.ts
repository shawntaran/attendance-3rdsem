// Client side of /api/planner. Never talks to Supabase directly: the browser
// only ever sees this app's own API, and the service-role key stays on the server.

import { tryValidateState, type AppState } from "./storage";

export interface RemoteRecord {
  state: AppState;
  version: number;
  updatedAt: string | null;
}

export type FailureKind = "offline" | "not_configured" | "server" | "invalid";

export interface SyncFailure {
  kind: FailureKind;
  message: string;
}

export type LoadResult = { type: "ok"; record: RemoteRecord | null } | { type: "error"; error: SyncFailure };

export type SaveResult =
  | { type: "saved"; record: RemoteRecord }
  /** Another device wrote first; `current` is what the server has now (null if the row is gone). */
  | { type: "conflict"; current: RemoteRecord | null }
  | { type: "error"; error: SyncFailure };

export interface RemoteApi {
  load(): Promise<LoadResult>;
  save(state: AppState, expectedVersion: number): Promise<SaveResult>;
}

const ENDPOINT = "/api/planner";
const TIMEOUT_MS = 15_000;

/** Read a { state, version, updatedAt } payload. null state + version 0 = no record yet. */
function readPayload(body: unknown): RemoteRecord | null | "invalid" {
  if (typeof body !== "object" || body === null) return "invalid";
  const { state, version, updatedAt } = body as Record<string, unknown>;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) return "invalid";
  if (state === null) return version === 0 ? null : "invalid";
  const valid = tryValidateState(state);
  if (!valid) return "invalid";
  return { state: valid, version, updatedAt: typeof updatedAt === "string" ? updatedAt : null };
}

async function failureFrom(res: Response): Promise<SyncFailure> {
  let code = "";
  let message = `Server error ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    code = body.error ?? "";
    if (body.message) message = body.message;
  } catch {
    // not JSON
  }
  if (code === "not_configured") return { kind: "not_configured", message: "Cloud sync is not set up on the server." };
  return { kind: "server", message };
}

function offline(err: unknown): SyncFailure {
  const aborted = err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
  return { kind: "offline", message: aborted ? "The server took too long to answer." : "No connection to the server." };
}

async function request(init: RequestInit): Promise<Response> {
  return fetch(ENDPOINT, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

/** GET the authoritative state. */
export async function loadRemoteState(): Promise<LoadResult> {
  let res: Response;
  try {
    res = await request({ method: "GET" });
  } catch (err) {
    return { type: "error", error: offline(err) };
  }
  if (!res.ok) return { type: "error", error: await failureFrom(res) };
  const record = readPayload(await res.json().catch(() => null));
  if (record === "invalid") return { type: "error", error: { kind: "invalid", message: "The server sent a state that does not validate." } };
  return { type: "ok", record };
}

/** PUT a new state, only if the server is still at expectedVersion. */
export async function saveRemoteState(state: AppState, expectedVersion: number): Promise<SaveResult> {
  let res: Response;
  try {
    res = await request({ method: "PUT", body: JSON.stringify({ state, expectedVersion }) });
  } catch (err) {
    return { type: "error", error: offline(err) };
  }
  if (res.status === 409) {
    const current = readPayload(await res.json().catch(() => null));
    if (current === "invalid") return { type: "error", error: { kind: "invalid", message: "The server sent a state that does not validate." } };
    return { type: "conflict", current };
  }
  if (!res.ok) return { type: "error", error: await failureFrom(res) };
  const record = readPayload(await res.json().catch(() => null));
  if (!record || record === "invalid") {
    return { type: "error", error: { kind: "invalid", message: "The server's reply to a save does not validate." } };
  }
  return { type: "saved", record };
}

/**
 * Best-effort save while the page is closing. The response cannot be read, so
 * the change also stays pending in the local cache; the next launch sees
 * whether it landed and merges accordingly, so nothing is lost either way.
 */
export function saveRemoteStateOnExit(state: AppState, expectedVersion: number): void {
  try {
    const body = JSON.stringify({ state, expectedVersion });
    if (body.length > 60_000) return; // keepalive requests are limited to 64 KB
    void fetch(ENDPOINT, { method: "PUT", body, keepalive: true, headers: { "Content-Type": "application/json" } });
  } catch {
    // ignore: the pending change is still in the cache
  }
}

export const remoteApi: RemoteApi = { load: loadRemoteState, save: saveRemoteState };
