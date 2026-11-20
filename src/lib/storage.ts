// Everything the app remembers lives in one localStorage key. Anything that
// fails validation on load is thrown away and the defaults are used instead.
//
// v1 had two baseline scenarios ("ODs granted" / "ODs pending"). v2 has one
// portal baseline plus a switch per OD. v3 adds the plan's end date and extra
// working days. An older state is migrated once on load.

import {
  BASELINE_AS_OF,
  BASELINE_CORRECTIONS,
  BASELINE_REVISION,
  EXTRA_DAY_ADDITIONS,
  COURSE_CODES,
  MAX_WINDOW_END,
  PORTAL_BASELINE,
  TEACHING_HOURS,
  WINDOW_START,
  defaultSettings,
  type AttendanceRecord,
  type Baseline,
  type CourseCode,
  type ExtraWorkingDay,
  type OdLeave,
  type OdState,
  type Settings,
  type Theme,
  type TimetableWeekday,
} from "./config";
import { isValidDate, weekdayIndex } from "./dates";
import { historyMark, recordHistory, STATIC_RECORD } from "./history";
import type { Marks } from "./plan";

export const STORAGE_KEY = "skip-planner:v3";
export const STORAGE_KEY_V2 = "skip-planner:v2";
export const STORAGE_KEY_V1 = "skip-planner:v1";

export const MAX_REASON_LENGTH = 120;

export interface AppState {
  settings: Settings;
  marks: Marks;
}

/**
 * Marks for the classes in the plan window that a record covers (after
 * `after`): attended or skipped, as the portal shows them. Defaults to the
 * single-user record, for migrating that data.
 */
export function recordMarks(
  record: AttendanceRecord = STATIC_RECORD,
  after: string = BASELINE_AS_OF,
  countSuspended = true,
): Marks {
  const marks: Marks = {};
  for (const day of recordHistory(record)) {
    if (day.date <= after) continue;
    for (const cls of day.classes) {
      const mark = historyMark(cls, countSuspended);
      if (mark) marks[`${day.date}@${cls.startPeriod}`] = mark;
    }
  }
  return marks;
}

/** A new person: no record, no ODs, no marks. */
export function defaultState(): AppState {
  return { settings: defaultSettings(), marks: {} };
}

/**
 * Put a freshly uploaded record into a state. Days it covers after
 * baselineAsOf become marks, replacing marks on those classes (the portal is
 * the record); marks on days it does not cover are kept.
 */
export function applyRecord(state: AppState, record: AttendanceRecord): AppState {
  const marks: Marks = { ...state.marks };
  for (const [id, mark] of Object.entries(recordMarks(record, state.settings.baselineAsOf, state.settings.countSuspended))) marks[id] = mark;
  return { settings: { ...state.settings, record }, marks };
}

/** The two ODs of the single-user app, as days and hours (revision 6). */
export const LEGACY_ODS: OdLeave[] = [
  { id: "od-2026-09-29", reason: "French event, Seminar Hall", slots: [{ date: "2026-09-29", hours: [3] }] },
  {
    id: "od-2026-11-17",
    reason: "STEM for Impact Hackathon",
    slots: [
      { date: "2026-11-17", hours: [...TEACHING_HOURS] },
      { date: "2026-11-18", hours: [...TEACHING_HOURS] },
    ],
  },
];

