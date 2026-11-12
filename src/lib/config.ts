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
 * Attendance exactly as the Linways portal shows it on BASELINE_AS_OF.
 * OD hours the portal has not approved yet are still absent in here; the ODS
 * list below is what turns them into present hours.
 *
 * Swap week, 7 to 11 Sep 2026: Wed 9 Sep ran Friday's timetable and Fri 11 Sep
 * ran Wednesday's, but the hours had been placed by the normal weekday
 * timetable. Corrected, that nets Linear Algebra -1 present / -1 held, and
 * Data Structures and Web Tech +1 / +1 each (baseline revision 2). Total held
 * across all courses: 313.
 */
export const PORTAL_BASELINE: Baseline = {
  CSE2251: [29, 34],
  CSE2252: [19, 22],
  APT4002: [14, 20],
  CSE2259: [16, 22],
  CSE2257: [30, 36],
  CSE2253: [26, 34], // revision 1: [25, 33]
  MAT2303: [25, 37], // revision 1: [26, 38]
  CSE2255: [24, 29],
  CSE2258: [28, 35], // revision 1: [27, 34]
  CSE2256: [19, 24],
  CSE2254: [20, 20],
};

/**
 * Saved states carry the revision of the default baseline they were made
 * with (`settings.baselineRevision`, missing = 1). Raise this and add a step to
 * BASELINE_CORRECTIONS whenever the defaults are corrected, so devices and the
 * cloud copy pick the correction up (see migrateState in storage.ts).
 */
export const BASELINE_REVISION = 2;

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
};

// ---- On-duty leaves (OD) ---------------------------------------------------

export interface OdLeave {
  id: string;
  /** The day of the leave, YYYY-MM-DD. */
  date: string;
  reason: string;
  /** True when it is not sure an OD was applied for at all. */
  unconfirmed?: boolean;
  /**
   * Absent hours sitting in the portal baseline that this OD would turn into
   * present hours, per course.
   */
  hours: Partial<Record<CourseCode, number>>;
}

export const ODS: OdLeave[] = [
  {
    id: "od-2026-08-12",
    date: "2026-08-12",
    reason: "eMudhra visit (full-day OD)",
    hours: { APT4002: 2, CSE2257: 1, CSE2255: 1, MAT2303: 1 },
  },
  {
    id: "od-2026-09-04",
    date: "2026-09-04",
    reason: "SIH orientation",
    hours: { APT4002: 2, CSE2257: 1 },
  },
  {
    id: "od-2026-09-15",
    date: "2026-09-15",
    reason: "Engineer's Day",
    hours: { CSE2257: 1 },
  },
  {
    id: "od-2026-09-16",
    date: "2026-09-16",
    reason: "SIH hackathon",
    hours: { APT4002: 2, CSE2257: 1, CSE2255: 1, MAT2303: 1 },
  },
  {
    id: "od-2026-09-17",
    date: "2026-09-17",
    reason: "SIH hackathon",
    hours: { MAT2303: 1, CSE2253: 1, CSE2251: 1, CSE2258: 1, CSE2256: 2 },
  },
  {
    id: "od-2026-09-24",
    date: "2026-09-24",
    reason: "Anveshana Pitchathon",
    hours: { MAT2303: 1, CSE2253: 1, CSE2251: 1, CSE2258: 1, CSE2256: 1 },
  },
  {
    id: "od-2026-09-29",
    date: "2026-09-29",
    reason: "French event, Seminar Hall",
    hours: { CSE2252: 1 },
  },
  {
    id: "od-2026-10-27",
    date: "2026-10-27",
    reason: "Chip to Crop",
    hours: { CSE2252: 1 },
  },
  {
    id: "od-2026-10-29",
    date: "2026-10-29",
    reason: "Alliance hackathon",
    hours: { MAT2303: 1, CSE2253: 1, CSE2251: 1, CSE2258: 1, CSE2256: 2 },
  },
  {
    id: "od-2026-10-30",
    date: "2026-10-30",
    reason: "Alliance hackathon",
    hours: { CSE2257: 1, CSE2251: 1, CSE2259: 2, CSE2253: 1, CSE2258: 1, MAT2303: 1 },
  },
];

export function odTotalHours(od: OdLeave): number {
  return Object.values(od.hours).reduce((sum, h) => sum + (h ?? 0), 0);
}

export const OD_TOTAL_HOURS = ODS.reduce((sum, od) => sum + odTotalHours(od), 0);

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

export function odStateAll(on: boolean): OdState {
  return Object.fromEntries(ODS.map((od) => [od.id, { on, inPortal: false }]));
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
  /** Which ODs to count as present. */
  odState: OdState;
  holidays: string[];
}

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
    baseline: structuredClone(PORTAL_BASELINE),
    baselineRevision: BASELINE_REVISION,
    odState: odStateAll(true),
    holidays: [...DEFAULT_HOLIDAYS],
  };
}
