import { describe, expect, it } from "vitest";
import { defaultSettings } from "./config";
import { computePlan, type Marks } from "./plan";
import { WHAT_IF_NOTE, weekDays } from "./view";
import { summarizeWhatIf, withOffDays } from "./whatIf";

const today = "2026-11-11";
const settings = defaultSettings();
const plan = (off: string[] = [], marks: Marks = {}) =>
  computePlan({ settings: withOffDays(settings, off), marks, today });

describe("what-if days off", () => {
  it("treats a day off exactly like a holiday, without touching the real settings", () => {
    const off = plan(["2026-11-23"]);
    const holiday = computePlan({ settings: { ...settings, holidays: ["2026-11-23"] }, marks: {}, today });
    expect(off.byCourse).toEqual(holiday.byCourse);
    expect(Object.values(off.byId).some((s) => s.date === "2026-11-23")).toBe(false);
    expect(settings.holidays).toEqual([]);
    expect(withOffDays(settings, [])).toBe(settings);
  });

  it("turning the day back on gives the real plan again", () => {
    expect(plan([]).byCourse).toEqual(computePlan({ settings, marks: {}, today }).byCourse);
  });

  it("summarizes only the courses that lose classes", () => {
    // Mon 23 Nov: Linear Algebra p1, OOP Java p2, DS Lab p3-4.
    const summary = summarizeWhatIf(plan(), plan(["2026-11-23"]));
    expect(summary.courses.map((c) => [c.code, c.hoursRemoved])).toEqual([
      ["MAT2303", 1],
      ["CSE2255", 1],
      ["CSE2254", 2],
    ]);
    for (const c of summary.courses) {
      expect(c.finalIfAttendAll[0]).toBe(plan().byCourse[c.code].finalPctIfAttendAll);
      expect(c.finalIfAttendAll[1]).toBe(plan(["2026-11-23"]).byCourse[c.code].finalPctIfAttendAll);
    }
    expect(summary.totalGreenHours).toEqual([plan().totalGreenHours, plan(["2026-11-23"]).totalGreenHours]);
  });

  it("several days off add up", () => {
    const summary = summarizeWhatIf(plan(), plan(["2026-11-23", "2026-11-30"]));
    expect(summary.courses.find((c) => c.code === "CSE2254")?.hoursRemoved).toBe(4);
  });

  it("a marked class on a day off drops out of the preview but the mark is kept", () => {
    const marks: Marks = { "2026-11-23@1": "skipped" };
    const off = plan(["2026-11-23"], marks);
    expect(off.byCourse.MAT2303.skipHoursUsed).toBe(0);
    expect(plan([], marks).byCourse.MAT2303.skipHoursUsed).toBe(1);
  });

  it("the week view mutes a day off and lets it be switched back on; real holidays cannot be toggled", () => {
    const off = ["2026-11-25"];
    const p = plan(off);
    const week = p.weeks[2]; // 23-27 Nov
    const days = weekDays(week, { ...settings, holidays: ["2026-11-27"] }, p, off);
    const wed = days.find((d) => d.date === "2026-11-25")!;
    expect(wed).toMatchObject({ off: true, canToggle: true, mutedNote: WHAT_IF_NOTE, sessions: [] });
    expect(days.find((d) => d.date === "2026-11-24")).toMatchObject({ off: false, canToggle: true });
    expect(days.find((d) => d.date === "2026-11-27")).toMatchObject({ canToggle: false, mutedNote: "Holiday" });
  });

  it("days that already have no classes cannot be toggled", () => {
    const p = plan();
    const w1 = weekDays(p.weeks[0], settings, p);
    expect(w1.filter((d) => d.canToggle).map((d) => d.date)).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);
    const w4 = weekDays(p.weeks[3], settings, p);
    expect(w4.filter((d) => d.canToggle).map((d) => d.date)).toEqual(["2026-11-30", "2026-12-01", "2026-12-05"]);
  });
});
