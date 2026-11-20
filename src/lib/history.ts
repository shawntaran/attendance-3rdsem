// The past record, class by class: every hour in the portal's Daily Attendance
// report (historyData.ts), placed on the course that ran in that hour.
//
// Which course ran when:
//   - Until 16 Sep 2026: the old timetable (OLD_TIMETABLE below).
//   - From 17 Sep 2026: the current timetable (TIMETABLE in config.ts).
//   - Days that ran another day's timetable are listed in HISTORY_DAY_TIMETABLES.
//     Wed 9 Sep ran Friday's (old) timetable; the portal's week-wise report for
//     7-13 Sep places that day's hours exactly so, and Fri 11 Sep as a normal Friday.
// Every class day in the report fits its timetable hour for hour (checked in
// history.test.ts); the only gap is hour 7 on Fri 4 Sep, which was not held.

import { COURSE_CODES, TIMETABLE, type CourseCode, type Slot } from "./config";
import { addDays, weekdayIndex } from "./dates";
import { HISTORY_DAYS, HISTORY_HOLIDAYS } from "./historyData";

export { HISTORY_FROM, HISTORY_TO, HISTORY_HOLIDAYS } from "./historyData";

/** The timetable in force until 16 Sep 2026 (weekday 1 = Monday). */
export const OLD_TIMETABLE: Record<number, Slot[]> = {
  1: [
    { startPeriod: 1, span: 1, course: "CSE2255" },
    { startPeriod: 2, span: 1, course: "MAT2303" },
    { startPeriod: 3, span: 2, course: "CSE2254" },
  ],
  2: [
    { startPeriod: 1, span: 1, course: "CSE2257" },
    { startPeriod: 2, span: 1, course: "CSE2255" },
    { startPeriod: 3, span: 2, course: "CSE2252" },
    { startPeriod: 6, span: 1, course: "CSE2251" },
    { startPeriod: 7, span: 1, course: "CSE2258" },
    { startPeriod: 8, span: 1, course: "CSE2253" },
  ],
  3: [
    { startPeriod: 1, span: 2, course: "APT4002" },
    { startPeriod: 3, span: 1, course: "CSE2257" },
    { startPeriod: 4, span: 1, course: "CSE2255" },
    { startPeriod: 6, span: 1, course: "MAT2303" },
  ],
  4: [
    { startPeriod: 1, span: 1, course: "MAT2303" },
    { startPeriod: 2, span: 1, course: "CSE2253" },
    { startPeriod: 3, span: 1, course: "CSE2251" },
    { startPeriod: 4, span: 1, course: "CSE2258" },
    { startPeriod: 6, span: 1, course: "CSE2257" },
    { startPeriod: 7, span: 2, course: "CSE2256" },
  ],
  5: [
    { startPeriod: 1, span: 1, course: "CSE2258" },
    { startPeriod: 2, span: 1, course: "CSE2251" },
    { startPeriod: 3, span: 2, course: "CSE2259" },
    { startPeriod: 6, span: 1, course: "CSE2253" },
    { startPeriod: 7, span: 1, course: "MAT2303" },
  ],
};

export const TIMETABLE_CHANGED_ON = "2026-09-17";

/** Days in the record that ran another weekday's timetable. */
export const HISTORY_DAY_TIMETABLES: Record<string, { followsWeekday: number; note: string }> = {
  "2026-09-09": { followsWeekday: 5, note: "Ran Friday's timetable" },
};

/**
 * Suspended hours are counted as held but not attended (like an absence).
 * The portal leaves them out; set this to false to match the portal.
 */
export const COUNT_SUSPENDED_AS_ABSENT = true;

export type HourStatus = "present" | "absent" | "dl" | "suspended";

const STATUS_OF: Record<string, HourStatus> = { P: "present", A: "absent", D: "dl", S: "suspended" };

export interface HistoryClass {
  date: string;
  course: CourseCode;
  startPeriod: number;
  span: number;
  /** One status per hour of the class (two for a lab). */
  hours: HourStatus[];
}

export interface HistoryDay {
  date: string;
  /** Holiday name, or null on a class day. */
  holiday: string | null;
  /** Set when the day ran another day's timetable. */
  note: string | null;
  /** Which timetable the day ran: "old" before 17 Sep, "new" after. */
  timetable: "old" | "new";
  classes: HistoryClass[];
}

