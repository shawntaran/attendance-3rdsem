// Everything the app remembers lives in one localStorage key. Anything that
// fails validation on load is thrown away and the defaults are used instead.

import { COURSE_CODES, defaultSettings, type Baseline, type Scenario, type Settings } from "./config";
import { isValidDate } from "./dates";
import type { Marks } from "./plan";

export const STORAGE_KEY = "skip-planner:v1";

export interface AppState {
  settings: Settings;
  marks: Marks;
}

export function defaultState(): AppState {
  return { settings: defaultSettings(), marks: {} };
}

const SCENARIOS: Scenario[] = ["odsGranted", "odsPending"];
const SESSION_ID_RE = /^(\d{4}-\d{2}-\d{2})@[1-8]$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isHours(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10_000;
}

function parseBaseline(v: unknown): Baseline {
  if (!isObject(v)) throw new Error("baseline");
  const out = {} as Baseline;
  for (const code of COURSE_CODES) {
    const pair = v[code];
    if (!Array.isArray(pair) || pair.length !== 2 || !isHours(pair[0]) || !isHours(pair[1])) {
      throw new Error(`baseline ${code}`);
    }
    out[code] = [pair[0], pair[1]];
  }
  return out;
}

function parseSettings(v: unknown): Settings {
  if (!isObject(v)) throw new Error("settings");
  const { scenario, targetPct, cushionHours, baselineAsOf, baselines, holidays } = v;
  if (!SCENARIOS.includes(scenario as Scenario)) throw new Error("scenario");
  if (typeof targetPct !== "number" || !(targetPct >= 1 && targetPct <= 100)) throw new Error("targetPct");
  if (!Number.isInteger(cushionHours) || (cushionHours as number) < 0 || (cushionHours as number) > 50) {
    throw new Error("cushionHours");
  }
  if (!isValidDate(baselineAsOf)) throw new Error("baselineAsOf");
  if (!isObject(baselines)) throw new Error("baselines");
  if (!Array.isArray(holidays) || !holidays.every(isValidDate)) throw new Error("holidays");
  return {
    scenario: scenario as Scenario,
    targetPct,
    cushionHours: cushionHours as number,
    baselineAsOf,
    baselines: {
      odsGranted: parseBaseline(baselines.odsGranted),
      odsPending: parseBaseline(baselines.odsPending),
    },
    holidays: [...new Set(holidays)].sort(),
  };
}

function parseMarks(v: unknown): Marks {
  if (!isObject(v)) throw new Error("marks");
  const out: Marks = {};
  for (const [id, mark] of Object.entries(v)) {
    const m = SESSION_ID_RE.exec(id);
    if (!m || !isValidDate(m[1])) throw new Error(`mark id ${id}`);
    if (mark !== "attended" && mark !== "skipped") throw new Error(`mark ${id}`);
    out[id] = mark;
  }
  return out;
}

/** Parse a stored value. Returns the defaults on any error. */
export function parseState(raw: string | null | undefined): AppState {
  if (!raw) return defaultState();
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data)) throw new Error("root");
    return { settings: parseSettings(data.settings), marks: parseMarks(data.marks) };
  } catch {
    return defaultState();
  }
}

export function loadState(): AppState {
  try {
    return parseState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked (private mode). The app still works for this visit.
  }
}