/** Settings as the single-user app would have had them at revision 5, for its migrations. */
export function legacyDefaults(): Settings {
  return { ...defaultSettings(), baseline: structuredClone(PORTAL_BASELINE), baselineRevision: 5 };
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
/**
 * Every known OD gets an entry. An OD added to the app after the state was
 * saved is missing from it: it gets the default (counted), instead of the
 * whole saved state being rejected. A present but malformed entry still fails.
 */
/**
 * A switch per OD. Every OD in `ods` gets one (missing = switched on); other
 * entries are kept as they are, so a migration can still read the switches
 * of ODs that used to be built in.
 */
function parseOdState(v: unknown, ods: OdLeave[]): OdState {
  if (v === undefined) v = {};
  if (!isObject(v)) throw new Error("odState");
  const out: OdState = {};
  for (const [id, t] of Object.entries(v)) {
    if (id.length > 60 || !isObject(t) || typeof t.on !== "boolean" || typeof t.inPortal !== "boolean") {
      throw new Error(`odState ${id}`);
    }
    out[id] = { on: t.on, inPortal: t.inPortal };
  }
  for (const od of ods) out[od.id] ??= { on: true, inPortal: false };
  return out;
}

const OD_ID_RE = /^[a-z0-9-]{1,60}$/;

/** A person's own ODs. Missing (states from before accounts) means none. */
function parseOds(v: unknown): OdLeave[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 200) throw new Error("ods");
  const seen = new Set<string>();
  return v.map((od) => {
    if (!isObject(od) || typeof od.id !== "string" || !OD_ID_RE.test(od.id) || seen.has(od.id)) throw new Error("od id");
    if (typeof od.reason !== "string" || od.reason.length > MAX_REASON_LENGTH) throw new Error("od reason");
    if (!Array.isArray(od.slots) || od.slots.length === 0 || od.slots.length > 60) throw new Error("od slots");
    seen.add(od.id);
    const dates = new Set<string>();
    const slots = od.slots.map((slot) => {
      if (!isObject(slot) || !isValidDate(slot.date) || dates.has(slot.date)) throw new Error("od slot date");
      if (!Array.isArray(slot.hours) || slot.hours.length === 0) throw new Error("od slot hours");
      const hours = [...new Set(slot.hours)];
      if (!hours.every((h) => (TEACHING_HOURS as readonly unknown[]).includes(h))) throw new Error("od slot hours");
      dates.add(slot.date);
      return { date: slot.date, hours: (hours as number[]).sort((a, b) => a - b) };
    });
    slots.sort((a, b) => a.date.localeCompare(b.date));
    return { id: od.id, reason: od.reason, slots };
  });
}

const RECORD_CODES_RE = /^[PADS.]{8}$/;

/** A person's uploaded record. Missing means none yet. */
function parseRecord(v: unknown): AttendanceRecord | null {
  if (v === undefined || v === null) return null;
  if (!isObject(v) || !Array.isArray(v.days) || !Array.isArray(v.holidays)) throw new Error("record");
  if (v.days.length > 400 || v.holidays.length > 200) throw new Error("record size");
  const seen = new Set<string>();
  const days = v.days.map((d) => {
    if (!Array.isArray(d) || d.length !== 2 || !isValidDate(d[0]) || typeof d[1] !== "string" || !RECORD_CODES_RE.test(d[1])) {
      throw new Error("record day");
    }
    if (seen.has(d[0])) throw new Error("record duplicate day");
    seen.add(d[0]);
    return [d[0], d[1]] as [string, string];
  });
  const holidays = v.holidays.map((h) => {
    if (!Array.isArray(h) || h.length !== 2 || !isValidDate(h[0]) || typeof h[1] !== "string" || h[1].length > 120) {
      throw new Error("record holiday");
    }
    return [h[0], h[1]] as [string, string];
  });
  if (v.uploadedAt !== null && v.uploadedAt !== undefined && typeof v.uploadedAt !== "string") throw new Error("record uploadedAt");
  days.sort((a, b) => a[0].localeCompare(b[0]));
  holidays.sort((a, b) => a[0].localeCompare(b[0]));
  return { days, holidays, uploadedAt: (v.uploadedAt as string | null | undefined) ?? null };
}

