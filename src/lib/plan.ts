// Rules engine. Pure functions, no React, no browser APIs.
//
// For each course independently:
//   1. Sessions = timetable sessions in the window, minus holidays, minus dates
//      on or before baselineAsOf (those are already inside the baseline).
//   2. Walk them from the baseline (P present, H held). P is the portal figure
//      plus the hours of every OD that is switched on and not already in the
//      portal; H is the portal figure as is. A marked session, or an
//      unmarked one in the past (assumed attended), updates P and H. The rest
//      are the remaining list R.
//   3. n = hours in R. budgetHours = clamp(floor(P - t*H + (1-t)*n) - cushion, 0, n).
//      (Final present = P + n - x, final held = H + n, need >= t.)
//   4. g = min(|R|, floor(budgetHours / span)). The LAST g sessions of R are
//      "skip-ok", every other one is "attend" (latest-first allocation).

import {
  COURSES,
  COURSE_NAME,
  ODS,
  TIMETABLE,
  WEEKS,
  WINDOW_END,
  WINDOW_START,
  odAddsHours,
  type Baseline,
  type CourseCode,
  type Settings,
} from "./config";
import { dateRange, formatDate, weekdayIndex } from "./dates";

export type Mark = "attended" | "skipped";
export type Marks = Record<string, Mark>;

export type SessionStatus =
  | "skip-ok" // undecided, safe to skip
  | "attend" // undecided, must attend
  | "attended" // marked attended
  | "assumed" // past and unmarked, counted as attended
  | "skipped"; // marked skipped

export interface PlanSession {
  /** `${date}@${startPeriod}` */
  id: string;
  date: string;
  startPeriod: number;
  /** Periods covered, which is also the attendance hours. */
  span: number;
  course: CourseCode;
  status: SessionStatus;
}

export interface CoursePlan {
  code: CourseCode;
  name: string;
  /** Hours per session (1 for theory, 2 for labs and aptitude). */
  span: number;
  /** Present and held hours so far: baseline plus every decided session. */
  present: number;
  held: number;
  currentPct: number;
  /** OD hours counted as present on top of the portal baseline. */
  odHours: number;
  /** Every session of the course after the baseline, in time order. */
  sessions: PlanSession[];
  /** Undecided sessions, in time order. */
  remaining: PlanSession[];
  /** Hours in `remaining`. */
  remainingHours: number;
  /** Hours that may still be skipped (after the cushion). */
  budgetHours: number;
  /** Hours actually placed on green sessions (whole sessions only). */
  skippableHours: number;
  /** Hours already marked skipped. */
  skipHoursUsed: number;
  finalPctIfAttendAll: number;
  finalPctIfSkipGreens: number;
}

export interface Plan {
  today: string;
  targetPct: number;
  courses: CoursePlan[];
  byCourse: Record<CourseCode, CoursePlan>;
  byId: Record<string, PlanSession>;
  /** Green (skip-ok) hours per week, in WEEKS order. */
  greenHoursByWeek: number[];
  totalGreenHours: number;
}

export interface ComputePlanInput {
  settings: Settings;
  marks: Marks;
  /** YYYY-MM-DD */
  today: string;
}

export function sessionId(date: string, startPeriod: number): string {
  return `${date}@${startPeriod}`;
}

/** Index into WEEKS for a date, or -1 if it is outside every week. */
export function weekIndexOf(date: string): number {
  return WEEKS.findIndex((w) => date >= w.from && date <= w.to);
}

