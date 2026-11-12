import { describe, expect, it } from "vitest";
import { BASELINE_REVISION, COURSE_CODES, PORTAL_BASELINE, odStateAll } from "./config";
import { parseCacheRecord } from "./localCache";
import { mergeStates, statesEqual } from "./merge";
import { handlePut, memoryRepo } from "./server/plannerApi";
import {
  STORAGE_KEY,
  STORAGE_KEY_V1,
  STORAGE_KEY_V2,
  defaultState,
  loadFrom,
  migrateState,
  readLegacy,
  tryValidateState,
  validateState,
  type AppState,
} from "./storage";
import { newRecord, syncWithMigration } from "./sync";

/** A state as saved before the swap-week correction: old numbers, no revision field. */
function oldState(): AppState {
  const s = defaultState();
  delete s.settings.baselineRevision;
  s.settings.baseline = { ...s.settings.baseline, CSE2253: [25, 33], CSE2258: [27, 34], MAT2303: [26, 38] };
  return s;
}

const NEW = { CSE2253: [26, 34], CSE2258: [28, 35], MAT2303: [25, 37] };

function store(data: Record<string, string>) {
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
  };
}

describe("defaults", () => {
  it("held hours total 313 and new states start at the current revision", () => {
    expect(COURSE_CODES.reduce((sum, c) => sum + PORTAL_BASELINE[c][1], 0)).toBe(313);
    expect(BASELINE_REVISION).toBe(2);
    expect(defaultState().settings.baselineRevision).toBe(2);
    expect(migrateState(defaultState())).toEqual(defaultState());
  });
});

describe("migrateState", () => {
  it("replaces untouched old defaults with the corrected numbers", () => {
    const m = migrateState(oldState());
    expect(m.settings.baseline).toMatchObject(NEW);
    expect(m.settings.baselineRevision).toBe(2);
    // The other eight courses are unchanged.
    for (const c of COURSE_CODES.filter((c) => !(c in NEW))) expect(m.settings.baseline[c]).toEqual(PORTAL_BASELINE[c]);
  });

  it("keeps a course edited by hand", () => {
    const s = oldState();
    s.settings.baseline.MAT2303 = [27, 39];
    const m = migrateState(s);
    expect(m.settings.baseline.MAT2303).toEqual([27, 39]);
    expect(m.settings.baseline.CSE2253).toEqual([26, 34]);
  });

  it("is idempotent", () => {
    const once = migrateState(oldState());
    expect(migrateState(once)).toBe(once);
    expect(migrateState(migrateState(oldState()))).toEqual(once);
  });

  it("treats revision 1 and a missing field the same", () => {
    const r1 = oldState();
    r1.settings.baselineRevision = 1;
    expect(migrateState(r1)).toEqual(migrateState(oldState()));
  });

  it("leaves marks and every other setting alone", () => {
    const s = oldState();
    s.marks["2026-11-12@1"] = "skipped";
    s.settings.odState = odStateAll(false);
    const m = migrateState(s);
    expect(m.marks).toEqual(s.marks);
    expect(m.settings.odState).toEqual(s.settings.odState);
  });
});

describe("validators", () => {
  it("accept states with and without baselineRevision, and reject a bad one", () => {
    expect(validateState(oldState()).settings.baselineRevision).toBeUndefined();
    expect(validateState(defaultState()).settings.baselineRevision).toBe(2);
    const bad = defaultState() as unknown as { settings: Record<string, unknown> };
    bad.settings.baselineRevision = "2";
    expect(tryValidateState(bad)).toBeNull();
  });

  it("the API accepts a save from an older client that omits the field", async () => {
    const res = await handlePut(memoryRepo(), { state: oldState(), expectedVersion: 0 });
    expect(res.status).toBe(200);
  });
});

