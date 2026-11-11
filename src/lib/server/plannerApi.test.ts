import { describe, expect, it } from "vitest";
import { defaultState } from "../storage";
import { handleGet, handlePut, memoryRepo } from "./plannerApi";

function withMark(id: string, mark: "attended" | "skipped" = "skipped") {
  const s = defaultState();
  s.marks[id] = mark;
  return s;
}

describe("GET /api/planner", () => {
  it("handles an uninitialized database", async () => {
    expect(await handleGet(memoryRepo())).toEqual({
      status: 200,
      body: { state: null, version: 0, updatedAt: null },
    });
  });

  it("returns the stored state and version", async () => {
    const repo = memoryRepo();
    await handlePut(repo, { state: withMark("2026-11-12@1"), expectedVersion: 0 });
    const res = await handleGet(repo);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 1, state: { marks: { "2026-11-12@1": "skipped" } } });
  });

  it("refuses to return a stored state that does not validate", async () => {
    const repo = memoryRepo({ state: { settings: {}, marks: {} }, version: 3, updatedAt: "x" });
    expect((await handleGet(repo)).status).toBe(500);
  });

  it("reports a failed database request", async () => {
    const repo = memoryRepo();
    repo.fail = true;
    expect(await handleGet(repo)).toEqual({ status: 502, body: { error: "database_error" } });
  });
});

describe("PUT /api/planner", () => {
  it("creates the record at version 1, then increments by one per update", async () => {
    const repo = memoryRepo();
    const a = await handlePut(repo, { state: withMark("2026-11-12@1"), expectedVersion: 0 });
    expect(a).toMatchObject({ status: 200, body: { version: 1 } });
    const b = await handlePut(repo, { state: withMark("2026-11-13@1"), expectedVersion: 1 });
    expect(b).toMatchObject({ status: 200, body: { version: 2, state: { marks: { "2026-11-13@1": "skipped" } } } });
    expect(repo.record?.version).toBe(2);
  });

  it("rejects a stale version with 409 and returns the current state", async () => {
    const repo = memoryRepo();
    await handlePut(repo, { state: withMark("2026-11-12@1"), expectedVersion: 0 });
    await handlePut(repo, { state: withMark("2026-11-13@1"), expectedVersion: 1 });
    const stale = await handlePut(repo, { state: withMark("2026-11-16@1"), expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: "conflict", version: 2, state: { marks: { "2026-11-13@1": "skipped" } } });
    // Nothing was overwritten.
    expect((repo.record?.state as { marks: object }).marks).toEqual({ "2026-11-13@1": "skipped" });
  });

  it("a second insert from another device is a conflict, not an overwrite", async () => {
    const repo = memoryRepo();
    await handlePut(repo, { state: withMark("2026-11-12@1"), expectedVersion: 0 });
    const second = await handlePut(repo, { state: withMark("2026-11-13@1"), expectedVersion: 0 });
    expect(second.status).toBe(409);
    expect(repo.record?.version).toBe(1);
  });

  it("of two concurrent writers from the same version, exactly one wins", async () => {
    const repo = memoryRepo();
    await handlePut(repo, { state: defaultState(), expectedVersion: 0 });
    const [x, y] = await Promise.all([
      handlePut(repo, { state: withMark("2026-11-12@1"), expectedVersion: 1 }),
      handlePut(repo, { state: withMark("2026-11-13@1"), expectedVersion: 1 }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(repo.record?.version).toBe(2);
  });

  it("ignores any version the client tries to set", async () => {
    const repo = memoryRepo();
    const res = await handlePut(repo, { state: defaultState(), expectedVersion: 0, version: 999 });
    expect(res.body).toMatchObject({ version: 1 });
  });

  it.each([
    ["not an object", "hello"],
    ["missing expectedVersion", { state: defaultState() }],
    ["negative expectedVersion", { state: defaultState(), expectedVersion: -1 }],
    ["fractional expectedVersion", { state: defaultState(), expectedVersion: 1.5 }],
    ["missing state", { expectedVersion: 0 }],
    ["malformed state", { state: { settings: { theme: "neon" }, marks: {} }, expectedVersion: 0 }],
    ["bad mark", { state: { ...defaultState(), marks: { "2026-11-12@1": "maybe" } }, expectedVersion: 0 }],
  ])("rejects %s with 400 and writes nothing", async (_name, body) => {
    const repo = memoryRepo();
    expect((await handlePut(repo, body)).status).toBe(400);
    expect(repo.record).toBeNull();
  });

  it("reports a failed database request without changing anything", async () => {
    const repo = memoryRepo();
    await handlePut(repo, { state: defaultState(), expectedVersion: 0 });
    repo.fail = true;
    expect((await handlePut(repo, { state: withMark("2026-11-12@1"), expectedVersion: 1 })).status).toBe(502);
    repo.fail = false;
    expect(repo.record?.version).toBe(1);
  });
});
