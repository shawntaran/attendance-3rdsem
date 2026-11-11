// Text and layout helpers shared by the desktop grid and the mobile list.

import {
  COURSE_NAME,
  FIXED_MUTED_DAYS,
  WEEKDAY_NAME,
  WEEKDAY_SHORT,
  WINDOW_START,
  sessionTimes,
  type ExtraWorkingDay,
  type Settings,
  type Week,
} from "./config";
import { addDays, formatDate, formatDayMonth, weekdayIndex, yearOf } from "./dates";
import { extraWorkingDayOn, finalPctIfSkipping, type Plan, type PlanSession, type SessionStatus } from "./plan";

const LONG_WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface DayView {
  date: string;
  /** Set when the day has no plannable classes; the text to show instead. */
  mutedNote: string | null;
  /** Set when the day runs another weekday's timetable. */
  extra: ExtraWorkingDay | null;
  sessions: PlanSession[];
}

/**
 * The rows of a week: Monday to Friday, plus Saturday only when it is an extra
 * working day inside the window. Sunday is never shown.
 */
export function weekDays(week: Week, settings: Settings, plan: Plan): DayView[] {
  const saturday = addDays(week.monday, 5);
  const showSaturday =
    !!extraWorkingDayOn(settings, saturday) && saturday >= WINDOW_START && saturday <= settings.windowEnd;
  const count = showSaturday ? 6 : 5;

  const days: DayView[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(week.monday, i);
    let mutedNote: string | null = FIXED_MUTED_DAYS[date] ?? null;
    if (!mutedNote && (date < WINDOW_START || date > settings.windowEnd)) mutedNote = "Outside plan";
    if (!mutedNote && settings.holidays.includes(date)) mutedNote = "Holiday";
    if (!mutedNote && date <= settings.baselineAsOf) mutedNote = "Already in baseline";
    const sessions = mutedNote
      ? []
      : Object.values(plan.byId)
          .filter((s) => s.date === date)
          .sort((a, b) => a.startPeriod - b.startPeriod);
    days.push({ date, mutedNote, extra: extraWorkingDayOn(settings, date) ?? null, sessions });
  }
  return days;
}

/** "Mon timetable", the chip on an extra working day. */
export function extraChipLabel(extra: ExtraWorkingDay): string {
  return `${WEEKDAY_SHORT[extra.followsWeekday]} timetable`;
}

/** "Saturday, follows Monday's timetable" */
export function extraSpoken(extra: ExtraWorkingDay): string {
  return `${LONG_WEEKDAY[weekdayIndex(extra.date)]}, follows ${WEEKDAY_NAME[extra.followsWeekday]}'s timetable`;
}

/** "5 Dec" */
export function endLabel(windowEnd: string): string {
  return formatDayMonth(windowEnd);
}

/** "11 Nov to 5 Dec" */
export function windowLabel(windowEnd: string): string {
  return `${formatDayMonth(WINDOW_START)} to ${formatDayMonth(windowEnd)}`;
}

/** "30 Nov to 5 Dec 2026" */
export function weekRangeLabel(week: Week): string {
  return `${formatDayMonth(week.from)} to ${formatDayMonth(week.to)} ${yearOf(week.to)}`;
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  "skip-ok": "Can skip",
  attend: "Attend",
  attended: "Attended",
  assumed: "Attended",
  skipped: "Skipped",
};

const STATUS_SPOKEN: Record<SessionStatus, string> = {
  "skip-ok": "you can skip",
  attend: "you should attend",
  attended: "marked attended",
  assumed: "assumed attended",
  skipped: "marked skipped",
};

export function fmtPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function fmtHours(hours: number): string {
  return `${hours} ${hours === 1 ? "hr" : "hrs"}`;
}

export function timeRange(session: PlanSession): string {
  const { start, end } = sessionTimes(session.startPeriod, session.span);
  return `${start} to ${end}`;
}

/**
 * "Linear Algebra, Mon 23 Nov, 08:50 to 09:45, you can skip. Press to change."
 * On an extra working day the date is followed by "Saturday, follows Monday's timetable".
 */
export function cellAriaLabel(session: PlanSession, extra?: ExtraWorkingDay | null): string {
  const day = extra ? `${formatDate(session.date)}, ${extraSpoken(extra)}` : formatDate(session.date);
  return `${COURSE_NAME[session.course]}, ${day}, ${timeRange(session)}, ${
    STATUS_SPOKEN[session.status]
  }. Press to change.`;
}

/** One-line explanation shown in the popover. */
export function reasonText(plan: Plan, session: PlanSession): string {
  const course = plan.byCourse[session.course];
  const name = course.name;
  switch (session.status) {
    case "skip-ok":
      return `You can skip: ${name} stays at ${fmtPct(course.finalPctIfSkipGreens)} on ${endLabel(plan.windowEnd)}.`;
    case "attend":
      return course.skippableHours > 0
        ? `Attend: ${name} has ${fmtHours(course.skippableHours)} of skips left, and they are placed on later classes.`
        : `Attend: ${name} has no skippable hours left.`;
    case "attended":
      return `Marked attended. ${name} is at ${fmtPct(course.currentPct)} now.`;
    case "assumed":
      return `This day has passed with no mark, so it counts as attended. Change it if you skipped.`;
    case "skipped":
      return `Marked skipped. It used ${fmtHours(session.span)} of ${name}'s allowance.`;
  }
}

export interface SkipWarning {
  pct: number;
  belowTarget: boolean;
  text: string;
}

/** Warning shown next to "I skipped this" on a red cell. */
export function skipWarning(plan: Plan, session: PlanSession): SkipWarning {
  const course = plan.byCourse[session.course];
  const projected = finalPctIfSkipping(course, session.span);
  const belowTarget = projected < plan.targetPct - 1e-9;
  const withGreens = course.skippableHours > 0 ? " and all your green slots" : "";
  const text = belowTarget
    ? `Skipping this${withGreens} leaves ${course.name} at ${fmtPct(projected)} on ${endLabel(plan.windowEnd)}, below ${plan.targetPct}%.${
        course.skippableHours > 0 ? " One green slot will turn red to make up for it." : ""
      }`
    : `Skipping this${withGreens} leaves ${course.name} at ${fmtPct(projected)} on ${endLabel(plan.windowEnd)}. That eats into your safety cushion${
        course.skippableHours > 0 ? ", so one green slot will turn red" : ""
      }.`;
  return { pct: projected, belowTarget, text };
}