function pct(present: number, held: number): number {
  return held > 0 ? (present / held) * 100 : 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface RawSession {
  id: string;
  date: string;
  startPeriod: number;
  span: number;
  course: CourseCode;
}

/** Step 1 for all courses at once: every plannable session, in time order. */
export function listSessions(settings: Pick<Settings, "holidays" | "baselineAsOf">): RawSession[] {
  const holidays = new Set(settings.holidays);
  const out: RawSession[] = [];
  for (const date of dateRange(WINDOW_START, WINDOW_END)) {
    if (date <= settings.baselineAsOf) continue;
    if (holidays.has(date)) continue;
    const slots = TIMETABLE[weekdayIndex(date)];
    if (!slots) continue; // weekend
    for (const slot of [...slots].sort((a, b) => a.startPeriod - b.startPeriod)) {
      out.push({
        id: sessionId(date, slot.startPeriod),
        date,
        startPeriod: slot.startPeriod,
        span: slot.span,
        course: slot.course,
      });
    }
  }
  return out;
}

/** Hours per course added by the ODs that are on and not already in the portal. */
export function countedOdHours(settings: Pick<Settings, "odState">): Record<CourseCode, number> {
  const out = Object.fromEntries(COURSES.map((c) => [c.code, 0])) as Record<CourseCode, number>;
  for (const od of ODS) {
    if (!odAddsHours(settings.odState[od.id])) continue;
    for (const [code, hours] of Object.entries(od.hours)) {
      out[code as CourseCode] += hours ?? 0;
    }
  }
  return out;
}

/**
 * The baseline the plan starts from: portal present plus counted OD hours.
 * Held is unchanged, because those hours are already held (as absences).
 */
export function effectiveBaseline(settings: Pick<Settings, "baseline" | "odState">): Baseline {
  const od = countedOdHours(settings);
  return Object.fromEntries(
    COURSES.map((c) => {
      const [present, held] = settings.baseline[c.code];
      return [c.code, [present + od[c.code], held]];
    }),
  ) as Baseline;
}

export function computePlan({ settings, marks, today }: ComputePlanInput): Plan {
  const t = settings.targetPct / 100;
  const baseline = effectiveBaseline(settings);
  const odHours = countedOdHours(settings);
  const all = listSessions(settings);

  const courses: CoursePlan[] = [];
  const byId: Record<string, PlanSession> = {};

  for (const course of COURSES) {
    const raw = all.filter((s) => s.course === course.code);
    let [present, held] = baseline[course.code];
    let skipHoursUsed = 0;

    const sessions: PlanSession[] = [];
    const remaining: PlanSession[] = [];

    for (const s of raw) {
      const mark = marks[s.id];
      let status: SessionStatus;
      if (mark === "attended") status = "attended";
      else if (mark === "skipped") status = "skipped";
      else if (s.date < today) status = "assumed";
      else status = "attend"; // provisional, greens are assigned below

      if (status === "attended" || status === "assumed") {
        present += s.span;
        held += s.span;
      } else if (status === "skipped") {
        held += s.span;
        skipHoursUsed += s.span;
      }

      const session: PlanSession = { ...s, status };
      sessions.push(session);
      if (status === "attend") remaining.push(session);
    }

    const n = remaining.reduce((sum, s) => sum + s.span, 0);
    const span = raw[0]?.span ?? 1;

    const budgetHours = clamp(
      Math.floor(present - t * held + (1 - t) * n + 1e-9) - settings.cushionHours,
      0,
      n,
    );

    // Latest-first: the last g undecided sessions are the ones to skip.
    const g = Math.min(remaining.length, Math.floor(budgetHours / span));
    let skippableHours = 0;
    for (let i = remaining.length - g; i < remaining.length; i++) {
      remaining[i].status = "skip-ok";
      skippableHours += remaining[i].span;
    }

    for (const s of sessions) byId[s.id] = s;

    courses.push({
      code: course.code,
      name: course.name,
      span,
      present,
      held,
      currentPct: pct(present, held),
      odHours: odHours[course.code],
      sessions,
      remaining,
      remainingHours: n,
      budgetHours,
      skippableHours,
      skipHoursUsed,
      finalPctIfAttendAll: pct(present + n, held + n),
      finalPctIfSkipGreens: pct(present + n - skippableHours, held + n),
    });
  }

  const greenHoursByWeek = WEEKS.map(() => 0);
  for (const c of courses) {
    for (const s of c.remaining) {
      if (s.status !== "skip-ok") continue;
      const w = weekIndexOf(s.date);
      if (w >= 0) greenHoursByWeek[w] += s.span;
    }
  }

  return {
    today,
    targetPct: settings.targetPct,
    courses,
    byCourse: Object.fromEntries(courses.map((c) => [c.code, c])) as Record<CourseCode, CoursePlan>,
    byId,
    greenHoursByWeek,
    totalGreenHours: greenHoursByWeek.reduce((a, b) => a + b, 0),
  };
}

/**
 * Final % for a course if every green session is skipped and `extraHours` more
 * hours are skipped on top (used to warn before skipping a red session).
 */
export function finalPctIfSkipping(course: CoursePlan, extraHours: number): number {
  const n = course.remainingHours;
  return pct(course.present + n - course.skippableHours - extraHours, course.held + n);
}

// ---- Diffing two plans -----------------------------------------------------

export interface SkipMove {
  course: CourseCode;
  courseName: string;
  /** Session id that stopped being green. */
  from: string;
  /** Session id that became green instead. */
  to: string;
  /** "Comp Org & Arch: skip moved from Tue 1 Dec to Wed 11 Nov" */
  message: string;
}

export interface SkipChange {
  course: CourseCode;
  courseName: string;
  sessionId: string;
  message: string;
}

export interface PlanDiff {
  /** A green slot went away and another session of the course took it over. */
  moves: SkipMove[];
  /** Undecided sessions that went from "can skip" to "attend". */
  lost: SkipChange[];
  /** Undecided sessions that went from "attend" to "can skip". */
  gained: SkipChange[];
  /** Every session whose status differs between the two plans. */
  changedIds: string[];
}

function dateOfId(id: string): string {
  return id.slice(0, id.indexOf("@"));
}

export function diffPlans(before: Plan, after: Plan): PlanDiff {
  const moves: SkipMove[] = [];
  const lost: SkipChange[] = [];
  const gained: SkipChange[] = [];
  const changedIds: string[] = [];

  for (const { code } of COURSES) {
    const name = COURSE_NAME[code];
    const b = before.byCourse[code];
    const a = after.byCourse[code];
    const beforeStatus = new Map(b.sessions.map((s) => [s.id, s.status]));
    const afterStatus = new Map(a.sessions.map((s) => [s.id, s.status]));

    const ids = [...new Set([...beforeStatus.keys(), ...afterStatus.keys()])].sort();
    for (const id of ids) {
      if (beforeStatus.get(id) !== afterStatus.get(id)) changedIds.push(id);
    }

    // Greens that went away. A session that was skipped used its hours up, so
    // it frees nothing; any other one (attended, or turned red) can hand its
    // skip to a session that became green.
    const freed: string[] = [];
    for (const [id, status] of beforeStatus) {
      if (status !== "skip-ok") continue;
      const now = afterStatus.get(id);
      if (now === "skip-ok" || now === "skipped") continue;
      freed.push(id);
    }
    const added: string[] = [];
    for (const [id, status] of afterStatus) {
      if (status === "skip-ok" && beforeStatus.get(id) !== "skip-ok") added.push(id);
    }

    // Pair them latest-first, which mirrors how the allocation spills backwards.
    freed.sort().reverse();
    added.sort().reverse();
    const pairs = Math.min(freed.length, added.length);
    for (let i = 0; i < pairs; i++) {
      moves.push({
        course: code,
        courseName: name,
        from: freed[i],
        to: added[i],
        message: `${name}: skip moved from ${formatDate(dateOfId(freed[i]))} to ${formatDate(dateOfId(added[i]))}`,
      });
    }
    for (const id of freed.slice(pairs)) {
      if (afterStatus.get(id) !== "attend") continue; // attended: nothing lost
      lost.push({
        course: code,
        courseName: name,
        sessionId: id,
        message: `${name}: ${formatDate(dateOfId(id))} is no longer skippable`,
      });
    }
    for (const id of added.slice(pairs)) {
      gained.push({
        course: code,
        courseName: name,
        sessionId: id,
        message: `${name}: ${formatDate(dateOfId(id))} is now skippable`,
      });
    }
  }

  return { moves, lost, gained, changedIds };
}

// ---- Budget changes --------------------------------------------------------

export interface BudgetChange {
  course: CourseCode;
  courseName: string;
  before: number;
  after: number;
}

/** Courses whose budgetHours differ between two plans, in course order. */
export function diffBudgets(before: Plan, after: Plan): BudgetChange[] {
  const out: BudgetChange[] = [];
  for (const { code } of COURSES) {
    const b = before.byCourse[code].budgetHours;
    const a = after.byCourse[code].budgetHours;
    if (a !== b) out.push({ course: code, courseName: COURSE_NAME[code], before: b, after: a });
  }
  return out;
}
