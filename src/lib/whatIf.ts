// "What if this day were a holiday?" Days switched off here are treated
// exactly like holidays by the engine, but only for the preview: they are not
// added to the real holidays setting and are not synced.

import { COURSES, type CourseCode, type Settings } from "./config";
import type { Plan } from "./plan";

/** Settings with the what-if days added to the holidays, for computePlan. */
export function withOffDays(settings: Settings, offDays: string[]): Settings {
  if (offDays.length === 0) return settings;
  return { ...settings, holidays: [...new Set([...settings.holidays, ...offDays])].sort() };
}

export interface CourseWhatIf {
  code: CourseCode;
  name: string;
  /** Hours of class removed by the days switched off. */
  hoursRemoved: number;
  finalIfAttendAll: [number, number];
  finalIfSkipGreens: [number, number];
  budget: [number, number];
}

export interface WhatIfSummary {
  /** Only courses that lose at least one class. */
  courses: CourseWhatIf[];
  totalGreenHours: [number, number];
}

/** Compare the real plan with the what-if plan, course by course. */
export function summarizeWhatIf(real: Plan, whatIf: Plan): WhatIfSummary {
  const courses: CourseWhatIf[] = [];
  for (const { code, name } of COURSES) {
    const a = real.byCourse[code];
    const b = whatIf.byCourse[code];
    const hoursIn = (p: typeof a) => p.sessions.reduce((sum, s) => sum + s.span, 0);
    const hoursRemoved = hoursIn(a) - hoursIn(b);
    if (hoursRemoved <= 0) continue;
    courses.push({
      code,
      name,
      hoursRemoved,
      finalIfAttendAll: [a.finalPctIfAttendAll, b.finalPctIfAttendAll],
      finalIfSkipGreens: [a.finalPctIfSkipGreens, b.finalPctIfSkipGreens],
      budget: [a.budgetHours, b.budgetHours],
    });
  }
  return { courses, totalGreenHours: [real.totalGreenHours, whatIf.totalGreenHours] };
}

const STORAGE_KEY = "skip-planner:what-if";

/** This device's what-if days (a convenience; a blocked or bad value means none). */
export function loadOffDays(): string[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  } catch {
    return [];
  }
}

export function saveOffDays(days: string[]): void {
  try {
    if (days.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(days));
  } catch {
    // storage blocked: the what-if just lasts for this visit
  }
}
