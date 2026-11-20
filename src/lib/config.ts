// All the fixed data for the planner: window, periods, timetable, courses and
// the portal baseline plus the list of ODs. To update after re-exporting
// attendance, edit PORTAL_BASELINE and BASELINE_AS_OF below (or use the
// Settings drawer in the app).

export type CourseCode =
  | "CSE2251"
  | "CSE2252"
  | "APT4002"
  | "CSE2259"
  | "CSE2257"
  | "CSE2253"
  | "MAT2303"
  | "CSE2255"
  | "CSE2258"
  | "CSE2256"
  | "CSE2254";

export interface Course {
  code: CourseCode;
  name: string;
}

export const COURSES: Course[] = [
  { code: "CSE2251", name: "Data Comm & Networks" },
  { code: "CSE2252", name: "DCCN Lab" },
  { code: "APT4002", name: "Aptitude" },
  { code: "CSE2259", name: "Web Tech Lab" },
  { code: "CSE2257", name: "Comp Org & Arch" },
  { code: "CSE2253", name: "Data Structures" },
  { code: "MAT2303", name: "Linear Algebra" },
  { code: "CSE2255", name: "OOP Java" },
  { code: "CSE2258", name: "Web Tech" },
  { code: "CSE2256", name: "OOP Java Lab" },
  { code: "CSE2254", name: "DS Lab" },
];

export const COURSE_CODES: CourseCode[] = COURSES.map((c) => c.code);

export const COURSE_NAME: Record<CourseCode, string> = Object.fromEntries(
  COURSES.map((c) => [c.code, c.name]),
) as Record<CourseCode, string>;

export const SECTION = "3CSE02";

// ---- Window and weeks ------------------------------------------------------

/** First day of the plan. The last day is a setting (`windowEnd`). */
export const WINDOW_START = "2026-11-11";
export const DEFAULT_WINDOW_END = "2026-12-05";
/** Furthest "Plan until" date the settings accept. */
export const MAX_WINDOW_END = "2027-06-30";

export type TimetableWeekday = 1 | 2 | 3 | 4 | 5;

export const WEEKDAY_NAME: Record<TimetableWeekday, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
};

export const WEEKDAY_SHORT: Record<TimetableWeekday, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
};

/** A day that runs another weekday's timetable, e.g. a Saturday make-up day. */
export interface ExtraWorkingDay {
  date: string;
  followsWeekday: TimetableWeekday;
  reason: string;
}

export const DEFAULT_EXTRA_WORKING_DAYS: ExtraWorkingDay[] = [
  { date: "2026-11-21", followsWeekday: 1, reason: "Saturday working day" },
  { date: "2026-12-05", followsWeekday: 1, reason: "Make-up for Mon 9 Nov holiday" },
];

export interface Week {
  id: number;
  label: string;
  /** Monday of the week. */
  monday: string;
  /** First and last teaching date of the week inside the window. */
  from: string;
  to: string;
}

/**
 * Days with no classes whatever the timetable says, and the note shown on
 * them. Unlike the holidays setting these are fixed: the academic year ends
 * on 1 Dec, and Sat 5 Dec (an extra working day) is the only teaching day
 * after it. They win over an extra working day on the same date.
 */
export const FIXED_MUTED_DAYS: Record<string, string> = {
  "2026-11-09": "Non-instructional day",
  "2026-11-10": "Deepavali holiday",
  "2026-12-02": "No classes: term ended 1 Dec",
  "2026-12-03": "No classes: term ended 1 Dec",
  "2026-12-04": "No classes: term ended 1 Dec",
};

/** Extra holidays inside the window. Sessions on these dates are removed. */
export const DEFAULT_HOLIDAYS: string[] = [];

// ---- Periods ---------------------------------------------------------------

export interface Period {
  n: number;
  start: string;
  end: string;
}

/** Period 5 is the lunch break and has no classes. */
export const PERIODS: Period[] = [
  { n: 1, start: "08:50", end: "09:45" },
  { n: 2, start: "09:45", end: "10:40" },
  { n: 3, start: "10:50", end: "11:45" },
  { n: 4, start: "11:45", end: "12:35" },
  { n: 6, start: "13:25", end: "14:20" },
  { n: 7, start: "14:30", end: "15:25" },
  { n: 8, start: "15:25", end: "16:15" },
];

export const PERIOD_BY_N: Record<number, Period> = Object.fromEntries(
  PERIODS.map((p) => [p.n, p]),
);

