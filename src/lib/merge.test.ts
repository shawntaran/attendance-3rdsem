import { describe, expect, it } from "vitest";
import { applyLocalValues, flatten, mergeStates, statesEqual, unflatten } from "./merge";
import { defaultState, type AppState } from "./storage";

function edit(base: AppState, fn: (s: AppState) => void): AppState {
  const s = structuredClone(base);
  fn(s);
  return s;
}

describe("flatten / unflatten", () => {
  it("round-trips every part of the state", () => {
    const s = edit(defaultState(), (x) => {
      x.marks["2026-11-12@1"] = "skipped";
      x.settings.holidays = ["2026-11-20"];
      x.settings.odState["od-2026-10-30"] = { on: false, inPortal: true };
      x.settings.baseline.MAT2303 = [27, 39];
      // Validation keeps extra working days sorted by date, so add it in order.
      x.settings.extraWorkingDays.unshift({ date: "2026-11-28", followsWeekday: 3, reason: "x" });
      x.settings.theme = "dark";
    });
    expect(unflatten(flatten(s))).toEqual(s);
    expect(statesEqual(s, structuredClone(s))).toBe(true);
    expect(statesEqual(s, defaultState())).toBe(false);
  });

  it("refuses to build an invalid state", () => {
    const flat = flatten(defaultState());
    flat.set("settings.targetPct", "500");
    expect(() => unflatten(flat)).toThrow();
  });
});

describe("mergeStates", () => {
  const base = edit(defaultState(), (s) => {
    s.marks["2026-11-12@1"] = "attended";
  });

  it("keeps independent attendance marks from both sides", () => {
    const local = edit(base, (s) => (s.marks["2026-11-13@1"] = "skipped"));
    const remote = edit(base, (s) => (s.marks["2026-11-16@1"] = "attended"));
    const { merged, conflicts } = mergeStates(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(merged.marks).toEqual({
      "2026-11-12@1": "attended",
      "2026-11-13@1": "skipped",
      "2026-11-16@1": "attended",
    });
  });

  it("merges different settings keys, OD toggles and holidays", () => {
    const local = edit(base, (s) => {
      s.settings.cushionHours = 2;
      s.settings.odState["od-2026-09-04"] = { on: false, inPortal: false };
      s.settings.holidays = ["2026-11-20"];
    });
    const remote = edit(base, (s) => {
      s.settings.theme = "dark";
      s.settings.odState["od-2026-10-30"] = { on: true, inPortal: true };
      s.settings.holidays = ["2026-11-27"];
    });
    const { merged, conflicts } = mergeStates(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(merged.settings.cushionHours).toBe(2);
    expect(merged.settings.theme).toBe("dark");
    expect(merged.settings.odState["od-2026-09-04"].on).toBe(false);
    expect(merged.settings.odState["od-2026-10-30"].inPortal).toBe(true);
    expect(merged.settings.holidays).toEqual(["2026-11-20", "2026-11-27"]);
  });

  it("a mark removed on one side and untouched on the other is removed", () => {
    const local = edit(base, (s) => delete s.marks["2026-11-12@1"]);
    const { merged } = mergeStates(base, local, base);
    expect(merged.marks).toEqual({});
  });

  it("the same mark changed differently is a conflict: remote wins, local is reported", () => {
    const local = edit(base, (s) => (s.marks["2026-11-12@1"] = "skipped"));
    const remote = edit(base, (s) => delete s.marks["2026-11-12@1"]);
    const { merged, conflicts } = mergeStates(base, local, remote);
    expect(merged.marks["2026-11-12@1"]).toBeUndefined();
    expect(conflicts).toEqual([{ path: "mark/2026-11-12@1", base: '"attended"', local: '"skipped"', remote: undefined }]);
    // Recovery puts the local value back.
    expect(applyLocalValues(merged, conflicts).marks["2026-11-12@1"]).toBe("skipped");
  });

  it("the same change on both sides is not a conflict", () => {
    const both = edit(base, (s) => (s.settings.targetPct = 80));
    expect(mergeStates(base, both, structuredClone(both)).conflicts).toEqual([]);
  });
});
