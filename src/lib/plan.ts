// Rules engine. Pure functions, no React, no browser APIs.
//
// For each course independently:
//   1. Sessions = timetable sessions in the window (WINDOW_START to the
//      windowEnd setting; extra working days run another weekday's
//      timetable), minus holidays, minus dates
//      on or before baselineAsOf (those are already inside the baseline).
//   2. Walk them from the baseline (P present, H held). P is the portal figure
//      plus the hours of every OD that is switched on and not already in the
//      portal; H is the portal figure as is. A session on a day covered by a
//      switched-on OD (an OD with plan `dates`) counts as present, whatever is
//      marked. Otherwise a marked session updates P and H. A past session with no mark is "unmarked": nothing is assumed about
//      it, so it is left out of P and H (u = its hours). Future sessions with
//      no mark are the remaining list R.
//   3. n = hours in R. Unmarked hours are planned for as if they were missed,
//      so a skip is never offered that only works if you did attend them:
//      budgetHours = clamp(floor(P - t*H + (1-t)*n - t*u) - cushion, 0, n).
//      (Final present = P + n - x, final held = H + n + u, need >= t.)
//      Marking an unmarked class attended raises the budget by its hours;
//      marking it skipped changes nothing (it was already planned as missed).
//   4. g = min(|R|, floor(budgetHours / span)). The LAST g sessions of R are
//      "skip-ok", every other one is "attend" (latest-first allocation).

import {
  COURSES,
  COURSE_NAME,
  FIXED_MUTED_DAYS,
  ODS,
  TIMETABLE,
  WINDOW_START,
  odAddsHours,
  type Baseline,
  type CourseCode,
  type ExtraWorkingDay,
  type OdLeave,
  type Settings,
  type Week,
} from "./config";
import { addDays, dateRange, formatDate, weekdayIndex } from "./dates";

export type Mark = "attended" | "skipped";
export type Marks = Record<string, Mark>;

export type SessionStatus =
  | "skip-ok" // undecided, safe to skip
  | "attend" // undecided, must attend
  | "attended" // marked attended
  | "unmarked" // past and not marked yet: not counted, planned for as missed
  | "od" // on a day covered by a switched-on OD: counts as present
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
  /** For status "od": the OD covering this day. */
  odId?: string;
}

export interface CoursePlan {
  code: CourseCode;
  name: string;
  /** Hours per session (1 for theory, 2 for labs and aptitude). */
  span: number;
  /** Present and held hours so far: baseline plus every marked session. */
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
  /** Past sessions with no mark yet, and their hours. */
  unmarked: PlanSession[];
  unmarkedHours: number;
  finalPctIfAttendAll: number;
  finalPctIfSkipGreens: number;
}