describe("legacy chain", () => {
  it("v3 with old defaults ends on the new baseline", () => {
    const s = store({ [STORAGE_KEY]: JSON.stringify(oldState()) });
    expect(readLegacy(s)?.state.settings.baseline).toMatchObject(NEW);
    expect(loadFrom(s).settings.baseline).toMatchObject(NEW);
  });

  it("v2 with old defaults ends on the new baseline", () => {
    const { windowEnd: _w, extraWorkingDays: _x, ...v2 } = oldState().settings;
    const raw = JSON.stringify({ settings: v2, marks: {} });
    expect(readLegacy(store({ [STORAGE_KEY_V2]: raw }))?.state.settings.baseline).toMatchObject(NEW);
    expect(loadFrom(store({ [STORAGE_KEY_V2]: raw })).settings.baseline).toMatchObject(NEW);
  });

  it("v1 ends on the new baseline", () => {
    const table = Object.fromEntries(COURSE_CODES.map((c) => [c, [1, 2]]));
    const raw = JSON.stringify({
      settings: {
        scenario: "odsGranted",
        targetPct: 75,
        cushionHours: 1,
        baselineAsOf: "2026-11-10",
        baselines: { odsGranted: table, odsPending: table },
        holidays: [],
      },
      marks: {},
    });
    const state = readLegacy(store({ [STORAGE_KEY_V1]: raw }))!.state;
    expect(state.settings.baseline).toMatchObject(NEW);
    expect(state.settings.baselineRevision).toBe(2);
  });
});

describe("cache and merge", () => {
  it("the IndexedDB record migrates both the shown state and the confirmed base", () => {
    const rec = { ...newRecord(oldState(), "cache"), base: oldState(), baseVersion: 3 };
    const parsed = parseCacheRecord(JSON.parse(JSON.stringify(rec)))!;
    expect(parsed.state.settings.baseline).toMatchObject(NEW);
    expect(parsed.base?.settings.baseline).toMatchObject(NEW);
    expect(statesEqual(parsed.state, parsed.base!)).toBe(true);
  });

  it("migrated local, base and remote merge with no conflict and no diff", () => {
    const m = (s: AppState) => migrateState(s);
    const { merged, conflicts } = mergeStates(m(oldState()), m(oldState()), m(oldState()));
    expect(conflicts).toEqual([]);
    expect(statesEqual(merged, migrateState(oldState()))).toBe(true);
  });

  it("a remote that already has the new numbers merges cleanly with a local that had the old ones", () => {
    const local = migrateState(oldState());
    local.marks["2026-11-12@1"] = "skipped";
    const remote = defaultState();
    remote.marks["2026-11-13@1"] = "attended";
    const { merged, conflicts } = mergeStates(migrateState(oldState()), local, remote);
    expect(conflicts).toEqual([]);
    expect(merged.settings.baseline).toMatchObject(NEW);
    expect(merged.marks).toEqual({ "2026-11-12@1": "skipped", "2026-11-13@1": "attended" });
  });

  it("an old-revision cloud row is compared migrated, then queued once for upgrade", () => {
    // A device synced at version 4 before the correction; nothing else changed.
    const rec = { ...newRecord(migrateState(oldState()), "cache"), base: migrateState(oldState()), baseVersion: 4 };
    const d = syncWithMigration(rec, { state: oldState(), version: 4, updatedAt: null }, "now");
    expect(d.record.conflict).toBeNull();
    expect(d.changedByRemote).toBe(false);
    expect(d.push).toBe(true); // upload the corrected numbers once
    expect(d.record.state.settings.baseline).toMatchObject(NEW);
  });

  it("a never-synced device with old local data and an old cloud row sees no false conflict", () => {
    const rec = newRecord(migrateState(oldState()), "legacy", STORAGE_KEY);
    const d = syncWithMigration(rec, { state: oldState(), version: 2, updatedAt: null }, "now");
    expect(d.record.conflict).toBeNull();
    expect(d.legacyVerified).toBe(true);
  });
});
