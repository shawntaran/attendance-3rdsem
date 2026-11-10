// Everything the app remembers lives in one localStorage key. Anything that
// fails validation on load is thrown away and the defaults are used instead.
//
// v1 had two baseline scenarios ("ODs granted" / "ODs pending"). v2 has one
// portal baseline plus a switch per OD. A v1 state is migrated once on load.

import {
  COURSE_CODES,
  ODS,
  defaultSettings,
  odStateAll,
  type Baseline,
  type OdState,
  type Settings,
  type Theme,
} from "./config";
import { isValidDate } from "./dates";
import type { Marks } from "./plan";

export const STORAGE_KEY = "skip-planner:v2";
export const STORAGE_KEY_V1 = "skip-planner:v1";

export interface AppState {
  settings: Settings;
  marks: Marks;
}

export function defaultState(): AppState {
  return { settings: defaultSettings(), marks: {} };
}

const THEMES: Theme[] = ["system", "light", "dark"];
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

/** Every known OD must have a valid entry; unknown ids are dropped. */
function parseOdState(v: unknown): OdState {
  if (!isObject(v)) throw new Error("odState");
  const out: OdState = {};
  for (const od of ODS) {
    const t = v[od.id];
    if (!isObject(t) || typeof t.on !== "boolean" || typeof t.inPortal !== "boolean") {
      throw new Error(`odState ${od.id}`);
    }
    out[od.id] = { on: t.on, inPortal: t.inPortal };
  }
  return out;
}

function parseTheme(v: unknown): Theme {
  if (!THEMES.includes(v as Theme)) throw new Error("theme");
  return v as Theme;
}

function parseTargetPct(v: unknown): number {
  if (typeof v !== "number" || !(v >= 1 && v <= 100)) throw new Error("targetPct");
  return v;
}

function parseCushion(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 50) throw new Error("cushionHours");
  return v;
}

function parseHolidays(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every(isValidDate)) throw new Error("holidays");
  return [...new Set(v)].sort();
}

function parseSettings(v: unknown): Settings {
  if (!isObject(v)) throw new Error("settings");
  if (!isValidDate(v.baselineAsOf)) throw new Error("baselineAsOf");
  return {
    theme: parseTheme(v.theme),
    targetPct: parseTargetPct(v.targetPct),
    cushionHours: parseCushion(v.cushionHours),
    baselineAsOf: v.baselineAsOf,
    baseline: parseBaseline(v.baseline),
    odState: parseOdState(v.odState),
    holidays: parseHolidays(v.holidays),
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

/** Parse a stored v2 value. Returns the defaults on any error. */
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

/**
 * Turn a stored v1 value into a v2 state, or null if it cannot be read.
 * Keeps marks, target, cushion, holidays and theme. The old scenario becomes
 * all ODs on ("odsGranted") or all off ("odsPending"). The baseline is reset
 * to the new portal defaults, because the v1 tables mixed ODs into it.
 */
export function migrateV1(raw: string | null | undefined): AppState | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data) || !isObject(data.settings)) throw new Error("root");
    const old = data.settings;
    if (old.scenario !== "odsGranted" && old.scenario !== "odsPending") throw new Error("scenario");
    return {
      settings: {
        ...defaultSettings(),
        // The theme arrived late in v1, so older states do not have one.
        theme: old.theme === undefined ? "system" : parseTheme(old.theme),
        targetPct: parseTargetPct(old.targetPct),
        cushionHours: parseCushion(old.cushionHours),
        holidays: parseHolidays(old.holidays),
        odState: odStateAll(old.scenario === "odsGranted"),
      },
      marks: parseMarks(data.marks),
    };
  } catch {
    return null;
  }
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Load from a store, migrating a v1 state if that is all there is. */
export function loadFrom(store: KeyValueStore): AppState {
  const current = store.getItem(STORAGE_KEY);
  if (current !== null) return parseState(current);

  const migrated = migrateV1(store.getItem(STORAGE_KEY_V1));
  if (!migrated) return defaultState();
  store.setItem(STORAGE_KEY, JSON.stringify(migrated));
  store.removeItem(STORAGE_KEY_V1);
  return migrated;
}

export function loadState(): AppState {
  try {
    return loadFrom(window.localStorage);
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