/** Start of the first period and end of the last one a class covers. */
export function sessionTimes(startPeriod: number, span: number): { start: string; end: string } {
  const first = PERIOD_BY_N[startPeriod];
  const last = PERIOD_BY_N[startPeriod + span - 1];
  return { start: first.start, end: last.end };
}

// ---- Timetable -------------------------------------------------------------

export interface Slot {
  startPeriod: number;
  /** Number of periods; also the number of attendance hours. */
  span: number;
  course: CourseCode;
}

/** Keyed by weekday index: 1 = Monday ... 5 = Friday. */
export const TIMETABLE: Record<number, Slot[]> = {
  1: [
    { startPeriod: 1, span: 1, course: "MAT2303" },
    { startPeriod: 2, span: 1, course: "CSE2255" },
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
    { startPeriod: 7, span: 2, course: "CSE2256" },
  ],
  5: [
    { startPeriod: 1, span: 1, course: "CSE2257" },
    { startPeriod: 2, span: 1, course: "CSE2251" },
    { startPeriod: 3, span: 2, course: "CSE2259" },
    { startPeriod: 6, span: 1, course: "CSE2253" },
    { startPeriod: 7, span: 1, course: "CSE2258" },
    { startPeriod: 8, span: 1, course: "MAT2303" },
  ],
};

// ---- Portal baseline -------------------------------------------------------

/** [present hours, held hours]. DL counted present, SUS excluded. */
export type Baseline = Record<CourseCode, [number, number]>;

export const BASELINE_AS_OF = "2026-11-10";

/**
 * Attendance up to BASELINE_AS_OF, worked out class by class from the past
 * record (history.ts: the portal's daily report, each hour placed on the
 * course that ran it, with the timetable change on 17 Sep). DL counts as
 * present; suspended hours count as held but not attended. Since accounts,
 * a person's baseline is worked out from their own uploaded record; this
 * table is kept for migrating the single-user data (revision 4).
 */
export const PORTAL_BASELINE: Baseline = {
  CSE2251: [34, 37],
  CSE2252: [20, 22],
  APT4002: [18, 20],
  CSE2259: [24, 26],
  CSE2257: [30, 33],
  CSE2253: [30, 37],
  MAT2303: [35, 45],
  CSE2255: [24, 31],
  CSE2258: [32, 37],
  CSE2256: [23, 26],
  CSE2254: [20, 20],
};

/**
 * Saved states carry the revision of the defaults they were brought up to
 * (`settings.baselineRevision`, missing = 1). Raise this and add a step to
 * BASELINE_CORRECTIONS or EXTRA_DAY_ADDITIONS whenever a default that is saved
 * in the state changes, so devices and the cloud copy pick it up (see
 * migrateState in storage.ts).
 *
 *   2: swap-week baseline correction
 *   3: Sat 21 Nov added as a working day on Monday's timetable
 *   4: baseline rebuilt from the class-by-class record
 *   5: 11-19 Nov marks imported from the record (where not marked by hand)
 *   6: accounts: ODs and the record move into each person's own settings
 */
export const BASELINE_REVISION = 6;

/**
 * Per revision: courses whose default changed, as [old default, new default].
 * A saved course is only replaced if it still equals the old default exactly,
 * so values edited by hand are kept.
 */
export const BASELINE_CORRECTIONS: Record<number, Partial<Record<CourseCode, [[number, number], [number, number]]>>> = {
  2: {
    CSE2253: [
      [25, 33],
      [26, 34],
    ],
    CSE2258: [
      [27, 34],
      [28, 35],
    ],
    MAT2303: [
      [26, 38],
      [25, 37],
    ],
  },
  // Every course moves from the old portal-placed numbers to the record's.
  4: {
    CSE2251: [[29, 34], [34, 37]],
    CSE2252: [[19, 22], [20, 22]],
    APT4002: [[14, 20], [18, 20]],
    CSE2259: [[16, 22], [24, 26]],
    CSE2257: [[30, 36], [30, 33]],
    CSE2253: [[26, 34], [30, 37]],
    MAT2303: [[25, 37], [35, 45]],
    CSE2255: [[24, 29], [24, 31]],
    CSE2258: [[28, 35], [32, 37]],
    CSE2256: [[19, 24], [23, 26]],
  },
};

/**
 * Per revision: extra working days to add to saved states. A day is only added
 * if the state has no entry for that date yet, so one set by hand is kept.
 */
export const EXTRA_DAY_ADDITIONS: Record<number, ExtraWorkingDay[]> = {
  3: [{ date: "2026-11-21", followsWeekday: 1, reason: "Saturday working day" }],
};