/** The timetable slots a record day ran. */
export function slotsForHistoryDay(date: string): { slots: Slot[]; timetable: "old" | "new"; note: string | null } {
  const timetable = date < TIMETABLE_CHANGED_ON ? "old" : "new";
  const table = timetable === "old" ? OLD_TIMETABLE : TIMETABLE;
  const override = HISTORY_DAY_TIMETABLES[date];
  const weekday = override ? override.followsWeekday : weekdayIndex(date);
  return { slots: table[weekday] ?? [], timetable, note: override?.note ?? null };
}

function buildDays(): HistoryDay[] {
  const out: HistoryDay[] = [];
  for (const [date, name] of HISTORY_HOLIDAYS) {
    out.push({ date, holiday: name, note: null, timetable: date < TIMETABLE_CHANGED_ON ? "old" : "new", classes: [] });
  }
  for (const [date, codes] of HISTORY_DAYS) {
    const { slots, timetable, note } = slotsForHistoryDay(date);
    const classes: HistoryClass[] = [];
    for (const slot of slots) {
      const hours: HourStatus[] = [];
      for (let k = 0; k < slot.span; k++) {
        const code = codes[slot.startPeriod + k - 1];
        const status = STATUS_OF[code];
        if (status) hours.push(status);
      }
      if (hours.length > 0) {
        classes.push({ date, course: slot.course, startPeriod: slot.startPeriod, span: slot.span, hours });
      }
    }
    out.push({ date, holiday: null, note, timetable, classes });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Every day in the record, holidays included, in date order. */
export const HISTORY: HistoryDay[] = buildDays();

export function historyDay(date: string): HistoryDay | undefined {
  return HISTORY.find((d) => d.date === date);
}

export interface HistoryWeek {
  monday: string;
  /** Monday to Friday; a weekday with no entry in the record is null. */
  days: { date: string; day: HistoryDay | null }[];
  /** True when the week's classes ran the old timetable (before 17 Sep). */
  oldTimetable: boolean;
}

/** The record as Monday-based weeks, oldest first. */
export function historyWeeks(): HistoryWeek[] {
  const byDate = new Map(HISTORY.map((d) => [d.date, d]));
  const weeks: HistoryWeek[] = [];
  let monday = addDays(HISTORY[0].date, -((weekdayIndex(HISTORY[0].date) + 6) % 7));
  const last = HISTORY[HISTORY.length - 1].date;
  while (monday <= last) {
    const days = [0, 1, 2, 3, 4].map((i) => {
      const date = addDays(monday, i);
      return { date, day: byDate.get(date) ?? null };
    });
    if (days.some((d) => d.day)) {
      weeks.push({ monday, days, oldTimetable: addDays(monday, 4) < TIMETABLE_CHANGED_ON });
    }
    monday = addDays(monday, 7);
  }
  return weeks;
}

export interface HistoryTotals {
  present: number;
  held: number;
  dl: number;
  absent: number;
  suspended: number;
}

/** Hours per course on or before `until` (inclusive). */
export function historyTotals(until: string, countSuspended = COUNT_SUSPENDED_AS_ABSENT): Record<CourseCode, HistoryTotals> {
  const out = Object.fromEntries(
    COURSE_CODES.map((c) => [c, { present: 0, held: 0, dl: 0, absent: 0, suspended: 0 }]),
  ) as Record<CourseCode, HistoryTotals>;
  for (const day of HISTORY) {
    if (day.date > until) break;
    for (const cls of day.classes) {
      const t = out[cls.course];
      for (const s of cls.hours) {
        if (s === "present") {
          t.present++;
          t.held++;
        } else if (s === "dl") {
          t.present++;
          t.held++;
          t.dl++;
        } else if (s === "absent") {
          t.held++;
          t.absent++;
        } else {
          t.suspended++;
          if (countSuspended) t.held++;
        }
      }
    }
  }
  return out;
}

/** A class in the record as a plan mark: attended if every hour counts present, skipped if none does. */
export function historyMark(cls: HistoryClass, countSuspended = COUNT_SUSPENDED_AS_ABSENT): "attended" | "skipped" | null {
  const counted = cls.hours.filter((s) => countSuspended || s !== "suspended");
  if (counted.length === 0) return null;
  const present = counted.filter((s) => s === "present" || s === "dl").length;
  if (present === counted.length) return "attended";
  if (present === 0) return "skipped";
  return null; // a lab with one hour each way: left for you to mark
}
