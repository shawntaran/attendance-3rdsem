import { describe, expect, it } from "vitest";
import { defaultState, type AppState } from "../storage";
import { handleGet, handlePut } from "./plannerApi";
import { memoryVersionStore, versionedRepo } from "./versionedRepo";

function withMark(id: string): AppState {
  const s = defaultState();
  s.marks[id] = "skipped";
  return s;
}

function setup(options = {}) {
  const store = memoryVersionStore();
  return { store, repo: versionedRepo(store, options) };
}

describe("versioned store behind /api/planner", () => {
  it("starts empty, creates v1, then adds one row per save", async () => {
    const { store, repo } = setup();
    expect((await handleGet(repo)).body).toEqual({ state: null, version: 0, updatedAt: null });
    expect((await handlePut(repo, { state: withMark("2026-11-12@1"), expectedVersion: 0 })).body).toMatchObject({ version: 1 });
    expect((await handlePut(repo, { state: withMark("2026-11-13@1"), expectedVersion: 1 })).body).toMatchObject({ version: 2 });
    expect([...store.rows.keys()].sort()).toEqual([1, 2]);
    expect((await handleGet(repo)).body).toMatchObject({ version: 2, state: { marks: { "2026-11-13@1": "skipped" } } });
  });

  it("a stale save is a 409 with the current state, and writes nothing", async () => {
    const { store, repo } = setup();
    await handlePut(repo, { state: defaultState(), expectedVersion: 0 });
    await handlePut(repo, { state: withMark("2026-11-12@1"), expectedVersion: 1 });
    const stale = await handlePut(repo, { state: withMark("2026-11-16@1"), expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ version: 2, state: { marks: { "2026-11-12@1": "skipped" } } });
    expect(store.rows.size).toBe(2);
  });

  it("of two concurrent writers from the same version, exactly one wins", async () => {
    const { repo } = setup();
    await handlePut(repo, { state: defaultState(), expectedVersion: 0 });
    const results = await Promise.all([
      handlePut(repo, { state: withMark("2026-11-12@1"), expectedVersion: 1 }),
      handlePut(repo, { state: withMark("2026-11-13@1"), expectedVersion: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("a second first-insert is a conflict, not an overwrite", async () => {
    const { repo } = setup();
    await handlePut(repo, { state: withMark("2026-11-12@1"), expectedVersion: 0 });
    expect((await handlePut(repo, { state: defaultState(), expectedVersion: 0 })).status).toBe(409);
  });

  it("prunes old history but keeps the latest versions", async () => {
    const { store, repo } = setup({ keep: 5, pruneEvery: 5 });
    await handlePut(repo, { state: defaultState(), expectedVersion: 0 });
    for (let v = 1; v < 12; v++) await handlePut(repo, { state: withMark(`2026-11-1${v % 10}@1`), expectedVersion: v });
    const versions = [...store.rows.keys()].sort((a, b) => a - b);
    expect(versions.at(-1)).toBe(12);
    expect(versions[0]).toBeGreaterThan(1);
    expect(versions).toContain(12 - 5);
  });

  it("a client far behind cannot slip into a pruned gap", async () => {
    const { store, repo } = setup({ keep: 3, pruneEvery: 1 });
    await handlePut(repo, { state: defaultState(), expectedVersion: 0 });
    for (let v = 1; v < 8; v++) await handlePut(repo, { state: withMark("2026-11-12@1"), expectedVersion: v });
    expect(store.rows.has(2)).toBe(false); // v2 was pruned
    // A device last synced at version 1 tries to save v2 into the gap.
    const res = await handlePut(repo, { state: withMark("2026-11-30@1"), expectedVersion: 1 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ version: 8 });
    expect(store.rows.has(2)).toBe(false); // its row was taken back out
    expect((await handleGet(repo)).body).toMatchObject({ version: 8 });
  });

  it("a stored row that is not valid JSON is reported, never overwritten", async () => {
    const { store, repo } = setup();
    store.rows.set(1, { version: 1, state: "{broken", createdAt: "t" });
    expect((await handleGet(repo)).status).toBe(500);
    expect(store.rows.get(1)?.state).toBe("{broken");
  });

  it("database failures are reported as 502", async () => {
    const { store, repo } = setup();
    store.fail = true;
    expect((await handleGet(repo)).status).toBe(502);
    expect((await handlePut(repo, { state: defaultState(), expectedVersion: 0 })).status).toBe(502);
  });
});