// ---- On-duty leaves (OD) ---------------------------------------------------

/** One day of an OD: the hours (1 to 8, never 5) it covers. */
export interface OdSlot {
  date: string;
  hours: number[];
}

/**
 * An on-duty leave someone added for themselves: a reason and the days and
 * hours it covers. On a past day (on or before baselineAsOf) it turns those
 * hours' absences in the person's record into present. On a day in the plan,
 * the classes in those hours count as present and show as "On duty".
 * Once the portal shows the hours as DL, the OD simply has nothing left to do.
 */
export interface OdLeave {
  id: string;
  reason: string;
  slots: OdSlot[];
}

export const TEACHING_HOURS = [1, 2, 3, 4, 6, 7, 8] as const;

export interface OdToggle {
  /** Count this OD's hours as present. */
  on: boolean;
  /**
   * The portal already shows these hours as DL, so they are inside the
   * baseline. The OD then adds nothing, whatever `on` says.
   */
  inPortal: boolean;
}

export type OdState = Record<string, OdToggle>;

export function odStateAll(ods: OdLeave[], on: boolean): OdState {
  return Object.fromEntries(ods.map((od) => [od.id, { on, inPortal: false }]));
}

/** True when the OD's hours are added on top of the portal baseline. */
export function odAddsHours(toggle: OdToggle | undefined): boolean {
  return !!toggle && toggle.on && !toggle.inPortal;
}

/** True when the OD ends up present, either added here or already DL on the portal. */
export function odCounted(toggle: OdToggle | undefined): boolean {
  return !!toggle && (toggle.on || toggle.inPortal);
}

// ---- Settings --------------------------------------------------------------

export type Theme = "system" | "light" | "dark";

export const THEME_LABEL: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export interface Settings {
  /** "system" follows the device's light or dark setting. */
  theme: Theme;
  /** Target attendance in percent, e.g. 75. */
  targetPct: number;
  /** Safety margin in hours kept unspent in every course. */
  cushionHours: number;
  /** Sessions on or before this date are already inside the baseline. */
  baselineAsOf: string;
  /** Last day of the plan, inclusive. */
  windowEnd: string;
  /** Days that run another weekday's timetable. A holiday on the same date wins. */
  extraWorkingDays: ExtraWorkingDay[];
  /** Portal attendance, ODs not included. */
  baseline: Baseline;
  /**
   * Revision of the default baseline this state has been brought up to.
   * Optional so states saved before it existed still validate; missing = 1.
   */
  baselineRevision?: number;
  /** This person's own ODs (on-duty leaves not yet DL). */
  ods: OdLeave[];
  /** Which ODs to count as present. */
  odState: OdState;
  holidays: string[];
  /** The person's uploaded record; null until they upload one. */
  record: AttendanceRecord | null;
  /** Count blocked (suspended) hours as held but not attended. */
  countSuspended: boolean;
}

/**
 * A person's past record, as read from the portal's Daily Attendance export:
 * per class day, one code per hour 1 to 8 (P present, A absent, D DL, S
 * blocked/suspended, "." no class), plus the holidays the export names.
 */
export interface AttendanceRecord {
  days: [date: string, hours: string][];
  holidays: [date: string, name: string][];
  uploadedAt: string | null;
}

/** A blank baseline: someone with no record and nothing typed in. */
export const EMPTY_BASELINE: Baseline = Object.fromEntries(
  ["CSE2251", "CSE2252", "APT4002", "CSE2259", "CSE2257", "CSE2253", "MAT2303", "CSE2255", "CSE2258", "CSE2256", "CSE2254"].map(
    (c) => [c, [0, 0]],
  ),
) as Baseline;

export const DEFAULT_TARGET_PCT = 75;
export const DEFAULT_CUSHION_HOURS = 1;

export function defaultSettings(): Settings {
  return {
    theme: "system",
    targetPct: DEFAULT_TARGET_PCT,
    cushionHours: DEFAULT_CUSHION_HOURS,
    baselineAsOf: BASELINE_AS_OF,
    windowEnd: DEFAULT_WINDOW_END,
    extraWorkingDays: structuredClone(DEFAULT_EXTRA_WORKING_DAYS),
    baseline: structuredClone(EMPTY_BASELINE),
    baselineRevision: BASELINE_REVISION,
    ods: [],
    odState: {},
    holidays: [...DEFAULT_HOLIDAYS],
    record: null,
    countSuspended: true,
  };
}
