import { describe, expect, it } from "vitest";
import {
  COURSE_CODES,
  ODS,
  OD_TOTAL_HOURS,
  PORTAL_BASELINE,
  defaultSettings,
  odStateAll,
  type CourseCode,
  type OdState,
  type Settings,
} from "./config";
import {
  computePlan,
  countedOdHours,
  diffBudgets,
  diffPlans,
  effectiveBaseline,
  finalPctIfSkipping,
  listSessions,
  type Marks,
  type Plan,
} from "./plan";

/** The two combinations the old global scenario switch offered. */
type Scenario = "odsGranted" | "odsPending";

/** All ODs on, except the listed ids. */
function allExcept(...ids: string[]): OdState {
  const state = odStateAll(true);
  for (const id of ids) state[id] = { on: false, inPortal: false };
  return state;
}

/** All ODs off, except the listed ids. */
function only(...ids: string[]): OdState {
  const state = odStateAll(false);
  for (const id of ids) state[id] = { on: true, inPortal: false };
  return state;
}

function plan(
  opts: { scenario?: Scenario; ods?: OdState; today?: string; marks?: Marks; extra?: Partial<Settings> } = {},
): Plan {
  const odState = opts.ods ?? odStateAll(opts.scenario !== "odsPending");
  return computePlan({
    settings: { ...defaultSettings(), odState, ...opts.extra },
    marks: opts.marks ?? {},
    today: opts.today ?? "2026-11-11",
  });
}

function budgetList(p: Plan): number[] {
  return COURSE_CODES.map((c) => p.byCourse[c].budgetHours);
}

function greenCounts(p: Plan): number[] {
  return COURSE_CODES.map((c) => p.byCourse[c].remaining.filter((s) => s.status === "skip-ok").length);
}

function greens(p: Plan, code: CourseCode): string[] {
  return p.byCourse[code].sessions.filter((s) => s.status === "skip-ok").map((s) => s.date);
}

function budgets(p: Plan): Record<string, number> {
  return Object.fromEntries(COURSE_CODES.map((c) => [c, p.byCourse[c].budgetHours]));
}

/** "13" -> 2026-11-13, "1 Dec" -> 2026-12-01 */
function d(...days: (number | "1 Dec")[]): string[] {
  return days.map((x) => (x === "1 Dec" ? "2026-12-01" : `2026-11-${x}`));
}

describe("sessions", () => {
  it("lists only weekdays inside the window, after the baseline", () => {
    const all = listSessions(defaultSettings());
    const dates = [...new Set(all.map((s) => s.date))];
    expect(dates).toEqual([
      ...d(11, 12, 13, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 30),
      "2026-12-01",
    ]);
    // 3 + 5 + 5 + 2 days. Mon 4h, Tue 7h, Wed 5h, Thu 6h, Fri 7h.
    const hours = all.reduce((sum, s) => sum + s.span, 0);
    expect(hours).toBe(5 + 6 + 7 + 29 + 29 + 4 + 7);
  });

  it("removes sessions on holidays", () => {
    const p = plan({ extra: { holidays: ["2026-11-30"] } });
    expect(p.byId["2026-11-30@1"]).toBeUndefined();
    expect(p.byCourse.MAT2303.remaining).toHaveLength(11);
  });

  it("ignores sessions on or before baselineAsOf", () => {
    const p = plan({ extra: { baselineAsOf: "2026-11-13" } });
    expect(p.byId["2026-11-13@1"]).toBeUndefined();
    expect(p.byCourse.CSE2251.remaining.map((s) => s.date)[0]).toBe("2026-11-17");
  });
});

describe("all ODs on (old odsGranted), today 2026-11-11, no marks", () => {
  const p = plan();

  const expected: [CourseCode, number, string[]][] = [
    ["CSE2251", 8, d(13, 17, 19, 20, 24, 26, 27, "1 Dec")],
    ["CSE2252", 5, d(24, "1 Dec")],
    ["APT4002", 5, d(18, 25)],
    ["CSE2259", 2, d(27)],
    ["CSE2257", 8, d(13, 17, 18, 20, 24, 25, 27, "1 Dec")],
    ["CSE2253", 5, d(20, 24, 26, 27, "1 Dec")],
    ["MAT2303", 5, d(23, 25, 26, 27, 30)],
    ["CSE2255", 5, d(23, 24, 25, 30, "1 Dec")],
    ["CSE2258", 6, d(19, 20, 24, 26, 27, "1 Dec")],
    ["CSE2256", 6, d(12, 19, 26)],
    ["CSE2254", 5, d(23, 30)],
  ];

  it.each(expected)("%s: budget %i and green dates", (code, budget, dates) => {
    expect(p.byCourse[code].budgetHours).toBe(budget);
    expect(greens(p, code)).toEqual(dates);
  });

  it("green hours per week", () => {
    expect(p.greenHoursByWeek).toEqual([4, 13, 29, 11]);
    expect(p.totalGreenHours).toBe(57);
  });

  it("every course still finishes at or above target if all greens are skipped", () => {
    for (const c of p.courses) {
      expect(c.finalPctIfSkipGreens).toBeGreaterThanOrEqual(75);
      expect(c.finalPctIfAttendAll).toBeGreaterThanOrEqual(c.finalPctIfSkipGreens);
    }
  });

  it("reports current attendance from the baseline", () => {
    expect(p.byCourse.CSE2251.present).toBe(33);
    expect(p.byCourse.CSE2251.held).toBe(34);
    expect(p.byCourse.CSE2251.currentPct).toBeCloseTo((33 / 34) * 100, 6);
    expect(p.byCourse.CSE2251.skipHoursUsed).toBe(0);
  });
});

