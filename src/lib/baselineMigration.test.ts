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
  recordMarks,
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

// The swap-week courses after every revision step: the record's numbers (revision 4).
const NEW = { CSE2253: [30, 37], CSE2258: [32, 37], MAT2303: [35, 45] };

function store(data: Record<string, string>) {
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
  };
}

describe("defaults", () => {
  it("held hours total 334 (313 plus 21 suspended) and new states start at the current revision", () => {
    expect(COURSE_CODES.reduce((sum, c) => sum + PORTAL_BASELINE[c][1], 0)).toBe(334);
    expect(BASELINE_REVISION).toBe(5);
    expect(defaultState().settings.baselineRevision).toBe(5);
    expect(migrateState(defaultState())).toEqual(defaultState());
  });
});

describe("migrateState", () => {
  it("replaces untouched old defaults with the corrected numbers", () => {
    const m = migrateState(oldState());
    expect(m.settings.baseline).toMatchObject(NEW);
    expect(m.settings.baselineRevision).toBe(5);
    // The other eight courses are unchanged.
    for (const c of COURSE_CODES.filter((c) => !(c in NEW))) expect(m.settings.baseline[c]).toEqual(PORTAL_BASELINE[c]);
  });

  it("keeps a course edited by hand", () => {
    const s = oldState();
    s.settings.baseline.MAT2303 = [27, 39];
    const m = migrateState(s);
    expect(m.settings.baseline.MAT2303).toEqual([27, 39]);
    expect(m.settings.baseline.CSE2253).toEqual([30, 37]);
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
    expect(validateState(defaultState()).settings.baselineRevision).toBe(5);
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
    expect(state.settings.baselineRevision).toBe(5);
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
    // The record marks from both sides, with each side's own edit on top.
    expect(merged.marks).toEqual({ ...recordMarks(), "2026-11-12@1": "skipped", "2026-11-13@1": "attended" });
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

describe("revision 3: Sat 21 Nov working day", () => {
  const SAT = { date: "2026-11-21", followsWeekday: 1, reason: "Saturday working day" };

  it("adds 21 Nov to a revision-2 state, keeping its other days", () => {
    const s = defaultState();
    s.settings.baselineRevision = 2;
    s.settings.extraWorkingDays = [{ date: "2026-12-05", followsWeekday: 1, reason: "Make-up for Mon 9 Nov holiday" }];
    const m = migrateState(s);
    expect(m.settings.extraWorkingDays.map((x) => x.date)).toEqual(["2026-11-21", "2026-12-05"]);
    expect(m.settings.extraWorkingDays[0]).toEqual(SAT);
    expect(m.settings.baselineRevision).toBe(5);
  });

  it("keeps an entry for 21 Nov set by hand", () => {
    const s = defaultState();
    s.settings.baselineRevision = 2;
    s.settings.extraWorkingDays = [{ date: "2026-11-21", followsWeekday: 5, reason: "mine" }];
    expect(migrateState(s).settings.extraWorkingDays).toEqual([{ date: "2026-11-21", followsWeekday: 5, reason: "mine" }]);
  });

  it("does not bring 21 Nov back once removed at revision 3", () => {
    const s = defaultState();
    s.settings.extraWorkingDays = s.settings.extraWorkingDays.filter((x) => x.date !== "2026-11-21");
    expect(migrateState(s)).toBe(s);
  });

  it("a revision-1 state gets the baseline correction and the new day", () => {
    const m = migrateState(oldState());
    expect(m.settings.baseline).toMatchObject(NEW);
    expect(m.settings.extraWorkingDays.some((x) => x.date === "2026-11-21")).toBe(true);
  });

  it("two devices migrating on their own end up identical", () => {
    const a = migrateState(oldState());
    const b = migrateState(oldState());
    expect(statesEqual(a, b)).toBe(true);
  });
});

describe("revision 5: 11-19 Nov marks from the record", () => {
  it("a fresh state starts with the record's marks for the plan window", () => {
    const marks = defaultState().marks;
    expect(Object.keys(marks)).toHaveLength(33);
    expect(marks["2026-11-13@1"]).toBe("skipped"); // Fri 13 Nov Comp Org: A
    expect(marks["2026-11-16@3"]).toBe("attended"); // Mon 16 Nov DS Lab: P P
    expect(marks["2026-11-19@3"]).toBe("skipped"); // Thu 19 Nov DCCN: A
    expect(Object.keys(marks).every((id) => id > "2026-11-10")).toBe(true);
  });

  it("an older state gets the record marks, but keeps the ones you set yourself", () => {
    const s = defaultState();
    s.settings.baselineRevision = 4;
    s.marks = { "2026-11-13@1": "attended" }; // you say you went
    const m = migrateState(s);
    expect(m.marks["2026-11-13@1"]).toBe("attended");
    expect(m.marks["2026-11-19@3"]).toBe("skipped");
    expect(Object.keys(m.marks)).toHaveLength(33);
  });
});