function parseBool(v: unknown, name: string): boolean {
  if (typeof v !== "boolean") throw new Error(name);
  return v;
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

function parseWindowEnd(v: unknown): string {
  if (!isValidDate(v) || v < WINDOW_START || v > MAX_WINDOW_END) throw new Error("windowEnd");
  return v;
}

/**
 * Shape checks only: a day may fall outside the window if "Plan until" moved
 * after it was added, and is then simply ignored. Sundays and repeated dates
 * are rejected, because the grid never shows a Sunday.
 */
function parseExtraWorkingDays(v: unknown): ExtraWorkingDay[] {
  if (!Array.isArray(v)) throw new Error("extraWorkingDays");
  const seen = new Set<string>();
  const out: ExtraWorkingDay[] = [];
  for (const x of v) {
    if (!isObject(x) || !isValidDate(x.date) || weekdayIndex(x.date) === 0 || seen.has(x.date)) {
      throw new Error("extraWorkingDays date");
    }
    if (!([1, 2, 3, 4, 5] as unknown[]).includes(x.followsWeekday)) throw new Error("extraWorkingDays weekday");
    if (typeof x.reason !== "string" || x.reason.length > MAX_REASON_LENGTH) throw new Error("extraWorkingDays reason");
    seen.add(x.date);
    out.push({ date: x.date, followsWeekday: x.followsWeekday as TimetableWeekday, reason: x.reason });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The fields v2 and v3 share. */
type SharedSettings = Omit<Settings, "windowEnd" | "extraWorkingDays">;

/** Optional: states saved before revisions existed have none (treated as 1). */
function parseBaselineRevision(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1000) throw new Error("baselineRevision");
  return v;
}

function parseSharedSettings(v: Record<string, unknown>): SharedSettings {
  if (!isValidDate(v.baselineAsOf)) throw new Error("baselineAsOf");
  const revision = parseBaselineRevision(v.baselineRevision);
  const ods = parseOds(v.ods);
  return {
    theme: parseTheme(v.theme),
    targetPct: parseTargetPct(v.targetPct),
    cushionHours: parseCushion(v.cushionHours),
    baselineAsOf: v.baselineAsOf,
    baseline: parseBaseline(v.baseline),
    ...(revision === undefined ? {} : { baselineRevision: revision }),
    ods,
    odState: parseOdState(v.odState, ods),
    holidays: parseHolidays(v.holidays),
    record: parseRecord(v.record),
    countSuspended: v.countSuspended === undefined ? true : parseBool(v.countSuspended, "countSuspended"),
  };
}

/**
 * Bring a state's baseline up to BASELINE_REVISION. Each correction replaces a
 * course only if it still equals the old default exactly; anything edited by
 * hand is left alone. Pure and idempotent: a state already at the current
 * revision comes back unchanged (the same object).
 */
/** The revision at which marks for 11-19 Nov are imported from the record. */
export const MARKS_FROM_RECORD_REVISION = 5;

/** The revision at which the single-user data moved into per-person settings. */
export const ACCOUNTS_REVISION = 6;

export function migrateState(state: AppState): AppState {
  const from = state.settings.baselineRevision ?? 1;
  if (from >= BASELINE_REVISION) return state;
  const baseline = { ...state.settings.baseline };
  const extraWorkingDays = [...state.settings.extraWorkingDays];
  const marks: Marks = { ...state.marks };
  let ods = state.settings.ods;
  let odState = state.settings.odState;
  let record = state.settings.record;
  for (let rev = from + 1; rev <= BASELINE_REVISION; rev++) {
    for (const [code, step] of Object.entries(BASELINE_CORRECTIONS[rev] ?? {})) {
      if (!step) continue;
      const [oldValue, newValue] = step;
      const current = baseline[code as CourseCode];
      if (current[0] === oldValue[0] && current[1] === oldValue[1]) {
        baseline[code as CourseCode] = [newValue[0], newValue[1]];
      }
    }
    for (const day of EXTRA_DAY_ADDITIONS[rev] ?? []) {
      if (!extraWorkingDays.some((x) => x.date === day.date)) extraWorkingDays.push({ ...day });
    }
    if (rev === MARKS_FROM_RECORD_REVISION) {
      // Classes in the plan window that the record already covers become marks,
      // unless you marked them yourself.
      for (const [id, mark] of Object.entries(recordMarks())) {
        if (marks[id] === undefined) marks[id] = mark;
      }
    }
    if (rev === ACCOUNTS_REVISION) {
      // Anything older than accounts is the single-user app's data: its record,
      // and its two built-in ODs as days and hours, with their switches kept.
      record ??= structuredClone(STATIC_RECORD);
      ods = [...ods];
      const switches: OdState = {};
      for (const od of LEGACY_ODS) {
        if (!ods.some((x) => x.id === od.id)) ods.push(structuredClone(od));
      }
      for (const od of ods) switches[od.id] = odState[od.id] ?? { on: true, inPortal: false };
      odState = switches;
    }
  }
  extraWorkingDays.sort((a, b) => a.date.localeCompare(b.date));
  return {
    ...state,
    marks,
    settings: {
      ...state.settings,
      baseline,
      extraWorkingDays,
      ods,
      odState,
      record,
      baselineRevision: BASELINE_REVISION,
    },
  };
}

function parseSettings(v: unknown): Settings {
  if (!isObject(v)) throw new Error("settings");
  return {
    ...parseSharedSettings(v),
    windowEnd: parseWindowEnd(v.windowEnd),
    extraWorkingDays: parseExtraWorkingDays(v.extraWorkingDays),
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

/**
 * Strict check of a v3 state that came from anywhere (the server, IndexedDB,
 * a request body). Throws on anything that is not a complete, valid state.
 */
export function validateState(data: unknown): AppState {
  if (!isObject(data)) throw new Error("root");
  return { settings: parseSettings(data.settings), marks: parseMarks(data.marks) };
}

/** Same as validateState, but returns null instead of throwing. */
export function tryValidateState(data: unknown): AppState | null {
  try {
    return validateState(data);
  } catch {
    return null;
  }
}

/** Parse a stored v3 value. Returns the defaults on any error. */
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
 * Turn a stored v2 value into a v3 state, or null if it cannot be read.
 * Keeps everything; the plan end date and extra working days get the defaults.
 */
export function migrateV2(raw: string | null | undefined): AppState | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data) || !isObject(data.settings)) throw new Error("root");
    const d = defaultSettings();
    return {
      settings: {
        ...parseSharedSettings(data.settings),
        windowEnd: d.windowEnd,
        extraWorkingDays: d.extraWorkingDays,
      },
      marks: parseMarks(data.marks),
    };
  } catch {
    return null;
  }
}