describe("all ODs off (old odsPending), today 2026-11-11, no marks", () => {
  const p = plan({ scenario: "odsPending" });

  it("budgets", () => {
    expect(COURSE_CODES.map((c) => p.byCourse[c].budgetHours)).toEqual([4, 3, 0, 0, 4, 1, 0, 3, 2, 1, 5]);
  });

  it("green hours per week", () => {
    expect(p.greenHoursByWeek).toEqual([0, 0, 10, 10]);
  });

  it("green dates", () => {
    expect(greens(p, "CSE2251")).toEqual(d(24, 26, 27, "1 Dec"));
    expect(greens(p, "CSE2253")).toEqual(d("1 Dec"));
    for (const code of ["MAT2303", "APT4002", "CSE2259", "CSE2256"] as const) {
      expect(greens(p, code)).toEqual([]);
    }
  });
});

describe("events (all ODs on, today 2026-11-11)", () => {
  const before = plan();

  it("attending a green session moves its skip to the nearest earlier red one", () => {
    const after = plan({ marks: { "2026-12-01@1": "attended" } });
    const c = after.byCourse.CSE2257;
    expect(c.budgetHours).toBe(8);
    expect(c.remaining).toHaveLength(8);
    expect(c.remaining.every((s) => s.status === "skip-ok")).toBe(true);
    expect(after.byId["2026-11-11@3"].status).toBe("skip-ok");
    expect(after.byId["2026-12-01@1"].status).toBe("attended");

    const diff = diffPlans(before, after);
    expect(diff.moves).toHaveLength(1);
    expect(diff.moves[0].message).toBe("Comp Org & Arch: skip moved from Tue 1 Dec to Wed 11 Nov");
    expect(diff.lost).toEqual([]);
    expect(diff.gained).toEqual([]);
    expect(diff.changedIds.sort()).toEqual(["2026-11-11@3", "2026-12-01@1"]);
  });

  it("attend MAT2303 Mon 30 Nov", () => {
    const after = plan({ marks: { "2026-11-30@1": "attended" } });
    expect(greens(after, "MAT2303")).toEqual(d(20, 23, 25, 26, 27));
    expect(diffPlans(before, after).moves.map((m) => m.message)).toEqual([
      "Linear Algebra: skip moved from Mon 30 Nov to Fri 20 Nov",
    ]);
  });

  it("skip MAT2303 Fri 27 Nov", () => {
    const after = plan({ marks: { "2026-11-27@8": "skipped" } });
    const c = after.byCourse.MAT2303;
    expect(c.budgetHours).toBe(4);
    expect(c.skipHoursUsed).toBe(1);
    expect(greens(after, "MAT2303")).toEqual(d(23, 25, 26, 30));
    const diff = diffPlans(before, after);
    expect(diff.moves).toEqual([]);
    expect(diff.lost).toEqual([]);
    expect(diff.changedIds).toEqual(["2026-11-27@8"]);
  });

  it("attending a red session changes no greens", () => {
    const after = plan({ marks: { "2026-11-11@6": "attended" } }); // MAT2303 Wed 11 Nov
    for (const code of COURSE_CODES) expect(greens(after, code)).toEqual(greens(before, code));
    const diff = diffPlans(before, after);
    expect(diff.moves).toEqual([]);
    expect(diff.lost).toEqual([]);
    expect(diff.gained).toEqual([]);
    expect(diff.changedIds).toEqual(["2026-11-11@6"]);
  });

  it("skipping a red session costs one green of that course", () => {
    const after = plan({ marks: { "2026-11-11@6": "skipped" } }); // MAT2303 Wed 11 Nov
    expect(after.byCourse.MAT2303.budgetHours).toBe(4);
    expect(greens(after, "MAT2303")).toEqual(d(25, 26, 27, 30));
    const diff = diffPlans(before, after);
    expect(diff.lost.map((l) => l.message)).toEqual(["Linear Algebra: Mon 23 Nov is no longer skippable"]);
    expect(after.byCourse.MAT2303.finalPctIfSkipGreens).toBeGreaterThanOrEqual(75);
  });

  it("skipping any session reduces that course's budget by its span", () => {
    const lab = plan({ marks: { "2026-11-26@7": "skipped" } }); // CSE2256, 2 hours
    expect(lab.byCourse.CSE2256.budgetHours).toBe(4);
    expect(lab.byCourse.CSE2256.skipHoursUsed).toBe(2);
    expect(greens(lab, "CSE2256")).toEqual(d(12, 19));
  });

  it("undoing a mark is the reverse diff", () => {
    const marked = plan({ marks: { "2026-12-01@1": "attended" } });
    const diff = diffPlans(marked, before);
    expect(diff.moves.map((m) => m.message)).toEqual([
      "Comp Org & Arch: skip moved from Wed 11 Nov to Tue 1 Dec",
    ]);
  });
});

