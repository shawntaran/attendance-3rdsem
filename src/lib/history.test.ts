import { describe, expect, it } from "vitest";
import { BASELINE_AS_OF, COURSE_CODES, TIMETABLE, type Slot } from "./config";
import { weekdayIndex } from "./dates";
import { HISTORY, historyTotals, OLD_TIMETABLE, slotsForHistoryDay, TIMETABLE_CHANGED_ON } from "./history";
import { HISTORY_DAYS } from "./historyData";

function hoursOf(slots: Slot[]): number[] {
  return slots.flatMap((s) => Array.from({ length: s.span }, (_, k) => s.startPeriod + k)).sort((a, b) => a - b);
}

describe("past record", () => {
  it("every class day fits its timetable hour for hour (only Fri 4 Sep hour 7 was not held)", () => {
    const mismatches: string[] = [];
    for (const [date, codes] of HISTORY_DAYS) {
      const recorded = [...codes].map((c, i) => (c === "." ? 0 : i + 1)).filter(Boolean);
      const expected = hoursOf(slotsForHistoryDay(date).slots);
      if (JSON.stringify(recorded) !== JSON.stringify(expected)) mismatches.push(`${date} ${recorded} vs ${expected}`);
    }
    expect(mismatches).toEqual(["2026-09-04 1,2,3,4,6 vs 1,2,3,4,6,7"]);
  });

  it("the old timetable differs from the current one exactly as the two timetables show", () => {
    // Monday hours 1-2 swapped; Thursday lost hour 6 (Comp Org); Friday reshuffled and gained hour 8.
    expect(OLD_TIMETABLE[1].map((s) => s.course)).toEqual(["CSE2255", "MAT2303", "CSE2254"]);
    expect(TIMETABLE[1].map((s) => s.course)).toEqual(["MAT2303", "CSE2255", "CSE2254"]);
    expect(OLD_TIMETABLE[2]).toEqual(TIMETABLE[2]);
    expect(OLD_TIMETABLE[3]).toEqual(TIMETABLE[3]);
    expect(hoursOf(OLD_TIMETABLE[4])).toEqual([1, 2, 3, 4, 6, 7, 8]);
    expect(hoursOf(TIMETABLE[4])).toEqual([1, 2, 3, 4, 7, 8]);
    expect(hoursOf(OLD_TIMETABLE[5])).toEqual([1, 2, 3, 4, 6, 7]);
    expect(hoursOf(TIMETABLE[5])).toEqual([1, 2, 3, 4, 6, 7, 8]);
    expect(TIMETABLE_CHANGED_ON).toBe("2026-09-17");
  });

  it("places the swap week as the portal's week-wise report does", () => {
    const day = (d: string) => HISTORY.find((x) => x.date === d)!;
    const show = (d: string) => day(d).classes.map((c) => `${c.course}:${c.hours.join("+")}`);
    expect(show("2026-09-09")).toEqual([
      "CSE2258:suspended",
      "CSE2251:suspended",
      "CSE2259:present+present",
      "CSE2253:present",
      "MAT2303:dl",
    ]);
    expect(day("2026-09-09").note).toBe("Ran Friday's timetable");
    expect(show("2026-09-11")).toEqual([
      "CSE2258:suspended",
      "CSE2251:suspended",
      "CSE2259:present+present",
      "CSE2253:absent",
      "MAT2303:absent",
    ]);
    expect(show("2026-09-10")).toEqual([
      "MAT2303:suspended",
      "CSE2253:suspended",
      "CSE2251:present",
      "CSE2258:present",
      "CSE2257:dl",
      "CSE2256:dl+dl",
    ]);
  });

  it("covers 5 Aug to 19 Nov with holidays, and no classes on weekends", () => {
    expect(HISTORY[0].date).toBe("2026-08-05");
    expect(HISTORY.at(-1)!.date).toBe("2026-11-19");
    expect(HISTORY.filter((d) => d.holiday).length).toBe(12);
    for (const d of HISTORY) if (d.classes.length > 0) expect(weekdayIndex(d.date)).toBeGreaterThanOrEqual(1);
  });

  it("totals to 10 Nov: the portal's held total plus 21 suspended hours", () => {
    const portalRule = historyTotals(BASELINE_AS_OF, false);
    const counted = historyTotals(BASELINE_AS_OF, true);
    const sum = (t: typeof counted, k: "present" | "held" | "suspended") =>
      COURSE_CODES.reduce((s, c) => s + t[c][k], 0);
    expect(sum(portalRule, "held")).toBe(313);
    expect(sum(counted, "suspended")).toBe(21);
    expect(sum(counted, "held")).toBe(334);
    expect(sum(counted, "present")).toBe(290);
  });
});