export interface Plan {
  today: string;
  targetPct: number;
  /** Last day of the plan, inclusive. */
  windowEnd: string;
  /** Monday-based weeks covering the window. */
  weeks: Week[];
  courses: CoursePlan[];
  byCourse: Record<CourseCode, CoursePlan>;
  byId: Record<string, PlanSession>;
  /** Green (skip-ok) hours per week, in `weeks` order. */
  greenHoursByWeek: number[];
  totalGreenHours: number;
  /** Past sessions with no mark, across all courses. */
  unmarkedCount: number;
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

type WindowSettings = Pick<Settings, "holidays" | "windowEnd" | "extraWorkingDays">;

/** The extra working day on a date, if any. Holidays are not checked here. */
export function extraWorkingDayOn(
  settings: Pick<Settings, "extraWorkingDays">,
  date: string,
): ExtraWorkingDay | undefined {
  return settings.extraWorkingDays.find((x) => x.date === date);
}

/**
 * The weekday timetable (1 = Mon ... 5 = Fri) a date runs, or null for no
 * classes. Order: fixed no-class day or holiday, then extra working day, then
 * the normal weekday. Dates outside the window are not checked here.
 */
export function timetableDayFor(settings: WindowSettings, date: string): number | null {
  if (FIXED_MUTED_DAYS[date] || settings.holidays.includes(date)) return null;
  const extra = extraWorkingDayOn(settings, date);
  if (extra) return extra.followsWeekday;
  const wd = weekdayIndex(date);
  return wd >= 1 && wd <= 5 ? wd : null;
}

/** True for a date that would have classes if it were not a holiday (used for week labels). */
function isTeachingDate(settings: Pick<Settings, "extraWorkingDays">, date: string): boolean {
  if (FIXED_MUTED_DAYS[date]) return false;
  const wd = weekdayIndex(date);
  return (wd >= 1 && wd <= 5) || !!extraWorkingDayOn(settings, date);
}

/**
 * Monday-based weeks from WINDOW_START to windowEnd. A week's from/to are its
 * first and last teaching dates inside the window; weeks without any are left out.
 */
export function buildWeeks(settings: Pick<Settings, "windowEnd" | "extraWorkingDays">): Week[] {
  const weeks: Week[] = [];
  if (settings.windowEnd < WINDOW_START) return weeks;
  let monday = addDays(WINDOW_START, -((weekdayIndex(WINDOW_START) + 6) % 7));
  while (monday <= settings.windowEnd) {
    const days = dateRange(monday, addDays(monday, 6)).filter(
      (d) => d >= WINDOW_START && d <= settings.windowEnd && isTeachingDate(settings, d),
    );
    if (days.length > 0) {
      const id = weeks.length + 1;
      weeks.push({ id, label: `Week ${id}`, monday, from: days[0], to: days[days.length - 1] });
    }
    monday = addDays(monday, 7);
  }
  return weeks;
}

/** Index into `weeks` for a date, or -1 if it is outside every week. */
export function weekIndexOf(weeks: Week[], date: string): number {
  return weeks.findIndex((w) => date >= w.monday && date <= addDays(w.monday, 6));
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
export function listSessions(settings: WindowSettings & Pick<Settings, "baselineAsOf">): RawSession[] {
  const out: RawSession[] = [];
  if (settings.windowEnd < WINDOW_START) return out;
  for (const date of dateRange(WINDOW_START, settings.windowEnd)) {
    if (date <= settings.baselineAsOf) continue;
    const day = timetableDayFor(settings, date);
    if (day === null) continue; // holiday or weekend
    const slots = TIMETABLE[day];
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

/** Plan days covered by a switched-on OD, mapped to that OD's id. */
export function odCoveredDates(settings: Pick<Settings, "odState">): Map<string, string> {
  const out = new Map<string, string>();
  for (const od of ODS) {
    if (!od.dates || !odAddsHours(settings.odState[od.id])) continue;
    for (const d of od.dates) if (!out.has(d)) out.set(d, od.id);
  }
  return out;
}

/**
 * Hours per course an OD covers: its baseline hours, or for an OD with plan
 * dates, the hours of the classes on those days (holidays and dates already
 * inside the baseline are left out, as in the plan).
 */
export function odHoursByCourse(od: OdLeave, settings: WindowSettings & Pick<Settings, "baselineAsOf">): Partial<Record<CourseCode, number>> {
  if (!od.dates) return od.hours;
  const out: Partial<Record<CourseCode, number>> = {};
  for (const sess of listSessions(settings)) {
    if (od.dates.includes(sess.date)) out[sess.course] = (out[sess.course] ?? 0) + sess.span;
  }
  return out;
}

export function odHoursTotal(od: OdLeave, settings: WindowSettings & Pick<Settings, "baselineAsOf">): number {
  return Object.values(odHoursByCourse(od, settings)).reduce((sum, h) => sum + (h ?? 0), 0);
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
  const odDays = odCoveredDates(settings);
  const all = listSessions(settings);

  const courses: CoursePlan[] = [];
  const byId: Record<string, PlanSession> = {};

  for (const course of COURSES) {
    const raw = all.filter((s) => s.course === course.code);
    let [present, held] = baseline[course.code];
    let skipHoursUsed = 0;
    let odSessionHours = 0;

    const sessions: PlanSession[] = [];
    const remaining: PlanSession[] = [];
    const unmarked: PlanSession[] = [];

    for (const s of raw) {
      const mark = marks[s.id];
      let status: SessionStatus;
      const odId = odDays.get(s.date);
      if (odId) status = "od";
      else if (mark === "attended") status = "attended";
      else if (mark === "skipped") status = "skipped";
      else if (s.date < today) status = "unmarked";
      else status = "attend"; // provisional, greens are assigned below

      if (status === "attended" || status === "od") {
        present += s.span;
        held += s.span;
        if (status === "od") odSessionHours += s.span;
      } else if (status === "skipped") {
        held += s.span;
        skipHoursUsed += s.span;
      }

      const session: PlanSession = odId ? { ...s, status, odId } : { ...s, status };
      sessions.push(session);
      if (status === "attend") remaining.push(session);
      if (status === "unmarked") unmarked.push(session);
    }

    const n = remaining.reduce((sum, s) => sum + s.span, 0);
    const u = unmarked.reduce((sum, s) => sum + s.span, 0);
    const span = raw[0]?.span ?? 1;

    const budgetHours = clamp(
      Math.floor(present - t * held + (1 - t) * n - t * u + 1e-9) - settings.cushionHours,
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
      odHours: odHours[course.code] + odSessionHours,
      sessions,
      remaining,
      remainingHours: n,
      budgetHours,
      skippableHours,
      skipHoursUsed,
      unmarked,
      unmarkedHours: u,
      // Unmarked classes count as missed in these projections, until marked.
      finalPctIfAttendAll: pct(present + n, held + n + u),
      finalPctIfSkipGreens: pct(present + n - skippableHours, held + n + u),
    });
  }

  const weeks = buildWeeks(settings);
  const greenHoursByWeek = weeks.map(() => 0);
  for (const c of courses) {
    for (const s of c.remaining) {
      if (s.status !== "skip-ok") continue;
      const w = weekIndexOf(weeks, s.date);
      if (w >= 0) greenHoursByWeek[w] += s.span;
    }
  }

  return {
    today,
    targetPct: settings.targetPct,
    windowEnd: settings.windowEnd,
    weeks,
    courses,
    byCourse: Object.fromEntries(courses.map((c) => [c.code, c])) as Record<CourseCode, CoursePlan>,
    byId,
    greenHoursByWeek,
    totalGreenHours: greenHoursByWeek.reduce((a, b) => a + b, 0),
    unmarkedCount: courses.reduce((sum, c) => sum + c.unmarked.length, 0),
  };
}

/**
 * Final % for a course if every green session is skipped and `extraHours` more
 * hours are skipped on top (used to warn before skipping a red session).
 */
export function finalPctIfSkipping(course: CoursePlan, extraHours: number): number {
  const n = course.remainingHours;
  const u = course.unmarkedHours;
  return pct(course.present + n - course.skippableHours - extraHours, course.held + n + u);
}

// ---- Diffing two plans -----------------------------------------------------

export interface SkipMove {
  course: CourseCode;
  courseName: string;
  /** Session id that stopped being green. */
  from: string;
  /** Session id that became green instead. */
  to: string;
  /** "Comp Org & Arch: skip moved from Fri 4 Dec to Wed 11 Nov" */
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