describe("past days", () => {
  it("today 2026-11-18, no marks: unmarked past sessions count as attended", () => {
    const p = plan({ today: "2026-11-18" });
    expect(budgets(p)).toEqual({
      CSE2251: 6,
      CSE2252: 4,
      APT4002: 4,
      CSE2259: 2,
      CSE2257: 6,
      CSE2253: 5,
      MAT2303: 5,
      CSE2255: 5,
      CSE2258: 6,
      CSE2256: 4,
      CSE2254: 4,
    });
    expect(p.byId["2026-11-17@6"].status).toBe("assumed");
    expect(p.byId["2026-11-18@1"].status).not.toBe("assumed");
    // The budget is capped by the hours that are left.
    for (const c of p.courses) expect(c.budgetHours).toBeLessThanOrEqual(c.remainingHours);
  });

  it("a past session marked skipped is not assumed attended", () => {
    const p = plan({ today: "2026-11-18", marks: { "2026-11-12@1": "skipped" } });
    expect(p.byId["2026-11-12@1"].status).toBe("skipped");
    expect(p.byCourse.MAT2303.skipHoursUsed).toBe(1);
    expect(p.byCourse.MAT2303.budgetHours).toBe(4);
  });

  it("after the window everything is decided", () => {
    const p = plan({ today: "2026-12-05" });
    for (const c of p.courses) {
      expect(c.remaining).toEqual([]);
      expect(c.budgetHours).toBe(0);
    }
    expect(p.totalGreenHours).toBe(0);
  });
});

describe("settings", () => {
  it("cushion 0 gives one more hour, target and cushion are respected", () => {
    const p = plan({ extra: { cushionHours: 0 } });
    expect(p.byCourse.MAT2303.budgetHours).toBe(6);
    expect(p.byCourse.CSE2251.budgetHours).toBe(9);
    for (const c of p.courses) expect(c.finalPctIfSkipGreens).toBeGreaterThanOrEqual(75);
  });

  it("a higher target never yields a negative budget", () => {
    const p = plan({ scenario: "odsPending", extra: { targetPct: 95 } });
    for (const c of p.courses) {
      expect(c.budgetHours).toBeGreaterThanOrEqual(0);
    }
  });

  it("finalPctIfSkipping projects one extra skipped session", () => {
    const p = plan({ scenario: "odsPending" });
    const c = p.byCourse.MAT2303; // [26, 38], 12 hours left, no greens
    expect(finalPctIfSkipping(c, 0)).toBeCloseTo((38 / 50) * 100, 6);
    expect(finalPctIfSkipping(c, 1)).toBeCloseTo((37 / 50) * 100, 6);
    expect(finalPctIfSkipping(c, 1)).toBeLessThan(75);
  });
});