/**
 * Turn a stored v1 value into a v3 state, or null if it cannot be read.
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
        ...legacyDefaults(),
        // The theme arrived late in v1, so older states do not have one.
        theme: old.theme === undefined ? "system" : parseTheme(old.theme),
        targetPct: parseTargetPct(old.targetPct),
        cushionHours: parseCushion(old.cushionHours),
        holidays: parseHolidays(old.holidays),
        odState: Object.fromEntries(
          LEGACY_ODS.map((od) => [od.id, { on: old.scenario === "odsGranted", inPortal: false }]),
        ),
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

/**
 * Load from a store. With no v3 state, migrate the newest older one (v2, then
 * v1), save it as v3 and remove the old key. An unreadable old value is left
 * alone and the defaults are used.
 */
export function loadFrom(store: KeyValueStore): AppState {
  const current = store.getItem(STORAGE_KEY);
  if (current !== null) return migrateState(parseState(current));

  const older: [string, (raw: string | null) => AppState | null][] = [
    [STORAGE_KEY_V2, migrateV2],
    [STORAGE_KEY_V1, migrateV1],
  ];
  for (const [key, migrate] of older) {
    const raw = store.getItem(key);
    if (raw === null) continue;
    const parsed = migrate(raw);
    if (!parsed) return defaultState();
    const migrated = migrateState(parsed);
    store.setItem(STORAGE_KEY, JSON.stringify(migrated));
    store.removeItem(key);
    return migrated;
  }
  return defaultState();
}

/** All the keys an older version of the app saved its state under. */
export const LEGACY_KEYS = [STORAGE_KEY, STORAGE_KEY_V2, STORAGE_KEY_V1] as const;

/**
 * Read the state the localStorage-only versions of the app left behind,
 * migrating v2 or v1 in memory, and brings the baseline up to the current
 * revision. Unlike loadFrom this never writes or removes anything: the keys
 * stay until the state is safely in the cloud.
 */
export function readLegacy(store: Pick<KeyValueStore, "getItem">): { state: AppState; key: string } | null {
  const current = store.getItem(STORAGE_KEY);
  if (current !== null) {
    const state = tryParse(current);
    if (state) return { state: migrateState(state), key: STORAGE_KEY };
  }
  const older: [string, (raw: string | null) => AppState | null][] = [
    [STORAGE_KEY_V2, migrateV2],
    [STORAGE_KEY_V1, migrateV1],
  ];
  for (const [key, migrate] of older) {
    const migrated = migrate(store.getItem(key));
    if (migrated) return { state: migrateState(migrated), key };
  }
  return null;
}

function tryParse(raw: string): AppState | null {
  try {
    return tryValidateState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Remove every legacy key. Only call this once the state is verified in the cloud. */
export function clearLegacy(store: Pick<KeyValueStore, "removeItem">): void {
  for (const key of LEGACY_KEYS) store.removeItem(key);
}

/** Theme only, read by the script in layout.tsx before first paint. */
export const THEME_KEY = "skip-planner:theme";

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