describe("on-duty leaves", () => {
  it("has 10 ODs totalling 39 hours", () => {
    expect(ODS).toHaveLength(10);
    expect(OD_TOTAL_HOURS).toBe(39);
    expect(new Set(ODS.map((od) => od.id)).size).toBe(10);
    expect(ODS.map((od) => od.date)).toEqual([...ODS.map((od) => od.date)].sort());
  });

  it("portal baseline plus every OD gives the old granted numbers", () => {
    const eff = effectiveBaseline({ baseline: PORTAL_BASELINE, odState: odStateAll(true) });
    expect(COURSE_CODES.map((c) => eff[c][0])).toEqual([33, 21, 20, 18, 34, 29, 32, 26, 31, 24, 20]);
    // Held never changes.
    expect(COURSE_CODES.map((c) => eff[c][1])).toEqual(COURSE_CODES.map((c) => PORTAL_BASELINE[c][1]));
    // And with none it is the portal as is.
    expect(effectiveBaseline({ baseline: PORTAL_BASELINE, odState: odStateAll(false) })).toEqual(PORTAL_BASELINE);
  });

  it("defaults count every OD", () => {
    const hours = countedOdHours(defaultSettings());
    expect(COURSE_CODES.map((c) => hours[c])).toEqual([4, 2, 6, 2, 4, 4, 6, 2, 4, 5, 0]);
    expect(plan().byCourse.MAT2303.odHours).toBe(6);
    expect(plan({ scenario: "odsPending" }).byCourse.MAT2303.odHours).toBe(0);
  });

  it("all ODs on", () => {
    expect(budgetList(plan({ ods: odStateAll(true) }))).toEqual([8, 5, 5, 2, 8, 5, 5, 5, 6, 6, 5]);
  });

  it("all ODs off", () => {
    expect(budgetList(plan({ ods: odStateAll(false) }))).toEqual([4, 3, 0, 0, 4, 1, 0, 3, 2, 1, 5]);
  });

  it("all on except od-2026-10-30", () => {
    const p = plan({ ods: allExcept("od-2026-10-30") });
    expect(budgetList(p)).toEqual([7, 5, 5, 0, 7, 4, 4, 5, 5, 6, 5]);
    expect(greenCounts(p)).toEqual([7, 2, 2, 0, 7, 4, 4, 5, 5, 3, 2]);
  });

  it("only 08-12, 09-15, 09-16, 09-17, 09-24 on", () => {
    const p = plan({
      ods: only("od-2026-08-12", "od-2026-09-15", "od-2026-09-16", "od-2026-09-17", "od-2026-09-24"),
    });
    expect(budgetList(p)).toEqual([6, 3, 3, 0, 7, 3, 3, 5, 4, 4, 5]);
    expect(greenCounts(p)).toEqual([6, 1, 1, 0, 7, 3, 3, 5, 4, 2, 2]);
  });

  it("all on except od-2026-09-04", () => {
    const p = plan({ ods: allExcept("od-2026-09-04") });
    expect(budgetList(p)).toEqual([8, 5, 3, 2, 8, 5, 5, 5, 6, 6, 5]);
    expect(greenCounts(p)).toEqual([8, 2, 1, 1, 8, 5, 5, 5, 6, 3, 2]);
  });

  it("inPortal adds nothing, same as switching the OD off", () => {
    const off = plan({ ods: allExcept("od-2026-10-30") });
    for (const on of [true, false]) {
      const ods = odStateAll(true);
      ods["od-2026-10-30"] = { on, inPortal: true };
      const inPortal = plan({ ods });
      expect(budgetList(inPortal)).toEqual(budgetList(off));
      expect(greenCounts(inPortal)).toEqual(greenCounts(off));
      expect(inPortal.byCourse.CSE2259.odHours).toBe(0);
    }
  });

  it("greens are always the last g remaining sessions, whatever the toggles", () => {
    const combos: OdState[] = [
      odStateAll(true),
      odStateAll(false),
      ...ODS.map((od) => allExcept(od.id)),
      ...ODS.map((od) => only(od.id)),
      only("od-2026-08-12", "od-2026-09-15", "od-2026-09-16", "od-2026-09-17", "od-2026-09-24"),
    ];
    for (const ods of combos) {
      for (const marks of [{}, { "2026-11-27@8": "skipped", "2026-12-01@1": "attended" }] as Marks[]) {
        const p = plan({ ods, marks });
        for (const c of p.courses) {
          const g = Math.min(c.remaining.length, Math.floor(c.budgetHours / c.span));
          const expected = c.remaining.map((_, i) => (i >= c.remaining.length - g ? "skip-ok" : "attend"));
          expect(c.remaining.map((s) => s.status)).toEqual(expected);
        }
      }
    }
  });

  it("diffBudgets lists the courses whose budget changed", () => {
    const before = plan();
    const after = plan({ ods: allExcept("od-2026-10-30") });
    expect(diffBudgets(before, after)).toEqual([
      { course: "CSE2251", courseName: "Data Comm & Networks", before: 8, after: 7 },
      { course: "CSE2259", courseName: "Web Tech Lab", before: 2, after: 0 },
      { course: "CSE2257", courseName: "Comp Org & Arch", before: 8, after: 7 },
      { course: "CSE2253", courseName: "Data Structures", before: 5, after: 4 },
      { course: "MAT2303", courseName: "Linear Algebra", before: 5, after: 4 },
      { course: "CSE2258", courseName: "Web Tech", before: 6, after: 5 },
    ]);
    expect(diffBudgets(before, before)).toEqual([]);
  });
});
